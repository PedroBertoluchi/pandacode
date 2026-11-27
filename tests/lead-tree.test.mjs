import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBAGENT_RECENT_MS, buildLeadTree, childTip, contextPercent, contextText, leadTip, limitText, progressText, subagentNode, workerNode } from '../src/lead-tree.ts';

const now = 10_000_000;
const lookup = { needsInput: id => id === 'asks', modelName: worker => worker.model.toUpperCase(), context: id => id === 'w-run' ? { usedTokens: 50_000, contextWindow: 200_000 } : null };
const worker = (id, status, extra = {}) => ({ id, name: id, sessionId: id === 'ask' ? 'asks' : `w-${id}`, profileId: 'p', provider: 'claude', model: 'sonnet', reasoningEffort: 'high', status, assignment: `Do ${id}\nsecond line`, summary: '', dependsOn: [], files: [], attempt: 1, createdAt: Number(extra.createdAt ?? 1), updatedAt: 5, ...extra });
const team = (workers, over = {}) => ({ sessionId: 'lead', config: { maxParallel: 2, workers: [] }, status: 'running', round: 1, revision: 1, workers, updatedAt: 1, ...over });
const agent = (id, status, extra = {}) => ({ id, name: id, status, startedAt: now - 60_000, updatedAt: now - 1000, prompt: 'Look at the index', ...extra });

test('every worker state maps to one of the five line states', () => {
  const t = team([]);
  const state = w => workerNode(t, w, lookup)?.state;
  assert.equal(state(worker('run', 'running')), 'running');
  assert.equal(state(worker('wait', 'waiting')), 'waiting');
  assert.equal(state(worker('ask', 'running')), 'waiting', 'a question that waits only in the live stream still needs the user');
  assert.equal(state(worker('done', 'completed')), 'done');
  assert.equal(state(worker('q', 'queued')), 'queued');
  assert.equal(state(worker('park', 'parked')), 'queued');
  assert.equal(state(worker('bad', 'failed')), 'failed');
  assert.equal(workerNode(t, worker('stop', 'stopped'), lookup).label, 'Stopped');
  assert.equal(workerNode(t, worker('skip', 'running', { abandoned: true }), lookup), null, 'a skipped worker has no row');
});

test('a paused team holds its pending workers still instead of showing them running', () => {
  const paused = team([], { status: 'paused' });
  const node = workerNode(paused, worker('run', 'running'), lookup);
  assert.deepEqual([node.state, node.label, node.startedAt], ['queued', 'Paused', null]);
  assert.equal(workerNode(paused, worker('done', 'completed'), lookup).state, 'done');
});

test('subagent statuses use the same states and never invent a model or context', () => {
  const states = Object.fromEntries(['running', 'waiting', 'completed', 'failed', 'stopped'].map(status => [status, subagentNode(agent('a', status)).state]));
  assert.deepEqual(states, { running: 'running', waiting: 'waiting', completed: 'done', failed: 'failed', stopped: 'queued' });
  const node = subagentNode(agent('Explore', 'running'));
  assert.deepEqual([node.kind, node.name, node.model, node.effort, node.context, node.step], ['subagent', 'Explore', null, null, null, 'Look at the index']);
  assert.equal(subagentNode(agent('agent', 'running', { prompt: 'Find the flaky test' })).name, 'Find the flaky test', 'a generic name falls back to the assignment');
});

test('the tree counts every child kind, orders workers before subagents and names the limit', () => {
  const tree = buildLeadTree({
    team: team([worker('b', 'running', { createdAt: 2 }), worker('a', 'completed', { createdAt: 1 }), worker('c', 'queued', { createdAt: 3 })]),
    agents: [agent('s1', 'failed')], now, lookup,
  });
  assert.deepEqual(tree.children.map(c => c.id), ['a', 'b', 'c', 's1']);
  assert.deepEqual([tree.running, tree.queued, tree.done, tree.failed, tree.total], [1, 1, 1, 1, 4]);
  assert.equal(progressText(tree), '1 of 4');
  assert.equal(limitText(tree), '1 running at once (limit 2)');
  assert.equal(limitText({ ...tree, limit: 0 }), '1 running at once (no limit)');
});

test('no worker and no recent subagent means no tree; old settled subagents drop out, running ones stay', () => {
  assert.equal(buildLeadTree({ team: team([]), now, lookup }), null);
  const old = agent('old', 'completed', { updatedAt: now - SUBAGENT_RECENT_MS - 1 });
  assert.equal(buildLeadTree({ agents: [old], now, lookup }), null);
  const tree = buildLeadTree({ agents: [old, agent('live', 'running', { updatedAt: now - SUBAGENT_RECENT_MS * 3 })], now, lookup });
  assert.deepEqual(tree.children.map(c => c.id), ['live']);
  assert.equal(tree.limit, null);
  assert.equal(limitText(tree), '1 running');
});

test('sub-workers of a worker are not direct children of the lead', () => {
  const tree = buildLeadTree({ team: team([worker('a', 'running'), worker('inner', 'running', { parentWorker: 'a' })]), now, lookup });
  assert.deepEqual(tree.children.map(c => c.id), ['a']);
});

test('context shows a percentage only when the window is known, and a missing fact is left out of the tip', () => {
  assert.equal(contextPercent({ usedTokens: 50_000, contextWindow: 200_000 }), 25);
  assert.equal(contextPercent({ usedTokens: 50_000, contextWindow: null }), null);
  assert.equal(contextText({ usedTokens: 50_000, contextWindow: 200_000 }), '25% (50k of 200k)');
  assert.equal(contextText({ usedTokens: 900, contextWindow: null }), '900 tokens');
  assert.equal(contextText(null), null);
  const duration = ms => `${Math.round(ms / 60_000)}m`;
  const tree = buildLeadTree({ team: team([worker('run', 'running', { startedAt: now - 180_000 })]), agents: [agent('s', 'running')], now, lookup });
  const [w, s] = tree.children;
  assert.equal(childTip(w, now, duration), ['run (worker)', 'Working for 3m', 'Model: SONNET · high', 'Context: 25% (50k of 200k)', 'Now: Do run'].join('\n'));
  assert.equal(childTip(s, now, duration), ['s (subagent)', 'Working for 1m', 'Now: Look at the index'].join('\n'));
  assert.match(leadTip('Lead', tree, { model: 'Opus', context: null }), /^Lead\nLeader: 0 of 2 done\n2 running\n2 running at once \(limit 2\)\nModel: Opus$/);
});
