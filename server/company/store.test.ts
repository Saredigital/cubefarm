import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanyStore } from './store.ts';
const directories: string[] = [];
function temporary() { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'company-store-')); directories.push(directory); return directory; }
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); });
describe('company persistence and migration recovery', () => {
  it('recovers migration after a crash between legacy backup and initial state publication', () => {
    const directory = temporary(); const legacy = path.join(directory, 'legacy.json'); const before = '{"agents":[{"id":"old"}],"history":["conservar"]}';
    fs.writeFileSync(legacy, before); fs.copyFileSync(legacy, path.join(directory, 'legacy-before-company.json'));
    const store = new CompanyStore(directory, undefined, legacy);
    expect(store.read().schemaVersion).toBe(1); expect(fs.readFileSync(legacy, 'utf8')).toBe(before);
    expect(fs.readFileSync(path.join(directory, 'legacy-before-company.json'), 'utf8')).toBe(before);
  });
  it('restores a verified previous state without overwriting the recovery evidence', () => {
    const directory = temporary(); const store = new CompanyStore(directory);
    store.transact((s) => { s.company.name = 'Primera revisión'; }); store.transact((s) => { s.company.name = 'Segunda revisión'; });
    store.restorePrevious(); expect(store.read().company.name).toBe('Primera revisión');
    expect(JSON.parse(fs.readFileSync(`${store.file}.before-restore`, 'utf8')).company.name).toBe('Segunda revisión');
    expect(new CompanyStore(directory).read().company.name).toBe('Primera revisión');
  });
  it('fails closed on missing provenance, invalid references and unsupported versions', () => {
    const directory = temporary(); const store = new CompanyStore(directory); const original = store.read();
    const invalids = [{ ...original, schemaVersion: 9 }, { ...original, projects: [{ id: 'broken', name: 'Roto', objective: '', departmentIds: [], repositoryIds: [], status: 'active' }] }, { ...original, agents: [{ ...original.agents[0], departmentId: 'missing' }] }];
    for (const invalid of invalids) { fs.writeFileSync(store.file, JSON.stringify(invalid)); expect(() => new CompanyStore(directory)).toThrow(); }
  });
  it('encrypts content and backups, detects tampering and never saves the key', () => {
    const directory = temporary(); const key = randomBytes(32); const store = new CompanyStore(directory, undefined, undefined, { encryptionKey: key });
    store.transact((s) => { s.company.objective = 'Contenido privado para cifrar'; }); store.transact((s) => { s.company.name = 'Segundo'; });
    for (const file of fs.readdirSync(directory)) expect(fs.readFileSync(path.join(directory, file), 'utf8')).not.toContain('Contenido privado');
    expect(new CompanyStore(directory, undefined, undefined, { encryptionKey: key }).read().company.objective).toBe('Contenido privado para cifrar');
    expect(() => new CompanyStore(directory, undefined, undefined, { encryptionKey: randomBytes(32) })).toThrow();
    const packed = JSON.parse(fs.readFileSync(store.file, 'utf8')); packed.tag = randomBytes(16).toString('base64'); fs.writeFileSync(store.file, JSON.stringify(packed));
    expect(() => new CompanyStore(directory, undefined, undefined, { encryptionKey: key })).toThrow();
  });
  it('refuses automatic plaintext imports into the protected store', () => {
    const directory = temporary(); new CompanyStore(directory);
    expect(() => new CompanyStore(directory, undefined, undefined, { encryptionKey: randomBytes(32) })).toThrow('sin cifrar');
  });
  it('recovers interrupted runs without replaying the provider call', () => {
    const directory = temporary(); const store = new CompanyStore(directory); const date = new Date().toISOString(); const provenance = { mailboxIds: [], sourceIds: [] };
    store.transact((s) => {
      s.tasks.push({ id: 'task', title: 'Interrumpida', objective: 'Recuperar', departmentId: 'business', projectId: null, assigneeId: 'specialist:business', collaboratorIds: [], priority: 'normal', dueAt: null, dependencyIds: [], completionCriteria: 'Revisada', status: 'in_progress', provenance, createdAt: date, updatedAt: date, runId: 'run', externalReference: null });
      s.runs.push({ id: 'run', taskId: 'task', agentId: 'specialist:business', state: 'running', mode: 'restricted', startedAt: date, finishedAt: null, costEuros: 0, reservedCostEuros: 1, error: null, provenance });
    });
    const restarted = new CompanyStore(directory).read(); expect(restarted.tasks[0].status).toBe('blocked'); expect(restarted.runs[0].state).toBe('cancelled'); expect(restarted.tasks[0].runId).toBeNull();
  });
});
