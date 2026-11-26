import forge from 'node-forge';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type {
  SignatureVerificationResult,
  SignatureValidityStatus,
  SignatureCertificateInfo,
} from '@/types/advanced';

export type {
  SignatureValidityStatus,
  SignatureCertificateInfo,
  SignatureVerificationResult,
};
export type DigitalSignatureInfo = SignatureVerificationResult;

export interface SignatureDetectOptions {
  trustedCertificates?: (string | forge.pki.Certificate)[];
}

interface ParsedPdfDictionary {
  start: number;
  end: number;
  raw: string;
  entries: Map<string, { raw: string; start: number; end: number }>;
}

const PDFDOC_DIFFS: Record<number, number> = {
  0x16: 0x0017, 0x18: 0x02d8, 0x19: 0x02c7, 0x1a: 0x02c6, 0x1b: 0x02d9,
  0x1c: 0x02dd, 0x1d: 0x02db, 0x1e: 0x02da, 0x1f: 0x02dc,
  0x80: 0x2022, 0x81: 0x2020, 0x82: 0x2021, 0x83: 0x2026, 0x84: 0x2014,
  0x85: 0x2013, 0x86: 0x0192, 0x87: 0x2044, 0x88: 0x2039, 0x89: 0x203a,
  0x8a: 0x2212, 0x8b: 0x2030, 0x8c: 0x201e, 0x8d: 0x201c, 0x8e: 0x201d,
  0x8f: 0x2018, 0x90: 0x2019, 0x91: 0x201a, 0x92: 0x2122, 0x93: 0xfb01,
  0x94: 0xfb02, 0x95: 0x0141, 0x96: 0x0152, 0x97: 0x0160, 0x98: 0x0178,
  0x99: 0x017d, 0x9a: 0x0131, 0x9b: 0x0142, 0x9c: 0x0153, 0x9d: 0x0161,
  0x9e: 0x017e, 0xa0: 0x20ac,
};

function decodePdfDocBytes(bytes: number[]): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let out = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
  let out = '';
  for (const b of bytes) {
    const cp = b in PDFDOC_DIFFS ? PDFDOC_DIFFS[b] : b;
    out += String.fromCharCode(cp);
  }
  return out;
}

function hexStringToBytes(hexRaw: string): number[] {
  const clean = hexRaw.replace(/\s+/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    const pair = clean.substring(i, i + 2).padEnd(2, '0');
    const val = parseInt(pair, 16);
    if (!Number.isNaN(val)) bytes.push(val);
  }
  return bytes;
}

function parseLiteralStringBytes(rawToken: string): number[] {
  // rawToken includes leading '(' and trailing ')'
  const inner = rawToken.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch !== '\\') {
      bytes.push(inner.charCodeAt(i) & 0xff);
      continue;
    }
    i++;
    if (i >= inner.length) break;
    const esc = inner[i];
    if (esc === 'n') bytes.push(0x0a);
    else if (esc === 'r') bytes.push(0x0d);
    else if (esc === 't') bytes.push(0x09);
    else if (esc === 'b') bytes.push(0x08);
    else if (esc === 'f') bytes.push(0x0c);
    else if (esc === '(' || esc === ')' || esc === '\\') bytes.push(esc.charCodeAt(0));
    else if (esc === '\r') {
      if (inner[i + 1] === '\n') i++;
    } else if (esc === '\n') {
      // line continuation
    } else if (esc >= '0' && esc <= '7') {
      let oct = esc;
      if (i + 1 < inner.length && inner[i + 1] >= '0' && inner[i + 1] <= '7') {
        oct += inner[++i];
        if (i + 1 < inner.length && inner[i + 1] >= '0' && inner[i + 1] <= '7') {
          oct += inner[++i];
        }
      }
      bytes.push(parseInt(oct, 8) & 0xff);
    } else {
      bytes.push(esc.charCodeAt(0) & 0xff);
    }
  }
  return bytes;
}

function decodePdfStringToken(rawToken?: string): string | undefined {
  if (!rawToken) return undefined;
  const trimmed = rawToken.trim();
  if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
    return decodePdfDocBytes(parseLiteralStringBytes(trimmed));
  }
  if (trimmed.startsWith('<') && trimmed.endsWith('>') && !trimmed.startsWith('<<')) {
    return decodePdfDocBytes(hexStringToBytes(trimmed.slice(1, -1)));
  }
  if (trimmed.startsWith('/')) {
    return trimmed.slice(1);
  }
  return trimmed;
}

function formatPdfDateString(rawDate?: string): string | undefined {
  if (!rawDate) return undefined;
  const clean = rawDate.trim();
  if (clean.startsWith('D:')) {
    const m = clean.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
    if (m) {
      const y = m[1];
      const mo = m[2] || '01';
      const d = m[3] || '01';
      const h = m[4] || '00';
      const min = m[5] || '00';
      return `${d}.${mo}.${y} ${h}:${min}`;
    }
  }
  return clean;
}

function isPdfDelimiter(ch: string): boolean {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\r' ||
    ch === '\n' ||
    ch === '\f' ||
    ch === '\0' ||
    ch === '(' ||
    ch === ')' ||
    ch === '<' ||
    ch === '>' ||
    ch === '[' ||
    ch === ']' ||
    ch === '{' ||
    ch === '}' ||
    ch === '/' ||
    ch === '%'
  );
}

function skipPdfWhitespaceAndComments(text: string, pos: number, end: number): number {
  let i = pos;
  while (i < end) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n' || ch === '\f' || ch === '\0') {
      i++;
    } else if (ch === '%') {
      while (i < end && text[i] !== '\n' && text[i] !== '\r') i++;
    } else {
      break;
    }
  }
  return i;
}

function readPdfTokenEnd(text: string, start: number, limit: number): number {
  const ch = text[start];
  if (ch === '(') {
    let depth = 1;
    let i = start + 1;
    while (i < limit && depth > 0) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    return i;
  }
  if (ch === '<' && text[start + 1] === '<') {
    let depth = 1;
    let i = start + 2;
    while (i < limit && depth > 0) {
      if (text[i] === '(') {
        i = readPdfTokenEnd(text, i, limit);
      } else if (text[i] === '<' && text[i + 1] === '<') {
        depth++;
        i += 2;
      } else if (text[i] === '>' && text[i + 1] === '>') {
        depth--;
        i += 2;
      } else if (text[i] === '<') {
        const gt = text.indexOf('>', i + 1);
        i = gt === -1 ? limit : gt + 1;
      } else {
        i++;
      }
    }
    return i;
  }
  if (ch === '<') {
    const gt = text.indexOf('>', start + 1);
    return gt === -1 ? limit : Math.min(limit, gt + 1);
  }
  if (ch === '[') {
    let depth = 1;
    let i = start + 1;
    while (i < limit && depth > 0) {
      if (text[i] === '(' || (text[i] === '<' && text[i + 1] !== '<')) {
        i = readPdfTokenEnd(text, i, limit);
      } else if (text[i] === '[') {
        depth++;
        i++;
      } else if (text[i] === ']') {
        depth--;
        i++;
      } else if (text[i] === '%') {
        while (i < limit && text[i] !== '\n' && text[i] !== '\r') i++;
      } else {
        i++;
      }
    }
    return i;
  }
  if (ch === '/') {
    let i = start + 1;
    while (i < limit && !isPdfDelimiter(text[i])) i++;
    return i;
  }
  // Primitive value (may be indirect ref like "12 0 R")
  let i = start;
  while (i < limit && !isPdfDelimiter(text[i])) i++;
  // Check if indirect ref "num gen R"
  const afterFirst = skipPdfWhitespaceAndComments(text, i, limit);
  if (afterFirst < limit && text[afterFirst] >= '0' && text[afterFirst] <= '9') {
    let j = afterFirst;
    while (j < limit && text[j] >= '0' && text[j] <= '9') j++;
    const afterSecond = skipPdfWhitespaceAndComments(text, j, limit);
    if (text[afterSecond] === 'R' && (afterSecond + 1 >= limit || isPdfDelimiter(text[afterSecond + 1]))) {
      return afterSecond + 1;
    }
  }
  return i;
}

function parseDictionaryEntries(
  text: string,
  dictStart: number,
  dictEnd: number
): Map<string, { raw: string; start: number; end: number }> {
  const entries = new Map<string, { raw: string; start: number; end: number }>();
  let pos = dictStart + 2;
  const limit = dictEnd - 2;

  while (pos < limit) {
    pos = skipPdfWhitespaceAndComments(text, pos, limit);
    if (pos >= limit) break;
    if (text[pos] !== '/') {
      pos++;
      continue;
    }
    const keyEnd = readPdfTokenEnd(text, pos, limit);
    const key = text.slice(pos, keyEnd);
    pos = skipPdfWhitespaceAndComments(text, keyEnd, limit);
    if (pos >= limit) break;
    const valStart = pos;
    const valEnd = readPdfTokenEnd(text, valStart, limit);
    entries.set(key, {
      raw: text.slice(valStart, valEnd),
      start: valStart,
      end: valEnd,
    });
    pos = valEnd;
  }

  return entries;
}

function scanSignatureDictionaries(bytes: Uint8Array): ParsedPdfDictionary[] {
  const text = new TextDecoder('latin1').decode(bytes);
  const results: ParsedPdfDictionary[] = [];
  const dictStack: number[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];
    if (ch === '%') {
      while (i < len && text[i] !== '\n' && text[i] !== '\r') i++;
      continue;
    }
    if (ch === '(') {
      i = readPdfTokenEnd(text, i, len);
      continue;
    }
    if (ch === '<' && text[i + 1] === '<') {
      dictStack.push(i);
      i += 2;
      continue;
    }
    if (ch === '<') {
      const gt = text.indexOf('>', i + 1);
      i = gt === -1 ? len : gt + 1;
      continue;
    }
    if (ch === '>' && text[i + 1] === '>') {
      const start = dictStack.pop();
      const end = i + 2;
      i += 2;

      if (start !== undefined) {
        const raw = text.slice(start, end);
        // Quick pre-check before full tokenization
        if (
          raw.includes('/Sig') ||
          raw.includes('/DocTimeStamp') ||
          (raw.includes('/ByteRange') && raw.includes('/Contents'))
        ) {
          const entries = parseDictionaryEntries(text, start, end);
          const typeVal = entries.get('/Type')?.raw?.trim();
          const hasByteRange = entries.has('/ByteRange');
          const hasContents = entries.has('/Contents');

          const isSigDict =
            typeVal === '/Sig' ||
            typeVal === '/DocTimeStamp' ||
            (!typeVal && hasByteRange && hasContents);

          if (isSigDict && (hasByteRange || hasContents)) {
            results.push({ start, end, raw, entries });
          }
        }
      }

      // Skip stream payload so compressed binary bytes aren't scanned as dictionaries
      const afterDict = skipPdfWhitespaceAndComments(text, i, len);
      if (text.startsWith('stream', afterDict)) {
        const afterStreamKw = afterDict + 6;
        if (text[afterStreamKw] === '\r' || text[afterStreamKw] === '\n') {
          const endStreamIdx = text.indexOf('endstream', afterStreamKw);
          if (endStreamIdx !== -1) {
            i = endStreamIdx + 9;
          }
        }
      }
      continue;
    }
    i++;
  }

  return results;
}

function sliceDerTlv(derBytes: Uint8Array): Uint8Array | null {
  if (derBytes.length < 2) return null;
  let offset = 0;
  // Tag byte(s)
  const tag = derBytes[offset++];
  if ((tag & 0x1f) === 0x1f) {
    while (offset < derBytes.length && (derBytes[offset] & 0x80) !== 0) offset++;
    offset++;
  }
  if (offset >= derBytes.length) return null;
  const lenByte = derBytes[offset++];
  if ((lenByte & 0x80) === 0) {
    const total = offset + lenByte;
    return total <= derBytes.length ? derBytes.subarray(0, total) : derBytes;
  }
  const numLenBytes = lenByte & 0x7f;
  if (numLenBytes === 0) {
    // Indefinite length BER; pass trimmed trailing zeros conservatively
    let end = derBytes.length;
    while (end > 2 && derBytes[end - 1] === 0 && derBytes[end - 2] === 0) end--;
    return derBytes.subarray(0, Math.min(derBytes.length, end + 2));
  }
  if (offset + numLenBytes > derBytes.length) return null;
  let contentLen = 0;
  for (let i = 0; i < numLenBytes; i++) {
    contentLen = (contentLen << 8) | derBytes[offset++];
  }
  const total = offset + contentLen;
  if (total > derBytes.length) return null;
  return derBytes.subarray(0, total);
}

function uint8ToBinaryString(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let out = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return out;
}

function formatDistinguishedName(attrs: forge.pki.CertificateField[]): string {
  return attrs
    .map((a) => {
      const key = a.shortName || a.name || a.type || 'ATTR';
      let val = typeof a.value === 'string' ? a.value : String(a.value ?? '');
      if (a.valueTagClass === (forge.asn1.Type.UTF8 as unknown as forge.asn1.Class) && val) {
        try {
          val = forge.util.decodeUtf8(val);
        } catch {
          // keep original if already decoded
        }
      }
      return `${key}=${val}`;
    })
    .join(', ');
}

function rdnAttributesAsArray(asn1Node: forge.asn1.Asn1): forge.pki.CertificateField[] {
  return (
    forge.pki as unknown as {
      RDNAttributesAsArray: (n: forge.asn1.Asn1) => forge.pki.CertificateField[];
    }
  ).RDNAttributesAsArray(asn1Node);
}

function normalizeSerialHex(serial: string): string {
  return serial.toLowerCase().replace(/^0+/, '') || '0';
}

function resolveDigestAlgorithm(oid: string): { name: 'sha1' | 'sha256' | 'sha384' | 'sha512' | 'md5'; label: string } | null {
  switch (oid) {
    case forge.pki.oids.sha1:
    case '1.3.14.3.2.26':
      return { name: 'sha1', label: 'SHA-1' };
    case forge.pki.oids.sha256:
    case '2.16.840.1.101.3.4.2.1':
      return { name: 'sha256', label: 'SHA-256' };
    case forge.pki.oids.sha384:
    case '2.16.840.1.101.3.4.2.2':
      return { name: 'sha384', label: 'SHA-384' };
    case forge.pki.oids.sha512:
    case '2.16.840.1.101.3.4.2.3':
      return { name: 'sha512', label: 'SHA-512' };
    case forge.pki.oids.md5:
    case '1.2.840.113549.2.5':
      return { name: 'md5', label: 'MD5' };
    default:
      return null;
  }
}

function hashByteRange(
  pdfBytes: Uint8Array,
  b0: number,
  l0: number,
  b1: number,
  l1: number,
  mdName: 'sha1' | 'sha256' | 'sha384' | 'sha512' | 'md5'
): string {
  const md = forge.md[mdName].create();
  const feedSlice = (slice: Uint8Array) => {
    const chunkSize = 0x8000;
    for (let i = 0; i < slice.length; i += chunkSize) {
      md.update(String.fromCharCode(...slice.subarray(i, i + chunkSize)), 'raw');
    }
  };
  feedSlice(pdfBytes.subarray(b0, b0 + l0));
  feedSlice(pdfBytes.subarray(b1, b1 + l1));
  return md.digest().getBytes();
}

function extractCertInfo(cert: forge.pki.Certificate): SignatureCertificateInfo {
  const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const fpHex = forge.md.sha256.create().update(derBytes, 'raw').digest().toHex().toUpperCase();
  const formattedFp = fpHex.match(/.{1,2}/g)?.join(':') || fpHex;

  const now = new Date();
  const notBefore = cert.validity.notBefore;
  const notAfter = cert.validity.notAfter;
  const isExpired = now < notBefore || now > notAfter;

  let isSelfSigned = false;
  try {
    isSelfSigned = cert.isIssuer(cert) && cert.verify(cert);
  } catch {
    isSelfSigned = cert.isIssuer(cert);
  }

  return {
    subject: formatDistinguishedName(cert.subject.attributes),
    issuer: formatDistinguishedName(cert.issuer.attributes),
    serialNumber: cert.serialNumber,
    validFrom: notBefore.toISOString(),
    validTo: notAfter.toISOString(),
    isSelfSigned,
    isExpired,
    fingerprintSha256: formattedFp,
  };
}

interface ExtractedSignerInfo {
  digestOid: string;
  signatureAlgorithmOid: string;
  signatureBytes: string;
  authenticatedAttributes: forge.asn1.Asn1[] | null;
  issuerAttrs?: forge.pki.CertificateField[];
  serialHex?: string;
}

function extractSignerAndCertsFromAsn1(rootAsn1: forge.asn1.Asn1): {
  certificates: forge.pki.Certificate[];
  signer: ExtractedSignerInfo | null;
  encapsulatedContent: string | null;
} {
  try {
    const msg = forge.pkcs7.messageFromAsn1(rootAsn1) as unknown as {
      certificates: forge.pki.Certificate[];
      content?: forge.util.ByteStringBuffer;
      rawCapture: {
        digestAlgorithm?: string;
        signatureAlgorithm?: forge.asn1.Asn1[];
        signature?: string;
        authenticatedAttributes?: forge.asn1.Asn1[];
        issuer?: forge.asn1.Asn1;
        serial?: string;
      };
    };

    const cap = msg.rawCapture;
    const digestOid = cap.digestAlgorithm ? forge.asn1.derToOid(cap.digestAlgorithm) : '';
    const sigAlgOid =
      Array.isArray(cap.signatureAlgorithm) && cap.signatureAlgorithm[0]
        ? forge.asn1.derToOid(cap.signatureAlgorithm[0].value as string)
        : '';

    return {
      certificates: msg.certificates || [],
      encapsulatedContent: msg.content ? msg.content.getBytes() : null,
      signer:
        digestOid && cap.signature
          ? {
              digestOid,
              signatureAlgorithmOid: sigAlgOid,
              signatureBytes: cap.signature,
              authenticatedAttributes: cap.authenticatedAttributes || null,
              issuerAttrs: cap.issuer ? rdnAttributesAsArray(cap.issuer) : undefined,
              serialHex: cap.serial
                ? forge.util.createBuffer(cap.serial, 'raw').toHex()
                : undefined,
            }
          : null,
    };
  } catch {
    // Fallback manual ASN.1 traversal for CMS v3 SignerInfo (e.g. subjectKeyIdentifier)
    const contentInfoSeq = rootAsn1;
    if (!Array.isArray(contentInfoSeq.value) || contentInfoSeq.value.length < 2) {
      return { certificates: [], signer: null, encapsulatedContent: null };
    }
    const contentExplicit = contentInfoSeq.value[1];
    const signedDataSeq = Array.isArray(contentExplicit.value) ? contentExplicit.value[0] : null;
    if (!signedDataSeq || !Array.isArray(signedDataSeq.value)) {
      return { certificates: [], signer: null, encapsulatedContent: null };
    }

    const certificates: forge.pki.Certificate[] = [];
    let encapsulatedContent: string | null = null;
    let signer: ExtractedSignerInfo | null = null;

    for (const child of signedDataSeq.value) {
      if (child.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC && child.type === 0 && Array.isArray(child.value)) {
        for (const cAsn1 of child.value) {
          try {
            certificates.push(forge.pki.certificateFromAsn1(cAsn1));
          } catch {
            // skip non-cert item
          }
        }
      } else if (
        child.tagClass === forge.asn1.Class.UNIVERSAL &&
        child.type === forge.asn1.Type.SEQUENCE &&
        Array.isArray(child.value) &&
        child.value.length >= 2 &&
        child.value[0].type === forge.asn1.Type.OID
      ) {
        // encapContentInfo
        const innerContent = child.value[1];
        if (innerContent && Array.isArray(innerContent.value) && innerContent.value[0]) {
          const oct = innerContent.value[0];
          if (typeof oct.value === 'string') encapsulatedContent = oct.value;
        }
      } else if (
        child.tagClass === forge.asn1.Class.UNIVERSAL &&
        child.type === forge.asn1.Type.SET &&
        Array.isArray(child.value)
      ) {
        // Could be digestAlgorithms or signerInfos — SignerInfos children have >= 5 elements
        for (const candidate of child.value) {
          if (
            candidate.type === forge.asn1.Type.SEQUENCE &&
            Array.isArray(candidate.value) &&
            candidate.value.length >= 5
          ) {
            const parts = candidate.value;
            // [0]=version, [1]=sid, [2]=digestAlg, [3]=signedAttrs [0]?, digestEncAlg, encryptedDigest
            let idx = 2;
            const digestAlgSeq = parts[idx++];
            const digestOid =
              Array.isArray(digestAlgSeq?.value) && digestAlgSeq.value[0]
                ? forge.asn1.derToOid(digestAlgSeq.value[0].value as string)
                : '';

            let authAttrs: forge.asn1.Asn1[] | null = null;
            if (
              parts[idx]?.tagClass === forge.asn1.Class.CONTEXT_SPECIFIC &&
              parts[idx].type === 0 &&
              Array.isArray(parts[idx].value)
            ) {
              authAttrs = parts[idx].value as forge.asn1.Asn1[];
              idx++;
            }

            const sigAlgSeq = parts[idx++];
            const sigAlgOid =
              Array.isArray(sigAlgSeq?.value) && sigAlgSeq.value[0]
                ? forge.asn1.derToOid(sigAlgSeq.value[0].value as string)
                : '';
            const sigOctet = parts[idx++];
            const sigBytes = typeof sigOctet?.value === 'string' ? sigOctet.value : '';

            let issuerAttrs: forge.pki.CertificateField[] | undefined;
            let serialHex: string | undefined;
            if (
              parts[1]?.type === forge.asn1.Type.SEQUENCE &&
              Array.isArray(parts[1].value) &&
              parts[1].value.length >= 2
            ) {
              try {
                issuerAttrs = rdnAttributesAsArray(parts[1].value[0]);
                serialHex = forge.util
                  .createBuffer(parts[1].value[1].value as string, 'raw')
                  .toHex();
              } catch {
                // ignore
              }
            }

            if (digestOid && sigBytes) {
              signer = {
                digestOid,
                signatureAlgorithmOid: sigAlgOid,
                signatureBytes: sigBytes,
                authenticatedAttributes: authAttrs,
                issuerAttrs,
                serialHex,
              };
              break;
            }
          }
        }
      }
    }

    return { certificates, signer, encapsulatedContent };
  }
}

function findSignerCertificate(
  certificates: forge.pki.Certificate[],
  signer: ExtractedSignerInfo
): forge.pki.Certificate | undefined {
  if (certificates.length === 0) return undefined;
  if (signer.serialHex) {
    const targetSerial = normalizeSerialHex(signer.serialHex);
    const matched = certificates.find((c) => {
      if (normalizeSerialHex(c.serialNumber) !== targetSerial) return false;
      if (!signer.issuerAttrs || signer.issuerAttrs.length === 0) return true;
      return c.issuer.attributes.length === signer.issuerAttrs.length;
    });
    if (matched) return matched;
  }
  return certificates[0];
}

function normalizeTrustedCert(cert: string | forge.pki.Certificate): forge.pki.Certificate {
  if (typeof cert === 'string') {
    return forge.pki.certificateFromPem(cert);
  }
  // Certificates constructed in memory before PEM/DER serialization have subject.hash === null;
  // PEM roundtrip populates canonical DER hashes required by forge's CA store lookup.
  if (!cert.subject?.hash) {
    return forge.pki.certificateFromPem(forge.pki.certificateToPem(cert));
  }
  return cert;
}

function buildOrderedChain(
  signerCert: forge.pki.Certificate,
  certificates: forge.pki.Certificate[]
): forge.pki.Certificate[] {
  const chain: forge.pki.Certificate[] = [signerCert];
  const visited = new Set<forge.pki.Certificate>([signerCert]);
  let current = signerCert;

  while (chain.length < certificates.length) {
    if (current.isIssuer(current)) break;
    const issuer = certificates.find((c) => !visited.has(c) && current.isIssuer(c));
    if (!issuer) break;
    chain.push(issuer);
    visited.add(issuer);
    current = issuer;
  }

  return chain;
}

function checkCertificateTrust(
  certificates: forge.pki.Certificate[],
  signerCert: forge.pki.Certificate,
  trustedCerts?: (string | forge.pki.Certificate)[]
): boolean {
  if (!trustedCerts || trustedCerts.length === 0) {
    return false;
  }

  try {
    const parsedTrusted = trustedCerts.map(normalizeTrustedCert);
    const caStore = forge.pki.createCaStore(parsedTrusted);
    const chain = buildOrderedChain(signerCert, certificates);
    return forge.pki.verifyCertificateChain(caStore, chain);
  } catch {
    return false;
  }
}

function verifyParsedSignatureDict(
  dict: ParsedPdfDictionary,
  pdfBytes: Uint8Array,
  index: number,
  options?: SignatureDetectOptions
): SignatureVerificationResult {
  const nameRaw = decodePdfStringToken(dict.entries.get('/Name')?.raw);
  const reason = decodePdfStringToken(dict.entries.get('/Reason')?.raw);
  const location = decodePdfStringToken(dict.entries.get('/Location')?.raw);
  const subFilter = decodePdfStringToken(dict.entries.get('/SubFilter')?.raw);
  const dateRaw = decodePdfStringToken(dict.entries.get('/M')?.raw);
  let signedAt = formatPdfDateString(dateRaw);

  const baseId = `sig_dict_${index + 1}`;
  const defaultName = nameRaw || 'Dijital İmza';

  // 1. Validate /ByteRange
  const brEntry = dict.entries.get('/ByteRange');
  const contentsEntry = dict.entries.get('/Contents');
  let byteRangeValid = false;
  let b0 = 0;
  let l0 = 0;
  let b1 = 0;
  let l1 = 0;
  let hasPostSigData = false;

  if (brEntry) {
    const nums = brEntry.raw
      .replace(/^\[|\]$/g, '')
      .trim()
      .split(/\s+/)
      .map((n) => parseInt(n, 10));

    if (nums.length === 4 && nums.every((n) => Number.isFinite(n) && n >= 0)) {
      [b0, l0, b1, l1] = nums;
      const withinBounds =
        b0 === 0 && l0 > 0 && b1 >= b0 + l0 && l1 > 0 && b1 + l1 <= pdfBytes.length;

      const contentsCoversGap = contentsEntry
        ? b0 + l0 <= contentsEntry.start && contentsEntry.end <= b1
        : true;

      if (b1 + l1 < pdfBytes.length) {
        const trailing = pdfBytes.subarray(b1 + l1);
        for (let i = 0; i < trailing.length; i++) {
          const byte = trailing[i];
          if (byte !== 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) {
            hasPostSigData = true;
            break;
          }
        }
      }

      byteRangeValid = withinBounds && contentsCoversGap && !hasPostSigData;
    }
  }

  // 2. Extract /Contents bytes
  if (!contentsEntry) {
    return {
      id: baseId,
      name: defaultName,
      status: 'unknown',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid: false,
      subFilter,
      signedAt,
      reason,
      location,
      error: 'İmza sözlüğünde /Contents alanı bulunamadı.',
      details: 'İmzasız veya eksik imza sözlüğü.',
    };
  }

  const contentsTrimmed = contentsEntry.raw.trim();
  const rawContentsArr = contentsTrimmed.startsWith('<')
    ? hexStringToBytes(contentsTrimmed.slice(1, -1))
    : contentsTrimmed.startsWith('(')
    ? parseLiteralStringBytes(contentsTrimmed)
    : [];
  const rawContentsBytes = new Uint8Array(rawContentsArr);
  const hasNonZero = rawContentsBytes.some((b) => b !== 0);

  if (rawContentsBytes.length === 0 || !hasNonZero) {
    return {
      id: baseId,
      name: defaultName,
      status: 'unknown',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid: false,
      subFilter,
      signedAt,
      reason,
      location,
      error: 'İmza içeriği boş.',
      details: 'İmza alanı henüz kriptografik olarak imzalanmamış.',
    };
  }

  // 3. Parse PKCS#7 / CMS DER payload
  const derSlice = sliceDerTlv(rawContentsBytes);
  if (!derSlice) {
    return {
      id: baseId,
      name: defaultName,
      status: 'invalid',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid,
      subFilter,
      signedAt,
      reason,
      location,
      error: 'PKCS#7 ASN.1 DER yapısı çözümlenemedi.',
    };
  }

  let certificates: forge.pki.Certificate[] = [];
  let signer: ExtractedSignerInfo | null = null;
  let encapsulatedContent: string | null = null;

  try {
    const derBuf = forge.util.createBuffer(uint8ToBinaryString(derSlice), 'raw');
    const asn1Obj = forge.asn1.fromDer(derBuf, false);
    const parsed = extractSignerAndCertsFromAsn1(asn1Obj);
    certificates = parsed.certificates;
    signer = parsed.signer;
    encapsulatedContent = parsed.encapsulatedContent;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: baseId,
      name: defaultName,
      status: 'invalid',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid,
      subFilter,
      signedAt,
      reason,
      location,
      error: `PKCS#7 ayrıştırma hatası: ${msg}`,
    };
  }

  if (!signer) {
    return {
      id: baseId,
      name: defaultName,
      status: 'invalid',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid,
      subFilter,
      signedAt,
      reason,
      location,
      error: 'PKCS#7 imzalayıcı bilgisi (SignerInfo) bulunamadı.',
    };
  }

  const signerCert = findSignerCertificate(certificates, signer);
  const certInfo = signerCert ? extractCertInfo(signerCert) : undefined;
  const displayName =
    nameRaw ||
    (signerCert?.subject.getField('CN')?.value
      ? formatDistinguishedName([signerCert.subject.getField('CN')!]).replace(/^CN=/, '')
      : 'Dijital İmza');

  // Extract signingTime from authenticatedAttributes if /M wasn't present
  if (!signedAt && signer.authenticatedAttributes) {
    for (const attr of signer.authenticatedAttributes) {
      try {
        const attrParts = attr.value as forge.asn1.Asn1[];
        const oid = forge.asn1.derToOid(attrParts[0].value as string);
        if (oid === forge.pki.oids.signingTime) {
          const valNode = (attrParts[1].value as forge.asn1.Asn1[])[0];
          if (typeof valNode.value === 'string') {
            const d =
              valNode.type === forge.asn1.Type.GENERALIZEDTIME
                ? forge.asn1.generalizedTimeToDate(valNode.value)
                : forge.asn1.utcTimeToDate(valNode.value);
            signedAt = d.toLocaleString('tr-TR');
          }
        }
      } catch {
        // ignore malformed signingTime
      }
    }
  }

  const digestAlg = resolveDigestAlgorithm(signer.digestOid);
  if (!digestAlg) {
    return {
      id: baseId,
      name: displayName,
      status: 'unknown',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid,
      digestAlgorithm: signer.digestOid,
      subFilter,
      signedAt,
      reason,
      location,
      certificate: certInfo,
      error: `Desteklenmeyen özet algoritması OID: ${signer.digestOid}`,
    };
  }

  if (!byteRangeValid) {
    return {
      id: baseId,
      name: displayName,
      status: 'tampered',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid: false,
      digestAlgorithm: digestAlg.label,
      subFilter,
      signedAt,
      reason,
      location,
      certificate: certInfo,
      error: hasPostSigData
        ? 'İmzalandıktan sonra belgeye veri eklenmiş veya ByteRange kapsamı dışında değişiklik yapılmış.'
        : 'Geçersiz veya kapsam dışı /ByteRange değerleri.',
    };
  }

  if (!signerCert) {
    return {
      id: baseId,
      name: displayName,
      status: 'invalid',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid: true,
      digestAlgorithm: digestAlg.label,
      subFilter,
      signedAt,
      reason,
      location,
      error: 'İmza paketi içinde X.509 sertifikası bulunamadı.',
    };
  }

  // 4. Compute /ByteRange hash and compare messageDigest
  const computedByteRangeDigest = hashByteRange(pdfBytes, b0, l0, b1, l1, digestAlg.name);
  let digestMatches = true;
  let contentToVerifyForSig = computedByteRangeDigest;

  if (subFilter === 'adbe.pkcs7.sha1' && encapsulatedContent !== null) {
    digestMatches = encapsulatedContent === computedByteRangeDigest;
    const encMd = forge.md[digestAlg.name].create();
    encMd.update(encapsulatedContent, 'raw');
    contentToVerifyForSig = encMd.digest().getBytes();
  }

  if (signer.authenticatedAttributes && signer.authenticatedAttributes.length > 0) {
    let embeddedDigest: string | null = null;
    for (const attr of signer.authenticatedAttributes) {
      try {
        const attrParts = attr.value as forge.asn1.Asn1[];
        const oid = forge.asn1.derToOid(attrParts[0].value as string);
        if (oid === forge.pki.oids.messageDigest) {
          const valNode = (attrParts[1].value as forge.asn1.Asn1[])[0];
          if (typeof valNode.value === 'string') {
            embeddedDigest = valNode.value;
          }
        }
      } catch {
        // ignore
      }
    }

    if (!embeddedDigest || embeddedDigest !== contentToVerifyForSig) {
      digestMatches = false;
    }
  }

  if (!digestMatches) {
    return {
      id: baseId,
      name: displayName,
      status: 'tampered',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid: true,
      digestAlgorithm: digestAlg.label,
      subFilter,
      signedAt,
      reason,
      location,
      certificate: certInfo,
      error: 'Belge özeti (MessageDigest) imzadaki özetle uyuşmuyor — belge imzalandıktan sonra değiştirilmiş!',
    };
  }

  // 5. Verify RSA signature over authenticatedAttributes SET (or direct content digest)
  let sigDigestBytes: string;
  if (signer.authenticatedAttributes && signer.authenticatedAttributes.length > 0) {
    const attrsSet = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      signer.authenticatedAttributes
    );
    const attrsDer = forge.asn1.toDer(attrsSet).getBytes();
    const sigMd = forge.md[digestAlg.name].create();
    sigMd.update(attrsDer, 'raw');
    sigDigestBytes = sigMd.digest().getBytes();
  } else {
    sigDigestBytes = contentToVerifyForSig;
  }

  let cryptoVerified = false;
  try {
    const pubKey = signerCert.publicKey as forge.pki.rsa.PublicKey;
    if (typeof pubKey?.verify === 'function') {
      cryptoVerified = pubKey.verify(sigDigestBytes, signer.signatureBytes);
    } else {
      return {
        id: baseId,
        name: displayName,
        status: 'unknown',
        isValid: false,
        integrityVerified: false,
        certificateTrusted: false,
        byteRangeValid: true,
        digestAlgorithm: digestAlg.label,
        subFilter,
        signedAt,
        reason,
        location,
        certificate: certInfo,
        error: 'Sertifika açık anahtarı RSA değil veya doğrulanamadı.',
      };
    }
  } catch {
    cryptoVerified = false;
  }

  if (!cryptoVerified) {
    return {
      id: baseId,
      name: displayName,
      status: 'tampered',
      isValid: false,
      integrityVerified: false,
      certificateTrusted: false,
      byteRangeValid: true,
      digestAlgorithm: digestAlg.label,
      subFilter,
      signedAt,
      reason,
      location,
      certificate: certInfo,
      error: 'Kriptografik imza doğrulaması başarısız! İmza veya belge bozulmuş.',
    };
  }

  // 6. Check certificate expiry and CA trust
  const certificateTrusted = checkCertificateTrust(
    certificates,
    signerCert,
    options?.trustedCertificates
  );
  const isExpired = Boolean(certInfo?.isExpired);

  let status: SignatureValidityStatus;
  let details: string;
  if (isExpired) {
    status = 'expired';
    details = `Kriptografik bütünlük doğrulandı ancak imzalayan sertifikanın geçerlilik süresi dolmuş (${certInfo?.validTo}).`;
  } else if (!certificateTrusted) {
    status = 'untrusted-signer';
    details = certInfo?.isSelfSigned
      ? 'Belge bütünlüğü kriptografik olarak doğrulandı (değiştirilmemiş), ancak sertifika kendi imzalı (self-signed) ve güvenilir kök listesinde değil.'
      : 'Belge bütünlüğü kriptografik olarak doğrulandı (değiştirilmemiş), ancak imzalayan sertifika yerel güven deposunda doğrulanamadı.';
  } else {
    status = 'valid';
    details = `Geçerli ve güvenilir ${digestAlg.label} (${subFilter || 'PKCS#7'}) dijital imza.`;
  }

  return {
    id: baseId,
    name: displayName,
    status,
    isValid: status === 'valid',
    integrityVerified: true,
    certificateTrusted,
    byteRangeValid: true,
    digestAlgorithm: digestAlg.label,
    subFilter,
    signedAt,
    reason,
    location,
    certificate: certInfo,
    details,
  };
}

export class SignatureDetector {
  /**
   * Scans a PDF document for signature widgets and performs real cryptographic PKCS#7 verification.
   */
  public static async detectSignatures(
    pdfDocProxy: PDFDocumentProxy,
    rawBuffer?: ArrayBuffer | Uint8Array,
    options?: SignatureDetectOptions
  ): Promise<SignatureVerificationResult[]> {
    const widgetFields: {
      id: string;
      name: string;
      pageNumber: number;
      reason?: string;
      location?: string;
      date?: string;
      subFilter?: string;
    }[] = [];

    // 1. Scan PDF.js page annotations for /FT /Sig widgets
    try {
      for (let p = 1; p <= pdfDocProxy.numPages; p++) {
        const page = await pdfDocProxy.getPage(p);
        const annotations = await page.getAnnotations({ intent: 'any' });

        for (const ann of annotations) {
          if (ann.subtype === 'Widget' && (ann.fieldType === 'Sig' || ann.sigFlags)) {
            widgetFields.push({
              id: ann.id || `sig_widget_${p}_${widgetFields.length + 1}`,
              name: ann.fieldName || ann.name || `İmza Alanı (Sayfa ${p})`,
              pageNumber: p,
              date: ann.modificationDate || undefined,
              reason: ann.reason || undefined,
              location: ann.location || undefined,
              subFilter: ann.subFilter || undefined,
            });
          }
        }
      }
    } catch (err) {
      console.warn('Error reading annotations for signatures:', err);
    }

    // 2. Cryptographically inspect binary /Type /Sig dictionaries
    const verifiedDictResults: SignatureVerificationResult[] = [];
    if (rawBuffer) {
      const pdfBytes =
        rawBuffer instanceof Uint8Array ? rawBuffer : new Uint8Array(rawBuffer);
      if (pdfBytes.byteLength > 0) {
        const sigDicts = scanSignatureDictionaries(pdfBytes);
        for (let idx = 0; idx < sigDicts.length; idx++) {
          const res = verifyParsedSignatureDict(sigDicts[idx], pdfBytes, idx, options);
          verifiedDictResults.push(res);
        }
      }
    }

    // 3. Reconcile widgets with verified signature dictionaries without hiding distinct signers
    const results: SignatureVerificationResult[] = [];
    const matchedWidgetIndices = new Set<number>();

    for (const sigResult of verifiedDictResults) {
      const matchIdx = widgetFields.findIndex((w, i) => {
        if (matchedWidgetIndices.has(i)) return false;
        if (sigResult.reason && w.reason && sigResult.reason === w.reason) return true;
        if (w.name && sigResult.name && w.name === sigResult.name) return true;
        return false;
      });

      // Fallback positional match if counts line up and no metadata matched
      const fallbackIdx =
        matchIdx !== -1
          ? matchIdx
          : widgetFields.findIndex((_, i) => !matchedWidgetIndices.has(i));

      if (fallbackIdx !== -1 && widgetFields.length === verifiedDictResults.length) {
        matchedWidgetIndices.add(fallbackIdx);
        sigResult.pageNumber = widgetFields[fallbackIdx].pageNumber;
      } else if (matchIdx !== -1) {
        matchedWidgetIndices.add(matchIdx);
        sigResult.pageNumber = widgetFields[matchIdx].pageNumber;
      }

      results.push(sigResult);
    }

    // Any remaining PDF.js /FT /Sig widgets that had NO /Type /Sig cryptographic value are unsigned!
    for (let i = 0; i < widgetFields.length; i++) {
      if (matchedWidgetIndices.has(i)) continue;
      const w = widgetFields[i];
      results.push({
        id: w.id,
        name: w.name,
        status: 'unknown',
        isValid: false,
        integrityVerified: false,
        certificateTrusted: false,
        byteRangeValid: false,
        subFilter: w.subFilter,
        signedAt: formatPdfDateString(w.date),
        reason: w.reason,
        location: w.location,
        pageNumber: w.pageNumber,
        details: 'İmzasız (boş) imza alanı — bu alanda henüz kriptografik imza uygulanmamış.',
      });
    }

    return results;
  }
}
