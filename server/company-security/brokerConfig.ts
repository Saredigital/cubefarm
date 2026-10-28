/** Strict deployment configuration: only the standalone HTTPS broker reads real credentials. */
import { z } from 'zod';
import { socialAccountConfigSchema } from '../company-social/config.ts';

const host = z.string().min(1).max(253).regex(/^[a-zA-Z0-9.-]+$/);
const secret = z.string().min(1).max(20_000);
const port = z.number().int().min(1).max(65535);
const mailbox = z.object({
  id: z.string().min(1).max(100), name: z.string().min(1).max(200), address: z.email(),
  folders: z.array(z.string().min(1).max(200)).min(1).max(30),
  connection: z.discriminatedUnion('provider', [
    z.object({ provider: z.literal('graph'), userId: z.string().min(1), tenantId: z.string().regex(/^[a-zA-Z0-9-]+$/), clientId: secret, clientSecret: secret }).strict(),
    z.object({ provider: z.literal('imap'), host, port: port.default(993), user: secret, password: secret, sentFolder: z.string().optional(),
      smtp: z.object({ host, port: z.union([z.literal(465), z.literal(587)]), user: secret, password: secret }).strict() }).strict(),
  ]),
}).strict();
export const brokerConfigSchema = z.object({
  publicOrigin: z.url().refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.pathname === '/' && !url.username && !url.password && !url.search && !url.hash;
  }, 'El origen público debe usar HTTPS y no incluir una ruta.'),
  listenHost: z.string().default('127.0.0.1'),
  port: port.default(4452),
  managerPassword: z.string().min(20).max(256),
  mailboxes: z.array(mailbox).max(30),
  socialAccounts: z.array(socialAccountConfigSchema).max(30).optional(),
  model: z.object({
    provider: z.enum(['anthropic', 'openai']), model: z.string().min(1), apiKey: secret,
    inputEurosPerMillion: z.number().positive(), outputEurosPerMillion: z.number().positive(),
    maxOutputTokens: z.number().int().min(128).max(8192),
  }).strict().optional(),
}).strict();
export type BrokerConfig = z.infer<typeof brokerConfigSchema>;
