import { describe, expect, it } from 'vitest';
import { acceptCodexCompletion, lostConversation, resumableSession } from './cliRunner.ts';

describe('resumableSession', () => {
  const onDisk = (files: string[]) => (file: string) => files.includes(file);
  const hook = { hook_event_name: 'PreToolUse', session_id: 'abc', transcript_path: 'abc.jsonl' };

  it("keeps the session once Claude Code's conversation file exists", () => {
    expect(resumableSession(hook, onDisk(['abc.jsonl']))).toBe('abc');
  });

  it("doesn't keep it while the file isn't written yet (SessionStart, UserPromptSubmit)", () => {
    expect(resumableSession({ ...hook, hook_event_name: 'UserPromptSubmit' }, onDisk([]))).toBeNull();
  });

  it("doesn't keep it from a call with no transcript path (the status line) or no session", () => {
    expect(resumableSession({ hook_event_name: 'StatusLine', session_id: 'abc' }, () => true)).toBeNull();
    expect(resumableSession({ hook_event_name: 'Stop', transcript_path: 'abc.jsonl' }, () => true)).toBeNull();
  });
});

describe('lostConversation', () => {
  it("spots Claude Code's message for a resume with nothing to resume", () => {
    expect(lostConversation('\n No conversation found with session ID: 6cc74c7e-0c81-4bff-a140-cc8307c1d11b\n')).toBe(true);
  });

  it('ignores other screens', () => {
    expect(lostConversation('Claude Code v2.1.280\n❯ ')).toBe(false);
  });
});

describe('Codex completion after reconnect', () => {
  it('recognizes the first completion with prompts restored from keeper metadata', () => {
    const prompts = JSON.parse(JSON.stringify(['Resuelve el issue de GitHub #1: revisa el SEO']));
    expect(acceptCodexCompletion(null, 'main', prompts, prompts[0])).toBe(true);
    expect(acceptCodexCompletion(null, 'title-thread', prompts, 'Generate a short title')).toBe(false);
    expect(acceptCodexCompletion(null, 'unknown', [''], 'anything')).toBe(false);
  });
  it('accepts only the known thread, even for a follow-up typed in the terminal', () => {
    expect(acceptCodexCompletion('main', 'main', [], 'otra pregunta')).toBe(true);
    expect(acceptCodexCompletion('main', 'child', ['same'], 'same')).toBe(false);
  });
});
