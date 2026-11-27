import './context-control.css';
import { escape } from './dom';
import { hidePopover, showPopover } from './popover-motion';
import { tokenCount } from './model-catalog';
import { cacheState, cacheTtl, contextPercent, formatCountdown, needsTimer, pillText, recommend } from './context-status';
import { errorText } from './error-text';
import type { ContextUsage } from './types';

/* The composer's Context control: a pill with the window in use and the cache state, and a popover
   with the counts, a recommendation and a button that hands the thread to a new chat. */

export type ContextStats = { handoffs: number; compactions: number; lastMessageId: number | null };
export type ContextSnapshot = { usage: ContextUsage | null; lastResponseAt: number | null; running: boolean; provider: string; lead: boolean; remote: boolean };
export type ContextControlHost = {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  notifyError(text: string): void;
  /** The open thread's readings; null for any other thread. */
  snapshot(sessionId: string): ContextSnapshot | null;
  /** Fork the thread at its newest message into a new task that carries its recent messages. */
  handoff(sessionId: string, messageId: number): Promise<void>;
};

const PILL = '.composer-context-pill';
const LEAD_TIP = 'A team lead hands off by itself.';

export function createContextControl(host: ContextControlHost) {
  let panel: HTMLElement | undefined, panelSession = '', cleanup: (() => void) | undefined;
  let stats: ContextStats | null | undefined;
  let statsToken = 0;
  let handingOff = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** The cache tier the stream last reported, and the last time the thread's stream showed any sign of life. */
  const reportedTtl = new Map<string, number>();
  const lastActivity = new Map<string, number>();

  function view(sessionId: string) {
    const snap = host.snapshot(sessionId);
    const ttl = snap ? cacheTtl(snap.provider, reportedTtl.get(sessionId)) : null;
    const last = Math.max(snap?.lastResponseAt ?? 0, lastActivity.get(sessionId) ?? 0) || null;
    const cache = snap && ttl ? cacheState({ lastResponseAt: last, running: snap.running, now: Date.now(), ttl }) : null;
    const text = pillText(snap?.usage, cache), advice = recommend(snap?.usage, cache);
    const percent = contextPercent(snap?.usage);
    const mark = cache?.estimated ? '~' : '';
    // Screen readers hear whole minutes, so the label changes once a minute, not every second.
    const minutes = cache ? Math.ceil(cache.remainingMs / 60000) : 0;
    const cacheWords = !cache ? '' : cache.state === 'cold' ? `, ${mark}cache cold` : cache.live ? `, ${mark}cache warm, in use` : `, ${mark}cache warm, ${mark}${minutes} minute${minutes === 1 ? '' : 's'} left`;
    const reading = percent === null ? (snap?.usage ? `${tokenCount(snap.usage.usedTokens)} tokens used` : 'not reported yet') : `${percent}% used`;
    return { snap, cache, text, advice, percent, label: `Context: ${reading}${cacheWords}` };
  }

  function button(sessionId: string): string {
    const { text, advice, percent, label, cache } = view(sessionId);
    queueMicrotask(schedule);
    const cacheMarkup = cache ? `<span class="ctx-sep" aria-hidden="true">·</span><span class="ctx-dot" aria-hidden="true"></span><span class="ctx-cache">${escape(text.cache)}</span>` : '';
    return `<button type="button" class="composer-context-pill" data-action="context-control" data-tone="${advice.action === 'handoff' ? 'warn' : 'ok'}" data-cache="${cache?.state ?? 'none'}" aria-haspopup="dialog" aria-expanded="${panel && panelSession === sessionId ? 'true' : 'false'}" aria-label="${escape(label)}" ${panel && panelSession === sessionId ? '' : `data-tip="${escape(label)}"`}><span class="ds-meter ctx-meter" style="--ds-value:${percent ?? 0}%" aria-hidden="true"><span></span></span><span class="ctx-percent">${escape(text.percent)}</span>${cacheMarkup}</button>`;
  }

  function set(element: Element | null, value: string): void {
    if (element && element.textContent !== value) element.textContent = value;
  }
  function attr(element: Element | null, name: string, value: string): void {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  const openSession = () => document.querySelector<HTMLTextAreaElement>('#prompt')?.dataset.sessionId ?? '';

  /** The clock runs only while a pill is counting a warm cache down on a visible page. */
  function schedule(): void {
    const sessionId = document.querySelector(PILL) ? openSession() : '';
    const need = Boolean(sessionId) && needsTimer(view(sessionId).cache, document.hidden);
    if (need && timer === undefined) timer = setInterval(refresh, 1000);
    else if (!need && timer !== undefined) { clearInterval(timer); timer = undefined; }
  }

  /** Update the pill and an open popover in place: nothing moves, nothing is redrawn. */
  function refresh(): void {
    const pill = document.querySelector<HTMLElement>(PILL);
    const sessionId = pill ? openSession() : '';
    if (pill && sessionId) {
      const { text, advice, percent, label, cache } = view(sessionId);
      set(pill.querySelector('.ctx-percent'), text.percent);
      set(pill.querySelector('.ctx-cache'), text.cache);
      attr(pill, 'data-cache', cache?.state ?? 'none');
      attr(pill.querySelector('.ctx-meter'), 'style', `--ds-value:${percent ?? 0}%`);
      attr(pill, 'data-tone', advice.action === 'handoff' ? 'warn' : 'ok');
      attr(pill, 'aria-label', label);
      // The tip would sit on top of the open popover; the label already says the same.
      if (pill.getAttribute('aria-expanded') === 'true') pill.removeAttribute('data-tip'); else attr(pill, 'data-tip', label);
    }
    if (panel) render(panelSession);
    schedule();
  }

  function render(sessionId: string): void {
    if (!panel) return;
    const { snap, cache, advice, percent } = view(sessionId);
    const usage = snap?.usage, lead = Boolean(snap?.lead);
    const used = usage
      ? `${tokenCount(usage.usedTokens)}${usage.contextWindow ? ` / ${tokenCount(usage.contextWindow)}` : ''} tokens${percent === null ? '' : ` (${percent}%)`}`
      : 'Not reported yet';
    const mark = cache?.estimated ? '~' : '';
    const cacheLine = !cache ? 'Not tracked for this harness' : cache.state === 'cold' ? `${mark}Cold` : cache.live ? `${mark}Warm, a turn is running` : `${mark}Warm, ${formatCountdown(cache.remainingMs)} left`;
    const note = !cache ? 'Only Claude Code reports how its prompt cache is used.' : cache.estimated ? 'Cache lifetime guessed at 5 minutes: the harness has not said which tier it used, so a longer one can keep it warm longer.' : 'Cache lifetime reported by the harness.';
    const count = (value: number | undefined) => (stats === undefined ? '…' : stats === null ? 'Unavailable' : String(value));
    const busy = Boolean(snap?.running), remote = Boolean(snap?.remote);
    const canHand = Boolean(stats?.lastMessageId) && !handingOff && !lead && !busy && !remote;
    const set = (selector: string, value: string) => { const el = panel!.querySelector(selector); if (el && el.textContent !== value) el.textContent = value; };
    if (!panel.querySelector('.ctx-rows')) {
      panel.innerHTML = `<header class="ctx-head"><div class="ctx-title" id="ctx-title">Context</div></header>
        <dl class="ctx-rows">
          <dt>Used</dt><dd data-ctx="used"></dd>
          <dt>Handoffs</dt><dd data-ctx="handoffs"></dd>
          <dt>Compactions</dt><dd data-ctx="compactions"></dd>
          <dt>Prompt cache</dt><dd data-ctx="cache"></dd>
        </dl>
        <div class="ds-meter ctx-bar" aria-hidden="true"><span></span></div>
        <p class="ctx-note" data-ctx="note"></p>
        <p class="ctx-advice" role="status" data-ctx="advice"></p>
        <button type="button" class="ds-btn ctx-handoff" data-handoff>Hand off to new chat</button>`;
    }
    set('[data-ctx="used"]', used);
    set('[data-ctx="handoffs"]', count(stats?.handoffs));
    set('[data-ctx="compactions"]', count(stats?.compactions));
    set('[data-ctx="cache"]', cacheLine);
    set('[data-ctx="note"]', note);
    const advise = panel.querySelector<HTMLElement>('[data-ctx="advice"]')!;
    set('[data-ctx="advice"]', lead ? advice.reason : `${advice.action === 'handoff' ? 'Better open a new chat with the recent messages. ' : 'Continue here. '}${advice.reason}`);
    advise.dataset.action = advice.action;
    panel.querySelector<HTMLElement>('.ctx-bar')!.style.setProperty('--ds-value', `${percent ?? 0}%`);
    const handoff = panel.querySelector<HTMLButtonElement>('.ctx-handoff')!;
    handoff.classList.toggle('ds-btn-primary', advice.action === 'handoff' && canHand);
    handoff.setAttribute('aria-disabled', canHand ? 'false' : 'true');
    handoff.title = lead ? LEAD_TIP : remote ? 'This task runs on another computer; hand it off there.' : busy ? 'Wait for the turn to finish.' : canHand ? 'Opens a new task in this project that starts with the recent messages of this one; this one stays as it is.' : stats === undefined ? 'Loading…' : 'Nothing to hand off yet.';
  }

  function place(anchor: HTMLElement): void {
    if (!panel) return;
    const rect = anchor.getBoundingClientRect(), width = Math.min(300, window.innerWidth - 24);
    panel.style.width = `${width}px`;
    panel.style.left = `${Math.max(12, Math.min(window.innerWidth - width - 12, rect.left))}px`;
    panel.style.bottom = `${Math.max(12, window.innerHeight - rect.top + 10)}px`;
    panel.dataset.placement = 'above';
  }

  function close(): void {
    if (!panel) return;
    const closing = panel;
    panel = undefined; panelSession = ''; cleanup?.(); cleanup = undefined; stats = undefined; statsToken++;
    hidePopover(closing);
    document.querySelector(PILL)?.setAttribute('aria-expanded', 'false');
    refresh();
  }

  function open(anchor: HTMLElement, sessionId: string): void {
    if (panel && panelSession === sessionId) { close(); return; }
    close();
    panel = document.createElement('div');
    panel.className = 'floating-menu ctx-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'ctx-title');
    panelSession = sessionId;
    document.body.append(panel);
    render(sessionId); place(anchor); showPopover(panel, anchor);
    anchor.setAttribute('aria-expanded', 'true'); anchor.removeAttribute('data-tip');
    panel.querySelector<HTMLElement>('.ctx-handoff')?.focus({ preventScroll: true });
    const token = ++statsToken;
    host.call<ContextStats>('task_context_stats', { sessionId }).then(value => { if (token === statsToken) { stats = value; render(sessionId); } })
      .catch(() => { if (token === statsToken) { stats = null; render(sessionId); } });

    const onClick = async (event: MouseEvent) => {
      const target = (event.target as Element).closest<HTMLElement>('[data-handoff]');
      if (!target || target.getAttribute('aria-disabled') !== 'false' || !stats?.lastMessageId) return;
      const messageId = stats.lastMessageId;
      handingOff = true;
      close();
      try { await host.handoff(sessionId, messageId); } catch (error) { host.notifyError(errorText(error)); } finally { handingOff = false; }
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); anchor.isConnected && anchor.focus(); } };
    const onOutside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panel && !panel.contains(target) && !target.closest('[data-action="context-control"]')) close();
    };
    panel.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onOutside, true);
    cleanup = () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onOutside, true); };
    refresh();
  }

  // A hidden page stops counting; coming back shows the right time at once.
  document.addEventListener('visibilitychange', () => { if (document.hidden) schedule(); else refresh(); });

  return {
    button, open, close, refresh,
    /** A sign of life in the thread's stream (text, thinking, a tool, a usage reading): the cache was just used. */
    activity(sessionId: string): void { lastActivity.set(sessionId, Date.now()); },
    /** The cache tier the stream reported for this thread. */
    reportTtl(sessionId: string, ms: number): void { reportedTtl.set(sessionId, ms); },
  };
}
