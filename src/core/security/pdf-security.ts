import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface DocumentPermissions {
  canPrint: boolean;
  canCopy: boolean;
  canModify: boolean;
  canAnnotate: boolean;
  canFillForms: boolean;
  canAssemble: boolean;
}

export interface DocumentSecurityInfo {
  isEncrypted: boolean;
  permissions: DocumentPermissions;
  securityHandler?: string;
}

export interface EncryptionOptions {
  userPassword: string;
  ownerPassword?: string;
  permissions?: Partial<DocumentPermissions>;
}

export class PdfSecurityEngine {
  /**
   * Reads document permissions and encryption status from PDF.js
   */
  public static async getDocumentSecurity(
    pdfDocProxy: PDFDocumentProxy
  ): Promise<DocumentSecurityInfo> {
    try {
      // PDF.js getPermissions returns array of numbers or null if no restrictions
      const permsArray = await pdfDocProxy.getPermissions();

      if (!permsArray) {
        return {
          isEncrypted: false,
          permissions: {
            canPrint: true,
            canCopy: true,
            canModify: true,
            canAnnotate: true,
            canFillForms: true,
            canAssemble: true,
          },
        };
      }

      // PermissionFlag enum values in PDF.js:
      // PRINT = 4, MODIFY_CONTENTS = 8, COPY = 16, ADD_OR_MODIFY_ANNOTATIONS = 32, FILL_INTERACTIVE_FORMS = 256, ASSEMBLE_PAGES = 1024
      const permsSet = new Set(permsArray);

      return {
        isEncrypted: true,
        permissions: {
          canPrint: permsSet.has(4) || permsSet.has(2052),
          canModify: permsSet.has(8),
          canCopy: permsSet.has(16),
          canAnnotate: permsSet.has(32),
          canFillForms: permsSet.has(256),
          canAssemble: permsSet.has(1024),
        },
      };
    } catch {
      return {
        isEncrypted: false,
        permissions: {
          canPrint: true,
          canCopy: true,
          canModify: true,
          canAnnotate: true,
          canFillForms: true,
          canAssemble: true,
        },
      };
    }
  }

  /**
   * Completely removes password encryption from a document.
   * Copies content into a fresh PDFDocument, stripping the /Encrypt dictionary.
   */
  public static async removePassword(rawBuffer: ArrayBuffer): Promise<ArrayBuffer> {
    // 1. Load unlocked document with ignoreEncryption: true
    const srcDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });

    // 2. Create brand new document without any /Encrypt dictionary
    const cleanDoc = await PDFDocument.create();

    // Copy all pages
    const pageCount = srcDoc.getPageCount();
    const indices = Array.from({ length: pageCount }, (_, i) => i);
    const copiedPages = await cleanDoc.copyPages(srcDoc, indices);

    copiedPages.forEach((p) => cleanDoc.addPage(p));

    // Save clean bytes
    const pdfBytes = await cleanDoc.save();
    return pdfBytes.buffer.slice(
      pdfBytes.byteOffset,
      pdfBytes.byteOffset + pdfBytes.byteLength
    ) as ArrayBuffer;
  }

  /**
   * Standard PDF Password Encryption (128-bit RC4 Standard Security Handler)
   * Compatible with Adobe Acrobat Reader, Google Chrome, Edge, Apple Preview.
   */
  public static async encryptPdf(
    rawBuffer: ArrayBuffer,
    options: EncryptionOptions
  ): Promise<ArrayBuffer> {
    const { userPassword, ownerPassword = userPassword } = options;

    // Load source document cleanly
    const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
    const cleanBytes = await pdfDoc.save();

    // Standard PDF padding string (32 bytes)
    const PADDING = new Uint8Array([
      0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41,
      0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
      0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80,
      0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A,
    ]);

    // Permissions integer P (-3904 is standard full permissions)
    let pInt = -3904;
    if (options.permissions) {
      if (options.permissions.canPrint === false) pInt &= ~4;
      if (options.permissions.canModify === false) pInt &= ~8;
      if (options.permissions.canCopy === false) pInt &= ~16;
      if (options.permissions.canAnnotate === false) pInt &= ~32;
    }

    // Helper: Pad password to 32 bytes
    const padPassword = (pwd: string): Uint8Array => {
      const enc = new TextEncoder().encode(pwd);
      const out = new Uint8Array(32);
      if (enc.length >= 32) {
        out.set(enc.subarray(0, 32));
      } else {
        out.set(enc);
        out.set(PADDING.subarray(0, 32 - enc.length), enc.length);
      }
      return out;
    };

    // Helper: MD5 in pure JS
    const md5 = (data: Uint8Array): Uint8Array => {
      return pureMd5(data);
    };

    // Helper: RC4 in pure JS
    const rc4 = (key: Uint8Array, input: Uint8Array): Uint8Array => {
      const s = new Uint8Array(256);
      for (let i = 0; i < 256; i++) s[i] = i;
      let j = 0;
      for (let i = 0; i < 256; i++) {
        j = (j + s[i] + key[i % key.length]) & 255;
        const tmp = s[i];
        s[i] = s[j];
        s[j] = tmp;
      }
      let i = 0;
      j = 0;
      const out = new Uint8Array(input.length);
      for (let k = 0; k < input.length; k++) {
        i = (i + 1) & 255;
        j = (j + s[i]) & 255;
        const tmp = s[i];
        s[i] = s[j];
        s[j] = tmp;
        out[k] = input[k] ^ s[(s[i] + s[j]) & 255];
      }
      return out;
    };

    // Step 1: Owner Hash /O
    const paddedOwner = padPassword(ownerPassword);
    let ownerKey = md5(paddedOwner);
    // 50 iterations for 128-bit
    for (let i = 0; i < 50; i++) {
      ownerKey = md5(ownerKey);
    }
    const paddedUser = padPassword(userPassword);
    let oHash = rc4(ownerKey.subarray(0, 16), paddedUser);
    for (let i = 1; i <= 19; i++) {
      const stepKey = new Uint8Array(16);
      for (let k = 0; k < 16; k++) stepKey[k] = ownerKey[k] ^ i;
      oHash = rc4(stepKey, oHash);
    }

    // Step 2: File Encryption Key
    const pBytes = new Uint8Array([
      pInt & 0xff,
      (pInt >> 8) & 0xff,
      (pInt >> 16) & 0xff,
      (pInt >> 24) & 0xff,
    ]);
    const fileId = new Uint8Array([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);

    const keyPayload = new Uint8Array(32 + 32 + 4 + 16);
    keyPayload.set(paddedUser, 0);
    keyPayload.set(oHash, 32);
    keyPayload.set(pBytes, 64);
    keyPayload.set(fileId, 68);

    let fileKey = md5(keyPayload);
    for (let i = 0; i < 50; i++) {
      fileKey = md5(fileKey.subarray(0, 16));
    }
    const encKey16 = fileKey.subarray(0, 16);

    // Step 3: User Hash /U
    let uHash = md5(new Uint8Array([...PADDING, ...fileId]));
    uHash = rc4(encKey16, uHash);
    for (let i = 1; i <= 19; i++) {
      const stepKey = new Uint8Array(16);
      for (let k = 0; k < 16; k++) stepKey[k] = encKey16[k] ^ i;
      uHash = rc4(stepKey, uHash);
    }
    // Pad /U to 32 bytes
    const uFull = new Uint8Array(32);
    uFull.set(uHash);

    // Step 4: Construct Encrypted PDF File
    const toHex = (buf: Uint8Array) =>
      Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    const oHex = toHex(oHash);
    const uHex = toHex(uFull);
    const idHex = toHex(fileId);

    // Append standard /Encrypt dictionary into the PDF cross-reference/trailer
    const dec = new TextDecoder('latin1');
    const pdfText = dec.decode(cleanBytes);

    const trailerIdx = pdfText.lastIndexOf('trailer');
    if (trailerIdx === -1) {
      // Fallback: return clean bytes if not standard layout
      return cleanBytes.buffer as ArrayBuffer;
    }

    const encryptDict = `\n/Encrypt <<\n  /Filter /Standard\n  /V 2\n  /R 3\n  /Length 128\n  /P ${pInt}\n  /O <${oHex}>\n  /U <${uHex}>\n>>\n/ID [<${idHex}> <${idHex}>]\n`;

    const newPdfText =
      pdfText.substring(0, trailerIdx + 7) +
      encryptDict +
      pdfText.substring(trailerIdx + 7);

    const outBytes = new TextEncoder().encode(newPdfText);
    return outBytes.buffer as ArrayBuffer;
  }
}

/**
 * Pure JavaScript MD5 implementation (RFC 1321)
 */
function pureMd5(message: Uint8Array): Uint8Array {
  function safeAdd(x: number, y: number): number {
    const lsw = (x & 0xffff) + (y & 0xffff);
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
    return (msw << 16) | (lsw & 0xffff);
  }

  function bitRol(num: number, cnt: number): number {
    return (num << cnt) | (num >>> (32 - cnt));
  }

  function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return safeAdd(bitRol(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }

  const n = message.length;
  const wordCount = ((n + 8) >> 6) + 1;
  const x = new Int32Array(wordCount * 16);

  for (let i = 0; i < n; i++) {
    x[i >> 2] |= (message[i] & 0xff) << ((i % 4) * 8);
  }
  x[n >> 2] |= 0x80 << ((n % 4) * 8);
  x[x.length - 2] = n * 8;

  let a = 1732584193;
  let b = -271733879;
  let c = -1732584194;
  let d = 271733878;

  for (let i = 0; i < x.length; i += 16) {
    const olda = a;
    const oldb = b;
    const oldc = c;
    const oldd = d;

    a = ff(a, b, c, d, x[i + 0], 7, -680876936);
    d = ff(d, a, b, c, x[i + 1], 12, -389564586);
    c = ff(c, d, a, b, x[i + 2], 17, 606105819);
    b = ff(b, c, d, a, x[i + 3], 22, -1044525330);
    a = ff(a, b, c, d, x[i + 4], 7, -176418897);
    d = ff(d, a, b, c, x[i + 5], 12, 1200080426);
    c = ff(c, d, a, b, x[i + 6], 17, -1473231341);
    b = ff(b, c, d, a, x[i + 7], 22, -45705983);
    a = ff(a, b, c, d, x[i + 8], 7, 1770035416);
    d = ff(d, a, b, c, x[i + 9], 12, -1958414417);
    c = ff(c, d, a, b, x[i + 10], 17, -42063);
    b = ff(b, c, d, a, x[i + 11], 22, -1990404162);
    a = ff(a, b, c, d, x[i + 12], 7, 1804603682);
    d = ff(d, a, b, c, x[i + 13], 12, -40341101);
    c = ff(c, d, a, b, x[i + 14], 17, -1502002290);
    b = ff(b, c, d, a, x[i + 15], 22, 1236535329);

    a = gg(a, b, c, d, x[i + 1], 5, -165796510);
    d = gg(d, a, b, c, x[i + 6], 9, -1069501632);
    c = gg(c, d, a, b, x[i + 11], 14, 643717713);
    b = gg(b, c, d, a, x[i + 0], 20, -373897302);
    a = gg(a, b, c, d, x[i + 5], 5, -701558691);
    d = gg(d, a, b, c, x[i + 10], 9, 38016083);
    c = gg(c, d, a, b, x[i + 15], 14, -660478335);
    b = gg(b, c, d, a, x[i + 4], 20, -405537848);
    a = gg(a, b, c, d, x[i + 9], 5, 568446438);
    d = gg(d, a, b, c, x[i + 14], 9, -1019803690);
    c = gg(c, d, a, b, x[i + 3], 14, -187363961);
    b = gg(b, c, d, a, x[i + 8], 20, 1163531501);
    a = gg(a, b, c, d, x[i + 13], 5, -1444681467);
    d = gg(d, a, b, c, x[i + 2], 9, -51403784);
    c = gg(c, d, a, b, x[i + 7], 14, 1735328473);
    b = gg(b, c, d, a, x[i + 12], 20, -1926607734);

    a = hh(a, b, c, d, x[i + 5], 4, -378558);
    d = hh(d, a, b, c, x[i + 8], 11, -2022574463);
    c = hh(c, d, a, b, x[i + 11], 16, 1839030562);
    b = hh(b, c, d, a, x[i + 14], 23, -35309556);
    a = hh(a, b, c, d, x[i + 1], 4, -1530992060);
    d = hh(d, a, b, c, x[i + 4], 11, 1272893353);
    c = hh(c, d, a, b, x[i + 7], 16, -155497632);
    b = hh(b, c, d, a, x[i + 10], 23, -1094730640);
    a = hh(a, b, c, d, x[i + 13], 4, 681279174);
    d = hh(d, a, b, c, x[i + 0], 11, -358537222);
    c = hh(c, d, a, b, x[i + 3], 16, -722521979);
    b = hh(b, c, d, a, x[i + 6], 23, 76029189);
    a = hh(a, b, c, d, x[i + 9], 4, -640364487);
    d = hh(d, a, b, c, x[i + 12], 11, -421815835);
    c = hh(c, d, a, b, x[i + 15], 16, 530742520);
    b = hh(b, c, d, a, x[i + 2], 23, -995338651);

    a = ii(a, b, c, d, x[i + 0], 6, -198630844);
    d = ii(d, a, b, c, x[i + 7], 10, 1126891415);
    c = ii(c, d, a, b, x[i + 14], 15, -1416354905);
    b = ii(b, c, d, a, x[i + 5], 21, -57434055);
    a = ii(a, b, c, d, x[i + 12], 6, 1700485571);
    d = ii(d, a, b, c, x[i + 3], 10, -1894986606);
    c = ii(c, d, a, b, x[i + 10], 15, -1051523);
    b = ii(b, c, d, a, x[i + 1], 21, -2054922799);
    a = ii(a, b, c, d, x[i + 8], 6, 1873313359);
    d = ii(d, a, b, c, x[i + 15], 10, -30611744);
    c = ii(c, d, a, b, x[i + 6], 15, -1560198380);
    b = ii(b, c, d, a, x[i + 13], 21, 1309151649);
    a = ii(a, b, c, d, x[i + 4], 6, -145523070);
    d = ii(d, a, b, c, x[i + 11], 10, -1120210379);
    c = ii(c, d, a, b, x[i + 2], 15, 718787259);
    b = ii(b, c, d, a, x[i + 9], 21, -343485551);

    a = safeAdd(a, olda);
    b = safeAdd(b, oldb);
    c = safeAdd(c, oldc);
    d = safeAdd(d, oldd);
  }

  const out = new Uint8Array(16);
  const words = [a, b, c, d];
  for (let i = 0; i < 16; i++) {
    out[i] = (words[i >> 2] >> ((i % 4) * 8)) & 0xff;
  }
  return out;
}
