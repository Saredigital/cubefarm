import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EncryptedStore } from './vault.ts';

describe('encrypted company store', () => {
  it('never persists raw content and rejects wrong keys, purpose substitution and tampering', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'company-vault-'));
    try {
      const target = path.join(directory, 'mail.enc');
      const key = randomBytes(32);
      const store = new EncryptedStore<{ body: string }>(target, key);
      store.save({ body: 'secreto del cliente' });
      expect(readFileSync(target, 'utf8')).not.toContain('secreto');
      expect(store.load(() => ({ body: '' })).body).toBe('secreto del cliente');
      expect(() => new EncryptedStore(target, randomBytes(32)).load(() => ({}))).toThrow();
      expect(() => new EncryptedStore(target, key, 'broker-config').load(() => ({}))).toThrow();
      const encrypted = JSON.parse(readFileSync(target, 'utf8'));
      encrypted.tag = randomBytes(16).toString('base64');
      writeFileSync(target, JSON.stringify(encrypted));
      expect(() => store.load(() => ({ body: '' }))).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
  });
});
