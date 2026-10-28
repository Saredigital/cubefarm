import { describe, expect, it } from 'vitest';
import { qaInstructions, type QaPromptInput } from './qaPrompt.ts';

const OLD = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);

const input = (i: Partial<QaPromptInput> = {}): QaPromptInput => ({
  headSha: HEAD,
  checks: 'passing',
  checkNames: ['check (ubuntu-latest)', 'e2e'],
  failedChecks: [],
  pendingChecks: [],
  round: 1,
  fixReason: null,
  lastTestedSha: null,
  summary: null,
  fixInstructions: null,
  defaultBranch: 'main',
  ...i,
});

const TODAYS_STEP = '3. Instala las dependencias si hace falta (p. ej. npm install si falta node_modules) y ejecuta la batería de tests, los linters, las comprobaciones de tipos y el build del proyecto (los que existan).';

describe('qaInstructions: GitHub checks', () => {
  it('passing: names them and says not to re-run what they cover', () => {
    const qa = qaInstructions(input());
    expect(qa.checks).toBe('Checks de GitHub ahora mismo: en verde (check (ubuntu-latest), e2e)');
    expect(qa.testStep).toContain('no lo vuelvas a ejecutar en local');
    expect(qa.testStep).not.toContain('batería de tests');
  });

  it('failing: lists the failing checks and asks for them as findings', () => {
    const qa = qaInstructions(input({ checks: 'failing', failedChecks: ['e2e', 'lint'] }));
    expect(qa.checks).toBe('Checks de GitHub ahora mismo: fallan: e2e, lint');
    expect(qa.testStep).toContain('Un check que falla es un hallazgo');
  });

  it('failing while others still run: says which are still running', () => {
    expect(qaInstructions(input({ checks: 'failing', failedChecks: ['e2e'], pendingChecks: ['check (macos-latest)'] })).checks).toBe(
      'Checks de GitHub ahora mismo: fallan: e2e; aún en curso: check (macos-latest)',
    );
  });

  it('pending: lists what is still running and still trusts the checks', () => {
    const qa = qaInstructions(input({ checks: 'pending', pendingChecks: ['check (macos-latest)'] }));
    expect(qa.checks).toBe('Checks de GitHub ahora mismo: en curso: check (macos-latest)');
    expect(qa.testStep).not.toBe(TODAYS_STEP);
  });

  it('no checks: keeps the full local run', () => {
    const qa = qaInstructions(input({ checks: 'none', checkNames: [] }));
    expect(qa.checks).toBe('Checks de GitHub ahora mismo: ninguno');
    expect(qa.testStep).toBe(TODAYS_STEP);
  });
});

describe('qaInstructions: re-tests', () => {
  const failedRound = { round: 2, fixReason: 'qa' as const, summary: 'The toolbar overflows on phones.', fixInstructions: 'Let it wrap.' };

  it('says nothing extra on a first round', () => {
    expect(qaInstructions(input()).retest).toBe('');
  });

  it('round 2 with the last tested commit: last findings, then the diff since then, no full re-check', () => {
    const retest = qaInstructions(input({ ...failedRound, lastTestedSha: OLD })).retest;
    expect(retest).toContain('The toolbar overflows on phones.');
    expect(retest).toContain('Let it wrap.');
    expect(retest).toContain('Comprueba eso primero');
    expect(retest).toContain(`git diff ${OLD}..HEAD`);
    expect(retest).toContain('prueba rápida del flujo principal');
    expect(retest).not.toMatch(/vuelve a comprobar/i);
  });

  it('round 2 without the last tested commit: keeps the full re-check', () => {
    expect(qaInstructions(input({ ...failedRound, lastTestedSha: null })).retest).toBe(
      '\nEs una nueva prueba tras correcciones. Hallazgos de la ronda anterior:\nThe toolbar overflows on phones.\nLet it wrap.\nComprueba eso primero y después vuelve a comprobar todo lo demás.',
    );
  });

  it('a retried session whose head was already recorded: keeps the full re-check', () => {
    const retest = qaInstructions(input({ ...failedRound, lastTestedSha: HEAD })).retest;
    expect(retest).not.toContain('git diff');
    expect(retest).toContain('vuelve a comprobar todo lo demás');
  });

  it('a checks fix: tests what changed since QA passed it', () => {
    const retest = qaInstructions(input({ round: 3, fixReason: 'checks', lastTestedSha: OLD })).retest;
    expect(retest).toContain('arreglar checks de GitHub que fallaban');
    expect(retest).toContain(`git diff ${OLD}..HEAD`);
    expect(retest).not.toMatch(/vuelve a comprobar/i);
  });

  it('a checks fix without the last tested commit: keeps the full re-check', () => {
    expect(qaInstructions(input({ round: 3, fixReason: 'checks' })).retest).toBe(
      '\nQA ya la aprobó, pero desde entonces el desarrollador ha cambiado el código para arreglar checks de GitHub que fallaban. Vuelve a comprobarlo todo.',
    );
  });

  it('a conflict fix: a lighter re-check of the merge, CI and the feature', () => {
    const retest = qaInstructions(input({ round: 3, fixReason: 'conflict', lastTestedSha: OLD, defaultBranch: 'develop' })).retest;
    expect(retest).toContain('actualizado con develop para resolver conflictos de merge');
    expect(retest).toContain(`git show --remerge-diff sobre los commits de merge (git log --merges ${OLD}..HEAD)`);
    expect(retest).toContain('confirma que los checks de GitHub están en verde en el nuevo head');
    expect(retest).toContain('prueba rápida de la funcionalidad de esta PR y de lo que toquen los ficheros en conflicto');
    expect(retest).not.toContain('Vuelve a comprobarlo todo');
    expect(qaInstructions(input({ round: 3, fixReason: 'conflict' })).retest).toContain('sobre los commits de merge, confirma');
  });
});
