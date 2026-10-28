import express from 'express';
import { createServer, request } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompanySecurity } from './security.ts';
import { closeLocalSetupServer, createLocalSetupApp, localSetupArguments } from './setupLocal.ts';

const password = 'temporary-test-password-no-real-account';
const replacementPassword = 'replacement-test-password-after-restart';
const origin = 'http://127.0.0.1:4454';
const headers = { host: '127.0.0.1:4454', origin, 'content-type': 'application/json' };
const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close(); });
function directories() {
  const root = mkdtempSync(path.join(tmpdir(), 'company-local-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const distDir = path.join(root, 'dist'), stateDir = path.join(root, 'new-state');
  mkdirSync(distDir);
  writeFileSync(path.join(distDir, 'index.html'), '<html><head><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></head><body>Oficina local</body></html>');
  return { root, distDir, stateDir };
}
async function http(app: ReturnType<typeof express>) {
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
  return (route: string, options: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string; json: () => any }>((resolve, reject) => {
    const req = request(base + route, { method: options.method ?? 'GET', headers: options.headers ?? headers }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: response.statusCode!, headers: response.headers, text, json: () => JSON.parse(text) }); });
    });
    req.on('error', reject); req.end(options.body === undefined ? undefined : JSON.stringify(options.body));
  });
}
async function prepared() {
  const dirs = directories();
  const setup = createLocalSetupApp({ stateDir: dirs.stateDir, distDir: dirs.distDir, port: 4454, password });
  cleanup.push(() => setup.close());
  const fetch = await http(setup.app);
  const response = await fetch('/api/company/session', { method: 'POST', body: { password } });
  expect(response.status).toBe(200);
  const cookie = String(response.headers['set-cookie']).split(';')[0];
  const auth = { ...headers, cookie, 'x-company-csrf': response.json().csrfToken };
  return { ...dirs, setup, fetch, auth };
}

describe('local company configuration without providers', () => {
  it('starts empty with department/profile templates, safe public metadata and offline HTML', async () => {
    const f = await prepared();
    const state = (await f.fetch('/api/company/state', { headers: f.auth })).json();
    expect(state.company).toEqual({ name: 'Mi empresa', objective: '' });
    expect(state.departments).toHaveLength(5); expect(state.profiles).toHaveLength(5);
    for (const field of ['agents', 'projects', 'tasks', 'comments', 'deliverables', 'reviews', 'knowledge', 'contacts', 'opportunities', 'calendar', 'runs']) expect(state[field]).toEqual([]);
    expect(state.migration).toBeNull(); expect(state.runtime.mode).toBe('blocked');
    const status = (await f.fetch('/api/company/security/status')).json();
    expect(status).toMatchObject({ mode: 'local', liveAvailable: false, authenticated: false });
    expect(JSON.stringify(status)).not.toContain(password); expect(status.demoPassword).toBeUndefined();
    const projection = (await f.fetch('/api/company/public')).json();
    expect(projection.deploymentMode).toBe('local'); expect(projection.agents).toEqual([]);
    expect(projection.csrfToken).toBeUndefined(); expect(projection.tasks).toBeUndefined();
    expect((await f.fetch('/')).headers.location).toBe('/?company=1');
    const page = await f.fetch('/?company=1');
    expect(page.text).not.toContain('fonts.googleapis.com');
    expect(page.headers['content-security-policy']).toContain("connect-src 'self'");
  });
  it('requires human cookie and CSRF; denies foreign origin, forged host/bearer and logout reuse', async () => {
    const f = await prepared();
    expect((await f.fetch('/api/company/state')).status).toBe(401);
    expect((await f.fetch('/api/company/session', { method: 'POST', body: { password: 'demo-oficina' } })).status).toBe(401);
    expect((await f.fetch('/api/company/state', { headers: { ...f.auth, host: 'evil.test:4454' } })).status).toBe(403);
    expect((await f.fetch('/api/company/', { method: 'PATCH', headers: { ...f.auth, origin: 'https://evil.test' }, body: { name: 'Otro', objective: 'Cambio' } })).status).toBe(403);
    expect((await f.fetch('/api/company/', { method: 'PATCH', headers: { ...headers, cookie: f.auth.cookie }, body: { name: 'Otro', objective: 'Cambio' } })).status).toBe(403);
    expect((await f.fetch('/api/company/state', { headers: { ...f.auth, authorization: 'Bearer spoof', 'x-role': 'manager' } })).status).toBe(403);
    expect((await f.fetch('/api/company/session', { method: 'DELETE', headers: f.auth })).status).toBe(200);
    expect((await f.fetch('/api/company/state', { headers: f.auth })).status).toBe(401);
    expect(() => f.setup.security.issueAgent('agent')).toThrow();
  });
  it('blocks every external/execution surface before changing state and never calls a network provider', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Unexpected network'); });
    const f = await prepared();
    const before = (await f.fetch('/api/company/state', { headers: f.auth })).json();
    for (const route of ['/tasks/id/run', '/workflows/id/execute', '/deliverables/id/mail-draft', '/context', '/mail/sync/box',
      '/mail/drafts', '/mail/drafts/id/approve', '/mail/drafts/id/send', '/mail/grants', '/social/accounts/id/verify', '/social/assets',
      '/social/drafts', '/social/drafts/id/approve', '/social/drafts/id/publish', '/social/drafts/id/export', '/credentials', '/models', '/integrations']) {
      expect((await f.fetch('/api/company' + route, { method: 'POST', headers: f.auth, body: { apiKey: 'IGNORED', sourceMessageIds: ['private'], model: 'external' } })).status, route).toBe(503);
    }
    for (const route of ['/api/state', '/api/hooks/token', '/api/mcp/token', '/api/agents', '/api/terminal']) {
      expect((await f.fetch(route, { method: 'POST', headers: f.auth, body: {} })).status, route).toBe(404);
    }
    expect((await f.fetch('/api/company/state', { headers: f.auth })).json()).toEqual(before);
    expect((await f.fetch('/api/company/mail/state', { headers: f.auth })).json()).toMatchObject({ mailboxes: [], messages: [], drafts: [], grants: [] });
    expect((await f.fetch('/api/company/social/state', { headers: f.auth })).json()).toEqual({ mode: 'blocked', accounts: [], assets: [], drafts: [] });
    expect(network).not.toHaveBeenCalled();
  });
  it('persists actual configuration across restart but rotates authentication and never persists the password', async () => {
    const f = await prepared();
    expect((await f.fetch('/api/company/', { method: 'PATCH', headers: f.auth, body: { name: 'Empresa nueva', objective: 'Preparar la estructura' } })).status).toBe(200);
    const agent = await f.fetch('/api/company/agents', { method: 'POST', headers: f.auth, body: { name: 'Operaciones', departmentId: 'operations', profileId: 'operations', model: '' } });
    expect(agent.status).toBe(200);
    expect((await f.fetch('/api/company/agents', { method: 'POST', headers: f.auth, body: { name: 'API', departmentId: 'operations', profileId: 'operations', model: 'external' } })).status).toBe(400);
    f.setup.close();
    expect((await f.fetch('/api/company/session', { method: 'POST', body: { password } })).status).toBe(503);
    const restarted = createLocalSetupApp({ stateDir: f.stateDir, distDir: f.distDir, port: 4454, password: replacementPassword });
    cleanup.push(() => restarted.close());
    const call = await http(restarted.app);
    expect((await call('/api/company/state', { headers: f.auth })).status).toBe(401);
    expect((await call('/api/company/session', { method: 'POST', body: { password } })).status).toBe(401);
    const login = await call('/api/company/session', { method: 'POST', body: { password: replacementPassword } });
    const state = (await call('/api/company/state', { headers: { ...headers, cookie: String(login.headers['set-cookie']).split(';')[0] } })).json();
    expect(state.company.name).toBe('Empresa nueva'); expect(state.agents).toHaveLength(1); expect(state.runs).toEqual([]);
    const contents = readdirSync(path.join(f.stateDir, 'company')).map(name => readFileSync(path.join(f.stateDir, 'company', name), 'utf8')).join('');
    expect(contents).not.toContain(password); expect(contents).not.toContain(replacementPassword);
  });
  it('rejects foreign data directories and existing leases without deleting or overwriting them', () => {
    const dirs = directories();
    mkdirSync(dirs.stateDir); writeFileSync(path.join(dirs.stateDir, 'mail.enc'), 'unchanged');
    expect(() => createLocalSetupApp({ stateDir: dirs.stateDir, distDir: dirs.distDir, port: 4454, password })).toThrow();
    expect(readFileSync(path.join(dirs.stateDir, 'mail.enc'), 'utf8')).toBe('unchanged');
    const another = directories();
    const one = createLocalSetupApp({ stateDir: another.stateDir, distDir: another.distDir, port: 4454, password });
    cleanup.push(() => one.close());
    expect(() => createLocalSetupApp({ stateDir: another.stateDir, distDir: another.distDir, port: 4454, password })).toThrow('bloqueo');
    expect(readFileSync(path.join(another.stateDir, 'setup-local.lock'), 'utf8')).toBe(String(process.pid));
    expect(() => createLocalSetupApp({ stateDir: path.join(homedir(), '.sareoffice', 'never-created'), distDir: another.distDir, port: 4454, password })).toThrow('directorio nuevo');
  });
  it('rejects configuration/provider injection and never activates execution from environment flags', () => {
    const dirs = directories();
    const valid = { stateDir: dirs.stateDir, distDir: dirs.distDir, port: 4454, password };
    expect(() => createLocalSetupApp({ ...valid, isolatedBroker: true, model: { apiKey: 'secret' } } as never)).toThrow();
    expect(existsSync(dirs.stateDir)).toBe(false);
    expect(() => new CompanySecurity({ demo: true, localConfiguration: true, password })).toThrow();
    expect(() => new CompanySecurity({ demo: false, isolatedBroker: true, localConfiguration: true, password })).toThrow();
    expect(() => localSetupArguments(['--state-dir', dirs.stateDir, '--config', 'secret'], {})).toThrow();
    expect(() => localSetupArguments(['--port', '4317'], { SWARM_HOME: dirs.stateDir })).toThrow();
    expect(() => localSetupArguments(['--port', '5317'], { SWARM_HOME: dirs.stateDir })).toThrow();
    expect(() => localSetupArguments(['--host', '0.0.0.0'], { SWARM_HOME: dirs.stateDir })).toThrow();
    expect(localSetupArguments([], { SWARM_HOME: dirs.stateDir, SWARM_PORT: '4454', OPENAI_API_KEY: 'never-read' } as never)).toEqual({ stateDir: dirs.stateDir, port: 4454 });
  });
  it('keeps the state lease until HTTP handlers drain, including the forced connection deadline', async () => {
    let done!: () => void;
    const release = vi.fn();
    const server = { close: vi.fn(callback => { done = callback; }), closeIdleConnections: vi.fn(), closeAllConnections: vi.fn() };
    const closing = closeLocalSetupServer(server as unknown as Parameters<typeof closeLocalSetupServer>[0], release, 5);
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
    done(); await closing; expect(release).toHaveBeenCalledOnce();
  });
});
