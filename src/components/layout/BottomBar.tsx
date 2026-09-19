import React from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
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

  if (!currentDocument) return null;

  const { activePageIndex, totalPages } = currentDocument;

  const handlePageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val >= 1 && val <= totalPages) {
      setActivePageIndex(val - 1);
    }
  };

  const toggleFullScreen = () => {
    useUIStore.getState().setFullscreenPresentation(true);
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  };

  return (
    <footer
      className={cn(
        'flex items-center justify-between text-xs select-none z-20 shrink-0 transition-all duration-200',
        appDesignTheme === 'cupertino' && 'h-9 mb-1.5 mx-auto cupertino-glass rounded-2xl px-5 shadow-lg border max-w-fit gap-8',
        appDesignTheme === 'linear' && 'h-6 bg-[#08090a] border-t border-white/10 px-3 text-[11px] font-mono shadow-none text-slate-400',
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
          onClick={() => setActivePageIndex(0)}
          disabled={activePageIndex <= 0}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          title="İlk Sayfa (Home)"
        >
          <ChevronsLeft className="w-4 h-4" />
        </button>

        <button
          onClick={() => setActivePageIndex(Math.max(0, activePageIndex - 1))}
          disabled={activePageIndex <= 0}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
          title="Önceki Sayfa (PageUp / Sol Ok)"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-1.5 px-2">
          <input
            type="number"
            min={1}
            max={totalPages}
            value={activePageIndex + 1}
            onChange={handlePageInputChange}
            className="w-12 h-6 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded text-center text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
          />
          <span className="text-slate-500 dark:text-slate-400">/ {totalPages}</span>
        </div>

        <button
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
            onClick={zoomOut}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Uzaklaştır"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <input
            type="range"
            min={0.2}
            max={5.0}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(parseFloat(e.target.value))}
            className="w-20 accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded-lg cursor-pointer"
          />

          <button
            onClick={zoomIn}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Yakınlaştır (Ctrl + +)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
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
          onClick={toggleFullScreen}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white ml-2"
          title="Tam Ekran"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>
    </footer>
  );
};
