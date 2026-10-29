// After an office restart: whose work picks up where it was, and what they're told. An agent still preparing a task
// hadn't started that task's session yet, so the session it remembers, or a CLI still busy in its terminal, belongs to
// an earlier task: resuming it would do that task again (a QA verdict posted twice) and pass the result off as this one.

import type { AgentTask } from '../shared/types.ts';

export interface RestartAgent {
  status: string;
  task: AgentTask | null;
  sessionId: string | null;
  branch: string | null;
  issueNumber: number | null;
  issueTitle: string | null;
  prNumber: number | null;
}

/** A CLI the terminal keeper kept running through the restart. resumeId: the session it is on, when known. */
export interface KeptCli {
  busy: boolean;
  resumeId: string | null;
}

/** The office follows a CLI that kept working through the restart only when it is on the agent's current task. */
export function followKeptCli(a: RestartAgent, cli: KeptCli | undefined): boolean {
  if (!cli?.busy || a.status === 'preparing') return false;
  return !(a.sessionId && cli.resumeId && cli.resumeId !== a.sessionId);
}

/**
 * An agent cut off by the restart resumes its session (true), or its work goes back in line: QA, the demo, and a task
 * that was still being prepared (preparing: its status when the office stopped), whose session never started.
 */
export function resumesAfterRestart(a: RestartAgent, preparing: boolean, demo: boolean): boolean {
  return !demo && !preparing && a.task !== 'qa' && !!a.sessionId && !!a.branch;
}

/** What a resumed agent is told: the job it was on, not just "carry on". */
export function resumeNote(a: RestartAgent, fix?: { round: number; fixReason: 'qa' | 'checks' | 'conflict' | null } | null): string {
  const yours = 'Los cambios sin commit de tu worktree son tuyos: termínalos. Escribe en español y conserva los comandos y marcadores literales.';
  if (a.task === 'fix' && a.prNumber && a.branch) {
    const job =
      fix?.fixReason === 'conflict'
        ? `resolviendo los conflictos de merge de la PR #${a.prNumber}`
        : fix?.fixReason === 'checks'
          ? `corrigiendo los checks fallidos de la PR #${a.prNumber}`
          : `corrigiendo la PR #${a.prNumber}${fix ? ` tras la ronda ${fix.round} de QA` : ''}`;
    return `El servidor de la oficina se ha reiniciado mientras estabas ${job}. Termina la corrección, haz commit y súbela con: git push origin HEAD:${a.branch}. ${yours}`;
  }
  if (a.task === 'issue' && a.issueNumber && a.branch) {
    const pr = a.prNumber
      ? `sube con: git push origin ${a.branch} para actualizar la PR #${a.prNumber}`
      : `sube con: git push -u origin ${a.branch}, y abre la pull request con "Closes #${a.issueNumber}" (o actualízala si ya está abierta)`;
    return `El servidor de la oficina se ha reiniciado mientras trabajabas en el issue #${a.issueNumber}${a.issueTitle ? ` (${a.issueTitle})` : ''} en la rama ${a.branch}. Termínalo, haz commit y ${pr}. ${yours}`;
  }
  if (a.task === 'analysis' && a.issueNumber) {
    return `El servidor de la oficina se ha reiniciado mientras analizabas el issue #${a.issueNumber}${a.issueTitle ? ` (${a.issueTitle})` : ''}. Termina el análisis sin tocar el repositorio y escribe el informe completo como mensaje final, en español.`;
  }
  return 'El servidor de la oficina se ha reiniciado mientras trabajabas. Comprueba el estado de tu worktree y continúa donde lo dejaste. Escribe en español.';
}
