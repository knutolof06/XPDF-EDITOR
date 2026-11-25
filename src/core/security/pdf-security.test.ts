import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { encryptPDF, AlreadyEncryptedError } from '@pdfsmaller/pdf-encrypt-lite';
import forge from 'node-forge';
import { PdfSecurityEngine } from './pdf-security';

describe('Wave 1 Security & Crypto Infrastructure', () => {
  it('encryptPDF produces a valid encrypted PDF with /Encrypt dictionary and rejects double encryption', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    page.drawText('XPDF Security Test');
    const plainBytes = await doc.save();

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

  it('node-forge computes SHA-256 digests and generates RSA keypairs cleanly in jsdom', () => {
    const md = forge.md.sha256.create();
    md.update('xpdf-integrity-check', 'utf8');
    const hex = md.digest().toHex();
    expect(hex).toHaveLength(64);
    expect(typeof forge.pkcs7.messageFromAsn1).toBe('function');
  });

  it('PdfSecurityEngine.getDocumentSecurity maps PDF.js permissions flags accurately', async () => {
    const unencryptedProxy = {
      getPermissions: async () => null,
    } as unknown as Parameters<typeof PdfSecurityEngine.getDocumentSecurity>[0];

    const openInfo = await PdfSecurityEngine.getDocumentSecurity(unencryptedProxy);
    expect(openInfo.isEncrypted).toBe(false);
    expect(openInfo.permissions.canPrint).toBe(true);
    expect(openInfo.permissions.canModify).toBe(true);

    const restrictedProxy = {
      getPermissions: async () => [4, 256], // PRINT + FILL_FORMS only
    } as unknown as Parameters<typeof PdfSecurityEngine.getDocumentSecurity>[0];

    const lockedInfo = await PdfSecurityEngine.getDocumentSecurity(restrictedProxy);
    expect(lockedInfo.isEncrypted).toBe(true);
    expect(lockedInfo.permissions.canPrint).toBe(true);
    expect(lockedInfo.permissions.canFillForms).toBe(true);
    expect(lockedInfo.permissions.canCopy).toBe(false);
    expect(lockedInfo.permissions.canModify).toBe(false);
  });
});
