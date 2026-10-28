import { createHash } from 'node:crypto';
import { HttpError } from '../httpError.ts';

export const MAX_SOCIAL_ASSET_BYTES = 12 * 1024 * 1024;
/** Parse media metadata without executing a codec or trusting the submitted MIME/extension. */
export function inspectMedia(mimeType: 'image/jpeg' | 'video/mp4', dataBase64: string) {
  if (!dataBase64 || dataBase64.length > Math.ceil(MAX_SOCIAL_ASSET_BYTES / 3) * 4 || dataBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(dataBase64)) throw new HttpError(400, 'Archivo base64 no válido o demasiado grande.');
  const data = Buffer.from(dataBase64, 'base64');
  if (data.toString('base64') !== dataBase64 || data.length > MAX_SOCIAL_ASSET_BYTES) throw new HttpError(400, 'Archivo no válido.');
  let durationSeconds: number | null = null;
  let width: number | null = null; let height: number | null = null;
  if (mimeType === 'image/jpeg') {
    if (data.length < 12 || data[0] !== 255 || data[1] !== 216 || data.at(-2) !== 255 || data.at(-1) !== 217) throw new HttpError(400, 'Se requiere un archivo JPEG completo.');
    let offset = 2;
    while (offset + 4 < data.length) {
      if (data[offset++] !== 255) break;
      let marker = data[offset++]; while (marker === 255 && offset < data.length) marker = data[offset++];
      if (marker === 218 || marker === 217) break;
      const length = data.readUInt16BE(offset);
      if (length < 2 || offset + length > data.length) break;
      if ([192, 193, 194].includes(marker) && length >= 8) { height = data.readUInt16BE(offset + 3); width = data.readUInt16BE(offset + 5); }
      offset += length;
    }
    if (!width || !height || width > 8192 || height > 8192 || width * height > 32_000_000) throw new HttpError(400, 'Dimensiones JPEG no válidas o excesivas.');
  } else {
    let hasFtyp = false; let hasTrack = false; let hasVideoHandler = false; let hasMediaData = false;
    const boxes = (start: number, end: number, depth = 0): void => {
      if (depth > 4) return;
      for (let offset = start; offset + 8 <= end;) {
        const length = data.readUInt32BE(offset); const type = data.toString('ascii', offset + 4, offset + 8);
        if (length < 8 || offset + length > end) throw new HttpError(400, 'Contenedor MP4 no válido.');
        if (type === 'ftyp' && length >= 16 && ['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V '].includes(data.toString('ascii', offset + 8, offset + 12))) hasFtyp = true;
        if (type === 'trak') hasTrack = true;
        if (type === 'hdlr' && length >= 24 && data.toString('ascii', offset + 16, offset + 20) === 'vide') hasVideoHandler = true;
        if (type === 'mdat' && length > 8) hasMediaData = true;
        if (['moov', 'trak', 'mdia'].includes(type)) boxes(offset + 8, offset + length, depth + 1);
        if (type === 'mvhd') {
          const version = data[offset + 8]; const scaleOffset = offset + (version === 1 ? 28 : 20); const durationOffset = scaleOffset + 4;
          if (version > 1 || durationOffset + (version === 1 ? 8 : 4) > offset + length) throw new HttpError(400, 'Duración MP4 no válida.');
          const scale = data.readUInt32BE(scaleOffset); const duration = version === 1 ? Number(data.readBigUInt64BE(durationOffset)) : data.readUInt32BE(durationOffset);
          durationSeconds = duration / scale;
        }
        offset += length;
      }
    };
    boxes(0, data.length);
    if (!hasFtyp || !hasTrack || !hasVideoHandler || !hasMediaData || durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds < 3 || durationSeconds > 600) throw new HttpError(400, 'MP4 no válido: requiere una pista de vídeo y datos multimedia; duración admitida de 3 a 600 segundos.');
  }
  return { size: data.length, sha256: createHash('sha256').update(data).digest('hex'), durationSeconds, width, height };
}
