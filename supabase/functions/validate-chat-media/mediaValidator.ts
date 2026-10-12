export const MEDIA_TYPES: Record<string, { extension: string; maxBytes: number }> = {
  'video/mp4': { extension: 'mp4', maxBytes: 20971520 },
  'video/quicktime': { extension: 'mov', maxBytes: 20971520 },
  'video/webm': { extension: 'webm', maxBytes: 20971520 },
  'application/pdf': { extension: 'pdf', maxBytes: 10485760 },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx', maxBytes: 10485760 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extension: 'xlsx', maxBytes: 10485760 },
  'text/plain': { extension: 'txt', maxBytes: 10485760 },
  'text/csv': { extension: 'csv', maxBytes: 10485760 },
};
const ascii = (bytes: Uint8Array) => new TextDecoder('ascii').decode(bytes);
const validOfficeArchive = (bytes: Uint8Array, extension: string): boolean => {
  if (bytes.length < 22) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) return false;
  const entries = view.getUint16(end + 10, true);
  if (!entries || entries > 2000 || entries !== view.getUint16(end + 8, true)) return false;
  const size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  const directoryEnd = offset + size;
  if (directoryEnd !== end) return false;
  const names = new Set<string>();
  let expanded = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > directoryEnd || view.getUint32(offset, true) !== 0x02014b50) return false;
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    if ((flags & 1) || ![0, 8].includes(method) || offset + 46 + nameLength + extraLength + commentLength > directoryEnd
      || localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) return false;
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (!name || names.has(name) || /(^\/|\\|\.\.|[\x00-\x1f]|vbaProject|externalLinks|embeddings|\.exe$|\.dll$|\.js$|\.html?$)/i.test(name)) return false;
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressed > view.getUint32(end + 16, true)
      || name !== new TextDecoder().decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength))) return false;
    expanded += uncompressed;
    if (expanded > 50 * 1048576 || uncompressed > Math.max(1048576, compressed * 100)) return false;
    names.add(name); offset += 46 + nameLength + extraLength + commentLength;
  }
  return offset === directoryEnd && names.has('[Content_Types].xml')
    && names.has(extension === 'docx' ? 'word/document.xml' : 'xl/workbook.xml');
};
/** Format/signature validation, not a malware scanning claim. Documents are download-only. */
export const validateMediaBytes = (bytes: Uint8Array, mime: string): boolean => {
  const policy = MEDIA_TYPES[mime];
  if (!policy || bytes.length < 1 || bytes.length > policy.maxBytes) return false;
  if (mime === 'application/pdf') return ascii(bytes.subarray(0, 5)) === '%PDF-' && ascii(bytes.subarray(Math.max(0, bytes.length - 2048))).includes('%%EOF');
  if (mime === 'video/mp4' || mime === 'video/quicktime') {
    if (bytes.length < 16 || ascii(bytes.subarray(4, 8)) !== 'ftyp') return false;
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
    if (size < 16 || size > bytes.length || size > 4096) return false;
    const brands = ascii(bytes.subarray(8, size));
    return mime === 'video/quicktime' ? brands.includes('qt  ') : /isom|iso[2-9]|mp4[12]|avc1|M4V |dash/.test(brands) && !brands.includes('qt  ');
  }
  if (mime === 'video/webm') return bytes.length >= 8 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3 && ascii(bytes.subarray(0, Math.min(4096, bytes.length))).includes('webm');
  if (policy.extension === 'docx' || policy.extension === 'xlsx') return validOfficeArchive(bytes, policy.extension);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) && !/^\s*(?:<!doctype html|<html|<svg|<script)/i.test(text);
  } catch { return false; }
};
