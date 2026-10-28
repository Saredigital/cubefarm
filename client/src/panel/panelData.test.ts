import { describe, expect, it } from 'vitest';
import { agentState, ago, ceoTask, initials, parseRoute, routeHash, taskIssue } from './panelData';

describe('panel routes', () => {
  it('reads pages and projects from the hash', () => {
    expect(parseRoute('')).toEqual({ page: 'overview' });
    expect(parseRoute('#/agents')).toEqual({ page: 'agents' });
    expect(parseRoute('#/settings')).toEqual({ page: 'settings' });
    expect(parseRoute('#/project/Saredigital/web/agents')).toEqual({ page: 'project', repoId: 'Saredigital/web', tab: 'agents' });
    expect(parseRoute('#/project/Saredigital/web')).toEqual({ page: 'project', repoId: 'Saredigital/web', tab: 'board' });
    expect(parseRoute('#/project/Saredigital/web/nonsense').tab).toBe('board');
    expect(parseRoute('#/project')).toEqual({ page: 'overview' });
    expect(parseRoute('#/nonsense')).toEqual({ page: 'overview' });
  });

  it('writes the hash it reads', () => {
    for (const r of [{ page: 'overview' }, { page: 'ceo' }, { page: 'project', repoId: 'a b/c', tab: 'settings' }] as const) {
      expect(parseRoute(routeHash(r))).toEqual(r);
    }
  });
});

describe('taskIssue', () => {
  it('titles the issue with the first sentence and keeps the whole text as the body', () => {
    expect(taskIssue('  Añadir modo oscuro. Que recuerde la elección.\nDetalles  ')).toEqual({
      title: 'Añadir modo oscuro',
      body: 'Añadir modo oscuro. Que recuerde la elección.\nDetalles',
    });
    expect(taskIssue('Arreglar el login')).toEqual({ title: 'Arreglar el login', body: 'Arreglar el login' });
  });

  it('cuts a long title at a word', () => {
    const { title } = taskIssue('palabra '.repeat(30));
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('palabra…')).toBe(true);
  });
});

describe('panel labels', () => {
  it("reads an agent's state", () => {
    expect(agentState({ status: 'idle', task: null })).toEqual({ label: 'Libre', tone: 'idle' });
    expect(agentState({ status: 'working', task: 'qa' }).label).toBe('Probando');
    expect(agentState({ status: 'working', task: 'fix' }).label).toBe('Corrigiendo');
    expect(agentState({ status: 'working', task: 'issue' }).label).toBe('Construyendo');
    expect(agentState({ status: 'error', task: 'issue' }).tone).toBe('bad');
  });

  it('says how long ago', () => {
    const now = 10_000_000;
    expect(ago(now - 10_000, now)).toBe('ahora');
    expect(ago(now - 5 * 60_000, now)).toBe('hace 5 min');
    expect(ago(now - 3 * 3_600_000, now)).toBe('hace 3 h');
    expect(ago(now - 2 * 86_400_000, now)).toBe('hace 2 d');
  });

  it('makes initials and the CEO request', () => {
    expect(initials('Ana María López')).toBe('AM');
    expect(initials('')).toBe('?');
    expect(ceoTask('web', ' Hacer X ')).toMatch(/proyecto web[\s\S]*\n\nHacer X$/);
  });
});
