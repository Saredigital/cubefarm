// Authenticated company commands, separate from the legacy GitHub API and public WebSocket.
import express, { type NextFunction, type Request, type Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { HttpError } from '../httpError.ts';
import { CompanyService, type CompanyAuthority, type CompanyAuthorization, type CompanyMailDraftCreator, type SpecialistExecutor } from './service.ts';
import { CompanyStore } from './store.ts';
import { demoSpecialistExecutor } from './demo.ts';

export interface CompanyRouteSecurity extends CompanyAuthorization {
  authority(req: { headers: IncomingHttpHeaders }, options?: { humanOnly?: boolean; csrf?: boolean }): CompanyAuthority;
  onRevocation(listener: (agentId: string, mailboxId: string) => void): () => void;
}
export function createCompanyRouter(options: { security: CompanyRouteSecurity; store: CompanyStore; demo: boolean; runtime?: SpecialistExecutor; resolveSources?: CompanyService['resolveSources']; createMailDraft?: CompanyMailDraftCreator }) {
  const { security, store } = options;
  const service = new CompanyService(store, security, options.demo ? demoSpecialistExecutor : options.runtime, options.resolveSources);
  const unsubscribe = security.onRevocation((agentId) => service.revokeAgent(agentId));
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // The public projection has no work text, mailbox metadata, provenance, costs or restricted counts.
  router.get('/public', (_req, res) => res.json(service.publicView()));
  const route = (fn: (authority: CompanyAuthority, req: Request) => unknown | Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try { const authority = security.authority(req, { csrf: !['GET', 'HEAD', 'OPTIONS'].includes(req.method) }); const output = await fn(authority, req); res.json(output ?? { ok: true }); } catch (error) { next(error); }
  };
  const id = (req: Request) => String(req.params.id);
  router.get('/state', route((a) => service.snapshot(a)));
  router.get('/search', route((a, req) => service.search(a, typeof req.query.q === 'string' ? req.query.q : '')));
  router.post('/context', route(async (authority, req) => {
    const ids: unknown = req.body?.sourceMessageIds;
    if (!req.body || Object.keys(req.body).some((key) => key !== 'sourceMessageIds') || !Array.isArray(ids) || !ids.length || ids.length > 50 || ids.some((id) => typeof id !== 'string' || !id || id.length > 200)) throw new HttpError(400, 'Selecciona entre 1 y 50 mensajes de origen.');
    if (!options.resolveSources) throw new HttpError(503, 'El contexto de correo requiere el servicio protegido.');
    const sourceIds = [...new Set(ids)] as string[];
    const documents = await options.resolveSources(authority, { mailboxIds: [], sourceIds });
    if (documents.length !== sourceIds.length) throw new HttpError(404, 'No están disponibles todos los mensajes de origen.');
    return { provenance: security.scope(authority) };
  }));
  router.patch('/', route((a, req) => service.updateCompany(a, req.body)));
  router.post('/departments', route((a, req) => service.createDepartment(a, req.body)));
  router.patch('/departments/:id', route((a, req) => service.updateDepartment(a, id(req), req.body)));
  router.post('/projects', route((a, req) => service.createProject(a, req.body)));
  router.post('/profiles', route((a, req) => service.createProfile(a, req.body)));
  router.patch('/profiles/:id', route((a, req) => service.updateProfile(a, id(req), req.body)));
  router.post('/agents', route((a, req) => service.createAgent(a, req.body)));
  router.patch('/agents/:id', route((a, req) => service.updateAgent(a, id(req), req.body)));
  router.post('/tasks', route((a, req) => service.createTask(a, req.body)));
  router.patch('/tasks/:id', route((a, req) => service.updateTask(a, id(req), req.body)));
  router.post('/tasks/:id/comments', route((a, req) => service.comment(a, id(req), req.body)));
  router.post('/tasks/:id/deliverables', route((a, req) => service.deliver(a, id(req), req.body)));
  router.post('/tasks/:id/run', route((a, req) => service.run(a, id(req))));
  router.post('/tasks/:id/cancel', route((a, req) => service.cancel(a, id(req))));
  router.post('/deliverables/:id/versions', route((a, req) => service.version(a, id(req), req.body)));
  router.post('/deliverables/:id/reviews', route((a, req) => service.review(a, id(req), req.body)));
  router.post('/deliverables/:id/mail-draft', route((a, req) => service.mailDraft(a, id(req), req.body, options.createMailDraft)));
  router.post('/knowledge', route((a, req) => service.knowledge(a, req.body)));
  router.post('/knowledge/:id/versions', route((a, req) => service.knowledgeVersion(a, id(req), req.body)));
  router.post('/contacts', route((a, req) => service.contact(a, req.body)));
  router.post('/opportunities', route((a, req) => service.opportunity(a, req.body)));
  router.patch('/opportunities/:id', route((a, req) => service.updateOpportunity(a, id(req), req.body)));
  router.patch('/calendar/:id', route((a, req) => service.updateCalendar(a, id(req), req.body)));
  router.post('/workflows', route((a, req) => service.workflow(a, req.body)));
  router.post('/workflows/:id/execute', route((a, req) => service.executeWorkflow(a, id(req))));
  router.post('/recovery/restore', route((a) => { security.assertAuthority(a); if (a.principal.kind !== 'manager') throw new HttpError(403, 'La restauración requiere al responsable.'); service.close(); store.restorePrevious(); return { ok: true }; }));
  return { router, service, close() { unsubscribe(); service.close(); } };
}
