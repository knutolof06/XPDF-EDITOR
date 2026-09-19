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
  Scissors,
  Info,
  AlertTriangle,
} from 'lucide-react';
import { cn } from '@/utils/cn';

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

const MIN_SELECTION = 10; // px minimum seçim boyutu

export const SnipOcrModal: React.FC = () => {
  const { isSnipOcrModalOpen, setSnipOcrModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const { addAnnotation } = useAnnotationStore();

  // Canvas rendering
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // State
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

  const electron = (window as any).electronAPI;
  const isElectron = !!electron?.winrtOcrRegion;

  // Dil listesini yükle
  useEffect(() => {
    if (!isSnipOcrModalOpen || !isElectron || langLoaded) return;
    electron.winrtOcrGetLanguages().then((res: any) => {
      if (res?.success && Array.isArray(res.languages) && res.languages.length > 0) {
        setLanguages(res.languages);
        // Türkçe varsa varsayılan yap
        const tr = res.languages.find((l: OcrLang) => l.tag.startsWith('tr'));
        if (tr) setSelectedLang(tr.tag);
      }
      setLangLoaded(true);
    }).catch(() => setLangLoaded(true));
  }, [isSnipOcrModalOpen, isElectron, langLoaded]);

  // PDF sayfasını canvas'a render et
  useEffect(() => {
    if (!isSnipOcrModalOpen || !pdfDocProxy || !canvasRef.current) return;
    let cancelled = false;

    const renderPage = async () => {
      setPageRendered(false);
      setState('idle');
      setSelection(null);
      setOcrText('');
      setOcrError('');
      setCopied(false);
      setInserted(false);

      try {
        const pageIndex = (currentDocument?.activePageIndex ?? 0) + 1;
        const page = await pdfDocProxy.getPage(pageIndex);
        const canvas = canvasRef.current!;
        const container = containerRef.current;
        const containerW = container ? container.clientWidth - 32 : 800;
        const containerH = container ? container.clientHeight - 180 : 500;

        const vp1 = page.getViewport({ scale: 1 });
        const scaleW = containerW / vp1.width;
        const scaleH = containerH / vp1.height;
        const scale = Math.min(scaleW, scaleH, 2.0);

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
  }, [isSnipOcrModalOpen, pdfDocProxy, currentDocument?.activePageIndex]);

  // ─── Fare sürükleme seçimi ───────────────────────────────────────────────
  const getRelativePos = (e: React.MouseEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(e.clientX - rect.left, canvas.offsetWidth)),
      y: Math.max(0, Math.min(e.clientY - rect.top, canvas.offsetHeight)),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!pageRendered || state === 'processing') return;
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
    if (state !== 'selecting' || !dragStart) return;
    const pos = getRelativePos(e);
    setSelection({
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y),
    });
  };

  const handleMouseUp = useCallback(async (e: React.MouseEvent) => {
    if (state !== 'selecting' || !dragStart) return;
    const pos = getRelativePos(e);
    const finalSel: SelectionRect = {
      x: Math.min(dragStart.x, pos.x),
      y: Math.min(dragStart.y, pos.y),
      w: Math.abs(pos.x - dragStart.x),
      h: Math.abs(pos.y - dragStart.y),
    };
    setDragStart(null);

    if (finalSel.w < MIN_SELECTION || finalSel.h < MIN_SELECTION) {
      setState('idle');
      setSelection(null);
      return;
    }

    setSelection(finalSel);
    setState('selected');
    // Otomatik OCR başlat
    await runOcr(finalSel);
  }, [state, dragStart, selectedLang]);

  // ─── OCR İşlemi ─────────────────────────────────────────────────────────
  const runOcr = async (sel: SelectionRect) => {
    if (!canvasRef.current) return;

    setState('processing');
    try {
      const canvas = canvasRef.current;
      const dpr = canvas.width / canvas.offsetWidth; // gerçek piksel / CSS piksel oranı

      // Seçilen bölgeyi offscreen canvas'a kes
      const oc = document.createElement('canvas');
      const sx = Math.floor(sel.x * dpr);
      const sy = Math.floor(sel.y * dpr);
      const sw = Math.max(1, Math.floor(sel.w * dpr));
      const sh = Math.max(1, Math.floor(sel.h * dpr));
      oc.width = sw;
      oc.height = sh;
      const octx = oc.getContext('2d')!;
      octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);

      const dataUrl = oc.toDataURL('image/png');

      if (!isElectron) {
        // Tarayıcı modunda Tesseract fallback göster
        setOcrError('Bu özellik yalnızca Windows masaüstü uygulamasında çalışır.');
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
          setOcrError('Seçilen bölgede metin bulunamadı.');
          setState('error');
        }
      } else {
        setOcrError(result?.error || 'OCR başarısız oldu.');
        setState('error');
      }
    } catch (err) {
      setOcrError(String(err));
      setState('error');
    }
  };

  const handleRetry = () => {
    if (selection) runOcr(selection);
  };

  const handleReselect = () => {
    setSelection(null);
    setState('idle');
    setOcrText('');
    setOcrError('');
    setCopied(false);
    setInserted(false);
  };

  // ─── Panoya kopyala ──────────────────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(ocrText).then(() => {
      setCopied(true);
      addToast('Metin panoya kopyalandı!', 'success', 2000);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // ─── Sayfaya metin olarak ekle ──────────────────────────────────────────
  const handleInsertToPage = () => {
    if (!currentDocument || !selection || !canvasRef.current) return;

    const pageId = currentDocument.pages[currentDocument.activePageIndex]?.id;
    if (!pageId) { addToast('Aktif sayfa bulunamadı.', 'error'); return; }

    const page = currentDocument.pages[currentDocument.activePageIndex];
    const pageW = page.width;   // PDF points
    const pageH = page.height;  // PDF points
    const canvas = canvasRef.current;
    const canvasW = canvas.offsetWidth;
    const canvasH = canvas.offsetHeight;

    // CSS piksel koordinatlarını PDF point koordinatlarına dönüştür
    const xPct = selection.x / canvasW;
    const yPct = selection.y / canvasH;
    const wPct = selection.w / canvasW;
    const hPct = selection.h / canvasH;

    const annX = xPct * pageW;
    const annY = yPct * pageH;
    const annW = Math.max(wPct * pageW, 50);
    const annH = Math.max(hPct * pageH, 20);

    const annotation = {
      id: 'snip_ocr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      pageId,
      type: 'text' as const,
      x: annX,
      y: annY,
      width: annW,
      height: annH,
      text: ocrText,
      fontSize: 11,
      fontFamily: 'Helvetica, Arial, sans-serif',
      color: '#1e293b',
      backgroundColor: 'rgba(255,255,200,0.85)',
      opacity: 1,
    };

    addAnnotation(pageId, annotation);
    setInserted(true);
    addToast('Metin sayfaya eklendi!', 'success', 2000);
    setTimeout(() => setInserted(false), 2000);
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
        backgroundColor: 'rgba(14,165,233,0.10)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }
    : {};

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        ref={containerRef}
        className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '92vw', maxWidth: 1100, height: '90vh', maxHeight: 820 }}
      >
        {/* ─── Başlık ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-sky-50 to-indigo-50 dark:from-slate-800 dark:to-slate-900 shrink-0">
          <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-sky-500 shadow">
            <Scissors className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Bölge OCR — Ekran Alıntısı Tarzı Metin Tanıma
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Windows.Media.Ocr motoru (Snipping Tool / PowerToys Text Extractor ile aynı)
            </p>
          </div>

          {/* Dil seçimi */}
          <div className="ml-auto flex items-center gap-2">
            <Languages className="w-4 h-4 text-slate-400" />
            {languages.length > 0 ? (
              <select
                value={selectedLang}
                onChange={(e) => setSelectedLang(e.target.value)}
                className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-400"
                disabled={state === 'processing'}
              >
                {languages.map((l) => (
                  <option key={l.tag} value={l.tag}>{l.name}</option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-slate-400">
                {langLoaded ? 'Sistem dili' : 'Diller yükleniyor...'}
              </span>
            )}
          </div>

          <button
            onClick={() => setSnipOcrModalOpen(false)}
            className="ml-3 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-colors"
            title="Kapat (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ─── Bilgi Çubuğu ───────────────────────────────────────────── */}
        <div className={cn(
          'px-5 py-2 text-xs flex items-center gap-2 shrink-0 transition-colors',
          state === 'idle' || state === 'selecting'
            ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300'
            : state === 'processing'
            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
            : state === 'done'
            ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
            : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
        )}>
          {(state === 'idle' || state === 'selecting') && (
            <><Crosshair className="w-4 h-4 shrink-0" /> Fare ile metin bölgesi seçin — bırakınca OCR otomatik başlar</>
          )}
          {state === 'processing' && (
            <><Loader2 className="w-4 h-4 shrink-0 animate-spin" /> Windows OCR motoru çalışıyor, lütfen bekleyin...</>
          )}
          {state === 'done' && (
            <><Check className="w-4 h-4 shrink-0" /> Metin başarıyla tanındı! Aşağıdan kopyalayın veya sayfaya ekleyin.</>
          )}
          {state === 'error' && (
            <><AlertTriangle className="w-4 h-4 shrink-0" /> {ocrError || 'Hata oluştu.'}</>
          )}
        </div>

        {/* ─── İçerik Alanı ──────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Sol: Sayfa Görünümü + Seçim */}
          <div className="flex-1 relative overflow-auto bg-slate-100 dark:bg-slate-800 flex items-center justify-center p-4">
            {!pageRendered && (
              <div className="flex flex-col items-center gap-3 text-slate-500">
                <Loader2 className="w-8 h-8 animate-spin text-sky-500" />
                <span className="text-sm">Sayfa yükleniyor...</span>
              </div>
            )}

            <div className="relative inline-block shadow-xl rounded-lg overflow-hidden" style={{ display: pageRendered ? 'inline-block' : 'none' }}>
              <canvas
                ref={canvasRef}
                style={{
                  display: 'block',
                  cursor: state === 'processing' ? 'wait' : 'crosshair',
                  userSelect: 'none',
                  maxWidth: '100%',
                }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={(e) => {
                  if (state === 'selecting') handleMouseUp(e);
                }}
              />

              {/* Karartma Overlay + Seçim Kutusu */}
              {(state === 'selecting' || state === 'selected' || state === 'processing' || state === 'done' || state === 'error') && selection && (
                <div
                  ref={overlayRef}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                  }}
                >
                  {/* Seçim dışı karartma (4 köşe) */}
                  {selection && (
                    <>
                      {/* Üst */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: selection.y, background: 'rgba(0,0,0,0.35)' }} />
                      {/* Alt */}
                      <div style={{ position: 'absolute', top: selection.y + selection.h, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.35)' }} />
                      {/* Sol */}
                      <div style={{ position: 'absolute', top: selection.y, left: 0, width: selection.x, height: selection.h, background: 'rgba(0,0,0,0.35)' }} />
                      {/* Sağ */}
                      <div style={{ position: 'absolute', top: selection.y, left: selection.x + selection.w, right: 0, height: selection.h, background: 'rgba(0,0,0,0.35)' }} />
                    </>
                  )}
                  {/* Seçim Kutusu */}
                  <div style={selectionBoxStyle}>
                    {/* köşe tutamaçları */}
                    {['tl', 'tr', 'bl', 'br'].map((corner) => (
                      <div key={corner} style={{
                        position: 'absolute',
                        width: 8, height: 8,
                        background: '#0ea5e9',
                        border: '1.5px solid white',
                        borderRadius: 2,
                        ...(corner === 'tl' ? { top: -4, left: -4 } :
                          corner === 'tr' ? { top: -4, right: -4 } :
                          corner === 'bl' ? { bottom: -4, left: -4 } :
                          { bottom: -4, right: -4 }),
                      }} />
                    ))}
                  </div>
                  {/* İşlem göstergesi */}
                  {state === 'processing' && selection && (
                    <div style={{
                      position: 'absolute',
                      top: selection.y + selection.h / 2 - 16,
                      left: selection.x + selection.w / 2 - 16,
                      width: 32, height: 32,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: 'rgba(255,255,255,0.92)',
                      borderRadius: '50%',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
                    }}>
                      <Loader2 className="w-5 h-5 animate-spin text-sky-500" />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Sağ: OCR Sonuçları */}
          <div className="w-72 shrink-0 border-l border-slate-200 dark:border-slate-700 flex flex-col bg-white dark:bg-slate-900">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5" /> Tanınan Metin
              </h3>
            </div>

            <div className="flex-1 overflow-auto p-3">
              {(state === 'idle' || state === 'selecting') && (
                <div className="flex flex-col items-center gap-3 mt-8 text-center text-slate-400 dark:text-slate-500">
                  <Crosshair className="w-10 h-10 opacity-30" />
                  <p className="text-xs leading-relaxed">
                    Sayfada bir bölge seçtiğinizde tanınan metin burada görünür.
                  </p>
                </div>
              )}
              {state === 'processing' && (
                <div className="flex flex-col items-center gap-3 mt-8 text-center text-amber-500">
                  <Loader2 className="w-8 h-8 animate-spin" />
                  <p className="text-xs">Windows OCR işleniyor...</p>
                </div>
              )}
              {state === 'done' && (
                <textarea
                  className="w-full h-full min-h-[200px] text-sm text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 rounded-lg p-3 border border-slate-200 dark:border-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-sky-400"
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  placeholder="Tanınan metin..."
                />
              )}
              {state === 'error' && (
                <div className="flex flex-col items-center gap-3 mt-8 text-center text-rose-500">
                  <AlertTriangle className="w-8 h-8 opacity-70" />
                  <p className="text-xs leading-relaxed px-2">{ocrError}</p>
                  {selection && (
                    <button
                      onClick={handleRetry}
                      className="mt-2 flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Tekrar Dene
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ─── Eylem Butonları ─────────────────────────────────── */}
            <div className="p-3 border-t border-slate-100 dark:border-slate-800 flex flex-col gap-2 shrink-0">
              {/* Yeniden Seç */}
              <button
                onClick={handleReselect}
                disabled={state === 'processing'}
                className="flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-50 transition-colors"
              >
                <Crosshair className="w-3.5 h-3.5" />
                Yeniden Seç
              </button>

              {/* Panoya Kopyala */}
              <button
                onClick={handleCopy}
                disabled={state !== 'done' || !ocrText}
                className={cn(
                  'flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg transition-colors',
                  state === 'done' && ocrText
                    ? copied
                      ? 'bg-emerald-500 text-white'
                      : 'bg-sky-500 hover:bg-sky-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
                )}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Kopyalandı!' : 'Panoya Kopyala'}
              </button>

              {/* Sayfaya Ekle */}
              <button
                onClick={handleInsertToPage}
                disabled={state !== 'done' || !ocrText}
                className={cn(
                  'flex items-center justify-center gap-2 text-xs px-3 py-2 rounded-lg transition-colors',
                  state === 'done' && ocrText
                    ? inserted
                      ? 'bg-emerald-500 text-white'
                      : 'bg-indigo-500 hover:bg-indigo-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
                )}
              >
                {inserted ? <Check className="w-3.5 h-3.5" /> : <Type className="w-3.5 h-3.5" />}
                {inserted ? 'Eklendi!' : 'Sayfaya Ekle'}
              </button>
            </div>

            {/* Bilgi notu */}
            {!isElectron && (
              <div className="px-3 pb-3">
                <div className="flex items-start gap-2 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 rounded-lg p-2 border border-amber-200 dark:border-amber-800">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" />
                  Bu özellik yalnızca Windows masaüstü uygulamasında çalışır.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
