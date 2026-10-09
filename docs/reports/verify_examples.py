#!/usr/bin/env python3
"""Check documentation arithmetic only; no database, HTTP or financial commands."""
import json
from collections import Counter, defaultdict
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FIXTURE = json.loads((ROOT / 'examples/fixture.json').read_text())
EXPECTED = json.loads((ROOT / 'examples/expected.json').read_text())
MAX_EXACT = 2**53 - 1


def instant(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def visible(row, as_of, event=False):
    return (instant(row['recorded_at']) <= instant(as_of)
            and (not event or instant(row['occurred_at']) <= instant(as_of)))


def in_period(value):
    period = FIXTURE['period']
    return instant(period['from']) <= instant(value) < instant(period['to'])


def percentage(numerator, denominator):
    if denominator == 0:
        return None
    value = Decimal(100 * numerator) / Decimal(denominator)
    return str(value.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def receipt_rows(as_of, cohort=True, ids=None):
    rows = []
    for receipt in FIXTURE['receipts']:
        if receipt['tenant'] != FIXTURE['tenant'] or not visible(receipt, as_of, True):
            continue
        if cohort and not in_period(receipt['occurred_at']):
            continue
        if ids is not None and receipt['id'] not in ids:
            continue
        reversals = [v for v in FIXTURE['reversals']
                     if v['receipt_id'] == receipt['id'] and visible(v, as_of, True)]
        allocations = [a for a in FIXTURE['allocations']
                       if a['receipt_id'] == receipt['id'] and visible(a, as_of)]
        allocated = 0
        for allocation in allocations:
            released = sum(c['amount_kopecks'] for c in FIXTURE['changes']
                           if c['allocation_id'] == allocation['id'] and visible(c, as_of))
            assert 0 <= released <= allocation['amount_kopecks']
            allocated += allocation['amount_kopecks'] - released
        gross = receipt['amount_kopecks']
        reversed_amount = sum(v['amount_kopecks'] for v in reversals)
        assert 0 <= reversed_amount <= gross
        net = gross - reversed_amount
        available = net - allocated
        assert 0 <= allocated <= net and available >= 0
        rows.append(dict(receipt=receipt['id'], gross=gross, reversed=reversed_amount,
                         net=net, allocated=allocated, available=available))
    return rows


def totals(rows):
    result = {key: sum(row[key] for row in rows)
              for key in ('gross', 'reversed', 'net', 'allocated', 'available')}
    assert result['net'] == result['allocated'] + result['available']
    assert all(0 <= value <= MAX_EXACT for value in result.values())
    return result


def movements(as_of):
    receipts = {r['id']: r for r in FIXTURE['receipts'] if r['tenant'] == FIXTURE['tenant']}
    gross = sum(r['amount_kopecks'] for r in receipts.values()
                if visible(r, as_of, True) and in_period(r['occurred_at']))
    refunds = sum(v['amount_kopecks'] for v in FIXTURE['reversals']
                  if v['receipt_id'] in receipts and v['kind'] == 'refund'
                  and visible(v, as_of, True) and in_period(v['occurred_at']))
    return dict(gross=gross, refund=refunds, net=gross-refunds)


def support_rows(month, as_of):
    receipts = {r['id'] for r in FIXTURE['receipts']
                if r['tenant'] == FIXTURE['tenant'] and visible(r, as_of, True)}
    recommendations = {q['athlete']: q for q in FIXTURE['recommendations']
                       if q['support_month'] == month and visible(q, as_of)}
    allocations = [a for a in FIXTURE['allocations'] if a['receipt_id'] in receipts
                   and a['support_month'] == month and visible(a, as_of)]
    athletes = sorted(set(recommendations) | {a['athlete'] for a in allocations})
    rows = []
    for athlete in athletes:
        q = recommendations.get(athlete)
        related = [a for a in allocations if a['athlete'] == athlete]
        gross = sum(a['amount_kopecks'] for a in related)
        allocation_ids = {a['id'] for a in related}
        released = sum(c['amount_kopecks'] for c in FIXTURE['changes']
                       if c['allocation_id'] in allocation_ids and visible(c, as_of))
        net = gross - released
        rows.append(dict(athlete=athlete, recommendation_kopecks=q['final_kopecks'] if q else None,
                         gross=gross, released=released, net=net,
                         difference=q['final_kopecks']-net if q else None))
    return rows


def attendance(as_of):
    counts = Counter()
    seen = set()
    for session in FIXTURE['sessions']:
        if (session['tenant'] != FIXTURE['tenant'] or not visible(session, as_of)
                or not in_period(session['starts_at'])):
            continue
        if session['state'] == 'cancelled':
            counts['cancelled_roster_count'] += len(session['roster'])
            continue
        if session['state'] != 'closed':
            counts['open_session_count'] += 1
        for row in session['roster']:
            key = (session['id'], row['athlete'])
            assert key not in seen
            seen.add(key)
            if row['excluded']:
                counts['excluded_roster_count'] += 1
                continue
            assert row['status'] in {'present', 'absent', 'sick', 'unmarked'}
            counts['roster_count'] += 1
            counts[row['status']+'_count'] += 1
            counts['trial_count'] += int(row['trial'])
    counts['marked_count'] = counts['present_count'] + counts['absent_count'] + counts['sick_count']
    assert counts['roster_count'] == counts['marked_count'] + counts['unmarked_count']
    return dict(counts, attendance_percent=percentage(counts['present_count'], counts['marked_count']),
                completeness_percent=percentage(counts['marked_count'], counts['roster_count']))


def queue(as_of):
    inputs = [i for i in FIXTURE['inputs'] if i['tenant'] == FIXTURE['tenant'] and visible(i, as_of)]
    unresolved = [i for i in inputs if i['status'] in {'needs_review', 'conflict', 'invalid'}]
    known = defaultdict(int)
    for row in unresolved:
        if row['amount_kopecks'] is not None:
            known[row['status']] += row['amount_kopecks']
    residuals = [r for r in receipt_rows(as_of, cohort=False) if r['available'] > 0]
    states = {}
    for state in ('applied', 'duplicate', 'needs_review', 'conflict', 'invalid'):
        selected = [i for i in inputs if i['status'] == state]
        states[state] = dict(count=len(selected), amount=sum(i['amount_kopecks'] or 0 for i in selected))
    return dict(unresolved_ids=[i['id'] for i in unresolved], known_unresolved=dict(known),
                unknown_amount_count=sum(i['amount_kopecks'] is None for i in unresolved),
                receipt_ids=[r['receipt'] for r in residuals], available=sum(r['available'] for r in residuals),
                batch=dict(rows=len(inputs), known_amount=sum(i['amount_kopecks'] or 0 for i in inputs), states=states))


def verify():
    assert FIXTURE['synthetic'] is True
    assert FIXTURE['definition_version'] == EXPECTED['definition_version'] == '0.1'
    receipts = {r['id']: r for r in FIXTURE['receipts']}
    allocations = {a['id']: a for a in FIXTURE['allocations']}
    reversals = {v['id']: v for v in FIXTURE['reversals']}
    for collection in ('receipts', 'allocations', 'reversals', 'changes', 'recommendations', 'sessions', 'inputs'):
        rows = FIXTURE[collection]
        assert len({row['id'] for row in rows}) == len(rows)
        for row in rows:
            amount = row.get('amount_kopecks')
            if amount is not None:
                assert type(amount) is int and 0 < amount <= MAX_EXACT
            if row.get('currency') is not None:
                assert row['currency'] == 'BYN'
    for row in FIXTURE['allocations']:
        assert row['receipt_id'] in receipts and row['athlete'] in FIXTURE['athletes']
    for row in FIXTURE['changes']:
        allocation = allocations[row['allocation_id']]
        reversal = reversals[row['reversal_id']]
        assert allocation['receipt_id'] == reversal['receipt_id']
        assert row['recorded_at'] == reversal['recorded_at']
    for row in FIXTURE['inputs']:
        if row['receipt_id'] is not None:
            assert receipts[row['receipt_id']]['tenant'] == row['tenant']
    for q in FIXTURE['recommendations']:
        assert 0 <= q['adjustment_kopecks'] <= q['base_kopecks']
        assert q['final_kopecks'] == q['base_kopecks']-q['adjustment_kopecks']

    as_of = FIXTURE['as_of']
    assert attendance(as_of) == EXPECTED['R1']
    support = support_rows('2026-10', as_of)
    assert support == EXPECTED['R2']['rows']
    assert {key: sum(row[key] for row in support) for key in EXPECTED['R2']['totals']} == EXPECTED['R2']['totals']
    cohort = receipt_rows(as_of)
    assert cohort == EXPECTED['R3']['rows']
    assert totals(cohort) == EXPECTED['R3']['totals']
    assert movements(as_of) == EXPECTED['R3']['movements']
    assert queue(as_of) == EXPECTED['R4']

    later = EXPECTED['later_slices']['as_of_november']
    original_ids = {row['receipt'] for row in cohort}
    assert totals(receipt_rows(later, ids=original_ids)) == EXPECTED['later_slices']['fixed_october_cohort']
    assert totals(receipt_rows(later)) == EXPECTED['later_slices']['expanded_october_cohort']
    assert movements(later) == EXPECTED['later_slices']['october_movements_recomputed']
    early = totals(receipt_rows('2026-10-09T12:00:00Z'))
    assert early == dict(gross=38000, reversed=0, net=38000, allocated=30800, available=7200)
    assert 'R4' not in original_ids and 'R6' not in original_ids
    assert receipt_rows(as_of, cohort=False)[3]['receipt'] == 'R4'
    assert 'BETA-R1' not in {r['receipt'] for r in receipt_rows(later, cohort=False)}

    missing = support_rows('2026-11', as_of)[0]
    assert {key: missing[key] for key in EXPECTED['missing_recommendation']} == EXPECTED['missing_recommendation']
    assert {'attendance_percent': percentage(0, 0), 'completeness_percent': percentage(0, 0)} == EXPECTED['empty_attendance']
    family = [11000, 8800, 7700, 0, 0]
    assert [sum(family[:n]) for n in range(1, 6)] == FIXTURE['scenarios']['family_size_totals']
    excess = FIXTURE['scenarios']['excess_family_reduction']
    assert max(0, excess['base']-excess['reduction']) == excess['final']
    assert max(0, excess['reduction']-excess['base']) == excess['unused']
    race = FIXTURE['scenarios']['concurrent_allocation']
    assert race['expected_after_first'] == dict(version=race['initial_version']+1,
                                               available=race['initial_available']-race['first_request'])
    assert race['second_request'] > race['expected_after_first']['available']
    # Arithmetic of the written race only: this does not exercise locking or idempotency.
    print('PASS: R1–R4 expected rows/totals; three slices; tenant/time boundaries; family/zero/missing examples.')


if __name__ == '__main__':
    verify()
