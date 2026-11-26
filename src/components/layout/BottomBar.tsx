import React, { useEffect, useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { useResolvedDarkTheme } from '@/components/common/theme-utils';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FoldHorizontal,
  Minimize2,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const BottomBar: React.FC = () => {
  const { currentDocument, setActivePageIndex } = useDocumentStore();
  const { zoom, setZoom, zoomIn, zoomOut, fitMode, setFitMode, appDesignTheme } = useViewerStore();
  const isDark = useResolvedDarkTheme();

  const docId = currentDocument?.id;
  const docActivePageIndex = currentDocument?.activePageIndex ?? 0;

  const [pageInput, setPageInput] = useState<string>(String(docActivePageIndex + 1));

  useEffect(() => {
    if (docId) {
      setPageInput(String(docActivePageIndex + 1));
    }
  }, [docActivePageIndex, docId]);

  if (!currentDocument) return null;

  const { activePageIndex, totalPages } = currentDocument;

  const commitPageInput = () => {
    const val = parseInt(pageInput.trim(), 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      setActivePageIndex(val - 1);
      setPageInput(String(val));
    } else {
      setPageInput(String(activePageIndex + 1));
    }
  };

  const toggleFullScreen = () => {
    useUIStore.getState().setFullscreenPresentation(true);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  const isLinearDark = appDesignTheme === 'linear' && isDark;
  const isLinearLight = appDesignTheme === 'linear' && !isDark;

  return (
    <footer
      className={cn(
        'no-print flex items-center justify-between text-xs select-none z-20 shrink-0 transition-all duration-200',
        appDesignTheme === 'cupertino' && 'h-9 mb-1.5 mx-auto cupertino-glass rounded-2xl px-5 shadow-lg border max-w-fit gap-8 text-slate-700 dark:text-slate-200',
        isLinearDark && 'h-7 bg-[#08090a] border-t border-white/10 px-3 text-[11px] font-mono shadow-none text-slate-400',
        isLinearLight && 'h-7 bg-white border-t border-slate-200 px-3 text-[11px] font-mono shadow-none text-slate-600',
        appDesignTheme === 'ribbon' && 'h-7 bg-slate-200 dark:bg-slate-900 border-t border-slate-300 dark:border-slate-800 px-3 text-xs text-slate-600 dark:text-slate-300',
        appDesignTheme === 'fluent' && 'h-10 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-4 text-slate-700 dark:text-slate-300 shadow-sm'
      )}
    >
      {/* File Info */}
      <div className="flex items-center gap-3">
        <span className="font-semibold text-slate-900 dark:text-slate-200 truncate max-w-[200px] sm:max-w-xs">
          {currentDocument.name}
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden md:inline">
          {currentDocument.metadata.fileSizeFormatted || ''}
        </span>
      </div>

      {/* Page Navigation */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="İlk Sayfaya Git"
          onClick={() => setActivePageIndex(0)}
          disabled={activePageIndex <= 0}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          title="İlk Sayfa (Home)"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          aria-label="Önceki Sayfa"
          onClick={() => setActivePageIndex(Math.max(0, activePageIndex - 1))}
          disabled={activePageIndex <= 0}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          title="Önceki Sayfa (PageUp / Sol Ok)"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5 px-2">
          <input
            type="text"
            inputMode="numeric"
            aria-label="Sayfa Numarası"
            value={pageInput}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^0-9]/g, '');
              setPageInput(cleaned);
            }}
            onBlur={commitPageInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitPageInput();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setPageInput(String(activePageIndex + 1));
                e.currentTarget.blur();
              }
            }}
            className="w-12 h-6 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-center text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
          />
          <span className="text-slate-500 dark:text-slate-400">/ {totalPages}</span>
        </div>

        <button
          type="button"
          aria-label="Sonraki Sayfa"
          onClick={() =>
            setActivePageIndex(Math.min(totalPages - 1, activePageIndex + 1))
          }
          disabled={activePageIndex >= totalPages - 1}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          title="Sonraki Sayfa (PageDown / Sağ Ok)"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          type="button"
          aria-label="Son Sayfaya Git"
          onClick={() => setActivePageIndex(totalPages - 1)}
          disabled={activePageIndex >= totalPages - 1}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          title="Son Sayfa (End)"
        >
          <ChevronsRight className="w-4 h-4" />
        </button>
      </div>

      {/* Zoom and Fullscreen */}
      <div className="flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Uzaklaştır"
            onClick={zoomOut}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Uzaklaştır (Ctrl + -)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <input
            type="range"
            aria-label="Yakınlaştırma Düzeyi"
            min={0.2}
            max={5.0}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-20 accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded-lg cursor-pointer"
          />

          <button
            type="button"
            aria-label="Yakınlaştır"
            onClick={zoomIn}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Yakınlaştır (Ctrl + +)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            aria-label="Gerçek Boyuta Sıfırla"
            onClick={() => {
              setFitMode('none');
              setZoom(1.0);
            }}
            className="px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors min-w-[42px] text-center"
            title="Gerçek Boyut %100'e Sıfırla (Ctrl + 1)"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            type="button"
            aria-label="Genişliğe Sığdır"
            aria-pressed={fitMode === 'width'}
            onClick={() => setFitMode(fitMode === 'width' ? 'none' : 'width')}
            className={cn(
              'p-1 rounded transition-colors ml-0.5',
              fitMode === 'width'
                ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400'
            )}
            title="Genişliğe Sığdır (Ctrl + 2)"
          >
            <FoldHorizontal className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            aria-label="Sayfaya Sığdır"
            aria-pressed={fitMode === 'page'}
            onClick={() => setFitMode(fitMode === 'page' ? 'none' : 'page')}
            className={cn(
              'p-1 rounded transition-colors ml-0.5',
              fitMode === 'page'
                ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-semibold'
                : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400'
            )}
            title="Sayfaya Sığdır (Ctrl + 0)"
          >
            <Minimize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          aria-label="Tam Ekran Sunum Modu"
          onClick={toggleFullScreen}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white ml-2"
          title="Tam Ekran (F11)"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </footer>
  );
};
