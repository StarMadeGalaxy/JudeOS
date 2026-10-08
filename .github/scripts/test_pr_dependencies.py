import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('gate', Path(__file__).with_name('pr_dependencies.py'))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def pull(number=10, body='Merge after: none', **kwargs):
    return dict(number=number, body=body, head={'sha': 'a' * 40},
                base={'ref': 'main'}, state='open', **kwargs)


class FakeAPI:
    repository = 'synthetic/repo'

    def __init__(self, pr, deps=None, latest=None):
        self.pr = pr
        self.deps = deps or {}
        self.latest = latest or pr
        self.calls = []
        self.reads = 0

    def pull(self, number):
        if number == self.pr['number']:
            self.reads += 1
            return self.pr if self.reads == 1 else self.latest
        if number not in self.deps:
            raise gate.GateError('API unavailable')
        return self.deps[number]

    def request(self, path, method='GET', data=None):
        self.calls.append((path, method, data))
        return {'id': 1}

    def open_pulls(self):
        return [self.pr]


class ParsingTests(unittest.TestCase):
    def test_independent_and_multiple_dependencies(self):
        self.assertEqual(gate.dependencies('Intro\nMerge after: none\nMore', 10), [])
        self.assertEqual(gate.dependencies('Merge after: #2, #3', 10), [2, 3])

    def test_examples_and_hidden_comments_cannot_supply_declaration(self):
        for body in ['```\nMerge after: none\n```',
                     '<!--\nMerge after: none\n-->']:
            with self.assertRaises(gate.GateError):
                gate.dependencies(body, 10)
        self.assertEqual(gate.dependencies('~~~text\nMerge after: #2\n~~~\nMerge after: none', 10), [])

    def test_invalid_declarations_fail_closed(self):
        values = [None, '', 'Merge after: #0', 'Merge after: #02',
                  'Merge after: #2, #2', 'Merge after: #10',
                  'Merge after: none\nMerge after: #2', 'Merge after: #2 #3',
                  'Merge after: https://github.com/other/repo/pull/2',
                  'Merge after: $(echo secret)', 'Merge after: #2; exit 0',
                  'Merge after: none #2', 'Merge after: #9999999999',
                  'Merge after: ' + ', '.join(f'#{n}' for n in range(11, 37))]
        for body in values:
            with self.subTest(body=body), self.assertRaises(gate.GateError):
                gate.dependencies(body, 10)


class EvaluationTests(unittest.TestCase):
    def test_only_merged_dependencies_pass(self):
        pr = pull(body='Merge after: #2')
        for state, merged, passed in [('open', False, False), ('closed', False, False),
                                      ('closed', True, True)]:
            deps = {2: dict(base={'ref': 'main'}, state=state, merged=merged)}
            self.assertEqual(gate.evaluate(pr, deps.__getitem__)[1], passed)

    def test_all_dependencies_must_be_merged(self):
        deps = {2: {'base': {'ref': 'main'}, 'merged': True},
                3: {'base': {'ref': 'main'}, 'merged': False}}
        self.assertFalse(gate.evaluate(pull(body='Merge after: #2, #3'), deps.__getitem__)[1])

    def test_different_base_is_rejected(self):
        with self.assertRaises(gate.GateError):
            gate.evaluate(pull(body='Merge after: #2'),
                          lambda n: {'base': {'ref': 'develop'}, 'merged': True})

    def test_missing_issue_or_api_error_blocks(self):
        api = FakeAPI(pull(body='Merge after: #2'))
        row = gate.check_pull(api, 10)
        self.assertFalse(row[2])
        self.assertEqual(api.calls[-1][2]['state'], 'failure')

    def test_cycles_cannot_pass(self):
        first, second = pull(10, 'Merge after: #20'), pull(20, 'Merge after: #10')
        self.assertFalse(gate.evaluate(first, lambda n: second)[1])
        self.assertFalse(gate.evaluate(second, lambda n: first)[1])


class PublicationTests(unittest.TestCase):
    def test_in_progress_precedes_success_on_exact_head(self):
        api = FakeAPI(pull())
        row = gate.check_pull(api, 10)
        self.assertTrue(row[2])
        self.assertEqual(api.calls[0][0], '/statuses/' + 'a' * 40)
        self.assertEqual(api.calls[0][2]['state'], 'pending')
        self.assertEqual(api.calls[1][2]['head_sha'], 'a' * 40)
        self.assertEqual(api.calls[1][2]['status'], 'in_progress')
        self.assertEqual(api.calls[-2][2]['conclusion'], 'success')
        self.assertEqual(api.calls[-1][2]['state'], 'success')

    def test_waiting_dependency_publishes_failure_in_both_results(self):
        api = FakeAPI(pull(body='Merge after: #2'), deps={2: {'base': {'ref': 'main'}, 'merged': False}})
        self.assertFalse(gate.check_pull(api, 10)[2])
        self.assertEqual(api.calls[-2][2]['conclusion'], 'failure')
        self.assertEqual(api.calls[-1][2]['state'], 'failure')
        self.assertEqual(api.calls[-1][2]['context'], gate.CHECK)
        self.assertIn('#2', api.calls[-1][2]['description'])

    def test_publication_failure_leaves_pending_status(self):
        api = FakeAPI(pull())
        original = api.request
        def request(path, method='GET', data=None):
            if path == '/check-runs':
                raise gate.GateError('synthetic API failure')
            return original(path, method, data)
        api.request = request
        with self.assertRaises(gate.GateError):
            gate.check_pull(api, 10)
        self.assertEqual([c[2]['state'] for c in api.calls], ['pending'])

    def test_final_status_write_failure_never_publishes_success_status(self):
        api = FakeAPI(pull())
        original = api.request
        def request(path, method='GET', data=None):
            if path.startswith('/statuses/') and data['state'] == 'success':
                raise gate.GateError('synthetic API failure')
            return original(path, method, data)
        api.request = request
        with self.assertRaises(gate.GateError):
            gate.check_pull(api, 10)
        self.assertEqual([c[2]['state'] for c in api.calls if c[0].startswith('/statuses/')], ['pending'])

    def test_description_head_base_or_state_race_blocks(self):
        for field, replacement in [('body', 'Merge after: #2'),
                                   ('head', {'sha': 'b' * 40}),
                                   ('base', {'ref': 'develop'}), ('state', 'closed')]:
            original = pull()
            latest = {**original, field: replacement}
            api = FakeAPI(original, latest=latest)
            self.assertFalse(gate.check_pull(api, 10)[2])
            self.assertEqual(api.calls[-1][2]['state'], 'failure')

    def test_shared_commit_cannot_publish_conflicting_success(self):
        api = FakeAPI(pull())
        api.open_pulls = lambda: [pull(), pull()]
        summary, failed = gate.reconcile(api)
        self.assertFalse(failed)
        self.assertIn('Multiple open PRs share this head', summary)
        self.assertTrue(all(call[2]['conclusion'] == 'failure'
                            for call in api.calls if call[1] == 'PATCH'))

    def test_closed_pr_is_not_checked(self):
        pr = pull(); pr['state'] = 'closed'
        api = FakeAPI(pr)
        self.assertIsNone(gate.check_pull(api, 10))
        self.assertEqual(api.calls, [])

    def test_queue_contains_safe_links_not_untrusted_description(self):
        api = FakeAPI(pull(body='Merge after: none\n<script>steal()</script>'))
        summary, failed = gate.reconcile(api)
        self.assertFalse(failed)
        self.assertIn('https://github.com/synthetic/repo/pull/10', summary)
        self.assertNotIn('<script>', summary)

    def test_repository_path_cannot_escape_api(self):
        with self.assertRaises(gate.GateError):
            gate.API('owner/repo/../../outside', 'synthetic')


class PaginationTests(unittest.TestCase):
    def test_all_pages_are_read(self):
        api = gate.API('synthetic/repo', 'synthetic')
        calls = []
        def request(path):
            calls.append(path)
            return [pull(n) for n in range(100)] if path.endswith('&page=1') else [pull(101)]
        api.request = request
        self.assertEqual(len(api.open_pulls()), 101)
        self.assertEqual(len(calls), 2)


if __name__ == '__main__':
    unittest.main()
