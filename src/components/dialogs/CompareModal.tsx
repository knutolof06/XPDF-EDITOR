import React, { useState, useRef, useEffect, useCallback } from 'react';
import type * as pdfjsLib from 'pdfjs-dist';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { PageView } from '../viewer/PageView';
import {
  X,
  Columns,
  Lock,
  Unlock,
  Plus,
  ZoomIn,
  ZoomOut,
  FileDiff,
  Eye,
  Loader2,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useModalEscape } from './modal-utils';

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  text: string;
}

async function extractPageLines(
  proxy: pdfjsLib.PDFDocumentProxy | undefined,
  pageIndex: number
): Promise<string[]> {
  if (!proxy || pageIndex < 0 || pageIndex >= proxy.numPages) return [];
  const page = await proxy.getPage(pageIndex + 1);
  const content = await page.getTextContent();
  const items = (content.items as Array<{ str?: string; transform?: number[]; width?: number }>)
    .filter((item) => typeof item.str === 'string' && item.str.trim().length > 0 && Array.isArray(item.transform));

  items.sort((a, b) => {
    const yDiff = (b.transform?.[5] ?? 0) - (a.transform?.[5] ?? 0);
    if (Math.abs(yDiff) > 4) return yDiff;
    return (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0);
  });

  const lines: string[] = [];
  let currentLine = '';
  let lastY: number | null = null;
  let lastX: number | null = null;

  for (const item of items) {
    const cx = item.transform?.[4] ?? 0;
    const cy = item.transform?.[5] ?? 0;
    const str = item.str || '';

    if (lastY !== null && Math.abs(lastY - cy) > 6) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = str;
    } else {
      if (lastX !== null && cx - lastX > 3 && !currentLine.endsWith(' ')) {
        currentLine += ' ';
      }
      currentLine += str;
    }
    lastY = cy;
    lastX = cx + (item.width || 0);
  }
  if (currentLine.trim()) lines.push(currentLine.trim());
  return lines;
}

function computeLineDiff(linesA: string[], linesB: string[]): DiffLine[] {
  const m = linesA.length;
  const n = linesB.length;
  // Guard huge single-page line arrays with quick linear fallback
  if (m * n > 250000) {
    const out: DiffLine[] = [];
    const setB = new Set(linesB);
    const setA = new Set(linesA);
    linesA.forEach((l) => out.push({ type: setB.has(l) ? 'unchanged' : 'removed', text: l }));
    linesB.forEach((l) => {
      if (!setA.has(l)) out.push({ type: 'added', text: l });
    });
    return out;
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (linesA[i - 1] === linesB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && linesA[i - 1] === linesB[j - 1]) {
      result.push({ type: 'unchanged', text: linesA[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'added', text: linesB[j - 1] });
      j--;
    } else {
      result.push({ type: 'removed', text: linesA[i - 1] });
      i--;
    }
  }
  return result.reverse();
}

export const CompareModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { tabs, addTab } = useTabStore();
  const { addToast } = useUIStore();

  const [docAIndex, setDocAIndex] = useState(0);
  const [docBIndex, setDocBIndex] = useState(0);
  const [pageA, setPageA] = useState(0);
  const [pageB, setPageB] = useState(0);
  const [syncScroll, setSyncScroll] = useState(true);
  const [zoom, setZoom] = useState(0.75);
  const [compareMode, setCompareMode] = useState<'side-by-side' | 'text-diff' | 'visual-diff'>('side-by-side');
  const [onlyDiffLines, setOnlyDiffLines] = useState(false);

  const [textDiffLines, setTextDiffLines] = useState<DiffLine[]>([]);
  const [isDiffComputing, setIsDiffComputing] = useState(false);
  const [visualDiffPct, setVisualDiffPct] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileTargetSideRef = useRef<'A' | 'B'>('B');
  const paneARef = useRef<HTMLDivElement>(null);
  const paneBRef = useRef<HTMLDivElement>(null);
  const visualDiffCanvasRef = useRef<HTMLCanvasElement>(null);
  const isSyncingScrollRef = useRef(false);

  useModalEscape(isOpen, onClose);

  // Sync & clamp doc indices whenever modal opens or tabs count changes
  useEffect(() => {
    if (!isOpen) return;
    if (tabs.length === 0) {
      setDocAIndex(0);
      setDocBIndex(0);
      setPageA(0);
      setPageB(0);
      return;
    }
    setDocAIndex((prev) => Math.max(0, Math.min(prev, tabs.length - 1)));
    setDocBIndex((prev) => {
      if (tabs.length > 1 && prev === 0) return 1;
      return Math.max(0, Math.min(prev, tabs.length - 1));
    });
  }, [isOpen, tabs.length]);

  const docA = tabs[docAIndex]?.model;
  const docB = tabs[docBIndex]?.model;
  const proxyA = tabs[docAIndex]?.pdfDocProxy;
  const proxyB = tabs[docBIndex]?.pdfDocProxy;

  // Clamp page indices if selected doc shrinks or changes
  useEffect(() => {
    if (docA && pageA >= docA.pages.length) setPageA(Math.max(0, docA.pages.length - 1));
  }, [docA, pageA]);

  useEffect(() => {
    if (docB && pageB >= docB.pages.length) setPageB(Math.max(0, docB.pages.length - 1));
  }, [docB, pageB]);

  // Compute text diff when in text-diff mode
  useEffect(() => {
    if (!isOpen || compareMode !== 'text-diff' || !proxyA || !proxyB) {
      return;
    }
    let cancelled = false;
    setIsDiffComputing(true);
    Promise.all([extractPageLines(proxyA, pageA), extractPageLines(proxyB, pageB)])
      .then(([linesA, linesB]) => {
        if (cancelled) return;
        setTextDiffLines(computeLineDiff(linesA, linesB));
      })
      .catch((err) => {
        console.warn('Text diff error:', err);
        if (!cancelled) setTextDiffLines([]);
      })
      .finally(() => {
        if (!cancelled) setIsDiffComputing(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, compareMode, proxyA, proxyB, pageA, pageB]);

  // Compute pixel-difference overlay canvas when in visual-diff mode
  useEffect(() => {
    if (!isOpen || compareMode !== 'visual-diff' || !proxyA || !proxyB || !docA || !docB) {
      return;
    }
    let cancelled = false;
    setIsDiffComputing(true);
    setVisualDiffPct(null);

    const runVisualDiff = async () => {
      const offA = document.createElement('canvas');
      const offB = document.createElement('canvas');
      try {
        const pgA = await proxyA.getPage(pageA + 1);
        const pgB = await proxyB.getPage(pageB + 1);
        if (cancelled) return;

        const rotA = docA.pages[pageA]?.rotation ?? 0;
        const rotB = docB.pages[pageB]?.rotation ?? 0;
        const vpA = pgA.getViewport({ scale: zoom, rotation: rotA });
        const vpB = pgB.getViewport({ scale: zoom, rotation: rotB });

        const width = Math.max(1, Math.floor(Math.max(vpA.width, vpB.width)));
        const height = Math.max(1, Math.floor(Math.max(vpA.height, vpB.height)));

        offA.width = width;
        offA.height = height;
        offB.width = width;
        offB.height = height;

        const ctxA = offA.getContext('2d', { alpha: false });
        const ctxB = offB.getContext('2d', { alpha: false });
        if (!ctxA || !ctxB) return;

        ctxA.fillStyle = '#ffffff';
        ctxA.fillRect(0, 0, width, height);
        ctxB.fillStyle = '#ffffff';
        ctxB.fillRect(0, 0, width, height);

        await Promise.all([
          pgA.render({ canvasContext: ctxA, viewport: vpA }).promise,
          pgB.render({ canvasContext: ctxB, viewport: vpB }).promise,
        ]);
        if (cancelled) return;

        const dataA = ctxA.getImageData(0, 0, width, height).data;
        const dataB = ctxB.getImageData(0, 0, width, height).data;

        const outCanvas = visualDiffCanvasRef.current;
        if (!outCanvas) return;
        outCanvas.width = width;
        outCanvas.height = height;
        const outCtx = outCanvas.getContext('2d');
        if (!outCtx) return;

        const outImg = outCtx.createImageData(width, height);
        const outData = outImg.data;
        let diffPixels = 0;
        const totalPixels = width * height;

        for (let idx = 0; idx < dataA.length; idx += 4) {
          const dr = Math.abs(dataA[idx] - dataB[idx]);
          const dg = Math.abs(dataA[idx + 1] - dataB[idx + 1]);
          const db = Math.abs(dataA[idx + 2] - dataB[idx + 2]);

          if (dr + dg + db > 45) {
            diffPixels++;
            outData[idx] = 239;
            outData[idx + 1] = 48;
            outData[idx + 2] = 48;
            outData[idx + 3] = 235;
          } else {
            // Soft washed-out grayscale backdrop of Page B for easy visual context
            const lum = Math.round(0.299 * dataB[idx] + 0.587 * dataB[idx + 1] + 0.114 * dataB[idx + 2]);
            const muted = Math.min(255, Math.round(lum * 0.4 + 150));
            outData[idx] = muted;
            outData[idx + 1] = muted;
            outData[idx + 2] = muted;
            outData[idx + 3] = 255;
          }
        }

        outCtx.putImageData(outImg, 0, 0);
        setVisualDiffPct(Number(((diffPixels / totalPixels) * 100).toFixed(2)));
      } catch (err) {
        console.warn('Visual diff error:', err);
      } finally {
        offA.width = 0;
        offA.height = 0;
        offB.width = 0;
        offB.height = 0;
        if (!cancelled) setIsDiffComputing(false);
      }
    };

    runVisualDiff();

    return () => {
      cancelled = true;
    };
  }, [isOpen, compareMode, proxyA, proxyB, docA, docB, pageA, pageB, zoom]);

  const handlePaneScroll = useCallback(
    (source: 'A' | 'B') => {
      if (!syncScroll || isSyncingScrollRef.current) return;
      const srcEl = source === 'A' ? paneARef.current : paneBRef.current;
      const dstEl = source === 'A' ? paneBRef.current : paneARef.current;
      if (!srcEl || !dstEl) return;

      isSyncingScrollRef.current = true;
      const maxSrcY = Math.max(1, srcEl.scrollHeight - srcEl.clientHeight);
      const maxDstY = Math.max(0, dstEl.scrollHeight - dstEl.clientHeight);
      const ratioY = srcEl.scrollTop / maxSrcY;
      dstEl.scrollTop = ratioY * maxDstY;

      const maxSrcX = Math.max(1, srcEl.scrollWidth - srcEl.clientWidth);
      const maxDstX = Math.max(0, dstEl.scrollWidth - dstEl.clientWidth);
      const ratioX = srcEl.scrollLeft / maxSrcX;
      dstEl.scrollLeft = ratioX * maxDstX;

      requestAnimationFrame(() => {
        isSyncingScrollRef.current = false;
      });
    },
    [syncScroll]
  );

  if (!isOpen) return null;

  const handleNextPageA = () => {
    if (docA && pageA < docA.pages.length - 1) {
      setPageA(pageA + 1);
      if (syncScroll && docB && pageB < docB.pages.length - 1) setPageB(pageB + 1);
    }
  };

  const handlePrevPageA = () => {
    if (pageA > 0) {
      setPageA(pageA - 1);
      if (syncScroll && pageB > 0) setPageB(pageB - 1);
    }
  };

  const handleNextPageB = () => {
    if (docB && pageB < docB.pages.length - 1) {
      setPageB(pageB + 1);
      if (syncScroll && docA && pageA < docA.pages.length - 1) setPageA(pageA + 1);
    }
  };

  const handlePrevPageB = () => {
    if (pageB > 0) {
      setPageB(pageB - 1);
      if (syncScroll && pageA > 0) setPageA(pageA - 1);
    }
  };

  const triggerPickPdfFor = (side: 'A' | 'B') => {
    fileTargetSideRef.current = side;
    fileInputRef.current?.click();
  };

  const handleLoadNewPdfForComparison = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      addToast(`"${file.name}" karşılaştırma için yükleniyor...`, 'info');
      const arrayBuffer = await file.arrayBuffer();
      const { model, pdfDoc } = await PdfLoader.loadDocument(file.name, arrayBuffer);
      const newTabIdx = useTabStore.getState().tabs.length;
      addTab(model, pdfDoc);
      if (fileTargetSideRef.current === 'A') {
        setDocAIndex(newTabIdx);
        setPageA(0);
      } else {
        setDocBIndex(newTabIdx);
        setPageB(0);
      }
      addToast(`"${file.name}" yüklendi.`, 'success');
    } catch (err: unknown) {
      console.error(err);
      addToast('Karşılaştırma için PDF açılamadı.', 'error');
    }
  };

  const addedCount = textDiffLines.filter((l) => l.type === 'added').length;
  const removedCount = textDiffLines.filter((l) => l.type === 'removed').length;
  const visibleDiffLines = onlyDiffLines
    ? textDiffLines.filter((l) => l.type !== 'unchanged')
    : textDiffLines;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 dark:bg-slate-950/95 backdrop-blur-md flex flex-col animate-in fade-in duration-200">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleLoadNewPdfForComparison}
        accept=".pdf,application/pdf"
        className="hidden"
      />

      {/* Top Header */}
      <div className="h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-6 flex items-center justify-between text-slate-800 dark:text-slate-100 select-none shadow-sm gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
            <Columns className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
              PDF Karşılaştırma
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Yan yana görünüm, metin farkları ve görsel piksel farkı analizi
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center p-0.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
          <button
            type="button"
            onClick={() => setCompareMode('side-by-side')}
            className={cn(
              'px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors',
              compareMode === 'side-by-side'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            )}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Yan Yana</span>
          </button>
          <button
            type="button"
            onClick={() => setCompareMode('text-diff')}
            className={cn(
              'px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors',
              compareMode === 'text-diff'
                ? 'bg-white dark:bg-slate-900 text-sky-600 dark:text-sky-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            )}
          >
            <FileDiff className="w-3.5 h-3.5" />
            <span>Metin Farkları</span>
          </button>
          <button
            type="button"
            onClick={() => setCompareMode('visual-diff')}
            className={cn(
              'px-3 py-1 rounded-lg font-semibold flex items-center gap-1.5 transition-colors',
              compareMode === 'visual-diff'
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            )}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Görsel Fark</span>
          </button>
        </div>

        {/* Zoom, Sync & File Picker */}
        <div className="flex items-center gap-2.5">
          {compareMode !== 'text-diff' && (
            <div className="flex items-center rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-1.5 py-1 text-xs">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                aria-label="Uzaklaştır"
                className="p-0.5 hover:text-sky-500"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="w-11 text-center font-mono font-semibold">
                %{Math.round(zoom * 100)}
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.0, Number((z + 0.25).toFixed(2))))}
                aria-label="Yakınlaştır"
                className="p-0.5 hover:text-sky-500"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => triggerPickPdfFor('B')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-100 dark:bg-sky-950/70 hover:bg-sky-200 dark:hover:bg-sky-900 text-sky-700 dark:text-sky-300 text-xs font-semibold border border-sky-300 dark:border-sky-700/80 transition-colors shadow-sm"
            title="Karşılaştırmak İçin PDF Seç"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>PDF Seç / Ekle</span>
          </button>

          <button
            type="button"
            onClick={() => setSyncScroll(!syncScroll)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
              syncScroll
                ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-400'
                : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400'
            )}
          >
            {syncScroll ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            <span>Senkron: {syncScroll ? 'Açık' : 'Kapalı'}</span>
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Kapat"
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Empty state if 0 open tabs */}
      {tabs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-white">
          <Columns className="w-14 h-14 text-sky-400 mb-3 opacity-80" />
          <h3 className="text-lg font-bold mb-1">Karşılaştırılacak Belge Yok</h3>
          <p className="text-xs text-slate-300 mb-5 max-w-md">
            Karşılaştırmaya başlamak için iki PDF belgesi seçin. Seçtiğiniz belgeler sekme olarak da açılacaktır.
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => triggerPickPdfFor('A')}
              className="px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-bold flex items-center gap-2 shadow-lg"
            >
              <Plus className="w-4 h-4" />
              1. PDF'i Seç (Sol)
            </button>
            <button
              type="button"
              onClick={() => triggerPickPdfFor('B')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-xs font-bold flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              2. PDF'i Seç (Sağ)
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Document/Page Selectors Bar */}
          <div className="grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800">
            {/* Doc A Bar */}
            <div className="flex items-center justify-between px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <select
                  value={docAIndex}
                  onChange={(e) => {
                    setDocAIndex(parseInt(e.target.value, 10));
                    setPageA(0);
                  }}
                  className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-800 dark:text-slate-200 font-semibold shadow-sm focus:outline-none max-w-[230px] truncate"
                >
                  {tabs.map((t, idx) => (
                    <option key={t.id} value={idx}>
                      Sol (A): {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => triggerPickPdfFor('A')}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sky-600 dark:text-sky-400 hover:bg-slate-100"
                  title="Sol taraf için yeni PDF seç"
                >
                  Değiştir
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevPageA}
                  disabled={pageA <= 0}
                  className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
                >
                  Önceki
                </button>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Sayfa {pageA + 1} / {docA?.totalPages || 1}
                </span>
                <button
                  type="button"
                  onClick={handleNextPageA}
                  disabled={pageA >= (docA?.totalPages || 1) - 1}
                  className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
                >
                  Sonraki
                </button>
              </div>
            </div>

            {/* Doc B Bar */}
            <div className="flex items-center justify-between px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2">
                <select
                  value={docBIndex}
                  onChange={(e) => {
                    setDocBIndex(parseInt(e.target.value, 10));
                    setPageB(0);
                  }}
                  className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2.5 py-1 text-slate-800 dark:text-slate-200 font-semibold shadow-sm focus:outline-none max-w-[230px] truncate"
                >
                  {tabs.map((t, idx) => (
                    <option key={t.id} value={idx}>
                      Sağ (B): {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => triggerPickPdfFor('B')}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-sky-600 dark:text-sky-400 hover:bg-slate-100"
                  title="Sağ taraf için yeni PDF seç"
                >
                  Değiştir
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrevPageB}
                  disabled={pageB <= 0}
                  className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
                >
                  Önceki
                </button>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Sayfa {pageB + 1} / {docB?.totalPages || 1}
                </span>
                <button
                  type="button"
                  onClick={handleNextPageB}
                  disabled={pageB >= (docB?.totalPages || 1) - 1}
                  className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-transparent rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-700 dark:text-slate-300"
                >
                  Sonraki
                </button>
              </div>
            </div>
          </div>

          {/* Content by Compare Mode */}
          {compareMode === 'side-by-side' && (
            <div className="flex-1 flex overflow-hidden divide-x divide-slate-200 dark:divide-slate-800">
              <div
                ref={paneARef}
                onScroll={() => handlePaneScroll('A')}
                className="flex-1 overflow-auto bg-slate-100/80 dark:bg-slate-950/70 p-6 flex items-start justify-center"
              >
                {docA?.pages[pageA] && (
                  <PageView
                    page={docA.pages[pageA]}
                    index={pageA}
                    scale={zoom}
                    customPdfDocProxy={proxyA}
                  />
                )}
              </div>

              <div
                ref={paneBRef}
                onScroll={() => handlePaneScroll('B')}
                className="flex-1 overflow-auto bg-slate-100/80 dark:bg-slate-950/70 p-6 flex items-start justify-center"
              >
                {docB?.pages[pageB] && (
                  <PageView
                    page={docB.pages[pageB]}
                    index={pageB}
                    scale={zoom}
                    customPdfDocProxy={proxyB}
                  />
                )}
              </div>
            </div>
          )}

          {compareMode === 'text-diff' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-slate-950 p-6">
              <div className="flex items-center justify-between mb-3 pb-3 border-b border-slate-200 dark:border-slate-800 text-xs">
                <div className="flex items-center gap-3">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold">
                    +{addedCount} Eklenen Satır
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold">
                    -{removedCount} Silinen Satır
                  </span>
                  {addedCount === 0 && removedCount === 0 && !isDiffComputing && (
                    <span className="text-slate-500 dark:text-slate-400 font-medium">
                      Bu iki sayfanın metin içeriği birebir aynı.
                    </span>
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-slate-600 dark:text-slate-300 font-medium">
                  <input
                    type="checkbox"
                    checked={onlyDiffLines}
                    onChange={(e) => setOnlyDiffLines(e.target.checked)}
                    className="accent-sky-500 rounded"
                  />
                  <span>Yalnızca Farklı Satırları Göster</span>
                </label>
              </div>

              <div className="flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 font-mono text-xs divide-y divide-slate-200/60 dark:divide-slate-800/60">
                {isDiffComputing ? (
                  <div className="h-full flex items-center justify-center gap-2 text-slate-500">
                    <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
                    <span>Metin farkları hesaplanıyor...</span>
                  </div>
                ) : visibleDiffLines.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 font-sans">
                    Gösterilecek satır farkı bulunamadı.
                  </div>
                ) : (
                  visibleDiffLines.map((line, i) => (
                    <div
                      key={i}
                      className={cn(
                        'px-4 py-1.5 flex items-start gap-3 whitespace-pre-wrap',
                        line.type === 'added' &&
                          'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
                        line.type === 'removed' &&
                          'bg-rose-500/15 text-rose-800 dark:text-rose-300',
                        line.type === 'unchanged' && 'text-slate-600 dark:text-slate-400'
                      )}
                    >
                      <span className="w-4 shrink-0 font-bold select-none">
                        {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                      </span>
                      <span className="flex-1 break-words">{line.text}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {compareMode === 'visual-diff' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 p-4">
              <div className="flex items-center justify-between mb-3 px-2 text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-sm bg-rose-500 inline-block" />
                  <span className="text-slate-700 dark:text-slate-200 font-semibold">
                    Kırmızı bölgeler iki sayfa arasındaki piksel farklarını gösterir.
                  </span>
                </div>
                {visualDiffPct !== null && (
                  <span className="px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 font-bold">
                    Görsel Fark Oranı: %{visualDiffPct}
                  </span>
                )}
              </div>

              <div className="flex-1 overflow-auto flex items-start justify-center p-4">
                <div className="relative inline-block shadow-2xl rounded bg-white">
                  {isDiffComputing && (
                    <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 flex items-center justify-center z-10 min-w-[260px] min-h-[260px]">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <Loader2 className="w-5 h-5 animate-spin text-rose-500" />
                        <span>Piksel farkı hesaplanıyor...</span>
                      </div>
                    </div>
                  )}
                  <canvas ref={visualDiffCanvasRef} className="block rounded" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
