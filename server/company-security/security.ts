/** Opaque sessions and sticky provenance. Objects supplied over HTTP cannot be authorities. */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { CompanyAuthority, CompanyPrincipal, CompanySecurityStatus, MailCapability, MailGrant, Provenance } from '../../shared/companySecurity.ts';
import { combineProvenance } from '../../shared/companySecurity.ts';
import { HttpError } from '../httpError.ts';

interface Session {
  token: string;
  csrf: string;
  expires: number;
  authority: CompanyAuthority;
  scope: Provenance;
  abort: AbortController;
}

const empty = (): Provenance => ({ mailboxIds: [], sourceIds: [] });
export const SESSION_COOKIE = 'company_session';
export const LOCAL_SESSION_COOKIE = 'company_local_session';
export const DEMO_PASSWORD = 'demo-oficina';
export interface SecurityOptions {
  demo: boolean;
  /** Only the separate broker entry point supplies this; never a request/env security assertion. */
  isolatedBroker?: boolean;
  /** Human-only offline configuration, never an integration or execution authority. */
  localConfiguration?: boolean;
  password?: string;
  now?: () => number;
}
export function validateGrant(grant: MailGrant): void {
  if (!grant || typeof grant.agentId !== 'string' || !grant.agentId || typeof grant.mailboxId !== 'string' || !grant.mailboxId ||
    !Array.isArray(grant.capabilities) || grant.capabilities.some(value => !['read', 'organize', 'draft'].includes(value)) ||
    (grant.capabilities.length > 0 && !grant.capabilities.includes('read'))) throw new HttpError(400, 'Permisos de buzón inválidos.');
}

export class CompanySecurity {
  readonly mode: 'demo' | 'blocked' | 'isolated' | 'local';
  private sessions = new Map<string, Session>();
  private authorities = new WeakMap<CompanyAuthority, Session>();
  private grants: MailGrant[] = [];
  private salt = randomBytes(32);
  private passwordHash: Buffer;
  private now: () => number;
  private failures: number[] = [];
  private listeners = new Set<(agentId: string, mailboxId: string) => void>();

  constructor(options: SecurityOptions) {
    if (options.localConfiguration && (options.demo || options.isolatedBroker)) throw new Error('La configuración local no admite otros modos.');
    this.mode = options.localConfiguration ? 'local' : options.demo ? 'demo' : options.isolatedBroker ? 'isolated' : 'blocked';
    if (['isolated', 'local'].includes(this.mode) && (!options.password || options.password.length < 20)) {
      throw new Error('La contraseña del responsable debe tener al menos 20 caracteres.');
    }
    this.passwordHash = scryptSync(options.demo ? DEMO_PASSWORD : options.password ?? randomBytes(64).toString('hex'), this.salt, 32);
    this.now = options.now ?? Date.now;
  }

  status(req?: { headers: IncomingHttpHeaders }): CompanySecurityStatus {
    let session: Session | undefined;
    try { if (req) session = this.session(this.authority(req)); } catch { /* Public status has no private details. */ }
    return {
      mode: this.mode, liveAvailable: this.mode === 'isolated',
      reason: this.mode === 'demo' ? 'Simulación: no se conecta ni envía correo real.'
        : this.mode === 'local' ? 'Configuración local: sin conexiones, secretos ni ejecución de agentes.'
        : this.mode === 'blocked' ? 'Correo real bloqueado: requiere el servicio protegido en un equipo independiente de las CLIs.'
          : 'Servicio protegido independiente. Requiere administración y red de confianza.',
      authenticated: session?.authority.principal.kind === 'manager',
      ...(session?.authority.principal.kind === 'manager' ? { csrfToken: session.csrf } : {}),
      ...(this.mode === 'demo' ? { demoPassword: DEMO_PASSWORD } : {}),
    };
  }

  login(password: unknown): { token: string; csrfToken: string; principal: CompanyPrincipal } {
    if (this.mode === 'blocked') throw new HttpError(503, 'Utiliza el servicio protegido independiente para gestionar datos de empresa.');
    this.failures = this.failures.filter(at => this.now() - at < 60_000);
    if (this.failures.length >= 8) throw new HttpError(429, 'Demasiados intentos. Espera un minuto.');
    const candidate = typeof password === 'string' && password.length <= 256 ? password : '';
    if (!timingSafeEqual(scryptSync(candidate, this.salt, 32), this.passwordHash)) {
      this.failures.push(this.now());
      throw new HttpError(401, 'Credenciales incorrectas.');
    }
    const session = this.issue({ id: 'responsable', kind: 'manager' });
    return { token: session.token, csrfToken: session.csrf, principal: session.authority.principal };
  }

  /** This is called by the trusted dispatcher; there is deliberately no agent issuance HTTP route. */
  issueAgent(agentId: string): { token: string; authority: CompanyAuthority; signal: AbortSignal } {
    if (!agentId || this.mode === 'blocked' || this.mode === 'local') throw new HttpError(403, 'Ejecución no disponible.');
    const session = this.issue({ id: `agent:${agentId}`, kind: 'agent', agentId });
    return { token: session.token, authority: session.authority, signal: session.abort.signal };
  }

  private issue(principal: CompanyPrincipal): Session {
    const scope = empty();
    const session: Session = {
      token: randomBytes(32).toString('base64url'), csrf: randomBytes(32).toString('base64url'),
      expires: this.now() + 60 * 60_000, scope, abort: new AbortController(),
      authority: Object.freeze({ principal: Object.freeze(principal), get provenance() { return structuredClone(scope); } }),
    };
    this.sessions.set(session.token, session);
    this.authorities.set(session.authority, session);
    return session;
  }

  authority(req: { headers: IncomingHttpHeaders }, options: { humanOnly?: boolean; csrf?: boolean } = {}): CompanyAuthority {
    const authorization = req.headers.authorization;
    const cookieName = this.mode === 'local' ? LOCAL_SESSION_COOKIE : SESSION_COOKIE;
    const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : cookie;
    const session = token ? this.sessions.get(token) : undefined;
    if (!session || session.expires <= this.now()) throw new HttpError(401, 'Inicia sesión como responsable.');
    // Human credentials never work on the agent bearer channel, or vice versa.
    if ((!!authorization) !== (session.authority.principal.kind === 'agent')) throw new HttpError(403, 'Canal de identidad incorrecto.');
    this.assertAuthority(session.authority);
    if (options.humanOnly && session.authority.principal.kind !== 'manager') throw new HttpError(403, 'Esta acción requiere al responsable.');
    if (options.csrf && session.authority.principal.kind === 'manager' && req.headers['x-company-csrf'] !== session.csrf) {
      throw new HttpError(403, 'La sesión de revisión ha cambiado. Recarga la página.');
    }
    return session.authority;
  }

  private session(authority: CompanyAuthority): Session {
    const session = this.authorities.get(authority);
    if (!session || !this.sessions.has(session.token) || session.abort.signal.aborted || session.expires <= this.now()) {
      throw new HttpError(401, 'Sesión caducada o revocada.');
    }
    return session;
  }

  assertAuthority(authority: CompanyAuthority): void { this.session(authority); }
  assertHuman(authority: CompanyAuthority): void {
    this.assertAuthority(authority);
    if (authority.principal.kind !== 'manager') throw new HttpError(403, 'Solo el responsable puede aprobar o ejecutar acciones externas.');
  }

  canRead(authority: CompanyAuthority, provenance: Provenance): boolean {
    this.assertAuthority(authority);
    return authority.principal.kind === 'manager' || this.canAssign(authority.principal.agentId!, provenance);
  }

  canAssign(agentId: string, provenance: Provenance): boolean {
    return provenance.mailboxIds.every(mailboxId => this.grants.some(grant =>
      grant.agentId === agentId && grant.mailboxId === mailboxId && grant.capabilities.includes('read')));
  }

  requireCapability(authority: CompanyAuthority, mailboxId: string, capability: MailCapability): void {
    this.assertAuthority(authority);
    if (authority.principal.kind === 'manager') return;
    if (!this.grants.some(grant => grant.agentId === authority.principal.agentId && grant.mailboxId === mailboxId && grant.capabilities.includes(capability))) {
      throw new HttpError(403, 'No tienes permiso para este buzón.');
    }
  }

  absorb(authority: CompanyAuthority, provenance: Provenance): void {
    if (!this.canRead(authority, provenance)) throw new HttpError(403, 'No tienes acceso a todas las fuentes.');
    const session = this.session(authority);
    const combined = combineProvenance(session.scope, provenance);
    session.scope.mailboxIds = combined.mailboxIds;
    session.scope.sourceIds = combined.sourceIds;
  }

  scope(authority: CompanyAuthority, extra: Provenance = empty()): Provenance {
    const session = this.session(authority);
    const combined = combineProvenance(session.scope, extra);
    if (!this.canRead(authority, combined)) throw new HttpError(403, 'No tienes acceso a todas las fuentes.');
    return combined;
  }

  listGrants(authority: CompanyAuthority): MailGrant[] { this.assertHuman(authority); return structuredClone(this.grants); }
  seedGrants(grants: MailGrant[]): void { this.grants = structuredClone(grants); }
  setGrant(authority: CompanyAuthority, grant: MailGrant): void {
    this.assertHuman(authority);
    validateGrant(grant);
    this.grants = this.grants.filter(item => item.agentId !== grant.agentId || item.mailboxId !== grant.mailboxId);
    if (grant.capabilities.length) this.grants.push(structuredClone(grant));
    // Every permission change rotates affected credentials, including sessions with no read yet.
    for (const session of this.sessions.values()) {
      if (session.authority.principal.agentId === grant.agentId) this.revoke(session.authority);
    }
    for (const listener of this.listeners) listener(grant.agentId, grant.mailboxId);
  }

  onRevocation(listener: (agentId: string, mailboxId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  revoke(authority: CompanyAuthority): void {
    const session = this.authorities.get(authority);
    if (session) { session.abort.abort(); this.sessions.delete(session.token); }
  }
  close(): void { for (const session of this.sessions.values()) this.revoke(session.authority); }
}
