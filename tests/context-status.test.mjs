import test from 'node:test';
import assert from 'node:assert/strict';

const { CACHE_TTL_MS, cacheState, cacheTtl, contextPercent, formatCountdown, needsTimer, pillText, recommend } = await import('../src/context-status.ts');
const NOW = 1_000_000_000;
const usage = percent => ({ usedTokens: percent * 2000, contextWindow: 200000 });
const guess = cacheTtl('claude');
const warm = cacheState({ lastResponseAt: NOW - 1000, running: false, now: NOW, ttl: guess });
const cold = cacheState({ lastResponseAt: NOW - CACHE_TTL_MS - 1, running: false, now: NOW, ttl: guess });

test('only Claude has a known cache, and a reported tier is not a guess', () => {
  assert.deepEqual(cacheTtl('claude'), { ttlMs: CACHE_TTL_MS, estimated: true });
  assert.deepEqual(cacheTtl('claude', 3_600_000), { ttlMs: 3_600_000, estimated: false });
  assert.deepEqual(cacheTtl('claude', 300_000), { ttlMs: 300_000, estimated: false });
  for (const provider of ['codex', 'glm', 'mimo', 'opencode', '', null, undefined]) assert.equal(cacheTtl(provider, 300_000), null, String(provider));
});

test('the cache is warm for its lifetime after the last activity, then cold', () => {
  const at = ago => cacheState({ lastResponseAt: NOW - ago, running: false, now: NOW, ttl: guess });
  assert.deepEqual(at(108_000), { state: 'warm', remainingMs: 192_000, live: false, estimated: true });
  assert.equal(at(CACHE_TTL_MS).state, 'cold');
  assert.equal(at(CACHE_TTL_MS - 1).state, 'warm');
  assert.equal(cacheState({ lastResponseAt: null, running: false, now: NOW, ttl: guess }).state, 'cold');
  assert.equal(cacheState({ lastResponseAt: NOW + 5000, running: false, now: NOW, ttl: guess }).remainingMs, CACHE_TTL_MS, 'clock skew never shows more than the lifetime');
  assert.equal(cacheState({ lastResponseAt: NOW - 600_000, running: false, now: NOW, ttl: cacheTtl('claude', 3_600_000) }).state, 'warm', 'the 1 hour tier outlasts 5 minutes');
});

test('a running turn keeps the cache warm', () => {
  assert.deepEqual(cacheState({ lastResponseAt: 0, running: true, now: NOW, ttl: guess }), { state: 'warm', remainingMs: CACHE_TTL_MS, live: true, estimated: true });
});

test('the clock only ticks for a warm cache that is not being refreshed, and not while hidden', () => {
  assert.equal(needsTimer(warm, false), true);
  assert.equal(needsTimer(warm, true), false);
  assert.equal(needsTimer(cold, false), false);
  assert.equal(needsTimer(cacheState({ running: true, now: NOW, ttl: guess }), false), false);
  assert.equal(needsTimer(null, false), false);
});

test('percent and countdown formatting, with ~ on a guessed lifetime and no cache text without one', () => {
  assert.equal(contextPercent(usage(62)), 62);
  assert.equal(contextPercent({ usedTokens: 500, contextWindow: 100 }), 100);
  assert.equal(contextPercent({ usedTokens: 500, contextWindow: null }), null);
  assert.equal(formatCountdown(192_000), '3:12');
  assert.equal(formatCountdown(59_001), '1:00');
  assert.equal(formatCountdown(-5), '0:00');
  assert.deepEqual(pillText(usage(62), cacheState({ lastResponseAt: NOW - 108_000, running: false, now: NOW, ttl: guess })), { percent: '62%', cache: '~cache warm 3:12' });
  assert.deepEqual(pillText(usage(62), cacheState({ lastResponseAt: NOW - 108_000, running: false, now: NOW, ttl: cacheTtl('claude', 300_000) })), { percent: '62%', cache: 'cache warm 3:12' });
  assert.deepEqual(pillText(usage(62), cold), { percent: '62%', cache: '~cache cold' });
  assert.deepEqual(pillText(null, cold), { percent: '?%', cache: '~cache cold' });
  assert.deepEqual(pillText(usage(62), null), { percent: '62%', cache: '' });
  assert.equal(pillText(usage(10), cacheState({ running: true, now: NOW, ttl: guess })).cache, '~cache warm');
});

test('a new chat is recommended above 70%, or above 50% once the cache is cold', () => {
  assert.equal(recommend(usage(69), warm).action, 'continue');
  assert.equal(recommend(usage(70), warm).action, 'handoff');
  assert.match(recommend(usage(85), warm).reason, /85% full/);
  assert.equal(recommend(usage(49), cold).action, 'continue');
  assert.match(recommend(usage(49), cold).reason, /probably cold/);
  assert.equal(recommend(usage(50), cold).action, 'handoff');
  assert.match(recommend(usage(60), cold).reason, /cache is probably cold and context is 60%/);
  assert.match(recommend(usage(60), cacheState({ lastResponseAt: 0, running: false, now: NOW, ttl: cacheTtl('claude', 300_000) })).reason, /cache is cold and context is 60%/);
  assert.equal(recommend(usage(60), warm).action, 'continue', 'a warm cache at 60% keeps going');
  assert.equal(recommend(usage(60), null).action, 'continue', 'no known cache: only the window counts');
  assert.equal(recommend(usage(75), null).action, 'handoff');
  assert.equal(recommend(null, cold).action, 'continue');
  assert.equal(recommend({ usedTokens: 5, contextWindow: null }, cold).action, 'continue');
  assert.doesNotMatch(recommend(usage(75), warm).reason, /summary/, 'the new chat gets the recent messages, not a summary');
});
