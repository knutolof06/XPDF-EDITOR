import React, { useState, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { binaryStore } from '@/core/storage/binary-store';
import {
  OcrService,
  OcrLanguage,
  OcrDocumentResult,
  OcrProgress,
  OcrWord,
} from '@/core/ocr/ocr-service';
import {
  X,
  Sparkles,
  Copy,
  Download,
  Check,
  Loader2,
  FileText,
  FileCheck2,
  Languages,
  Sliders,
  ChevronLeft,
  ChevronRight,
  Eye,
  CheckCircle2,
  FileSearch,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const OcrStudioModal: React.FC = () => {
  const { isOcrModalOpen, setOcrModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const currentPageIndex = currentDocument?.activePageIndex || 0;
  const appDesignTheme = useViewerStore((s) => s.appDesignTheme) || 'fluent';

  // Config State
  const [pageScope, setPageScope] = useState<'current' | 'all' | 'custom'>('current');
  const [customRange, setCustomRange] = useState('');
  const [selectedLang, setSelectedLang] = useState<OcrLanguage>('tur');
  const [enhanceContrast, setEnhanceContrast] = useState(true);
  const [showBoundingBoxes, setShowBoundingBoxes] = useState(true);

  // Execution State
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrDocumentResult | null>(null);
  const [activeResultPageIndex, setActiveResultPageIndex] = useState(0);
  const [editableText, setEditableText] = useState('');
  const [hoveredWord, setHoveredWord] = useState<OcrWord | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const abortControllerRef = useRef<boolean>(false);

  // When modal closes or unmounts, stop running
  useEffect(() => {
    if (!isOcrModalOpen) {
      abortControllerRef.current = true;
      setIsRunning(false);
      setProgress(null);
    } else {
      abortControllerRef.current = false;
    }
  }, [isOcrModalOpen]);

  // Keep editable text in sync with active page
  useEffect(() => {
    if (ocrResult && ocrResult.pages[activeResultPageIndex]) {
      setEditableText(ocrResult.pages[activeResultPageIndex].text);
    }
  }, [activeResultPageIndex, ocrResult]);

  if (!isOcrModalOpen || !currentDocument || !pdfDocProxy) return null;

  const totalPages = pdfDocProxy.numPages;
  const activePageNum = currentPageIndex + 1;

  // Resolve target pages
  const resolveTargetPages = (): number[] => {
    if (pageScope === 'current') {
      return [activePageNum];
    }
    if (pageScope === 'all') {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    // Custom range parser: e.g. "1-3, 5, 8-10"
    const pages = new Set<number>();
    const parts = customRange.split(',').map((s) => s.trim());
    for (const part of parts) {
      if (part.includes('-')) {
        const [startStr, endStr] = part.split('-').map((s) => s.trim());
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          const min = Math.max(1, Math.min(start, end));
          const max = Math.min(totalPages, Math.max(start, end));
          for (let p = min; p <= max; p++) pages.add(p);
        }
      } else {
        const p = parseInt(part, 10);
        if (!isNaN(p) && p >= 1 && p <= totalPages) {
          pages.add(p);
        }
      }
    }
    const result = Array.from(pages).sort((a, b) => a - b);
    return result.length > 0 ? result : [activePageNum];
  };

  const handleStartOcr = async () => {
    const targetPages = resolveTargetPages();
    if (targetPages.length === 0) {
      addToast('Lütfen geçerli bir sayfa aralığı girin.', 'warning');
      return;
    }

    setIsRunning(true);
    setProgress(null);
    setOcrResult(null);
    abortControllerRef.current = false;

    try {
      addToast(`${targetPages.length} sayfa için OCR başlatıldı...`, 'info');
      const result = await OcrService.processDocumentPages(
        pdfDocProxy,
        targetPages,
        selectedLang,
        enhanceContrast,
        (prog) => {
          if (!abortControllerRef.current) {
            setProgress(prog);
          }
        }
      );

      if (!abortControllerRef.current) {
        setOcrResult(result);
        setActiveResultPageIndex(0);
        addToast(
          `OCR Başarıyla Tamamlandı! Ortalama Güven: %${result.averageConfidence}`,
          'success'
        );
      }
    } catch (err: any) {
      console.error('OCR Error:', err);
      addToast(`OCR işlemi sırasında hata oluştu: ${err.message || err}`, 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyText = async () => {
    if (!editableText) return;
    try {
      await navigator.clipboard.writeText(editableText);
      setIsCopied(true);
      addToast('Metin panoya kopyalandı!', 'success');
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      addToast('Panoya kopyalanamadı.', 'error');
    }
  };

  const handleDownloadTxt = () => {
    if (!ocrResult) return;
    const textContent =
      ocrResult.pages.length === 1
        ? editableText
        : ocrResult.pages
            .map((p, idx) => `=== Sayfa ${p.pageNumber} ===\n${idx === activeResultPageIndex ? editableText : p.text}`)
            .join('\n\n');

    const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_ocr.txt`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('TXT dosyası indirildi!', 'success');
  };

  const handleDownloadJson = () => {
    if (!ocrResult) return;
    const dataStr = JSON.stringify(ocrResult, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_ocr_data.json`;
    a.click();
    URL.revokeObjectURL(url);
    addToast('Yapılandırılmış JSON verisi indirildi!', 'success');
  };

  const handleExportSearchablePdf = async () => {
    if (!ocrResult) return;
    const rawBuffer = binaryStore.get(currentDocument.id);
    if (!rawBuffer) {
      addToast('Orijinal PDF tampon belleği bulunamadı.', 'error');
      return;
    }

    setIsExportingPdf(true);
    try {
      addToast('Görünmez metin katmanı yerleştiriliyor...', 'info');
      const searchablePdfBytes = await OcrService.exportSearchablePdf(rawBuffer, ocrResult.pages);
      const blob = new Blob([searchablePdfBytes as any], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_searchable_ocr.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      addToast('Arama Yapılabilir PDF başarıyla oluşturuldu ve indirildi!', 'success');
    } catch (err: any) {
      console.error('Searchable PDF export error:', err);
      addToast(`Arama yapılabilir PDF oluşturulurken hata: ${err.message || err}`, 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const activePageResult = ocrResult?.pages[activeResultPageIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={cn(
          'w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden transition-all shadow-2xl',
          appDesignTheme === 'fluent' &&
            'bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-slate-900/20',
          appDesignTheme === 'cupertino' &&
            'bg-white/75 dark:bg-slate-900/75 backdrop-blur-3xl rounded-3xl border border-white/30 dark:border-slate-700/50 shadow-2xl',
          appDesignTheme === 'linear' &&
            'bg-[#08090A] rounded-xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.8)] text-slate-100',
          appDesignTheme === 'ribbon' &&
            'bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-300 dark:border-slate-800'
        )}
      >
        {/* Modal Header */}
        <div
          className={cn(
            'flex items-center justify-between px-6 py-4 border-b select-none shrink-0',
            appDesignTheme === 'linear'
              ? 'border-white/10 bg-[#0E1015]'
              : 'border-slate-200/80 dark:border-slate-800/80'
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shadow-inner',
                appDesignTheme === 'linear'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'bg-gradient-to-tr from-sky-500 to-indigo-600 text-white shadow-sky-500/20'
              )}
            >
              <FileSearch className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                  Akıllı OCR Studio
                </h2>
                <span
                  className={cn(
                    'text-[11px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1',
                    appDesignTheme === 'linear'
                      ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-800/50'
                      : 'bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300'
                  )}
                >
                  <Sparkles className="w-3 h-3" />
                  Tesseract.js v7 Neural
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Taranmış evrak ve fotoğraflardan yüksek doğrulukla metin tanıma & aranabilir PDF katmanı
              </p>
            </div>
          </div>

          <button
            onClick={() => setOcrModalOpen(false)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Configuration Bar */}
        <div
          className={cn(
            'px-6 py-3.5 border-b flex flex-wrap items-center justify-between gap-4 shrink-0 text-xs',
            appDesignTheme === 'linear'
              ? 'bg-[#0b0c0f] border-white/10'
              : 'bg-slate-50/70 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800'
          )}
        >
          {/* Target Pages */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-sky-500" /> Sayfalar:
            </span>
            <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setPageScope('current')}
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-all',
                  pageScope === 'current'
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                )}
              >
                Bu Sayfa ({activePageNum})
              </button>
              <button
                onClick={() => setPageScope('all')}
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-all',
                  pageScope === 'all'
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                )}
              >
                Tümü ({totalPages})
              </button>
              <button
                onClick={() => setPageScope('custom')}
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-all',
                  pageScope === 'custom'
                    ? 'bg-sky-500 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                )}
              >
                Özel
              </button>
            </div>

            {pageScope === 'custom' && (
              <input
                type="text"
                value={customRange}
                onChange={(e) => setCustomRange(e.target.value)}
                placeholder="Örn: 1-3, 5"
                className="w-24 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-sky-500 text-xs"
              />
            )}
          </div>

          {/* Language Selector */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Languages className="w-3.5 h-3.5 text-indigo-500" /> Dil:
            </span>
            <select
              value={selectedLang}
              onChange={(e) => setSelectedLang(e.target.value as OcrLanguage)}
              className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-sky-500 font-medium cursor-pointer"
            >
              <option value="tur">🇹🇷 Türkçe (tur)</option>
              <option value="eng">🇬🇧 English (eng)</option>
              <option value="tur+eng">🇹🇷 + 🇬🇧 Türkçe & İngilizce</option>
              <option value="deu">🇩🇪 Deutsch (deu)</option>
              <option value="fra">🇫🇷 Français (fra)</option>
            </select>
          </div>

          {/* Options: Enhance Contrast & Bounding Boxes */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-600 dark:text-slate-300 select-none">
              <input
                type="checkbox"
                checked={enhanceContrast}
                onChange={(e) => setEnhanceContrast(e.target.checked)}
                className="rounded text-sky-600 focus:ring-sky-500 w-3.5 h-3.5"
              />
              <span>Kontrast Güçlendirme</span>
            </label>

            <button
              onClick={handleStartOcr}
              disabled={isRunning}
              className={cn(
                'px-4 py-1.5 rounded-lg font-semibold flex items-center gap-2 shadow-sm transition-all',
                isRunning
                  ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                  : appDesignTheme === 'linear'
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                  : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white active:scale-95'
              )}
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Taranıyor...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>OCR Taramasını Başlat</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Progress Bar (when running) */}
        {isRunning && progress && (
          <div className="px-6 py-2.5 bg-sky-500/10 border-b border-sky-500/20 shrink-0 flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-sky-700 dark:text-sky-300 font-medium">
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-500" />
                {progress.statusText}
              </span>
              <span className="font-bold">%{progress.overallProgress}</span>
            </div>
            <div className="w-full h-1.5 bg-sky-200/50 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-300 rounded-full"
                style={{ width: `${progress.overallProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Main Split Body */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
          {/* Left Panel: Scanned Visual + Bounding Boxes */}
          <div className="w-full md:w-1/2 p-4 flex flex-col border-b md:border-b-0 md:border-r border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-950/40 overflow-hidden">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-sky-500" />
                Görsel Sayfa & Algılanan Kutular
              </span>

              {ocrResult && ocrResult.pages.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    disabled={activeResultPageIndex === 0}
                    onClick={() => setActiveResultPageIndex((p) => Math.max(0, p - 1))}
                    className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-slate-600 dark:text-slate-400 font-mono">
                    {activeResultPageIndex + 1} / {ocrResult.pages.length}
                  </span>
                  <button
                    disabled={activeResultPageIndex >= ocrResult.pages.length - 1}
                    onClick={() =>
                      setActiveResultPageIndex((p) => Math.min(ocrResult.pages.length - 1, p + 1))
                    }
                    className="p-1 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 disabled:opacity-40"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex-1 relative flex items-center justify-center bg-slate-200/50 dark:bg-slate-900 rounded-xl overflow-auto border border-slate-200 dark:border-slate-800 p-2 min-h-[300px]">
              {activePageResult ? (
                <div className="relative max-h-full inline-block select-none shadow-lg rounded-sm overflow-hidden">
                  <img
                    src={activePageResult.previewUrl}
                    alt={`Sayfa ${activePageResult.pageNumber}`}
                    className="max-h-[58vh] w-auto block object-contain"
                  />

                  {/* Bounding Box Highlights */}
                  {showBoundingBoxes &&
                    activePageResult.words.map((word, wIdx) => {
                      const isHovered = hoveredWord === word;
                      return (
                        <div
                          key={wIdx}
                          onMouseEnter={() => setHoveredWord(word)}
                          onMouseLeave={() => setHoveredWord(null)}
                          style={{
                            left: `${word.normBbox.x * 100}%`,
                            top: `${word.normBbox.y * 100}%`,
                            width: `${word.normBbox.width * 100}%`,
                            height: `${word.normBbox.height * 100}%`,
                          }}
                          className={cn(
                            'absolute border transition-colors cursor-pointer pointer-events-auto',
                            isHovered
                              ? 'bg-amber-400/40 border-amber-500 z-30 shadow-[0_0_8px_rgba(245,158,11,0.8)]'
                              : word.confidence > 85
                              ? 'border-emerald-500/30 hover:border-emerald-500 hover:bg-emerald-500/20'
                              : 'border-rose-500/30 hover:border-rose-500 hover:bg-rose-500/20'
                          )}
                          title={`${word.text} (%${word.confidence} güven)`}
                        />
                      );
                    })}
                </div>
              ) : (
                <div className="text-center p-6 text-slate-400 dark:text-slate-500 flex flex-col items-center gap-2">
                  <FileSearch className="w-12 h-12 opacity-40 stroke-[1.5]" />
                  <p className="text-xs max-w-xs">
                    Yukarıdaki ayarlardan dilediğiniz dili ve sayfaları seçip{' '}
                    <strong className="text-slate-700 dark:text-slate-300">
                      "OCR Taramasını Başlat"
                    </strong>{' '}
                    butonuna tıklayın.
                  </p>
                </div>
              )}
            </div>

            {/* Visual bottom tools */}
            {activePageResult && (
              <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showBoundingBoxes}
                    onChange={(e) => setShowBoundingBoxes(e.target.checked)}
                    className="rounded text-sky-600 focus:ring-sky-500 w-3 h-3"
                  />
                  <span>Kelime Kutularını Göster ({activePageResult.words.length} kelime)</span>
                </label>

                {hoveredWord && (
                  <span className="font-mono text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/80 px-2 py-0.5 rounded border border-sky-200 dark:border-sky-800">
                    "{hoveredWord.text}" • %{hoveredWord.confidence}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Right Panel: Editable Extracted Text */}
          <div className="w-full md:w-1/2 p-4 flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
            <div className="flex items-center justify-between mb-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <FileCheck2 className="w-3.5 h-3.5 text-emerald-500" />
                  Tanınan Metin Editörü
                </span>
                {activePageResult && (
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[10px] font-semibold',
                      activePageResult.confidence > 80
                        ? 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-100 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300'
                    )}
                  >
                    %{activePageResult.confidence} Güven Skoru
                  </span>
                )}
              </div>

              {ocrResult && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
                  <span>{editableText.length} karakter</span>
                  <span>•</span>
                  <span>{editableText.split(/\s+/).filter(Boolean).length} kelime</span>
                </div>
              )}
            </div>

            <div className="flex-1 relative flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
              <textarea
                value={editableText}
                onChange={(e) => setEditableText(e.target.value)}
                placeholder="OCR ile tanınan metin burada görüntülenecektir. İhtiyacınıza göre metin üzerinde doğrudan düzenleme yapabilirsiniz..."
                className={cn(
                  'w-full h-full p-3 resize-none font-sans text-xs sm:text-sm leading-relaxed focus:outline-hidden text-slate-800 dark:text-slate-200 bg-slate-50/50 dark:bg-slate-950/50',
                  appDesignTheme === 'linear' && 'font-mono text-xs'
                )}
              />
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div
          className={cn(
            'px-6 py-3.5 border-t flex flex-wrap items-center justify-between gap-3 shrink-0 select-none',
            appDesignTheme === 'linear'
              ? 'bg-[#0E1015] border-white/10'
              : 'bg-slate-50 dark:bg-slate-950/80 border-slate-200 dark:border-slate-800'
          )}
        >
          {/* Quick Metrics */}
          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            {ocrResult && (
              <>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {ocrResult.totalPages} Sayfa İşlendi
                </span>
                <span>•</span>
                <span>Toplam {ocrResult.totalWords} Kelime</span>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyText}
              disabled={!editableText}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{isCopied ? 'Kopyalandı!' : 'Metni Kopyala'}</span>
            </button>

            <button
              onClick={handleDownloadTxt}
              disabled={!ocrResult}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>TXT İndir</span>
            </button>

            <button
              onClick={handleDownloadJson}
              disabled={!ocrResult}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 transition-colors"
              title="Kelime koordinatları ve güven skorlarını JSON olarak indir"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>JSON İndir</span>
            </button>

            <button
              onClick={handleExportSearchablePdf}
              disabled={!ocrResult || isExportingPdf}
              className={cn(
                'px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm transition-all',
                isExportingPdf
                  ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                  : appDesignTheme === 'linear'
                  ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                  : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white active:scale-95 disabled:opacity-40'
              )}
              title="PDF üzerine görünmez metin katmanı ekleyerek kopyalanabilir ve aranabilir hale getirir"
            >
              {isExportingPdf ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>PDF Hazırlanıyor...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Aranabilir PDF Dışa Aktar</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
