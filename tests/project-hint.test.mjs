import test from 'node:test';
import assert from 'node:assert/strict';
import { displayPath, enabled, findProject, projectHintHtml, samePath, setEnabled, words } from '../src/project-hint.ts';

const root = { id: 'root', name: 'P:\\', path: 'P:\\' };
const registered = [
  root,
  { id: 'pc', name: 'pandacode-bertoluchi', path: 'P:\\Worktrees\\pandacode-bertoluchi' },
  { id: 'pandacode', name: 'PandaCode', path: 'P:\\Apps\\PandaCode' },
];
const folders = [
  { name: 'BAMemory', path: 'P:/BAMemory' },
  { name: 'Tibia', path: 'F:\\Tibia' },
  { name: 'Roberto Carlos', path: 'P:\\Clients\\Roberto Carlos' },
  { name: 'Build', path: 'P:\\Build' },
];
const find = (prompt, current = root) => findProject(prompt, current, registered, folders);

test('a prompt naming a folder finds it, whatever the case', () => {
  assert.deepEqual(find('Corrige o bug do BAMemory no checkout'), { kind: 'folder', name: 'BAMemory', path: 'P:/BAMemory' });
  assert.equal(find('quero ver o TIBIA outfit craft')?.path, 'F:\\Tibia');
});

test('a client is found by one word of its name, with accents ignored', () => {
  assert.equal(find('Lê as mensagens do Roberto, vê se estamos devendo algo pra ele')?.name, 'Roberto Carlos');
  assert.equal(find('mensagens do RÓBERTO')?.name, 'Roberto Carlos');
});

test('a registered project is offered by its id, and beats a longer name sharing one word', () => {
  assert.deepEqual(find('Ajusta a tela de agendamento do PandaCode'), { kind: 'registered', name: 'PandaCode', path: 'P:\\Apps\\PandaCode', projectId: 'pandacode' });
});

test('no match, short words, generic folder names and an unregistered duplicate stay quiet', () => {
  assert.equal(find('Qual a previsão do tempo amanhã?'), null);
  assert.equal(find('olha o pedro la no tibi'), null, 'tibi is a letter short of a name');
  assert.equal(find('Faz o build do projeto'), null, 'build and projeto name no project');
  assert.equal(find(''), null);
});

test('naming the project it is already in offers nothing', () => {
  const inside = registered[2];
  assert.equal(findProject('Ajusta o PandaCode', inside, registered, folders), null);
  assert.equal(findProject('Ajusta o Tibia', { id: 'x', name: 'Tibia', path: '\\\\?\\F:\\Tibia' }, registered, folders), null);
});

test('two different folders matching equally are ambiguous, so nothing is offered', () => {
  const twins = [{ name: 'Atlas Norte', path: 'P:/Atlas Norte' }, { name: 'Atlas Leste', path: 'P:/Atlas Leste' }];
  assert.equal(findProject('Atlas está lento', root, [root], twins), null);
  assert.equal(findProject('Atlas Norte está lento', root, [root], twins)?.name, 'Atlas Norte');
});

test('words ignore case, accents and anything under four letters', () => {
  assert.deepEqual(words('Lê as mensagens da Ação, ok? Ação!'), ['mensagens', 'acao']);
});

test('paths compare and display the way the user knows them', () => {
  assert.ok(samePath('\\\\?\\P:\\BAMemory\\', 'p:/bamemory'));
  assert.equal(displayPath('\\\\?\\F:/Tibia'), 'F:\\Tibia');
  assert.equal(displayPath('/home/me/app'), '/home/me/app');
});

test('the chip names the project and the two choices, and escapes the name', () => {
  const html = projectHintHtml({ kind: 'folder', name: '<b>Tibia</b>', path: 'F:\\Tibia' });
  assert.match(html, /Looks like <strong>&lt;b&gt;Tibia&lt;\/b&gt;<\/strong>/);
  assert.match(html, /data-action="project-hint-open">Open there</);
  assert.match(html, /data-action="project-hint-keep">Keep here</);
  assert.equal(projectHintHtml(undefined), '');
});

test('the setting is on until turned off', () => {
  const memory = new Map();
  globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  assert.equal(enabled(), true);
  setEnabled(false);
  assert.equal(memory.get('pandacode.projectHint'), 'off');
  assert.equal(enabled(), false);
  setEnabled(true);
  assert.equal(enabled(), true);
});
