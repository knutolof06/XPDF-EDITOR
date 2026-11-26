import React, { useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { historyManager, DocumentStateSnapshotCommand } from '@/core/history/command-manager';
import {
  X,
  FilePlus,
  FileText,
  Check,
  Loader2,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  syncReplacedActiveDocument,
  useModalEscape,
  useResolvedDarkMode,
} from './modal-utils';

export const InsertBlankPageModal: React.FC = () => {
  const {
    isInsertBlankPageModalOpen,
    pendingBlankPageInsertIndex,
    setInsertBlankPageModalOpen,
    addToast,
  } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const isDark = useResolvedDarkMode();

  const [positionType, setPositionType] = useState<'custom_index' | 'after_selected' | 'start' | 'end'>('after_selected');
  const [pageSize, setPageSize] = useState<'a4' | 'letter' | 'match'>('a4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [pageCount, setPageCount] = useState<number>(1);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const totalPages = currentDocument?.pages.length || 1;
  const activePageIndex = currentDocument?.activePageIndex ?? 0;
  const hasExplicitPendingIndex =
    pendingBlankPageInsertIndex !== null && pendingBlankPageInsertIndex !== undefined;

  useEffect(() => {
    if (!isInsertBlankPageModalOpen) return;
    setPositionType(hasExplicitPendingIndex ? 'custom_index' : 'after_selected');
    setPageCount(1);
  }, [isInsertBlankPageModalOpen, hasExplicitPendingIndex]);

  useModalEscape(
    isInsertBlankPageModalOpen,
    () => setInsertBlankPageModalOpen(false, null),
    isProcessing
  );

  if (!isInsertBlankPageModalOpen || !currentDocument) return null;

  const calculateTargetIndex = (): number => {
    if (positionType === 'custom_index' && hasExplicitPendingIndex) {
      return Math.max(0, Math.min(totalPages, pendingBlankPageInsertIndex!));
    }
    if (positionType === 'start') return 0;
    if (positionType === 'end') return totalPages;
    return Math.min(totalPages, activePageIndex + 1);
  };

  const handleInsert = async () => {
    setIsProcessing(true);
    const targetIdx = calculateTargetIndex();

    try {
      const prevDocModel = currentDocument;
      const prevPdfProxy = pdfDocProxy;

      const result = await PdfAssembler.insertBlankPage(
        currentDocument,
        targetIdx,
        pageSize,
        orientation,
        pageCount
      );

      const synced = syncReplacedActiveDocument(result.model, result.pdfDoc, prevDocModel, {
        isModified: true,
      });

      historyManager.push(
        new DocumentStateSnapshotCommand(
          `${pageCount} adet boş sayfa eklendi`,
          prevDocModel,
          prevPdfProxy,
          synced,
          result.pdfDoc
        )
      );

      addToast(
        pageCount === 1 ? '1 adet boş sayfa eklendi.' : `${pageCount} adet boş sayfa eklendi.`,
        'success'
      );
      setInsertBlankPageModalOpen(false, null);
    } catch (err: unknown) {
      console.error('Insert blank page error:', err);
      addToast('Boş sayfa eklenirken hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const targetIdxPreview = calculateTargetIndex();
  const middleLabel = hasExplicitPendingIndex
    ? `${pendingBlankPageInsertIndex}. Sayfa Sonrasına`
    : `Sayfa ${activePageIndex + 1} Sonrasına`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => !isProcessing && setInsertBlankPageModalOpen(false, null)}
    >
      <div
        className={cn(
          'w-full max-w-md rounded-2xl border shadow-2xl flex flex-col overflow-hidden transition-colors',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'px-6 py-4 border-b flex items-center justify-between shrink-0',
            isDark ? 'border-slate-800 bg-slate-900/80' : 'border-slate-100 bg-slate-50'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center">
              <FilePlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Boş Sayfa Ekle</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dökümana yeni bir veya birden fazla temiz sayfa ekleyin.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => !isProcessing && setInsertBlankPageModalOpen(false, null)}
            disabled={isProcessing}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs">
          {/* Position Selector */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Sayfa Konumu:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPositionType('start')}
                className={cn(
                  'p-2.5 rounded-xl border text-center font-semibold transition-all',
                  positionType === 'start'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                En Başa
              </button>

              <button
                type="button"
                onClick={() =>
                  setPositionType(hasExplicitPendingIndex ? 'custom_index' : 'after_selected')
                }
                className={cn(
                  'p-2.5 rounded-xl border text-center font-semibold transition-all',
                  positionType === 'after_selected' || positionType === 'custom_index'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                {middleLabel}
              </button>

              <button
                type="button"
                onClick={() => setPositionType('end')}
                className={cn(
                  'p-2.5 rounded-xl border text-center font-semibold transition-all',
                  positionType === 'end'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                En Sona
              </button>
            </div>
          </div>

          {/* Page Size & Count */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Sayfa Boyutu:
              </label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as 'a4' | 'letter' | 'match')}
                className={cn(
                  'w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                )}
              >
                <option value="a4">A4 (Standart - 210×297 mm)</option>
                <option value="letter">Letter (216×279 mm)</option>
                <option value="match">Mevcut Sayfa Boyutunda</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                Eklenecek Sayfa Adedi:
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={pageCount}
                onChange={(e) => setPageCount(Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1)))}
                className={cn(
                  'w-full px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 font-medium text-center',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                )}
              />
            </div>
          </div>

          {/* Orientation */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
              Sayfa Yönü:
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOrientation('portrait')}
                className={cn(
                  'p-2.5 rounded-xl border flex items-center justify-center gap-2 font-semibold transition-all',
                  orientation === 'portrait'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                <FileText className="w-4 h-4" />
                <span>Dikey (Portrait)</span>
              </button>

              <button
                type="button"
                onClick={() => setOrientation('landscape')}
                className={cn(
                  'p-2.5 rounded-xl border flex items-center justify-center gap-2 font-semibold transition-all',
                  orientation === 'landscape'
                    ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                    : 'border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                )}
              >
                <div className="w-4 h-3 border-2 border-current rounded-xs" />
                <span>Yatay (Landscape)</span>
              </button>
            </div>
          </div>

          {/* Action button */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleInsert}
              disabled={isProcessing}
              className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
            >
              {isProcessing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>
                {pageCount > 1 ? `${pageCount} Boş Sayfa Ekle` : 'Boş Sayfa Ekle'} (Konum: {targetIdxPreview + 1}. sıra)
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
