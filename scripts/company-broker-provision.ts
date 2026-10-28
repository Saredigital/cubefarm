/** Read provisioning JSON from stdin; never echo credentials or write a plaintext intermediate file. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brokerConfigSchema } from '../server/company-security/brokerConfig.ts';
import { EncryptedStore } from '../server/company-security/vault.ts';

async function provision(): Promise<void> {
  const [configPathArg, keyPathArg] = process.argv.slice(2);
  if (!configPathArg || !keyPathArg) throw new Error('Faltan rutas de configuración y clave.');
  const configPath = path.resolve(configPathArg);
  const keyPath = path.resolve(keyPathArg);
  if (existsSync(configPath)) throw new Error('La configuración ya existe.');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk.toString();
    if (input.length > 256_000) throw new Error('La configuración supera el límite.');
  }
  const configuration = brokerConfigSchema.parse(JSON.parse(input));
  mkdirSync(path.dirname(keyPath), { recursive: true });
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 });
  new EncryptedStore(configPath, readFileSync(keyPath), 'broker-config').save(configuration);
  console.log('Configuración cifrada guardada. No se ha conectado ninguna cuenta.');
}
await provision().catch(() => {
  console.error('No se pudo guardar la configuración. Comprueba el esquema, las rutas y que el destino no exista. No se ha mostrado la entrada privada.');
  process.exitCode = 1;
});
