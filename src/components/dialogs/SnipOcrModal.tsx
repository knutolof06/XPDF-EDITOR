import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { useAnnotationStore } from '@/store/annotation-store';
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

const MIN_SELECTION = 8; // px minimum seçim boyutu

export const SnipOcrModal: React.FC = () => {
  const { isSnipOcrModalOpen, setSnipOcrModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const { addAnnotation } = useAnnotationStore();

  // Canvas and layout refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortBatchRef = useRef(false);

  // Active page within the modal
  const [modalPageIndex, setModalPageIndex] = useState(0);

  // State
  const [scanMode, setScanMode] = useState<ScanMode>('region');
  const [state, setState] = useState<SelectionState>('idle');
  const [pageRendered, setPageRendered] = useState(false);
  const [selection, setSelection] = useState<SelectionRect | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [ocrText, setOcrText] = useState('');
  const [ocrError, setOcrError] = useState('');
  const [copied, setCopied] = useState(false);
  const [inserted, setInserted] = useState(false);
  const [languages, setLanguages] = useState<OcrLang[]>([]);
  const [selectedLang, setSelectedLang] = useState('tr');
  const [langLoaded, setLangLoaded] = useState(false);

  // Multi-page batch progress
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; percent: number } | null>(null);

  const electron = (window as any).electronAPI;
  const isElectron = !!electron?.winrtOcrRegion;

  const totalPages = pdfDocProxy?.numPages || 1;

  // Initialize active page when modal opens
  useEffect(() => {
    if (isSnipOcrModalOpen) {
      setModalPageIndex(currentDocument?.activePageIndex || 0);
      setState('idle');
      setSelection(null);
      setOcrText('');
      setOcrError('');
      setBatchProgress(null);
      abortBatchRef.current = false;
    } else {
      abortBatchRef.current = true;
    }
  }, [isSnipOcrModalOpen, currentDocument?.activePageIndex]);

  // Load available WinRT languages
  useEffect(() => {
    if (!isSnipOcrModalOpen || !isElectron || langLoaded) return;
    electron.winrtOcrGetLanguages().then((res: any) => {
      if (res?.success && Array.isArray(res.languages) && res.languages.length > 0) {
        setLanguages(res.languages);
        const tr = res.languages.find((l: OcrLang) => l.tag.toLowerCase().startsWith('tr'));
        if (tr) setSelectedLang(tr.tag);
      }
      setLangLoaded(true);
    }).catch(() => setLangLoaded(true));
  }, [isSnipOcrModalOpen, isElectron, langLoaded]);

  // Render the current page on the display preview canvas
  useEffect(() => {
    if (!isSnipOcrModalOpen || !pdfDocProxy || !canvasRef.current) return;
    let cancelled = false;

    const renderPage = async () => {
      setPageRendered(false);
      setState('idle');
      setSelection(null);

      try {
        const page = await pdfDocProxy.getPage(modalPageIndex + 1);
        const canvas = canvasRef.current!;
        const container = containerRef.current;
        const containerW = container ? container.clientWidth - 420 : 600;
        const containerH = container ? container.clientHeight - 160 : 450;

        const vp1 = page.getViewport({ scale: 1 });
        const scaleW = Math.max(0.2, (containerW || 600) / vp1.width);
        const scaleH = Math.max(0.2, (containerH || 450) / vp1.height);
        const scale = Math.min(scaleW, scaleH, 1.8);

        const vp = page.getViewport({ scale });

        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);

        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        if (!cancelled) setPageRendered(true);
      } catch (e) {
        if (!cancelled) {
          setOcrError('Sayfa render edilemedi.');
          setState('error');
        }
      }
    };

    renderPage();
    return () => { cancelled = true; };
  }, [isSnipOcrModalOpen, pdfDocProxy, modalPageIndex]);

  // ─── High DPI Render Helpers (~200-250 DPI for Ultra Accurate OCR) ────────
  const renderRegionHighDpi = async (pageIdx: number, sel: SelectionRect): Promise<string | null> => {
    if (!pdfDocProxy || !canvasRef.current) return null;
    const page = await pdfDocProxy.getPage(pageIdx + 1);
    const canvas = canvasRef.current;
    const canvasW = canvas.offsetWidth || canvas.width;
    const canvasH = canvas.offsetHeight || canvas.height;

    const highScale = 2.5; // High-resolution for OCR
    const vp = page.getViewport({ scale: highScale });

    const rx = sel.x / canvasW;
    const ry = sel.y / canvasH;
    const rw = sel.w / canvasW;
    const rh = sel.h / canvasH;

    const sx = Math.max(0, Math.floor(rx * vp.width));
    const sy = Math.max(0, Math.floor(ry * vp.height));
    const sw = Math.min(vp.width - sx, Math.max(10, Math.floor(rw * vp.width)));
    const sh = Math.min(vp.height - sy, Math.max(10, Math.floor(rh * vp.height)));

    const fullCanvas = document.createElement('canvas');
    fullCanvas.width = Math.floor(vp.width);
    fullCanvas.height = Math.floor(vp.height);
    const fullCtx = fullCanvas.getContext('2d')!;
    await page.render({ canvasContext: fullCtx, viewport: vp }).promise;

    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = sw;
    cropCanvas.height = sh;
    const cropCtx = cropCanvas.getContext('2d')!;
    cropCtx.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    return cropCanvas.toDataURL('image/png');
  };

  const renderFullPageHighDpi = async (pageIdx: number): Promise<string | null> => {
    if (!pdfDocProxy) return null;
    const page = await pdfDocProxy.getPage(pageIdx + 1);
    const highScale = 2.2;
    const vp = page.getViewport({ scale: highScale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;

    return canvas.toDataURL('image/png');
  };

  // ─── Mouse Drag Selection ────────────────────────────────────────────────
  const getRelativePos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, canvas.offsetWidth)),
      y: Math.max(0, Math.min(e.clientY - rect.top, canvas.offsetHeight)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!pageRendered || state === 'processing' || scanMode !== 'region') return;
    if (e.button !== 0) return;
    e.preventDefault();
    const pos = getRelativePos(e);
    setDragStart(pos);
    setSelection({ x: pos.x, y: pos.y, w: 0, h: 0 });
    setState('selecting');
    setOcrText('');
    setOcrError('');
    setCopied(false);
    setInserted(false);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (state !== 'selecting' || !dragStart || scanMode !== 'region') return;
    const pos = getRelativePos(e);
    setSelection({
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y),
    });
  };

  const handleMouseUp = useCallback(async () => {
    if (state !== 'selecting' || !dragStart || scanMode !== 'region') return;
    const finalSel = selection;
    setDragStart(null);

    if (!finalSel || finalSel.w < MIN_SELECTION || finalSel.h < MIN_SELECTION) {
      setState('idle');
      setSelection(null);
      return;
    }

    setState('selected');
    await runRegionOcr(finalSel);
  }, [state, dragStart, scanMode, selection]);

  // ─── 1. Run Region OCR ───────────────────────────────────────────────────
  const runRegionOcr = async (sel: SelectionRect) => {
    if (!isElectron) {
      setOcrError('Bu özellik Windows yerel uygulamasında çalışır.');
      setState('error');
      return;
    }

    setState('processing');
    setOcrError('');
    try {
      const dataUrl = await renderRegionHighDpi(modalPageIndex, sel);
      if (!dataUrl) {
        setOcrError('Seçilen bölge yüksek çözünürlükte işlenemedi.');
        setState('error');
        return;
      }

      const result = await electron.winrtOcrRegion(dataUrl, selectedLang);

      if (result?.success) {
        const text = (result.text || '').trim();
        if (text) {
          setOcrText(text);
          setState('done');
        } else {
          setOcrError('Seçilen alanda algılanabilir metin bulunamadı. Lütfen yazıları tam içine alacak şekilde tekrar deneyin.');
          setState('error');
        }
      } else {
        setOcrError(result?.error || 'OCR işlemi başarısız oldu.');
        setState('error');
      }
    } catch (err: any) {
      setOcrError(err?.message || String(err));
      setState('error');
    }
  };

  // ─── 2. Run Current Page OCR ─────────────────────────────────────────────
  const runCurrentPageOcr = async () => {
    if (!isElectron) {
      setOcrError('Bu özellik Windows yerel uygulamasında çalışır.');
      setState('error');
      return;
    }

    setScanMode('current-page');
    setSelection(null);
    setState('processing');
    setOcrError('');
    setOcrText('');

    try {
      const dataUrl = await renderFullPageHighDpi(modalPageIndex);
      if (!dataUrl) {
        setOcrError('Sayfa görüntüsü yakalanamadı.');
        setState('error');
        return;
      }

      const result = await electron.winrtOcrRegion(dataUrl, selectedLang);

      if (result?.success) {
        const text = (result.text || '').trim();
        if (text) {
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
    } catch (err: any) {
      setOcrError(err?.message || String(err));
      setState('error');
    }
  };

  // ─── 3. Run All Pages OCR ────────────────────────────────────────────────
  const runAllPagesOcr = async () => {
    if (!pdfDocProxy || !isElectron) return;
    setScanMode('all-pages');
    setSelection(null);
    abortBatchRef.current = false;
    setState('processing');
    setBatchProgress({ current: 1, total: totalPages, percent: 0 });
    setOcrText('');
    setOcrError('');

    let combinedText = '';

    for (let i = 1; i <= totalPages; i++) {
      if (abortBatchRef.current) {
        combinedText += `\n\n[⚠️ Tarama kullanıcı tarafından durduruldu (${i - 1} / ${totalPages} sayfa)]`;
        break;
      }

      setBatchProgress({
        current: i,
        total: totalPages,
        percent: Math.round(((i - 1) / totalPages) * 100),
      });

      try {
        const dataUrl = await renderFullPageHighDpi(i - 1);
        if (dataUrl) {
          const result = await electron.winrtOcrRegion(dataUrl, selectedLang);
          const pageTxt = (result?.text || '').trim();
          combinedText += `=== SAYFA ${i} ===\n${pageTxt || '(Bu sayfada metin bulunamadı)'}\n\n`;
        }
      } catch (err: any) {
        combinedText += `=== SAYFA ${i} ===\n[Hata: ${err?.message || String(err)}]\n\n`;
      }
    }

    setBatchProgress(null);
    if (combinedText.trim()) {
      setOcrText(combinedText.trim());
      setState('done');
    } else {
      setOcrError('Belgedeki sayfalarda okunabilir metin bulunamadı.');
      setState('error');
    }
  };

  const handleCancelBatch = () => {
    abortBatchRef.current = true;
  };

  // ─── Copy to Clipboard ───────────────────────────────────────────────────
  const handleCopy = () => {
    if (!ocrText) return;
    navigator.clipboard.writeText(ocrText).then(() => {
      setCopied(true);
      addToast('Metin panoya kopyalandı!', 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ─── Download as TXT ─────────────────────────────────────────────────────
  const handleDownloadTxt = () => {
    if (!ocrText) return;
    const blob = new Blob([ocrText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentDocument?.name || 'belge'}_ocr.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('TXT dosyası olarak indirildi.', 'success', 2000);
  };

  // ─── Insert Text Box on Page ─────────────────────────────────────────────
  const handleInsertToPage = () => {
    if (!currentDocument || !ocrText) return;

    const page = currentDocument.pages[modalPageIndex];
    if (!page) { addToast('Aktif sayfa bulunamadı.', 'error'); return; }

    const pageW = page.width;
    const pageH = page.height;

    let annX = 40;
    let annY = 40;
    let annW = Math.min(pageW - 80, 300);
    let annH = 100;

    if (selection && canvasRef.current) {
      const canvas = canvasRef.current;
      const canvasW = canvas.offsetWidth || canvas.width;
      const canvasH = canvas.offsetHeight || canvas.height;

      annX = (selection.x / canvasW) * pageW;
      annY = (selection.y / canvasH) * pageH;
      annW = Math.max((selection.w / canvasW) * pageW, 60);
      annH = Math.max((selection.h / canvasH) * pageH, 25);
    }

    const annotation = {
      id: 'snip_ocr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      pageId: page.id,
      type: 'text' as const,
      x: annX,
      y: annY,
      width: annW,
      height: annH,
      text: ocrText,
      fontSize: 11,
      fontFamily: 'Helvetica, Arial, sans-serif',
      color: '#0f172a',
      backgroundColor: 'rgba(254, 240, 138, 0.9)', // Hafif sarı arka plan
      opacity: 1,
    };

    addAnnotation(page.id, annotation);
    setInserted(true);
    addToast('Metin kutusu olarak sayfaya eklendi!', 'success', 2500);
    setTimeout(() => setInserted(false), 2000);
  };

  const handleReselect = () => {
    setSelection(null);
    setState('idle');
    setOcrText('');
    setOcrError('');
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
        backgroundColor: 'rgba(14, 165, 233, 0.12)',
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
        {/* ─── Top Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Crosshair className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-800 dark:text-white">
                  Bölge & Sayfa OCR Stüdyosu
                </h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-300/50 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-sky-500" /> Windows.Media.Ocr
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Ekran Alıntısı tarzında kırpın veya tüm sayfayı/belgeyi yüksek çözünürlükte tarayın
              </p>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="flex items-center gap-1 bg-slate-200/80 dark:bg-slate-800 p-1 rounded-xl">
            <button
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
              <span>Tüm PDF'i Tara</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Language Selection */}
            <div className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              <Languages className="w-3.5 h-3.5 text-sky-500 shrink-0" />
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                disabled={state === 'processing'}
                className="text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-sky-500 cursor-pointer disabled:opacity-50"
              >
                {languages.length > 0 ? (
                  languages.map((l) => (
                    <option key={l.tag} value={l.tag}>
                      {l.name} ({l.tag})
                    </option>
                  ))
                ) : (
                  <>
                    <option value="tr">Türkçe (tr)</option>
                    <option value="en-US">English (en-US)</option>
                  </>
                )}
              </select>
            </div>

            <button
              onClick={() => setSnipOcrModalOpen(false)}
              className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── Main Content Split ─────────────────────────────────────────── */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Canvas Preview Area */}
          <div className="flex-1 flex flex-col bg-slate-100 dark:bg-slate-950 relative overflow-hidden border-r border-slate-200 dark:border-slate-800">
            {/* Canvas Subheader / Navigation */}
            <div className="flex items-center justify-between px-4 py-2 bg-white/70 dark:bg-slate-900/70 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sky-600 dark:text-sky-400">
                  {scanMode === 'region' && '🖱️ Fareyle metin alanını dikdörtgen içine alın'}
                  {scanMode === 'current-page' && `📄 Sayfa ${modalPageIndex + 1} Taranıyor`}
                  {scanMode === 'all-pages' && '📚 Tüm Belge Çoklu Sayfa Taraması'}
                </span>
              </div>

              {/* Page Navigator */}
              <div className="flex items-center gap-1.5">
                <button
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
                  onClick={() => setModalPageIndex((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={modalPageIndex >= totalPages - 1 || state === 'processing'}
                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
                  title="Sonraki Sayfa"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Canvas Interactive Container */}
            <div
              className={cn(
                'flex-1 flex items-center justify-center p-4 overflow-auto',
                scanMode === 'region' && 'cursor-crosshair'
              )}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
            >
              <div className="relative inline-block shadow-lg rounded-sm overflow-hidden bg-white">
                <canvas ref={canvasRef} className="block select-none" />

                {/* Dark overlay for Snipping Tool effect in region mode */}
                {scanMode === 'region' && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: selection
                        ? `linear-gradient(to right,
                            rgba(0,0,0,0.5) ${selection.x}px,
                            transparent ${selection.x}px,
                            transparent ${selection.x + selection.w}px,
                            rgba(0,0,0,0.5) ${selection.x + selection.w}px)`
                        : 'rgba(0,0,0,0.02)',
                    }}
                  />
                )}

                {/* Selection dashed rectangle */}
                {scanMode === 'region' && selection && (
                  <div style={selectionBoxStyle}>
                    {/* Corner Handles */}
                    <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                    <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                    <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                    <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-sky-500 rounded-full shadow-xs" />
                  </div>
                )}
              </div>
            </div>

            {/* Multi-page batch progress banner */}
            {batchProgress && (
              <div className="p-3 bg-sky-50 dark:bg-sky-950/80 border-t border-sky-200 dark:border-sky-800 flex items-center justify-between gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-xs font-semibold text-sky-800 dark:text-sky-300 mb-1">
                    <span>Tüm Belge Taranıyor (Sayfa {batchProgress.current} / {batchProgress.total})</span>
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
            {/* Header */}
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

            {/* Textarea or Status */}
            <div className="flex-1 p-3 flex flex-col relative overflow-hidden">
              {state === 'processing' && !batchProgress ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400">
                  <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Windows OCR çalışıyor...
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
                      onClick={handleReselect}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-medium hover:bg-slate-200 transition-colors"
                    >
                      Tekrar Dene
                    </button>
                    <button
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
                    Sol taraftaki sayfadan fare ile bir metin alanını seçin veya yukarıdaki <b>"Bu Sayfayı Tara"</b> butonuna basın.
                  </p>
                </div>
              )}
            </div>

            {/* Bottom Actions */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 flex flex-col gap-2 bg-slate-50 dark:bg-slate-950/60">
              <div className="grid grid-cols-2 gap-2">
                <button
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
                  onClick={handleInsertToPage}
                  disabled={!ocrText}
                  className={cn(
                    'py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs border',
                    inserted
                      ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 border-emerald-400'
                      : 'bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 disabled:opacity-40'
                  )}
                >
                  {inserted ? <Check className="w-4 h-4 text-emerald-500" /> : <Type className="w-4 h-4 text-sky-500" />}
                  <span>{inserted ? 'Eklendi!' : 'Sayfaya Ekle'}</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleDownloadTxt}
                  disabled={!ocrText}
                  className="py-1.5 px-3 rounded-lg text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>TXT İndir</span>
                </button>

                <button
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
