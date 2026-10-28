/** Protected HTTP surface. No mailbox data enters the office WebSocket or global journal. */
import type { Express, Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CompanySecurity, SESSION_COOKIE } from '../company-security/security.ts';
import { RestrictedSpecialistRuntime, type SpecialistModel } from '../company-security/runtime.ts';
import { EncryptedStore } from '../company-security/vault.ts';
import { HttpError } from '../httpError.ts';
import { demoMailDatabase, SimulatedMailProvider } from './demo.ts';
import type { MailProvider } from './provider.ts';
import { ProviderError } from './provider.ts';
import { emptyMailDatabase, MailService, type MailDatabase } from './service.ts';

export interface CompanyMailOptions {
  demo: boolean;
  stateDir: string;
  isolatedBroker?: boolean;
  password?: string;
  encryptionKey?: Uint8Array;
  providers?: Map<string, MailProvider>;
  database?: MailDatabase;
  model?: SpecialistModel;
}
export function mountCompanyMail(app: Express, options: CompanyMailOptions) {
  const security = new CompanySecurity(options);
  let database = options.demo ? demoMailDatabase() : options.database ?? emptyMailDatabase();
  let providers = options.demo ? new Map(database.mailboxes.map(mailbox => [mailbox.id, new SimulatedMailProvider(mailbox.id)])) : options.providers ?? new Map();
  if (security.mode === 'blocked') { database = emptyMailDatabase(); providers = new Map(); }
  let store: EncryptedStore<MailDatabase> | undefined;
  if (security.mode !== 'blocked') {
    let key = options.encryptionKey;
    if (options.demo) {
      mkdirSync(options.stateDir, { recursive: true });
      const path = join(options.stateDir, 'demo-mail.key');
      if (!existsSync(path)) writeFileSync(path, randomBytes(32), { mode: 0o600, flag: 'wx' });
      key = readFileSync(path);
    }
    if (!key) throw new Error('El broker requiere una clave de cifrado externa al directorio de datos.');
    store = new EncryptedStore(join(options.stateDir, options.demo ? 'demo-mail.enc' : 'mail.enc'), key);
  }
  const mail = new MailService(security, providers, store, database);
  const runtime = new RestrictedSpecialistRuntime(security, options.demo ? undefined : options.model);
  app.use('/api/company', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/company/security/status', (req, res) => { res.json(security.status(req)); });
  app.post('/api/company/session', (req, res) => {
    const result = security.login(req.body?.password);
    res.cookie(SESSION_COOKIE, result.token, { httpOnly: true, sameSite: 'strict', secure: security.mode === 'isolated',
      path: '/api/company', maxAge: 60 * 60_000 });
    res.json({ csrfToken: result.csrfToken, principal: result.principal });
  });
  app.delete('/api/company/session', (req, res) => {
    security.revoke(security.authority(req, { humanOnly: true, csrf: true }));
    res.clearCookie(SESSION_COOKIE, { path: '/api/company', httpOnly: true, sameSite: 'strict', secure: security.mode === 'isolated' });
    res.json({ ok: true });
  });
  const route = (handler: (req: Request, res: Response) => unknown) => async (req: Request, res: Response) => {
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof ProviderError) throw new HttpError(error.code === 'rate-limit' ? 429 : 502, error.message);
      throw error;
    }
  };
  app.get('/api/company/mail/mailboxes', route((req, res) => { res.json(mail.mailboxes(security.authority(req))); }));
  app.get('/api/company/mail/state', route((req, res) => {
    res.json(mail.state(security.authority(req), typeof req.query.mailboxId === 'string' ? req.query.mailboxId : undefined));
  }));
  app.get('/api/company/mail/messages/:id', route((req, res) => { res.json(mail.read(security.authority(req), String(req.params.id))); }));
  app.get('/api/company/mail/attachments/:id', route((req, res) => {
    const item = mail.attachment(security.authority(req), String(req.params.id));
    res.set({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': "attachment; filename=\"adjunto.txt\"",
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.send(Buffer.from(item.contentBase64, 'base64'));
  }));
  app.post('/api/company/mail/sync/:mailboxId', route(async (req, res) => {
    await mail.sync(security.authority(req, { csrf: true }), String(req.params.mailboxId), req.body?.folder ?? 'inbox'); res.json({ ok: true });
  }));
  app.patch('/api/company/mail/messages/:id', route(async (req, res) => {
    await mail.organize(security.authority(req, { csrf: true }), String(req.params.id), req.body?.read); res.json({ ok: true });
  }));
  app.put('/api/company/mail/grants', route((req, res) => {
    mail.setGrant(security.authority(req, { humanOnly: true, csrf: true }), req.body); res.json({ ok: true });
  }));
  app.post('/api/company/mail/drafts', route((req, res) => {
    res.json(mail.createDraft(security.authority(req, { csrf: true }), req.body));
  }));
  app.patch('/api/company/mail/drafts/:id', route((req, res) => {
    res.json(mail.editDraft(security.authority(req, { csrf: true }), String(req.params.id), req.body));
  }));
  app.post('/api/company/mail/drafts/:id/approve', route((req, res) => {
    res.json(mail.approve(security.authority(req, { humanOnly: true, csrf: true }), String(req.params.id), req.body?.version, req.body?.contentHash));
  }));
  app.post('/api/company/mail/drafts/:id/send', route(async (req, res) => {
    res.json(await mail.send(security.authority(req, { humanOnly: true, csrf: true }), String(req.params.id), req.body?.version, req.body?.contentHash));
  }));
  app.post('/api/company/mail/drafts/:id/reconcile', route(async (req, res) => {
    res.json(await mail.reconcile(security.authority(req, { humanOnly: true, csrf: true }), String(req.params.id)));
  }));
  app.post('/api/company/mail/drafts/:id/cancel', route((req, res) => {
    res.json(mail.cancel(security.authority(req, { humanOnly: true, csrf: true }), String(req.params.id)));
  }));
  return { security, mail, runtime, close: () => security.close() };
}
