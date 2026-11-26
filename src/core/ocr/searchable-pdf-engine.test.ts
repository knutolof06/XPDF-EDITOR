import { describe, it, expect } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SearchablePdfEngine } from './searchable-pdf-engine';
import { OcrService, type OcrPageResult } from './ocr-service';

function loadFontBytes(): ArrayBuffer {
  const buf = readFileSync(resolve(process.cwd(), 'public/fonts/font-regular.ttf'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('SearchablePdfEngine — Unicode Turkish, /Rotate, /CropBox & 3 Tr', () => {
  it('embeds Turkish characters cleanly and preserves them in PDF.js text extraction', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]);
    const plainBytes = await doc.save();

    const turkishWord = 'ÇalışmaÖğrenciŞehir';
    const ocrPages: OcrPageResult[] = [
      {
        pageNumber: 1,
        text: turkishWord,
        confidence: 95,
        width: 1785,
        height: 2526,
        renderScale: 3.0,
        previewUrl: '',
        lines: [],
        paragraphs: [],
        words: [
          {
            text: turkishWord,
            confidence: 95,
            bbox: { x0: 178, y0: 252, x1: 714, y1: 315 },
            normBbox: { x: 0.1, y: 0.1, width: 0.3, height: 0.025 },
          },
        ],
      },
    ];

    const outBytes = await SearchablePdfEngine.createSearchablePdf(plainBytes, ocrPages, {
      fontBytes: loadFontBytes(),
    });

    const proxy = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise;
    const page = await proxy.getPage(1);
    const tc = await page.getTextContent();
    const items = tc.items.filter(
      (it): it is Extract<(typeof tc.items)[number], { str: string }> =>
        'str' in it && it.str.trim().length > 0
    );

    expect(items.length).toBe(1);
    expect(items[0].str).toBe(turkishWord);
    // Target width = 0.3 * 595 = 178.5pt (horizontal scaling Tz matches normBbox.width)
    expect(items[0].width).toBeCloseTo(595 * 0.3, 0);

    // Also verify 3 Tr (invisible text rendering mode) was emitted in page operator list
    const opList = await page.getOperatorList();
    // PDF.js OPS.setTextRenderingMode = 38, arg [3]
    const hasInvisibleTr = opList.fnArray.some(
      (fn, idx) => fn === pdfjsLib.OPS.setTextRenderingMode && opList.argsArray[idx]?.[0] === 3
    );
    expect(hasInvisibleTr).toBe(true);

    await proxy.destroy();
  });

  it('places invisible text accurately across /Rotate (0, 90, 180, 270) and non-zero /CropBox', async () => {
    const fontBytes = loadFontBytes();

    for (const rot of [0, 90, 180, 270]) {
      const doc = await PDFDocument.create();
      const page = doc.addPage([500, 700]);
      page.setCropBox(50, 100, 300, 400);
      page.setRotation(degrees(rot));
      const plainBytes = await doc.save();

      // Normalized bbox near visual top-left: (nx=0.2, ny=0.1, nw=0.4, nh=0.05)
      const ocrPages: OcrPageResult[] = [
        {
          pageNumber: 1,
          text: 'DöndürmeTesti',
          confidence: 96,
          width: 900,
          height: 1200,
          renderScale: 3.0,
          previewUrl: '',
          lines: [],
          paragraphs: [],
          words: [
            {
              text: 'DöndürmeTesti',
              confidence: 96,
              bbox: { x0: 180, y0: 120, x1: 540, y1: 180 },
              normBbox: { x: 0.2, y: 0.1, width: 0.4, height: 0.05 },
            },
          ],
        },
      ];

      const outBytes = await SearchablePdfEngine.createSearchablePdf(plainBytes, ocrPages, {
        fontBytes,
      });

      const proxy = await pdfjsLib.getDocument({ data: new Uint8Array(outBytes) }).promise;
      const p = await proxy.getPage(1);
      const vp = p.getViewport({ scale: 1 });
      const tc = await p.getTextContent();
      const item = tc.items.find(
        (it): it is Extract<(typeof tc.items)[number], { str: string }> =>
          'str' in it && it.str.includes('DöndürmeTesti')
      );

      expect(item).toBeDefined();
      const tx = pdfjsLib.Util.transform(vp.transform, item!.transform);
      // Transformed viewport origin (tx[4], tx[5]) should sit near (0.2 * vp.width, ~0.1425 * vp.height)
      expect(tx[4] / vp.width).toBeCloseTo(0.2, 1);
      expect(tx[5] / vp.height).toBeCloseTo(0.1425, 1);
      // Visual width should match 0.4 * vp.width
      expect(item!.width / vp.width).toBeCloseTo(0.4, 1);

      await proxy.destroy();
    }
  });

  it('OcrService.exportSearchablePdf delegates cleanly without stripping Turkish glyphs', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([400, 400]);
    const plainBytes = await doc.save();
    const buf = plainBytes.buffer.slice(
      plainBytes.byteOffset,
      plainBytes.byteOffset + plainBytes.byteLength
    ) as ArrayBuffer;

    const out = await OcrService.exportSearchablePdf(buf, [
      {
        pageNumber: 1,
        text: 'İğneŞiş',
        confidence: 90,
        width: 1200,
        height: 1200,
        renderScale: 3.0,
        previewUrl: '',
        lines: [],
        paragraphs: [],
        words: [
          {
            text: 'İğneŞiş',
            confidence: 90,
            bbox: { x0: 100, y0: 100, x1: 300, y1: 140 },
            normBbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.04 },
          },
        ],
      },
    ]);

    const proxy = await pdfjsLib.getDocument({ data: new Uint8Array(out) }).promise;
    const p = await proxy.getPage(1);
    const tc = await p.getTextContent();
    const joined = tc.items.map((i) => ('str' in i ? i.str : '')).join('');
    expect(joined).toContain('İğneŞiş');

    await proxy.destroy();
  });
});
