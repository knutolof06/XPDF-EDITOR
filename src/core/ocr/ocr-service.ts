import { createWorker, Worker, PSM } from 'tesseract.js';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { SearchablePdfEngine } from './searchable-pdf-engine';

export type OcrLanguage = 'tur' | 'eng' | 'tur+eng' | 'deu' | 'fra';
export type OcrPageSegMode = '3' | '6' | '11'; // '3': Auto, '6': Single Block, '11': Sparse Text
export type OcrEnhanceMode = 'smart' | 'enhanced' | 'raw' | 'otsu';

export interface OcrBbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: OcrBbox;
  normBbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox: OcrBbox;
  words: OcrWord[];
}

export interface OcrParagraph {
  text: string;
  confidence: number;
  bbox: OcrBbox;
  normBbox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  lines: OcrLine[];
  estimatedFontSize: number;
  isBold: boolean;
}

export interface OcrPageResult {
  pageNumber: number;
  text: string;
  confidence: number;
  words: OcrWord[];
  lines: OcrLine[];
  paragraphs: OcrParagraph[];
  width: number;
  height: number;
  renderScale?: number;
  previewUrl: string;
}

export interface OcrDocumentResult {
  pages: OcrPageResult[];
  fullText: string;
  averageConfidence: number;
  totalWords: number;
  totalPages: number;
}

export interface OcrProgress {
  stage: 'rasterizing' | 'recognizing' | 'assembling' | 'done';
  currentPage: number;
  totalPages: number;
  pageProgress: number; // 0 to 100
  overallProgress: number; // 0 to 100
  statusText: string;
}

export interface OcrProcessOptions {
  signal?: AbortSignal;
  scale?: number;
  includePreview?: boolean;
}

function getLocalTesseractAssetUrl(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
    return chrome.runtime.getURL(clean);
  }
  return './' + clean;
}

function createAbortError(message = 'OCR işlemi iptal edildi.'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export class OcrPostProcessor {
  /**
   * Post-processes OCR output to repair Turkish ligatures, typography, and common OCR artifacts.
   */
  public static cleanText(rawText: string): string {
    if (!rawText) return '';
    let text = rawText.normalize('NFC');

    // 1. Remove hyphenation at line breaks: "kelime-\nler" -> "kelimeler"
    text = text.replace(/([a-zA-ZçÇğĞıİöÖşŞüÜ])-\s*\n\s*([a-zA-ZçÇğĞıİöÖşŞüÜ])/g, '$1$2');

    // 2. Fix pipe characters mistakenly recognized as letters inside words: e.g. "b|r" -> "bir"
    text = text.replace(/([a-zA-ZçÇğĞıİöÖşŞüÜ])\|([a-zA-ZçÇğĞıİöÖşŞüÜ])/g, '$1l$2');

    // 3. Fix missing space after punctuation (ignoring decimal numbers like 3,14)
    text = text.replace(/([a-zA-ZçÇğĞıİöÖşŞüÜ])([,;:!?])([a-zA-ZçÇğĞıİöÖşŞüÜ])/g, '$1$2 $3');

    // 4. Normalize quotes
    text = text.replace(/[„“”]/g, '"').replace(/[‘’`]/g, "'");

    // 5. Clean excessive spaces within lines
    text = text
      .split('\n')
      .map((line) => line.replace(/[ \t]{2,}/g, ' ').trimEnd())
      .join('\n');

    return text.trim();
  }
}

export class OcrService {
  private static activeWorker: Worker | null = null;
  private static currentLang: string | null = null;
  private static currentPsm: string | null = null;
  private static workerOpMutex: Promise<void> = Promise.resolve();
  private static progressCallback: ((progress: number, status: string) => void) | null = null;

  private static runWithMutex<T>(task: () => Promise<T>): Promise<T> {
    const next = this.workerOpMutex.then(task, task);
    this.workerOpMutex = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * Initializes or reuses a Tesseract.js worker with local offline paths and mutex protection.
   */
  public static async getWorker(
    lang: OcrLanguage = 'tur+eng',
    psm: OcrPageSegMode = '3',
    onProgress?: (progress: number, status: string) => void,
    signal?: AbortSignal
  ): Promise<Worker> {
    return this.runWithMutex(async () => {
      throwIfAborted(signal);
      this.progressCallback = onProgress || null;

      if (this.activeWorker && this.currentLang === lang) {
        if (this.currentPsm !== psm) {
          try {
            await this.activeWorker.setParameters({
              tessedit_pageseg_mode: psm as PSM,
            });
            this.currentPsm = psm;
          } catch (err) {
            console.warn('Could not update tesseract PSM:', err);
          }
        }
        return this.activeWorker;
      }

      if (this.activeWorker) {
        try {
          await this.activeWorker.terminate();
        } catch (err) {
          console.warn('Error terminating previous worker:', err);
        }
        this.activeWorker = null;
        this.currentLang = null;
        this.currentPsm = null;
      }

      const workerPath = getLocalTesseractAssetUrl('tesseract/worker.min.js');
      const corePath = getLocalTesseractAssetUrl('tesseract');

      let workerError: Error | null = null;
      const worker = await createWorker(lang, 1, {
        workerPath,
        corePath,
        logger: (m) => {
          if (this.progressCallback && typeof m.progress === 'number') {
            this.progressCallback(Math.round(m.progress * 100), m.status || 'İşleniyor');
          }
        },
        errorHandler: (err) => {
          workerError = err instanceof Error ? err : new Error(String(err));
        },
      });

      if (workerError) {
        try {
          await worker.terminate();
        } catch {}
        throw workerError;
      }

      if (signal?.aborted) {
        try {
          await worker.terminate();
        } catch {}
        throw createAbortError();
      }

      try {
        await worker.setParameters({
          user_defined_dpi: '300',
          preserve_interword_spaces: '1',
          tessedit_pageseg_mode: psm as PSM,
        });
      } catch (err) {
        console.warn('Could not set tesseract parameters:', err);
      }

      this.activeWorker = worker;
      this.currentLang = lang;
      this.currentPsm = psm;
      return worker;
    });
  }

  /**
   * Terminates active worker safely under mutex lock to free WASM/Worker memory.
   */
  public static async terminateWorker(): Promise<void> {
    return this.runWithMutex(async () => {
      this.progressCallback = null;
      if (this.activeWorker) {
        const worker = this.activeWorker;
        this.activeWorker = null;
        this.currentLang = null;
        this.currentPsm = null;
        try {
          await worker.terminate();
        } catch (err) {
          console.warn('Worker terminate error:', err);
        }
      }
    });
  }

  /**
   * Calculates Otsu's optimal threshold from a grayscale histogram.
   */
  private static computeOtsuThreshold(grayData: Uint8ClampedArray): number {
    const histogram = new Array(256).fill(0);
    const total = grayData.length;

    for (let i = 0; i < total; i++) {
      histogram[grayData[i]]++;
    }

    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += i * histogram[i];
    }

    let sumB = 0;
    let wB = 0;
    let wF = 0;
    let varMax = 0;
    let threshold = 135;

    for (let t = 0; t < 256; t++) {
      wB += histogram[t];
      if (wB === 0) continue;
      wF = total - wB;
      if (wF === 0) break;

      sumB += t * histogram[t];
      const mB = sumB / wB;
      const mF = (sum - sumB) / wF;
      const varBetween = wB * wF * (mB - mF) * (mB - mF);

      if (varBetween > varMax) {
        varMax = varBetween;
        threshold = t;
      }
    }

    return Math.max(90, Math.min(180, threshold));
  }

  /**
   * High-resolution offscreen canvas rendering with adaptive preprocessing.
   * Skips generating heavy JPEG previewUrl unless explicitly requested.
   */
  public static async renderPageToCanvas(
    pdfDocProxy: PDFDocumentProxy,
    pageNumber: number,
    scale: number = 3.0,
    enhanceMode: OcrEnhanceMode = 'smart',
    includePreview: boolean = false
  ): Promise<{ canvas: HTMLCanvasElement; width: number; height: number; previewUrl: string }> {
    const page = await pdfDocProxy.getPage(pageNumber);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      canvas.width = 0;
      canvas.height = 0;
      throw new Error('Canvas 2D context oluşturulamadı.');
    }

    try {
      await page.render({ canvasContext: ctx, viewport }).promise;

      if (enhanceMode !== 'raw') {
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        const totalPixels = canvas.width * canvas.height;
        const grayBuffer = new Uint8ClampedArray(totalPixels);

        for (let i = 0; i < data.length; i += 4) {
          grayBuffer[i >> 2] = Math.round(
            0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          );
        }

        if (enhanceMode === 'otsu') {
          const otsuThresh = this.computeOtsuThreshold(grayBuffer);
          for (let i = 0; i < data.length; i += 4) {
            const val = grayBuffer[i >> 2] < otsuThresh ? 0 : 255;
            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
          }
        } else {
          const hist = new Uint32Array(256);
          for (let i = 0; i < totalPixels; i++) hist[grayBuffer[i]]++;

          let count = 0;
          let p5 = 0;
          let p95 = 255;
          const target5 = Math.floor(totalPixels * 0.05);
          const target95 = Math.floor(totalPixels * 0.95);

          for (let v = 0; v < 256; v++) {
            count += hist[v];
            if (p5 === 0 && count >= target5) p5 = v;
            if (p95 === 255 && count >= target95) {
              p95 = v;
              break;
            }
          }

          const blackPoint = enhanceMode === 'enhanced' ? Math.min(60, p5 + 15) : Math.min(45, p5);
          const whitePoint = enhanceMode === 'enhanced' ? Math.max(180, p95 - 10) : Math.max(210, p95);
          const range = Math.max(1, whitePoint - blackPoint);
          const gamma = enhanceMode === 'enhanced' ? 0.8 : 0.92;

          for (let i = 0; i < data.length; i += 4) {
            const lum = grayBuffer[i >> 2];
            let norm = (lum - blackPoint) / range;
            if (norm < 0) norm = 0;
            if (norm > 1) norm = 1;

            const adjusted = Math.pow(norm, gamma) * 255;
            const val = adjusted > 236 ? 255 : Math.round(adjusted);

            data[i] = val;
            data[i + 1] = val;
            data[i + 2] = val;
          }
        }

        ctx.putImageData(imgData, 0, 0);
      }

      const previewUrl = includePreview ? canvas.toDataURL('image/jpeg', 0.88) : '';

      return {
        canvas,
        width: canvas.width,
        height: canvas.height,
        previewUrl,
      };
    } catch (err) {
      canvas.width = 0;
      canvas.height = 0;
      throw err;
    }
  }

  /**
   * Spatial clustering algorithm that groups individual lines into coherent,
   * natural paragraph blocks with estimated font size and styling.
   */
  public static clusterLinesIntoParagraphs(
    lines: OcrLine[],
    canvasWidth: number,
    canvasHeight: number,
    renderScale: number = 3.0
  ): OcrParagraph[] {
    if (lines.length === 0 || canvasWidth <= 0 || canvasHeight <= 0) return [];
    const safeScale = renderScale > 0 ? renderScale : 3.0;

    const sortedLines = [...lines].sort((a, b) => {
      const yDiff = a.bbox.y0 - b.bbox.y0;
      if (Math.abs(yDiff) > 8) return yDiff;
      return a.bbox.x0 - b.bbox.x0;
    });

    const lineHeights = sortedLines.map((l) => l.bbox.y1 - l.bbox.y0).filter((h) => h > 4);
    lineHeights.sort((a, b) => a - b);
    const medianLineHeight = lineHeights[Math.floor(lineHeights.length / 2)] || 18;

    const paragraphs: OcrParagraph[] = [];
    let currentParagraphLines: OcrLine[] = [];

    const flushParagraph = () => {
      if (currentParagraphLines.length === 0) return;

      const pLines = [...currentParagraphLines];
      const minX = Math.min(...pLines.map((l) => l.bbox.x0));
      const minY = Math.min(...pLines.map((l) => l.bbox.y0));
      const maxX = Math.max(...pLines.map((l) => l.bbox.x1));
      const maxY = Math.max(...pLines.map((l) => l.bbox.y1));

      const text = pLines.map((l) => l.text).join('\n');
      const avgConfidence = Math.round(
        pLines.reduce((acc, l) => acc + l.confidence, 0) / pLines.length
      );

      const blockHeight = maxY - minY;
      const avgLineHeight = blockHeight / pLines.length;
      const pointLineHeight = avgLineHeight / safeScale;
      const estimatedFontSize = Math.max(8, Math.min(48, Math.round(pointLineHeight * 0.75)));
      const isBold = estimatedFontSize > (medianLineHeight / safeScale) * 1.35;

      paragraphs.push({
        text,
        confidence: avgConfidence,
        bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
        normBbox: {
          x: minX / canvasWidth,
          y: minY / canvasHeight,
          width: (maxX - minX) / canvasWidth,
          height: (maxY - minY) / canvasHeight,
        },
        lines: pLines,
        estimatedFontSize,
        isBold,
      });

      currentParagraphLines = [];
    };

    for (let i = 0; i < sortedLines.length; i++) {
      const line = sortedLines[i];

      if (currentParagraphLines.length === 0) {
        currentParagraphLines.push(line);
        continue;
      }

      const prevLine = currentParagraphLines[currentParagraphLines.length - 1];
      const verticalGap = line.bbox.y0 - prevLine.bbox.y1;
      const prevLineHeight = prevLine.bbox.y1 - prevLine.bbox.y0;

      const overlapStart = Math.max(prevLine.bbox.x0, line.bbox.x0);
      const overlapEnd = Math.min(prevLine.bbox.x1, line.bbox.x1);
      const overlap = Math.max(0, overlapEnd - overlapStart);
      const minWidth = Math.min(prevLine.bbox.x1 - prevLine.bbox.x0, line.bbox.x1 - line.bbox.x0);
      const hasHorizontalOverlap = minWidth > 0 && overlap / minWidth > 0.25;

      const isCloseVertical = verticalGap >= -4 && verticalGap <= prevLineHeight * 1.65;
      const isIndentedParagraph = Math.abs(line.bbox.x0 - prevLine.bbox.x0) < 60;

      if (isCloseVertical && (hasHorizontalOverlap || isIndentedParagraph)) {
        currentParagraphLines.push(line);
      } else {
        flushParagraph();
        currentParagraphLines.push(line);
      }
    }

    flushParagraph();
    return paragraphs;
  }

  /**
   * Synthesizes fallback paragraphs from raw or edited text when bounding boxes are unavailable.
   */
  public static synthesizeParagraphsFromText(
    text: string,
    canvasWidth: number,
    canvasHeight: number,
    renderScale: number = 3.0
  ): OcrParagraph[] {
    const safeScale = renderScale > 0 ? renderScale : 3.0;
    const rawParagraphs = text
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (rawParagraphs.length === 0 && text.trim().length > 0) {
      rawParagraphs.push(text.trim());
    }

    const marginX = canvasWidth * 0.08;
    const availableWidth = canvasWidth * 0.84;
    let currentY = canvasHeight * 0.08;
    const estFontSize = Math.max(12, Math.round(canvasHeight * 0.017));
    const lineHeight = estFontSize * 1.4;

    const result: OcrParagraph[] = [];

    for (const pText of rawParagraphs) {
      const linesCount = Math.max(1, Math.ceil(pText.length / 75));
      const pHeight = linesCount * lineHeight + 10;
      const y0 = currentY;
      const y1 = Math.min(canvasHeight * 0.95, y0 + pHeight);

      result.push({
        text: pText,
        confidence: 85,
        bbox: { x0: marginX, y0, x1: marginX + availableWidth, y1 },
        normBbox: {
          x: marginX / canvasWidth,
          y: y0 / canvasHeight,
          width: availableWidth / canvasWidth,
          height: (y1 - y0) / canvasHeight,
        },
        lines: [],
        estimatedFontSize: Math.max(9, Math.round(estFontSize / safeScale)),
        isBold: false,
      });

      currentY = y1 + lineHeight * 0.8;
      if (currentY > canvasHeight * 0.92) {
        currentY = canvasHeight * 0.08;
      }
    }

    return result;
  }

  /**
   * Runs OCR on a single rendered canvas using Tesseract.js.
   */
  public static async recognizeCanvas(
    canvas: HTMLCanvasElement,
    previewUrl: string,
    pageNumber: number,
    lang: OcrLanguage = 'tur+eng',
    psm: OcrPageSegMode = '3',
    onProgress?: (progress: number, statusText: string) => void,
    signal?: AbortSignal,
    renderScale: number = 3.0
  ): Promise<OcrPageResult> {
    throwIfAborted(signal);
    const worker = await this.getWorker(lang, psm, onProgress, signal);
    throwIfAborted(signal);

    const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
    throwIfAborted(signal);

    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const pageData = result.data;

    const words: OcrWord[] = [];
    const lines: OcrLine[] = [];

    if (pageData.blocks && pageData.blocks.length > 0) {
      for (const block of pageData.blocks) {
        if (!block.paragraphs) continue;
        for (const paragraph of block.paragraphs) {
          if (!paragraph.lines) continue;
          for (const line of paragraph.lines) {
            const lineWords: OcrWord[] = [];

            if (line.words) {
              for (const word of line.words) {
                const clean = (word.text || '').trim();
                if (clean.length > 0) {
                  const w: OcrWord = {
                    text: clean,
                    confidence: Math.round(word.confidence || 0),
                    bbox: word.bbox,
                    normBbox: {
                      x: word.bbox.x0 / canvasWidth,
                      y: word.bbox.y0 / canvasHeight,
                      width: (word.bbox.x1 - word.bbox.x0) / canvasWidth,
                      height: (word.bbox.y1 - word.bbox.y0) / canvasHeight,
                    },
                  };
                  words.push(w);
                  lineWords.push(w);
                }
              }
            }

            if (line.text && line.text.trim().length > 0) {
              lines.push({
                text: line.text.trim(),
                confidence: Math.round(line.confidence || 0),
                bbox: line.bbox,
                words: lineWords,
              });
            }
          }
        }
      }
    }

    let paragraphs = this.clusterLinesIntoParagraphs(lines, canvasWidth, canvasHeight, renderScale);
    const cleanedText = OcrPostProcessor.cleanText(pageData.text || '');

    if (paragraphs.length === 0 && cleanedText.length > 0) {
      paragraphs = this.synthesizeParagraphsFromText(
        cleanedText,
        canvasWidth,
        canvasHeight,
        renderScale
      );
    }

    return {
      pageNumber,
      text: cleanedText || pageData.text || '',
      confidence: Math.round(pageData.confidence || 0),
      words,
      lines,
      paragraphs,
      width: canvasWidth,
      height: canvasHeight,
      renderScale,
      previewUrl,
    };
  }

  /**
   * Batch processes a list of page numbers with real-time progress callbacks,
   * AbortSignal cancellation, and automatic canvas cleanup.
   */
  public static async processDocumentPages(
    pdfDocProxy: PDFDocumentProxy,
    pageNumbers: number[],
    lang: OcrLanguage = 'tur+eng',
    enhanceMode: OcrEnhanceMode = 'smart',
    psm: OcrPageSegMode = '3',
    onProgress?: (progress: OcrProgress) => void,
    options: OcrProcessOptions = {}
  ): Promise<OcrDocumentResult> {
    const { signal, scale = 3.0, includePreview = false } = options;
    const total = pageNumbers.length;
    const results: OcrPageResult[] = [];
    let totalConfidence = 0;
    let totalWords = 0;

    for (let i = 0; i < total; i++) {
      throwIfAborted(signal);
      const pageNum = pageNumbers[i];

      if (onProgress) {
        onProgress({
          stage: 'rasterizing',
          currentPage: pageNum,
          totalPages: total,
          pageProgress: 10,
          overallProgress: Math.round((i / total) * 100),
          statusText: `Sayfa ${pageNum} 300 DPI ve adaptif filtreleme ile rasterize ediliyor...`,
        });
      }

      const { canvas, previewUrl } = await this.renderPageToCanvas(
        pdfDocProxy,
        pageNum,
        scale,
        enhanceMode,
        includePreview
      );

      try {
        throwIfAborted(signal);

        const pageResult = await this.recognizeCanvas(
          canvas,
          previewUrl,
          pageNum,
          lang,
          psm,
          (p, status) => {
            if (signal?.aborted) return;
            if (onProgress) {
              const pagePct = 10 + Math.round(p * 0.85);
              const overall = Math.round(((i + p / 100) / total) * 100);
              onProgress({
                stage: 'recognizing',
                currentPage: pageNum,
                totalPages: total,
                pageProgress: pagePct,
                overallProgress: Math.min(99, overall),
                statusText: `Sayfa ${pageNum}: LSTM Sinir Ağı (${status} %${p})`,
              });
            }
          },
          signal,
          scale
        );

        results.push(pageResult);
        totalConfidence += pageResult.confidence;
        totalWords += pageResult.words.length;
      } finally {
        // Release temporary rasterization buffer immediately after OCR finishes/aborts
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    throwIfAborted(signal);

    if (onProgress) {
      onProgress({
        stage: 'done',
        currentPage: pageNumbers[total - 1] || 1,
        totalPages: total,
        pageProgress: 100,
        overallProgress: 100,
        statusText: 'Akıllı OCR tamamlandı!',
      });
    }

    const fullText = results
      .map((r) => `--- Sayfa ${r.pageNumber} ---\n${r.text.trim()}`)
      .join('\n\n');

    return {
      pages: results,
      fullText,
      averageConfidence: total > 0 ? Math.round(totalConfidence / total) : 0,
      totalWords,
      totalPages: total,
    };
  }

  /**
   * Generates a standards-compliant Searchable PDF (delegated to SearchablePdfEngine).
   */
  public static async exportSearchablePdf(
    originalBuffer: ArrayBuffer | Uint8Array,
    ocrPages: OcrPageResult[]
  ): Promise<Uint8Array> {
    return SearchablePdfEngine.createSearchablePdf(originalBuffer, ocrPages);
  }
}
