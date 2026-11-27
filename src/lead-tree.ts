/* The sidebar's leader tree: a task that leads a team of workers, or has harness subagents running or lately
 * finished, is drawn with a crown and its children underneath. This is the data side, with no DOM: it maps what the
 * app already stores or streams (team snapshots, subagent rows, stored context) to rows. Nothing is estimated; a fact
 * the app does not hold (a subagent's model or cost) is left out. See docs/architect-workers.md. */
import { contextPercent } from './context-status.ts';
import { teamActive, type TeamSnapshot, type TeamWorker } from './architect-types.ts';

export type TreeState = 'running' | 'waiting' | 'done' | 'queued' | 'failed';
export type TreeKind = 'worker' | 'subagent';
export interface ContextUse { usedTokens: number; contextWindow: number | null }
/** A harness subagent as the tree reads it: a list row or a live event. */
export interface TreeAgent { id: string; name: string; status: 'running' | 'waiting' | 'completed' | 'failed' | 'stopped'; startedAt: number; updatedAt: number; prompt?: string; step?: string | null }
export interface TreeNode {
  kind: TreeKind; id: string; name: string; state: TreeState;
  /** The state in words: Working, Needs you, Queued, Paused, Done, Failed, Stopped. */
  label: string;
  startedAt: number | null; endedAt: number | null;
  model: string | null; effort: string | null; context: ContextUse | null; step: string | null;
}
export interface LeadTree {
  children: TreeNode[];
  running: number; waiting: number; queued: number; done: number; failed: number; total: number;
  /** Running workers (what the limit counts) and live subagents (running or asking), kept apart. */
  workersRunning: number; subagentsLive: number;
  /** Workers at once for a team (0 or absent: no limit); null for a task with subagents only. */
  limit: number | null;
}
/** Subagents settled longer ago than this no longer hold a task's crown. */
export const SUBAGENT_RECENT_MS = 2 * 60 * 60 * 1000;

const firstLine = (text: string | null | undefined, max = 140): string | null => {
  const line = (text ?? '').split('\n').map(part => part.trim()).find(Boolean);
  return line ? (line.length > max ? `${line.slice(0, max - 1)}…` : line) : null;
};

export interface WorkerContext {
  needsInput(sessionId: string): boolean;
  modelName(worker: TeamWorker): string;
  context(sessionId: string): ContextUse | null;
}

/** One worker as a child row; null for one the lead skipped. */
export function workerNode(team: TeamSnapshot, worker: TeamWorker, lookup: WorkerContext): TreeNode | null {
  if (worker.abandoned) return null;
  const asking = worker.status === 'waiting' || (worker.status === 'running' && lookup.needsInput(worker.sessionId));
  let state: TreeState, label: string;
  if (worker.status === 'completed') { state = 'done'; label = 'Done'; }
  else if (worker.status === 'failed') { state = 'failed'; label = 'Failed'; }
  else if (worker.status === 'stopped') { state = 'queued'; label = 'Stopped'; }
  else if (!teamActive(team)) { state = 'queued'; label = team.status === 'paused' ? 'Paused' : 'Stopped'; }
  else if (asking) { state = 'waiting'; label = 'Needs you'; }
  else if (worker.status === 'running') { state = 'running'; label = 'Working'; }
  else if (worker.status === 'parked') { state = 'queued'; label = 'Waiting on sub-workers'; }
  else { state = 'queued'; label = 'Queued'; }
  const live = state === 'running' || state === 'waiting';
  return {
    kind: 'worker', id: worker.id, name: worker.name, state, label,
    startedAt: live ? worker.startedAt ?? worker.createdAt : null,
    endedAt: state === 'done' || state === 'failed' ? worker.updatedAt : null,
    model: lookup.modelName(worker) || null, effort: worker.reasoningEffort ?? null,
    context: lookup.context(worker.sessionId),
    step: firstLine(state === 'failed' ? worker.error : worker.checkpoint?.summary || worker.summary || worker.assignment),
  };
}

/** One harness subagent as a child row. Native stores no model, effort or context for it, so none shows. */
export function subagentNode(agent: TreeAgent): TreeNode {
  const named = agent.name.trim() && !/[\\/]/.test(agent.name) && !/^(?:subagent|agent)$/i.test(agent.name.trim());
  const [state, label] = ({
    running: ['running', 'Working'], waiting: ['waiting', 'Needs you'], completed: ['done', 'Done'], failed: ['failed', 'Failed'], stopped: ['queued', 'Stopped'],
  } satisfies Record<TreeAgent['status'], [TreeState, string]>)[agent.status];
  const live = state === 'running' || state === 'waiting';
  return {
    kind: 'subagent', id: agent.id, name: named ? agent.name.trim() : firstLine(agent.prompt, 48) ?? 'Subagent', state, label,
    startedAt: live ? agent.startedAt || null : null, endedAt: live ? null : agent.updatedAt || null,
    model: null, effort: null, context: null, step: firstLine(agent.step) ?? firstLine(agent.prompt),
  };
}

export interface LeadTreeInput { team?: TeamSnapshot | null; agents?: readonly TreeAgent[]; now: number; lookup: WorkerContext }
/** The tree under a task, or null when it has no worker and no running or recent subagent. */
export function buildLeadTree({ team, agents = [], now, lookup }: LeadTreeInput): LeadTree | null {
  const workers = (team?.workers ?? []).filter(worker => !worker.parentWorker).slice().sort((a, b) => a.createdAt - b.createdAt)
    .flatMap(worker => { const node = workerNode(team!, worker, lookup); return node ? [node] : []; });
  const recent = agents.filter(agent => agent.status === 'running' || agent.status === 'waiting' || now - agent.updatedAt <= SUBAGENT_RECENT_MS)
    .slice().sort((a, b) => a.startedAt - b.startedAt).map(subagentNode);
  const children = [...workers, ...recent];
  if (!children.length) return null;
  const count = (state: TreeState) => children.filter(child => child.state === state).length;
  return {
    children, workersRunning: workers.filter(node => node.state === 'running').length, subagentsLive: recent.filter(node => node.state === 'running' || node.state === 'waiting').length,
    running: count('running'), waiting: count('waiting'), queued: count('queued'), done: count('done'), failed: count('failed'), total: children.length,
    limit: team && workers.length ? team.config.maxParallel : null,
  };
}

/** "2 of 4": finished children out of all of them. */
export const progressText = (tree: LeadTree): string => `${tree.done} of ${tree.total}`;
/** "2 of 2 workers running · 1 subagent": only workers count against the limit; subagents are named apart. */
export function limitText(tree: LeadTree): string {
  const subagents = tree.subagentsLive ? `${tree.subagentsLive} subagent${tree.subagentsLive === 1 ? '' : 's'}` : '';
  if (tree.limit === null) return subagents ? `${subagents} running` : '0 running';
  const workers = tree.limit > 0 ? `${tree.workersRunning} of ${tree.limit} workers running` : `${tree.workersRunning} workers running (no limit)`;
  return [workers, subagents].filter(Boolean).join(' · ');
}

export { contextPercent };
const tokens = (value: number): string => value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
export function contextText(use: ContextUse | null): string | null {
  if (!use) return null;
  const percent = contextPercent(use);
  return percent === null ? `${tokens(use.usedTokens)} tokens` : `${percent}% (${tokens(use.usedTokens)} of ${tokens(use.contextWindow!)})`;
}

/** The hover and focus detail of a child row, one fact per line; a fact the app does not hold is left out. */
export function childTip(node: TreeNode, now: number, duration: (ms: number) => string): string {
  const time = node.startedAt !== null ? `${node.label} for ${duration(Math.max(0, now - node.startedAt))}` : node.endedAt !== null && node.state !== 'queued' ? `${node.label} ${duration(Math.max(0, now - node.endedAt))} ago` : node.label;
  const model = [node.model, node.effort].filter(Boolean).join(' · ');
  const context = contextText(node.context);
  return [`${node.name} (${node.kind})`, time, model && `Model: ${model}`, context && `Context: ${context}`, node.step && `Now: ${node.step}`].filter(Boolean).join('\n');
}
/** The lead's own detail: its title, how its children stand, its limit, and its model and context when known. */
export function leadTip(title: string, tree: LeadTree, own: { model?: string | null; effort?: string | null; context?: ContextUse | null }): string {
  const parts: [number, string][] = [[tree.running, 'running'], [tree.waiting, 'need you'], [tree.queued, 'queued'], [tree.done, 'done'], [tree.failed, 'failed']];
  const model = [own.model, own.effort].filter(Boolean).join(' · ');
  const context = contextText(own.context ?? null);
  return [title, `Leader: ${progressText(tree)} done`, parts.filter(([count]) => count).map(([count, word]) => `${count} ${word}`).join(' · '), limitText(tree), model && `Model: ${model}`, context && `Context: ${context}`].filter(Boolean).join('\n');
}
