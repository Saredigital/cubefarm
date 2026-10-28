import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanySecurity } from '../company-security/security.ts';
import { CompanyStore } from './store.ts';
import { CompanyService, type SpecialistExecutor } from './service.ts';
import { demoSpecialistExecutor } from './demo.ts';
import { demoMailDatabase, SimulatedMailProvider } from '../mail/demo.ts';
import { MailService } from '../mail/service.ts';

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); });
function fixture(executor: SpecialistExecutor | undefined = demoSpecialistExecutor) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'company-domain-')); directories.push(directory);
  const store = new CompanyStore(directory); const security = new CompanySecurity({ demo: true });
  const login = security.login('demo-oficina'); const authority = security.authority({ headers: { cookie: `company_session=${login.token}` } });
  const service = new CompanyService(store, security, executor);
  const task = () => service.createTask(authority, { title: 'Preparar propuesta', objective: 'Describir una solución digital', departmentId: 'business', assigneeId: 'specialist:business', completionCriteria: 'Propuesta revisada por el responsable' });
  return { directory, store, security, authority, service, task };
}
describe('company work lifecycle', () => {
  it('preserves the next-action date when only an opportunity stage changes', () => {
    const f = fixture(); const contact = f.service.contact(f.authority, { name: 'Contacto de prueba' });
    const opportunity = f.service.opportunity(f.authority, { contactId: contact.id, name: 'Propuesta', nextAction: 'Revisar requisitos', nextActionAt: '2026-12-01T10:00:00.000Z', valueEuros: 1200 });
    expect(f.service.updateOpportunity(f.authority, opportunity.id, { stage: 'qualified' })).toEqual({ ...opportunity, stage: 'qualified' });
    expect(f.service.updateOpportunity(f.authority, opportunity.id, { nextActionAt: null })).toEqual({ ...opportunity, stage: 'qualified', nextActionAt: null });
  });
  it('preserves every omitted task field when finalizing an accepted deliverable', () => {
    const f = fixture(); const dependency = f.task();
    const project = f.service.createProject(f.authority, { name: 'Proyecto asociado', objective: 'Conservar el contexto', departmentIds: ['business'] });
    const task = f.service.createTask(f.authority, { title: 'Ficha del proyecto', objective: 'Preparar la ficha', departmentId: 'business', projectId: project.id, assigneeId: 'specialist:business', collaboratorIds: ['specialist:operations'], dependencyIds: [dependency.id], priority: 'urgent', dueAt: '2026-12-01T10:00:00.000Z', externalReference: 'ficha:123', completionCriteria: 'Ficha aceptada' });
    const deliverable = f.service.deliver(f.authority, task.id, { kind: 'document', title: 'Ficha', content: 'Contenido revisable' });
    f.service.review(f.authority, deliverable.id, { version: 1, decision: 'accepted' });
    const before = f.store.read().tasks.find((item) => item.id === task.id)!;
    const completed = f.service.updateTask(f.authority, task.id, { status: 'completed' });
    expect(completed).toEqual({ ...before, status: 'completed', updatedAt: completed.updatedAt });
    expect(f.store.read().tasks.find((item) => item.id === task.id)).toEqual(completed);
    expect(f.service.snapshot(f.authority).tasks.filter((item) => item.projectId === project.id)).toHaveLength(1);
  });
  it('preserves omitted fields on content edits and still allows explicit clearing', () => {
    const f = fixture(); const dependency = f.task();
    const project = f.service.createProject(f.authority, { name: 'Proyecto asociado', objective: 'Conservar el contexto', departmentIds: ['business'] });
    const task = f.service.createTask(f.authority, { title: 'Original', objective: 'Objetivo original', departmentId: 'business', projectId: project.id, assigneeId: 'specialist:business', collaboratorIds: ['specialist:operations'], dependencyIds: [dependency.id], priority: 'high', dueAt: '2026-12-01T10:00:00.000Z', externalReference: 'referencia', completionCriteria: 'Revisado' });
    const edited = f.service.updateTask(f.authority, task.id, { title: 'Nuevo título' });
    expect(edited).toEqual({ ...task, title: 'Nuevo título', updatedAt: edited.updatedAt });
    const cleared = f.service.updateTask(f.authority, task.id, { projectId: null, assigneeId: null, collaboratorIds: [], dependencyIds: [], dueAt: null, externalReference: null, priority: 'normal' });
    expect(cleared).toMatchObject({ projectId: null, assigneeId: null, collaboratorIds: [], dependencyIds: [], dueAt: null, externalReference: null, priority: 'normal', title: 'Nuevo título', objective: task.objective, completionCriteria: task.completionCriteria });
  });
  it('creates a department without GitHub and blocks archiving open work', () => {
    const f = fixture(); const department = f.service.createDepartment(f.authority, { name: 'Atención', mission: 'Resolver consultas', floor: 20 });
    expect(department.archived).toBe(false); const task = f.task();
    expect(() => f.service.updateDepartment(f.authority, task.departmentId, { archived: true })).toThrow('tareas abiertas');
  });
  it('rejects cycles and preserves transaction state', () => {
    const f = fixture(); const a = f.task(); const b = f.service.createTask(f.authority, { title: 'Dependiente', objective: 'Depender de la primera', departmentId: 'business', completionCriteria: 'Lista', dependencyIds: [a.id] });
    expect(() => f.service.updateTask(f.authority, a.id, { dependencyIds: [b.id] })).toThrow('ciclos');
    expect(f.store.read().tasks.find((task) => task.id === a.id)!.dependencyIds).toEqual([]);
  });
  it('requires dependency completion and a reviewed current deliverable', async () => {
    const f = fixture(); const a = f.task();
    const b = f.service.createTask(f.authority, { title: 'Seguimiento', objective: 'Seguir la propuesta', departmentId: 'operations', assigneeId: 'specialist:operations', completionCriteria: 'Seguimiento listo', dependencyIds: [a.id] });
    await expect(f.service.run(f.authority, b.id)).rejects.toThrow('dependencias');
    const result = await f.service.run(f.authority, a.id); expect(result.deliverable.versions[0].content).toContain('SIMULACIÓN DEMO');
    expect(() => f.service.updateTask(f.authority, a.id, { status: 'completed' })).toThrow('aprobar');
    f.service.review(f.authority, result.deliverable.id, { version: 1, decision: 'accepted' });
    f.service.version(f.authority, result.deliverable.id, { title: 'Segunda propuesta', content: 'Alcance actualizado' });
    expect(() => f.service.review(f.authority, result.deliverable.id, { version: 1, decision: 'accepted' })).toThrow('versión ha cambiado');
    expect(() => f.service.updateTask(f.authority, a.id, { status: 'completed' })).toThrow('aprobar');
    f.service.review(f.authority, result.deliverable.id, { version: 2, decision: 'accepted' });
    f.service.updateTask(f.authority, a.id, { status: 'completed' });
    await expect(f.service.run(f.authority, b.id)).resolves.toHaveProperty('deliverable.kind', 'document');
  });
  it('does not reuse an older acceptance after a new rejection', async () => {
    const f = fixture(); const task = f.task(); const result = await f.service.run(f.authority, task.id);
    f.service.review(f.authority, result.deliverable.id, { version: 1, decision: 'accepted' });
    f.service.review(f.authority, result.deliverable.id, { version: 1, decision: 'rejected' });
    expect(f.service.snapshot(f.authority).metrics.approvedDeliverables).toBe(0);
    expect(() => f.service.updateTask(f.authority, task.id, { status: 'completed' })).toThrow();
  });
  it('passes the approved current dependency result to the next specialist', async () => {
    const documents: { title: string; content: string }[][] = [];
    const executor: SpecialistExecutor = { mode: 'restricted', execute: async (input) => { documents.push(input.knowledge); return { title: input.task.title, content: 'Resultado de la investigación validada', kind: 'document', costEuros: 0 }; } };
    const f = fixture(executor); const first = f.task(); const next = f.service.createTask(f.authority, { title: 'Propuesta posterior', objective: 'Usar la investigación', departmentId: 'business', assigneeId: 'specialist:business', dependencyIds: [first.id], completionCriteria: 'Basada en la investigación' });
    const output = await f.service.run(f.authority, first.id); f.service.review(f.authority, output.deliverable.id, { version: 1, decision: 'accepted' }); f.service.updateTask(f.authority, first.id, { status: 'completed' });
    await f.service.run(f.authority, next.id); expect(documents[1]).toContainEqual({ title: first.title, content: 'Resultado de la investigación validada' });
  });
  it('allows reacceptance after rejection and bars review of a closed task', async () => {
    const f = fixture(); const task = f.task(); const output = await f.service.run(f.authority, task.id);
    f.service.review(f.authority, output.deliverable.id, { version: 1, decision: 'accepted' }); f.service.review(f.authority, output.deliverable.id, { version: 1, decision: 'rejected' }); f.service.review(f.authority, output.deliverable.id, { version: 1, decision: 'accepted' });
    // A fresh acceptance returns the task to review before completion.
    f.service.updateTask(f.authority, task.id, { status: 'completed' });
    expect(() => f.service.review(f.authority, output.deliverable.id, { version: 1, decision: 'rejected' })).toThrow('cerrada');
  });
  it('creates all marketing channels and cross-department dependencies', () => {
    const f = fixture(); const workflow = f.service.workflow(f.authority, { kind: 'marketing', objective: 'Dar a conocer un servicio' });
    expect(workflow.project.departmentIds).toEqual(['marketing', 'operations']); expect(workflow.tasks).toHaveLength(6);
    expect(f.service.snapshot(f.authority).calendar.map((entry) => entry.channel)).toEqual(['x', 'instagram', 'facebook', 'tiktok']);
  });
  it.each(['business', 'marketing', 'operations'] as const)('completes the entire %s demo workflow with human review', async (kind) => {
    const f = fixture(); const workflow = f.service.workflow(f.authority, { kind, objective: 'Objetivo de prueba completo' });
    for (let round = 0; round < 5; round++) {
      const result = await f.service.executeWorkflow(f.authority, workflow.project.id);
      for (const item of result.results) {
        f.service.review(f.authority, item.deliverable.id, { version: 1, decision: 'accepted' });
        f.service.updateTask(f.authority, item.run.taskId, { status: 'completed' });
      }
    }
    const tasks = f.service.snapshot(f.authority).tasks.filter((t) => t.projectId === workflow.project.id);
    expect(tasks).toHaveLength(workflow.tasks.length);
    expect(tasks.every((t) => t.status === 'completed')).toBe(true);
    expect(f.store.read().projects.every((p) => p.repositoryIds.length === 0)).toBe(true);
  });
  it('rejects execution when no isolated executor was supplied', async () => {
    const f = fixture(); const service = new CompanyService(f.store, f.security); const task = f.task();
    await expect(service.run(f.authority, task.id)).rejects.toThrow('entorno aislado');
  });
});
describe('company source authorization', () => {
  it('keeps a fresh human dashboard general after logout and hides restricted costs and activity', async () => {
    const f = fixture();
    f.security.seedGrants([{ agentId: 'specialist:business', mailboxId: 'private', capabilities: ['read'] }]);
    f.security.absorb(f.authority, { mailboxIds: ['private'], sourceIds: [] });
    const task = f.task(); const result = await f.service.run(f.authority, task.id);
    f.service.knowledge(f.authority, { title: 'Documento privado', content: 'Contenido confidencial' });
    f.store.transact((state) => { state.runs[0].costEuros = 12; state.agents.find((a) => a.id === 'specialist:business')!.spentEuros = 12; });
    f.security.revoke(f.authority);
    const login = f.security.login('demo-oficina'); const fresh = f.security.authority({ headers: { cookie: `company_session=${login.token}` } });
    const initial = f.service.snapshot(fresh);
    expect(initial.tasks).toEqual([]); expect(initial.deliverables).toEqual([]); expect(initial.knowledge).toEqual([]); expect(initial.runs).toEqual([]);
    expect(initial.metrics).toEqual({ pending: 0, blocked: 0, overdue: 0, inReview: 0, approvedDeliverables: 0, spentEuros: 0, opportunities: 0 });
    expect(initial.agents.every((agent) => agent.spentEuros === 0)).toBe(true);
    expect(JSON.stringify(initial)).not.toContain('Documento privado'); expect(JSON.stringify(initial)).not.toContain(task.title);
    expect(f.security.scope(fresh).mailboxIds).toEqual([]);
    f.store.transact((state) => { state.tasks[0].objective = 'Cambio privado invisible'; });
    expect(f.service.snapshot(fresh).revision).toBe(initial.revision);
    expect(f.service.createDepartment(fresh, { name: 'Nueva planta', mission: 'Administrar sin correo', floor: 25 })).toHaveProperty('name', 'Nueva planta');
    f.security.absorb(fresh, { mailboxIds: ['private'], sourceIds: [] }); const selected = f.service.snapshot(fresh);
    expect(selected.tasks.map((t) => t.id)).toEqual([task.id]); expect(selected.deliverables[0].id).toBe(result.deliverable.id); expect(selected.metrics.spentEuros).toBe(12);
  });
  it('hides the entire document when its current version is restricted instead of returning an old version', () => {
    const f = fixture(); const document = f.service.knowledge(f.authority, { title: 'Versión pública anterior', content: 'Texto anterior' });
    f.security.absorb(f.authority, { mailboxIds: ['private'], sourceIds: [] });
    f.service.knowledgeVersion(f.authority, document.id, { title: 'Actual restringida', content: 'Texto actual' });
    const login = f.security.login('demo-oficina'); const fresh = f.security.authority({ headers: { cookie: `company_session=${login.token}` } });
    expect(f.service.snapshot(fresh).knowledge).toEqual([]);
    expect(f.service.snapshot(f.security.issueAgent('specialist:operations').authority).knowledge).toEqual([]);
    f.security.absorb(fresh, { mailboxIds: ['private'], sourceIds: [] });
    expect(f.service.snapshot(fresh).knowledge[0].versions.at(-1)!.title).toBe('Actual restringida');
  });
  it('creates a mail draft from the exact accepted server version with authorized source context', async () => {
    const f = fixture(); const provider = new SimulatedMailProvider('mail-negocio');
    const mail = new MailService(f.security, new Map([['mail-negocio', provider]]), undefined, demoMailDatabase());
    f.security.seedGrants([{ agentId: 'specialist:business', mailboxId: 'mail-negocio', capabilities: ['read'] }]);
    const message = mail.read(f.authority, 'mail-negocio-mensaje');
    const service = new CompanyService(f.store, f.security, demoSpecialistExecutor, (authority, provenance) => mail.context(authority, provenance));
    const task = f.task(); const result = await service.run(f.authority, task.id);
    const input = { version: 1, mailboxId: message.mailboxId, messageId: message.id };
    const create = (authority: Parameters<MailService['createDraft']>[0], content: Parameters<MailService['createDraft']>[1]) => {
      const source = mail.read(authority, content.messageId!); return mail.createDraft(authority, { ...content, to: content.to ?? [source.from] });
    };
    expect(() => service.mailDraft(f.authority, result.deliverable.id, input, create)).toThrow('aprobada');
    service.review(f.authority, result.deliverable.id, { version: 1, decision: 'accepted' });
    expect(() => service.mailDraft(f.authority, result.deliverable.id, { ...input, body: 'Texto inyectado' }, create)).toThrow('Datos de empresa');
    const draft = service.mailDraft(f.authority, result.deliverable.id, input, create) as ReturnType<MailService['createDraft']>;
    expect(draft.body).toBe(result.deliverable.versions[0].content); expect(draft.subject).toBe(result.deliverable.versions[0].title);
    expect(draft.to).toEqual([message.from]); expect(draft.status).toBe('draft'); expect(draft.approval).toBeUndefined(); expect(provider.sent).toEqual([]);
    expect(draft.provenance).toEqual({ mailboxIds: ['mail-negocio'], sourceIds: ['mail-negocio-mensaje'] });
    service.version(f.authority, result.deliverable.id, { title: 'Nueva versión', content: 'Contenido cambiado' });
    expect(() => service.mailDraft(f.authority, result.deliverable.id, input, create)).toThrow('ha cambiado');
    expect(() => service.mailDraft(f.authority, result.deliverable.id, { ...input, version: 2 }, create)).toThrow('aprobada');
    expect(() => service.mailDraft(f.security.issueAgent('specialist:business').authority, result.deliverable.id, input, create)).toThrow('responsable');
  });
  it('uses registered authority and rejects caller-supplied scope labels', () => {
    const f = fixture(); expect(() => f.service.snapshot({ principal: { kind: 'manager', id: 'responsable' }, provenance: { mailboxIds: [], sourceIds: [] } })).toThrow('Sesión');
    expect(() => f.service.createTask(f.authority, { title: 'Falsa', objective: 'Falsa', departmentId: 'business', completionCriteria: 'Falsa', provenance: { mailboxIds: [], sourceIds: [] } })).toThrow('Datos de empresa');
  });
  it('inherits sticky scopes, requires all source grants and hides restricted records from search and public metadata', () => {
    const f = fixture(); f.security.seedGrants([{ agentId: 'specialist:business', mailboxId: 'sales', capabilities: ['read'] }, { agentId: 'specialist:business', mailboxId: 'executive', capabilities: ['read'] }]);
    f.security.absorb(f.authority, { mailboxIds: ['sales', 'executive'], sourceIds: ['message:1'] });
    const task = f.task(); expect(task.provenance.mailboxIds).toEqual(['executive', 'sales']);
    const unauthorized = f.security.issueAgent('specialist:marketing').authority;
    expect(f.service.search(unauthorized, 'propuesta').tasks).toEqual([]);
    expect(JSON.stringify(f.service.publicView())).not.toContain('message:1');
    expect(() => f.service.updateTask(f.authority, task.id, { assigneeId: 'specialist:marketing' })).toThrow('destinatario');
    const authorized = f.security.issueAgent('specialist:business').authority;
    expect(f.service.snapshot(authorized).tasks).toHaveLength(1);
    expect(f.security.scope(authorized).mailboxIds).toEqual(['executive', 'sales']);
    expect(() => f.service.createDepartment(f.authority, { name: 'General', mission: 'General', floor: 21 })).toThrow('contexto contiene');
  });
  it('retains knowledge scopes across versions and bars agents from human reviews', () => {
    const f = fixture(); f.security.absorb(f.authority, { mailboxIds: ['private'], sourceIds: ['mail:1'] });
    const document = f.service.knowledge(f.authority, { title: 'Privado', content: 'Resumen del buzón' });
    f.service.knowledgeVersion(f.authority, document.id, { title: 'Resumen', content: 'Paráfrasis' });
    const agent = f.security.issueAgent('specialist:operations').authority;
    expect(f.service.snapshot(agent).knowledge).toEqual([]);
    expect(() => f.service.review(agent, 'anything', { version: 1, decision: 'accepted' })).toThrow('responsable');
  });
  it('never executes with the manager identity and cancels output after revocation', async () => {
    let finish: ((value: { title: string; content: string; kind: 'document'; costEuros: number }) => void) | undefined;
    const executor: SpecialistExecutor = { mode: 'restricted', execute: ({ authority, signal, maxCostEuros }) => { expect(authority.principal.kind).toBe('agent'); expect(maxCostEuros).toBe(15); expect(signal.aborted).toBe(false); return new Promise((resolve) => { finish = resolve; }); } };
    const f = fixture(executor); f.security.seedGrants([{ agentId: 'specialist:business', mailboxId: 'sales', capabilities: ['read'] }]);
    f.security.absorb(f.authority, { mailboxIds: ['sales'], sourceIds: [] }); const task = f.task(); const running = f.service.run(f.authority, task.id);
    await Promise.resolve();
    f.security.setGrant(f.authority, { agentId: 'specialist:business', mailboxId: 'sales', capabilities: [] });
    finish!({ title: 'Resultado', content: 'Contenido restringido', kind: 'document', costEuros: 0 });
    await expect(running).rejects.toThrow('No se ha completado'); expect(f.store.read().deliverables).toEqual([]);
  });
  it('enforces budget and concurrency before contacting the executor', async () => {
    const f = fixture(); f.service.updateProfile(f.authority, 'business', { budgetEuros: 0 });
    const task = f.task(); await expect(f.service.run(f.authority, task.id)).rejects.toThrow('presupuesto');
    f.service.updateProfile(f.authority, 'business', { budgetEuros: 10, maxConcurrentTasks: 1 });
    f.store.transact((s) => { s.runs.push({ id: 'busy', taskId: task.id, agentId: 'specialist:business', state: 'running', mode: 'demo', startedAt: new Date().toISOString(), finishedAt: null, costEuros: 0, reservedCostEuros: 0, error: null, provenance: task.provenance }); });
    await expect(f.service.run(f.authority, task.id)).rejects.toThrow('simultáneos');
  });
});
