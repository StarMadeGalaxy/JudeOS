#!/usr/bin/env python3
"""Apply the published backlog to GitHub; default mode is read-only."""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'planning/ISSUE-BACKLOG.json'
LAST_WRITE = 0.0


def api(endpoint, method='GET', payload=None):
    global LAST_WRITE
    mutation = method != 'GET' and not (endpoint == 'graphql' and
                                       (payload or {}).get('query', '').lstrip().startswith('query'))
    if mutation:
        time.sleep(max(0, 1 - (time.monotonic() - LAST_WRITE)))
    cmd = ['gh', 'api', endpoint, '--method', method]
    if payload is not None:
        cmd += ['--input', '-']
    result = subprocess.run(cmd, input=json.dumps(payload) if payload is not None else None,
                            text=True, capture_output=True)
    if mutation:
        LAST_WRITE = time.monotonic()
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    value = json.loads(result.stdout) if result.stdout.strip() else None
    if isinstance(value, dict) and value.get('errors'):
        raise RuntimeError(json.dumps(value['errors'], ensure_ascii=False))
    return value


def gql(query, variables=None):
    return api('graphql', 'POST', {'query': query, 'variables': variables or {}})['data']


def pages(endpoint):
    page = 1
    while True:
        batch = api(f'{endpoint}{"&" if "?" in endpoint else "?"}per_page=100&page={page}')
        yield from batch
        if len(batch) < 100:
            return
        page += 1


def validate(data):
    if data['schema_version'] != 1:
        raise ValueError('Unsupported manifest schema')
    keys = {item['key'] for item in data['items']}
    if len(keys) != len(data['items']):
        raise ValueError('Duplicate task keys')
    milestones = {m['key'] for m in data['milestones']}
    seen = set()
    for item in data['items']:
        if item['milestone'] not in milestones:
            raise ValueError(f"Unknown milestone: {item['key']}")
        if any(dep not in seen for dep in item['depends_on']):
            raise ValueError(f"Missing/cyclic/non-topological dependency: {item['key']}")
        if not item['acceptance'] or not item['source']:
            raise ValueError(f"Missing acceptance/source: {item['key']}")
        seen.add(item['key'])
    entries = data['items'] + data.get('epics', []) + data.get('management', [])
    numbers = [e.get('issue_number') for e in entries]
    if any(n is None for n in numbers) or len(set(numbers)) != len(numbers):
        raise ValueError('Every task and epic must have a unique published Issue')
    return entries


def read_project(url):
    parts = urlparse(url)
    path = parts.path.strip('/').split('/')
    if parts.netloc != 'github.com' or len(path) != 4 or path[0] != 'users' or path[2] != 'projects':
        raise ValueError('Expected https://github.com/users/<owner>/projects/<number>')
    query = '''query($owner:String!,$number:Int!){
      user(login:$owner){projectV2(number:$number){id title url closed viewerCanUpdate
        fields(first:100){nodes{
          ... on ProjectV2Field{id name}
          ... on ProjectV2SingleSelectField{id name options{id name color description}}
        }}}}
    }'''
    project = gql(query, {'owner': path[1], 'number': int(path[3])})['user']['projectV2']
    if not project or project['closed'] or not project['viewerCanUpdate']:
        raise RuntimeError('Project is missing, closed or not writable by this account')
    return project


def read_items(project_id):
    result = []
    cursor = None
    while True:
        data = gql('''query($id:ID!,$after:String){node(id:$id){... on ProjectV2{
          items(first:100,after:$after){nodes{id
            content{... on Issue{number repository{nameWithOwner}}}
            fieldValues(first:100){nodes{... on ProjectV2ItemFieldSingleSelectValue{
              name field{... on ProjectV2SingleSelectField{id name}}
            }}}
          }pageInfo{hasNextPage endCursor}}
        }}}''', {'id': project_id, 'after': cursor})['node']['items']
        result.extend(data['nodes'])
        if not data['pageInfo']['hasNextPage']:
            return result
        cursor = data['pageInfo']['endCursor']


def field_value(item, name):
    for value in item['fieldValues']['nodes']:
        if value.get('field', {}).get('name') == name:
            return value.get('name')
    return None


def choose_status(entry, issues, entries, previous=None):
    issue = issues[entry['issue_number']]
    if issue['state'] == 'closed':
        return 'Done'
    if entry['kind'] == 'planning':
        return 'In progress'
    if entry['kind'] == 'epic':
        children = [e for e in entries if e['kind'] == 'task' and e['milestone'] == entry['milestone']]
        if any(issues[c['issue_number']]['state'] == 'closed' or
               c.get('_previous') in ('In progress', 'Review') for c in children):
            return 'In progress'
        return 'Backlog'
    # Existing active work is never silently reset by a dependency refresh.
    if previous in ('In progress', 'Review'):
        return previous
    if entry.get('deferred'):
        return 'Backlog'
    by_key = {e['key']: e for e in entries}
    if all(issues[by_key[d]['issue_number']]['state'] == 'closed' and
           issues[by_key[d]['issue_number']].get('state_reason') == 'completed'
           for d in entry['depends_on']):
        return 'Ready'
    return 'Backlog'


def apply_status(project, items, statuses, apply):
    field = next((f for f in project['fields']['nodes'] if f.get('name') == 'Status'), None)
    if field is None:
        raise RuntimeError('Create the Status single-select field in the Project settings first')
    if 'options' not in field:
        raise RuntimeError('Status must be a single-select field')
    missing = set(statuses) - {o['name'] for o in field['options']}
    if missing:
        # Updating options can clear assigned values. Never do that on a populated field.
        if any(field_value(item, 'Status') is not None for item in items):
            raise RuntimeError('Add these Status options in the UI, preserving existing values: ' +
                               ', '.join(sorted(missing)))
        if not apply:
            print('Would configure empty Status field:', ', '.join(statuses))
            return None
        colors = ['GRAY', 'BLUE', 'YELLOW', 'PURPLE', 'GREEN']
        options = [{'name': name, 'color': color, 'description': name}
                   for name, color in zip(statuses, colors)]
        field = gql('''mutation($id:ID!,$options:[ProjectV2SingleSelectFieldOptionInput!]!){
          updateProjectV2Field(input:{fieldId:$id,singleSelectOptions:$options}){
            projectV2Field{... on ProjectV2SingleSelectField{id name options{id name}}}
          }}''', {'id': field['id'], 'options': options})['updateProjectV2Field']['projectV2Field']
    return field


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Apply milestones, links and Project statuses')
    parser.add_argument('--validate', action='store_true', help='Validate the local graph only; no network')
    args = parser.parse_args()
    data = json.loads(MANIFEST.read_text())
    entries = validate(data)
    if args.validate:
        print(f"OK: {len(data['items'])} tasks, {len(data['epics'])} epics, acyclic dependencies")
        return
    repo = data['repository']
    # Complete the read-only preflight before any mutation.
    metadata = api(f'repos/{repo}')
    if not metadata.get('permissions', {}).get('push'):
        raise RuntimeError('Repository write permission is required')
    project = read_project(data['project_url'])
    project_items = read_items(project['id'])
    issues = {i['number']: i for i in pages(f'repos/{repo}/issues?state=all') if 'pull_request' not in i}
    for entry in entries:
        issue = issues.get(entry['issue_number'])
        if issue is None or f"<!-- judeos-backlog:{entry['key']} -->" not in (issue['body'] or ''):
            raise RuntimeError(f"Published issue identity mismatch: {entry['key']}")
    existing_ms = {m['title']: m for m in pages(f'repos/{repo}/milestones?state=all')}
    field = apply_status(project, project_items, data['statuses'], args.apply)
    print('Project:', project['url'], '| mode:', 'APPLY' if args.apply else 'READ ONLY')
    for ms in data['milestones']:
        found = existing_ms.get(ms['title'])
        if not found:
            print('Create milestone:', ms['title'])
            if args.apply:
                found = api(f'repos/{repo}/milestones', 'POST',
                            {'title': ms['title'], 'description': ms['description']})
                existing_ms[ms['title']] = found
        ms['_number'] = found['number'] if found else None
    ms_by_key = {m['key']: m for m in data['milestones']}
    by_key = {e['key']: e for e in entries}
    item_by_number = {item['content']['number']: item for item in project_items
                      if item.get('content') and
                      item['content'].get('repository', {}).get('nameWithOwner') == repo}
    for entry in entries:
        entry['_previous'] = field_value(item_by_number[entry['issue_number']], 'Status') \
            if entry['issue_number'] in item_by_number else None
    for entry in entries:
        number = entry['issue_number']
        issue = issues[number]
        ms_number = ms_by_key[entry['milestone']]['_number']
        if not issue['milestone'] or issue['milestone']['number'] != ms_number:
            print(f"#{number}: milestone {entry['milestone']}")
            if args.apply:
                api(f'repos/{repo}/issues/{number}', 'PATCH', {'milestone': ms_number})
        if entry['kind'] == 'task':
            endpoint = f'repos/{repo}/issues/{number}/dependencies/blocked_by'
            linked = {i['id'] for i in pages(endpoint)}
            for dep in entry['depends_on']:
                target = issues[by_key[dep]['issue_number']]
                if target['id'] not in linked:
                    print(f"#{number}: blocked by #{target['number']}")
                    if args.apply:
                        api(endpoint, 'POST', {'issue_id': target['id']})
            parent = next(e for e in data['epics'] if e['milestone'] == entry['milestone'])
            endpoint = f"repos/{repo}/issues/{parent['issue_number']}/sub_issues"
            children = {i['id'] for i in pages(endpoint)}
            if issue['id'] not in children:
                print(f"#{number}: child of #{parent['issue_number']}")
                if args.apply:
                    api(endpoint, 'POST', {'sub_issue_id': issue['id']})
        item = item_by_number.get(number)
        status = choose_status(entry, issues, entries, entry['_previous'])
        print(f"#{number}: {status}")
        if not args.apply:
            continue
        if item is None:
            item = gql('''mutation($project:ID!,$issue:ID!){
              addProjectV2ItemById(input:{projectId:$project,contentId:$issue}){item{id}}
            }''', {'project': project['id'], 'issue': issue['node_id']})['addProjectV2ItemById']['item']
        option_id = next(o['id'] for o in field['options'] if o['name'] == status)
        if entry['_previous'] != status:
            gql('''mutation($project:ID!,$item:ID!,$field:ID!,$option:String!){
              updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,
                fieldId:$field,value:{singleSelectOptionId:$option}}){projectV2Item{id}}
            }''', {'project': project['id'], 'item': item['id'],
                  'field': field['id'], 'option': option_id})
    if args.apply:
        actual = read_items(project['id'])
        present = {i['content']['number'] for i in actual if i.get('content') and
                   i['content'].get('repository', {}).get('nameWithOwner') == repo}
        expected = {e['issue_number'] for e in entries}
        if not expected <= present:
            raise RuntimeError('Post-check failed: some backlog Issues are missing from the Project')
        print('Verified Project membership for all tasks and epics.')
    print('No assignees or deadlines changed. Review/Done workflows must be checked in Project UI.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, StopIteration, OSError) as exc:
        print(f'Planning sync stopped: {exc}', file=sys.stderr)
        sys.exit(1)
