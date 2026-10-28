import { describe, expect, it } from 'vitest';
import { CompanySecurity, DEMO_PASSWORD } from './security.ts';
import type { CompanyAuthority } from '../../shared/companySecurity.ts';

export function manager(security: CompanySecurity) {
  const login = security.login(DEMO_PASSWORD);
  const request = { headers: { cookie: `company_session=${login.token}`, 'x-company-csrf': login.csrfToken } };
  return { ...login, request, authority: security.authority(request) };
}
describe('company security boundary', () => {
  it('denies spoofed headers and structurally forged identities', () => {
    const security = new CompanySecurity({ demo: true });
    expect(() => security.authority({ headers: { 'x-agent-id': 'admin', 'x-role': 'manager' } })).toThrow();
    expect(() => security.assertHuman({ principal: { id: 'responsable', kind: 'manager' }, provenance: { mailboxIds: [], sourceIds: [] } })).toThrow();
  });
  it('separates human cookies from agent bearer credentials and checks CSRF', () => {
    const security = new CompanySecurity({ demo: true });
    const human = manager(security);
    const agent = security.issueAgent('worker');
    expect(() => security.authority({ headers: { authorization: `Bearer ${human.token}` } })).toThrow();
    expect(() => security.authority({ headers: { cookie: `company_session=${agent.token}` } })).toThrow();
    expect(() => security.authority({ headers: { authorization: `Bearer ${agent.token}` } }, { humanOnly: true })).toThrow();
    expect(() => security.authority({ headers: { cookie: `company_session=${human.token}` } }, { csrf: true })).toThrow();
    expect(security.authority(human.request, { csrf: true, humanOnly: true }).principal.kind).toBe('manager');
  });
  it('requires all mailboxes and cannot remove sticky context or mutate principal', () => {
    const security = new CompanySecurity({ demo: true });
    const human = manager(security);
    security.setGrant(human.authority, { agentId: 'a', mailboxId: 'one', capabilities: ['read'] });
    const agent = security.issueAgent('a');
    security.absorb(agent.authority, { mailboxIds: ['one'], sourceIds: ['secret'] });
    agent.authority.provenance.mailboxIds.length = 0;
    expect(security.scope(agent.authority)).toEqual({ mailboxIds: ['one'], sourceIds: ['secret'] });
    expect(security.canRead(agent.authority, { mailboxIds: ['one', 'two'], sourceIds: [] })).toBe(false);
    expect(() => { (agent.authority.principal as { kind: string }).kind = 'manager'; }).toThrow();
    expect(() => security.scope({ ...agent.authority } as CompanyAuthority)).toThrow();
  });
  it('revokes sessions and cancellation signals immediately', () => {
    const security = new CompanySecurity({ demo: true });
    const human = manager(security);
    security.setGrant(human.authority, { agentId: 'a', mailboxId: 'one', capabilities: ['read'] });
    const agent = security.issueAgent('a');
    security.setGrant(human.authority, { agentId: 'a', mailboxId: 'one', capabilities: [] });
    expect(agent.signal.aborted).toBe(true);
    expect(() => security.scope(agent.authority)).toThrow();
    expect(security.canAssign('a', { mailboxIds: ['one'], sourceIds: [] })).toBe(false);
  });
  it('expires sessions and blocks local live authentication regardless of environment flags', () => {
    let now = 0;
    const security = new CompanySecurity({ demo: true, now: () => now });
    const human = manager(security);
    now = 3_600_001;
    expect(() => security.authority(human.request)).toThrow();
    expect(() => new CompanySecurity({ demo: false, password: DEMO_PASSWORD }).login(DEMO_PASSWORD)).toThrow();
  });
});
