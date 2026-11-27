import test from 'node:test';
import assert from 'node:assert/strict';
import { CENTRAL_WINDOW_MS, agoText, buildCentral, centralKind, eventText, isCentralProject } from '../src/central-board.ts';

const now = 100 * 3_600_000;
const projects = ['Tibia', 'BAMemory', 'Marcalle', 'Quiet'].map(name => ({ id: name.toLowerCase(), name, path: '/p/' + name }));
const task = (id, projectId, title, over = {}) => ({ id, projectId, title, status: 'idle', archived: false, draft: false, createdAt: 1, updatedAt: now - 60_000, lastResponseAt: null, lastPromptAt: now - 120_000, ...over });
const sessions = [
  task('t1', 'tibia', 'Talentos', { lastResponseAt: now - 5 * 60_000 }),
  task('t2', 'tibia', 'Outfit', { status: 'running' }),
  task('b1', 'bamemory', 'Posicionamento', { status: 'waiting_approval' }),
  task('b2', 'bamemory', 'Sentry sweep', { status: 'error', lastResponseAt: now - 90 * 60_000 }),
  task('b3', 'bamemory', 'Lead', { status: 'running' }),
  task('m1', 'marcalle', 'Landing', { lastResponseAt: now - 3 * 3_600_000 }),
  task('old', 'quiet', 'Last week', { lastResponseAt: now - 3 * CENTRAL_WINDOW_MS, updatedAt: now - 3 * CENTRAL_WINDOW_MS }),
  task('gone', 'marcalle', 'Archived', { archived: true, lastResponseAt: now - 1000 }),
  task('draft', 'marcalle', 'Draft', { draft: true }),
  task('chat', 'chat-project', 'A chat', { status: 'running' }),
];
const signals = { t2: 'running', b1: 'attention', b2: 'failed', b3: 'running' };
const trees = { b3: { total: 3, done: 1, waiting: 0 }, t2: { total: 2, done: 0, waiting: 1 } };
const input = { projects, sessions, now, signal: t => signals[t.id] ?? '', tree: t => trees[t.id] ?? null };

test('one card per project with activity in the last 24 hours, and none for a quiet or foreign project', () => {
  const model = buildCentral(input);
  assert.deepEqual(model.cards.map(card => card.name).sort(), ['BAMemory', 'Marcalle', 'Tibia']);
  assert.ok(!model.cards.some(card => card.name === 'Quiet'), 'a project idle for days has no card');
  assert.ok(!model.cards.flatMap(card => card.events).some(event => ['gone', 'draft', 'chat'].includes(event.taskId)), 'archived, draft and non-listed projects stay out');
});

test('counts, needs-you badge and card order put what needs you first', () => {
  const model = buildCentral(input);
  const by = name => model.cards.find(card => card.name === name);
  assert.deepEqual(['running', 'needs', 'finished', 'failed'].map(k => by('BAMemory')[k]), [1, 1, 0, 1]);
  assert.deepEqual(['running', 'needs', 'finished', 'failed'].map(k => by('Tibia')[k]), [0, 1, 1, 0], 'a question in a leader worker needs you');
  assert.equal(by('Marcalle').finished, 1);
  assert.equal(model.badge, 3, 'two leaders/tasks waiting plus one failure');
  assert.deepEqual(model.cards.map(card => card.name), ['BAMemory', 'Tibia', 'Marcalle'], 'failed and waiting first, then the newest');
});

test('leaders carry N of M and the latest three events are newest first', () => {
  const model = buildCentral(input);
  const bam = model.cards.find(card => card.name === 'BAMemory');
  assert.deepEqual(bam.leaders.map(l => [l.taskId, l.progress]), [['b3', '1 of 3']]);
  const many = buildCentral({ ...input, sessions: ['a', 'b', 'c', 'd'].map((id, index) => task(id, 'marcalle', id, { lastResponseAt: now - (index + 1) * 60_000 })) });
  assert.deepEqual(many.cards[0].events.map(event => event.taskId), ['a', 'b', 'c']);
});

test('the attention strip lists waiting, limited and failed tasks newest first', () => {
  const model = buildCentral({ ...input, signal: t => ({ ...signals, m1: 'limited' })[t.id] ?? '' });
  assert.deepEqual(model.attention.map(event => event.kind).sort(), ['failed', 'limited', 'needs', 'needs']);
  assert.equal(model.badge, 4);
  const old = buildCentral({ ...input, sessions: [task('x', 'tibia', 'Old failure', { status: 'error', lastResponseAt: now - 2 * CENTRAL_WINDOW_MS })], signal: () => 'failed' });
  assert.equal(old.badge, 0, 'a failure from days ago is not news');
});

test('event text reads like the board promises', () => {
  const event = kind => ({ taskId: 'x', projectId: 'p', projectName: 'Tibia', title: 'Talentos', kind, at: now - 5 * 60_000 });
  assert.equal(eventText(event('finished'), now), 'Talentos finished 5 min ago');
  assert.equal(eventText(event('needs'), now), 'Talentos needs you');
  assert.equal(eventText(event('failed'), now), 'Talentos failed 5 min ago');
  assert.equal(agoText(now - 30_000, now), 'just now');
  assert.equal(agoText(now - 3 * 3_600_000, now), '3 h ago');
  assert.equal(agoText(now - 50 * 3_600_000, now), '2 d ago');
});

test('an idle task older than the window has no event and the Central folder is recognised', () => {
  assert.equal(centralKind(sessions.find(s => s.id === 'old'), input), null);
  assert.equal(isCentralProject({ path: 'C:\\Users\\me\\PandaCode Central\\central' }), true);
  assert.equal(isCentralProject({ path: '/Users/me/PandaCode Central/central' }), true);
  assert.equal(isCentralProject({ path: '/Users/me/PandaCode Chats/chat-abcdef12' }), false);
  assert.equal(isCentralProject(undefined), false);
});
