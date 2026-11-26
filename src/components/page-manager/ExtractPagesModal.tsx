import React, { useState, useMemo, useEffect } from 'react';
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
import {
  parsePageRange,
  saveBinaryOrBlobFile,
  useModalEscape,
} from '@/components/dialogs/modal-utils';

export const ExtractPagesModal: React.FC = () => {
  const { currentDocument, setDocument } = useDocumentStore();
  const { isExtractPagesModalOpen, setExtractPagesModalOpen, addToast } = useUIStore();
  const { setPageManagerOpen } = useViewerStore();
  const { addTab, updateTabModel } = useTabStore();

  const selectedCount = currentDocument?.selectedPageIds.length || 0;
  const totalPages = currentDocument?.pages.length || 0;

  const [scope, setScope] = useState<'selected' | 'all' | 'custom'>(
    selectedCount > 0 ? 'selected' : 'all'
  );
  const [customRangeText, setCustomRangeText] = useState<string>('');
  const [mode, setMode] = useState<'single' | 'separate'>('single');
  const [deleteAfter, setDeleteAfter] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Reset modal controls cleanly every time the modal opens
  useEffect(() => {
    if (isExtractPagesModalOpen) {
      setScope(selectedCount > 0 ? 'selected' : 'all');
      setCustomRangeText('');
      setMode('single');
      setDeleteAfter(false);
    }
  }, [isExtractPagesModalOpen, selectedCount]);

  useModalEscape(
    isExtractPagesModalOpen,
    () => setExtractPagesModalOpen(false),
    isProcessing
  );

  const customRangeValidation = useMemo(() => {
    if (!currentDocument || scope !== 'custom') {
      return { pages: [] as number[], isValid: true, error: undefined as string | undefined };
    }
    return parsePageRange(customRangeText, totalPages);
  }, [currentDocument, scope, customRangeText, totalPages]);

  const targetPageIds = useMemo(() => {
    if (!currentDocument) return [];
    if (scope === 'selected') {
      return currentDocument.selectedPageIds;
    }
    if (scope === 'all') {
      return currentDocument.pages.map((p) => p.id);
    }
    if (scope === 'custom' && customRangeValidation.isValid) {
      return customRangeValidation.pages
        .map((num) => currentDocument.pages[num - 1]?.id)
        .filter((id): id is string => Boolean(id));
    }
    return [];
  }, [currentDocument, scope, customRangeValidation]);

  const targetCount = targetPageIds.length;
  const isDeletingAllPages = targetCount >= totalPages && deleteAfter;

  if (!isExtractPagesModalOpen || !currentDocument) return null;

  const executeSourceDeletionIfRequested = () => {
    if (!deleteAfter || targetCount >= totalPages) return;
    const sourceDoc = useDocumentStore.getState().currentDocument;
    if (!sourceDoc) return;

    const deleted = sourceDoc.pages
      .map((p, idx) => ({ page: p, index: idx }))
      .filter((item) => targetPageIds.includes(item.page.id));

    if (deleted.length > 0) {
      historyManager.execute(new DeletePageCommand(deleted));
      const updatedSource = useDocumentStore.getState().currentDocument;
      if (updatedSource) {
        updateTabModel(updatedSource);
      }
      addToast(
        `${deleted.length} sayfa orijinal dökümandan kaldırıldı. (Geri almak için Ctrl+Z)`,
        'info'
      );
    }
  };

  const executeExtraction = async (destination: 'new-tab' | 'download') => {
    if (scope === 'custom' && !customRangeValidation.isValid) {
      addToast(customRangeValidation.error || 'Lütfen geçerli bir sayfa aralığı girin.', 'warning');
      return;
    }
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

      const sourceDoc = currentDocument;
      const baseName = sourceDoc.name.replace(/\.pdf$/i, '');
      const extractResult = await PdfAssembler.extractPages(sourceDoc, targetPageIds, {
        separateFiles: mode === 'separate',
        customBaseName: baseName,
      });

      if (destination === 'new-tab') {
        const target =
          extractResult.mode === 'single' ? extractResult : extractResult.files[0];

        if (target) {
          const loaded = await PdfLoader.loadDocument(target.name, target.buffer);

          // Delete from SOURCE document BEFORE switching active document/tab to the extracted PDF
          executeSourceDeletionIfRequested();

          setDocument(loaded.model, loaded.pdfDoc);
          addTab(loaded.model, loaded.pdfDoc);
          setPageManagerOpen(false);
          setExtractPagesModalOpen(false);
          addToast(
            extractResult.mode === 'single'
              ? `${targetCount} sayfa yeni sekmede açıldı!`
              : `İlk sayfa (${target.name}) yeni sekmede açıldı.`,
            'success'
          );
        }
        return;
      }

      if (extractResult.mode === 'single') {
        const saveRes = await saveBinaryOrBlobFile({
          data: extractResult.buffer,
          defaultName: extractResult.name,
          dialogTitle: 'Ayıklanan PDF Dosyasını Kaydet',
          filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
          mimeType: 'application/pdf',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }

        addToast(`PDF başarıyla kaydedildi: ${extractResult.name}`, 'success');
      } else {
        addToast('Ayrı PDF dosyaları ZIP olarak paketleniyor...', 'info');
        const zip = new JSZip();
        for (const f of extractResult.files) {
          zip.file(f.name, f.buffer);
        }
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipFileName = `${baseName}_ayiklanan_${extractResult.files.length}_sayfa.zip`;

        const saveRes = await saveBinaryOrBlobFile({
          data: zipBlob,
          defaultName: zipFileName,
          dialogTitle: 'Ayıklanan Sayfaları ZIP Olarak Kaydet',
          filters: [{ name: 'ZIP Arşivi', extensions: ['zip'] }],
          mimeType: 'application/zip',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }

        addToast(`ZIP arşivi başarıyla kaydedildi: ${zipFileName}`, 'success');
      }

      executeSourceDeletionIfRequested();
      setExtractPagesModalOpen(false);
    } catch (err: unknown) {
      console.error('Extract error:', err);
      const message = err instanceof Error ? err.message : 'Ayıklama sırasında hata oluştu.';
      addToast(message, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={() => !isProcessing && setExtractPagesModalOpen(false)}
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
            type="button"
            onClick={() => !isProcessing && setExtractPagesModalOpen(false)}
            disabled={isProcessing}
            aria-label="Kapat"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
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

            {scope === 'custom' && (
              <div className="mt-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    Sayfa Numaralarını Girin:
                  </span>
                  <span
                    className={cn(
                      'font-bold',
                      customRangeValidation.isValid
                        ? 'text-sky-600 dark:text-sky-400'
                        : 'text-rose-500'
                    )}
                  >
                    {customRangeValidation.isValid
                      ? `${customRangeValidation.pages.length} sayfa geçerli`
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
                {!customRangeValidation.isValid && customRangeValidation.error ? (
                  <p className="text-[11px] text-rose-500 mt-1.5">{customRangeValidation.error}</p>
                ) : (
                  <p className="text-[11px] text-slate-400 mt-1.5">
                    Virgül veya tire ile birden fazla sayfa aralığı belirtebilirsiniz. (1 ile {totalPages} arasında)
                  </p>
                )}
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
                    Her sayfayı bağımsız bir dosya yapar, ZIP arşivi olarak kaydeder.
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
                  <span>Ayıkladıktan sonra bu sayfaları orijinal dökümandan sil (Taşı)</span>
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
              disabled={isProcessing}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
            >
              Vazgeç
            </button>

            {mode === 'single' && (
              <button
                type="button"
                onClick={() => executeExtraction('new-tab')}
                disabled={targetCount === 0 || isProcessing || !customRangeValidation.isValid}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900 disabled:opacity-40 transition-all shadow-xs"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Yeni Sekmede Aç</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => executeExtraction('download')}
              disabled={targetCount === 0 || isProcessing || !customRangeValidation.isValid}
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
