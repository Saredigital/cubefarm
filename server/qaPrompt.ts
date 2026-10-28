// The parts of a QA session's instructions that depend on the PR: what GitHub's checks say (QA doesn't re-run what
// they already cover) and, on a re-test, how much to look at again (what changed, not the whole plan). Pure, so the
// wording is tested.

import type { PrDetails } from './github.ts';

export interface QaPromptInput extends Pick<PrDetails, 'headSha' | 'checks' | 'checkNames' | 'failedChecks' | 'pendingChecks'> {
  round: number;
  fixReason: 'qa' | 'checks' | 'conflict' | null;
  /** The commit the previous round tested (null on a first round or for records from before commits were tracked). */
  lastTestedSha: string | null;
  summary: string | null; // last round's findings
  fixInstructions: string | null;
  defaultBranch: string;
}

export interface QaInstructions {
  /** One line for the prompt: what the checks say right now. */
  checks: string;
  /** Step 3 of "How to test". */
  testStep: string;
  /** The re-test paragraph for the prompt, '' on a first round. */
  retest: string;
}

export function qaInstructions(i: QaPromptInput): QaInstructions {
  return { checks: checksLine(i), testStep: testStep(i.checks !== 'none'), retest: retest(i) };
}

function checksLine(i: QaPromptInput): string {
  const names = (list: string[]) => list.join(', ') || 'sin nombre';
  const state =
    i.checks === 'passing'
      ? `en verde (${names(i.checkNames)})`
      : i.checks === 'failing'
        ? `fallan: ${names(i.failedChecks)}${i.pendingChecks.length ? `; aún en curso: ${i.pendingChecks.join(', ')}` : ''}`
        : i.checks === 'pending'
          ? `en curso: ${names(i.pendingChecks)}`
          : 'ninguno';
  return `Checks de GitHub ahora mismo: ${state}`;
}

function testStep(hasChecks: boolean): string {
  return hasChecks
    ? '3. Los checks de GitHub se ejecutan en esta PR, y solo se fusiona cuando están en verde. Lee .github/workflows para ver qué cubren y no lo vuelvas a ejecutar en local. Ejecuta solo lo que necesites para probar el cambio (por ejemplo, un build para arrancar la app), lo que los checks no cubran o un check que falle, para reproducirlo. Un check que falla es un hallazgo: nómbralo.'
    : '3. Sin checks de GitHub, nadie más ejecuta las pruebas antes del merge: instala las dependencias si hace falta y ejecuta la batería de tests, los linters, las comprobaciones de tipos y el build del proyecto (los que existan).';
}

function retest(i: QaPromptInput): string {
  // A retried session (it crashed or the office restarted) already recorded this head: there's no diff to go by.
  const since = i.lastTestedSha && i.lastTestedSha !== i.headSha ? i.lastTestedSha : null;
  const diff = since
    ? `(git diff ${since}..HEAD), más una prueba rápida del flujo principal. No repitas el plan de pruebas completo en las partes que el cambio no ha tocado.`
    : null;
  // A conflict fix only merged the base: the resolution, CI and the places where the two meet are what can break.
  if (i.fixReason === 'conflict') {
    const merges = since ? ` (git log --merges ${since}..HEAD)` : '';
    return `\nQA ya la aprobó, pero desde entonces la rama se ha actualizado con ${i.defaultBranch} para resolver conflictos de merge. Revisa la resolución con git show --remerge-diff sobre los commits de merge${merges}, confirma que los checks de GitHub están en verde en el nuevo head y haz una prueba rápida de la funcionalidad de esta PR y de lo que toquen los ficheros en conflicto. No repitas el plan de pruebas completo.`;
  }
  if (i.fixReason === 'checks') {
    return `\nQA ya la aprobó, pero desde entonces el desarrollador ha cambiado el código para arreglar checks de GitHub que fallaban. ${diff ? `Prueba lo que ha cambiado desde que QA la aprobó ${diff}` : 'Comprueba los criterios de aceptación con pruebas proporcionales al riesgo; reutiliza la evidencia válida del mismo commit.'}`;
  }
  if (i.round > 1 && i.summary) {
    return `\nEs una nueva prueba tras correcciones. Hallazgos de la ronda anterior:\n${i.summary}\n${i.fixInstructions ?? ''}\nComprueba eso primero y después ${diff ? `prueba lo que ha cambiado desde la ronda anterior ${diff}` : 'revisa el resto según el riesgo del diff, sin repetir comprobaciones válidas del mismo commit.'}`;
  }
  return '';
}
