// The floor as a list (FloorList.tsx), for anyone who can't use the 3D view: one row per person with their status in
// words and its shape, the coding agent they run, and what they're doing. Pure, so the wording is tested.

import type { AgentCli, AgentStatus, CliView, SwarmSettings } from '../../../shared/types';
import { ceoCli } from '../../../shared/models';
import type { Agent } from '../store';
import { KIND_ICON, STATUS_KIND, type StatusKind } from './statusLook';

export interface FloorRow {
  id: string;
  name: string;
  /** "CEO", or the coding agent they run ("Claude Code", "Codex"…). */
  agent: string;
  status: string;
  kind: StatusKind;
  icon: string;
  doing: string;
  /** A cloud agent waiting to be signed in: the coding agent to sign in (signInFor), else null. */
  signIn: string | null;
}

const STATUS_WORDS: Record<AgentStatus, string> = {
  idle: 'Libre',
  preparing: 'Preparándose',
  working: 'Trabajando',
  done: 'Terminado',
  error: 'Necesita ayuda',
  stopped: 'Detenido',
};

/** The coding agents' names until the office has listed them (CliView.label). */
const CLI_NAMES: Record<AgentCli, string> = { claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode' };

type Runtime = Pick<SwarmSettings, 'runtime' | 'defaultCli'>;

/** The coding agent someone runs: the CEO's own pick; a worker's in Real terminals; the Agent SDK is Claude Code. */
export const workerCli = (a: Pick<Agent, 'cli' | 'role'>, settings: Runtime): AgentCli =>
  a.role === 'ceo' ? ceoCli(a.cli) : settings.runtime !== 'terminal' ? 'claude' : a.cli || settings.defaultCli;

/** What someone is, in a word or two: the CEO, or the coding agent they run. */
export function agentLabel(a: Pick<Agent, 'cli' | 'role'>, settings: Runtime, clis: CliView[]): string {
  if (a.role === 'ceo') return 'CEO';
  const id = workerCli(a, settings);
  return clis.find((c) => c.id === id)?.label ?? CLI_NAMES[id];
}

/**
 * A cloud agent waiting for the manager to sign their coding agent in (docs/cloud.md): its name ("Claude Code"),
 * else null. A cloud agent's coding agent always runs in a terminal, whatever the office's runtime.
 */
export function signInFor(a: Pick<Agent, 'cli' | 'role' | 'host' | 'needsSignIn'>, settings: Pick<SwarmSettings, 'defaultCli'>): string | null {
  return a.role !== 'ceo' && a.host === 'box' && a.needsSignIn ? CLI_NAMES[a.cli || settings.defaultCli] : null;
}

/** What someone is on, in words. */
export function doingText(a: Pick<Agent, 'role' | 'status' | 'task' | 'issueNumber' | 'issueTitle' | 'prNumber'>): string {
  if (a.role === 'ceo') return a.status === 'working' ? (a.issueTitle ?? 'Trabajando') : 'Libre para charlar';
  if (a.status === 'idle') return 'Nada asignado';
  if (a.task === 'qa') return a.prNumber ? `Probando la PR #${a.prNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}` : 'Probando';
  if (a.task === 'fix' && a.prNumber) return `Corrigiendo la PR #${a.prNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  if (a.issueNumber) return `Issue #${a.issueNumber}${a.issueTitle ? `: ${a.issueTitle}` : ''}`;
  return a.issueTitle ?? 'Trabajando';
}

/** One row per person, in the order given (agentsOnRepo: by desk). */
export function floorRows(agents: Agent[], settings: Runtime, clis: CliView[]): FloorRow[] {
  return agents.map((a) => {
    const signIn = signInFor(a, settings);
    const kind = signIn ? 'attention' : STATUS_KIND[a.status];
    return {
      id: a.id,
      name: a.name,
      agent: agentLabel(a, settings, clis),
      status: signIn ? 'Necesita que inicies sesión' : STATUS_WORDS[a.status],
      kind,
      icon: KIND_ICON[kind],
      doing: signIn ? `Esperando a que se inicie sesión en ${signIn}${a.status === 'idle' ? '' : ` · ${doingText(a)}`}` : doingText(a),
      signIn,
    };
  });
}
