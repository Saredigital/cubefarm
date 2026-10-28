/** Build a closed, immutable MIME payload without networking, files, URLs or caller headers. */
import nodemailer from 'nodemailer';
import type Mail from 'nodemailer/lib/mailer/index.js';
import { ProviderError, safeMessageId, type OutboundMail } from './provider.ts';

export function outboundOptions(content: Readonly<OutboundMail>, attemptId: string): Mail.Options {
  const addresses = [content.from, ...content.to, ...content.cc, ...content.bcc];
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(attemptId) ||
    addresses.some(value => value.length > 254 || !/^[^\s<>,;\r\n@]+@[^\s<>,;\r\n@]+\.[^\s<>,;\r\n@]+$/.test(value)) ||
    /[\r\n]/.test(content.subject) ||
    (content.replyMessageId !== undefined && !safeMessageId(content.replyMessageId))) throw new ProviderError('invalid');
  return {
    from: content.from, to: [...content.to], cc: [...content.cc], bcc: [...content.bcc],
    subject: content.subject, text: content.body, messageId: `<${attemptId}@sareoffice.invalid>`,
    ...(content.replyMessageId ? { inReplyTo: content.replyMessageId, references: [content.replyMessageId] } : {}),
    attachments: content.attachments.map(item => ({ filename: item.name, contentType: item.contentType, content: Buffer.from(item.contentBase64, 'base64') })),
    headers: { 'X-Sareoffice-Attempt': attemptId }, disableFileAccess: true, disableUrlAccess: true,
  };
}

export async function approvedMime(content: Readonly<OutboundMail>, attemptId: string): Promise<Buffer> {
  // Stream transport keeps Bcc in MIME so Graph receives the approved blind recipients.
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  try {
    const result = await transport.sendMail(outboundOptions(content, attemptId));
    if (!Buffer.isBuffer(result.message) || result.message.length > 4_000_000) throw new ProviderError('invalid');
    return result.message;
  } finally { transport.close(); }
}
