import { PDFDocument, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

let cachedRegularFont: ArrayBuffer | null = null;
let cachedBoldFont: ArrayBuffer | null = null;

/**
 * Normalizes various binary buffer inputs into an independent ArrayBuffer copy.
 * Throws a clear TypeError on invalid input instead of failing downstream.
 */
export function toSafeArrayBuffer(input: unknown): ArrayBuffer {
  if (input instanceof ArrayBuffer || Object.prototype.toString.call(input) === '[object ArrayBuffer]') {
    const view = new Uint8Array(input as ArrayBuffer);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
  }
  if (ArrayBuffer.isView(input)) {
    const view = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    const copy = new Uint8Array(view.byteLength);
    copy.set(view);
    return copy.buffer;
  }
  if (
    input &&
    typeof input === 'object' &&
    (input as { type?: string }).type === 'Buffer' &&
    Array.isArray((input as { data?: unknown }).data)
  ) {
    return new Uint8Array((input as { data: number[] }).data).buffer.slice(0);
  }
  if (
    input &&
    typeof input === 'object' &&
    (input as { buffer?: unknown }).buffer instanceof ArrayBuffer
  ) {
    const obj = input as { buffer: ArrayBuffer; byteOffset?: number; byteLength?: number };
    const offset = typeof obj.byteOffset === 'number' ? obj.byteOffset : 0;
    const length = typeof obj.byteLength === 'number' ? obj.byteLength : obj.buffer.byteLength;
    return obj.buffer.slice(offset, offset + length);
  }
  throw new TypeError('Geçersiz PDF veri formatı: ArrayBuffer veya Uint8Array bekleniyor.');
}

/**
 * Slices a Uint8Array cleanly respecting byteOffset and byteLength.
 */
export function uint8ToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function isPdfEncryptedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const lower = msg.toLowerCase();
  return (
    lower.includes('encrypted') ||
    lower.includes('password') ||
    lower.includes('şifre') ||
    lower.includes('parola')
  );
}

/**
 * Loads a PDFDocument strictly without ignoreEncryption so encrypted documents
 * fail cleanly with an informative Turkish error rather than silently corrupting.
 */
export async function loadPdfLibSafe(
  buffer: ArrayBuffer | Uint8Array,
  actionLabel = 'Bu işlem'
): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(buffer);
    if (doc.isEncrypted) {
      throw new Error(
        `${actionLabel} şifreli (parola korumalı) PDF belgelerinde gerçekleştirilemez. Lütfen önce Güvenlik menüsünden parolayı kaldırın.`
      );
    }
    return doc;
  } catch (err: unknown) {
    if (isPdfEncryptedError(err)) {
      throw new Error(
        `${actionLabel} şifreli (parola korumalı) PDF belgelerinde gerçekleştirilemez. Lütfen önce Güvenlik menüsünden parolayı kaldırın.`
      );
    }
    throw err;
  }
}

/**
 * Loads local Unicode TTF fonts (cached in memory across calls) for full Turkish/Unicode support.
 */
export async function loadUnicodeFontBytes(
  variant: 'regular' | 'bold'
): Promise<ArrayBuffer | null> {
  if (variant === 'regular' && cachedRegularFont) return cachedRegularFont;
  if (variant === 'bold' && cachedBoldFont) return cachedBoldFont;

  const fileName = variant === 'bold' ? 'font-bold.ttf' : 'font-regular.ttf';
  const candidates = [`./fonts/${fileName}`, `/fonts/${fileName}`, `fonts/${fileName}`];

  if (typeof fetch === 'function') {
    for (const url of candidates) {
      try {
        const resp = await fetch(url);
        if (resp.ok) {
          const buf = await resp.arrayBuffer();
          if (buf.byteLength > 0) {
            if (variant === 'regular') cachedRegularFont = buf;
            else cachedBoldFont = buf;
            return buf;
          }
        }
      } catch {
        // try next candidate path
      }
    }
  }

  // Node / Vitest fallback when public/fonts is on disk without a dev HTTP server
  if (typeof process !== 'undefined' && process.versions?.node) {
    try {
      const fs = await import(/* @vite-ignore */ 'node:fs/promises');
      const path = await import(/* @vite-ignore */ 'node:path');
      const diskPath = path.resolve(process.cwd(), 'public', 'fonts', fileName);
      const nodeBuf = await fs.readFile(diskPath);
      const localBytes = new Uint8Array(nodeBuf.byteLength);
      localBytes.set(nodeBuf);
      const ab = localBytes.buffer;
      if (ab.byteLength > 0) {
        if (variant === 'regular') cachedRegularFont = ab;
        else cachedBoldFont = ab;
        return ab;
      }
    } catch {
      // ignore if font file not on disk
    }
  }

  return null;
}

export async function loadUnicodeFontPair(): Promise<{
  regular: ArrayBuffer | null;
  bold: ArrayBuffer | null;
}> {
  const [regular, bold] = await Promise.all([
    loadUnicodeFontBytes('regular'),
    loadUnicodeFontBytes('bold'),
  ]);
  return { regular, bold };
}

export async function embedPreferredFont(
  pdfDoc: PDFDocument,
  variant: 'regular' | 'bold' = 'regular',
  subset = true
): Promise<{ font: PDFFont; isCustomFont: boolean }> {
  pdfDoc.registerFontkit(fontkit);
  const bytes = await loadUnicodeFontBytes(variant);
  if (bytes) {
    try {
      const font = await pdfDoc.embedFont(bytes, { subset });
      return { font, isCustomFont: true };
    } catch {
      // fall through to standard font
    }
  }
  const std = variant === 'bold' ? StandardFonts.HelveticaBold : StandardFonts.Helvetica;
  return { font: await pdfDoc.embedFont(std), isCustomFont: false };
}

const WINANSI_TRANSLITERATIONS: Array<[RegExp, string]> = [
  [/ğ/g, 'g'],
  [/Ğ/g, 'G'],
  [/ş/g, 's'],
  [/Ş/g, 'S'],
  [/ı/g, 'i'],
  [/İ/g, 'I'],
  [/₺/g, 'TL'],
  [/€/g, 'EUR'],
  [/→/g, '->'],
  [/←/g, '<-'],
  [/•/g, '*'],
  [/[–—]/g, '-'],
  [/[“”]/g, '"'],
  [/[‘’]/g, "'"],
  [/…/g, '...'],
];

/**
 * Ensures text can be safely encoded by the given PDFFont without throwing WinAnsi or missing-glyph errors.
 */
export function sanitizeTextForFont(text: string, font: PDFFont, isCustomFont: boolean): string {
  if (!text) return '';
  let candidate = text;
  if (!isCustomFont) {
    for (const [pattern, replacement] of WINANSI_TRANSLITERATIONS) {
      candidate = candidate.replace(pattern, replacement);
    }
  }

  try {
    font.encodeText(candidate);
    return candidate;
  } catch {
    let safe = '';
    for (const ch of candidate) {
      try {
        font.encodeText(ch);
        safe += ch;
      } catch {
        // Transliterate if custom font lacked a specific symbol or emoji
        if (ch === '\uFE0F' || ch === '\u200D') continue;
        safe += '?';
      }
    }
    return safe;
  }
}

export function hexToRgbValues(
  hex: string | undefined,
  fallback: { r: number; g: number; b: number } = { r: 0, g: 0, b: 0 }
): { r: number; g: number; b: number } {
  if (!hex || typeof hex !== 'string') return fallback;
  let cleaned = hex.trim().replace('#', '');
  if (cleaned.length === 3) {
    cleaned = cleaned
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return fallback;
  }
  const num = parseInt(cleaned, 16);
  if (Number.isNaN(num)) return fallback;
  return {
    r: ((num >> 16) & 255) / 255,
    g: ((num >> 8) & 255) / 255,
    b: (num & 255) / 255,
  };
}

export function hexToPdfRgb(hex: string | undefined, fallback = rgb(0, 0, 0)) {
  const fb = fallback as unknown as { red: number; green: number; blue: number };
  const parsed = hexToRgbValues(hex, {
    r: fb?.red ?? 0,
    g: fb?.green ?? 0,
    b: fb?.blue ?? 0,
  });
  return rgb(parsed.r, parsed.g, parsed.b);
}
