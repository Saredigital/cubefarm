// Separate, versioned company storage; the legacy GitHub state is never rewritten by migration.
import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CompanyState, SpecialistProfile } from '../../shared/company.ts';
import type { WorldSnapshot } from '../../shared/types.ts';

const emptyScope = () => ({ mailboxIds: [], sourceIds: [] });
export const specialistProfiles: SpecialistProfile[] = [
  { id: 'coordination', name: 'Coordinación general', specialty: 'Planificación y coordinación', instructions: 'Convierte objetivos en tareas concretas, detecta dependencias y presenta decisiones al responsable.', capabilities: ['plan', 'report'], qualityCriteria: ['Responsables claros', 'Dependencias sin ciclos'], maxConcurrentTasks: 2, budgetEuros: 20 },
  { id: 'operations', name: 'Asistencia de operaciones', specialty: 'Operaciones y seguimiento', instructions: 'Organiza peticiones, responsables, fechas y evidencias de cierre.', capabilities: ['operations', 'report', 'document'], qualityCriteria: ['Cierre con evidencia', 'Próximos pasos claros'], maxConcurrentTasks: 2, budgetEuros: 10 },
  { id: 'marketing', name: 'Estrategia y contenidos', specialty: 'Marketing y redes sociales', instructions: 'Prepara campañas, calendario y textos para X, Instagram, Facebook y TikTok. Toda publicación requiere revisión humana.', capabilities: ['marketing', 'social_content', 'document'], qualityCriteria: ['Tono de marca', 'Adaptación al canal', 'Sin afirmaciones inventadas'], maxConcurrentTasks: 2, budgetEuros: 15 },
  { id: 'business', name: 'Investigación y propuestas', specialty: 'Desarrollo de negocio', instructions: 'Investiga oportunidades con las fuentes autorizadas, redacta propuestas y propone seguimientos.', capabilities: ['business', 'proposal', 'report'], qualityCriteria: ['Fuentes identificadas', 'Alcance y próximos pasos explícitos'], maxConcurrentTasks: 2, budgetEuros: 15 },
  { id: 'development', name: 'Desarrollo y QA', specialty: 'Desarrollo técnico', instructions: 'Conserva el flujo de repositorios, issues, pruebas y revisiones de GitHub.', capabilities: ['code', 'qa'], qualityCriteria: ['Pruebas verificadas', 'Revisión de código'], maxConcurrentTasks: 1, budgetEuros: 20 },
];

export function initialCompany(legacy?: WorldSnapshot): CompanyState {
  const names = [['direction', 'Dirección', 'Coordinar objetivos y decisiones'], ['operations', 'Operaciones', 'Organizar el trabajo y sus seguimientos'], ['marketing', 'Marketing', 'Desarrollar campañas y contenidos'], ['business', 'Desarrollo de negocio', 'Gestionar oportunidades y propuestas'], ['development', 'Desarrollo técnico', 'Desarrollar y revisar software']];
  const maxFloor = Math.max(0, ...(legacy?.repos.map((r) => r.floor) ?? []));
  const departments = names.map(([id, name, mission], order) => ({ id, name, mission, managerId: null, floor: id === 'development' && maxFloor ? legacy!.repos[0].floor : maxFloor + order + 1, order, archived: false }));
  const departmentForRepo = (repoId: string) => legacy?.repos[0]?.id === repoId ? 'development' : `development:${repoId}`;
  for (const repo of legacy?.repos.slice(1) ?? []) departments.push({ id: departmentForRepo(repo.id), name: `Desarrollo · ${repo.fullName}`, mission: repo.mission || 'Desarrollo y QA del repositorio', managerId: null, floor: repo.floor, order: departments.length, archived: false });
  const now = new Date().toISOString();
  return { schemaVersion: 1, revision: 0, company: { name: legacy?.settings.companyName || 'Saredigital', objective: 'Coordinar la empresa con revisión humana' }, departments, profiles: structuredClone(specialistProfiles),
    projects: (legacy?.repos ?? []).map((r) => ({ id: `repo:${r.id}`, name: r.fullName, objective: r.mission || r.description, departmentIds: [departmentForRepo(r.id)], repositoryIds: [r.id], status: 'active', provenance: emptyScope() })),
    agents: [...(legacy?.agents ?? []).filter((a) => a.role !== 'ceo').map((a) => ({ id: a.id, name: a.name, departmentId: departmentForRepo(a.repoId), profileId: 'development', model: a.model, enabled: true, spentEuros: 0 })), ...['coordination', 'operations', 'marketing', 'business'].map((id) => ({ id: `specialist:${id}`, name: specialistProfiles.find((p) => p.id === id)!.name, departmentId: id === 'coordination' ? 'direction' : id, profileId: id, model: '', enabled: true, spentEuros: 0 }))],
    tasks: [], comments: [], deliverables: [], reviews: [], knowledge: [], contacts: [], opportunities: [], calendar: [], runs: [],
    migration: legacy ? { importedAt: now, legacyRepos: legacy.repos.length, legacyAgents: legacy.agents.length, legacyTasks: legacy.agents.filter((a) => a.task).length, legacyHistory: legacy.messages.length, source: 'legacy-state-preserved' } : null };
}

const idSchema = z.string().min(1).max(200);
const scopeSchema = z.object({ mailboxIds: z.array(idSchema), sourceIds: z.array(idSchema) }).strict();
const versionSchema = z.object({ version: z.number().int().positive(), title: z.string(), content: z.string(), authorId: idSchema, createdAt: z.string().datetime(), provenance: scopeSchema }).strict();
const scoped = z.object({ id: idSchema, provenance: scopeSchema });
const persistedSchema = z.object({
  schemaVersion: z.literal(1), revision: z.number().int().nonnegative(), company: z.object({ name: z.string(), objective: z.string() }),
  departments: z.array(z.object({ id: idSchema, name: z.string(), mission: z.string(), managerId: idSchema.nullable(), floor: z.number().int().positive(), order: z.number().int().nonnegative(), archived: z.boolean() }).strict()),
  projects: z.array(scoped.extend({ name: z.string(), objective: z.string(), departmentIds: z.array(idSchema), repositoryIds: z.array(idSchema), status: z.enum(['active', 'completed', 'archived']) }).strict()),
  profiles: z.array(z.object({ id: idSchema, name: z.string(), specialty: z.string(), instructions: z.string(), capabilities: z.array(z.string()), qualityCriteria: z.array(z.string()), maxConcurrentTasks: z.number().int().positive(), budgetEuros: z.number().nonnegative() }).strict()),
  agents: z.array(z.object({ id: idSchema, name: z.string(), departmentId: idSchema, profileId: idSchema, model: z.string(), enabled: z.boolean(), spentEuros: z.number().nonnegative() }).strict()),
  tasks: z.array(scoped.extend({ title: z.string(), objective: z.string(), projectId: idSchema.nullable(), departmentId: idSchema, assigneeId: idSchema.nullable(), collaboratorIds: z.array(idSchema), priority: z.enum(['low', 'normal', 'high', 'urgent']), dueAt: z.string().datetime({ offset: true }).nullable(), dependencyIds: z.array(idSchema), completionCriteria: z.string(), status: z.enum(['pending', 'assigned', 'in_progress', 'in_review', 'completed', 'blocked', 'cancelled']), createdAt: z.string().datetime(), updatedAt: z.string().datetime(), runId: idSchema.nullable(), externalReference: z.string().nullable() }).strict()),
  comments: z.array(scoped.extend({ taskId: idSchema, authorId: idSchema, text: z.string(), createdAt: z.string().datetime() }).strict()),
  deliverables: z.array(z.object({ id: idSchema, taskId: idSchema, kind: z.enum(['document', 'proposal', 'social_content', 'report', 'code', 'email_draft']), versions: z.array(versionSchema).min(1) }).strict()),
  reviews: z.array(scoped.extend({ deliverableId: idSchema, version: z.number().int().positive(), reviewerId: idSchema, decision: z.enum(['accepted', 'changes_requested', 'rejected']), comment: z.string(), createdAt: z.string().datetime() }).strict()),
  knowledge: z.array(z.object({ id: idSchema, title: z.string(), category: z.enum(['services', 'procedures', 'brand', 'general']), versions: z.array(versionSchema).min(1) }).strict()),
  contacts: z.array(scoped.extend({ name: z.string(), organisation: z.string(), email: z.string() }).strict()),
  opportunities: z.array(scoped.extend({ contactId: idSchema, name: z.string(), stage: z.enum(['new', 'qualified', 'proposal', 'won', 'lost']), valueEuros: z.number().nonnegative(), nextAction: z.string(), nextActionAt: z.string().datetime({ offset: true }).nullable(), projectId: idSchema.nullable() }).strict()),
  calendar: z.array(scoped.extend({ projectId: idSchema, taskId: idSchema, channel: z.enum(['x', 'instagram', 'facebook', 'tiktok']), scheduledAt: z.string().datetime({ offset: true }).nullable(), state: z.enum(['draft', 'in_review', 'approved', 'published']) }).strict()),
  runs: z.array(scoped.extend({ taskId: idSchema, agentId: idSchema, state: z.enum(['running', 'completed', 'cancelled', 'failed']), mode: z.enum(['demo', 'restricted']), startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(), costEuros: z.number().nonnegative(), reservedCostEuros: z.number().nonnegative(), error: z.string().nullable() }).strict()),
  migration: z.object({ importedAt: z.string().datetime(), legacyRepos: z.number().int().nonnegative(), legacyAgents: z.number().int().nonnegative(), legacyTasks: z.number().int().nonnegative(), legacyHistory: z.number().int().nonnegative(), source: z.string() }).nullable(),
}).strict();
function validate(value: unknown): asserts value is CompanyState {
  const state = value as CompanyState;
  if (!persistedSchema.safeParse(value).success) throw new Error('El estado de empresa no tiene un formato compatible. Restaura una copia verificada.');
  for (const key of ['departments', 'projects', 'profiles', 'agents', 'tasks', 'comments', 'deliverables', 'reviews', 'knowledge', 'contacts', 'opportunities', 'calendar', 'runs'] as const) {
    if (!Array.isArray(state[key]) || new Set(state[key].map((entry) => entry.id)).size !== state[key].length) throw new Error(`El estado de empresa contiene datos no válidos: ${key}.`);
  }
  const exists = (items: { id: string }[], id: string | null) => id === null || items.some((item) => item.id === id);
  const assert = (condition: boolean) => { if (!condition) throw new Error('El estado de empresa contiene relaciones no válidas.'); };
  const covers = (parent: { mailboxIds: string[] }, child: { mailboxIds: string[] }) => child.mailboxIds.every((id) => parent.mailboxIds.includes(id));
  for (const project of state.projects) assert(project.departmentIds.every((id) => exists(state.departments, id)));
  for (const agent of state.agents) assert(exists(state.departments, agent.departmentId) && exists(state.profiles, agent.profileId));
  for (const task of state.tasks) {
    assert(exists(state.departments, task.departmentId) && exists(state.projects, task.projectId) && exists(state.agents, task.assigneeId) && task.collaboratorIds.every((id) => exists(state.agents, id)) && task.dependencyIds.every((id) => exists(state.tasks, id)) && exists(state.runs, task.runId));
    const project = state.projects.find((p) => p.id === task.projectId); if (project) assert(covers(task.provenance, project.provenance));
    for (const dependency of task.dependencyIds) assert(covers(task.provenance, state.tasks.find((t) => t.id === dependency)!.provenance));
  }
  const checked = new Set<string>();
  const visit = (id: string, parents: Set<string>): void => {
    assert(!parents.has(id)); if (checked.has(id)) return;
    const task = state.tasks.find((item) => item.id === id)!;
    for (const dependency of task.dependencyIds) visit(dependency, new Set(parents).add(id)); checked.add(id);
  };
  for (const task of state.tasks) visit(task.id, new Set());
  for (const entry of [...state.comments, ...state.runs, ...state.calendar]) { assert(exists(state.tasks, entry.taskId)); assert(covers(entry.provenance, state.tasks.find((t) => t.id === entry.taskId)!.provenance) || covers(state.tasks.find((t) => t.id === entry.taskId)!.provenance, entry.provenance)); }
  for (const deliverable of state.deliverables) {
    assert(exists(state.tasks, deliverable.taskId));
    deliverable.versions.forEach((v, i) => { assert(v.version === i + 1); if (i) assert(covers(v.provenance, deliverable.versions[i - 1].provenance)); });
  }
  for (const review of state.reviews) assert(state.deliverables.some((d) => d.id === review.deliverableId && d.versions.some((v) => v.version === review.version)));
  for (const opportunity of state.opportunities) assert(exists(state.contacts, opportunity.contactId) && exists(state.projects, opportunity.projectId));
}

export class CompanyStore {
  private state: CompanyState;
  private key?: Buffer;
  readonly file: string;
  constructor(readonly directory: string, legacy?: WorldSnapshot, legacyFile?: string, options: { encryptionKey?: Uint8Array; initialState?: CompanyState } = {}) {
    if (options.initialState && (legacy || legacyFile)) throw new Error('La configuración inicial no admite importar estado anterior.');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (options.encryptionKey) { if (options.encryptionKey.byteLength !== 32) throw new Error('La clave de empresa debe tener 32 bytes.'); this.key = Buffer.from(options.encryptionKey); }
    this.file = path.join(directory, this.key ? 'company-state.enc' : 'company-state.json');
    if (this.key && fs.existsSync(path.join(directory, 'company-state.json'))) throw new Error('El servicio protegido no importa datos sin cifrar. Revisa la migración antes de continuar.');
    if (fs.existsSync(this.file)) {
      const loaded: unknown = this.decode(fs.readFileSync(this.file, 'utf8')); validate(loaded); this.state = loaded;
    } else {
      if (legacyFile && fs.existsSync(legacyFile)) {
        if (this.key) throw new Error('La migración de repositorios debe realizarse en la oficina; el broker protegido usa un almacén independiente.');
        const backup = path.join(directory, 'legacy-before-company.json');
        if (!fs.existsSync(backup)) fs.copyFileSync(legacyFile, backup, fs.constants.COPYFILE_EXCL);
        // A previous attempt may have stopped after preserving legacy state, before publishing company state.
        JSON.parse(fs.readFileSync(backup, 'utf8'));
      }
      this.state = options.initialState ? structuredClone(options.initialState) : initialCompany(legacy);
      validate(this.state); this.write(this.state);
    }
    this.transact((state) => {
      for (const run of state.runs.filter((r) => r.state === 'running')) {
        if (run.costEuros === 0) { run.costEuros = run.reservedCostEuros; const agent = state.agents.find((a) => a.id === run.agentId); if (agent) agent.spentEuros += run.costEuros; }
        run.state = 'cancelled'; run.finishedAt = new Date().toISOString(); run.error = 'Ejecución interrumpida por reinicio; requiere reanudación explícita.';
        const task = state.tasks.find((t) => t.id === run.taskId);
        if (task) { task.status = 'blocked'; task.runId = null; }
      }
    });
  }
  read(): CompanyState { return structuredClone(this.state); }
  transact<T>(mutate: (state: CompanyState) => T): T {
    const next = structuredClone(this.state); const result = mutate(next); next.revision++; validate(next); this.write(next); this.state = next; return structuredClone(result);
  }
  private write(state: CompanyState): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      // Windows requires a writable handle for FlushFileBuffers/fsync.
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, this.encode(state)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      if (fs.existsSync(this.file)) fs.copyFileSync(this.file, `${this.file}.previous`);
      fs.renameSync(temporary, this.file);
    } finally { if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true, maxRetries: 3 }); }
  }
  restorePrevious(): void {
    const previous: unknown = this.decode(fs.readFileSync(`${this.file}.previous`, 'utf8')); validate(previous);
    fs.copyFileSync(this.file, `${this.file}.before-restore`); this.write(previous); this.state = previous;
  }
  private encode(state: CompanyState): string {
    if (!this.key) return JSON.stringify(state, null, 2);
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv); cipher.setAAD(Buffer.from('sareoffice-company-state-v1'));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), 'utf8'), cipher.final()]);
    return JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') });
  }
  private decode(packed: string): unknown {
    if (!this.key) return JSON.parse(packed);
    const value = JSON.parse(packed) as { version: number; iv: string; tag: string; ciphertext: string };
    if (value.version !== 1) throw new Error('Versión de cifrado de empresa incompatible.');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(value.iv, 'base64')); cipher.setAAD(Buffer.from('sareoffice-company-state-v1')); cipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.ciphertext, 'base64')), cipher.final()]).toString('utf8'));
  }
}
