import { describe, expect, it } from 'vitest';
import { checkTriageTarget, MAX_TRIAGES, triageStep } from './triage.ts';

describe('triageStep', () => {
  it('sends the first and second needs-human to the CEO, the third to the manager', () => {
    expect(triageStep({ kind: 'stuck', triages: 0 })).toEqual({ do: 'triage' });
    expect(triageStep({ kind: 'stuck', triages: 1 })).toEqual({ do: 'triage' });
    expect(triageStep({ kind: 'stuck', triages: MAX_TRIAGES })).toEqual({ do: 'escalate', note: 'El CEO ya la ha revisado 2 veces.' });
  });

  it('hands an escalation to the manager with the CEO’s reason', () => {
    expect(triageStep({ kind: 'escalate', reason: ' Needs a product call on the API shape. ' })).toEqual({ do: 'escalate', note: 'Needs a product call on the API shape.' });
    expect(triageStep({ kind: 'escalate', reason: '  ' })).toEqual({ do: 'escalate', note: null });
  });

  it('escalates a triage that ended without action, and leaves one that acted alone', () => {
    expect(triageStep({ kind: 'ended', acted: false })).toEqual({ do: 'escalate', note: 'El CEO la ha revisado, pero no ha tomado ninguna medida.' });
    expect(triageStep({ kind: 'ended', acted: true })).toEqual({ do: 'nothing' });
  });
});

describe('checkTriageTarget', () => {
  const ok = { jobFloor: 2, floor: 2, pr: 12, pull: { state: 'OPEN' }, status: 'needs-human' as const };

  it('lets a triage job act on a stuck PR on its own floor', () => {
    expect(() => checkTriageTarget(ok)).not.toThrow();
  });

  it('refuses outside a triage job', () => {
    expect(() => checkTriageTarget({ ...ok, jobFloor: null })).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('refuses another floor’s PR and unknown PRs with 404', () => {
    expect(() => checkTriageTarget({ ...ok, floor: 3 })).toThrow(expect.objectContaining({ status: 404, message: "Este triaje es de la planta 2: no puedes cambiar la PR #12 de la planta 3." }));
    expect(() => checkTriageTarget({ ...ok, pull: undefined })).toThrow(expect.objectContaining({ status: 404 }));
  });

  it('refuses closed and merged PRs with 409', () => {
    expect(() => checkTriageTarget({ ...ok, pull: { state: 'CLOSED' } })).toThrow(expect.objectContaining({ status: 409, message: 'La PR #12 está cerrada, así que no hay nada que decidir.' }));
    expect(() => checkTriageTarget({ ...ok, pull: { state: 'MERGED' } })).toThrow(expect.objectContaining({ status: 409 }));
  });

  it('refuses a PR that is not waiting on a decision', () => {
    expect(() => checkTriageTarget({ ...ok, status: 'testing' })).toThrow(expect.objectContaining({ status: 409, message: "La PR #12 no está esperando una decisión humana." }));
    expect(() => checkTriageTarget({ ...ok, status: undefined })).toThrow(expect.objectContaining({ status: 409 }));
  });
});
