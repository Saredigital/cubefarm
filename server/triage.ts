import type { QaStatus } from '../shared/types.ts';
import { HttpError } from './httpError.ts';

// Stuck PRs go to the CEO before the manager. When a QA record becomes needs-human the CEO gets a triage job and can
// retry QA, send it back, re-run its checks, close it or escalate. Each PR gets at most MAX_TRIAGES of them, so a PR
// that keeps getting stuck still reaches the manager; so does one the CEO looked at without doing anything.

/** Triage jobs one PR can get; the next time it gets stuck it goes straight to the manager. */
export const MAX_TRIAGES = 2;

export type TriageEvent =
  | { kind: 'stuck'; triages: number } // the record just became needs-human; triages: how many it already had
  | { kind: 'escalate'; reason: string } // the CEO called escalate
  | { kind: 'ended'; acted: boolean }; // a triage job finished; acted: the PR is no longer waiting on a decision

export type TriageStep = { do: 'triage' } | { do: 'escalate'; note: string | null } | { do: 'nothing' };

/** Triage or escalate. note: what the manager's alert adds to the reason the PR got stuck. */
export function triageStep(e: TriageEvent): TriageStep {
  switch (e.kind) {
    case 'stuck':
      return e.triages < MAX_TRIAGES ? { do: 'triage' } : { do: 'escalate', note: `El CEO ya la ha revisado ${e.triages === 1 ? 'una vez' : `${e.triages} veces`}.` };
    case 'escalate':
      return { do: 'escalate', note: e.reason.trim() || null };
    case 'ended':
      return e.acted ? { do: 'nothing' } : { do: 'escalate', note: 'El CEO la ha revisado, pero no ha tomado ninguna medida.' };
  }
}

/**
 * Whether a triage tool may act on PR #pr of `floor`: only in a triage job, only on that job's floor, and only on an
 * open PR that is waiting on a decision. Throws HttpError 404 (another floor's or an unknown PR) or 409 (no triage
 * job, a closed PR, or one that isn't stuck).
 */
export function checkTriageTarget(r: {
  jobFloor: number | null; // the floor of the CEO's current triage job; null when it isn't on one
  floor: number;
  pr: number;
  pull: { state: string } | undefined; // the PR as the floor last synced it
  status: QaStatus | undefined; // its QA record
}) {
  if (r.jobFloor == null) throw new HttpError(409, 'Las herramientas de triaje solo funcionan durante un trabajo de triaje.');
  if (r.floor !== r.jobFloor) throw new HttpError(404, `Este triaje es de la planta ${r.jobFloor}: no puedes cambiar la PR #${r.pr} de la planta ${r.floor}.`);
  if (!r.pull) throw new HttpError(404, `No hay ninguna PR #${r.pr} en la planta ${r.floor}.`);
  if (r.pull.state !== 'OPEN') throw new HttpError(409, `La PR #${r.pr} está ${r.pull.state === 'MERGED' ? 'fusionada' : 'cerrada'}, así que no hay nada que decidir.`);
  if (r.status !== 'needs-human') throw new HttpError(409, `La PR #${r.pr} no está esperando una decisión humana.`);
}

/** The PR facts a triage job's prompt carries. */
export interface TriagePr {
  number: number;
  title: string;
  url: string;
  round: number;
  why: string | null; // why it got stuck
  summary: string | null;
  fixInstructions: string | null;
  mergeNote: string | null;
  checks: string; // GitHub's checks rollup: passing / failing / pending / none
  failedChecks: string[];
  pendingChecks: string[];
  mergeable: string;
  mergeState: string;
  triage: number; // this is triage n of MAX_TRIAGES
}
