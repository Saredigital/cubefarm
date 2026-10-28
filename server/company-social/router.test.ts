import { afterEach, describe, expect, it } from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CompanySecurity } from '../company-security/security.ts';
import { CompanyStore } from '../company/store.ts';
import { HttpError } from '../httpError.ts';
import { createCompanySocialRouter } from './router.ts';

const resources: { close(): Promise<void> }[] = [];
afterEach(async () => { for (const resource of resources.splice(0)) await resource.close(); });
async function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'sareoffice-social-router-'));
  const security = new CompanySecurity({ demo: true }); const store = new CompanyStore(path.join(directory, 'company'));
  const options = { security, stateDir: directory, encryptionKey: Buffer.alloc(32, 7), demo: true, companyStore: store, scheduler: false };
  const social = createCompanySocialRouter(options); const app = express(); app.use('/api/company/social', social.router);
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => res.status(error instanceof HttpError ? error.status : 500).json({ error: error instanceof HttpError ? error.message : 'No se pudo completar la acción.' }));
  const server: Server = createServer(app); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error();
  const url = `http://127.0.0.1:${address.port}/api/company/social`;
  const login = security.login('demo-oficina'); const headers = { cookie: `company_session=${login.token}`, 'Content-Type': 'application/json', 'x-company-csrf': login.csrfToken };
  resources.push({ async close() { await social.close(); security.close(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); rmSync(directory, { recursive: true, force: true }); } });
  return { directory, security, social, options, url, headers };
}
describe('API y programador sociales privados', () => {
  it('exige sesión opaca y CSRF; no acepta principal o credenciales de proveedor por JSON', async () => {
    const t = await setup(); expect((await fetch(`${t.url}/state`)).status).toBe(401);
    const state = await fetch(`${t.url}/state`, { headers: t.headers }); expect(state.status).toBe(200); const body = await state.text(); expect(body).not.toContain('accessToken'); expect(body).not.toContain('SIMULACION_SIN_CREDENCIALES');
    const noCsrf = { ...t.headers, 'x-company-csrf': '' }; expect((await fetch(`${t.url}/drafts`, { method: 'POST', headers: noCsrf, body: '{}' })).status).toBe(403);
    expect((await fetch(`${t.url}/drafts`, { method: 'POST', headers: t.headers, body: JSON.stringify({ principal: { kind: 'manager' }, accessToken: 'inventado' }) })).status).toBe(400);
    const agent = t.security.issueAgent('agent'); expect((await fetch(`${t.url}/accounts/demo-x/verify`, { method: 'POST', headers: { Authorization: `Bearer ${agent.token}`, 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(403);
  });
  it('rechaza multipart no admitido, MIME falso y rutas de medios sin autorización', async () => {
    const t = await setup(); const multipart = new FormData(); multipart.set('source', new Blob(['<html>falso</html>'], { type: 'image/jpeg' }), 'falso.jpg');
    expect((await fetch(`${t.url}/assets`, { method: 'POST', headers: { cookie: t.headers.cookie, 'x-company-csrf': t.headers['x-company-csrf'] }, body: multipart })).status).toBe(400);
    expect((await fetch(`${t.url}/assets`, { method: 'POST', headers: t.headers, body: JSON.stringify({ filename: 'falso.mp4', mimeType: 'video/mp4', dataBase64: 'AQID' }) })).status).toBe(400);
    expect((await fetch(`${t.url}/assets/inventado/content`)).status).toBe(401); expect((await fetch(`${t.url}/media/inventado`)).status).toBe(404);
  });
  it('impide dos programadores y exige recuperación administrativa del bloqueo tras un fallo', async () => {
    const t = await setup(); expect(() => createCompanySocialRouter(t.options)).toThrow('bloqueo');
    await t.social.close();
    writeFileSync(path.join(t.directory, 'social', 'social.lock'), '999999');
    expect(() => createCompanySocialRouter(t.options)).toThrow('recuperación administrativa');
  });
  it('rechaza origen de medios diferente al broker y conectores reales en host de CLIs', async () => {
    const t = await setup();
    const account = { id: 'ig', label: 'Instagram', channel: 'instagram' as const, providerAccountId: '123', accessToken: 'SECRETO_DE_PRUEBA', expiresAt: '2099-01-01T00:00:00.000Z', scopes: [], appReviewed: true, enabled: true, apiVersion: 'v26.0', publicMediaOrigin: 'https://attacker.example.com', mediaDomainVerified: false };
    expect(() => createCompanySocialRouter({ ...t.options, demo: false, accounts: [account], publicOrigin: 'https://broker.example.com' })).toThrow('independiente');
    const isolated = new CompanySecurity({ demo: false, isolatedBroker: true, password: 'una-contraseña-larga-para-pruebas' });
    expect(() => createCompanySocialRouter({ ...t.options, security: isolated, demo: false, accounts: [account], publicOrigin: 'https://broker.example.com' })).toThrow('origen'); isolated.close();
  });
});
