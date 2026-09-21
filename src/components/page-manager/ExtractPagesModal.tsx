import React, { useState, useMemo } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { useViewerStore } from '@/store/viewer-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { historyManager, DeletePageCommand } from '@/core/history/command-manager';
import JSZip from 'jszip';
import {
  X,
  Scissors,
  Files,
  FileText,
  Trash2,
  Download,
  ExternalLink,
  Archive,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const ExtractPagesModal: React.FC = () => {
  const { currentDocument, setDocument } = useDocumentStore();
  const { isExtractPagesModalOpen, setExtractPagesModalOpen, addToast } = useUIStore();
  const { setPageManagerOpen } = useViewerStore();
  const { addTab } = useTabStore();

  const selectedCount = currentDocument?.selectedPageIds.length || 0;
  const totalPages = currentDocument?.pages.length || 0;

  // Extraction Scope: 'selected' | 'all' | 'custom'
  const [scope, setScope] = useState<'selected' | 'all' | 'custom'>(
    selectedCount > 0 ? 'selected' : 'all'
  );
  const [customRangeText, setCustomRangeText] = useState<string>('');

  // Mode: 'single' | 'separate'
  const [mode, setMode] = useState<'single' | 'separate'>('single');

  // Delete after extraction option
  const [deleteAfter, setDeleteAfter] = useState<boolean>(false);

  // Processing indicator
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Parse custom range text (e.g., "1-3, 5, 8-10")
  const parsedCustomPageNumbers = useMemo(() => {
    if (!currentDocument || scope !== 'custom' || !customRangeText.trim()) return [];
    const nums = new Set<number>();
    const parts = customRangeText.split(/[,;\s]+/).filter(Boolean);

    for (const part of parts) {
      if (part.includes('-') || part.includes('–')) {
        const [rawStart, rawEnd] = part.split(/[-–]/);
        const s = parseInt(rawStart, 10);
        const e = parseInt(rawEnd, 10);
        if (!isNaN(s) && !isNaN(e)) {
          const from = Math.max(1, Math.min(s, e, totalPages));
          const to = Math.max(from, Math.min(Math.max(s, e), totalPages));
          for (let p = from; p <= to; p++) nums.add(p);
        }
      } else {
        const n = parseInt(part, 10);
        if (!isNaN(n) && n >= 1 && n <= totalPages) {
          nums.add(n);
        }
      }
    }
    return Array.from(nums).sort((a, b) => a - b);
  }, [currentDocument, scope, customRangeText, totalPages]);

  // Resolve target page IDs based on chosen scope
  const targetPageIds = useMemo(() => {
    if (!currentDocument) return [];
    if (scope === 'selected') {
      return currentDocument.selectedPageIds;
    }
    if (scope === 'all') {
      return currentDocument.pages.map((p) => p.id);
    }
    if (scope === 'custom') {
      return parsedCustomPageNumbers
        .map((num) => currentDocument.pages[num - 1]?.id)
        .filter(Boolean);
    }
    return [];
  }, [currentDocument, scope, parsedCustomPageNumbers]);

  const targetCount = targetPageIds.length;
  const isDeletingAllPages = targetCount >= totalPages && deleteAfter;

  if (!isExtractPagesModalOpen || !currentDocument) return null;

  // Core execution helper
  const executeExtraction = async (destination: 'new-tab' | 'download') => {
    if (targetCount === 0) {
      addToast('Lütfen ayıklamak için en az bir sayfa belirleyin.', 'warning');
      return;
    }

    if (isDeletingAllPages) {
      addToast('Dökümandaki tüm sayfalar silinemez. Belgede en az bir sayfa kalmalıdır.', 'error');
      return;
    }

    try {
      setIsProcessing(true);
      addToast('Sayfalar ayıklanıyor...', 'info');

      const baseName = currentDocument.name.replace(/\.pdf$/i, '');
      const extractResult = await PdfAssembler.extractPages(currentDocument, targetPageIds, {
        separateFiles: mode === 'separate',
        customBaseName: baseName,
      });

      // Handle Destination
      if (destination === 'new-tab') {
        if (extractResult.mode === 'single') {
          const loaded = await PdfLoader.loadDocument(extractResult.name, extractResult.buffer);
          setDocument(loaded.model, loaded.pdfDoc);
          addTab(loaded.model, loaded.pdfDoc);
          setPageManagerOpen(false);
          setExtractPagesModalOpen(false);
          addToast(`${targetCount} sayfa yeni sekmede açıldı!`, 'success');
        } else {
          // If separate files and new-tab chosen, open first file and notify
          const first = extractResult.files[0];
          if (first) {
            const loaded = await PdfLoader.loadDocument(first.name, first.buffer);
            setDocument(loaded.model, loaded.pdfDoc);
            addTab(loaded.model, loaded.pdfDoc);
            setPageManagerOpen(false);
            setExtractPagesModalOpen(false);
            addToast(`İlk sayfa (${first.name}) yeni sekmede açıldı.`, 'success');
          }
        }
      } else if (destination === 'download') {
        if (extractResult.mode === 'single') {
          // Check if Electron save dialog is available
          const electron = (window as any).electronAPI;
          let saved = false;

          if (electron?.showSaveDialog && electron?.saveFile) {
            const dialogRes = await electron.showSaveDialog({
              title: 'Ayıklanan PDF Dosyasını Kaydet',
              defaultPath: extractResult.name,
              filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
            });

            if (!dialogRes.canceled && dialogRes.filePath) {
              await electron.saveFile(dialogRes.filePath, extractResult.buffer);
              saved = true;
              addToast(`PDF başarıyla kaydedildi: ${extractResult.name}`, 'success');
            }
          }

          if (!saved) {
            // Web fallback download
            const blob = new Blob([extractResult.buffer], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = extractResult.name;
            a.click();
            URL.revokeObjectURL(url);
            addToast(`${extractResult.name} başarıyla indirildi!`, 'success');
          }
        } else {
          // Multiple separate PDFs: Package into ZIP
          addToast('Ayrı PDF dosyaları ZIP olarak paketleniyor...', 'info');
          const zip = new JSZip();
          for (const f of extractResult.files) {
            zip.file(f.name, f.buffer);
          }
          const zipBlob = await zip.generateAsync({ type: 'blob' });
          const zipFileName = `${baseName}_ayiklanan_${extractResult.files.length}_sayfa.zip`;

          const electron = (window as any).electronAPI;
          let saved = false;

          if (electron?.showSaveDialog && electron?.saveFile) {
            const dialogRes = await electron.showSaveDialog({
              title: 'Ayıklanan Sayfaları ZIP Olarak Kaydet',
              defaultPath: zipFileName,
              filters: [{ name: 'ZIP Arşivi', extensions: ['zip'] }],
            });

            if (!dialogRes.canceled && dialogRes.filePath) {
              const zipArrayBuffer = await zipBlob.arrayBuffer();
              await electron.saveFile(dialogRes.filePath, zipArrayBuffer);
              saved = true;
              addToast(`ZIP arşivi başarıyla kaydedildi: ${zipFileName}`, 'success');
            }
          }

          if (!saved) {
            const url = URL.createObjectURL(zipBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipFileName;
            a.click();
            URL.revokeObjectURL(url);
            addToast(`${zipFileName} başarıyla indirildi!`, 'success');
          }
        }
      }

      // Handle Option: Delete pages after extraction (Cut/Move)
      if (deleteAfter && targetCount < totalPages) {
        const deleted = currentDocument.pages
          .map((p, idx) => ({ page: p, index: idx }))
          .filter((item) => targetPageIds.includes(item.page.id));

        if (deleted.length > 0) {
          historyManager.execute(new DeletePageCommand(deleted));
          addToast(`${deleted.length} sayfa orijinal dökümandan kaldırıldı. (Geri almak için Ctrl+Z)`, 'info');
        }
      }

      setExtractPagesModalOpen(false);
    } catch (err: any) {
      console.error('Extract error:', err);
      addToast(err?.message || 'Ayıklama sırasında hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={() => setExtractPagesModalOpen(false)}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shadow-xs">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Sayfaları Ayıkla (Extract)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seçili sayfaları bağımsız veya birleşik yeni PDF belgelerine dönüştürün
              </p>
            </div>
          </div>
          <button
            onClick={() => setExtractPagesModalOpen(false)}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-6 overflow-y-auto max-h-[75vh]">
          {/* Section 1: Page Scope */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              1. Ayıklanacak Sayfalar
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              <button
                type="button"
                onClick={() => setScope('selected')}
                disabled={selectedCount === 0}
                className={cn(
                  'flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all',
                  scope === 'selected'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700',
                  selectedCount === 0 && 'opacity-40 cursor-not-allowed'
                )}
              >
                <CheckCircle2 className="w-4 h-4 mb-1" />
                <span className="text-xs font-bold">Seçili Sayfalar</span>
                <span className="text-[10px] text-slate-400 mt-0.5">
                  {selectedCount > 0 ? `${selectedCount} sayfa seçili` : 'Seçim yok'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setScope('all')}
                className={cn(
                  'flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all',
                  scope === 'all'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                )}
              >
                <Files className="w-4 h-4 mb-1" />
                <span className="text-xs font-bold">Tüm Sayfalar</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Toplam {totalPages} sayfa</span>
              </button>

              <button
                type="button"
                onClick={() => setScope('custom')}
                className={cn(
                  'flex flex-col items-center justify-center p-3 rounded-2xl border text-center transition-all',
                  scope === 'custom'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/50 text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-700'
                )}
              >
                <FileText className="w-4 h-4 mb-1" />
                <span className="text-xs font-bold">Özel Aralık</span>
                <span className="text-[10px] text-slate-400 mt-0.5">Örn: 1-3, 5</span>
              </button>
            </div>

            {/* Custom Range Input Field */}
            {scope === 'custom' && (
              <div className="mt-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Sayfa Numaralarını Girin:
                  </span>
                  <span className="text-sky-600 dark:text-sky-400 font-bold">
                    {parsedCustomPageNumbers.length > 0
                      ? `${parsedCustomPageNumbers.length} sayfa geçerli`
                      : 'Geçersiz aralık'}
                  </span>
                </div>
                <input
                  type="text"
                  value={customRangeText}
                  onChange={(e) => setCustomRangeText(e.target.value)}
                  placeholder="Örnek: 1-3, 5, 8-10"
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
                <p className="text-[11px] text-slate-400 mt-1.5">
                  Virgül veya tire ile birden fazla sayfa aralığı belirtebilirsiniz. (1 ile {totalPages} arasında)
                </p>
              </div>
            )}
          </div>

          {/* Section 2: Format / Mode */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-3">
              2. Ayıklama Modu
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all',
                  mode === 'single'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-300'
                )}
              >
                <input
                  type="radio"
                  name="extractMode"
                  checked={mode === 'single'}
                  onChange={() => setMode('single')}
                  className="mt-0.5 text-sky-600 focus:ring-sky-500"
                />
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-sky-500" />
                    <span>Tek Bir PDF Olarak Birleştir</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                    Tüm seçili sayfaları tek bir yeni PDF dosyasında toplar.
                  </p>
                </div>
              </label>

              <label
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-2xl border cursor-pointer transition-all',
                  mode === 'separate'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                    : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-600 dark:text-slate-300'
                )}
              >
                <input
                  type="radio"
                  name="extractMode"
                  checked={mode === 'separate'}
                  onChange={() => setMode('separate')}
                  className="mt-0.5 text-sky-600 focus:ring-sky-500"
                />
                <div>
                  <div className="text-xs font-bold flex items-center gap-1.5">
                    <Archive className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Her Sayfayı Ayrı PDF Yap (ZIP)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-snug">
                    Her sayfayı bağımsız bir dosya yapar, ZIP arşivi olarak indirir.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Section 3: Options */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">
              3. Seçenekler
            </label>
            <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40">
              <label
                className={cn(
                  'flex items-center gap-3 cursor-pointer select-none text-xs font-medium',
                  targetCount >= totalPages && 'opacity-50 cursor-not-allowed text-slate-400'
                )}
              >
                <input
                  type="checkbox"
                  checked={deleteAfter}
                  onChange={(e) => setDeleteAfter(e.target.checked)}
                  disabled={targetCount >= totalPages}
                  className="w-4 h-4 rounded-md text-rose-600 border-slate-300 dark:border-slate-700 focus:ring-rose-500"
                />
                <span className="flex items-center gap-1.5 text-slate-700 dark:text-slate-200">
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Ayıkladıktan sonra bu sayfaları orijinal dökümandan sil (Taşı / Cut)</span>
                </span>
              </label>
              {targetCount >= totalPages && (
                <div className="flex items-center gap-1.5 mt-2 text-[11px] text-amber-500">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>Dökümandaki tüm sayfalar silinemez. Belgede en az 1 sayfa kalmalıdır.</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/70">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {targetCount > 0 ? (
              <span className="text-sky-600 dark:text-sky-400 font-bold">
                Toplam {targetCount} sayfa ayıklanacak
              </span>
            ) : (
              <span className="text-amber-500">Sayfa seçilmedi</span>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setExtractPagesModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors"
            >
              Vazgeç
            </button>

            {mode === 'single' && (
              <button
                type="button"
                onClick={() => executeExtraction('new-tab')}
                disabled={targetCount === 0 || isProcessing}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900 disabled:opacity-40 transition-all shadow-xs"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Yeni Sekmede Aç</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => executeExtraction('download')}
              disabled={targetCount === 0 || isProcessing}
              className="flex items-center gap-1.5 px-4.5 py-2 rounded-xl text-xs font-bold bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-40 transition-all shadow-md shadow-sky-600/25 active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{mode === 'single' ? 'PDF Olarak Kaydet' : 'ZIP Olarak Kaydet'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
