/* The Central board: a card per project, drawn from buildCentral's model. Cards hold buttons that open a task
 * (data-action="central-open"); the composer under them is created once so a redraw never costs a draft. */
import { escape, icon } from './dom';
import { eventText, type CentralCard, type CentralEvent, type CentralModel } from './central-board';
import './central.css';

const COUNTS: [keyof Pick<CentralCard, 'running' | 'needs' | 'finished' | 'failed'>, string][] = [['running', 'running'], ['needs', 'need you'], ['finished', 'finished'], ['failed', 'failed']];

const eventButton = (event: CentralEvent, now: number, named: boolean): string =>
  `<button type="button" class="central-event" data-action="central-open" data-id="${escape(event.taskId)}" data-kind="${event.kind}" title="${escape(event.projectName)} · ${escape(eventText(event, now))}"><span class="central-dot" aria-hidden="true"></span><span class="central-event-text">${named ? `<span class="central-project">${escape(event.projectName)}</span> · ` : ''}${escape(eventText(event, now))}</span></button>`;

function cardHtml(card: CentralCard, now: number): string {
  const counts = COUNTS.map(([key, label]) => `<span class="central-count" data-kind="${key}" data-zero="${card[key] === 0}"><span class="central-num">${card[key]}</span> ${label}</span>`).join('');
  const leaders = card.leaders.map(leader => `<button type="button" class="central-leader" data-action="central-open" data-id="${escape(leader.taskId)}" title="${escape(leader.title)} · ${leader.progress} done"><span class="central-crown" aria-hidden="true">${icon('crown')}</span><span class="central-leader-name">${escape(leader.title)}</span><span class="central-progress">${leader.progress}</span></button>`).join('');
  return `<article class="central-card" data-project="${escape(card.projectId)}" data-needs="${card.needs + card.failed > 0}" aria-label="${escape(card.name)}"><header><h2 class="central-card-title">${escape(card.name)}</h2></header><div class="central-counts">${counts}</div>${leaders ? `<div class="central-leaders">${leaders}</div>` : ''}<div class="central-events">${card.events.map(event => eventButton(event, now, false)).join('')}</div></article>`;
}

/** The part of the board that follows the tasks; the composer is not in it. */
export function centralBodyHtml(model: CentralModel, now: number): string {
  const needs = model.attention.length
    ? `<section class="central-attention" aria-label="Needs you"><h2 class="central-card-title">Needs you</h2><div class="central-events">${model.attention.map(event => eventButton(event, now, true)).join('')}</div></section>` : '';
  const cards = model.cards.length
    ? `<div class="central-grid">${model.cards.map(card => cardHtml(card, now)).join('')}</div>`
    : '<p class="central-empty">No project has had activity in the last 24 hours.</p>';
  return needs + cards;
}

export const CENTRAL_SHELL = `<div class="central-scroll"><header class="central-head"><span class="central-eyebrow">${icon('star')}Central</span><h1 class="central-title">All projects</h1><p class="central-sub" aria-live="polite"></p></header><div class="central-body"></div></div><form class="central-ask" data-central-form><textarea id="central-prompt" rows="2" dir="auto" aria-label="Ask Central about your projects" placeholder="Ask Central about any project…" maxlength="8000"></textarea><div class="central-ask-actions"><button type="button" class="secondary-button" data-action="central-chat">Open Central chat</button><button type="submit" class="primary-button">Ask Central</button></div></form>`;

export const centralSub = (model: CentralModel): string => {
  const total = (key: 'running' | 'needs' | 'failed') => model.cards.reduce((sum, card) => sum + card[key], 0);
  return model.cards.length ? `${model.cards.length} project${model.cards.length === 1 ? '' : 's'} · ${total('running')} running · ${total('needs')} need you · ${total('failed')} failed · last 24 hours` : 'Last 24 hours';
};
