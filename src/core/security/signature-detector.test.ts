import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName, PDFNumber, PDFString, PDFArray } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import forge from 'node-forge';
import { PdfSecurityEngine } from './pdf-security';
import { SignatureDetector } from './signature-detector';

function createCertificateBundle(opts: {
  cn: string;
  notBefore: Date;
  notAfter: Date;
  issuerCert?: forge.pki.Certificate;
  issuerKey?: forge.pki.rsa.PrivateKey;
  isCa?: boolean;
}) {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Math.floor(Math.random() * 900000 + 100000));
  cert.validity.notBefore = opts.notBefore;
  cert.validity.notAfter = opts.notAfter;

  const utf8Tag = forge.asn1.Type.UTF8 as unknown as forge.asn1.Class;
  const subjectAttrs: forge.pki.CertificateField[] = [
    { name: 'commonName', value: opts.cn, valueTagClass: utf8Tag },
    { name: 'organizationName', value: 'XPDF Test CA', valueTagClass: utf8Tag },
    { name: 'countryName', value: 'TR' },
  ];
  cert.setSubject(subjectAttrs);

  if (opts.issuerCert && opts.issuerKey) {
    cert.setIssuer(opts.issuerCert.subject.attributes);
    cert.setExtensions([
      { name: 'basicConstraints', cA: Boolean(opts.isCa) },
      { name: 'keyUsage', digitalSignature: true, nonRepudiation: true },
    ]);
    cert.sign(opts.issuerKey, forge.md.sha256.create());
  } else {
    cert.setIssuer(subjectAttrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: Boolean(opts.isCa) },
      { name: 'keyUsage', keyCertSign: Boolean(opts.isCa), digitalSignature: true },
    ]);
    cert.sign(keys.privateKey, forge.md.sha256.create());
  }

  return { keys, cert };
}

async function buildBlankPdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  doc.addPage([400, 400]).drawText('Signed PDF Payload');
  const bytes = await doc.save({ useObjectStreams: false });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('SignatureDetector — Real Cryptographic PKCS#7 Verification', () => {
  it('verifies a valid CA-trusted PKCS#12 signed PDF with Turkish metadata', async () => {
    const now = Date.now();
    const ca = createCertificateBundle({
      cn: 'XPDF Kök Sertifika',
      notBefore: new Date(now - 86400_000),
      notAfter: new Date(now + 365 * 86400_000),
      isCa: true,
    });
    const leaf = createCertificateBundle({
      cn: 'Ahmet Şahin',
      notBefore: new Date(now - 3600_000),
      notAfter: new Date(now + 180 * 86400_000),
      issuerCert: ca.cert,
      issuerKey: ca.keys.privateKey,
    });

    const p12Asn1 = forge.pkcs12.toPkcs12Asn1(
      leaf.keys.privateKey,
      [leaf.cert, ca.cert],
      'p12-pass',
      { algorithm: '3des' }
    );
    const p12Bytes = forge.asn1.toDer(p12Asn1).getBytes();
    const p12Uint8 = new Uint8Array(p12Bytes.length);
    for (let i = 0; i < p12Bytes.length; i++) p12Uint8[i] = p12Bytes.charCodeAt(i);

    const rawPdf = await buildBlankPdf();
    const signedPdf = await PdfSecurityEngine.signPdfWithPkcs12(rawPdf, p12Uint8, 'p12-pass', {
      name: 'Ahmet Şahin',
      reason: 'Sözleşme Onayı',
      location: 'İstanbul',
      pageNumber: 1,
    });

    const proxy = await pdfjsLib.getDocument({ data: new Uint8Array(signedPdf.slice(0)) }).promise;
    const results = await SignatureDetector.detectSignatures(proxy, signedPdf, {
      trustedCertificates: [ca.cert],
    });

    expect(results).toHaveLength(1);
    const sig = results[0];
    expect(sig.status).toBe('valid');
    expect(sig.isValid).toBe(true);
    expect(sig.integrityVerified).toBe(true);
    expect(sig.certificateTrusted).toBe(true);
    expect(sig.byteRangeValid).toBe(true);
    expect(sig.name).toBe('Ahmet Şahin');
    expect(sig.reason).toBe('Sözleşme Onayı');
    expect(sig.location).toBe('İstanbul');
    expect(sig.digestAlgorithm).toBe('SHA-256');
    expect(sig.certificate?.subject).toContain('Ahmet Şahin');
    expect(sig.certificate?.fingerprintSha256).toBeTruthy();

    await proxy.destroy();
  });

  it('reports untrusted-signer for valid cryptographic self-signed signature when no CA trust store matches', async () => {
    const now = Date.now();
    const selfSigned = createCertificateBundle({
      cn: 'Self Signer',
      notBefore: new Date(now - 3600_000),
      notAfter: new Date(now + 30 * 86400_000),
    });

    const rawPdf = await buildBlankPdf();
    const signedPdf = await PdfSecurityEngine.signPdfWithKeyAndCert(
      rawPdf,
      selfSigned.keys.privateKey,
      selfSigned.cert,
      [selfSigned.cert],
      { reason: 'Self-signed check' }
    );

    const proxy = await pdfjsLib.getDocument({ data: new Uint8Array(signedPdf.slice(0)) }).promise;
    const results = await SignatureDetector.detectSignatures(proxy, signedPdf);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('untrusted-signer');
    expect(results[0].isValid).toBe(false);
    expect(results[0].integrityVerified).toBe(true);
    expect(results[0].byteRangeValid).toBe(true);
    expect(results[0].certificateTrusted).toBe(false);
    expect(results[0].certificate?.isSelfSigned).toBe(true);

    await proxy.destroy();
  });

  it('detects tampered PDF content (single-byte modification inside ByteRange) as tampered', async () => {
    const now = Date.now();
    const ca = createCertificateBundle({
      cn: 'Trusted Root',
      notBefore: new Date(now - 86400_000),
      notAfter: new Date(now + 365 * 86400_000),
      isCa: true,
    });
    const rawPdf = await buildBlankPdf();
    const signedPdf = await PdfSecurityEngine.signPdfWithKeyAndCert(
      rawPdf,
      ca.keys.privateKey,
      ca.cert,
      [ca.cert]
    );

    // Tamper with a byte inside ByteRange[0..l0] without corrupting PDF xref/object syntax
    const tampered = new Uint8Array(signedPdf.slice(0));
    const latin1 = new TextDecoder('latin1').decode(tampered);
    const creationIdx = latin1.indexOf('/CreationDate (D:');
    if (creationIdx !== -1) {
      const targetIdx = creationIdx + '/CreationDate (D:'.length;
      tampered[targetIdx] = tampered[targetIdx] === 0x32 ? 0x33 : 0x32;
    } else {
      // Binary comment byte right after "%PDF-1.7\n%"
      tampered[10] = tampered[10] ^ 0x01;
    }

    const proxy = await pdfjsLib.getDocument({ data: tampered.slice() }).promise;
    const results = await SignatureDetector.detectSignatures(proxy, tampered.buffer, {
      trustedCertificates: [ca.cert],
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('tampered');
    expect(results[0].isValid).toBe(false);
    expect(results[0].integrityVerified).toBe(false);

    await proxy.destroy();
  });

  it('reports expired status when signing certificate validity has passed', async () => {
    const past = Date.now() - 10 * 86400_000;
    const expired = createCertificateBundle({
      cn: 'Expired Signer',
      notBefore: new Date(past - 365 * 86400_000),
      notAfter: new Date(past),
    });

    const rawPdf = await buildBlankPdf();
    const signedPdf = await PdfSecurityEngine.signPdfWithKeyAndCert(
      rawPdf,
      expired.keys.privateKey,
      expired.cert,
      [expired.cert]
    );

    const proxy = await pdfjsLib.getDocument({ data: new Uint8Array(signedPdf.slice(0)) }).promise;
    const results = await SignatureDetector.detectSignatures(proxy, signedPdf, {
      trustedCertificates: [expired.cert],
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('expired');
    expect(results[0].isValid).toBe(false);
    expect(results[0].integrityVerified).toBe(true);
    expect(results[0].certificate?.isExpired).toBe(true);

    await proxy.destroy();
  });

  it('does NOT mark an empty unsigned /FT /Sig field as valid', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 400]);
    const ctx = doc.context;

    const widgetDict = ctx.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Widget'),
      FT: PDFName.of('Sig'),
      Rect: [10, 10, 110, 50],
      T: PDFString.of('UnsignedField1'),
      F: PDFNumber.of(4),
      P: page.ref,
    });
    const widgetRef = ctx.register(widgetDict);
    page.node.addAnnot(widgetRef);

    const acroForm = doc.catalog.getOrCreateAcroForm();
    let fields = acroForm.dict.lookupMaybe(PDFName.of('Fields'), PDFArray);
    if (!fields) {
      fields = ctx.obj([]);
      acroForm.dict.set(PDFName.of('Fields'), fields);
    }
    fields.push(widgetRef);

    const bytes = await doc.save({ useObjectStreams: false });
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    const proxy = await pdfjsLib.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
    const results = await SignatureDetector.detectSignatures(proxy, buf);

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('unknown');
    expect(results[0].isValid).toBe(false);
    expect(results[0].integrityVerified).toBe(false);
    expect(results[0].byteRangeValid).toBe(false);

    await proxy.destroy();
  });
});
