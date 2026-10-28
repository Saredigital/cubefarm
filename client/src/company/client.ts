// Session tokens are held in memory only. Cookies are managed by the server.
let csrfToken: string | null = null;
let sessionEpoch = 0;
export const companySessionEpoch = () => sessionEpoch;
export function setCompanyCsrf(value: string | null) {
  if (value === null || value !== csrfToken) sessionEpoch += 1;
  csrfToken = value;
}
export class CompanyStaleResponseError extends Error {
  constructor() { super('La respuesta pertenece a una sesión cerrada.'); }
}
export class CompanyHttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function companyRequest<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const epoch = sessionEpoch;
  const response = await fetch(`/api/company${path}`, {
    method, credentials: 'same-origin', cache: 'no-store', signal,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(csrfToken && method !== 'GET' ? { 'x-company-csrf': csrfToken } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json().catch(() => null);
  // Logout/revocation wins over any earlier request, even if its network response arrives later.
  if (epoch !== sessionEpoch) throw new CompanyStaleResponseError();
  if (!response.ok) {
    if (response.status === 401) {
      setCompanyCsrf(null);
      if (typeof window !== 'undefined') window.dispatchEvent(new Event('company:session-expired'));
    }
    const message = result && typeof result === 'object' && 'error' in result ? String(result.error) : `No se pudo completar la operación (${response.status}).`;
    throw new CompanyHttpError(response.status, message);
  }
  return result as T;
}
