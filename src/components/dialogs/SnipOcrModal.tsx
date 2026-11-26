import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import {
  OcrService,
  OcrLanguage,
  OcrPageResult,
  OcrLine,
  OcrWord,
} from '@/core/ocr/ocr-service';
import { OcrTextTransfer } from '@/core/ocr/ocr-text-transfer';
import type { WinRtOcrLine } from '@/types/electron';
import {
  X,
  Crosshair,
  Copy,
  Check,
  Loader2,
  Type,
  RotateCcw,
  Languages,
  Info,
  AlertTriangle,
  FileText,
  Layers,
  ChevronLeft,
  ChevronRight,
  Download,
  Sparkles,
  StopCircle,
} from 'lucide-react';
import { cn } from '@/utils/cn';

type ScanMode = 'region' | 'current-page' | 'all-pages';
type SelectionState = 'idle' | 'selecting' | 'selected' | 'processing' | 'done' | 'error';

interface OcrLang {
  tag: string;
  name: string;
}

interface SelectionRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN_SELECTION = 8;

const TESSERACT_FALLBACK_LANGUAGES: OcrLang[] = [
  { tag: 'tur+eng', name: 'Türkçe + English' },
  { tag: 'tur', name: 'Türkçe' },
  { tag: 'eng', name: 'English' },
  { tag: 'deu', name: 'Deutsch' },
  { tag: 'fra', name: 'Français' },
];

function mapWinRtLinesToOcrPageResult(
  pageNumber: number,
  text: string,
  winLines: WinRtOcrLine[] | undefined,
  imgWidth: number,
  imgHeight: number,
  renderScale: number,
  offsetNorm?: { rx: number; ry: number; rw: number; rh: number }
): OcrPageResult {
  const safeW = Math.max(1, imgWidth);
  const safeH = Math.max(1, imgHeight);
  const fullW = offsetNorm ? Math.round(safeW / Math.max(0.001, offsetNorm.rw)) : safeW;
  const fullH = offsetNorm ? Math.round(safeH / Math.max(0.001, offsetNorm.rh)) : safeH;
  const offX = offsetNorm ? offsetNorm.rx * fullW : 0;
  const offY = offsetNorm ? offsetNorm.ry * fullH : 0;

  const words: OcrWord[] = [];
  const lines: OcrLine[] = [];

  for (const l of winLines || []) {
    const lineWords: OcrWord[] = [];
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = 0;
    let maxY = 0;

    for (const w of l.words || []) {
      const clean = (w.text || '').trim();
      if (!clean) continue;
      const x0 = offX + w.x;
      const y0 = offY + w.y;
      const x1 = x0 + Math.max(1, w.w);
      const y1 = y0 + Math.max(1, w.h);

      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);

      const wordObj: OcrWord = {
        text: clean,
        confidence: 92,
        bbox: { x0, y0, x1, y1 },
        normBbox: {
          x: x0 / fullW,
          y: y0 / fullH,
          width: (x1 - x0) / fullW,
          height: (y1 - y0) / fullH,
        },
      };
      words.push(wordObj);
      lineWords.push(wordObj);
    }

    if (l.text && l.text.trim()) {
      const lx0 = Number.isFinite(minX) ? minX : offX;
      const ly0 = Number.isFinite(minY) ? minY : offY;
      const lx1 = maxX > lx0 ? maxX : offX + safeW;
      const ly1 = maxY > ly0 ? maxY : offY + 24;
      lines.push({
        text: l.text.trim(),
        confidence: 92,
        bbox: { x0: lx0, y0: ly0, x1: lx1, y1: ly1 },
        words: lineWords,
      });
    }
  }

  const paragraphs =
    lines.length > 0
      ? OcrService.clusterLinesIntoParagraphs(lines, fullW, fullH, renderScale)
      : text.trim()
      ? OcrService.synthesizeParagraphsFromText(text.trim(), fullW, fullH, renderScale)
      : [];

  return {
    pageNumber,
    text: text.trim(),
    confidence: 92,
    words,
    lines,
    paragraphs,
    width: fullW,
    height: fullH,
    renderScale,
    previewUrl: '',
  };
}

function remapPageResultToRegion(
  regionResult: OcrPageResult,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): OcrPageResult {
  const fullW = Math.max(1, Math.round(regionResult.width / Math.max(0.001, rw)));
  const fullH = Math.max(1, Math.round(regionResult.height / Math.max(0.001, rh)));
  const offX = rx * fullW;
  const offY = ry * fullH;

  const words: OcrWord[] = regionResult.words.map((w) => ({
    ...w,
    bbox: {
      x0: offX + w.bbox.x0,
      y0: offY + w.bbox.y0,
      x1: offX + w.bbox.x1,
      y1: offY + w.bbox.y1,
    },
    normBbox: {
      x: rx + w.normBbox.x * rw,
      y: ry + w.normBbox.y * rh,
      width: w.normBbox.width * rw,
      height: w.normBbox.height * rh,
    },
  }));

  const lines: OcrLine[] = regionResult.lines.map((l) => ({
    ...l,
    bbox: {
      x0: offX + l.bbox.x0,
      y0: offY + l.bbox.y0,
      x1: offX + l.bbox.x1,
      y1: offY + l.bbox.y1,
    },
  }));

  const paragraphs = regionResult.paragraphs.map((p) => ({
    ...p,
    bbox: {
      x0: offX + p.bbox.x0,
      y0: offY + p.bbox.y0,
      x1: offX + p.bbox.x1,
      y1: offY + p.bbox.y1,
    },
    normBbox: {
      x: rx + p.normBbox.x * rw,
      y: ry + p.normBbox.y * rh,
      width: p.normBbox.width * rw,
      height: p.normBbox.height * rh,
    },
  }));

  return {
    ...regionResult,
    words,
    lines,
    paragraphs,
    width: fullW,
    height: fullH,
  };
}

export const SnipOcrModal: React.FC = () => {
  const { isSnipOcrModalOpen, setSnipOcrModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const selectionRef = useRef<SelectionRect | null>(null);

  const [modalPageIndex, setModalPageIndex] = useState(0);
  const [scanMode, setScanMode] = useState<ScanMode>('region');
  const [state, setState] = useState<SelectionState>('idle');
  const [pageRendered, setPageRendered] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [batchCancelledNotice, setBatchCancelledNotice] = useState(false);
  const [lastPageResults, setLastPageResults] = useState<OcrPageResult[]>([]);
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);

  const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;
  const hasWinRt = Boolean(
    electron?.isElectron && electron?.platform === 'win32' && electron?.winrtOcrRegion
  );

  const [languages, setLanguages] = useState<OcrLang[]>(
    hasWinRt ? [] : TESSERACT_FALLBACK_LANGUAGES
  );
  const [selectedLang, setSelectedLang] = useState<string>(hasWinRt ? '' : 'tur+eng');
  const [langLoaded, setLangLoaded] = useState(!hasWinRt);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    percent: number;
  } | null>(null);

  const totalPages = pdfDocProxy?.numPages || 1;

  // Keep ref in sync for window mouseup listener
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Reset state when modal opens/closes or document switches
  useEffect(() => {
    if (isSnipOcrModalOpen) {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setModalPageIndex(currentDocument?.activePageIndex || 0);
      setState('idle');
      setSelection(null);
      setDragStart(null);
      setOcrText('');
      setOcrError('');
      setBatchCancelledNotice(false);
      setLastPageResults([]);
      setBatchProgress(null);
    } else {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    }
  }, [isSnipOcrModalOpen, currentDocument?.id, currentDocument?.activePageIndex]);

  // Terminate Tesseract worker on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      OcrService.terminateWorker().catch(() => {});
    };
  }, []);

  // Load & validate installed WinRT languages (or configure Tesseract languages)
  useEffect(() => {
    if (!isSnipOcrModalOpen) return;
    if (!hasWinRt) {
      setLanguages(TESSERACT_FALLBACK_LANGUAGES);
      if (!TESSERACT_FALLBACK_LANGUAGES.some((l) => l.tag === selectedLang)) {
        setSelectedLang('tur+eng');
      }
      setLangLoaded(true);
      return;
    }
    if (langLoaded || !electron?.winrtOcrGetLanguages) return;

    electron
      .winrtOcrGetLanguages()
      .then((res) => {
        if (res?.success && Array.isArray(res.languages) && res.languages.length > 0) {
          const valid = res.languages.filter((l): l is OcrLang => Boolean(l && l.tag));
          if (valid.length > 0) {
            setLanguages(valid);
            const tr = valid.find((l) => l.tag.toLowerCase().startsWith('tr'));
            const en = valid.find((l) => l.tag.toLowerCase().startsWith('en'));
            setSelectedLang((tr || en || valid[0]).tag);
          }
        } else {
          setLanguages(TESSERACT_FALLBACK_LANGUAGES);
          setSelectedLang('tur+eng');
        }
        setLangLoaded(true);
      })
      .catch(() => {
        setLanguages(TESSERACT_FALLBACK_LANGUAGES);
        setSelectedLang('tur+eng');
        setLangLoaded(true);
      });
  }, [isSnipOcrModalOpen, hasWinRt, langLoaded, electron, selectedLang]);

  // Render preview page on canvas
  useEffect(() => {
    if (!isSnipOcrModalOpen || !pdfDocProxy || !canvasRef.current) return;
    let cancelled = false;

    const renderPage = async () => {
      setPageRendered(false);
      setState('idle');
      setSelection(null);
      setDragStart(null);

      try {
        const page = await pdfDocProxy.getPage(modalPageIndex + 1);
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        const container = containerRef.current;
        const containerW = container ? container.clientWidth - 420 : 600;
        const containerH = container ? container.clientHeight - 160 : 450;

        const vp1 = page.getViewport({ scale: 1 });
        const scaleW = Math.max(0.2, (containerW || 600) / vp1.width);
        const scaleH = Math.max(0.2, (containerH || 450) / vp1.height);
        const scale = Math.min(scaleW, scaleH, 1.8);

        const vp = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.floor(vp.width));
        canvas.height = Math.max(1, Math.floor(vp.height));

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        if (!cancelled) setPageRendered(true);
      } catch {
        if (!cancelled) {
          setOcrError('Sayfa render edilemedi.');
          setState('error');
        }
      }
    };

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [isSnipOcrModalOpen, pdfDocProxy, modalPageIndex]);

  const mapTagToTesseractLang = (tag: string): OcrLanguage => {
    const low = tag.toLowerCase();
    if (low === 'tur+eng' || low === 'tur' || low === 'eng' || low === 'deu' || low === 'fra') {
      return low as OcrLanguage;
    }
    if (low.startsWith('tr')) return 'tur+eng';
    if (low.startsWith('de')) return 'deu';
    if (low.startsWith('fr')) return 'fra';
    if (low.startsWith('en')) return 'eng';
    return 'tur+eng';
  };

  // High-DPI Region Canvas Helper (caller MUST release returned canvas!)
  const renderRegionCanvas = useCallback(
    async (
      pageIdx: number,
      sel: SelectionRect
    ): Promise<{
      cropCanvas: HTMLCanvasElement;
      rx: number;
      ry: number;
      rw: number;
      rh: number;
      renderScale: number;
    } | null> => {
      if (!pdfDocProxy || !canvasRef.current) return null;
      const page = await pdfDocProxy.getPage(pageIdx + 1);
      const previewCanvas = canvasRef.current;
      const canvasW = previewCanvas.offsetWidth || previewCanvas.width;
      const canvasH = previewCanvas.offsetHeight || previewCanvas.height;
      if (canvasW <= 0 || canvasH <= 0) return null;

      const highScale = 2.5;
      const vp = page.getViewport({ scale: highScale });

      const rx = Math.max(0, Math.min(1, sel.x / canvasW));
      const ry = Math.max(0, Math.min(1, sel.y / canvasH));
      const rw = Math.max(0.005, Math.min(1 - rx, sel.w / canvasW));
      const rh = Math.max(0.005, Math.min(1 - ry, sel.h / canvasH));

      const sx = Math.max(0, Math.floor(rx * vp.width));
      const sy = Math.max(0, Math.floor(ry * vp.height));
      const sw = Math.min(Math.floor(vp.width) - sx, Math.max(10, Math.floor(rw * vp.width)));
      const sh = Math.min(Math.floor(vp.height) - sy, Math.max(10, Math.floor(rh * vp.height)));

      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = Math.max(1, Math.floor(vp.width));
      fullCanvas.height = Math.max(1, Math.floor(vp.height));

      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = Math.max(1, sw);
      cropCanvas.height = Math.max(1, sh);

      try {
        const fullCtx = fullCanvas.getContext('2d');
        if (!fullCtx) return null;
        await page.render({ canvasContext: fullCtx, viewport: vp }).promise;

        const cropCtx = cropCanvas.getContext('2d');
        if (!cropCtx) return null;
        cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

        return { cropCanvas, rx, ry, rw, rh, renderScale: highScale };
      } finally {
        fullCanvas.width = 0;
        fullCanvas.height = 0;
      }
    },
    [pdfDocProxy]
  );

  // High-DPI Full Page Canvas Helper
  const renderFullPageDataUrl = async (
    pageIdx: number
  ): Promise<{ dataUrl: string; width: number; height: number; renderScale: number } | null> => {
    if (!pdfDocProxy) return null;
    const page = await pdfDocProxy.getPage(pageIdx + 1);
    const highScale = 2.2;
    const vp = page.getViewport({ scale: highScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width));
    canvas.height = Math.max(1, Math.floor(vp.height));

    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      return {
        dataUrl: canvas.toDataURL('image/png'),
        width: canvas.width,
        height: canvas.height,
        renderScale: highScale,
      };
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  };

  // 1. Run Region OCR (WinRT on win32, Tesseract fallback everywhere else)
  const runRegionOcr = useCallback(
    async (sel: SelectionRect) => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setState('processing');
      setOcrError('');
      setBatchCancelledNotice(false);
      setLastPageResults([]);

      let cropCanvas: HTMLCanvasElement | null = null;
      try {
        const rendered = await renderRegionCanvas(modalPageIndex, sel);
        if (!rendered || controller.signal.aborted) {
          setOcrError('Seçilen bölge yüksek çözünürlükte işlenemedi.');
          setState('error');
          return;
        }
        cropCanvas = rendered.cropCanvas;

        if (hasWinRt && electron?.winrtOcrRegion && languages.some((l) => l.tag === selectedLang)) {
          const dataUrl = cropCanvas.toDataURL('image/png');
          const imgW = cropCanvas.width;
          const imgH = cropCanvas.height;
          cropCanvas.width = 0;
          cropCanvas.height = 0;
          cropCanvas = null;

          const result = await electron.winrtOcrRegion(dataUrl, selectedLang);
          if (controller.signal.aborted) return;

          if (result?.success) {
            const text = (result.text || '').trim();
            if (text) {
              const pageRes = mapWinRtLinesToOcrPageResult(
                modalPageIndex + 1,
                text,
                result.lines,
                imgW,
                imgH,
                rendered.renderScale,
                {
                  rx: rendered.rx,
                  ry: rendered.ry,
                  rw: rendered.rw,
                  rh: rendered.rh,
                }
              );
              setLastPageResults([pageRes]);
              setOcrText(text);
              setState('done');
            } else {
              setOcrError(
                'Seçilen alanda algılanabilir metin bulunamadı. Lütfen yazıları tam içine alacak şekilde tekrar deneyin.'
              );
              setState('error');
            }
          } else {
            setOcrError(result?.error || 'OCR işlemi başarısız oldu.');
            setState('error');
          }
        } else {
          // Tesseract Fallback
          const tessLang = mapTagToTesseractLang(selectedLang);
          const rawRegionRes = await OcrService.recognizeCanvas(
            cropCanvas,
            '',
            modalPageIndex + 1,
            tessLang,
            '6',
            undefined,
            controller.signal,
            rendered.renderScale
          );
          if (controller.signal.aborted) return;

          const text = (rawRegionRes.text || '').trim();
          if (text) {
            const mapped = remapPageResultToRegion(
              rawRegionRes,
              rendered.rx,
              rendered.ry,
              rendered.rw,
              rendered.rh
            );
            setLastPageResults([mapped]);
            setOcrText(text);
            setState('done');
          } else {
            setOcrError(
              'Seçilen alanda algılanabilir metin bulunamadı. Lütfen yazıları tam içine alacak şekilde tekrar deneyin.'
            );
            setState('error');
          }
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setOcrError(err instanceof Error ? err.message : String(err));
        setState('error');
      } finally {
        if (cropCanvas) {
          cropCanvas.width = 0;
          cropCanvas.height = 0;
        }
      }
    },
    [modalPageIndex, hasWinRt, electron, languages, selectedLang, renderRegionCanvas]
  );

  // 2. Run Current Page OCR
  const runCurrentPageOcr = async () => {
    if (!pdfDocProxy) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setScanMode('current-page');
    setSelection(null);
    setState('processing');
    setOcrError('');
    setOcrText('');
    setBatchCancelledNotice(false);
    setLastPageResults([]);

    try {
      if (hasWinRt && electron?.winrtOcrRegion && languages.some((l) => l.tag === selectedLang)) {
        const rendered = await renderFullPageDataUrl(modalPageIndex);
        if (!rendered || controller.signal.aborted) {
          setOcrError('Sayfa görüntüsü yakalanamadı.');
          setState('error');
          return;
        }

        const result = await electron.winrtOcrRegion(rendered.dataUrl, selectedLang);
        if (controller.signal.aborted) return;

        if (result?.success) {
          const text = (result.text || '').trim();
          if (text) {
            const pageRes = mapWinRtLinesToOcrPageResult(
              modalPageIndex + 1,
              text,
              result.lines,
              rendered.width,
              rendered.height,
              rendered.renderScale
            );
            setLastPageResults([pageRes]);
            setOcrText(text);
            setState('done');
          } else {
            setOcrError(`Sayfa ${modalPageIndex + 1}'de algılanabilir metin bulunamadı.`);
            setState('error');
          }
        } else {
          setOcrError(result?.error || 'OCR işlemi başarısız oldu.');
          setState('error');
        }
      } else {
        const tessLang = mapTagToTesseractLang(selectedLang);
        const docRes = await OcrService.processDocumentPages(
          pdfDocProxy,
          [modalPageIndex + 1],
          tessLang,
          'smart',
          '3',
          undefined,
          { signal: controller.signal, scale: 2.5, includePreview: false }
        );
        if (controller.signal.aborted) return;
        const pageRes = docRes.pages[0];
        const text = (pageRes?.text || '').trim();
        if (text) {
          setLastPageResults([pageRes]);
          setOcrText(text);
          setState('done');
        } else {
          setOcrError(`Sayfa ${modalPageIndex + 1}'de algılanabilir metin bulunamadı.`);
          setState('error');
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setOcrError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  };

  // 3. Run All Pages OCR (WinRT + Tesseract Fallback + Abortable)
  const runAllPagesOcr = async () => {
    if (!pdfDocProxy) return;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setScanMode('all-pages');
    setSelection(null);
    setState('processing');
    setBatchProgress({ current: 1, total: totalPages, percent: 0 });
    setOcrText('');
    setOcrError('');
    setBatchCancelledNotice(false);
    setLastPageResults([]);

    const collectedResults: OcrPageResult[] = [];
    const textChunks: string[] = [];
    let wasCancelled = false;

    try {
      if (hasWinRt && electron?.winrtOcrRegion && languages.some((l) => l.tag === selectedLang)) {
        for (let i = 1; i <= totalPages; i++) {
          if (controller.signal.aborted) {
            wasCancelled = true;
            break;
          }

          setBatchProgress({
            current: i,
            total: totalPages,
            percent: Math.round(((i - 1) / totalPages) * 100),
          });

          try {
            const rendered = await renderFullPageDataUrl(i - 1);
            if (controller.signal.aborted) {
              wasCancelled = true;
              break;
            }
            if (rendered) {
              const result = await electron.winrtOcrRegion(rendered.dataUrl, selectedLang);
              if (controller.signal.aborted) {
                wasCancelled = true;
                break;
              }
              const pageTxt = (result?.text || '').trim();
              if (pageTxt) {
                collectedResults.push(
                  mapWinRtLinesToOcrPageResult(
                    i,
                    pageTxt,
                    result?.lines,
                    rendered.width,
                    rendered.height,
                    rendered.renderScale
                  )
                );
              }
              textChunks.push(
                `=== SAYFA ${i} ===\n${pageTxt || '(Bu sayfada metin bulunamadı)'}`
              );
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            textChunks.push(`=== SAYFA ${i} ===\n[Hata: ${msg}]`);
          }
        }
      } else {
        const tessLang = mapTagToTesseractLang(selectedLang);
        const pageNums = Array.from({ length: totalPages }, (_, idx) => idx + 1);
        const docRes = await OcrService.processDocumentPages(
          pdfDocProxy,
          pageNums,
          tessLang,
          'smart',
          '3',
          (prog) => {
            if (!controller.signal.aborted) {
              setBatchProgress({
                current: prog.currentPage,
                total: prog.totalPages,
                percent: prog.overallProgress,
              });
            }
          },
          { signal: controller.signal, scale: 2.5, includePreview: false }
        );
        for (const pRes of docRes.pages) {
          collectedResults.push(pRes);
          textChunks.push(
            `=== SAYFA ${pRes.pageNumber} ===\n${pRes.text.trim() || '(Bu sayfada metin bulunamadı)'}`
          );
        }
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'AbortError') {
        wasCancelled = true;
      } else {
        setBatchProgress(null);
        setOcrError(err instanceof Error ? err.message : String(err));
        setState('error');
        return;
      }
    }

    setBatchProgress(null);
    const combined = textChunks.join('\n\n').trim();

    if (wasCancelled) {
      setBatchCancelledNotice(true);
      if (collectedResults.length === 0 && !combined) {
        setState('idle');
        addToast('Tarama durduruldu.', 'info');
        return;
      }
    }

    if (combined) {
      setLastPageResults(collectedResults);
      setOcrText(combined);
      setState('done');
    } else {
      setOcrError('Belgedeki sayfalarda okunabilir metin bulunamadı.');
      setState('error');
    }
  };

  const handleCancelBatch = () => {
    abortControllerRef.current?.abort();
  };

  // ─── Mouse Drag Selection (bound to window during drag) ────────────────────
  const getRelativeClientPos = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(clientX - rect.left, canvas.offsetWidth)),
      y: Math.max(0, Math.min(clientY - rect.top, canvas.offsetHeight)),
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!pageRendered || state === 'processing' || scanMode !== 'region') return;
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = getRelativeClientPos(e.clientX, e.clientY);
    setDragStart(pos);
    const initialSel = { x: pos.x, y: pos.y, w: 0, h: 0 };
    selectionRef.current = initialSel;
    setSelection(initialSel);
    setState('selecting');
    setOcrText('');
    setOcrError('');
    setBatchCancelledNotice(false);
    setCopied(false);
    setInserted(false);
  };

  useEffect(() => {
    if (state !== 'selecting' || !dragStart || scanMode !== 'region') return;

    const onWindowMouseMove = (e: MouseEvent) => {
      const pos = getRelativeClientPos(e.clientX, e.clientY);
      const nextSel: SelectionRect = {
        x: Math.min(dragStart.x, pos.x),
        y: Math.min(dragStart.y, pos.y),
        w: Math.abs(pos.x - dragStart.x),
        h: Math.abs(pos.y - dragStart.y),
      };
      selectionRef.current = nextSel;
      setSelection(nextSel);
    };

    const onWindowMouseUp = () => {
      const finalSel = selectionRef.current;
      setDragStart(null);

      if (!finalSel || finalSel.w < MIN_SELECTION || finalSel.h < MIN_SELECTION) {
        setState('idle');
        setSelection(null);
        return;
      }

      setState('selected');
      runRegionOcr(finalSel);
    };

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [state, dragStart, scanMode, getRelativeClientPos, runRegionOcr]);

  const handleCopy = () => {
    if (!ocrText) return;
    navigator.clipboard.writeText(ocrText).then(() => {
      setCopied(true);
      addToast('Metin panoya kopyalandı!', 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownloadTxt = () => {
    if (!ocrText) return;
    const blob = new Blob([ocrText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentDocument?.name.replace(/\.pdf$/i, '') || 'belge'}_ocr.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    addToast('TXT dosyası olarak indirildi.', 'success', 2000);
  };

  // Insert recognized text using OcrTextTransfer cleanly
  const handleInsertToPage = () => {
    if (!currentDocument || !ocrText.trim()) return;

    const transferOptions = {
      mode: 'paragraph' as const,
      hideOriginalScan: false,
      fontSizeMultiplier: 1.0,
      fontColor: '#0f172a',
      fontFamily: 'Helvetica, Arial, sans-serif',
    };

    if (scanMode === 'all-pages' && lastPageResults.length > 0) {
      const res = OcrTextTransfer.transferMultiplePages(lastPageResults, transferOptions);
      if (res.success) {
        setInserted(true);
        addToast(
          `${res.pagesAffected} sayfaya ${res.totalCount} metin bloğu aktarıldı!`,
          'success',
          2500
        );
        setTimeout(() => setInserted(false), 2000);
      } else {
        addToast('Sayfalara aktarılacak metin bulunamadı.', 'warning');
      }
      return;
    }

    let pageResult = lastPageResults[0];
    const activePage = currentDocument.pages[modalPageIndex];
    if (!pageResult && activePage) {
      const cw = canvasRef.current?.offsetWidth || activePage.width;
      const ch = canvasRef.current?.offsetHeight || activePage.height;
      const sel = selection;
      const normX = sel ? sel.x / cw : 0.08;
      const normY = sel ? sel.y / ch : 0.08;
      const normW = sel ? Math.max(0.1, sel.w / cw) : 0.84;
      const normH = sel ? Math.max(0.04, sel.h / ch) : 0.25;

      pageResult = {
        pageNumber: modalPageIndex + 1,
        text: ocrText.trim(),
        confidence: 90,
        words: [],
        lines: [],
        paragraphs: [
          {
            text: ocrText.trim(),
            confidence: 90,
            bbox: {
              x0: normX * activePage.width,
              y0: normY * activePage.height,
              x1: (normX + normW) * activePage.width,
              y1: (normY + normH) * activePage.height,
            },
            normBbox: { x: normX, y: normY, width: normW, height: normH },
            lines: [],
            estimatedFontSize: 12,
            isBold: false,
          },
        ],
        width: activePage.width,
        height: activePage.height,
        renderScale: 1,
        previewUrl: '',
      };
    }

    if (!pageResult) {
      addToast('Aktif sayfa bulunamadı.', 'error');
      return;
    }

    const res = OcrTextTransfer.transferSinglePage(pageResult, transferOptions, ocrText);
    if (res.success) {
      setInserted(true);
      addToast(
        `Sayfa ${pageResult.pageNumber}'e ${res.count} düzenlenebilir metin bloğu aktarıldı!`,
        'success',
        2500
      );
      setTimeout(() => setInserted(false), 2000);
    } else {
      addToast('Sayfaya aktarılacak metin bulunamadı.', 'warning');
    }
  };

  const handleReselect = () => {
    abortControllerRef.current?.abort();
    setSelection(null);
    setDragStart(null);
    setState('idle');
    setOcrText('');
    setOcrError('');
    setBatchCancelledNotice(false);
    setLastPageResults([]);
    setCopied(false);
    setInserted(false);
    setScanMode('region');
  };

  if (!isSnipOcrModalOpen) return null;

  const selectionBoxStyle: React.CSSProperties = selection
    ? {
        position: 'absolute',
        left: selection.x,
        top: selection.y,
        width: selection.w,
        height: selection.h,
        border: '2px dashed #0ea5e9',
        backgroundColor: 'rgba(14, 165, 233, 0.08)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }
    : {};

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/75 backdrop-blur-xs select-none">
      <div
        ref={containerRef}
        className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800"
        style={{ width: '94vw', maxWidth: 1160, height: '90vh', maxHeight: 860 }}
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 shrink-0 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Crosshair className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                  Bölge & Sayfa OCR Stüdyosu
                </h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300/50 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-sky-500" />{' '}
                  {hasWinRt ? 'Windows.Media.Ocr' : 'Tesseract Neural OCR'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Ekran alıntısı tarzında kırpın veya sayfaları yüksek çözünürlükte tarayın
              </p>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setScanMode('region');
                setSelection(null);
                setState('idle');
              }}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all',
                scanMode === 'region'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Bölge Seç (Kırp)</span>
            </button>

            <button
              type="button"
              onClick={runCurrentPageOcr}
              disabled={state === 'processing'}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50',
                scanMode === 'current-page'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Bu Sayfayı Tara</span>
            </button>

            <button
              type="button"
              onClick={runAllPagesOcr}
              disabled={state === 'processing'}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all disabled:opacity-50',
                scanMode === 'all-pages'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Tüm PDF&apos;i Tara</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <Languages className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                disabled={state === 'processing'}
                className="text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-sky-500 cursor-pointer disabled:opacity-50"
              >
                {languages.map((l) => (
                  <option key={l.tag} value={l.tag}>
                    {l.name} ({l.tag})
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => {
                abortControllerRef.current?.abort();
                setSnipOcrModalOpen(false);
              }}
              aria-label="Kapat"
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Content Split */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Canvas Preview Area */}
          <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-950 relative overflow-hidden border-r border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between px-4 py-2 bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sky-600 dark:text-sky-400">
                  {scanMode === 'region' && 'Fareyle metin alanını dikdörtgen içine alın'}
                  {scanMode === 'current-page' && `Sayfa ${modalPageIndex + 1} Taranıyor`}
                  {scanMode === 'all-pages' && 'Tüm Belge Çoklu Sayfa Taraması'}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setModalPageIndex((p) => Math.max(0, p - 1))}
                  disabled={modalPageIndex === 0 || state === 'processing'}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  title="Önceki Sayfa"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 min-w-[75px] text-center">
                  Sayfa {modalPageIndex + 1} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setModalPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={modalPageIndex >= totalPages - 1 || state === 'processing'}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  title="Sonraki Sayfa"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              className={cn(
                'flex-1 flex items-center justify-center p-4 overflow-auto',
                scanMode === 'region' && 'cursor-crosshair'
              )}
              onMouseDown={handleMouseDown}
            >
              <div className="relative inline-block shadow-lg rounded-sm overflow-hidden bg-white">
                <canvas ref={canvasRef} className="block select-none" />

                {/* Full 4-quadrant dim overlay around selection rectangle */}
                {scanMode === 'region' && selection && (
                  <>
                    <div
                      className="absolute left-0 right-0 top-0 bg-black/50 pointer-events-none"
                      style={{ height: selection.y }}
                    />
                    <div
                      className="absolute left-0 right-0 bottom-0 bg-black/50 pointer-events-none"
                      style={{ top: selection.y + selection.h }}
                    />
                    <div
                      className="absolute left-0 bg-black/50 pointer-events-none"
                      style={{
                        top: selection.y,
                        height: selection.h,
                        width: selection.x,
                      }}
                    />
                    <div
                      className="absolute right-0 bg-black/50 pointer-events-none"
                      style={{
                        top: selection.y,
                        height: selection.h,
                        left: selection.x + selection.w,
                      }}
                    />
                  </>
                )}

                {/* Selection dashed rectangle */}
                {scanMode === 'region' && selection && (
                  <div style={selectionBoxStyle}>
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                    <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                  </div>
                )}
              </div>
            </div>

            {batchProgress && (
              <div className="p-3 bg-sky-50 dark:bg-sky-950/80 border-t border-sky-200 dark:border-sky-800 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-sky-800 dark:text-sky-300 mb-1">
                    <span>
                      Tüm Belge Taranıyor (Sayfa {batchProgress.current} / {batchProgress.total})
                    </span>
                    <span>%{batchProgress.percent}</span>
                  </div>
                  <div className="w-full h-2 bg-sky-200 dark:bg-sky-900 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-sky-500 transition-all duration-200"
                      style={{ width: `${batchProgress.percent}%` }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCancelBatch}
                  className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-semibold flex items-center gap-1.5 shrink-0 transition-colors shadow-xs"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Durdur</span>
                </button>
              </div>
            )}
          </div>

          {/* Right OCR Result Panel */}
          <div className="w-96 flex flex-col bg-white dark:bg-slate-900 shrink-0">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-sky-500" />
                Tanınan Metin
              </span>
              {ocrText && (
                <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-300/40">
                  {ocrText.split(/\s+/).filter(Boolean).length} kelime
                </span>
              )}
            </div>

            {batchCancelledNotice && (
              <div className="mx-3 mt-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-[11px] text-amber-700 dark:text-amber-300">
                Tarama durduruldu — yalnızca tamamlanan sayfaların sonuçları gösteriliyor.
              </div>
            )}

            <div className="flex-1 p-3 flex flex-col relative overflow-hidden">
              {state === 'processing' && !batchProgress ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    {hasWinRt ? 'Windows OCR çalışıyor...' : 'Tesseract OCR çalışıyor...'}
                  </p>
                  <p className="text-[11px] text-slate-400 text-center max-w-[200px]">
                    Görüntü yüksek çözünürlükte işleniyor
                  </p>
                </div>
              ) : state === 'error' ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-rose-500 p-4 text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-rose-500" />
                  </div>
                  <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                    {ocrError}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      type="button"
                      onClick={handleReselect}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-200 transition-colors"
                    >
                      Tekrar Dene
                    </button>
                    <button
                      type="button"
                      onClick={runCurrentPageOcr}
                      className="px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-600 text-white text-xs font-semibold transition-colors"
                    >
                      Tüm Sayfayı Tara
                    </button>
                  </div>
                </div>
              ) : ocrText ? (
                <textarea
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  className="flex-1 w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 text-xs font-mono leading-relaxed resize-none focus:outline-hidden focus:ring-2 focus:ring-sky-500"
                  placeholder="Tanınan metin burada görüntülenecektir..."
                />
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-slate-400 p-4 text-center">
                  <Info className="w-8 h-8 text-slate-300 dark:text-slate-700" />
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Henüz bir alan taranmadı
                  </p>
                  <p className="text-[11px] text-slate-400 leading-relaxed max-w-[220px]">
                    Sol taraftaki sayfadan fare ile bir metin alanını seçin veya yukarıdaki{' '}
                    <b>&quot;Bu Sayfayı Tara&quot;</b> butonuna basın.
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2 bg-slate-50 dark:bg-slate-950/60">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  disabled={!ocrText}
                  className={cn(
                    'py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs',
                    copied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-sky-500 hover:bg-sky-600 text-white disabled:opacity-40'
                  )}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Kopyalandı!' : 'Panoya Kopyala'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleInsertToPage}
                  disabled={!ocrText}
                  className={cn(
                    'py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs border',
                    inserted
                      ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 border-emerald-400'
                      : 'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 disabled:opacity-40'
                  )}
                >
                  {inserted ? (
                    <Check className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Type className="w-4 h-4 text-sky-500" />
                  )}
                  <span>{inserted ? 'Eklendi!' : 'Sayfaya Ekle'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleDownloadTxt}
                  disabled={!ocrText}
                  className="py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>TXT İndir</span>
                </button>

                <button
                  type="button"
                  onClick={handleReselect}
                  disabled={state === 'processing'}
                  className="py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Sıfırla</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
