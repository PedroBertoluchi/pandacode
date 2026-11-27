import type { ContextUsage } from './types';

/* Pure rules behind the composer's Context control: how full the window is, whether the provider's
   prompt cache is still warm, and whether to keep going here or hand the work to a new chat. */

/** Anthropic's prompt cache lasts 5 minutes from its last use unless the harness asks for the 1 hour tier. */
export const CACHE_TTL_MS = 5 * 60_000;
/** At or above this share of the window the thread should move on. */
export const HANDOFF_AT = 0.7;
/** With a cold cache, the whole context is paid for again at the next message, so the bar is lower. */
export const COLD_HANDOFF_AT = 0.5;
/** Only Claude Code's caching is known; every other harness shows the window alone. */
const CACHE_PROVIDERS = new Set(['claude']);

export interface CacheTtl {
  ttlMs: number;
  /** The harness did not say which tier it used, so the default is a guess. */
  estimated: boolean;
}

export interface CacheState {
  state: 'warm' | 'cold';
  /** Time left before the cache expires; the full lifetime while a turn is running. */
  remainingMs: number;
  /** A turn is running, so the cache is being refreshed right now. */
  live: boolean;
  estimated: boolean;
}

export interface Recommendation {
  action: 'continue' | 'handoff';
  reason: string;
}

/** The cache lifetime for a harness, or null when it is not known for that harness. `reportedMs` is the tier the stream reported. */
export function cacheTtl(provider: string | null | undefined, reportedMs?: number | null): CacheTtl | null {
  if (!provider || !CACHE_PROVIDERS.has(provider)) return null;
  return reportedMs && reportedMs > 0 ? { ttlMs: reportedMs, estimated: false } : { ttlMs: CACHE_TTL_MS, estimated: true };
}

export function cacheState({ lastResponseAt, running, now, ttl }: { lastResponseAt?: number | null; running: boolean; now: number; ttl: CacheTtl }): CacheState {
  const { ttlMs, estimated } = ttl;
  if (running) return { state: 'warm', remainingMs: ttlMs, live: true, estimated };
  const remainingMs = lastResponseAt == null ? 0 : lastResponseAt + ttlMs - now;
  return remainingMs > 0 ? { state: 'warm', remainingMs: Math.min(remainingMs, ttlMs), live: false, estimated } : { state: 'cold', remainingMs: 0, live: false, estimated };
}

/** Whether anything on screen changes with the clock: only a warm cache that is not being refreshed counts down. */
export function needsTimer(cache: CacheState | null, hidden: boolean): boolean {
  return Boolean(cache) && cache!.state === 'warm' && !cache!.live && !hidden;
}

/** Whole percent of the window in use, or null when the harness reported no window. */
export function contextPercent(usage?: ContextUsage | null): number | null {
  if (!usage?.contextWindow) return null;
  return Math.min(100, Math.round(usage.usedTokens / usage.contextWindow * 100));
}

/** Minutes and seconds, such as 3:05. */
export function formatCountdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function recommend(usage: ContextUsage | null | undefined, cache: CacheState | null): Recommendation {
  const percent = contextPercent(usage);
  if (percent === null) return { action: 'continue', reason: usage ? 'The harness reported no context window, so there is nothing to compare against.' : 'No context reading yet. Keep going here.' };
  if (percent >= HANDOFF_AT * 100) return { action: 'handoff', reason: `Context is ${percent}% full: a new chat with the recent messages keeps replies fast and cheap.` };
  if (!cache) return { action: 'continue', reason: `Context has room (${percent}%).` };
  const cold = cache.estimated ? 'probably cold' : 'cold';
  if (cache.state === 'cold' && percent >= COLD_HANDOFF_AT * 100) return { action: 'handoff', reason: `The cache is ${cold} and context is ${percent}% full: the next message would pay for all of it again.` };
  if (cache.state === 'cold') return { action: 'continue', reason: `The cache is ${cold}, but only ${percent}% of the context is used, so a restart would save little.` };
  return { action: 'continue', reason: `Context has room (${percent}%) and the cache is warm.` };
}

/** The pill's short text: "62% · ~cache warm 3:12", "62% · ~cache cold", or "?%" before any reading. A leading ~ marks a guessed lifetime; harnesses without a known cache have no cache text. */
export function pillText(usage: ContextUsage | null | undefined, cache: CacheState | null): { percent: string; cache: string } {
  const percent = contextPercent(usage);
  const mark = cache?.estimated ? '~' : '';
  return {
    percent: percent === null ? '?%' : `${percent}%`,
    cache: !cache ? '' : cache.state === 'cold' ? `${mark}cache cold` : cache.live ? `${mark}cache warm` : `${mark}cache warm ${formatCountdown(cache.remainingMs)}`,
  };
}
