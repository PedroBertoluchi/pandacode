import type { ContextUsage } from './types';

/* Pure rules behind the composer's Context control: how full the window is, whether the provider's
   prompt cache is still warm, and whether to keep going here or hand the work to a new chat. */

/** Anthropic's prompt cache lasts 5 minutes from its last use unless the harness asks for the 1 hour tier;
    the stream does not say which one a harness used, so the control assumes the default and says so. */
export const CACHE_TTL_MS = 5 * 60_000;
/** At or above this share of the window the thread should move on. */
export const HANDOFF_AT = 0.7;
/** With a cold cache, the whole context is paid for again at the next message, so the bar is lower. */
export const COLD_HANDOFF_AT = 0.5;

export interface CacheState {
  state: 'warm' | 'cold';
  /** Time left before the cache expires; the full lifetime while a turn is running. */
  remainingMs: number;
  /** A turn is running, so the cache is being refreshed right now. */
  live: boolean;
}

export interface Recommendation {
  action: 'continue' | 'handoff';
  reason: string;
}

export function cacheState({ lastResponseAt, running, now, ttlMs = CACHE_TTL_MS }: { lastResponseAt?: number | null; running: boolean; now: number; ttlMs?: number }): CacheState {
  if (running) return { state: 'warm', remainingMs: ttlMs, live: true };
  const remainingMs = lastResponseAt == null ? 0 : lastResponseAt + ttlMs - now;
  return remainingMs > 0 ? { state: 'warm', remainingMs: Math.min(remainingMs, ttlMs), live: false } : { state: 'cold', remainingMs: 0, live: false };
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

export function recommend(usage: ContextUsage | null | undefined, cache: CacheState): Recommendation {
  const percent = contextPercent(usage);
  if (percent === null) return { action: 'continue', reason: usage ? 'The harness reported no context window, so there is nothing to compare against.' : 'No context reading yet. Keep going here.' };
  if (percent >= HANDOFF_AT * 100) return { action: 'handoff', reason: `Context is ${percent}% full: a new chat with a summary keeps replies fast and cheap.` };
  if (cache.state === 'cold' && percent >= COLD_HANDOFF_AT * 100) return { action: 'handoff', reason: `The cache is cold and context is ${percent}% full: the next message would pay for all of it again.` };
  if (cache.state === 'cold') return { action: 'continue', reason: `The cache is cold, but only ${percent}% of the context is used, so a restart would save little.` };
  return { action: 'continue', reason: `Context has room (${percent}%) and the cache is warm.` };
}

/** The pill's short text: "62% · cache warm 3:12", "62% · cache cold", or just "Context" before any reading. */
export function pillText(usage: ContextUsage | null | undefined, cache: CacheState): { percent: string; cache: string } {
  const percent = contextPercent(usage);
  return {
    percent: percent === null ? 'Context' : `${percent}%`,
    cache: cache.state === 'cold' ? 'cache cold' : cache.live ? 'cache warm' : `cache warm ${formatCountdown(cache.remainingMs)}`,
  };
}
