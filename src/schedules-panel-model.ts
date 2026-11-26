import type { RunOutcome, TaskSchedule, WindowsSchedules, WindowsTask } from './schedules-api';

export const HOVER_LIMIT = 10;

export type LastResult = 'ok' | 'error' | 'skipped' | 'none';
export type WindowsTone = 'error' | 'off' | 'ok';

export function lastResult(outcome: RunOutcome | null | undefined): LastResult {
  if (!outcome) return 'none';
  if (outcome === 'failed') return 'error';
  return outcome === 'skipped' ? 'skipped' : 'ok';
}

const byNext = (a: TaskSchedule, b: TaskSchedule) => (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity);
const text = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Enabled schedules with a next run, soonest first, across every project. */
export function upcoming(schedules: readonly TaskSchedule[], limit = HOVER_LIMIT): TaskSchedule[] {
  return schedules.filter(s => s.enabled && s.nextRunAt !== null).sort((a, b) => byNext(a, b) || text(a.title, b.title) || text(a.id, b.id)).slice(0, limit);
}

/** Every schedule: switched on first, then by next run (none last), then by title. */
export function panelOrder(schedules: readonly TaskSchedule[]): TaskSchedule[] {
  return [...schedules].sort((a, b) => Number(b.enabled) - Number(a.enabled) || byNext(a, b) || text(a.title, b.title) || text(a.id, b.id));
}

const DAY_MS = 86_400_000;
const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/** A local date and time that always names the clock: "Today 3:45 PM", "Tomorrow 9:00 AM", "Fri 9:00 AM", "Dec 3 9:00 AM". */
export function localTime(at: number, now = Date.now()): string {
  const clock = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' }).format(at);
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_MS);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Tomorrow ${clock}`;
  if (days > 1 && days < 7) return `${new Intl.DateTimeFormat([], { weekday: 'short' }).format(at)} ${clock}`;
  return `${new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' }).format(at)} ${clock}`;
}

export function windowsTone(task: Pick<WindowsTask, 'mark' | 'result'>): WindowsTone {
  if (task.mark === 'quebrado') return 'error';
  if (task.mark === 'desligada') return 'off';
  return windowsFailed(task) ? 'error' : 'ok';
}

export const windowsFailed = (task: Pick<WindowsTask, 'result'>): boolean => /^erro/i.test(task.result.trim());

export const windowsTabVisible = (report: Pick<WindowsSchedules, 'configured'> | null): boolean => report?.configured === true;
