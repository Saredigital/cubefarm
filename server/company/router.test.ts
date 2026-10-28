import express, { type NextFunction, type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { CompanySecurity } from '../company-security/security.ts';
import { HttpError } from '../httpError.ts';
import { CompanyStore } from './store.ts';
import { createCompanyRouter } from './router.ts';

it('protects company state and verifies selected source IDs before accepting inherited context', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'company-http-'));
  const security = new CompanySecurity({ demo: true }); const login = security.login('demo-oficina');
  const instance = createCompanyRouter({ security, store: new CompanyStore(directory), demo: true, resolveSources: (authority, provenance) => {
    return provenance.sourceIds.filter((id) => id === 'mail-message').map(() => { security.absorb(authority, { mailboxIds: ['private-mailbox'], sourceIds: ['mail-message'] }); return { title: 'Correo privado', content: 'Fuente autorizada' }; });
  } });
  const app = express(); app.use(express.json()); app.use('/api/company', instance.router);
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => { res.status(error instanceof HttpError ? error.status : 500).json({ error: error.message }); });
  const server = http.createServer(app); await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/company`;
  const headers = { cookie: `company_session=${login.token}`, 'x-company-csrf': login.csrfToken, 'content-type': 'application/json' };
  try {
    expect((await fetch(`${base}/state`)).status).toBe(401);
    expect((await fetch(`${base}/public`)).status).toBe(200);
    expect((await fetch(`${base}/context`, { method: 'POST', headers: { cookie: headers.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ sourceMessageIds: ['mail-message'] }) })).status).toBe(403);
    expect((await fetch(`${base}/context`, { method: 'POST', headers, body: JSON.stringify({ sourceMessageIds: ['missing'] }) })).status).toBe(404);
    expect((await fetch(`${base}/context`, { method: 'POST', headers, body: JSON.stringify({ sourceMessageIds: ['mail-message'], mailboxIds: [] }) })).status).toBe(400);
    const selected = await fetch(`${base}/context`, { method: 'POST', headers, body: JSON.stringify({ sourceMessageIds: ['mail-message'] }) });
    expect(selected.status).toBe(200); expect(await selected.json()).toEqual({ provenance: { mailboxIds: ['private-mailbox'], sourceIds: ['mail-message'] } });
    const contact = await fetch(`${base}/contacts`, { method: 'POST', headers, body: JSON.stringify({ name: 'Contacto derivado' }) });
    expect(contact.status).toBe(200); expect((await contact.json()).provenance.mailboxIds).toEqual(['private-mailbox']);
  } finally { instance.close(); security.close(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
});
