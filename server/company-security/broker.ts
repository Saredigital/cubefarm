/** Standalone service: importing this entry point never starts Swarm, PTYs, CLIs or legacy APIs. */
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer } from 'node:https';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createCompanyRouter } from '../company/router.ts';
import { CompanyStore } from '../company/store.ts';
import { createCompanySocialRouter } from '../company-social/router.ts';
import { HttpError } from '../httpError.ts';
import { GraphMailProvider, GraphTokenSource } from '../mail/graph.ts';
import { ImapMailProvider } from '../mail/imap.ts';
import type { MailProvider } from '../mail/provider.ts';
import { mountCompanyMail } from '../mail/router.ts';
import { emptyMailDatabase } from '../mail/service.ts';
import { brokerConfigSchema, type BrokerConfig } from './brokerConfig.ts';
import { EncryptedStore } from './vault.ts';
import { assertKeyOutsideState, assertWindowsBrokerDeployment } from './deployment.ts';

export interface BrokerOptions {
  config: BrokerConfig;
  stateDir: string;
  encryptionKey: Uint8Array;
  distDir?: string;
  /** Tests inject simulators; the public launcher never accepts providers from config. */
  providers?: Map<string, MailProvider>;
}
export function createBrokerApp(options: BrokerOptions) {
  const config = brokerConfigSchema.parse(options.config);
  const app = express();
  app.disable('x-powered-by');
  const origin = new URL(config.publicOrigin).origin;
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'Strict-Transport-Security': 'max-age=31536000' });
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) {
      res.status(403).json({ error: 'Origen no autorizado.' }); return;
    }
    // Browser mutation requests must originate at the human broker UI. Agent channels remain bearer-only.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.headers.authorization && req.headers.origin !== origin) {
      res.status(403).json({ error: 'La acción debe iniciarse desde la interfaz protegida.' }); return;
    }
    next();
  });
  app.use('/api/company/social/assets', (req, _res, next) => {
    try { mail.security.authority(req, { csrf: req.method !== 'GET' }); next(); } catch (error) { next(error); }
  }, express.json({ limit: '17mb' }));
  app.use(express.json({ limit: '256kb' }));
  const database = emptyMailDatabase();
  database.mailboxes = config.mailboxes.map(mailbox => ({
    id: mailbox.id, name: mailbox.name, address: mailbox.address, folders: mailbox.folders,
    provider: mailbox.connection.provider, enabled: true, permissionVersion: 1,
  }));
  if (new Set(database.mailboxes.map(mailbox => mailbox.id)).size !== database.mailboxes.length) throw new Error('Los identificadores de buzón deben ser únicos.');
  const providers = options.providers ?? new Map(config.mailboxes.map(mailbox => [
    mailbox.id, mailbox.connection.provider === 'graph'
      ? new GraphMailProvider(mailbox.connection.userId, new GraphTokenSource(mailbox.connection))
      : new ImapMailProvider(mailbox.connection),
  ]));
  const mail = mountCompanyMail(app, { demo: false, isolatedBroker: true, stateDir: options.stateDir,
    encryptionKey: options.encryptionKey, password: config.managerPassword, providers, database, model: config.model });
  const companyStore = new CompanyStore(path.join(options.stateDir, 'company'), undefined, undefined, { encryptionKey: options.encryptionKey });
  const company = createCompanyRouter({ security: mail.security, store: companyStore,
    demo: false, runtime: mail.runtime, resolveSources: (authority, provenance) => mail.mail.context(authority, provenance),
    createMailDraft: (authority, input) => {
      const source = mail.mail.read(authority, input.messageId!);
      return mail.mail.createDraft(authority, { ...input, to: input.to ?? (source.replyTo?.length ? source.replyTo : [source.from]) });
    } });
  const social = createCompanySocialRouter({ security: mail.security, stateDir: options.stateDir,
    encryptionKey: options.encryptionKey, demo: false, companyStore, accounts: config.socialAccounts,
    publicOrigin: origin, sourcePermissionVersion: provenance => mail.mail.permissionFingerprint(provenance) });
  app.use('/api/company/social', social.router);
  app.use('/api/company', company.router);
  app.use('/api', (_req, res) => { res.status(404).json({ error: 'Esta API no existe en el servicio protegido.' }); });
  app.get('/', (req, res, next) => { if (req.query.company !== '1') res.redirect('/?company=1'); else next(); });
  if (options.distDir) app.use(express.static(options.distDir, { index: 'index.html' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    // Provider exceptions may contain credentials, addresses or response bodies; never log them.
    res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof HttpError ? error.message : 'No se pudo completar la operación protegida.' });
  });
  return { app, mail, company, social, async close() { company.close(); mail.close(); await social.close(); } };
}

/** Stop accepting requests and await both HTTP handlers and the scheduler; never release its lease on a deadline. */
export async function drainBroker(server: Pick<Server, 'close' | 'closeIdleConnections'>, close: () => Promise<void>, timeoutMs = 45_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const connections = new Promise<void>(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('El cierre protegido agotó su plazo.')), timeoutMs);
  });
  try { await Promise.race([Promise.all([connections, close()]), deadline]); }
  finally { if (timer) clearTimeout(timer); }
}

export async function startBroker(args = process.argv.slice(2)): Promise<void> {
  const value = (name: string) => {
    const index = args.indexOf(name);
    if (index < 0 || !args[index + 1]) throw new Error(`Falta ${name}. Consulta docs/security-company.md.`);
    return path.resolve(args[index + 1]);
  };
  const configPath = value('--config');
  const keyPath = value('--key-file');
  const stateDir = value('--state-dir');
  const certificatePath = value('--tls-cert');
  const tlsKeyPath = value('--tls-key');
  assertWindowsBrokerDeployment([configPath, keyPath, stateDir, tlsKeyPath], [process.cwd(), path.dirname(process.execPath)]);
  const key = readFileSync(keyPath);
  assertKeyOutsideState(keyPath, stateDir);
  const configuration = new EncryptedStore<unknown>(configPath, key, 'broker-config').load(() => { throw new Error('Falta la configuración cifrada.'); });
  const config = brokerConfigSchema.parse(configuration);
  const broker = createBrokerApp({ config, stateDir, encryptionKey: key, distDir: path.resolve('dist') });
  const server = createServer({ cert: readFileSync(certificatePath), key: readFileSync(tlsKeyPath), minVersion: 'TLSv1.2' }, broker.app);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.listenHost, resolve);
  });
  console.log(`Servicio de empresa protegido disponible en ${config.publicOrigin}. Las cuentas solo se sincronizan por acción del responsable.`);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    // A hard deadline keeps the durable sending record and stale lease. Startup recovers conservatively.
    void drainBroker(server, () => broker.close()).catch(() => process.exit(1));
  };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startBroker().catch(() => { console.error('No se pudo iniciar el servicio protegido. Revisa la configuración, las claves y TLS.'); process.exitCode = 1; });
}
