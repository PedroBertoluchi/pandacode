import { escape, icon } from './dom';
import { childTip, contextPercent, leadTip, limitText, progressText, type ContextUse, type LeadTree, type TreeNode } from './lead-tree.ts';

/** The crown and "N of M" that join a leader's title. */
export const crownHtml = (tree: LeadTree): string => `<span class="lead-crown" aria-hidden="true">${icon('crown')}</span>`;
export const progressHtml = (tree: LeadTree): string => `<span class="lead-progress" role="img" aria-label="${progressText(tree)} finished">${progressText(tree)}</span>`;
/** Folds the children; sits left of the row, outside its button. */
export const leadToggleHtml = (taskId: string, title: string, open: boolean): string =>
  `<button type="button" class="lead-toggle" data-action="toggle-lead" data-task="${escape(taskId)}" tabindex="-1" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} workers of ${escape(title)}" title="${open ? 'Hide' : 'Show'} workers">${icon('chevron')}</button>`;
export const leadTipFor = leadTip;

/** One path per child: the trunk comes down from above, bends into the child, and carries on to the next one. */
const lineSvg = (last: boolean): string => `<svg class="lead-line" viewBox="0 0 14 100" preserveAspectRatio="none" aria-hidden="true"><path class="lead-line-in" d="M3 0V50H14"/>${last ? '' : '<path class="lead-line-on" d="M3 50V100"/>'}</svg>`;

function childHtml(taskId: string, node: TreeNode, last: boolean, now: number, duration: (ms: number) => string): string {
  const live = node.startedAt !== null;
  const time = live && node.state === 'running' ? `<span class="lead-time task-runtime" data-started-at="${node.startedAt}">${duration(Math.max(0, now - node.startedAt!))}</span>` : node.state === 'running' ? '' : `<span class="lead-word">${escape(node.label)}</span>`;
  // Context shows on the row whenever the app holds it, warned once it runs short.
  const percent = contextPercent(node.context);
  const context = percent !== null ? `<span class="lead-context"${percent >= 70 ? ' data-high' : ''} title="Context used">${percent}%</span>` : '';
  return `<button type="button" class="lead-child" data-state="${node.state}" data-kind="${node.kind}" data-action="open-lead-child" data-task="${escape(taskId)}" data-child="${escape(node.id)}" tabindex="-1" data-tip="${escape(childTip(node, now, duration))}" aria-label="${escape(`${node.name}, ${node.kind}, ${node.label}`)}">${lineSvg(last)}<span class="lead-dot" aria-hidden="true"></span><span class="lead-name">${escape(node.name)}</span><span class="lead-kind" role="img" aria-label="${node.kind}" title="${node.kind}">${icon(node.kind === 'worker' ? 'team' : 'branch')}</span>${context}${time}</button>`;
}

export function treeHtml(taskId: string, title: string, tree: LeadTree, now: number, duration: (ms: number) => string): string {
  const rows = tree.children.map((node, index) => childHtml(taskId, node, index === tree.children.length - 1, now, duration)).join('');
  return `<div class="lead-tree" role="group" aria-label="${escape(title)}: workers and subagents" data-lead="${escape(taskId)}">${rows}<div class="lead-limit">${escape(limitText(tree))}</div></div>`;
}
export type { ContextUse };
