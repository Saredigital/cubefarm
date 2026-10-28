// General work orchestration. Authorization and source scopes come from the trusted session broker.
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CompanyAgent, CompanyDeliverable, CompanyPrincipal, CompanyProvenance, CompanySnapshot, CompanyState, CompanyTask, CompanyTaskStatus, SpecialistProfile } from '../../shared/company.ts';
import { HttpError } from '../httpError.ts';
import { CompanyStore } from './store.ts';
import type { MailContent } from '../../shared/mail.ts';

export interface CompanyAuthority { principal: CompanyPrincipal; provenance: CompanyProvenance }
export interface CompanyAuthorization {
  assertAuthority(authority: CompanyAuthority): void;
  scope(authority: CompanyAuthority, extra?: CompanyProvenance): CompanyProvenance;
  canRead(authority: CompanyAuthority, provenance: CompanyProvenance): boolean;
  canAssign(agentId: string, provenance: CompanyProvenance): boolean;
  absorb(authority: CompanyAuthority, provenance: CompanyProvenance): void;
  issueAgent(agentId: string): { authority: CompanyAuthority; signal: AbortSignal };
  revoke(authority: CompanyAuthority): void;
}
export interface SpecialistExecution {
  task: Pick<CompanyTask, 'title' | 'objective' | 'completionCriteria'>;
  profile: Pick<SpecialistProfile, 'instructions' | 'qualityCriteria'>;
  knowledge: { title: string; content: string }[];
  authority: CompanyAuthority;
  signal: AbortSignal;
  maxCostEuros: number;
  model?: string;
}
export interface SpecialistExecutor {
  mode: 'demo' | 'restricted';
  execute(input: SpecialistExecution): Promise<{ title: string; content: string; kind: CompanyDeliverable['kind']; costEuros: number }>;
}
export type CompanyMailDraftCreator = (authority: CompanyAuthority, input: Partial<MailContent>) => unknown | Promise<unknown>;
export function combineScopes(...values: CompanyProvenance[]): CompanyProvenance {
  return { mailboxIds: [...new Set(values.flatMap((v) => v.mailboxIds))].sort(), sourceIds: [...new Set(values.flatMap((v) => v.sourceIds))].sort() };
}
const text = z.string().trim().min(1).max(20_000);
const short = z.string().trim().min(1).max(200);
const ids = z.array(z.string().min(1).max(200)).max(100).default([]);
const date = z.string().datetime({ offset: true }).nullable().default(null);
const priority = z.enum(['low', 'normal', 'high', 'urgent']);
const status = z.enum(['pending', 'assigned', 'in_progress', 'in_review', 'completed', 'blocked', 'cancelled']);
const kind = z.enum(['document', 'proposal', 'social_content', 'report', 'code', 'email_draft']);
const profileSchema = z.object({ name: short, specialty: short, instructions: text, capabilities: z.array(short).min(1).max(20), qualityCriteria: z.array(short).max(20), maxConcurrentTasks: z.number().int().min(1).max(10), budgetEuros: z.number().min(0).max(10000) }).strict();
const taskSchema = z.object({ title: short, objective: text, projectId: z.string().nullable().default(null), departmentId: short, assigneeId: z.string().nullable().default(null), collaboratorIds: ids, priority: priority.default('normal'), dueAt: date, dependencyIds: ids, completionCriteria: text, externalReference: z.string().max(500).nullable().default(null) }).strict();
// Zod applies nested defaults even through .partial(); PATCH must only change supplied fields.
const taskUpdateSchema = taskSchema.extend({
  projectId: taskSchema.shape.projectId.removeDefault(),
  assigneeId: taskSchema.shape.assigneeId.removeDefault(),
  collaboratorIds: ids.removeDefault(),
  priority,
  dueAt: date.removeDefault(),
  dependencyIds: ids.removeDefault(),
  externalReference: taskSchema.shape.externalReference.removeDefault(),
  status,
}).partial();
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError(400, `Datos de empresa no válidos: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}.`);
  return parsed.data;
}
const now = () => new Date().toISOString();
const identify = () => randomUUID();
function find<T extends { id: string }>(items: T[], id: string): T {
  const result = items.find((i) => i.id === id); if (!result) throw new HttpError(404, 'No se ha encontrado el recurso.'); return result;
}
const accepted = (state: CompanyState, deliverable: CompanyDeliverable) => state.reviews.filter((review) => review.deliverableId === deliverable.id && review.version === deliverable.versions.at(-1)!.version).at(-1)?.decision === 'accepted';
const transitions: Record<CompanyTaskStatus, CompanyTaskStatus[]> = { pending: ['assigned', 'blocked', 'cancelled'], assigned: ['in_progress', 'blocked', 'cancelled'], in_progress: ['in_review', 'blocked', 'cancelled'], in_review: ['completed', 'in_progress', 'blocked', 'cancelled'], completed: [], blocked: ['pending', 'assigned', 'cancelled'], cancelled: [] };

export class CompanyService {
  private controllers = new Map<string, AbortController>();
  constructor(readonly store: CompanyStore, readonly authorization: CompanyAuthorization, readonly executor?: SpecialistExecutor, readonly resolveSources?: (authority: CompanyAuthority, provenance: CompanyProvenance) => Promise<{ title: string; content: string }[]> | { title: string; content: string }[]) {}
  private manager(authority: CompanyAuthority, general = false): void {
    this.authorization.assertAuthority(authority);
    if (authority.principal.kind !== 'manager') throw new HttpError(403, 'Esta acción requiere al responsable.');
    if (general && this.authorization.scope(authority).mailboxIds.length) throw new HttpError(403, 'El contexto contiene información restringida. Abre una sesión nueva para editar información general.');
  }
  private read(authority: CompanyAuthority, provenance: CompanyProvenance): void {
    this.authorization.assertAuthority(authority);
    if (!this.authorization.canRead(authority, provenance)) throw new HttpError(404, 'No se ha encontrado el recurso.');
    this.authorization.absorb(authority, provenance);
  }
  private provenance(authority: CompanyAuthority, ...sources: CompanyProvenance[]): CompanyProvenance {
    const result = combineScopes(this.authorization.scope(authority), ...sources);
    this.read(authority, result); return result;
  }
  private recipients(state: CompanyState, task: Pick<CompanyTask, 'assigneeId' | 'collaboratorIds' | 'provenance'>): void {
    for (const id of [task.assigneeId, ...task.collaboratorIds].filter((v): v is string => !!v)) {
      const agent = find(state.agents, id);
      if (!agent.enabled || !this.authorization.canAssign(id, task.provenance)) throw new HttpError(403, 'Un destinatario no dispone de todos los accesos necesarios.');
    }
  }
  private ownTask(authority: CompanyAuthority, task: CompanyTask): void {
    this.read(authority, task.provenance);
    if (authority.principal.kind !== 'manager' && authority.principal.agentId !== task.assigneeId && !task.collaboratorIds.includes(authority.principal.agentId ?? '')) throw new HttpError(403, 'La tarea no está asignada a esta sesión.');
  }
  private checkDependencies(state: CompanyState, task: CompanyTask): void {
    const visit = (id: string, path: Set<string>): void => {
      if (path.has(id)) throw new HttpError(409, 'Las dependencias no pueden formar ciclos.');
      const item = find(state.tasks, id); const next = new Set(path).add(id);
      for (const dependency of item.dependencyIds) visit(dependency, next);
    };
    visit(task.id, new Set());
  }
  snapshot(authority: CompanyAuthority): CompanySnapshot {
    this.authorization.assertAuthority(authority);
    const state = this.store.read();
    // The human dashboard starts with general information. Restricted work is revealed only after an
    // explicit source selection/read has introduced all its mailbox scopes into this session.
    const selected = this.authorization.scope(authority);
    const allowed = (p: CompanyProvenance) => this.authorization.canRead(authority, p) && (authority.principal.kind === 'agent' || p.mailboxIds.every((id) => selected.mailboxIds.includes(id)));
    state.projects = state.projects.filter((p) => allowed(p.provenance));
    state.tasks = state.tasks.filter((t) => allowed(t.provenance));
    const tasks = new Set(state.tasks.map((t) => t.id));
    state.comments = state.comments.filter((c) => tasks.has(c.taskId) && allowed(c.provenance));
    state.deliverables = state.deliverables.filter((d) => tasks.has(d.taskId) && allowed(d.versions.at(-1)!.provenance));
    const deliverables = new Set(state.deliverables.map((d) => d.id));
    state.reviews = state.reviews.filter((r) => deliverables.has(r.deliverableId) && allowed(r.provenance));
    // Never display an older revision as though it were the current document when its latest scope is hidden.
    state.knowledge = state.knowledge.filter((k) => allowed(k.versions.at(-1)!.provenance));
    state.contacts = state.contacts.filter((c) => allowed(c.provenance));
    state.opportunities = state.opportunities.filter((o) => allowed(o.provenance));
    state.calendar = state.calendar.filter((c) => tasks.has(c.taskId) && allowed(c.provenance));
    state.runs = state.runs.filter((r) => tasks.has(r.taskId) && allowed(r.provenance));
    // Per-agent costs are derived from the records this session may see, never from restricted global totals.
    state.agents = state.agents.map((agent) => ({ ...agent, spentEuros: state.runs.filter((run) => run.agentId === agent.id).reduce((sum, run) => sum + run.costEuros, 0) }));
    state.revision = 0;
    state.revision = Number.parseInt(createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 12), 16);
    const allScopes = [...state.projects, ...state.tasks, ...state.comments, ...state.reviews, ...state.contacts, ...state.opportunities, ...state.calendar, ...state.runs, ...state.deliverables.flatMap((d) => d.versions), ...state.knowledge.flatMap((k) => k.versions)].map((v) => v.provenance);
    this.authorization.absorb(authority, combineScopes(...allScopes));
    return { ...state, metrics: { pending: state.tasks.filter((t) => ['pending', 'assigned'].includes(t.status)).length, blocked: state.tasks.filter((t) => t.status === 'blocked').length, overdue: state.tasks.filter((t) => t.dueAt && t.dueAt < now() && !['completed', 'cancelled'].includes(t.status)).length, inReview: state.tasks.filter((t) => t.status === 'in_review').length, approvedDeliverables: state.deliverables.filter((d) => accepted(state, d)).length, spentEuros: state.runs.reduce((sum, r) => sum + r.costEuros, 0), opportunities: state.opportunities.length }, runtime: { mode: this.executor?.mode ?? 'blocked', reason: this.executor ? null : 'La ejecución está desactivada hasta verificar un entorno aislado.' } };
  }
  publicView() {
    const state = this.store.read();
    return { name: state.company.name, departments: state.departments.filter((d) => !d.archived), agents: state.agents.filter((a) => a.enabled).map(({ id, name, departmentId, profileId }) => ({ id, name, departmentId, profileId })) };
  }
  updateCompany(authority: CompanyAuthority, body: unknown) {
    this.manager(authority, true); const value = parse(z.object({ name: short, objective: text }).strict(), body);
    return this.store.transact((s) => s.company = value);
  }
  createDepartment(authority: CompanyAuthority, body: unknown) {
    this.manager(authority, true); const value = parse(z.object({ name: short, mission: text, managerId: z.string().nullable().default(null), floor: z.number().int().min(1).max(100), order: z.number().int().min(0).default(0) }).strict(), body);
    return this.store.transact((s) => { if (s.departments.some((d) => d.floor === value.floor && !d.archived)) throw new HttpError(409, 'Esa planta ya está asignada.'); const entity = { id: identify(), ...value, archived: false }; s.departments.push(entity); return entity; });
  }
  updateDepartment(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority, true); const value = parse(z.object({ name: short.optional(), mission: text.optional(), managerId: z.string().nullable().optional(), floor: z.number().int().min(1).max(100).optional(), order: z.number().int().min(0).optional(), archived: z.boolean().optional() }).strict(), body);
    return this.store.transact((s) => { const department = find(s.departments, id); if (value.archived && s.tasks.some((t) => t.departmentId === id && !['completed', 'cancelled'].includes(t.status))) throw new HttpError(409, 'El departamento tiene tareas abiertas.'); if (value.floor && s.departments.some((d) => d.id !== id && d.floor === value.floor && !d.archived)) throw new HttpError(409, 'Esa planta ya está asignada.'); Object.assign(department, value); return department; });
  }
  createProject(authority: CompanyAuthority, body: unknown) {
    this.manager(authority); const value = parse(z.object({ name: short, objective: text, departmentIds: ids, repositoryIds: ids }).strict(), body); const provenance = this.provenance(authority);
    return this.store.transact((s) => { for (const id of value.departmentIds) if (find(s.departments, id).archived) throw new HttpError(409, 'El departamento está archivado.'); const entity = { id: identify(), ...value, status: 'active' as const, provenance }; s.projects.push(entity); return entity; });
  }
  createProfile(authority: CompanyAuthority, body: unknown) {
    this.manager(authority, true); const value = parse(profileSchema, body); return this.store.transact((s) => { const entity = { id: identify(), ...value }; s.profiles.push(entity); return entity; });
  }
  updateProfile(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority, true); const value = parse(profileSchema.partial(), body); return this.store.transact((s) => { const entity = find(s.profiles, id); Object.assign(entity, value); return entity; });
  }
  createAgent(authority: CompanyAuthority, body: unknown) {
    this.manager(authority, true); const value = parse(z.object({ name: short, departmentId: short, profileId: short, model: z.string().max(200).default('') }).strict(), body);
    return this.store.transact((s) => { if (find(s.departments, value.departmentId).archived) throw new HttpError(409, 'El departamento está archivado.'); find(s.profiles, value.profileId); const entity: CompanyAgent = { id: identify(), ...value, enabled: true, spentEuros: 0 }; s.agents.push(entity); return entity; });
  }
  updateAgent(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority, true); const value = parse(z.object({ name: short.optional(), profileId: short.optional(), departmentId: short.optional(), model: z.string().max(200).optional(), enabled: z.boolean().optional() }).strict(), body);
    return this.store.transact((s) => { const agent = find(s.agents, id); if (value.profileId) find(s.profiles, value.profileId); if (value.departmentId && find(s.departments, value.departmentId).archived) throw new HttpError(409, 'El departamento está archivado.'); Object.assign(agent, value); return agent; });
  }
  createTask(authority: CompanyAuthority, body: unknown) {
    this.manager(authority); const value = parse(taskSchema, body);
    return this.store.transact((s) => {
      if (find(s.departments, value.departmentId).archived) throw new HttpError(409, 'El departamento está archivado.');
      const project = value.projectId ? find(s.projects, value.projectId) : null;
      if (project && !project.departmentIds.includes(value.departmentId)) throw new HttpError(409, 'El departamento no participa en este proyecto.');
      const provenance = this.provenance(authority, ...(project ? [project.provenance] : []), ...value.dependencyIds.map((id) => find(s.tasks, id).provenance));
      const entity: CompanyTask = { id: identify(), ...value, status: value.assigneeId ? 'assigned' : 'pending', provenance, createdAt: now(), updatedAt: now(), runId: null };
      this.recipients(s, entity); s.tasks.push(entity); this.checkDependencies(s, entity); return entity;
    });
  }
  updateTask(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority); const value = parse(taskUpdateSchema, body);
    return this.store.transact((s) => {
      const task = find(s.tasks, id); this.read(authority, task.provenance);
      if (task.runId) throw new HttpError(409, 'Cancela la ejecución antes de editar la tarea.');
      const target = value.status;
      if (target && target !== task.status && !transitions[task.status].includes(target)) throw new HttpError(409, 'La transición de estado no está permitida.');
      if (target === 'in_progress') throw new HttpError(409, 'Inicia la ejecución mediante la acción de ejecutar.');
      if (target === 'completed') {
        const ds = s.deliverables.filter((d) => d.taskId === id);
        if (!ds.length || ds.some((d) => !accepted(s, d))) throw new HttpError(409, 'La finalización requiere aprobar la última versión de todos los entregables.');
      }
      Object.assign(task, value); const department = find(s.departments, task.departmentId);
      if (department.archived) throw new HttpError(409, 'El departamento está archivado.');
      const project = task.projectId ? find(s.projects, task.projectId) : null;
      if (project && !project.departmentIds.includes(task.departmentId)) throw new HttpError(409, 'El departamento no participa en este proyecto.');
      task.provenance = this.provenance(authority, task.provenance, ...(project ? [project.provenance] : []), ...task.dependencyIds.map((d) => find(s.tasks, d).provenance));
      this.recipients(s, task); this.checkDependencies(s, task); task.updatedAt = now(); return task;
    });
  }
  comment(authority: CompanyAuthority, id: string, body: unknown) {
    const value = parse(z.object({ text }).strict(), body);
    return this.store.transact((s) => { const task = find(s.tasks, id); this.ownTask(authority, task); const provenance = this.provenance(authority, task.provenance); task.provenance = provenance; this.recipients(s, task); const entity = { id: identify(), taskId: id, authorId: authority.principal.id, text: value.text, createdAt: now(), provenance }; s.comments.push(entity); return entity; });
  }
  deliver(authority: CompanyAuthority, id: string, body: unknown) {
    const value = parse(z.object({ kind, title: short, content: text }).strict(), body);
    return this.store.transact((s) => { const task = find(s.tasks, id); this.ownTask(authority, task); if (['completed', 'cancelled'].includes(task.status)) throw new HttpError(409, 'La tarea ya está cerrada.'); if (task.runId) throw new HttpError(409, 'Cancela la ejecución antes de editar los entregables.'); const provenance = this.provenance(authority, task.provenance); task.provenance = provenance; this.recipients(s, task); const entity: CompanyDeliverable = { id: identify(), taskId: id, kind: value.kind, versions: [{ version: 1, title: value.title, content: value.content, authorId: authority.principal.id, createdAt: now(), provenance }] }; s.deliverables.push(entity); task.status = 'in_review'; task.updatedAt = now(); return entity; });
  }
  version(authority: CompanyAuthority, id: string, body: unknown) {
    const value = parse(z.object({ title: short, content: text }).strict(), body);
    return this.store.transact((s) => { const entity = find(s.deliverables, id); const task = find(s.tasks, entity.taskId); this.ownTask(authority, task); if (['completed', 'cancelled'].includes(task.status)) throw new HttpError(409, 'La tarea ya está cerrada.'); if (task.runId) throw new HttpError(409, 'Cancela la ejecución antes de editar los entregables.'); const provenance = this.provenance(authority, task.provenance, ...entity.versions.map((v) => v.provenance)); task.provenance = provenance; this.recipients(s, task); entity.versions.push({ ...value, version: entity.versions.length + 1, authorId: authority.principal.id, createdAt: now(), provenance }); task.status = 'in_review'; for (const c of s.calendar.filter((c) => c.taskId === task.id)) c.state = 'in_review'; return entity; });
  }
  review(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority); const value = parse(z.object({ version: z.number().int().positive(), decision: z.enum(['accepted', 'changes_requested', 'rejected']), comment: z.string().trim().max(10000).default('') }).strict(), body);
    return this.store.transact((s) => { const entity = find(s.deliverables, id); const task = find(s.tasks, entity.taskId); this.read(authority, task.provenance); if (['completed', 'cancelled'].includes(task.status)) throw new HttpError(409, 'La tarea ya está cerrada.'); if (task.runId) throw new HttpError(409, 'La tarea tiene una ejecución activa.'); const last = entity.versions.at(-1)!; if (value.version !== last.version) throw new HttpError(409, 'La versión ha cambiado. Revisa la versión actual.'); if (s.reviews.filter((r) => r.deliverableId === id && r.version === value.version).at(-1)?.decision === value.decision) throw new HttpError(409, 'Esta decisión ya está registrada.'); const provenance = this.provenance(authority, last.provenance, task.provenance); const result = { id: identify(), deliverableId: id, ...value, reviewerId: authority.principal.id, createdAt: now(), provenance }; s.reviews.push(result); task.provenance = provenance; this.recipients(s, task); task.status = value.decision === 'accepted' ? 'in_review' : 'assigned'; for (const c of s.calendar.filter((c) => c.taskId === task.id)) c.state = value.decision === 'accepted' ? 'approved' : 'draft'; return result; });
  }
  mailDraft(authority: CompanyAuthority, id: string, body: unknown, create?: CompanyMailDraftCreator) {
    this.manager(authority);
    const addresses = z.array(z.string().email().max(254)).max(50);
    const value = parse(z.object({ version: z.number().int().positive(), mailboxId: short, messageId: short, to: addresses.min(1).optional(), cc: addresses.optional(), bcc: addresses.optional() }).strict(), body);
    if (!create) throw new HttpError(503, 'La creación de borradores requiere el servicio de correo protegido.');
    const state = this.store.read(); const deliverable = find(state.deliverables, id); const task = find(state.tasks, deliverable.taskId);
    this.read(authority, task.provenance); const version = deliverable.versions.at(-1)!;
    this.read(authority, version.provenance);
    if (value.version !== version.version) throw new HttpError(409, 'El entregable ha cambiado. Revisa la versión actual antes de crear el borrador.');
    if (task.status === 'cancelled' || task.runId || !accepted(state, deliverable)) throw new HttpError(409, 'El borrador requiere la última versión del entregable aprobada por el responsable.');
    // Content is resolved from the immutable reviewed version, never from a client-supplied subject or body.
    return create(authority, { mailboxId: value.mailboxId, messageId: value.messageId, to: value.to, cc: value.cc ?? [], bcc: value.bcc ?? [], subject: version.title, body: version.content, attachmentIds: [] });
  }
  knowledge(authority: CompanyAuthority, body: unknown) {
    this.manager(authority); const value = parse(z.object({ title: short, category: z.enum(['services', 'procedures', 'brand', 'general']).default('general'), content: text }).strict(), body); const provenance = this.provenance(authority);
    return this.store.transact((s) => { const entity = { id: identify(), title: value.title, category: value.category, versions: [{ version: 1, title: value.title, content: value.content, authorId: authority.principal.id, createdAt: now(), provenance }] }; s.knowledge.push(entity); return entity; });
  }
  knowledgeVersion(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority); const value = parse(z.object({ title: short, content: text }).strict(), body);
    return this.store.transact((s) => { const entity = find(s.knowledge, id); const provenance = this.provenance(authority, ...entity.versions.map((v) => v.provenance)); entity.versions.push({ ...value, version: entity.versions.length + 1, authorId: authority.principal.id, createdAt: now(), provenance }); return entity; });
  }
  search(authority: CompanyAuthority, query: string) {
    if (!query.trim() || query.length > 200) throw new HttpError(400, 'Indica una búsqueda de hasta 200 caracteres.'); const state = this.snapshot(authority); const q = query.toLocaleLowerCase('es');
    return { tasks: state.tasks.filter((t) => `${t.title} ${t.objective}`.toLocaleLowerCase('es').includes(q)), knowledge: state.knowledge.filter((k) => `${k.title} ${k.versions.at(-1)?.content}`.toLocaleLowerCase('es').includes(q)), deliverables: state.deliverables.filter((d) => d.versions.some((v) => `${v.title} ${v.content}`.toLocaleLowerCase('es').includes(q))) };
  }
  contact(authority: CompanyAuthority, body: unknown) {
    this.manager(authority); const value = parse(z.object({ name: short, organisation: z.string().max(200).default(''), email: z.union([z.literal(''), z.string().email()]).default('') }).strict(), body); const provenance = this.provenance(authority);
    return this.store.transact((s) => { const entity = { id: identify(), ...value, provenance }; s.contacts.push(entity); return entity; });
  }
  opportunity(authority: CompanyAuthority, body: unknown) {
    this.manager(authority); const value = parse(z.object({ contactId: short, name: short, valueEuros: z.number().nonnegative().default(0), nextAction: text, nextActionAt: date, projectId: z.string().nullable().default(null) }).strict(), body);
    return this.store.transact((s) => { const contact = find(s.contacts, value.contactId); const project = value.projectId ? find(s.projects, value.projectId) : null; const provenance = this.provenance(authority, contact.provenance, ...(project ? [project.provenance] : [])); const entity = { id: identify(), ...value, stage: 'new' as const, provenance }; s.opportunities.push(entity); return entity; });
  }
  updateOpportunity(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority); const value = parse(z.object({ stage: z.enum(['new', 'qualified', 'proposal', 'won', 'lost']).optional(), nextAction: text.optional(), nextActionAt: date.removeDefault().optional(), valueEuros: z.number().nonnegative().optional() }).strict(), body);
    return this.store.transact((s) => { const entity = find(s.opportunities, id); entity.provenance = this.provenance(authority, entity.provenance); Object.assign(entity, value); return entity; });
  }
  async run(authority: CompanyAuthority, id: string) {
    this.manager(authority); if (!this.executor) throw new HttpError(503, 'La ejecución requiere un entorno aislado verificado.');
    const executor = this.executor;
    const execution = this.store.transact((s) => {
      const task = find(s.tasks, id); this.read(authority, task.provenance);
      if (!['assigned', 'blocked'].includes(task.status) || task.runId || !task.assigneeId) throw new HttpError(409, 'La tarea necesita un responsable y un estado listo para ejecutar.');
      if (task.externalReference?.startsWith('github:') || find(s.agents, task.assigneeId).profileId === 'development') throw new HttpError(409, 'El trabajo de código se ejecuta desde su repositorio mediante el flujo de desarrollo existente.');
      if (task.dependencyIds.some((d) => find(s.tasks, d).status !== 'completed')) throw new HttpError(409, 'Hay dependencias sin finalizar.');
      const agent = find(s.agents, task.assigneeId); const profile = find(s.profiles, agent.profileId); this.recipients(s, task);
      const reserved = s.runs.filter((r) => r.agentId === agent.id && r.state === 'running').reduce((sum, r) => sum + r.reservedCostEuros, 0);
      const availableBudget = profile.budgetEuros - agent.spentEuros - reserved;
      if (availableBudget <= 0) throw new HttpError(409, 'Se ha alcanzado el presupuesto del especialista.');
      if (s.runs.filter((r) => r.agentId === agent.id && r.state === 'running').length >= profile.maxConcurrentTasks) throw new HttpError(409, 'El especialista ha alcanzado su límite de trabajos simultáneos.');
      const knowledge = s.knowledge.map((k) => k.versions.at(-1)!).filter((k) => this.authorization.canRead(authority, k.provenance) && this.authorization.canAssign(agent.id, k.provenance));
      const dependencyDocuments = s.deliverables.filter((deliverable) => task.dependencyIds.includes(deliverable.taskId) && accepted(s, deliverable)).map((deliverable) => deliverable.versions.at(-1)!);
      task.provenance = this.provenance(authority, task.provenance, ...knowledge.map((k) => k.provenance), ...dependencyDocuments.map((d) => d.provenance)); this.recipients(s, task);
      const run = { id: identify(), taskId: id, agentId: agent.id, state: 'running' as const, mode: executor.mode, startedAt: now(), finishedAt: null, costEuros: 0, reservedCostEuros: availableBudget, error: null, provenance: task.provenance };
      s.runs.push(run); task.runId = run.id; task.status = 'in_progress'; task.updatedAt = now();
      return { task, profile, model: agent.model, maxCostEuros: availableBudget, knowledge: [...knowledge, ...dependencyDocuments].map(({ title, content }) => ({ title, content })), run };
    });
    const controller = new AbortController(); this.controllers.set(execution.run.id, controller);
    const session = this.authorization.issueAgent(execution.run.agentId);
    const abort = () => controller.abort(); session.signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 5 * 60_000); timeout.unref();
    let attempted = false;
    try {
      this.authorization.absorb(session.authority, execution.run.provenance);
      if (execution.run.provenance.sourceIds.length && !this.resolveSources) throw new HttpError(503, 'Las fuentes restringidas requieren el servicio de contexto autorizado.');
      const sourceDocuments = await this.resolveSources?.(session.authority, execution.run.provenance) ?? [];
      const sourceScope = this.authorization.scope(session.authority);
      this.store.transact((s) => { const task = find(s.tasks, id); const run = find(s.runs, execution.run.id); task.provenance = combineScopes(task.provenance, sourceScope); run.provenance = task.provenance; this.recipients(s, task); });
      attempted = true;
      const output = await executor.execute({ task: execution.task, profile: execution.profile, knowledge: [...execution.knowledge, ...sourceDocuments], authority: session.authority, signal: controller.signal, maxCostEuros: execution.maxCostEuros, model: execution.model || undefined });
      if (controller.signal.aborted || !this.authorization.canAssign(execution.run.agentId, execution.run.provenance)) throw new Error('Accesos revocados o ejecución cancelada.');
      const value = parse(z.object({ title: short, content: text, kind, costEuros: z.number().nonnegative().max(10000), mode: z.enum(['demo', 'restricted']).optional() }).strict(), output);
      if (value.costEuros > execution.maxCostEuros) throw new HttpError(502, 'El proveedor ha superado el límite de coste autorizado.');
      return this.store.transact((s) => {
        const task = find(s.tasks, id); const run = find(s.runs, execution.run.id); const agent = find(s.agents, run.agentId);
        if (run.state !== 'running' || task.runId !== run.id) throw new HttpError(409, 'La ejecución ya no está activa.');
        task.provenance = combineScopes(task.provenance, this.authorization.scope(session.authority)); run.provenance = task.provenance; this.recipients(s, task);
        const entity: CompanyDeliverable = { id: identify(), taskId: id, kind: value.kind, versions: [{ version: 1, title: value.title, content: value.content, authorId: agent.id, createdAt: now(), provenance: run.provenance }] };
        s.deliverables.push(entity); run.state = 'completed'; run.finishedAt = now(); run.costEuros = value.costEuros; agent.spentEuros += value.costEuros; task.status = 'in_review'; task.runId = null; task.updatedAt = now();
        for (const c of s.calendar.filter((c) => c.taskId === id)) c.state = 'in_review'; return { run, deliverable: entity };
      });
    } catch (error) {
      this.store.transact((s) => { const run = find(s.runs, execution.run.id); const task = find(s.tasks, id); if (attempted && run.costEuros === 0) { run.costEuros = run.reservedCostEuros; find(s.agents, run.agentId).spentEuros += run.costEuros; } if (run.state === 'running') { run.state = controller.signal.aborted ? 'cancelled' : 'failed'; run.finishedAt = now(); run.error = attempted ? 'Ejecución sin resultado confirmado. Se conserva el coste máximo reservado hasta conciliarlo con el proveedor.' : 'La ejecución no se ha iniciado; revisa el acceso y las fuentes.'; task.status = 'blocked'; task.runId = null; } });
      throw error instanceof HttpError ? error : new HttpError(503, 'No se ha completado la ejecución. Consulta el estado de la tarea.');
    } finally { clearTimeout(timeout); session.signal.removeEventListener('abort', abort); this.authorization.revoke(session.authority); this.controllers.delete(execution.run.id); }
  }
  cancel(authority: CompanyAuthority, id: string) {
    this.manager(authority); return this.store.transact((s) => { const task = find(s.tasks, id); this.read(authority, task.provenance); if (['completed', 'cancelled'].includes(task.status)) throw new HttpError(409, 'La tarea ya está cerrada.'); if (task.runId) { this.controllers.get(task.runId)?.abort(); const run = find(s.runs, task.runId); run.state = 'cancelled'; run.finishedAt = now(); } task.runId = null; task.status = 'cancelled'; task.updatedAt = now(); return task; });
  }
  revokeAgent(agentId: string): void {
    for (const run of this.store.read().runs.filter((r) => r.agentId === agentId && r.state === 'running')) this.controllers.get(run.id)?.abort();
    this.store.transact((s) => { for (const task of s.tasks.filter((t) => t.assigneeId === agentId && !['completed', 'cancelled'].includes(t.status))) { task.status = 'blocked'; if (task.runId) { const run = find(s.runs, task.runId); run.state = 'cancelled'; run.finishedAt = now(); } task.runId = null; } });
  }
  workflow(authority: CompanyAuthority, body: unknown) {
    this.manager(authority); const value = parse(z.object({ kind: z.enum(['marketing', 'business', 'operations']), objective: text }).strict(), body);
    const provenance = this.provenance(authority);
    return this.store.transact((s) => {
      const departments = value.kind === 'marketing' ? ['marketing', 'operations'] : value.kind === 'business' ? ['business', 'operations'] : ['operations', 'direction'];
      if (departments.some((id) => find(s.departments, id).archived)) throw new HttpError(409, 'Un departamento necesario está archivado.');
      const project = { id: identify(), name: `${value.kind === 'marketing' ? 'Campaña' : value.kind === 'business' ? 'Oportunidad comercial' : 'Operación'}: ${value.objective.slice(0, 100)}`, objective: value.objective, departmentIds: departments, repositoryIds: [], status: 'active' as const, provenance };
      s.projects.push(project);
      const add = (title: string, departmentId: string, profileId: string, completionCriteria: string, dependencies: string[] = []) => {
        const available = s.agents.filter((a) => a.profileId === profileId && a.enabled && this.authorization.canAssign(a.id, provenance)).sort((a, b) => s.tasks.filter((t) => t.assigneeId === a.id && !['completed', 'cancelled'].includes(t.status)).length - s.tasks.filter((t) => t.assigneeId === b.id && !['completed', 'cancelled'].includes(t.status)).length);
        const agent = available[0]; if (!agent) throw new HttpError(409, 'No hay un especialista autorizado para este objetivo.');
        const task: CompanyTask = { id: identify(), title, objective: value.objective, projectId: project.id, departmentId, assigneeId: agent.id, collaboratorIds: [], priority: 'normal', dueAt: null, dependencyIds: dependencies, completionCriteria, status: 'assigned', provenance, createdAt: now(), updatedAt: now(), runId: null, externalReference: null };
        s.tasks.push(task); return task;
      };
      if (value.kind === 'marketing') {
        const strategy = add('Propuesta de campaña y calendario editorial', 'marketing', 'marketing', 'Objetivo, audiencia, mensaje, canales, calendario e indicadores; revisión del responsable.');
        for (const channel of ['x', 'instagram', 'facebook', 'tiktok'] as const) {
          const task = add(`Contenido para ${channel === 'x' ? 'X' : channel === 'tiktok' ? 'TikTok' : channel === 'instagram' ? 'Instagram' : 'Facebook'}`, 'marketing', 'marketing', 'Texto y propuesta de pieza adaptados al canal, llamada a la acción y revisión humana antes de publicar.', [strategy.id]);
          s.calendar.push({ id: identify(), projectId: project.id, taskId: task.id, channel, scheduledAt: null, state: 'draft', provenance });
        }
        add('Programación y seguimiento de campaña', 'operations', 'operations', 'Comprobar las cuatro revisiones y proponer programación; ninguna publicación sin aprobación específica.', s.tasks.filter((t) => t.projectId === project.id && t.id !== strategy.id).map((t) => t.id));
      } else if (value.kind === 'business') {
        const research = add('Ficha de oportunidad y necesidades', 'business', 'business', 'Necesidades, fuentes autorizadas, alcance inicial y próximos pasos.');
        const proposal = add('Propuesta comercial', 'business', 'business', 'Propuesta con alcance, entregables, supuestos, presupuesto por confirmar y revisión humana.', [research.id]);
        add('Seguimiento de la oportunidad', 'operations', 'operations', 'Responsable, fecha y siguiente acción; respuesta externa sujeta a aprobación.', [proposal.id]);
      } else {
        const plan = add('Plan de operación y responsables', 'operations', 'operations', 'Pasos, responsables y evidencia requerida.');
        const implementation = add('Ejecución y evidencia de la petición', 'operations', 'operations', 'Informe de evidencias disponibles, bloqueos y recordatorios pendientes.', [plan.id]);
        add('Revisión de cierre y decisiones', 'direction', 'coordination', 'Resumen de evidencias y decisiones del responsable.', [implementation.id]);
      }
      return { project, tasks: s.tasks.filter((t) => t.projectId === project.id), mode: this.executor?.mode ?? 'blocked' };
    });
  }
  async executeWorkflow(authority: CompanyAuthority, projectId: string) {
    this.manager(authority); const project = find(this.store.read().projects, projectId); this.read(authority, project.provenance);
    const results = [];
    for (const task of this.store.read().tasks.filter((t) => t.projectId === projectId && ['assigned', 'blocked'].includes(t.status))) {
      const state = this.store.read();
      if (task.dependencyIds.some((id) => find(state.tasks, id).status !== 'completed')) continue;
      results.push(await this.run(authority, task.id));
    }
    return { results, message: 'Los entregables requieren revisión humana antes de continuar con sus dependencias.' };
  }
  updateCalendar(authority: CompanyAuthority, id: string, body: unknown) {
    this.manager(authority); const value = parse(z.object({ scheduledAt: date }).strict(), body);
    return this.store.transact((s) => { const entry = find(s.calendar, id); entry.provenance = this.provenance(authority, entry.provenance); entry.scheduledAt = value.scheduledAt; return entry; });
  }
  close(): void { for (const controller of this.controllers.values()) controller.abort(); }
}
