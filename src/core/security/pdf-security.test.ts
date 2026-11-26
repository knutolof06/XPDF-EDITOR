import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { encryptPDF, AlreadyEncryptedError } from '@pdfsmaller/pdf-encrypt-lite';
import forge from 'node-forge';
import { PdfSecurityEngine } from './pdf-security';

async function createSamplePdf(title = 'Gizli Sözleşme', author = 'XPDF Test'): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setSubject('Güvenlik Doğrulama Testi');
  const page = doc.addPage([400, 400]);
  page.drawText('XPDF Security Test Content 2026');
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('PdfSecurityEngine — Encryption, Permissions & Decryption', () => {
  it('encryptPDF produces a valid encrypted PDF with /Encrypt dictionary and rejects double encryption', async () => {
    const plainBytes = new Uint8Array(await createSamplePdf());

    const encrypted = await encryptPDF(plainBytes, 'user-secret', {
      ownerPassword: 'owner-secret',
      allowPrinting: true,
      allowCopying: false,
    });

    expect(encrypted).toBeInstanceOf(Uint8Array);
    expect(encrypted.byteLength).toBeGreaterThan(plainBytes.byteLength);

    const text = new TextDecoder('latin1').decode(encrypted);
    expect(text).toContain('/Encrypt');
    expect(text).toContain('/Filter /Standard');

    await expect(encryptPDF(encrypted, 'another')).rejects.toBeInstanceOf(AlreadyEncryptedError);
  });

  it('PdfSecurityEngine.encryptPdf rejects empty/wrong passwords in PDF.js and enforces all 6 permissions', async () => {
    const plainBuffer = await createSamplePdf();
    const encryptedBuffer = await PdfSecurityEngine.encryptPdf(plainBuffer, {
      userPassword: 'open123',
      ownerPassword: 'admin456',
      permissions: {
        canPrint: false,
        canCopy: false,
        canModify: true,
        canAnnotate: false,
        canFillForms: true,
        canAssemble: false,
      },
    });

    // Empty password must reject with PasswordException
    await expect(
      pdfjsLib.getDocument({ data: new Uint8Array(encryptedBuffer.slice(0)) }).promise
    ).rejects.toMatchObject({ name: 'PasswordException' });

    // Wrong password must reject with PasswordException
    await expect(
      pdfjsLib.getDocument({
        data: new Uint8Array(encryptedBuffer.slice(0)),
        password: 'wrong-password',
      }).promise
    ).rejects.toMatchObject({ name: 'PasswordException' });

    // Correct user password opens and enforces permission flags accurately
    const proxy = await pdfjsLib.getDocument({
      data: new Uint8Array(encryptedBuffer.slice(0)),
      password: 'open123',
    }).promise;

    const secInfo = await PdfSecurityEngine.getDocumentSecurity(proxy, encryptedBuffer);
    expect(secInfo.isEncrypted).toBe(true);
    expect(secInfo.securityHandler).toContain('RC4');
    expect(secInfo.permissions.canPrint).toBe(false);
    expect(secInfo.permissions.canCopy).toBe(false);
    expect(secInfo.permissions.canModify).toBe(true);
    expect(secInfo.permissions.canAnnotate).toBe(false);
    expect(secInfo.permissions.canFillForms).toBe(true);
    expect(secInfo.permissions.canAssemble).toBe(false);

    await proxy.destroy();
  });

  it('supports owner-only permission locking (empty userPassword) and verifies in PDF.js', async () => {
    const plainBuffer = await createSamplePdf();
    const encryptedBuffer = await PdfSecurityEngine.encryptPdf(plainBuffer, {
      userPassword: '',
      ownerPassword: 'owner-only-pass',
      permissions: {
        canPrint: true,
        canCopy: false,
        canModify: false,
        canAnnotate: false,
        canFillForms: false,
        canAssemble: false,
      },
    });

    // Opens without prompt when userPassword is ''
    const proxy = await pdfjsLib.getDocument({
      data: new Uint8Array(encryptedBuffer.slice(0)),
    }).promise;

    const secInfo = await PdfSecurityEngine.getDocumentSecurity(proxy, encryptedBuffer);
    expect(secInfo.isEncrypted).toBe(true);
    expect(secInfo.permissions.canPrint).toBe(true);
    expect(secInfo.permissions.canCopy).toBe(false);
    expect(secInfo.permissions.canModify).toBe(false);
    expect(secInfo.permissions.canFillForms).toBe(false);
    expect(secInfo.permissions.canAssemble).toBe(false);

    await proxy.destroy();
  });

  it('throws friendly Turkish error for UNSUPPORTED_PASSWORD_CHARACTER and ALREADY_ENCRYPTED', async () => {
    const plainBuffer = await createSamplePdf();

    await expect(
      PdfSecurityEngine.encryptPdf(plainBuffer, { userPassword: 'parola_ğüşİ' })
    ).rejects.toMatchObject({
      code: 'UNSUPPORTED_PASSWORD_CHARACTER',
    });

    const encryptedOnce = await PdfSecurityEngine.encryptPdf(plainBuffer, {
      userPassword: 'valid-pass',
    });

    await expect(
      PdfSecurityEngine.encryptPdf(encryptedOnce, { userPassword: 'second-pass' })
    ).rejects.toMatchObject({
      code: 'ALREADY_ENCRYPTED',
    });
  });

  it('removePassword rejects wrong/missing passwords, decrypts losslessly with valid password, and preserves text + metadata', async () => {
    const plainBuffer = await createSamplePdf('Korunan Belge', 'Ahmet Yazar');
    const encryptedBuffer = await PdfSecurityEngine.encryptPdf(plainBuffer, {
      userPassword: 'user789',
      ownerPassword: 'owner999',
      permissions: { canCopy: false, canPrint: false },
    });

    await expect(PdfSecurityEngine.removePassword(encryptedBuffer)).rejects.toMatchObject({
      name: 'PasswordException',
    });

    await expect(
      PdfSecurityEngine.removePassword(encryptedBuffer, 'bad-password')
    ).rejects.toMatchObject({
      name: 'PasswordException',
    });

    const unlockedBuffer = await PdfSecurityEngine.removePassword(encryptedBuffer, 'owner999');

    // Verify no /Encrypt remains and PDF.js opens without password
    const rawText = new TextDecoder('latin1').decode(new Uint8Array(unlockedBuffer));
    expect(rawText).not.toContain('/Encrypt');

    const proxy = await pdfjsLib.getDocument({
      data: new Uint8Array(unlockedBuffer.slice(0)),
    }).promise;

    expect(await proxy.getPermissions()).toBeNull();
    const meta = await proxy.getMetadata();
    const info = meta.info as Record<string, string>;
    expect(info.Title).toBe('Korunan Belge');
    expect(info.Author).toBe('Ahmet Yazar');

    const page1 = await proxy.getPage(1);
    const tc = await page1.getTextContent();
    const fullText = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ');
    expect(fullText).toContain('XPDF Security Test Content 2026');

    await proxy.destroy();
  });

  it('getDocumentSecurity reports isEncrypted: true when getPermissions throws PasswordException and maps flags accurately', async () => {
    const unencryptedProxy = {
      getPermissions: async () => null,
    } as unknown as Parameters<typeof PdfSecurityEngine.getDocumentSecurity>[0];

    const openInfo = await PdfSecurityEngine.getDocumentSecurity(unencryptedProxy);
    expect(openInfo.isEncrypted).toBe(false);
    expect(openInfo.permissions.canPrint).toBe(true);

    const restrictedProxy = {
      getPermissions: async () => [4, 256],
    } as unknown as Parameters<typeof PdfSecurityEngine.getDocumentSecurity>[0];

    const lockedInfo = await PdfSecurityEngine.getDocumentSecurity(restrictedProxy);
    expect(lockedInfo.isEncrypted).toBe(true);
    expect(lockedInfo.permissions.canPrint).toBe(true);
    expect(lockedInfo.permissions.canFillForms).toBe(true);
    expect(lockedInfo.permissions.canCopy).toBe(false);
    expect(lockedInfo.permissions.canModify).toBe(false);

    const throwingProxy = {
      getPermissions: async () => {
        const err = new Error('Need password');
        err.name = 'PasswordException';
        throw err;
      },
    } as unknown as Parameters<typeof PdfSecurityEngine.getDocumentSecurity>[0];

    const errInfo = await PdfSecurityEngine.getDocumentSecurity(throwingProxy);
    expect(errInfo.isEncrypted).toBe(true);
    expect(errInfo.permissions.canPrint).toBe(false);
  });

  it('node-forge computes SHA-256 digests cleanly', () => {
    const md = forge.md.sha256.create();
    md.update('xpdf-integrity-check', 'utf8');
    expect(md.digest().toHex()).toHaveLength(64);
  });
});
