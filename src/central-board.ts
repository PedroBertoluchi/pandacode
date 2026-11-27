/* The Central board's data side, with no DOM and no model call: it reads what the window already holds (tasks, their
 * live state, leader trees) and returns one card per project with activity in the last 24 hours. See docs/central.md. */
import type { Project, Session } from './types.ts';
import { progressText, type LeadTree } from './lead-tree.ts';

export type CentralKind = 'needs' | 'limited' | 'failed' | 'running' | 'finished';
export interface CentralEvent { taskId: string; projectId: string; projectName: string; title: string; kind: CentralKind; at: number }
export interface CentralLeader { taskId: string; title: string; done: number; total: number; progress: string }
export interface CentralCard {
  projectId: string; name: string; leaders: CentralLeader[];
  running: number; needs: number; finished: number; failed: number;
  /** The newest three tasks, with what happened to each. */
  events: CentralEvent[]; latest: number;
}
export interface CentralModel {
  /** Tasks that need a look anywhere: waiting on the user, stopped by a usage limit, or failed. Equals attentionTotal + failuresTotal. */
  badge: number;
  /** Tasks waiting on the user or stopped by a usage limit, newest first, for the "Needs you" strip. */
  attention: CentralEvent[];
  attentionTotal: number;
  /** Tasks that failed in the last 24 hours, newest first, for the "Failed" strip. */
  failures: CentralEvent[];
  failuresTotal: number;
  cards: CentralCard[];
}
export interface CentralInput {
  projects: readonly Project[]; sessions: readonly Session[]; now: number;
  /** The window's own reading of a task: attention, running, limited, failed or empty (main.ts taskSignal). */
  signal(task: Session): string;
  tree(task: Session): LeadTree | null;
}
export const CENTRAL_WINDOW_MS = 24 * 60 * 60 * 1000;
export const EVENTS_PER_CARD = 3;
const ATTENTION_SHOWN = 6;

/** The Central's own folder: its project and task stay out of the sidebar and out of the board. */
const CENTRAL_FOLDER = /[\\/]PandaCode Central[\\/]central$/;
export const isCentralProject = (project: Pick<Project, 'path'> | undefined): boolean => Boolean(project && CENTRAL_FOLDER.test(project.path));

/** What happened to a task, or null when it is idle and quiet. A question in a worker counts for its leader. */
export function centralKind(task: Session, input: Pick<CentralInput, 'signal' | 'tree' | 'now'>): CentralEvent['kind'] | null {
  const signal = input.signal(task);
  if (signal === 'failed') return 'failed';
  if (signal === 'attention' || (input.tree(task)?.waiting ?? 0) > 0) return 'needs';
  if (signal === 'limited') return 'limited';
  if (signal === 'running') return 'running';
  const at = task.lastResponseAt ?? task.updatedAt;
  return input.now - at <= CENTRAL_WINDOW_MS ? 'finished' : null;
}

/** When a task's event counts for the badge: a failure from days ago is old news; a question or a limit still waits. */
const counts = (kind: CentralEvent['kind'], at: number, now: number): boolean => kind === 'needs' || kind === 'limited' || (kind === 'failed' && now - at <= CENTRAL_WINDOW_MS);
const eventTime = (task: Session, kind: CentralEvent['kind']): number => kind === 'running' ? task.lastPromptAt ?? task.updatedAt : task.lastResponseAt ?? task.updatedAt;

/** Just the badge, for when the board is closed: the same count as buildCentral(...).badge, with no cards built. */
export function centralBadge(input: CentralInput): number {
  const known = new Set(input.projects.map(project => project.id));
  let badge = 0;
  for (const task of input.sessions) {
    if (!known.has(task.projectId) || task.archived || task.draft) continue;
    const kind = centralKind(task, input);
    if (kind && counts(kind, eventTime(task, kind), input.now)) badge++;
  }
  return badge;
}

export function buildCentral(input: CentralInput): CentralModel {
  const byProject = new Map<string, Project>(input.projects.map(project => [project.id, project]));
  const cards = new Map<string, CentralCard>();
  const attention: CentralEvent[] = [], failures: CentralEvent[] = [];
  for (const task of input.sessions) {
    const project = byProject.get(task.projectId);
    if (!project || task.archived || task.draft) continue;
    const kind = centralKind(task, input);
    if (!kind) continue;
    const at = eventTime(task, kind);
    if (kind === 'failed' && !counts(kind, at, input.now)) continue;
    const event: CentralEvent = { taskId: task.id, projectId: project.id, projectName: project.name, title: task.title, kind, at };
    const card = cards.get(project.id) ?? { projectId: project.id, name: project.name, leaders: [], running: 0, needs: 0, finished: 0, failed: 0, events: [], latest: 0 };
    cards.set(project.id, card);
    if (kind === 'needs' || kind === 'limited') card.needs++; else card[kind]++;
    if (kind === 'failed') failures.push(event); else if (kind === 'needs' || kind === 'limited') attention.push(event);
    card.events.push(event);
    card.latest = Math.max(card.latest, at);
    const tree = input.tree(task);
    if (tree && tree.total > 0) card.leaders.push({ taskId: task.id, title: task.title, done: tree.done, total: tree.total, progress: progressText(tree) });
  }
  const newest = (a: CentralEvent, b: CentralEvent) => b.at - a.at;
  for (const card of cards.values()) card.events = card.events.sort(newest).slice(0, EVENTS_PER_CARD);
  const ordered = [...cards.values()].sort((a, b) => b.needs - a.needs || b.failed - a.failed || b.latest - a.latest || a.name.localeCompare(b.name));
  return { badge: attention.length + failures.length, attention: attention.sort(newest).slice(0, ATTENTION_SHOWN), attentionTotal: attention.length, failures: failures.sort(newest).slice(0, ATTENTION_SHOWN), failuresTotal: failures.length, cards: ordered };
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function agoText(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.round(minutes / 60);
  return hours < 24 ? hours + ' h ago' : Math.round(hours / 24) + ' d ago';
}

/** The line for one event: "Talentos finished 5 min ago", "Posicionamento needs you". */
export function eventText(event: CentralEvent, now: number): string {
  const when = agoText(event.at, now);
  switch (event.kind) {
    case 'needs': return event.title + ' needs you';
    case 'limited': return event.title + ' hit its usage limit';
    case 'failed': return event.title + ' failed ' + when;
    case 'running': return event.title + ' is running';
    default: return event.title + ' finished ' + when;
  }
}
