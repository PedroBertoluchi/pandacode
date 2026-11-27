import './schedules-panel.css';
import { subscribe } from './bridge';
import { escape, icon } from './dom';
import { trackSegment } from './motion';
import { hidePopover, showPopover } from './popover-motion';
import { cadence, isFinished, schedulesApi, SCHEDULES_CHANGED, type TaskSchedule, type WindowsSchedules, type WindowsTask } from './schedules-api';
import { lastResult, localTime, panelOrder, upcoming, windowsFailed, windowsTabVisible, windowsTone, type LastResult } from './schedules-panel-model';

export interface SchedulesPanelOptions {
  openThread(sessionId: string): void;
  openSettings(): void;
}

type Tab = 'pandacode' | 'windows';

const HOVER_DELAY_MS = 180;
const HOVER_GAP = 8;
const HOVER_MARGIN = 10;
const RESULT_LABEL: Record<LastResult, string> = { ok: 'OK', error: 'Error', skipped: 'Skipped', none: 'Not run yet' };
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

async function lastResults(schedules: readonly TaskSchedule[]): Promise<Map<string, LastResult>> {
  const entries = await Promise.all(schedules.map(async schedule => [schedule.id, lastResult((await schedulesApi.runs({ scheduleId: schedule.id, limit: 1 }))[0]?.outcome)] as const));
  return new Map(entries);
}

const resultHtml = (result: LastResult) => `<span class="sp-result" data-result="${result}">${RESULT_LABEL[result]}</span>`;

function hoverRow(schedule: TaskSchedule, result: LastResult): string {
  const project = schedule.projectName ? `<span>${escape(schedule.projectName)}</span>` : '';
  return `<li class="sh-row" data-id="${escape(schedule.id)}"><span class="sh-main"><strong class="sh-name">${escape(schedule.title)}</strong><span class="sh-meta">${project}<span>${escape(cadence(schedule))}</span></span></span><span class="sh-side"><span class="sh-when">${escape(localTime(schedule.nextRunAt!))}</span>${resultHtml(result)}</span></li>`;
}

export function mountSchedulesHover(trigger: HTMLElement): () => void {
  let panel: HTMLElement | undefined, timer = 0, token = 0;
  const id = 'schedules-hover';

  function place(): void {
    if (!panel) return;
    const anchor = trigger.getBoundingClientRect();
    const left = Math.min(anchor.right + HOVER_GAP, innerWidth - panel.offsetWidth - HOVER_MARGIN);
    const top = Math.max(HOVER_MARGIN, Math.min(anchor.top, innerHeight - panel.offsetHeight - HOVER_MARGIN));
    panel.style.left = `${Math.round(Math.max(HOVER_MARGIN, left))}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  async function open(): Promise<void> {
    if (panel) return;
    const mine = ++token;
    let body: string;
    try {
      const shown = upcoming(await schedulesApi.list());
      const results = await lastResults(shown);
      body = shown.length
        ? `<ol class="sh-list">${shown.map(schedule => hoverRow(schedule, results.get(schedule.id) ?? 'none')).join('')}</ol><p class="sh-foot">Click for every schedule</p>`
        : '<p class="sh-empty">Nothing is scheduled to run.</p>';
    } catch (cause) {
      body = `<p class="sh-empty" role="alert">Could not load schedules: ${escape(message(cause))}</p>`;
    }
    if (mine !== token) return;
    panel = document.createElement('div');
    panel.id = id; panel.className = 'schedules-hover'; panel.setAttribute('role', 'tooltip');
    panel.innerHTML = `<h3 class="sh-title">Next schedules</h3>${body}`;
    panel.style.visibility = 'hidden';
    document.body.append(panel);
    place();
    panel.style.visibility = '';
    showPopover(panel, trigger);
    trigger.setAttribute('aria-describedby', id);
  }

  function close(): void {
    clearTimeout(timer); token++;
    if (panel) { hidePopover(panel); panel = undefined; }
    trigger.removeAttribute('aria-describedby');
  }

  const arm = () => { clearTimeout(timer); timer = window.setTimeout(() => void open(), HOVER_DELAY_MS); };
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
  trigger.addEventListener('pointerenter', arm);
  trigger.addEventListener('focus', arm);
  trigger.addEventListener('pointerleave', close);
  trigger.addEventListener('blur', close);
  trigger.addEventListener('click', close);
  trigger.addEventListener('keydown', onKey);
  return () => {
    close();
    trigger.removeEventListener('pointerenter', arm);
    trigger.removeEventListener('focus', arm);
    trigger.removeEventListener('pointerleave', close);
    trigger.removeEventListener('blur', close);
    trigger.removeEventListener('click', close);
    trigger.removeEventListener('keydown', onKey);
  };
}

function pandaRow(schedule: TaskSchedule, result: LastResult): string {
  const spent = isFinished(schedule);
  const next = spent ? 'Done' : !schedule.enabled ? 'Off' : schedule.nextRunAt === null ? 'Waiting for a trigger' : localTime(schedule.nextRunAt);
  const target = schedule.lastTaskId ?? schedule.sessionId;
  const open = schedule.lastTaskId ? 'Open last task' : 'Open task';
  const project = schedule.projectName ? `<span>${escape(schedule.projectName)}</span>` : '';
  return `<li class="sp-row" data-id="${escape(schedule.id)}" data-enabled="${schedule.enabled}">
    <div class="sp-main"><strong class="sp-title">${escape(schedule.title)}</strong><span class="sp-meta">${project}<span>${escape(cadence(schedule))}</span><span>Next: ${escape(next)}</span><span>Last: ${resultHtml(result)}</span></span></div>
    <button type="button" class="secondary-button sp-open" data-open="${escape(target)}">${icon('external')}${open}</button>
    <input type="checkbox" role="switch" class="ds-toggle" data-toggle aria-label="${escape(schedule.title)}" ${schedule.enabled ? 'checked' : ''} ${spent ? 'disabled title="Finished: it used all its runs"' : ''}>
  </li>`;
}

const generatedAt = (value: string) => value.replace('T', ' ').replace(/:\d\d$/, '');

function windowsRow(task: WindowsTask): string {
  const tone = windowsTone(task);
  const command = task.command ? ` tabindex="0" data-tip="${escape(task.command)}"` : '';
  const mark = task.mark ? `<span class="sp-tag" data-mark="${escape(task.mark)}">${escape(task.mark)}</span>` : '';
  const result = task.result ? `<span class="sp-result" data-result="${windowsFailed(task) ? 'error' : 'ok'}"${task.last ? ` data-tip="Last run: ${escape(task.last)}"` : ''}>${escape(task.result)}</span>` : '';
  const meta = [task.when, task.next ? `Next: ${task.next}` : ''].filter(Boolean).map(text => `<span>${escape(text)}</span>`).join('');
  return `<li class="sp-row sp-windows-row" data-tone="${tone}">
    <div class="sp-main"><strong class="sp-name"${command}>${escape(task.name)}</strong>${task.does ? `<span class="sp-does">${escape(task.does)}</span>` : ''}<span class="sp-meta">${meta}</span></div>
    <div class="sp-badges">${task.ai ? `<span class="sp-tag sp-ai" data-ai="${escape(task.ai)}">${escape(task.ai)}</span>` : ''}${mark}${result}</div>
  </li>`;
}

export function mountSchedulesPanel(host: HTMLElement, options: SchedulesPanelOptions): () => void {
  host.innerHTML = `<div class="schedules-panel">
    <div class="sp-bar"><div class="sp-tabs" role="tablist" aria-label="Schedule sources"><button type="button" role="tab" id="sp-tab-pandacode" aria-controls="sp-body" data-tab="pandacode" aria-selected="true">PandaCode</button><button type="button" role="tab" id="sp-tab-windows" aria-controls="sp-body" data-tab="windows" aria-selected="false" hidden>Windows</button></div><button type="button" class="secondary-button sp-settings">${icon('settings')}Settings</button></div>
    <p class="sp-error" role="alert" hidden></p>
    <div class="sp-body" id="sp-body" role="tabpanel" aria-live="polite"></div>
  </div>`;
  const $ = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
  const tabs = $<HTMLElement>('.sp-tabs'), windowsTab = $<HTMLButtonElement>('[data-tab="windows"]'), body = $<HTMLElement>('.sp-body'), error = $<HTMLElement>('.sp-error');
  let tab: Tab = 'pandacode', schedules: TaskSchedule[] = [], results = new Map<string, LastResult>(), report: WindowsSchedules | null = null;
  let pandaLoaded = false, windowsLoaded = false, disposed = false;
  const unsubscribes: (() => void)[] = [];

  const showError = (cause: unknown) => { error.textContent = message(cause); error.hidden = false; };

  function syncTabs(): void {
    windowsTab.hidden = !windowsTabVisible(report);
    if (windowsTab.hidden && tab === 'windows') tab = 'pandacode';
    for (const button of tabs.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    tabs.hidden = windowsTab.hidden;
    body.setAttribute('aria-labelledby', `sp-tab-${tab}`);
    trackSegment(tabs, tabs.querySelector<HTMLElement>('[aria-selected="true"]'));
  }

  function render(): void {
    syncTabs();
    if (tab === 'windows') {
      if (!windowsLoaded) { body.innerHTML = '<p class="dialog-loading">Loading…</p>'; return; }
      const warning = report?.warning ? `<p class="sp-warning" role="alert">${icon('info')}<span>${escape(report.warning)}</span></p>` : '';
      const tasks = report?.tasks ?? [];
      const head = report?.generated ? `<p class="sp-note">Generated ${escape(generatedAt(report.generated))} · ${tasks.length} tasks · read only</p>` : '';
      body.innerHTML = `${warning}${head}${tasks.length ? `<ul class="sp-list">${tasks.map(windowsRow).join('')}</ul>` : warning ? '' : '<p class="sp-empty">The file lists no tasks.</p>'}`;
      return;
    }
    if (!pandaLoaded) { body.innerHTML = '<p class="dialog-loading">Loading…</p>'; return; }
    body.innerHTML = schedules.length
      ? `<ul class="sp-list">${panelOrder(schedules).map(schedule => pandaRow(schedule, results.get(schedule.id) ?? 'none')).join('')}</ul>`
      : '<p class="sp-empty">Nothing is scheduled yet.</p>';
  }

  async function loadWindows(): Promise<void> {
    try { const next = await schedulesApi.windows(); if (disposed) return; report = next; windowsLoaded = true; }
    catch (cause) { if (disposed) return; report = { configured: true, generated: '', tasks: [], warning: message(cause) }; windowsLoaded = true; }
    render();
  }

  async function loadPanda(): Promise<void> {
    try {
      const next = await schedulesApi.list();
      const nextResults = await lastResults(next);
      if (disposed) return;
      schedules = next; results = nextResults; pandaLoaded = true; error.hidden = true;
    } catch (cause) { if (!disposed) { pandaLoaded = true; showError(cause); } }
    render();
  }

  host.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const select = target.closest<HTMLElement>('[data-tab]');
    if (select) {
      tab = select.dataset.tab as Tab; render();
      if (tab === 'windows') void loadWindows();
      return;
    }
    if (target.closest('.sp-settings')) { options.openSettings(); return; }
    const open = target.closest<HTMLElement>('[data-open]');
    if (open) options.openThread(open.dataset.open!);
  });
  host.addEventListener('change', event => {
    const target = event.target;
    const row = target instanceof Element ? target.closest<HTMLElement>('.sp-row[data-id]') : null;
    if (!(target instanceof HTMLInputElement) || target.dataset.toggle === undefined || !row) return;
    error.hidden = true;
    void schedulesApi.setEnabled(row.dataset.id!, target.checked).catch(showError).then(() => { if (!disposed) return loadPanda(); });
  });

  void subscribe(SCHEDULES_CHANGED, () => { if (!disposed) void loadPanda(); }).then(stop => { if (disposed) stop(); else unsubscribes.push(stop); });
  render();
  void loadPanda();
  void loadWindows();
  return () => {
    disposed = true;
    unsubscribes.forEach(stop => stop());
    host.replaceChildren();
  };
}
