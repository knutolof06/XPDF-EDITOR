import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFHexString,
  PDFString,
  PDFBool,
  PDFRawStream,
  PDFArray,
  PDFRef,
  PDFObject,
} from 'pdf-lib';
import {
  encryptPDF,
  AlreadyEncryptedError,
  PasswordEncodingError,
  encodePasswordLegacy,
  md5,
  RC4,
  hexToBytes,
  bytesToHex,
  type EncryptPDFOptions,
} from '@pdfsmaller/pdf-encrypt-lite';
import forge from 'node-forge';
import * as pdfjsLib from 'pdfjs-dist';
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

export interface Pkcs12SignOptions {
  reason?: string;
  location?: string;
  name?: string;
  pageNumber?: number;
}

const PDF_PADDING = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41,
  0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80,
  0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const FULL_PERMISSIONS: DocumentPermissions = {
  canPrint: true,
  canCopy: true,
  canModify: true,
  canAnnotate: true,
  canFillForms: true,
  canAssemble: true,
};

const NO_PERMISSIONS: DocumentPermissions = {
  canPrint: false,
  canCopy: false,
  canModify: false,
  canAnnotate: false,
  canFillForms: false,
  canAssemble: false,
};

function toUint8Array(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    return input.slice();
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input.slice(0));
  }
  if (ArrayBuffer.isView(input)) {
    const view = input as ArrayBufferView;
    return new Uint8Array(
      view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength)
    );
  }
  throw new Error('Geçersiz ikili PDF verisi.');
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function createCodedError(message: string, code: string, name = 'Error'): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  err.name = name;
  return err;
}

function padPasswordLegacy(password: string): Uint8Array | null {
  try {
    const pwdBytes = encodePasswordLegacy(password);
    const out = new Uint8Array(32);
    if (pwdBytes.length >= 32) {
      out.set(pwdBytes.subarray(0, 32));
    } else {
      out.set(pwdBytes);
      out.set(PDF_PADDING.subarray(0, 32 - pwdBytes.length), pwdBytes.length);
    }
    return out;
  } catch {
    return null;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array, len: number): boolean {
  if (a.length < len || b.length < len) return false;
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bytesToPDFStringValue(bytes: Uint8Array): string {
  const out = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x5c) out[i] = '\\\\';
    else if (b === 0x28) out[i] = '\\(';
    else if (b === 0x29) out[i] = '\\)';
    else if (b === 0x0d) out[i] = '\\r';
    else if (b === 0x0a) out[i] = '\\n';
    else out[i] = String.fromCharCode(b);
  }
  return out.join('');
}

function uint8ToBinaryString(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let result = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    result += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return result;
}

function binaryStringToUint8(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function isSignatureDict(dict: PDFDict): boolean {
  const type = dict.get(PDFName.of('Type'));
  const typeName = type instanceof PDFName ? type.asString() : null;
  if (typeName === '/Sig' || typeName === '/DocTimeStamp') return true;
  if (typeName !== null) return false;
  const byteRange = dict.get(PDFName.of('ByteRange'));
  return byteRange instanceof PDFArray && byteRange.size() === 4 && dict.has(PDFName.of('Contents'));
}

function skipEncryptKey(keyName: string, isSigDict: boolean): boolean {
  if (keyName === '/Length' || keyName === '/Filter' || keyName === '/DecodeParms') return true;
  return isSigDict && keyName === '/Contents';
}

function encodePdfTextString(text: string): string {
  let hasNonAscii = false;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) {
      hasNonAscii = true;
      break;
    }
  }
  if (!hasNonAscii) {
    return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }
  // UTF-16BE with BOM
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes[0] = 0xfe;
  bytes[1] = 0xff;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    bytes[2 + i * 2] = (code >> 8) & 0xff;
    bytes[2 + i * 2 + 1] = code & 0xff;
  }
  return bytesToHex(bytes);
}

function formatPdfDate(date: Date): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const m = pad2(date.getUTCMonth() + 1);
  const d = pad2(date.getUTCDate());
  const h = pad2(date.getUTCHours());
  const min = pad2(date.getUTCMinutes());
  const s = pad2(date.getUTCSeconds());
  return `D:${y}${m}${d}${h}${min}${s}+00'00'`;
}

function inspectRawSecurityHandler(rawBuffer?: ArrayBuffer | Uint8Array): {
  isEncrypted: boolean;
  handlerLabel?: string;
} {
  if (!rawBuffer) return { isEncrypted: false };
  try {
    const bytes = rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
    if (bytes.byteLength === 0) return { isEncrypted: false };
    const text = new TextDecoder('latin1').decode(bytes);
    if (!/\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(text) && !/\/Filter\s*\/Standard/.test(text)) {
      return { isEncrypted: false };
    }
    const vMatch = text.match(/\/V\s+(\d+)/);
    const lenMatch = text.match(/\/Length\s+(\d+)/);
    const cfmMatch = text.match(/\/CFM\s*\/([A-Za-z0-9]+)/);
    const v = vMatch ? parseInt(vMatch[1], 10) : 0;
    const len = lenMatch ? parseInt(lenMatch[1], 10) : v === 1 ? 40 : 128;
    const cfm = cfmMatch?.[1];
    if (v === 5 || cfm === 'AESV3') return { isEncrypted: true, handlerLabel: 'Standard • AES-256' };
    if (cfm === 'AESV2') return { isEncrypted: true, handlerLabel: `Standard • AES-${len}` };
    if (v === 2 || v === 3 || v === 1) {
      return { isEncrypted: true, handlerLabel: `Standard • RC4 ${len}-bit` };
    }
    return { isEncrypted: true, handlerLabel: 'Standard Security Handler' };
  } catch {
    return { isEncrypted: false };
  }
}

export class PdfSecurityEngine {
  /**
   * Reads document permissions and encryption status from PDF.js (and optional raw bytes).
   */
  public static async getDocumentSecurity(
    pdfDocProxy: PDFDocumentProxy,
    rawBuffer?: ArrayBuffer | Uint8Array
  ): Promise<DocumentSecurityInfo> {
    const rawInfo = inspectRawSecurityHandler(rawBuffer);

    try {
      const permsArray = await pdfDocProxy.getPermissions();

      if (!permsArray) {
        if (rawInfo.isEncrypted) {
          return {
            isEncrypted: true,
            permissions: { ...FULL_PERMISSIONS },
            securityHandler: rawInfo.handlerLabel || 'Standard Security Handler',
          };
        }
        return {
          isEncrypted: false,
          permissions: { ...FULL_PERMISSIONS },
        };
      }

      const permsSet = new Set(permsArray);

      return {
        isEncrypted: true,
        securityHandler: rawInfo.handlerLabel || 'Standard Security Handler',
        permissions: {
          canPrint: permsSet.has(4) || permsSet.has(2048) || permsSet.has(2052),
          canModify: permsSet.has(8),
          canCopy: permsSet.has(16),
          canAnnotate: permsSet.has(32),
          canFillForms: permsSet.has(256),
          canAssemble: permsSet.has(1024),
        },
      };
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      const isPassErr =
        e?.name === 'PasswordException' ||
        /password|encrypt/i.test(String(e?.message || '')) ||
        rawInfo.isEncrypted;

      if (isPassErr) {
        return {
          isEncrypted: true,
          permissions: { ...NO_PERMISSIONS },
          securityHandler: rawInfo.handlerLabel || 'Standard Security Handler',
        };
      }

      return {
        isEncrypted: false,
        permissions: { ...FULL_PERMISSIONS },
      };
    }
  }

  /**
   * Encrypts a PDF with real Standard Security Handler (RC4 128-bit) via @pdfsmaller/pdf-encrypt-lite.
   * Supports owner-only locking when userPassword is '' and ownerPassword is provided.
   */
  public static async encryptPdf(
    rawBuffer: ArrayBuffer | Uint8Array,
    options: EncryptionOptions
  ): Promise<ArrayBuffer> {
    const userPwd = options.userPassword ?? '';
    const ownerPwd = options.ownerPassword ?? '';

    if (!userPwd && !ownerPwd) {
      throw createCodedError(
        'En az bir kullanıcı veya yönetici parolası belirlenmelidir.',
        'PASSWORD_REQUIRED'
      );
    }

    const inputBytes = toUint8Array(rawBuffer);
    const perms = options.permissions ?? {};

    const encryptOpts: EncryptPDFOptions = {
      ownerPassword: ownerPwd || userPwd,
      allowPrinting: perms.canPrint ?? true,
      allowHighQualityPrint: perms.canPrint ?? true,
      allowModifying: perms.canModify ?? true,
      allowCopying: perms.canCopy ?? true,
      allowExtraction: perms.canCopy ?? true,
      allowAnnotating: perms.canAnnotate ?? true,
      allowFillingForms: perms.canFillForms ?? true,
      allowAssembly: perms.canAssemble ?? true,
    };

    try {
      const encryptedBytes = await encryptPDF(inputBytes, userPwd, encryptOpts);
      return toArrayBuffer(encryptedBytes);
    } catch (err: unknown) {
      const e = err as { code?: string; name?: string; message?: string };
      if (err instanceof PasswordEncodingError || e?.code === 'UNSUPPORTED_PASSWORD_CHARACTER') {
        throw createCodedError(
          'Parola desteklenmeyen bir karakter içeriyor. RC4 128-bit PDF şifrelemesi yalnızca standart PDFDocEncoding karakterlerini (İngilizce harfler, rakamlar, noktalama ve ç, ö, ü, ı) destekler; ğ, Ğ, İ, ş, Ş veya emoji kullanılamaz.',
          'UNSUPPORTED_PASSWORD_CHARACTER'
        );
      }
      if (err instanceof AlreadyEncryptedError || e?.code === 'ALREADY_ENCRYPTED') {
        throw createCodedError(
          'Bu PDF belgesi zaten parola korumalı. Yeni bir şifre uygulamadan önce mevcut şifreyi kaldırın.',
          'ALREADY_ENCRYPTED'
        );
      }
      throw err;
    }
  }

  /**
   * Verifies password and decrypts a password-protected PDF, removing /Encrypt cleanly.
   * Uses lossless native decryption for Standard Security Handler V=1/2/4 (RC4 & AES-128),
   * and verified PDF.js fallback for V=5 (AES-256) or encrypted Object Streams.
   */
  public static async removePassword(
    rawBuffer: ArrayBuffer | Uint8Array,
    password?: string
  ): Promise<ArrayBuffer> {
    const inputBytes = toUint8Array(rawBuffer);

    let pdfDoc: PDFDocument | null = null;
    try {
      pdfDoc = await PDFDocument.load(inputBytes, {
        ignoreEncryption: true,
        updateMetadata: false,
      });
    } catch {
      pdfDoc = null;
    }

    const rawEncInfo = inspectRawSecurityHandler(inputBytes);

    if (pdfDoc && !pdfDoc.isEncrypted && !rawEncInfo.isEncrypted) {
      const saved = await pdfDoc.save();
      return toArrayBuffer(saved);
    }

    if (!password) {
      throw createCodedError(
        'Şifreyi kaldırmak için mevcut belge parolasını girmelisiniz.',
        'PASSWORD_REQUIRED',
        'PasswordException'
      );
    }

    // Path A: Lossless Standard Security Handler decryption (V=1, 2, 4; R=2, 3, 4)
    if (pdfDoc && pdfDoc.isEncrypted) {
      const nativeResult = await this.tryNativeDecrypt(pdfDoc, password);
      if (nativeResult.handled) {
        return nativeResult.buffer;
      }
    }

    // Path B: Verify password with PDF.js and rebuild cleanly (for AES-256 / V=5 or encrypted ObjStm)
    return await this.decryptViaPdfJsRebuild(inputBytes, password);
  }

  private static async tryNativeDecrypt(
    pdfDoc: PDFDocument,
    password: string
  ): Promise<{ handled: true; buffer: ArrayBuffer } | { handled: false }> {
    const context = pdfDoc.context;
    const encryptRef = context.trailerInfo.Encrypt;
    if (!encryptRef) return { handled: false };

    const encryptDict = context.lookupMaybe(encryptRef, PDFDict);
    if (!encryptDict) return { handled: false };

    const filterObj = encryptDict.lookup(PDFName.of('Filter'));
    const filterName = filterObj instanceof PDFName ? filterObj.asString() : '';
    if (filterName !== '/Standard') return { handled: false };

    const vObj = encryptDict.lookupMaybe(PDFName.of('V'), PDFNumber);
    const rObj = encryptDict.lookupMaybe(PDFName.of('R'), PDFNumber);
    const pObj = encryptDict.lookupMaybe(PDFName.of('P'), PDFNumber);
    const lenObj = encryptDict.lookupMaybe(PDFName.of('Length'), PDFNumber);
    const encMetaObj = encryptDict.lookupMaybe(PDFName.of('EncryptMetadata'), PDFBool);

    const V = vObj ? vObj.asNumber() : 0;
    const R = rObj ? rObj.asNumber() : 2;
    const P = pObj ? pObj.asNumber() | 0 : 0;
    const keyBits = lenObj ? lenObj.asNumber() : V === 1 ? 40 : 128;
    const keyLen = Math.max(5, Math.min(16, Math.floor(keyBits / 8)));
    const encryptMetadata = encMetaObj ? encMetaObj.asBoolean() : true;

    // Only Standard V=1,2,4 (R=2,3,4) handled natively here; V=5 / R>=5 falls back to PDF.js
    if (V > 4 || R >= 5) {
      return { handled: false };
    }

    // Determine crypt methods for streams & strings
    let stmMethod: 'V2' | 'AESV2' | 'None' = 'V2';
    let strMethod: 'V2' | 'AESV2' | 'None' = 'V2';
    if (V === 4) {
      const cfDict = encryptDict.lookupMaybe(PDFName.of('CF'), PDFDict);
      const stmF = encryptDict.lookupMaybe(PDFName.of('StmF'), PDFName)?.asString().replace(/^\//, '');
      const strF = encryptDict.lookupMaybe(PDFName.of('StrF'), PDFName)?.asString().replace(/^\//, '');
      const resolveCFM = (name?: string): 'V2' | 'AESV2' | 'None' | 'Unsupported' => {
        if (!name || name === 'Identity') return 'None';
        const sub = cfDict?.lookupMaybe(PDFName.of(name), PDFDict);
        const cfm = sub?.lookupMaybe(PDFName.of('CFM'), PDFName)?.asString();
        if (cfm === '/V2') return 'V2';
        if (cfm === '/AESV2') return 'AESV2';
        if (cfm === '/None') return 'None';
        return 'Unsupported';
      };
      const resolvedStm = resolveCFM(stmF);
      const resolvedStr = resolveCFM(strF);
      if (resolvedStm === 'Unsupported' || resolvedStr === 'Unsupported') {
        return { handled: false };
      }
      stmMethod = resolvedStm;
      strMethod = resolvedStr;
    }

    const oEntry = encryptDict.lookup(PDFName.of('O'));
    const uEntry = encryptDict.lookup(PDFName.of('U'));
    const oBytes =
      oEntry instanceof PDFHexString || oEntry instanceof PDFString ? oEntry.asBytes() : null;
    const uBytes =
      uEntry instanceof PDFHexString || uEntry instanceof PDFString ? uEntry.asBytes() : null;

    if (!oBytes || !uBytes || oBytes.length < 32 || uBytes.length < 32) {
      return { handled: false };
    }

    const idTrailer = context.trailerInfo.ID;
    let fileId: Uint8Array = new Uint8Array(0);
    if (idTrailer instanceof PDFArray && idTrailer.size() > 0) {
      const first = idTrailer.get(0);
      if (first instanceof PDFHexString || first instanceof PDFString) {
        fileId = first.asBytes();
      }
    } else if (Array.isArray(idTrailer) && idTrailer.length > 0) {
      const first = idTrailer[0];
      if (first instanceof PDFHexString || first instanceof PDFString) {
        fileId = first.asBytes();
      }
    }

    const paddedInput = padPasswordLegacy(password);
    if (!paddedInput) {
      throw createCodedError(
        'Hatalı parola! Belge parolası doğrulanamadı.',
        'INCORRECT_PASSWORD',
        'PasswordException'
      );
    }

    const computeFileKey = (paddedUser: Uint8Array): Uint8Array => {
      const extraLen = encryptMetadata ? 0 : 4;
      const buf = new Uint8Array(32 + oBytes.length + 4 + fileId.length + extraLen);
      let off = 0;
      buf.set(paddedUser.subarray(0, 32), off);
      off += 32;
      buf.set(oBytes, off);
      off += oBytes.length;
      buf[off++] = P & 0xff;
      buf[off++] = (P >> 8) & 0xff;
      buf[off++] = (P >> 16) & 0xff;
      buf[off++] = (P >> 24) & 0xff;
      buf.set(fileId, off);
      off += fileId.length;
      if (!encryptMetadata) {
        buf[off++] = 0xff;
        buf[off++] = 0xff;
        buf[off++] = 0xff;
        buf[off++] = 0xff;
      }
      let h = md5(buf);
      if (R >= 3) {
        for (let i = 0; i < 50; i++) {
          h = md5(h.subarray(0, keyLen));
        }
      }
      return h.subarray(0, keyLen);
    };

    const verifyUserKey = (fileKey: Uint8Array): boolean => {
      if (R === 2) {
        const expected = new RC4(fileKey).process(PDF_PADDING);
        return bytesEqual(expected, uBytes, 32);
      }
      const hashInput = new Uint8Array(PDF_PADDING.length + fileId.length);
      hashInput.set(PDF_PADDING);
      hashInput.set(fileId, PDF_PADDING.length);
      let cur = new RC4(fileKey).process(md5(hashInput));
      for (let i = 1; i <= 19; i++) {
        const k = new Uint8Array(fileKey.length);
        for (let j = 0; j < fileKey.length; j++) k[j] = fileKey[j] ^ i;
        cur = new RC4(k).process(cur);
      }
      return bytesEqual(cur, uBytes, 16);
    };

    // 1) Try as Owner Password (Algorithm 7)
    let fileKey: Uint8Array | null = null;
    {
      let ownerHash = md5(paddedInput);
      if (R >= 3) {
        for (let i = 0; i < 50; i++) {
          ownerHash = md5(ownerHash.subarray(0, keyLen));
        }
      }
      let recoveredUser: Uint8Array;
      if (R === 2) {
        recoveredUser = new RC4(ownerHash.subarray(0, keyLen)).process(oBytes.subarray(0, 32));
      } else {
        recoveredUser = oBytes.subarray(0, 32).slice();
        for (let i = 19; i >= 0; i--) {
          const k = new Uint8Array(keyLen);
          for (let j = 0; j < keyLen; j++) k[j] = ownerHash[j] ^ i;
          recoveredUser = new RC4(k).process(recoveredUser);
        }
      }
      const candidateKey = computeFileKey(recoveredUser);
      if (verifyUserKey(candidateKey)) {
        fileKey = candidateKey;
      }
    }

    // 2) Try as User Password (Algorithm 6)
    if (!fileKey) {
      const candidateKey = computeFileKey(paddedInput);
      if (verifyUserKey(candidateKey)) {
        fileKey = candidateKey;
      }
    }

    if (!fileKey) {
      throw createCodedError(
        'Hatalı parola! Belge parolası doğrulanamadı.',
        'INCORRECT_PASSWORD',
        'PasswordException'
      );
    }

    // Ensure no compressed ObjStm failed to parse
    const objDecrypt = (
      cipherBytes: Uint8Array,
      objectNum: number,
      generationNum: number,
      method: 'V2' | 'AESV2' | 'None'
    ): Uint8Array => {
      if (method === 'None' || cipherBytes.length === 0) return cipherBytes;

      const isAes = method === 'AESV2';
      const keyInput = new Uint8Array(fileKey!.length + 5 + (isAes ? 4 : 0));
      keyInput.set(fileKey!, 0);
      keyInput[fileKey!.length] = objectNum & 0xff;
      keyInput[fileKey!.length + 1] = (objectNum >> 8) & 0xff;
      keyInput[fileKey!.length + 2] = (objectNum >> 16) & 0xff;
      keyInput[fileKey!.length + 3] = generationNum & 0xff;
      keyInput[fileKey!.length + 4] = (generationNum >> 8) & 0xff;
      if (isAes) {
        keyInput[fileKey!.length + 5] = 0x73; // 's'
        keyInput[fileKey!.length + 6] = 0x41; // 'A'
        keyInput[fileKey!.length + 7] = 0x6c; // 'l'
        keyInput[fileKey!.length + 8] = 0x54; // 'T'
      }
      const objKey = md5(keyInput).subarray(0, Math.min(fileKey!.length + 5, 16));

      if (!isAes) {
        return new RC4(objKey).process(cipherBytes);
      }

      if (cipherBytes.length <= 16) return new Uint8Array(0);
      const iv = cipherBytes.subarray(0, 16);
      const payload = cipherBytes.subarray(16);
      const decipher = forge.cipher.createDecipher(
        'AES-CBC',
        forge.util.createBuffer(uint8ToBinaryString(objKey), 'raw')
      );
      decipher.start({ iv: forge.util.createBuffer(uint8ToBinaryString(iv), 'raw') });
      decipher.update(forge.util.createBuffer(uint8ToBinaryString(payload), 'raw'));
      const ok = decipher.finish();
      if (!ok) {
        throw new Error('AES akış şifre çözme başarısız.');
      }
      return binaryStringToUint8(decipher.output.getBytes());
    };

    const seen = new WeakSet<object>();
    const decryptStringsInObject = (
      obj: unknown,
      objectNum: number,
      generationNum: number
    ): void => {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;

      if (obj instanceof PDFString) {
        seen.add(obj);
        const plain = objDecrypt(obj.asBytes(), objectNum, generationNum, strMethod);
        (obj as unknown as { value: string }).value = bytesToPDFStringValue(plain);
      } else if (obj instanceof PDFHexString) {
        seen.add(obj);
        const plain = objDecrypt(obj.asBytes(), objectNum, generationNum, strMethod);
        (obj as unknown as { value: string }).value = bytesToHex(plain);
      } else if (obj instanceof PDFDict) {
        seen.add(obj);
        const isSig = isSignatureDict(obj);
        for (const [key, value] of obj.entries()) {
          if (!skipEncryptKey(key.asString(), isSig)) {
            decryptStringsInObject(value, objectNum, generationNum);
          }
        }
      } else if (obj instanceof PDFArray) {
        seen.add(obj);
        for (const el of obj.asArray()) {
          decryptStringsInObject(el, objectNum, generationNum);
        }
      }
    };

    for (const [ref, obj] of context.enumerateIndirectObjects()) {
      if (encryptRef instanceof PDFRef && ref === encryptRef) continue;
      if (obj === encryptDict) continue;

      if (obj instanceof PDFDict) {
        const filter = obj.get(PDFName.of('Filter'));
        if (filter instanceof PDFName && filter.asString() === '/Standard') {
          continue;
        }
      }

      const objectNum = ref.objectNumber;
      const generationNum = ref.generationNumber || 0;

      if (obj instanceof PDFRawStream && obj.dict) {
        const type = obj.dict.get(PDFName.of('Type'));
        const typeStr = type?.toString();
        if (typeStr === '/XRef' || typeStr === '/Sig') continue;
        if (!encryptMetadata && typeStr === '/Metadata') continue;

        const decryptedStream = objDecrypt(obj.contents, objectNum, generationNum, stmMethod);
        (obj as unknown as { contents: Uint8Array }).contents = decryptedStream;
        obj.dict.set(PDFName.of('Length'), PDFNumber.of(decryptedStream.length));
        decryptStringsInObject(obj.dict, objectNum, generationNum);
      } else {
        decryptStringsInObject(obj, objectNum, generationNum);
      }
    }

    delete context.trailerInfo.Encrypt;
    if (encryptRef instanceof PDFRef) {
      context.delete(encryptRef);
    }

    const cleanBytes = await pdfDoc.save({
      useObjectStreams: false,
      updateFieldAppearances: false,
    });

    return { handled: true, buffer: toArrayBuffer(cleanBytes) };
  }

  private static async decryptViaPdfJsRebuild(
    inputBytes: Uint8Array,
    password: string
  ): Promise<ArrayBuffer> {
    let proxy: PDFDocumentProxy;
    try {
      const task = pdfjsLib.getDocument({
        data: inputBytes.slice(),
        password,
      });
      proxy = await task.promise;
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === 'PasswordException' || /password/i.test(String(e?.message || ''))) {
        throw createCodedError(
          'Hatalı parola! Belge parolası doğrulanamadı.',
          'INCORRECT_PASSWORD',
          'PasswordException'
        );
      }
      throw createCodedError(
        `Belge şifresi çözülemedi: ${e?.message || 'Geçersiz veya bozuk PDF.'}`,
        'CORRUPT_PDF'
      );
    }

    try {
      if (typeof document === 'undefined') {
        throw createCodedError(
          'Bu PDF şifreleme biçimi (AES-256 / sıkıştırılmış nesne akışı) tarayıcı render ortamı gerektirir.',
          'UNSUPPORTED_DECRYPT_ENVIRONMENT'
        );
      }

      const outDoc = await PDFDocument.create();
      try {
        const meta = await proxy.getMetadata();
        const info = (meta?.info as Record<string, unknown>) || {};
        if (typeof info.Title === 'string') outDoc.setTitle(info.Title);
        if (typeof info.Author === 'string') outDoc.setAuthor(info.Author);
        if (typeof info.Subject === 'string') outDoc.setSubject(info.Subject);
        if (typeof info.Keywords === 'string') {
          outDoc.setKeywords(
            info.Keywords.split(/[,;]+/)
              .map((k) => k.trim())
              .filter(Boolean)
          );
        }
        if (typeof info.Creator === 'string') outDoc.setCreator(info.Creator);
        if (typeof info.Producer === 'string') outDoc.setProducer(info.Producer);
      } catch {
        // Metadata extraction best-effort
      }

      for (let pageNum = 1; pageNum <= proxy.numPages; pageNum++) {
        const page = await proxy.getPage(pageNum);
        const vp1 = page.getViewport({ scale: 1 });
        const renderScale = 2.0;
        const vp = page.getViewport({ scale: renderScale });

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          canvas.width = 0;
          canvas.height = 0;
          throw new Error('Canvas 2D bağlamı oluşturulamadı.');
        }

        try {
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/png')
          );
          if (!blob) throw new Error('Sayfa görüntüsü dönüştürülemedi.');
          const pngBytes = new Uint8Array(await blob.arrayBuffer());
          const img = await outDoc.embedPng(pngBytes);
          const outPage = outDoc.addPage([vp1.width, vp1.height]);
          outPage.drawImage(img, {
            x: 0,
            y: 0,
            width: vp1.width,
            height: vp1.height,
          });
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
      }

      const outBytes = await outDoc.save();
      return toArrayBuffer(outBytes);
    } finally {
      try {
        await proxy.destroy();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Signs a PDF using a PKCS#12 (.p12 / .pfx) identity bundle via node-forge.
   * Produces a standard detached CMS/PKCS#7 signature (/SubFilter /adbe.pkcs7.detached).
   */
  public static async signPdfWithPkcs12(
    rawBuffer: ArrayBuffer | Uint8Array,
    pkcs12Bytes: ArrayBuffer | Uint8Array,
    passphrase: string,
    options: Pkcs12SignOptions = {}
  ): Promise<ArrayBuffer> {
    const p12Arr = toUint8Array(pkcs12Bytes);
    const p12Der = forge.util.createBuffer(uint8ToBinaryString(p12Arr), 'raw');
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, false, passphrase);

    const keyBags =
      p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[
        forge.pki.oids.pkcs8ShroudedKeyBag
      ] ||
      p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ||
      [];
    const certBags =
      p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];

    const privateKey = keyBags[0]?.key as forge.pki.rsa.PrivateKey | undefined;
    const certs = certBags
      .map((b) => b.cert)
      .filter((c): c is forge.pki.Certificate => Boolean(c));

    if (!privateKey || certs.length === 0) {
      throw new Error('PKCS#12 dosyasında geçerli özel anahtar veya sertifika bulunamadı.');
    }

    const keyModulusHex = (privateKey as forge.pki.rsa.PrivateKey).n?.toString(16);
    const signerCert =
      (keyModulusHex
        ? certs.find(
            (c) =>
              (c.publicKey as forge.pki.rsa.PublicKey | undefined)?.n?.toString(16) ===
              keyModulusHex
          )
        : undefined) || certs[0];

    return this.signPdfWithKeyAndCert(rawBuffer, privateKey, signerCert, certs, options);
  }

  /**
   * Signs a PDF with a private key and X.509 certificate chain using detached PKCS#7 (SHA-256).
   */
  public static async signPdfWithKeyAndCert(
    rawBuffer: ArrayBuffer | Uint8Array,
    privateKey: forge.pki.rsa.PrivateKey,
    signerCert: forge.pki.Certificate,
    certificateChain: forge.pki.Certificate[] = [signerCert],
    options: Pkcs12SignOptions = {}
  ): Promise<ArrayBuffer> {
    const pdfDoc = await PDFDocument.load(toUint8Array(rawBuffer), {
      updateMetadata: false,
    });

    if (pdfDoc.getPageCount() === 0) {
      throw new Error('Boş belge imzalanamaz.');
    }

    const pageIdx = Math.max(0, Math.min(pdfDoc.getPageCount() - 1, (options.pageNumber ?? 1) - 1));
    const page = pdfDoc.getPage(pageIdx);
    const context = pdfDoc.context;

    const SIGNATURE_HEX_LEN = 16384; // 8 KB reserved DER capacity
    const byteRangePlaceholder = PDFArray.withContext(context);
    byteRangePlaceholder.push(PDFNumber.of(0));
    byteRangePlaceholder.push(PDFNumber.of(9999999999));
    byteRangePlaceholder.push(PDFNumber.of(9999999999));
    byteRangePlaceholder.push(PDFNumber.of(9999999999));

    const contentsPlaceholder = PDFHexString.of('0'.repeat(SIGNATURE_HEX_LEN));
    const cnAttr = signerCert.subject.getField('CN');
    const signerName = options.name || (cnAttr?.value as string) || 'Dijital İmza';
    const now = new Date();

    const sigDictEntries: Record<string, PDFObject> = {
      Type: PDFName.of('Sig'),
      Filter: PDFName.of('Adobe.PPKLite'),
      SubFilter: PDFName.of('adbe.pkcs7.detached'),
      ByteRange: byteRangePlaceholder,
      Contents: contentsPlaceholder,
      M: PDFString.of(formatPdfDate(now)),
      Name: encodePdfTextString(signerName).startsWith('feff')
        ? PDFHexString.of(encodePdfTextString(signerName))
        : PDFString.of(encodePdfTextString(signerName)),
    };
    if (options.reason) {
      const enc = encodePdfTextString(options.reason);
      sigDictEntries.Reason = enc.startsWith('feff') ? PDFHexString.of(enc) : PDFString.of(enc);
    }
    if (options.location) {
      const enc = encodePdfTextString(options.location);
      sigDictEntries.Location = enc.startsWith('feff') ? PDFHexString.of(enc) : PDFString.of(enc);
    }

    const sigDict = context.obj(sigDictEntries);
    const sigDictRef = context.register(sigDict);

    const fieldName = `Signature_${Date.now()}`;
    const widgetDict = context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      FT: PDFName.of('Sig'),
      Rect: [0, 0, 0, 0],
      V: sigDictRef,
      T: PDFString.of(fieldName),
      F: PDFNumber.of(4),
      P: page.ref,
    });
    const widgetRef = context.register(widgetDict);

    page.node.addAnnot(widgetRef);

    const acroForm = pdfDoc.catalog.getOrCreateAcroForm();
    let fields = acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray);
    if (!fields) {
      fields = context.obj([]);
      acroForm.dict.set(PDFName.of('Fields'), fields);
    }
    fields.push(widgetRef);
    acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3));

    const pdfBytes = await pdfDoc.save({
      useObjectStreams: false,
      updateFieldAppearances: false,
    });

    const pdfLatin1 = new TextDecoder('latin1').decode(pdfBytes);
    const brPlaceholderRe = /\[\s*0\s+9999999999\s+9999999999\s+9999999999\s*\]/g;
    let lastMatch: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
    while ((m = brPlaceholderRe.exec(pdfLatin1)) !== null) {
      lastMatch = m;
    }
    if (!lastMatch) {
      throw new Error('İmza ByteRange yer tutucusu oluşturulamadı.');
    }
    const brStart = lastMatch.index;
    const placeholderLen = lastMatch[0].length;

    const contentsTagRe = /\/Contents\s*</g;
    contentsTagRe.lastIndex = brStart;
    const contentsMatch = contentsTagRe.exec(pdfLatin1);
    if (!contentsMatch) {
      throw new Error('İmza Contents yer tutucusu oluşturulamadı.');
    }
    const hexStart = contentsMatch.index + contentsMatch[0].length;
    const hexEnd = pdfLatin1.indexOf('>', hexStart);
    if (hexEnd === -1 || hexEnd - hexStart !== SIGNATURE_HEX_LEN) {
      throw new Error('İmza Contents boyutu beklenenle uyuşmuyor.');
    }

    const contentsTokenStart = hexStart - 1; // '<'
    const contentsTokenEnd = hexEnd + 1; // after '>'
    const b0 = 0;
    const l0 = contentsTokenStart;
    const b1 = contentsTokenEnd;
    const l1 = pdfBytes.length - contentsTokenEnd;

    const realBr = `[${b0} ${l0} ${b1} ${l1}]`;
    if (realBr.length > placeholderLen) {
      throw new Error('ByteRange değeri yer tutucu boyutunu aştı.');
    }
    const paddedBr = realBr.padEnd(placeholderLen, ' ');
    for (let i = 0; i < paddedBr.length; i++) {
      pdfBytes[brStart + i] = paddedBr.charCodeAt(i);
    }

    // Build concatenated byte buffer for the two ByteRange slices
    const signedBytes = new Uint8Array(l0 + l1);
    signedBytes.set(pdfBytes.subarray(0, l0), 0);
    signedBytes.set(pdfBytes.subarray(b1, b1 + l1), l0);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(uint8ToBinaryString(signedBytes), 'raw');
    for (const c of certificateChain) {
      p7.addCertificate(c);
    }
    p7.addSigner({
      key: privateKey,
      certificate: signerCert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [
        { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
        { type: forge.pki.oids.messageDigest },
        { type: forge.pki.oids.signingTime, value: now as unknown as string },
      ],
    });
    p7.sign({ detached: true });

    const derBytes = forge.asn1.toDer(p7.toAsn1()).getBytes();
    const derHex = forge.util.bytesToHex(derBytes);
    if (derHex.length > SIGNATURE_HEX_LEN) {
      throw new Error('PKCS#7 imza çıktısı ayrılan alanı aştı.');
    }
    const paddedHex = derHex.padEnd(SIGNATURE_HEX_LEN, '0');
    for (let i = 0; i < SIGNATURE_HEX_LEN; i++) {
      pdfBytes[hexStart + i] = paddedHex.charCodeAt(i);
    }

    return toArrayBuffer(pdfBytes);
  }
}

export { hexToBytes, bytesToHex };
