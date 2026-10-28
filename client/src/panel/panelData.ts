// The control panel's reading of the office state and its little rules: where a link goes, how an agent's state reads,
// and how a launched task becomes an issue or a request to the CEO. Pure, so it's tested without a browser.
import type { Agent } from '../store';

export type PanelPage = 'overview' | 'project' | 'agents' | 'approvals' | 'ceo' | 'company' | 'settings';
export type ProjectTab = 'board' | 'agents' | 'settings';

export interface PanelRoute {
  page: PanelPage;
  repoId?: string;
  tab?: ProjectTab;
}

const PAGES: PanelPage[] = ['overview', 'project', 'agents', 'approvals', 'ceo', 'company', 'settings'];
const TABS: ProjectTab[] = ['board', 'agents', 'settings'];

/** The route in a location hash: #/project/<owner/name>/<tab>, #/agents … (anything else: the overview). */
export function parseRoute(hash: string): PanelRoute {
  const parts = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const page = PAGES.includes(parts[0] as PanelPage) ? (parts[0] as PanelPage) : 'overview';
  if (page !== 'project') return { page };
  const repoId = parts[1] && parts[2] ? `${parts[1]}/${parts[2]}` : undefined;
  if (!repoId) return { page: 'overview' };
  return { page, repoId, tab: TABS.includes(parts[3] as ProjectTab) ? (parts[3] as ProjectTab) : 'board' };
}

/** The hash for a route, the inverse of parseRoute. */
export function routeHash(r: PanelRoute): string {
  if (r.page === 'project' && r.repoId) return `#/project/${r.repoId.split('/').map(encodeURIComponent).join('/')}/${r.tab ?? 'board'}`;
  return r.page === 'overview' ? '#/' : `#/${r.page}`;
}

export type Tone = 'idle' | 'build' | 'qa' | 'fix' | 'good' | 'bad' | 'warn';

/** An agent's state in a word or two, with the tone its chip is drawn in. */
export function agentState(a: Pick<Agent, 'status' | 'task'>): { label: string; tone: Tone } {
  switch (a.status) {
    case 'idle':
      return { label: 'Libre', tone: 'idle' };
    case 'preparing':
      return { label: 'Preparando', tone: 'build' };
    case 'working':
      return a.task === 'qa' ? { label: 'Probando', tone: 'qa' } : a.task === 'fix' ? { label: 'Corrigiendo', tone: 'fix' } : { label: 'Construyendo', tone: 'build' };
    case 'done':
      return { label: 'Terminado', tone: 'good' };
    case 'error':
      return { label: 'Necesita ayuda', tone: 'bad' };
    case 'stopped':
      return { label: 'Parado', tone: 'warn' };
  }
}

export type LaunchMode = 'backlog' | 'agent' | 'ceo';

const TITLE_MAX = 80;

/**
 * A task written in plain words as a GitHub issue: its first line (or sentence) is the title, cut at a word under 80
 * characters, and the whole text is the body.
 */
export function taskIssue(text: string): { title: string; body: string } {
  const body = text.trim();
  const first = body.split(/\r?\n/)[0].trim();
  const sentence = first.match(/^(.+?[.!?])(\s|$)/)?.[1] ?? first;
  let title = sentence.replace(/[.\s]+$/, '');
  if (title.length > TITLE_MAX) {
    const cut = title.slice(0, TITLE_MAX - 1);
    const space = cut.lastIndexOf(' ');
    title = `${(space > 40 ? cut.slice(0, space) : cut).trim()}…`;
  }
  return { title, body };
}

/** What the CEO is asked when a task is handed to them to plan. */
export function ceoTask(project: string, text: string): string {
  return `Nueva tarea para el proyecto ${project}. Planifícala: divídela en issues con sus dependencias (Depends on #N) y repártelas.\n\n${text.trim()}`;
}

/** Relative time in Spanish, short: "ahora", "hace 5 min", "hace 2 h", "hace 3 d". */
export function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return 'ahora';
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

/** Two initials for an avatar. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** A repo's short name: the part after the owner. */
export const shortName = (fullName: string) => fullName.split('/')[1] ?? fullName;
