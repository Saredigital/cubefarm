import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { SocialAccount } from '../../shared/companySocial.ts';

export function publicOrigin(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && !url.port && !isIP(url.hostname) && url.hostname.includes('.') && !/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname); } catch { return false; }
}
export const socialAccountConfigSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), label: z.string().min(1).max(200), channel: z.enum(['x', 'instagram', 'facebook', 'tiktok']),
  providerAccountId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), accessToken: z.string().min(10).max(4096),
  expiresAt: z.string().datetime({ offset: true }), scopes: z.array(z.string().min(1).max(100)).max(30),
  appReviewed: z.boolean(), enabled: z.boolean(), apiVersion: z.string().regex(/^v\d{2}\.0$/).default('v26.0'),
  publicMediaOrigin: z.string().refine(publicOrigin, 'Origen público HTTPS no válido.').optional(),
  mediaDomainVerified: z.boolean().default(false),
}).strict();
export type SocialAccountConfig = z.infer<typeof socialAccountConfigSchema>;
export const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function accountView(config: SocialAccountConfig, now = Date.now()): SocialAccount {
  const required: Record<SocialAccount['channel'], string[]> = { x: ['tweet.read', 'tweet.write', 'users.read', 'media.write'], instagram: ['instagram_business_basic', 'instagram_business_content_publish'], facebook: ['pages_manage_posts', 'pages_read_engagement'], tiktok: ['video.publish', 'user.info.basic'] };
  const reason = !config.enabled ? 'Cuenta desactivada.' : !config.appReviewed ? 'Requiere revisión de la aplicación y permisos aprobados por el proveedor.'
    : Date.parse(config.expiresAt) <= now ? 'Credenciales caducadas. Renueva la configuración en el servicio protegido.'
      : required[config.channel].some(scope => !config.scopes.includes(scope)) ? 'Faltan permisos requeridos del proveedor.'
        : config.channel === 'tiktok' ? 'Direct Post de TikTok no está habilitado para esta herramienta interna. Utiliza la exportación revisada y registra la evidencia manual.'
          : config.channel === 'instagram' && !config.publicMediaOrigin ? 'Instagram necesita el origen HTTPS público de medios del servicio protegido.' : 'Verifica la identidad de la cuenta antes de aprobar.';
  return { id: config.id, label: config.label, channel: config.channel, providerAccountId: config.providerAccountId, enabled: config.enabled, permissionVersion: digest(config), status: 'blocked', reason, verifiedAt: null, creatorInfo: null };
}
