import { describe, expect, it } from 'vitest';
import type { CompanyTask } from '../../../shared/company';
import { hasCurrentMailApproval, readyToRun, splitLines } from './logic';

const task = (id: string, overrides: Partial<CompanyTask> = {}): CompanyTask => ({ id, title: id, objective: '', departmentId: 'marketing', projectId: null, assigneeId: 'specialist', collaboratorIds: [], priority: 'normal', dueAt: null, dependencyIds: [], completionCriteria: '', status: 'pending', provenance: { mailboxIds: [], sourceIds: [] }, createdAt: '', updatedAt: '', runId: null, externalReference: null, ...overrides });
describe('disponibilidad de tareas de empresa', () => {
  it('requiere responsable y todas las dependencias terminadas, incluidas las que no se pueden recuperar', () => {
    expect(readyToRun('a', { tasks: [task('a', { assigneeId: null })] })).toBe(false);
    expect(readyToRun('a', { tasks: [task('a', { dependencyIds: ['missing'] })] })).toBe(false);
    expect(readyToRun('a', { tasks: [task('a', { dependencyIds: ['b'] }), task('b', { status: 'in_review' })] })).toBe(false);
    expect(readyToRun('a', { tasks: [task('a', { dependencyIds: ['b'] }), task('b', { status: 'completed' })] })).toBe(true);
  });
  it('no ofrece volver a ejecutar tareas activas o cerradas', () => {
    for (const status of ['completed', 'cancelled', 'in_progress'] as const) expect(readyToRun('a', { tasks: [task('a', { status })] })).toBe(false);
  });
  it('normaliza plantillas editables con finales de línea de Windows', () => {
    expect(splitLines(' redactar \r\n\r\n revisar\n ')).toEqual(['redactar', 'revisar']);
  });
});

it('invalida la aprobación de correo por versión, huella o caducidad y exige estado aprobado', () => {
  const draft = { version: 2, contentHash: 'exact', status: 'approved' as const, approval: { managerId: 'human', version: 2, contentHash: 'exact', expiresAt: '2026-10-20T12:00:00Z' } };
  const now = Date.parse('2026-10-20T11:00:00Z');
  expect(hasCurrentMailApproval(draft, now)).toBe(true);
  expect(hasCurrentMailApproval({ ...draft, version: 3 }, now)).toBe(false);
  expect(hasCurrentMailApproval({ ...draft, contentHash: 'edited' }, now)).toBe(false);
  expect(hasCurrentMailApproval({ ...draft, status: 'draft' }, now)).toBe(false);
  expect(hasCurrentMailApproval(draft, Date.parse(draft.approval.expiresAt))).toBe(false);
});
