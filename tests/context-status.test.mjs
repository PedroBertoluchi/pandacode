import test from 'node:test';
import assert from 'node:assert/strict';

const { CACHE_TTL_MS, cacheState, contextPercent, formatCountdown, pillText, recommend } = await import('../src/context-status.ts');
const NOW = 1_000_000_000;
const usage = percent => ({ usedTokens: percent * 2000, contextWindow: 200000 });
const warm = cacheState({ lastResponseAt: NOW - 1000, running: false, now: NOW });
const cold = cacheState({ lastResponseAt: NOW - CACHE_TTL_MS - 1, running: false, now: NOW });

test('the cache is warm for five minutes after the last response, then cold', () => {
  assert.deepEqual(cacheState({ lastResponseAt: NOW - 108_000, running: false, now: NOW }), { state: 'warm', remainingMs: 192_000, live: false });
  assert.equal(cacheState({ lastResponseAt: NOW - CACHE_TTL_MS, running: false, now: NOW }).state, 'cold');
  assert.equal(cacheState({ lastResponseAt: NOW - CACHE_TTL_MS + 1, running: false, now: NOW }).state, 'warm');
  assert.equal(cacheState({ lastResponseAt: null, running: false, now: NOW }).state, 'cold');
  assert.equal(cacheState({ lastResponseAt: NOW + 5000, running: false, now: NOW }).remainingMs, CACHE_TTL_MS, 'a clock skew never shows more than the lifetime');
});

test('a running turn keeps the cache warm and the lifetime is configurable', () => {
  assert.deepEqual(cacheState({ lastResponseAt: 0, running: true, now: NOW }), { state: 'warm', remainingMs: CACHE_TTL_MS, live: true });
  assert.equal(cacheState({ lastResponseAt: NOW - 600_000, running: false, now: NOW, ttlMs: 3_600_000 }).state, 'warm');
});

test('percent and countdown formatting', () => {
  assert.equal(contextPercent(usage(62)), 62);
  assert.equal(contextPercent({ usedTokens: 500, contextWindow: 100 }), 100);
  assert.equal(contextPercent({ usedTokens: 500, contextWindow: null }), null);
  assert.equal(contextPercent(null), null);
  assert.equal(formatCountdown(192_000), '3:12');
  assert.equal(formatCountdown(59_001), '1:00');
  assert.equal(formatCountdown(-5), '0:00');
  assert.deepEqual(pillText(usage(62), cacheState({ lastResponseAt: NOW - 108_000, running: false, now: NOW })), { percent: '62%', cache: 'cache warm 3:12' });
  assert.deepEqual(pillText(usage(62), cold), { percent: '62%', cache: 'cache cold' });
  assert.deepEqual(pillText(null, cold), { percent: 'Context', cache: 'cache cold' });
  assert.equal(pillText(usage(10), cacheState({ running: true, now: NOW })).cache, 'cache warm');
});

test('a new chat is recommended above 70%, or above 50% once the cache is cold', () => {
  assert.equal(recommend(usage(69), warm).action, 'continue');
  assert.equal(recommend(usage(70), warm).action, 'handoff');
  assert.match(recommend(usage(85), warm).reason, /85% full/);
  assert.equal(recommend(usage(49), cold).action, 'continue');
  assert.match(recommend(usage(49), cold).reason, /cold/);
  assert.equal(recommend(usage(50), cold).action, 'handoff');
  assert.match(recommend(usage(60), cold).reason, /cache is cold and context is 60%/);
  assert.equal(recommend(usage(60), warm).action, 'continue', 'a warm cache at 60% keeps going');
  assert.equal(recommend(null, cold).action, 'continue');
  assert.equal(recommend({ usedTokens: 5, contextWindow: null }, cold).action, 'continue');
});
