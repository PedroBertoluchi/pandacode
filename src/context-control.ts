import './context-control.css';
import { escape } from './dom';
import { hidePopover, showPopover } from './popover-motion';
import { tokenCount } from './model-catalog';
import { CACHE_TTL_MS, cacheState, contextPercent, formatCountdown, pillText, recommend } from './context-status';
import { errorText } from './error-text';
import type { ContextUsage } from './types';

/* The composer's Context control: a pill with the window in use and the cache state, and a popover
   with the counts, a recommendation and a button that hands the thread to a new chat. */

export type ContextStats = { handoffs: number; compactions: number; lastMessageId: number | null };
export type ContextSnapshot = { usage: ContextUsage | null; lastResponseAt: number | null; running: boolean };
export type ContextControlHost = {
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  notifyError(text: string): void;
  /** The open thread's readings; null for any other thread. */
  snapshot(sessionId: string): ContextSnapshot | null;
  /** Fork the thread at its newest message into a new task that carries the conversation. */
  handoff(sessionId: string, messageId: number): Promise<void>;
};

const PILL = '.composer-context-pill';

export function createContextControl(host: ContextControlHost) {
  let panel: HTMLElement | undefined, panelSession = '', cleanup: (() => void) | undefined;
  let stats: ContextStats | null | undefined;
  let statsToken = 0;
  let handingOff = false;

  function view(sessionId: string) {
    const snap = host.snapshot(sessionId);
    const cache = cacheState({ lastResponseAt: snap?.lastResponseAt, running: snap?.running ?? false, now: Date.now() });
    const text = pillText(snap?.usage, cache), advice = recommend(snap?.usage, cache);
    const percent = contextPercent(snap?.usage);
    // Screen readers hear whole minutes, so the label does not change every second.
    const minutes = Math.ceil(cache.remainingMs / 60000);
    const cacheWords = cache.state === 'cold' ? 'cache cold' : cache.live ? 'cache warm, in use' : `cache warm, about ${minutes} minute${minutes === 1 ? '' : 's'} left`;
    const label = `Context: ${percent === null ? (snap?.usage ? `${tokenCount(snap.usage.usedTokens)} tokens used` : 'not reported yet') : `${percent}% used`}, ${cacheWords}`;
    return { snap, cache, text, advice, percent, label };
  }

  function button(sessionId: string): string {
    const { text, advice, percent, label, cache } = view(sessionId);
    return `<button type="button" class="composer-context-pill" data-action="context-control" data-tone="${advice.action === 'handoff' ? 'warn' : 'ok'}" data-cache="${cache.state}" aria-haspopup="dialog" aria-expanded="${panel && panelSession === sessionId ? 'true' : 'false'}" aria-label="${escape(label)}" data-tip="${escape(label)}"><span class="ds-meter ctx-meter" style="--ds-value:${percent ?? 0}%" aria-hidden="true"><span></span></span><span class="ctx-percent">${escape(text.percent)}</span><span class="ctx-sep" aria-hidden="true">·</span><span class="ctx-dot" aria-hidden="true"></span><span class="ctx-cache">${escape(text.cache)}</span></button>`;
  }

  function set(element: Element | null, value: string): void {
    if (element && element.textContent !== value) element.textContent = value;
  }
  function attr(element: Element | null, name: string, value: string): void {
    if (element && element.getAttribute(name) !== value) element.setAttribute(name, value);
  }

  /** Update the pill and an open popover in place: nothing moves, nothing is redrawn. */
  function refresh(): void {
    const pill = document.querySelector<HTMLElement>(PILL);
    const sessionId = pill ? (document.querySelector<HTMLTextAreaElement>('#prompt')?.dataset.sessionId ?? '') : '';
    if (pill && sessionId) {
      const { text, advice, percent, label, cache } = view(sessionId);
      set(pill.querySelector('.ctx-percent'), text.percent);
      set(pill.querySelector('.ctx-cache'), text.cache);
      attr(pill, 'data-cache', cache.state);
      attr(pill.querySelector('.ctx-meter'), 'style', `--ds-value:${percent ?? 0}%`);
      attr(pill, 'data-tone', advice.action === 'handoff' ? 'warn' : 'ok');
      attr(pill, 'aria-label', label);
      // The tip would sit on top of the open popover; the label already says the same.
      if (pill.getAttribute('aria-expanded') === 'true') pill.removeAttribute('data-tip'); else attr(pill, 'data-tip', label);
    }
    if (panel) render(panelSession);
  }

  function render(sessionId: string): void {
    if (!panel) return;
    const { snap, cache, advice, percent } = view(sessionId);
    const usage = snap?.usage;
    const used = usage
      ? `${tokenCount(usage.usedTokens)}${usage.contextWindow ? ` / ${tokenCount(usage.contextWindow)}` : ''} tokens${percent === null ? '' : ` (${percent}%)`}`
      : 'Not reported yet';
    const cacheLine = cache.state === 'cold' ? 'Cold' : cache.live ? 'Warm, a turn is running' : `Warm, ${formatCountdown(cache.remainingMs)} left`;
    const count = (value: number | undefined) => (stats === undefined ? '…' : stats === null ? 'Unavailable' : String(value));
    const canHand = Boolean(stats?.lastMessageId) && !handingOff;
    const set = (selector: string, value: string) => { const el = panel!.querySelector(selector); if (el && el.textContent !== value) el.textContent = value; };
    if (!panel.querySelector('.ctx-rows')) {
      panel.innerHTML = `<header class="ctx-head"><strong id="ctx-title">Context</strong></header>
        <dl class="ctx-rows">
          <dt>Used</dt><dd data-ctx="used"></dd>
          <dt>Handoffs</dt><dd data-ctx="handoffs"></dd>
          <dt>Compactions</dt><dd data-ctx="compactions"></dd>
          <dt>Prompt cache</dt><dd data-ctx="cache"></dd>
        </dl>
        <div class="ds-meter ctx-bar" aria-hidden="true"><span></span></div>
        <p class="ctx-note">Cache lifetime assumed to be ${CACHE_TTL_MS / 60000} minutes: the harness does not report it, so a longer one can keep it warm longer.</p>
        <p class="ctx-advice" role="status" data-ctx="advice"></p>
        <button type="button" class="ds-btn ctx-handoff" data-handoff>Hand off to new chat</button>`;
    }
    set('[data-ctx="used"]', used);
    set('[data-ctx="handoffs"]', count(stats?.handoffs));
    set('[data-ctx="compactions"]', count(stats?.compactions));
    set('[data-ctx="cache"]', cacheLine);
    const advise = panel.querySelector<HTMLElement>('[data-ctx="advice"]')!;
    set('[data-ctx="advice"]', `${advice.action === 'handoff' ? 'Better open a new chat with a summary. ' : 'Continue here. '}${advice.reason}`);
    advise.dataset.action = advice.action;
    panel.querySelector<HTMLElement>('.ctx-bar')!.style.setProperty('--ds-value', `${percent ?? 0}%`);
    const handoff = panel.querySelector<HTMLButtonElement>('.ctx-handoff')!;
    handoff.classList.toggle('ds-btn-primary', advice.action === 'handoff');
    handoff.toggleAttribute('aria-disabled', !canHand);
    handoff.title = canHand ? 'Opens a new task in this project that carries this conversation; this one stays as it is.' : stats === undefined ? 'Loading…' : 'Nothing to hand off yet.';
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
      if (!target || target.getAttribute('aria-disabled') === 'true' || !stats?.lastMessageId) return;
      const messageId = stats.lastMessageId;
      handingOff = true; render(sessionId);
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
  }

  // The countdown needs a tick, and the readings arrive from the stream; both only touch text that changed.
  setInterval(() => { if (document.querySelector(PILL)) refresh(); }, 1000);

  return { button, open, close, refresh };
}
