#!/usr/bin/env python3
"""Identify a rollback candidate; metadata cannot prove runtime compatibility."""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('current', type=Path)
    p.add_argument('previous', type=Path)
    a = p.parse_args()
    current, previous = (json.loads(f.read_text()) for f in (a.current, a.previous))
    candidate = (not previous['dirty'] and not current['dirty']
                 and bool(previous.get('registry_digest'))
                 and bool(current.get('registry_digest'))
                 and current['schema_version'] == previous['schema_version']
                 and current['migrations'] == previous['migrations'])
    print(json.dumps({'current_commit': current['source_commit'],
                      'previous_commit': previous['source_commit'],
                      'previous_image': previous.get('registry_digest'),
                      'same_schema_candidate': candidate,
                      'runtime_compatibility': 'not verified; exercise previous image on current synthetic schema'}))
    raise SystemExit(0 if candidate else 1)

if __name__ == '__main__':
    main()
