// Reading old state files in today's shape, and the secret-looking values the office keeps out of its logs and
// messages. Pure, so they're tested without a running office.
import type { AgentView, HireRequestView } from '../shared/types.ts';

// QA testers' old lab stations became the east wall's desks.
const LAB_DESK = 12;
const LAB_STATIONS = 3;

/**
 * An agent as state files written before interchangeable agents (docs/agents.md) hold them, in today's shape:
 * developers and QA testers are agents (testers keep their seat: desk 12 + their station), and the title, specialty,
 * brief and hiredBy go, as does their career's bySpecialty. Today's records come back unchanged.
 */
export function legacyAgent<T extends object = Omit<AgentView, 'log'>>(a: T | Record<string, unknown>): T {
  const { title: _title, specialty: _specialty, brief: _brief, hiredBy: _hiredBy, ...rest } = a as Record<string, unknown>;
  const desk = typeof rest.desk === 'number' ? rest.desk : 0;
  const out: Record<string, unknown> = { ...rest, role: rest.role === 'ceo' ? 'ceo' : 'agent', desk: rest.role === 'qa' ? LAB_DESK + (desk % LAB_STATIONS) : desk };
  if (rest.career && typeof rest.career === 'object') {
    const { bySpecialty: _by, ...career } = rest.career as Record<string, unknown>;
    out.career = career;
  }
  return out as T;
}

/** A team change as old state files hold it, in today's shape: no role, title, specialty or brief; cli '' when it had none. */
export function legacyRequest<T extends object = HireRequestView>(r: T | Record<string, unknown>): T {
  const { role: _role, title: _title, specialty: _specialty, brief: _brief, ...rest } = r as Record<string, unknown>;
  return { ...rest, cli: typeof rest.cli === 'string' ? rest.cli : '' } as T;
}

/** Environment values that look like secrets (by their variable's name), to scrub out of anything shown or logged. */
export function envSecrets(env: Record<string, string | undefined>): string[] {
  return Object.entries(env)
    .filter(([k, v]) => !!v && v.length >= 8 && /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION/i.test(k))
    .map(([, v]) => v!);
}
