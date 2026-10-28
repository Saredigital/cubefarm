import { describe, expect, it } from 'vitest';
import { followKeptCli, resumeNote, resumesAfterRestart, type RestartAgent } from './restartRecovery.ts';

const QA_SESSION = 'qa-session';
const FIX_SESSION = 'fix-session';

// Linus has just QA-tested PR #45 and been handed its fix; the office restarted before the fix session started.
const linus: RestartAgent = { status: 'preparing', task: 'fix', sessionId: QA_SESSION, branch: 'swarm/issue-12-ada', issueNumber: 12, issueTitle: 'Toolbar', prNumber: 45 };
const fixing: RestartAgent = { ...linus, status: 'working', sessionId: FIX_SESSION };

describe('resumesAfterRestart', () => {
  it("puts a fix that was still being prepared back in line instead of resuming the agent's old session", () => {
    expect(resumesAfterRestart(linus, true, false)).toBe(false);
    expect(resumesAfterRestart({ ...linus, sessionId: null }, false, false)).toBe(false); // runFix clears it now
    expect(resumesAfterRestart({ ...linus, task: 'issue' }, true, false)).toBe(false);
  });

  it('resumes a fix or an issue whose session was running', () => {
    expect(resumesAfterRestart(fixing, false, false)).toBe(true);
    expect(resumesAfterRestart({ ...fixing, task: 'issue', prNumber: null }, false, false)).toBe(true);
  });

  it('starts QA, the demo and agents with nothing to resume over', () => {
    expect(resumesAfterRestart({ ...fixing, task: 'qa' }, false, false)).toBe(false);
    expect(resumesAfterRestart(fixing, false, true)).toBe(false);
    expect(resumesAfterRestart({ ...fixing, branch: null }, false, false)).toBe(false);
  });
});

describe('followKeptCli', () => {
  it("follows a busy CLI on the agent's current session", () => {
    expect(followKeptCli(fixing, { busy: true, resumeId: FIX_SESSION })).toBe(true);
    expect(followKeptCli(fixing, { busy: true, resumeId: null })).toBe(true); // Codex: no thread id yet
    expect(followKeptCli({ ...fixing, sessionId: null }, { busy: true, resumeId: FIX_SESSION })).toBe(true); // its id not reported yet
  });

  it("doesn't follow one that belongs to another task", () => {
    expect(followKeptCli(linus, { busy: true, resumeId: QA_SESSION })).toBe(false); // the task hadn't started a session
    expect(followKeptCli({ ...linus, sessionId: null }, { busy: true, resumeId: QA_SESSION })).toBe(false);
    expect(followKeptCli(fixing, { busy: true, resumeId: QA_SESSION })).toBe(false);
  });

  it('leaves idle CLIs and missing ones alone', () => {
    expect(followKeptCli(fixing, { busy: false, resumeId: FIX_SESSION })).toBe(false);
    expect(followKeptCli(fixing, undefined)).toBe(false);
  });
});

describe('resumeNote', () => {
  it('restates a QA fix: the PR, the round and how to push', () => {
    const note = resumeNote(fixing, { round: 2, fixReason: 'qa' });
    expect(note).toContain('corrigiendo la PR #45 tras la ronda 2 de QA');
    expect(note).toContain('git push origin HEAD:swarm/issue-12-ada');
    expect(note).toContain('Los cambios sin commit de tu worktree son tuyos: termínalos.');
  });

  it('names a merge fix for what it is', () => {
    expect(resumeNote(fixing, { round: 2, fixReason: 'conflict' })).toContain('resolviendo los conflictos de merge de la PR #45');
    expect(resumeNote(fixing, { round: 2, fixReason: 'checks' })).toContain('corrigiendo los checks fallidos de la PR #45');
  });

  it('restates an issue: the issue, the branch, and opening or updating its PR', () => {
    const issue = { ...fixing, task: 'issue' as const, prNumber: null };
    expect(resumeNote(issue)).toContain('trabajabas en el issue #12 (Toolbar) en la rama swarm/issue-12-ada');
    expect(resumeNote(issue)).toContain('git push -u origin swarm/issue-12-ada');
    expect(resumeNote(issue)).toContain('"Closes #12"');
    expect(resumeNote({ ...issue, prNumber: 50 })).toContain('para actualizar la PR #50');
  });

  it('falls back to "carry on" for anything else', () => {
    expect(resumeNote({ ...fixing, task: null })).toMatch(/continúa donde lo dejaste/);
  });
});
