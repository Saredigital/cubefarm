/** Authenticated encryption for the broker's data and credentials, including backups. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class EncryptedStore<T> {
  private key: Buffer;
  constructor(private path: string, key: Uint8Array, private purpose = 'mail') {
    if (key.byteLength !== 32) throw new Error('La clave del almacén debe tener 32 bytes.');
    this.key = Buffer.from(key);
    mkdirSync(dirname(path), { recursive: true });
  }
  load(fallback: () => T): T {
    if (!existsSync(this.path)) return fallback();
    const packed = JSON.parse(readFileSync(this.path, 'utf8')) as { version: number; iv: string; tag: string; data: string };
    if (packed.version !== 1) throw new Error('Versión del almacén cifrado no compatible.');
    const cipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(packed.iv, 'base64'));
    cipher.setAAD(Buffer.from(`sareoffice-company-v1:${this.purpose}`));
    cipher.setAuthTag(Buffer.from(packed.tag, 'base64'));
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(packed.data, 'base64')), cipher.final()]).toString('utf8')) as T;
  }
  save(value: T): void {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(`sareoffice-company-v1:${this.purpose}`));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const packed = JSON.stringify({ version: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') });
    const temp = `${this.path}.${randomBytes(8).toString('hex')}.tmp`;
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, packed); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, this.path);
  }
}
