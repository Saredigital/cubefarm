/** Human-only local configuration. No broker, mailbox adapter, model, shell or legacy runtime imports. */
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { CompanyStore, initialCompany } from '../company/store.ts';
import { createCompanyRouter } from '../company/router.ts';
import { HttpError } from '../httpError.ts';
import { CompanySecurity, LOCAL_SESSION_COOKIE } from './security.ts';
import type { CompanyPublicView } from '../../shared/company.ts';
import type { MailState } from '../../shared/mail.ts';
import type { SocialSnapshot } from '../../shared/companySocial.ts';

export const LOCAL_CONFIGURATION_REASON = 'Configuración local: sin conexiones, secretos ni ejecución de agentes.';
const portSchema = z.number().int().min(1024).max(65535).refine(port => ![4317, 5317].includes(port), 'Puerto reservado para la oficina existente.');
const optionsSchema = z.object({ stateDir: z.string().min(1), port: portSchema, password: z.string().min(20).max(256), distDir: z.string().min(1) }).strict();
const markerSchema = z.object({ kind: z.literal('sareoffice-local-configuration'), version: z.literal(1), id: z.uuid() }).strict();
const markerName = 'setup-local.json';
function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative);
}
function assertNoLinks(target: string): void {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('La configuración local no admite enlaces de directorios.');
    if (path.dirname(current) === current) break;
  }
}
/** Separate marker prevents accidental reuse of the demo, office or production state. */
function localDirectory(value: string): { directory: string; release(): void } {
  const directory = path.resolve(value);
  const live = path.join(homedir(), '.sareoffice');
  if (within(live, directory) || within(directory, live)) throw new Error('Elige un directorio nuevo fuera del estado de la oficina.');
  assertNoLinks(directory);
  if (existsSync(directory) && !lstatSync(directory).isDirectory()) throw new Error('La ruta de configuración debe ser un directorio.');
  const marker = path.join(directory, markerName);
  if (existsSync(directory) && readdirSync(directory).length && !existsSync(marker)) throw new Error('El directorio contiene datos anteriores. Elige uno nuevo y vacío.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (existsSync(marker)) markerSchema.parse(JSON.parse(readFileSync(marker, 'utf8')));
  else writeFileSync(marker, JSON.stringify({ kind: 'sareoffice-local-configuration', version: 1, id: randomUUID() }), { flag: 'wx', mode: 0o600 });
  for (const entry of readdirSync(directory)) {
    if (![markerName, 'company', 'setup-local.lock'].includes(entry)) throw new Error('El directorio no corresponde a una configuración local independiente.');
    assertNoLinks(path.join(directory, entry));
  }
  const lock = path.join(directory, 'setup-local.lock');
  if (existsSync(lock)) {
    // Never unlink an observed stale PID: concurrent starters could otherwise remove each other's lease.
    throw new Error('Existe un bloqueo local. Comprueba y recupera el cierre anterior antes de volver a arrancar.');
  }
  writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
  return { directory, release() { if (existsSync(lock) && readFileSync(lock, 'utf8') === String(process.pid)) unlinkSync(lock); } };
}

export function createLocalSetupApp(input: { stateDir: string; port: number; password: string; distDir: string }) {
  // Reject unknown options even for programmatic callers; there is no adapter/model injection seam.
  const options = optionsSchema.parse(input);
  const origin = 'http://127.0.0.1:' + options.port;
  const distDir = path.resolve(options.distDir);
  // No Google Fonts preconnect/stylesheet requests in the offline entry. Assets stay same-origin.
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf8').replace(/<link\b[^>]*href=["'](?:https?:)?\/\/[^"']*["'][^>]*>/gi, '');
  const local = localDirectory(options.stateDir);
  const security = new CompanySecurity({ demo: false, localConfiguration: true, password: options.password });
  try {
    const initialState = initialCompany();
    initialState.company = { name: 'Mi empresa', objective: '' };
    initialState.agents = [];
    const companyDirectory = path.join(local.directory, 'company');
    if (existsSync(companyDirectory)) for (const entry of readdirSync(companyDirectory)) {
      assertNoLinks(path.join(companyDirectory, entry));
      if (!/^company-state\.json(?:\.(?:previous|before-restore|[a-f0-9-]+\.tmp))?$/.test(entry)) throw new Error('El directorio contiene datos de otro modo.');
    }
    const store = new CompanyStore(companyDirectory, undefined, undefined, { initialState });
    const state = store.read();
    if (state.migration || state.runs.length || state.agents.some(agent => agent.model) ||
      [...state.projects, ...state.tasks, ...state.comments, ...state.reviews, ...state.contacts, ...state.opportunities, ...state.calendar,
        ...state.deliverables.flatMap(item => item.versions), ...state.knowledge.flatMap(item => item.versions)]
        .some(item => item.provenance.mailboxIds.length || item.provenance.sourceIds.length)) {
      throw new Error('La configuración local no admite ejecuciones ni datos importados de integraciones.');
    }
    const company = createCompanyRouter({ security, store, demo: false });
    const app = express();
    app.disable('x-powered-by');
    app.use((req, res, next) => {
      if (closed) { res.status(503).json({ error: 'La instancia local se ha cerrado.' }); return; }
      res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
      if (!['127.0.0.1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || req.headers.host !== new URL(origin).host ||
        req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== origin) ||
        (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) || req.headers.authorization) {
        res.status(403).json({ error: 'La configuración local solo admite su interfaz en este equipo.' }); return;
      }
      next();
    });
    app.use(express.json({ limit: '256kb' }));
    app.get('/api/company/security/status', (req, res) => { res.json(security.status(req)); });
    app.post('/api/company/session', (req, res) => {
      const body = z.object({ password: z.string().max(256) }).strict().parse(req.body);
      const login = security.login(body.password);
      res.cookie(LOCAL_SESSION_COOKIE, login.token, { httpOnly: true, sameSite: 'strict', secure: false, path: '/api/company', maxAge: 60 * 60_000 });
      res.json({ csrfToken: login.csrfToken, principal: login.principal });
    });
    app.delete('/api/company/session', (req, res) => {
      security.revoke(security.authority(req, { humanOnly: true, csrf: true }));
      res.clearCookie(LOCAL_SESSION_COOKIE, { path: '/api/company', httpOnly: true, sameSite: 'strict' }); res.json({ ok: true });
    });
    app.get('/api/company/public', (_req, res) => {
      const projection: CompanyPublicView = { ...company.service.publicView(), deploymentMode: 'local' };
      res.json(projection);
    });
    // An authenticated human may configure structure and planned work, never trigger an external action.
    app.use('/api/company', (req, _res, next) => {
      try { security.authority(req, { humanOnly: true, csrf: !['GET', 'HEAD', 'OPTIONS'].includes(req.method) }); next(); }
      catch (error) { next(error); }
    });
    app.get('/api/company/state', (req, res) => { res.json({ ...company.service.snapshot(security.authority(req)), runtime: { mode: 'blocked', reason: LOCAL_CONFIGURATION_REASON } }); });
    const mail: MailState = { mailboxes: [], messages: [], drafts: [], grants: [], integrations: [
      { provider: 'graph', mode: 'blocked', label: 'Microsoft 365 · no disponible en configuración local' },
      { provider: 'imap', mode: 'blocked', label: 'IMAP / SMTP · no disponible en configuración local' },
    ] };
    app.get('/api/company/mail/state', (_req, res) => { res.json(mail); });
    app.get('/api/company/mail/mailboxes', (_req, res) => { res.json([]); });
    app.get('/api/company/social/state', (_req, res) => {
      const social: SocialSnapshot = { mode: 'blocked', accounts: [], assets: [], drafts: [] }; res.json(social);
    });
    app.use('/api/company', (req, _res, next) => {
      if (/^\/(?:mail|social|context|integrations|credentials|models|runtime|sessions|recovery)(?:\/|$)/i.test(req.path) ||
        /^\/(?:tasks\/[^/]+\/run|workflows\/[^/]+\/execute|deliverables\/[^/]+\/mail-draft)\/?$/i.test(req.path)) {
        next(new HttpError(503, LOCAL_CONFIGURATION_REASON)); return;
      }
      if (/^\/agents(?:\/|$)/i.test(req.path) && req.body?.model) { next(new HttpError(400, 'Los modelos se configuran en el servicio protegido, no en esta instancia local.')); return; }
      next();
    });
    app.use('/api/company', company.router);
    app.use('/api', (_req, res) => { res.status(404).json({ error: 'Esta API no está disponible en configuración local.' }); });
    app.get('/', (req, res) => { if (req.query.company !== '1') res.redirect('/?company=1'); else res.type('html').send(html); });
    app.get('/index.html', (_req, res) => { res.type('html').send(html); });
    app.use(express.static(distDir, { index: false, dotfiles: 'deny' }));
    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500)
        .json({ error: error instanceof HttpError ? error.message : 'No se pudo completar la configuración local.' });
    });
    let closed = false;
    return { app, security, company, origin, close() { if (closed) return; closed = true; company.close(); security.close(); local.release(); } };
  } catch (error) { security.close(); local.release(); throw error; }
}

export function localSetupArguments(args: string[], environment: { SWARM_HOME?: string; SWARM_PORT?: string } = process.env) {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!['--state-dir', '--port'].includes(flag) || values.has(flag) || !value || value.startsWith('--')) throw new Error('Usa únicamente --state-dir y --port.');
    values.set(flag, value);
  }
  const stateDir = values.get('--state-dir') ?? environment.SWARM_HOME;
  if (!stateDir) throw new Error('Indica --state-dir con un directorio nuevo o SWARM_HOME aislado.');
  const port = portSchema.parse(Number(values.get('--port') ?? environment.SWARM_PORT ?? '4454'));
  return { stateDir: path.resolve(stateDir), port };
}

export function closeLocalSetupServer(server: Pick<Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>, release: () => void, timeoutMs = 5000): Promise<void> {
  return new Promise(resolve => {
    const force = setTimeout(() => server.closeAllConnections(), timeoutMs); force.unref();
    server.close(() => { clearTimeout(force); release(); resolve(); });
    server.closeIdleConnections();
  });
}

export async function startLocalSetup(args = process.argv.slice(2)): Promise<void> {
  const options = localSetupArguments(args);
  const password = randomBytes(24).toString('base64url');
  const setup = createLocalSetupApp({ ...options, password, distDir: fileURLToPath(new URL('../../dist', import.meta.url)) });
  const server = createServer(setup.app);
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  } catch (error) { setup.close(); throw error; }
  console.log('Configuración local disponible en ' + setup.origin + '/?company=1');
  console.log('Contraseña temporal: ' + password);
  console.log('Se renueva en cada arranque. No introduzcas secretos ni datos confidenciales. Conexiones y ejecución bloqueadas.');
  let closing = false;
  const close = () => {
    if (closing) return; closing = true;
    void closeLocalSetupServer(server, () => setup.close());
  };
  process.once('SIGTERM', close); process.once('SIGINT', close);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  startLocalSetup().catch(() => { console.error('No se pudo iniciar la configuración local. Usa --state-dir nuevo y --port libre, después de npm run build.'); process.exitCode = 1; });
}
