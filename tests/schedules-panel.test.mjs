import test from 'node:test';
import assert from 'node:assert/strict';
import { HOVER_LIMIT, lastResult, localTime, panelOrder, upcoming, windowsFailed, windowsTabVisible, windowsTone } from '../src/schedules-panel-model.ts';

const NOW = new Date(2026, 10, 26, 15, 0, 0).getTime();
const HOUR = 3_600_000;
const schedule = (id, extra = {}) => ({ id, title: id, enabled: true, nextRunAt: NOW + HOUR, ...extra });
const ids = list => list.map(item => item.id);

test('upcoming lists enabled schedules with a next run, soonest first, across projects', () => {
  const list = [
    schedule('late', { nextRunAt: NOW + 5 * HOUR, projectId: 'a' }),
    schedule('soon', { nextRunAt: NOW + HOUR, projectId: 'b' }),
    schedule('off', { enabled: false, nextRunAt: NOW + 1 }),
    schedule('waiting', { nextRunAt: null }),
    schedule('middle', { nextRunAt: NOW + 2 * HOUR, projectId: 'c' }),
  ];
  assert.deepEqual(ids(upcoming(list)), ['soon', 'middle', 'late']);
});

test('upcoming stops at ten and breaks ties by title then id', () => {
  const list = Array.from({ length: 14 }, (_, index) => schedule(`s${String(index).padStart(2, '0')}`, { nextRunAt: NOW + HOUR }));
  assert.equal(HOVER_LIMIT, 10);
  assert.deepEqual(ids(upcoming([...list].reverse())), ids(list.slice(0, 10)));
  assert.equal(upcoming(list, 3).length, 3);
  assert.deepEqual(upcoming([]), []);
});

test('upcoming does not reorder the list it is given', () => {
  const list = [schedule('b', { nextRunAt: NOW + 2 * HOUR }), schedule('a', { nextRunAt: NOW + HOUR })];
  upcoming(list);
  assert.deepEqual(ids(list), ['b', 'a']);
});

test('panelOrder puts switched-on schedules first, then next run with none last, then title', () => {
  const list = [
    schedule('off-soon', { enabled: false, nextRunAt: NOW + 1 }),
    schedule('on-none', { nextRunAt: null }),
    schedule('on-late', { nextRunAt: NOW + 3 * HOUR }),
    schedule('on-soon', { nextRunAt: NOW + HOUR }),
    schedule('off-none', { enabled: false, nextRunAt: null }),
  ];
  assert.deepEqual(ids(panelOrder(list)), ['on-soon', 'on-late', 'on-none', 'off-soon', 'off-none']);
  assert.equal(panelOrder(list).length, list.length);
});

test('lastResult maps a run outcome to ok, error, skipped or none', () => {
  assert.equal(lastResult('started'), 'ok');
  assert.equal(lastResult('queued'), 'ok');
  assert.equal(lastResult('failed'), 'error');
  assert.equal(lastResult('skipped'), 'skipped');
  assert.equal(lastResult(undefined), 'none');
  assert.equal(lastResult(null), 'none');
});

test('windowsTone: error and broken are red, switched off is grey, everything else is plain', () => {
  assert.equal(windowsTone({ mark: '', result: 'ok' }), 'ok');
  assert.equal(windowsTone({ mark: '', result: 'erro 1' }), 'error');
  assert.equal(windowsTone({ mark: '', result: 'Erro 2147946720' }), 'error');
  assert.equal(windowsTone({ mark: 'quebrado', result: 'ok' }), 'error');
  assert.equal(windowsTone({ mark: 'desligada', result: 'ok' }), 'off');
  assert.equal(windowsTone({ mark: 'desligada', result: 'erro 1' }), 'off');
  assert.equal(windowsTone({ mark: 'apagar', result: 'ok' }), 'ok');
  assert.equal(windowsTone({ mark: '', result: '' }), 'ok');
});

test('windowsFailed only matches a result that starts with erro', () => {
  assert.equal(windowsFailed({ result: 'erro 2' }), true);
  assert.equal(windowsFailed({ result: ' erro 2' }), true);
  assert.equal(windowsFailed({ result: 'ok' }), false);
  assert.equal(windowsFailed({ result: 'sem erro' }), false);
});

test('the Windows tab shows only when a path is saved', () => {
  assert.equal(windowsTabVisible(null), false);
  assert.equal(windowsTabVisible({ configured: false }), false);
  assert.equal(windowsTabVisible({ configured: true }), true);
});

test('localTime always names the clock and the day', () => {
  const at = (days, hour, minute) => new Date(2026, 10, 26 + days, hour, minute).getTime();
  assert.match(localTime(at(0, 18, 30), NOW), /^Today .*(6:30|18:30)/);
  assert.match(localTime(at(1, 9, 0), NOW), /^Tomorrow .*(9:00|09:00)/);
  assert.match(localTime(at(3, 9, 0), NOW), /(9:00|09:00)/);
  assert.doesNotMatch(localTime(at(3, 9, 0), NOW), /Today|Tomorrow/);
  assert.doesNotMatch(localTime(at(12, 9, 0), NOW), /Today|Tomorrow/);
});
