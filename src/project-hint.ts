/** "Open there": a first message that names a project other than the one the New task is in. Matching is local (no model call):
 * the prompt's words, case and accents ignored and at least 4 letters, against the registered projects' names and the names of
 * nearby project-looking folders (`project_hint_folders`, native). The hint only shows in a project that is a drive root or a folder of
 * projects (`wide`). Off with Settings > General > Suggest the right project (`pandacode.projectHint` = 'off'). */
/** Not imported from dom.ts: Node's test runner cannot resolve its extensionless imports. */
const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const MIN_WORD = 4;
const KEY = 'pandacode.projectHint';
const PROMPT_CHARS = 2000;

export interface HintProject { id: string; name: string; path: string }
export interface HintFolder { name: string; path: string }
export type ProjectHint =
  | { kind: 'registered'; name: string; path: string; projectId: string }
  | { kind: 'folder'; name: string; path: string };

/** Folder names that say what a folder holds, not which project it is; a prompt mentioning them proves nothing. */
const GENERIC = new Set([
  'apps', 'tools', 'build', 'builds', 'temp', 'test', 'tests', 'testes', 'teste', 'docs', 'work', 'code', 'data', 'files', 'main', 'user', 'users',
  'clients', 'client', 'projects', 'project', 'projetos', 'projeto', 'worktrees', 'backup', 'backups', 'site', 'sites', 'cliente', 'clientes',
  'game', 'games', 'archive', 'old', 'copy', 'base', 'repo', 'repos', 'tmp', 'node', 'dist', 'target', 'release', 'releases',
  'server', 'admin', 'core', 'shared', 'utils', 'config', 'demo', 'notes', 'home', 'scripts', 'app', 'web', 'api',
]);

export function enabled(): boolean {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setEnabled(on: boolean): void {
  try { if (on) localStorage.removeItem(KEY); else localStorage.setItem(KEY, 'off'); } catch { /* Kept for this window only. */ }
}

const fold = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Distinct words of at least MIN_WORD letters or digits, folded. */
export function words(text: string): string[] {
  return [...new Set(fold(text).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= MIN_WORD))];
}

/** One spelling of a path for comparing: no \\?\ prefix, forward slashes, no trailing slash, lower case. */
export function samePath(a: string, b: string): boolean {
  const normal = (path: string) => path.replace(/^\\\\\?\\/, '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normal(a) === normal(b);
}

/** The path as the user knows it: drive and backslashes on Windows, whatever the native side returned. */
export function displayPath(path: string): string {
  const plain = path.replace(/^\\\\\?\\/, '');
  return /^[A-Za-z]:/.test(plain) ? plain.replace(/\//g, '\\') : plain;
}

interface Candidate { name: string; path: string; projectId?: string }

/** A checkout made by a worktree task (inside a Worktrees folder) is never "the project". */
const inWorktrees = (path: string) => path.replace(/^\\\\\?\\/, '').split(/[\\/]+/).some(part => fold(part) === 'worktrees');
/** A 2 or 3 letter all-capitals name (RC) is mentioned only as that whole uppercase word. */
const acronym = (name: string) => /^\p{Lu}{2,3}$/u.test(name.trim()) ? name.trim() : '';
const mentionsAcronym = (prompt: string, name: string) => new RegExp(`(?<![\\p{L}\\p{N}])${name}(?![\\p{L}\\p{N}])`, 'u').test(prompt);

/** The project the first message names, or null when none stands out or it names the project it is already in. */
export function findProject(prompt: string, current: HintProject, projects: HintProject[], folders: HintFolder[]): ProjectHint | null {
  const text = prompt.slice(0, PROMPT_CHARS);
  const mentioned = new Set(words(text));
  if (!mentioned.size && !/\p{Lu}{2,3}/u.test(text)) return null;
  const candidates: Candidate[] = projects.map(project => ({ name: project.name, path: project.path, projectId: project.id }));
  for (const folder of folders) if (!candidates.some(known => samePath(known.path, folder.path))) candidates.push(folder);
  let best: { candidate: Candidate; score: number } | undefined;
  let tied = false;
  for (const candidate of candidates) {
    if (inWorktrees(candidate.path)) continue;
    const short = acronym(candidate.name);
    const own = short ? [short] : words(candidate.name).filter(word => !GENERIC.has(word) && /\p{L}/u.test(word));
    const shared = short ? (mentionsAcronym(text, short) ? 1 : 0) : own.filter(word => mentioned.has(word)).length;
    if (!shared) continue;
    if (own.length > 1 && shared < own.length && shared < 2) continue;
    // A name fully mentioned beats a longer name sharing one word; a registered project beats a folder.
    const score = shared / own.length + 0.1 * shared + (candidate.projectId ? 0.01 : 0);
    if (!best || score > best.score + 1e-9) { best = { candidate, score }; tied = false; }
    else if (Math.abs(score - best.score) <= 1e-9) tied = true;
  }
  if (!best || tied) return null;
  const { candidate } = best;
  if (candidate.projectId === current.id || samePath(candidate.path, current.path)) return null;
  return candidate.projectId
    ? { kind: 'registered', name: candidate.name, path: candidate.path, projectId: candidate.projectId }
    : { kind: 'folder', name: candidate.name, path: candidate.path };
}

/** Above the composer, before the message is sent: the two choices and nothing else. */
export function projectHintHtml(hint: ProjectHint | undefined): string {
  if (!hint) return '';
  const path = displayPath(hint.path);
  return `<div class="project-hint" id="project-hint" role="group" aria-label="Project suggestion"><span class="project-hint-text">Looks like <strong>${escape(hint.name)}</strong> <span class="project-hint-path" title="${escape(path)}">${escape(path)}</span>. Open there?</span><span class="project-hint-actions"><button type="button" class="ds-btn-primary" data-action="project-hint-open">Open there</button><button type="button" class="ds-btn" data-action="project-hint-keep">Keep here</button></span></div>`;
}
