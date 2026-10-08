"""Trusted-base dependency gate. Never executes code or shell text from a PR."""
import json
from collections import Counter
import os
import re
import sys
import urllib.error
import urllib.request

CHECK = 'PR dependencies'
MAX_DEPENDENCIES = 25

class GateError(Exception):
    pass


def dependencies(body, number):
    # Only the visible declaration counts; examples inside fenced blocks do not.
    lines = []
    fence = None
    for line in re.sub(r'<!--.*?-->', '', body or '', flags=re.S).splitlines():
        marker = re.match(r'^\s*(`{3,}|~{3,})', line)
        if marker:
            kind = marker[1][0]
            if fence is None:
                fence = kind
            elif fence == kind:
                fence = None
            continue
        if fence is None and re.match(r'^\s*Merge after\b', line):
            lines.append(line.strip())
    if len(lines) != 1:
        raise GateError('Declare exactly one visible Merge after: line.')
    value = lines[0]
    if value == 'Merge after: none':
        return []
    if not re.fullmatch(r'Merge after: #[1-9][0-9]{0,8}(?:, #[1-9][0-9]{0,8})*', value):
        raise GateError('Use Merge after: none or Merge after: #123, #456.')
    result = [int(n) for n in re.findall(r'#([0-9]+)', value)]
    if len(result) > MAX_DEPENDENCIES or len(set(result)) != len(result):
        raise GateError('Dependencies must be unique; maximum 25.')
    if number in result:
        raise GateError('A PR cannot depend on itself.')
    return result


def evaluate(pr, fetch):
    deps = dependencies(pr.get('body'), pr['number'])
    waiting = []
    for number in deps:
        try:
            dependency = fetch(number)
        except GateError:
            raise GateError(f'Cannot verify dependency #{number}; merge blocked.') from None
        if dependency.get('base', {}).get('ref') != pr['base']['ref']:
            raise GateError(f'Dependency #{number} targets a different base branch.')
        if dependency.get('merged') is not True:
            waiting.append(number)
    if waiting:
        return deps, False, 'Waiting for merged PRs: ' + ', '.join(f'#{n}' for n in waiting)
    return deps, True, 'All declared dependencies are merged.' if deps else 'Independent PR.'


class API:
    def __init__(self, repository, token):
        if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repository):
            raise GateError('Invalid repository.')
        self.repository = repository
        self.token = token

    def request(self, path, method='GET', data=None):
        payload = None if data is None else json.dumps(data).encode()
        request = urllib.request.Request(
            'https://api.github.com/repos/' + self.repository + path,
            data=payload, method=method,
            headers={'Authorization': 'Bearer ' + self.token,
                     'Accept': 'application/vnd.github+json',
                     'X-GitHub-Api-Version': '2022-11-28',
                     'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError, ValueError):
            # Never print response bodies, headers, tokens, or raw exceptions.
            raise GateError('GitHub API unavailable; merge blocked.') from None

    def pull(self, number):
        return self.request(f'/pulls/{number}')

    def open_pulls(self):
        result = []
        for page in range(1, 101):
            batch = self.request(f'/pulls?state=open&base=main&per_page=100&page={page}')
            result.extend(batch)
            if len(batch) < 100:
                return result
        raise GateError('PR pagination limit reached; cannot publish a complete queue.')


def snapshot(pr):
    return pr['head']['sha'], pr.get('body'), pr['base']['ref'], pr['state']


def check_pull(api, number, blocked_reason=None):
    pr = api.pull(number)
    if pr['state'] != 'open' or pr['base']['ref'] != 'main':
        return None
    sha = pr['head']['sha']
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise GateError('Invalid head SHA.')
    # Also publish a commit status: a successful API-created Actions CheckRun can
    # remain 'Expected' in branch protection even when isRequired reports true.
    # Pending must precede evaluation, including when CheckRun creation fails.
    api.request(f'/statuses/{sha}', 'POST', {
        'context': CHECK, 'state': 'pending',
        'description': 'Checking current PR dependencies.'})
    run = api.request('/check-runs', 'POST', {
        'name': CHECK, 'head_sha': sha, 'status': 'in_progress',
        'output': {'title': 'Checking PR dependencies',
                   'summary': 'Checking the current declaration against merged PRs.'}})
    deps, passed = [], False
    try:
        if blocked_reason:
            raise GateError(blocked_reason)
        deps, passed, message = evaluate(pr, api.pull)
        if snapshot(api.pull(number)) != snapshot(pr):
            passed = False
            message = 'PR changed during evaluation; run the workflow again.'
    except GateError as error:
        message = str(error)
    api.request(f"/check-runs/{run['id']}", 'PATCH', {
        'status': 'completed', 'conclusion': 'success' if passed else 'failure',
        'output': {'title': 'Dependencies satisfied' if passed else 'Merge blocked',
                   'summary': message}})
    # The status and detailed CheckRun use the same SHA and fail-closed result.
    # A failed write leaves pending rather than reusing the preceding green status.
    api.request(f'/statuses/{sha}', 'POST', {
        'context': CHECK, 'state': 'success' if passed else 'failure',
        'description': message[:140]})
    return number, deps, passed, message


def reconcile(api):
    rows = []
    failed = False
    pulls = api.open_pulls()
    heads = Counter(pr['head']['sha'] for pr in pulls)
    for pull in pulls:
        try:
            # Checks attach to a commit; distinct PRs must not overwrite each other.
            reason = ('Multiple open PRs share this head; commit a unique head before merging.'
                      if heads[pull['head']['sha']] > 1 else None)
            row = check_pull(api, pull['number'], reason)
            if row:
                rows.append(row)
        except GateError:
            failed = True
            rows.append((pull['number'], [], False, 'API error; check could not be refreshed.'))
    summary = ['# PR integration dependencies', '',
               'Dependency readiness only; review, CI, branch freshness and acceptance still apply.', '',
               '| PR | Merge after | Dependency check |', '| --- | --- | --- |']
    for number, deps, passed, message in rows:
        target = f'https://github.com/{api.repository}/pull/{number}'
        declaration = ', '.join(f'#{n}' for n in deps) or ('none' if passed else '—')
        summary.append(f'| [#{number}]({target}) | {declaration} | {message} |')
    return '\n'.join(summary) + '\n', failed


def main():
    try:
        api = API(os.environ['GITHUB_REPOSITORY'], os.environ['GH_TOKEN'])
        summary, failed = reconcile(api)
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as output:
            output.write(summary)
        return int(failed)
    except (GateError, KeyError) as error:
        print(str(error) if isinstance(error, GateError) else 'Missing workflow configuration.', file=sys.stderr)
        return 1

if __name__ == '__main__':
    sys.exit(main())
