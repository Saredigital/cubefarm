import { describe, expect, it } from 'vitest';
import { inspectMedia, MAX_SOCIAL_ASSET_BYTES } from './media.ts';

function jpeg(size: number) { const header = Buffer.from([255, 216, 255, 192, 0, 11, 8, 1, 64, 1, 64, 1, 1, 17, 0, 255, 218, 0, 8, 1, 1, 0, 0, 63, 0]); return Buffer.concat([header, Buffer.alloc(size - header.length - 2, 1), Buffer.from([255, 217])]); }
describe('validación acotada de medios', () => {
  it.each([1024 * 1024, MAX_SOCIAL_ASSET_BYTES])('valida base64 grande de %s bytes sin desbordar la pila', size => { const image = jpeg(size); expect(inspectMedia('image/jpeg', image.toString('base64'))).toMatchObject({ size, width: 320, height: 320 }); });
  it('rechaza exceder 12MB y padding/base64 no canónico', () => { expect(() => inspectMedia('image/jpeg', jpeg(MAX_SOCIAL_ASSET_BYTES + 1).toString('base64'))).toThrow(); for (const invalid of ['AA=A', 'AA===', 'AA==\n', 'A===', 'AB==']) expect(() => inspectMedia('image/jpeg', invalid)).toThrow(); });
  it('rechaza ftyp y mvhd sin pista ni contenido de vídeo', () => { const ftyp = Buffer.alloc(16); ftyp.writeUInt32BE(16); ftyp.write('ftyp', 4); ftyp.write('isom', 8); const mvhd = Buffer.alloc(28); mvhd.writeUInt32BE(28); mvhd.write('mvhd', 4); mvhd.writeUInt32BE(1000, 20); mvhd.writeUInt32BE(5000, 24); const moov = Buffer.alloc(8); moov.writeUInt32BE(36); moov.write('moov', 4); expect(() => inspectMedia('video/mp4', Buffer.concat([ftyp, moov, mvhd]).toString('base64'))).toThrow('pista'); });
});
