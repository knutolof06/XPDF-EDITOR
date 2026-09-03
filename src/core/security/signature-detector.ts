import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface DigitalSignatureInfo {
  id: string;
  name: string;
  date?: string;
  reason?: string;
  location?: string;
  subFilter?: string;
  pageNumber?: number;
  isValid: boolean;
  signerDetails?: string;
}

export class SignatureDetector {
  /**
   * Scans document for digital signature fields and PKCS#7 / CAdES signature dictionaries.
   */
  public static async detectSignatures(
    pdfDocProxy: PDFDocumentProxy,
    rawBuffer?: ArrayBuffer
  ): Promise<DigitalSignatureInfo[]> {
    const signatures: DigitalSignatureInfo[] = [];

    // 1. Scan PDF.js page annotations for /Sig widgets
    try {
      for (let p = 1; p <= pdfDocProxy.numPages; p++) {
        const page = await pdfDocProxy.getPage(p);
        const annotations = await page.getAnnotations({ intent: 'display' });

        for (const ann of annotations) {
          if (ann.subtype === 'Widget' && (ann.fieldType === 'Sig' || ann.sigFlags)) {
            const sigInfo: DigitalSignatureInfo = {
              id: ann.id || `sig_${p}_${signatures.length}`,
              name: ann.fieldName || ann.name || 'Dijital İmza',
              pageNumber: p,
              isValid: true,
              date: ann.modificationDate || undefined,
              reason: ann.reason || undefined,
              location: ann.location || undefined,
              subFilter: ann.subFilter || 'adbe.pkcs7.detached',
            };
            signatures.push(sigInfo);
          }
        }
      }
    } catch (err) {
      console.warn('Error reading annotations for signatures:', err);
    }

    // 2. Binary inspection for /Type /Sig or /ByteRange if not found or to enrich details
    if (rawBuffer && rawBuffer.byteLength > 0) {
      try {
        const decoder = new TextDecoder('latin1');
        const text = decoder.decode(new Uint8Array(rawBuffer));

        // Regex for /Type /Sig dictionary
        const sigRegex = /\/Type\s*\/Sig[\s\S]*?>>/g;
        let match: RegExpExecArray | null;

        while ((match = sigRegex.exec(text)) !== null) {
          const block = match[0];

          // Extract /Name
          const nameMatch = block.match(/\/Name\s*\(([^)]+)\)/) || block.match(/\/Name\s*\/([^\s/>]+)/);
          const name = nameMatch ? nameMatch[1] : 'Dijital Sertifika Sahibi';

          // Extract /M (Date)
          const dateMatch = block.match(/\/M\s*\(([^)]+)\)/);
          let formattedDate: string | undefined = undefined;
          if (dateMatch) {
            const rawDate = dateMatch[1]; // e.g. D:20260304123000
            if (rawDate.startsWith('D:')) {
              const y = rawDate.substring(2, 6);
              const m = rawDate.substring(6, 8);
              const d = rawDate.substring(8, 10);
              const h = rawDate.substring(10, 12);
              const min = rawDate.substring(12, 14);
              formattedDate = `${d}.${m}.${y} ${h}:${min}`;
            } else {
              formattedDate = rawDate;
            }
          }

          // Extract /Reason
          const reasonMatch = block.match(/\/Reason\s*\(([^)]+)\)/);
          const reason = reasonMatch ? reasonMatch[1] : undefined;

          // Extract /Location
          const locMatch = block.match(/\/Location\s*\(([^)]+)\)/);
          const location = locMatch ? locMatch[1] : undefined;

          // Extract /SubFilter
          const subMatch = block.match(/\/SubFilter\s*\/([^\s/>]+)/);
          const subFilter = subMatch ? subMatch[1] : 'adbe.pkcs7.detached';

          // Avoid duplicates if already found on a page
          const exists = signatures.some((s) => s.name === name || (reason && s.reason === reason));
          if (!exists) {
            signatures.push({
              id: `binary_sig_${signatures.length + 1}`,
              name,
              date: formattedDate,
              reason,
              location,
              subFilter,
              isValid: true,
              signerDetails: `Format: ${subFilter} • Standart: Adobe / ETSI Güvenli İmza`,
            });
          }
        }
      } catch (err) {
        console.warn('Binary signature scan error:', err);
      }
    }

    return signatures;
  }
}
