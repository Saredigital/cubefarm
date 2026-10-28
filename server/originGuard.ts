// Which browser requests may talk to the office. It listens on loopback only, but any web page open in the same
// browser can still reach 127.0.0.1: a WebSocket (no CORS, no preflight) could read the office and type into an
// agent's terminal, and DNS rebinding can point a hostile name at it. Two checks close both:
//  - Host: the name the request was sent to must be loopback, the manager's own office address (Settings → Notificaciones)
//    or one listed in SAREOFFICE_ALLOWED_HOSTS. That defeats DNS rebinding.
//  - Origin: when a browser sends one, it must be the same origin as the Host (the office's own page). That defeats
//    cross-site pages. Requests without an Origin (agent CLIs calling back, curl, tests) are local processes, which
//    can already do anything the manager's account can.

/** Host names (no port) that always count as this machine. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\]|[a-z0-9-]+\.localhost)$/i;

export interface GuardOptions {
  /** Extra host names (no port) the office may be reached by: a Tailscale Serve name, say. */
  extraHosts?: () => readonly string[];
}

/** The lower-cased host name of a `Host` header value, without its port; null when it isn't one. */
export function hostName(hostHeader: string | undefined): string | null {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** The host names in a comma-separated list (SAREOFFICE_ALLOWED_HOSTS), or the one in a URL. */
export function hostsOf(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/^[a-z]+:\/\//i.test(s) ? hostName(new URL(s).host) : hostName(s)))
    .filter((h): h is string => !!h);
}

/** Why a request must be refused, or null when it may go on. */
export function refusal(headers: { host?: string; origin?: string }, opts: GuardOptions = {}): string | null {
  const host = hostName(headers.host);
  if (!host) return 'Falta la cabecera Host';
  const trusted = host !== null && (LOOPBACK.test(host) || (opts.extraHosts?.() ?? []).includes(host));
  if (!trusted) return `La oficina no atiende peticiones para el nombre ${host}`;
  const origin = headers.origin;
  if (origin === undefined) return null;
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return 'Origin no válido';
  }
  // Same origin: the page was served by this very office, whatever name or port it was reached on.
  if ((from.protocol === 'http:' || from.protocol === 'https:') && from.host.toLowerCase() === (headers.host ?? '').toLowerCase()) return null;
  return `La oficina no acepta peticiones desde ${origin}`;
}
