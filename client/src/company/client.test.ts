import { afterEach, expect, it, vi } from 'vitest';
import { companyRequest, setCompanyCsrf } from './client';
afterEach(() => { vi.unstubAllGlobals(); setCompanyCsrf(null); });
it('usa la cookie de sesión y el token CSRF en mutaciones, sin incluirlos en la URL', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  setCompanyCsrf('session-token');
  await companyRequest('/mail/drafts/draft/approve', 'POST', { version: 4, contentHash: 'immutable-hash' });
  expect(fetch).toHaveBeenCalledWith('/api/company/mail/drafts/draft/approve', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-company-csrf': 'session-token' }, body: '{"version":4,"contentHash":"immutable-hash"}' }));
});
it('propaga los rechazos del servidor y no presenta resultados fallidos como éxito', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"La versión ha cambiado"}', { status: 409 })));
  await expect(companyRequest('/mail/drafts/draft/send', 'POST', {})).rejects.toMatchObject({ status: 409, message: 'La versión ha cambiado' });
});
it('descarta una respuesta privada que llega después de cerrar la sesión', async () => {
  let resolve!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; })));
  setCompanyCsrf('old-session');
  const pending = companyRequest('/state');
  setCompanyCsrf(null);
  resolve(new Response('{"private":"mensaje de la sesión anterior"}', { status: 200 }));
  await expect(pending).rejects.toMatchObject({ message: 'La respuesta pertenece a una sesión cerrada.' });
});
