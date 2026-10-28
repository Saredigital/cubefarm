import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EncryptedStore } from '../server/company-security/vault.ts';

describe('private broker provisioning', () => {
  it('malformed input never echoes a password or writes partial credentials', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'broker-provision-'));
    try {
      const config = path.join(directory, 'config.enc'), key = path.join(directory, 'key');
      const result = spawnSync(process.execPath, ['--import', 'tsx', path.resolve('scripts/company-broker-provision.ts'), config, key], {
        input: '{"managerPassword":"PRIVATE-DO-NOT-LOG', encoding: 'utf8', windowsHide: true, timeout: 30_000,
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain('PRIVATE-DO-NOT-LOG');
      expect(existsSync(config)).toBe(false); expect(existsSync(key)).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
  });
  it('writes only encrypted synthetic config without connecting an account', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'broker-provision-'));
    try {
      const config = path.join(directory, 'config.enc'), key = path.join(directory, 'key');
      const password = 'synthetic-password-not-a-real-account';
      const result = spawnSync(process.execPath, ['--import', 'tsx', path.resolve('scripts/company-broker-provision.ts'), config, key], {
        input: JSON.stringify({ publicOrigin: 'https://broker.example.test', managerPassword: password, mailboxes: [] }),
        encoding: 'utf8', windowsHide: true, timeout: 30_000,
      });
      expect(result.status).toBe(0);
      expect(readFileSync(config, 'utf8')).not.toContain(password);
      expect(new EncryptedStore<{ managerPassword: string }>(config, readFileSync(key), 'broker-config').load(() => ({ managerPassword: '' })).managerPassword).toBe(password);
    } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); }
  });
});
