import express, { type NextFunction, type Request, type Response } from 'express';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CompanyAuthority } from '../../shared/companySecurity.ts';
import { combineProvenance } from '../../shared/companySecurity.ts';
import type { CompanyStore } from '../company/store.ts';
import { CompanySecurity } from '../company-security/security.ts';
import { EncryptedStore } from '../company-security/vault.ts';
import { HttpError } from '../httpError.ts';
import { ApiSocialProvider, DemoSocialProvider } from './adapters.ts';
import { digest, type SocialAccountConfig } from './config.ts';
import type { SocialProvider } from './provider.ts';
import { CompanySocialService, type SocialDatabase } from './service.ts';

/** Fail closed after a crash. An administrator recovers the lease only while every broker is stopped. */
function acquireLease(directory: string) {
  mkdirSync(directory, { recursive: true }); const file = path.join(directory, 'social.lock');
  if (existsSync(file)) throw new Error('Existe un bloqueo del programador social. Detén todos los brokers y sigue la recuperación administrativa de docs/company-social.md.');
  const fd = openSync(file, 'wx', 0o600); writeFileSync(fd, String(process.pid));
  return () => { closeSync(fd); if (existsSync(file) && readFileSync(file, 'utf8') === String(process.pid)) unlinkSync(file); };
}
export const demoSocialAccounts = (): SocialAccountConfig[] => (['x', 'instagram', 'facebook', 'tiktok'] as const).map(channel => ({ id: `demo-${channel}`, label: `${channel === 'x' ? 'X' : channel[0].toUpperCase() + channel.slice(1)} · cuenta demo`, channel, providerAccountId: `demo_${channel}`, accessToken: 'SIMULACION_SIN_CREDENCIALES', expiresAt: '2099-01-01T00:00:00.000Z', scopes: [], appReviewed: false, enabled: true, apiVersion: 'v26.0', mediaDomainVerified: false }));

export function createCompanySocialRouter(options: { security: CompanySecurity; stateDir: string; encryptionKey: Uint8Array; demo: boolean; companyStore: CompanyStore; accounts?: SocialAccountConfig[]; publicOrigin?: string; providers?: Map<string, SocialProvider>; now?: () => number; scheduler?: boolean; sourcePermissionVersion?: (provenance: import('../../shared/companySecurity.ts').Provenance) => string }) {
  const accounts = options.demo ? demoSocialAccounts() : options.accounts ?? [];
  if (!options.demo && options.security.mode !== 'isolated' && accounts.length) throw new Error('Los conectores reales requieren el broker independiente.');
  for (const account of accounts) if (account.publicMediaOrigin && (!options.publicOrigin || new URL(account.publicMediaOrigin).origin !== new URL(options.publicOrigin).origin)) throw new Error('El origen de medios debe coincidir con el origen público del broker.');
  const directory = path.join(options.stateDir, 'social'); const release = acquireLease(directory);
  let service: CompanySocialService;
  try {
    service = new CompanySocialService(options.security, new EncryptedStore<SocialDatabase>(path.join(directory, 'social.enc'), options.encryptionKey, 'social'), accounts,
      options.providers ?? new Map(accounts.map(account => [account.id, options.demo ? new DemoSocialProvider(account.providerAccountId) : new ApiSocialProvider(account)])), (id, version) => {
        const state = options.companyStore.read(); const deliverable = state.deliverables.find(d => d.id === id);
        const source = deliverable?.versions.find(v => v.version === version); const task = state.tasks.find(t => t.id === deliverable?.taskId);
        if (!source || !task || !deliverable) throw new HttpError(404, 'Entregable no disponible.');
        const provenance = combineProvenance(source.provenance, task.provenance);
        const review = state.reviews.filter(r => r.deliverableId === id && r.version === version).at(-1);
        return { currentVersion: deliverable.versions.at(-1)!.version, hash: digest({ source, taskProvenance: task.provenance, review }), provenance, accepted: review?.decision === 'accepted' };
      }, options.now, options.demo, options.sourcePermissionVersion);
  } catch (error) { release(); throw error; }
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  // Mount the upload parser before the application's smaller JSON parser as documented.
  router.use('/assets', express.json({ limit: '17mb' }));
  router.use(express.json({ limit: '256kb' }));
  const route = (fn: (a: CompanyAuthority, req: Request) => unknown | Promise<unknown>) => async (req: Request, res: Response, next: NextFunction) => {
    try { const authority = options.security.authority(req, { csrf: req.method !== 'GET' }); res.json(await fn(authority, req)); } catch (error) { next(error); }
  };
  const id = (req: Request) => String(req.params.id);
  router.get('/state', route(a => service.snapshot(a)));
  router.post('/accounts/:id/verify', route((a, req) => service.verify(a, id(req))));
  router.post('/assets', route((a, req) => service.upload(a, req.body)));
  router.get('/assets/:id/content', (req, res, next) => { try { const content = service.content(options.security.authority(req), id(req)); res.setHeader('X-Content-Type-Options', 'nosniff'); res.type(content.mimeType).send(content.data); } catch (error) { next(error); } });
  router.get('/media/:token', (req, res, next) => { try { const content = service.publicMedia(String(req.params.token)); res.setHeader('X-Content-Type-Options', 'nosniff'); res.type(content.mimeType).send(content.data); } catch (error) { next(error); } });
  router.post('/drafts', route((a, req) => service.create(a, req.body)));
  router.patch('/drafts/:id', route((a, req) => service.update(a, id(req), req.body)));
  router.post('/drafts/:id/approve', route((a, req) => service.approve(a, id(req), req.body)));
  router.post('/drafts/:id/publish', route((a, req) => service.publish(a, id(req))));
  router.post('/drafts/:id/cancel', route((a, req) => service.cancel(a, id(req))));
  router.post('/drafts/:id/reconcile', route((a, req) => service.reconcile(a, id(req))));
  router.post('/drafts/:id/export', route((a, req) => service.exportPackage(a, id(req))));
  router.post('/drafts/:id/evidence', route((a, req) => service.recordEvidence(a, id(req), req.body)));
  let timer: ReturnType<typeof setInterval> | undefined;
  if (options.scheduler !== false) { timer = setInterval(() => { void service.tick().catch(() => { /* Fail closed; no provider details are logged. */ }); }, 60_000); timer.unref(); }
  let closed = false;
  return { router, service, async close() { if (closed) return; closed = true; if (timer) clearInterval(timer); await service.close(); release(); } };
}
