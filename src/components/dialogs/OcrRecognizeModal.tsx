import React, { useState, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { useTabStore } from '@/store/tab-store';
import { binaryStore } from '@/core/storage/binary-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import {
  OcrService,
  OcrLanguage,
  OcrDocumentResult,
  OcrProgress,
  OcrEnhanceMode,
  OcrPageSegMode,
} from '@/core/ocr/ocr-service';
import { SearchablePdfEngine } from '@/core/ocr/searchable-pdf-engine';
import { OcrTextTransfer, TextTransferOptions } from '@/core/ocr/ocr-text-transfer';
import {
  X,
  Sparkles,
  Search,
  Type,
  FileText,
  Copy,
  Download,
  Check,
  Loader2,
  Languages,
  CheckCircle2,
  ExternalLink,
  Layers,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export type OcrWorkflowMode = 'searchable' | 'editable' | 'extract';

export const OcrRecognizeModal: React.FC = () => {
  const { isOcrModalOpen, setOcrModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy, setDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const currentPageIndex = currentDocument?.activePageIndex || 0;
  const appDesignTheme = useViewerStore((s) => s.appDesignTheme) || 'fluent';

  // Workflow Mode (PDF24 & Adobe Acrobat Pro Standards)
  const [workflowMode, setWorkflowMode] = useState<OcrWorkflowMode>('searchable');

  // Configuration
  const [pageScope, setPageScope] = useState<'current' | 'all' | 'custom'>('all');
  const [customRange, setCustomRange] = useState('');
  const [selectedLang, setSelectedLang] = useState<OcrLanguage>('tur+eng');
  const [cleanPaper, setCleanPaper] = useState(true);
  const [hideScanUnderneath, setHideScanUnderneath] = useState(true);

  // Runtime State
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrDocumentResult | null>(null);
  const [searchablePdfBytes, setSearchablePdfBytes] = useState<Uint8Array | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const abortRef = useRef(false);

  // Reset state on close or document change
  useEffect(() => {
    if (!isOcrModalOpen) {
      abortRef.current = true;
      setIsProcessing(false);
      setProgress(null);
      setOcrResult(null);
      setSearchablePdfBytes(null);
    } else {
      abortRef.current = false;
    }
  }, [isOcrModalOpen]);

  if (!isOcrModalOpen || !currentDocument || !pdfDocProxy) return null;

  const totalPages = pdfDocProxy.numPages;
  const activePageNum = currentPageIndex + 1;

  const resolveTargetPages = (): number[] => {
    if (pageScope === 'current') return [activePageNum];
    if (pageScope === 'all') return Array.from({ length: totalPages }, (_, i) => i + 1);

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

    setIsProcessing(true);
    setProgress(null);
    setOcrResult(null);
    setSearchablePdfBytes(null);
    abortRef.current = false;

    try {
      const enhanceMode: OcrEnhanceMode = cleanPaper ? 'smart' : 'raw';
      const psm: OcrPageSegMode = '3';

      addToast(
        `${targetPages.length} sayfa için ${workflowMode === 'searchable' ? 'Aranabilir PDF' : 'Metin Tanıma'} başlatıldı...`,
        'info'
      );

      const result = await OcrService.processDocumentPages(
        pdfDocProxy,
        targetPages,
        selectedLang,
        enhanceMode,
        psm,
        (prog) => {
          if (!abortRef.current) {
            setProgress(prog);
          }
        }
      );

      if (abortRef.current) return;
      setOcrResult(result);

      // Workflow Mode 1: Searchable PDF (PDF24 & Adobe Acrobat Pro Standard)
      if (workflowMode === 'searchable') {
        const originalBuffer = binaryStore.get(currentDocument.id);
        if (originalBuffer) {
          const searchableBytes = await SearchablePdfEngine.createSearchablePdf(
            originalBuffer,
            result.pages
          );
          if (!abortRef.current) {
            setSearchablePdfBytes(searchableBytes);
            addToast('Aranabilir PDF katmanı hazırlandı!', 'success');
          }
        } else {
          addToast('Orijinal belge bellekte bulunamadı.', 'error');
        }
      } else if (workflowMode === 'editable') {
        // Workflow Mode 2: Adobe Acrobat Pro In-Place Editable Text
        const options: TextTransferOptions = {
          mode: 'paragraph',
          hideOriginalScan: hideScanUnderneath,
          fontSizeMultiplier: 1.0,
          fontColor: '#0f172a',
          fontFamily: 'Helvetica, Arial, sans-serif',
        };

        if (result.pages.length === 1) {
          const res = OcrTextTransfer.transferSinglePage(result.pages[0], options);
          if (res.success) {
            addToast(
              `Sayfa ${result.pages[0].pageNumber}'e ${res.count} düzenlenebilir metin kutusu aktarıldı!`,
              'success',
              4500
            );
            setOcrModalOpen(false);
          } else {
            addToast('Sayfaya aktarılacak metin bulunamadı.', 'warning');
          }
        } else {
          const res = OcrTextTransfer.transferMultiplePages(result.pages, options);
          if (res.success) {
            addToast(
              `${res.pagesAffected} sayfaya toplam ${res.totalCount} düzenlenebilir metin aktarıldı! (Ctrl+Z ile geri alınabilir)`,
              'success',
              4500
            );
            setOcrModalOpen(false);
          } else {
            addToast('Sayfalara aktarılacak metin bulunamadı.', 'warning');
          }
        }
      } else {
        // Workflow Mode 3: Extract Text
        addToast(`${result.totalWords} kelime başarıyla ayıklandı!`, 'success');
      }
    } catch (err: any) {
      console.error('OCR Process Error:', err);
      addToast(`İşlem sırasında hata oluştu: ${err.message || err}`, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // Action: Apply Searchable PDF Directly into the Viewer (In-Place Update)
  const handleApplyToCurrentDocument = async () => {
    if (!searchablePdfBytes) return;
    setIsApplying(true);
    try {
      const loaded = await PdfLoader.loadDocument(
        currentDocument.name,
        searchablePdfBytes.buffer,
        currentDocument.filePath
      );
      setDocument(loaded.model, loaded.pdfDoc);
      addTab(loaded.model, loaded.pdfDoc);
      addToast('✓ Belge güncellendi! Artık metinleri seçebilir, kopyalayabilir ve arama (Ctrl+F) yapabilirsiniz.', 'success', 5000);
      setOcrModalOpen(false);
    } catch (err) {
      console.error(err);
      addToast('Belge güncellenirken hata oluştu.', 'error');
    } finally {
      setIsApplying(false);
    }
  };

  // Action: Open in New Tab
  const handleOpenInNewTab = async () => {
    if (!searchablePdfBytes) return;
    try {
      const newName = currentDocument.name.replace(/\.pdf$/i, '') + ' (Aranabilir).pdf';
      const loaded = await PdfLoader.loadDocument(newName, searchablePdfBytes.buffer);
      setDocument(loaded.model, loaded.pdfDoc);
      addTab(loaded.model, loaded.pdfDoc);
      addToast('Aranabilir PDF yeni sekmede açıldı.', 'success');
      setOcrModalOpen(false);
    } catch (err) {
      console.error(err);
      addToast('Yeni sekmede açılamadı.', 'error');
    }
  };

  // Action: Download Searchable PDF File
  const handleDownloadPdf = () => {
    if (!searchablePdfBytes) return;
    const blob = new Blob([searchablePdfBytes as any], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentDocument.name.replace(/\.pdf$/i, '') + ' (Aranabilir).pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast('Aranabilir PDF indirildi.', 'success');
  };

  // Action: Copy Extracted Text
  const handleCopyText = async () => {
    if (!ocrResult) return;
    try {
      await navigator.clipboard.writeText(ocrResult.fullText);
      setIsCopied(true);
      addToast('Tüm metin panoya kopyalandı!', 'success');
      setTimeout(() => setIsCopied(false), 2500);
    } catch {
      addToast('Panoya kopyalanamadı.', 'error');
    }
  };

  // Action: Download Extracted Text as TXT
  const handleDownloadTxt = () => {
    if (!ocrResult) return;
    const blob = new Blob([ocrResult.fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = currentDocument.name.replace(/\.pdf$/i, '') + '_Metin.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addToast('Metin dosyası indirildi.', 'success');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className={cn(
          'w-full max-w-2xl rounded-2xl shadow-2xl flex flex-col overflow-hidden border transition-all',
          appDesignTheme === 'linear'
            ? 'bg-[#0f1115] border-white/10 text-white'
            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'px-6 py-4 border-b flex items-center justify-between shrink-0',
            appDesignTheme === 'linear'
              ? 'bg-[#14171d] border-white/10'
              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800'
          )}
        >
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'w-10 h-10 rounded-xl flex items-center justify-center shadow-xs',
                appDesignTheme === 'linear'
                  ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                  : 'bg-gradient-to-tr from-sky-500 to-indigo-600 text-white'
              )}
            >
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">
                  Metin Tanıma (OCR) & Aranabilir Belge
                </h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" /> PDF24 & Acrobat Pro Motoru
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Taranmış dökümanları seçilebilir, aranabilir (Ctrl+F) ve düzenlenebilir hale getirin
              </p>
            </div>
          </div>

          <button
            onClick={() => setOcrModalOpen(false)}
            disabled={isProcessing}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto max-h-[75vh] space-y-6 text-xs sm:text-sm">
          {/* Section 1: Output Mode Cards (PDF24 & Adobe Acrobat Standard) */}
          {!ocrResult && !isProcessing && (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                1. Çıktı Türü ve Eylem Modu
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {/* Mode 1: Searchable PDF (Recommended) */}
                <button
                  type="button"
                  onClick={() => setWorkflowMode('searchable')}
                  className={cn(
                    'p-4 rounded-xl border text-left flex flex-col justify-between gap-3 transition-all relative',
                    workflowMode === 'searchable'
                      ? 'border-sky-500 bg-sky-50/60 dark:bg-sky-950/30 ring-2 ring-sky-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                  )}
                >
                  <div className="flex items-start justify-between w-full">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                      <Search className="w-4 h-4" />
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300">
                      Önerilen
                    </span>
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-xs mb-1">
                      Aranabilir PDF Katmanı
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Orijinal kağıt kalitesini bozmadan seçilebilir, kopyalanabilir ve Ctrl+F ile aranabilir yapar (PDF24 / Acrobat Standart).
                    </p>
                  </div>
                </button>

                {/* Mode 2: Editable In-Place Text (Acrobat Pro) */}
                <button
                  type="button"
                  onClick={() => setWorkflowMode('editable')}
                  className={cn(
                    'p-4 rounded-xl border text-left flex flex-col justify-between gap-3 transition-all relative',
                    workflowMode === 'editable'
                      ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30 ring-2 ring-indigo-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                  )}
                >
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                    <Type className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-xs mb-1">
                      Düzenlenebilir Metin
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Yazıları sayfa üzerinde doğrudan tıklanıp düzenlenebilir metin kutularına çevirir (Acrobat Pro Modu).
                    </p>
                  </div>
                </button>

                {/* Mode 3: Extract Text */}
                <button
                  type="button"
                  onClick={() => setWorkflowMode('extract')}
                  className={cn(
                    'p-4 rounded-xl border text-left flex flex-col justify-between gap-3 transition-all relative',
                    workflowMode === 'extract'
                      ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-800/40'
                  )}
                >
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-slate-900 dark:text-white text-xs mb-1">
                      Metin Çıkarıcı
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Belgedeki tüm yazıları düz metin olarak çıkarır, panoya kopyalar veya TXT olarak kaydeder.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Section 2: Parameters */}
          {!ocrResult && !isProcessing && (
            <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">
                2. Tanıma Ayarları
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Language */}
                <div className="space-y-1.5">
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5 text-xs">
                    <Languages className="w-3.5 h-3.5 text-indigo-500" /> Belge Dili:
                  </span>
                  <select
                    value={selectedLang}
                    onChange={(e) => setSelectedLang(e.target.value as OcrLanguage)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-hidden focus:ring-2 focus:ring-sky-500 text-xs font-medium cursor-pointer"
                  >
                    <option value="tur+eng">🇹🇷 + 🇬🇧 Türkçe & İngilizce (Önerilen)</option>
                    <option value="tur">🇹🇷 Yalnızca Türkçe (tur)</option>
                    <option value="eng">🇬🇧 Only English (eng)</option>
                    <option value="deu">🇩🇪 Deutsch (deu)</option>
                    <option value="fra">🇫🇷 Français (fra)</option>
                  </select>
                </div>

                {/* Page Scope */}
                <div className="space-y-1.5">
                  <span className="font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5 text-xs">
                    <Layers className="w-3.5 h-3.5 text-sky-500" /> Sayfa Kapsamı:
                  </span>
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      type="button"
                      onClick={() => setPageScope('all')}
                      className={cn(
                        'flex-1 py-1 px-2 rounded-lg font-medium text-xs transition-all',
                        pageScope === 'all'
                          ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      )}
                    >
                      Tümü ({totalPages})
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageScope('current')}
                      className={cn(
                        'flex-1 py-1 px-2 rounded-lg font-medium text-xs transition-all',
                        pageScope === 'current'
                          ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      )}
                    >
                      Sayfa {activePageNum}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPageScope('custom')}
                      className={cn(
                        'flex-1 py-1 px-2 rounded-lg font-medium text-xs transition-all',
                        pageScope === 'custom'
                          ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      )}
                    >
                      Özel
                    </button>
                  </div>
                </div>
              </div>

              {pageScope === 'custom' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Aralık Girin:</span>
                  <input
                    type="text"
                    value={customRange}
                    onChange={(e) => setCustomRange(e.target.value)}
                    placeholder="Örn: 1-3, 5, 8-10"
                    className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                  />
                </div>
              )}

              {/* Toggles (PDF24 style Deskew & Clean Paper) */}
              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-700 dark:text-slate-300 select-none">
                  <input
                    type="checkbox"
                    checked={cleanPaper}
                    onChange={(e) => setCleanPaper(e.target.checked)}
                    className="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                  />
                  <span>
                    <strong>PDF24 Görüntü Temizleme:</strong> Gölgeleri ve sararmış kağıt lekelerini otomatik temizle (300 DPI)
                  </span>
                </label>

                {workflowMode === 'editable' && (
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-700 dark:text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={hideScanUnderneath}
                      onChange={(e) => setHideScanUnderneath(e.target.checked)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 dark:border-slate-700 cursor-pointer"
                    />
                    <span>
                      <strong>Acrobat Pro Beyaz Maske:</strong> Taranmış kağıt görüntüsünün üzerini beyaz maske ile ört
                    </span>
                  </label>
                )}
              </div>
            </div>
          )}

          {/* Section 3: Live Processing State */}
          {isProcessing && progress && (
            <div className="py-8 flex flex-col items-center justify-center space-y-4 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-sky-500/20 border-t-sky-500 animate-spin" />
                <Sparkles className="w-6 h-6 text-sky-500 absolute inset-0 m-auto animate-pulse" />
              </div>

              <div className="space-y-1">
                <h3 className="font-bold text-slate-900 dark:text-white text-base">
                  {workflowMode === 'searchable'
                    ? 'Aranabilir PDF Katmanı İşleniyor...'
                    : 'Metinler Tanınıyor...'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {progress.statusText}
                </p>
              </div>

              {/* Progress Bar */}
              <div className="w-full max-w-md bg-slate-100 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-sky-500 to-indigo-600 h-full transition-all duration-300 rounded-full"
                  style={{ width: `${progress.overallProgress}%` }}
                />
              </div>

              <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
                %{progress.overallProgress} Tamamlandı (Sayfa {progress.currentPage} / {progress.totalPages})
              </span>

              <button
                type="button"
                onClick={() => {
                  abortRef.current = true;
                  setIsProcessing(false);
                  addToast('İşlem iptal edildi.', 'info');
                }}
                className="text-xs text-rose-500 hover:text-rose-600 underline font-medium pt-2"
              >
                İptal Et
              </button>
            </div>
          )}

          {/* Section 4: Completion Summary & Actions */}
          {ocrResult && !isProcessing && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-emerald-900 dark:text-emerald-200 text-sm">
                    OCR İşlemi Başarıyla Tamamlandı!
                  </h4>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5">
                    {ocrResult.pages.length} sayfa işlendi • Toplam {ocrResult.totalWords} kelime tanındı • Ortalama Güven: %{ocrResult.averageConfidence}
                  </p>
                </div>
              </div>

              {/* Mode 1: Searchable PDF Action Buttons */}
              {workflowMode === 'searchable' && searchablePdfBytes && (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2">
                    <h5 className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                      Nasıl Kullanmak İstersiniz?
                    </h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Görünmez metin katmanı hazırlandı. Belgeyi hemen görüntüleyiciye uygulayabilir veya indirebilirsiniz.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={handleApplyToCurrentDocument}
                      disabled={isApplying}
                      className="px-4 py-3 rounded-xl font-bold bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white shadow-md flex items-center justify-center gap-2 active:scale-98 transition-all"
                    >
                      {isApplying ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>Mevcut Belgeye Uygula (Hemen Ara & Seç)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleOpenInNewTab}
                      className="px-4 py-3 rounded-xl font-semibold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 flex items-center justify-center gap-2 transition-all"
                    >
                      <ExternalLink className="w-4 h-4" />
                      <span>Yeni Sekmede Aç</span>
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Aranabilir PDF İndir</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleCopyText}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-1.5 transition-all"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopied ? 'Kopyalandı' : 'Metni Kopyala'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Mode 3: Extracted Text View */}
              {workflowMode === 'extract' && (
                <div className="space-y-3">
                  <textarea
                    readOnly
                    value={ocrResult.fullText}
                    rows={8}
                    className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-200 font-mono text-xs focus:outline-hidden"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleCopyText}
                      className="px-4 py-2 rounded-xl text-xs font-bold bg-sky-500 hover:bg-sky-600 text-white flex items-center gap-2 shadow-sm transition-all"
                    >
                      {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{isCopied ? 'Kopyalandı!' : 'Metni Kopyala'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadTxt}
                      className="px-4 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-all"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>TXT Olarak İndir</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          className={cn(
            'px-6 py-3.5 border-t flex items-center justify-between shrink-0',
            appDesignTheme === 'linear'
              ? 'bg-[#14171d] border-white/10'
              : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800'
          )}
        >
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {ocrResult ? (
              <button
                type="button"
                onClick={() => {
                  setOcrResult(null);
                  setSearchablePdfBytes(null);
                }}
                className="flex items-center gap-1 hover:text-slate-800 dark:hover:text-slate-200"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Tekrar Ayarla
              </button>
            ) : (
              <span>300 DPI Tesseract Neural Motoru</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setOcrModalOpen(false)}
              disabled={isProcessing}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              {ocrResult ? 'Kapat' : 'Vazgeç'}
            </button>

            {!ocrResult && (
              <button
                type="button"
                onClick={handleStartOcr}
                disabled={isProcessing}
                className={cn(
                  'px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2 shadow-md transition-all',
                  isProcessing
                    ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'
                    : appDesignTheme === 'linear'
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-black shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                    : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white active:scale-95'
                )}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>İşleniyor...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>OCR Başlat ({workflowMode === 'searchable' ? 'Aranabilir PDF' : workflowMode === 'editable' ? 'Düzenlenebilir' : 'Metin Çıkar'})</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
