import { describe, expect, it } from 'vitest';
import type { AgentView, HireRequestView } from '../shared/types.ts';
import { envSecrets, legacyAgent, legacyRequest } from './legacyState.ts';

type Agent = Omit<AgentView, 'log'>;

function agent(patch: Partial<Agent> = {}): Agent {
  return {
    id: 'ada',
    name: 'Ada',
    repoId: 'o/r',
    role: 'agent',
    look: 'feminine',
    task: 'issue',
    desk: 0,
    color: '#123456',
    hair: '#000000',
    skin: '#ffddcc',
    style: null,
    career: null,
    model: '',
    effort: '',
    cli: '',
    terminal: true,
    status: 'working',
    issueNumber: 1,
    issueTitle: 'First',
    branch: 'swarm/issue-1-ada',
    prNumber: null,
    prUrl: null,
    currentTool: 'Bash',
    startedAt: 1000,
    endedAt: null,
    costUsd: 1.23456,
    turns: 3,
    browserUrl: 'http://localhost:5200',
    hasScreenshot: true,
    screenshotAt: 5,
    lastError: null,
    ...patch,
  };
}

describe('records from before agents were interchangeable', () => {
  const { role: _role, ...rest } = agent();
  const old = (patch: Record<string, unknown>) => ({ ...rest, title: 'Audio engineer', specialty: 'audio', brief: 'Sounds', hiredBy: 'ceo', ...patch });

  it('makes developers agents at the same desk, without their title, specialty, brief or hiredBy', () => {
    const a = legacyAgent<Agent>(old({ role: 'dev', desk: 7 }));
    expect(a).toEqual(agent({ desk: 7 }));
    for (const k of ['title', 'specialty', 'brief', 'hiredBy']) expect(a).not.toHaveProperty(k);
  });

  it("seats QA testers at the east wall's desks, where their lab stations were", () => {
    expect(legacyAgent<Agent>(old({ role: 'qa', desk: 0, task: 'qa' }))).toMatchObject({ role: 'agent', desk: 12, task: 'qa' });
    expect(legacyAgent<Agent>(old({ role: 'qa', desk: 2 })).desk).toBe(14);
  });

  it("leaves the CEO and records already in the new shape alone, and drops old careers' specialties", () => {
    expect(legacyAgent<Agent>(old({ id: 'ceo', role: 'ceo', desk: 0 }))).toMatchObject({ role: 'ceo', desk: 0 });
    expect(legacyAgent(agent({ desk: 13 }))).toEqual(agent({ desk: 13 }));
    const career = { since: 1, opened: 2, merged: 1, firstPass: 1, qaPass: 1, qaFail: 0, fixRounds: 0, run: 1, best: 1, reviews: 0, costUsd: 0, turns: 0, recent: [], week: [] };
    expect(legacyAgent<Agent>(old({ role: 'dev', career: { ...career, bySpecialty: { audio: 1 } } })).career).toEqual(career);
  });

  it('turns an old hire proposal into a team change: no role, title, specialty or brief, the default coding agent', () => {
    const now: HireRequestView = { id: 'r1', kind: 'hire', repoId: 'o/r', agentId: null, name: 'Bo', reason: 'more hands', cli: '', model: '', effort: '', look: 'masculine', color: '', hair: '', skin: '', status: 'pending', note: '', createdAt: 1, decidedAt: null, decidedBy: null };
    const { cli: _cli, ...before } = now;
    expect(legacyRequest({ ...before, role: 'qa', title: 'QA tester', specialty: 'testing', brief: 'Test it' })).toEqual(now);
    expect(legacyRequest({ ...now, cli: 'codex' })).toEqual({ ...now, cli: 'codex' });
  });
});

describe('envSecrets', () => {
  it('picks the values of secret-sounding variables', () => {
    expect(envSecrets({ GITHUB_TOKEN: 'ghp_0123456789', PATH: '/usr/bin:/bin', ELEVENLABS_API_KEY: 'abcdefgh1234', SHORT_KEY: 'abc', DB_PASSWORD: 'hunter2hunter2' }).sort()).toEqual(['abcdefgh1234', 'ghp_0123456789', 'hunter2hunter2']);
  });
});
