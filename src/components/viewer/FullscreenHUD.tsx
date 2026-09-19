import React, { useState, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore, ReadingTheme } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  FoldHorizontal,
  Minimize2,
  X,
  Flame,
  Sun,
  Moon,
  BookOpen,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const FullscreenHUD: React.FC = () => {
  const { currentDocument, setActivePageIndex } = useDocumentStore();
  const {
    zoom,
    zoomIn,
    zoomOut,
    fitMode,
    setFitMode,
    activeTool,
    setActiveTool,
    readingTheme,
    setReadingTheme,
  } = useViewerStore();
  const { isFullscreenPresentation, setFullscreenPresentation } = useUIStore();

  const [isVisible, setIsVisible] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isFullscreenPresentation) return;

    const handleMouseMove = () => {
      setIsVisible(true);
      document.body.style.cursor = 'default';

      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setIsVisible(false);
        document.body.style.cursor = 'none';
      }, 2500);
    };

    window.addEventListener('mousemove', handleMouseMove);
    handleMouseMove();

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      document.body.style.cursor = 'default';
    };
  }, [isFullscreenPresentation]);

  if (!isFullscreenPresentation || !currentDocument) return null;

  const activeIndex = currentDocument.activePageIndex;
  const totalPages = currentDocument.totalPages;

  const handleExit = () => {
    setFullscreenPresentation(false);
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 transform',
        isVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-4 pointer-events-none'
      )}
    >
      <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/85 dark:bg-slate-900/90 text-white backdrop-blur-md border border-white/15 shadow-2xl select-none">
        {/* Page Nav */}
        <div className="flex items-center gap-1 border-r border-white/15 pr-2">
          <button
            onClick={() => setActivePageIndex(Math.max(0, activeIndex - 1))}
            disabled={activeIndex <= 0}
            className="p-1 rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="Önceki Sayfa (Sol Ok / PageUp)"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold px-1 min-w-[50px] text-center">
            {activeIndex + 1} / {totalPages}
          </span>
          <button
            onClick={() => setActivePageIndex(Math.min(totalPages - 1, activeIndex + 1))}
            disabled={activeIndex >= totalPages - 1}
            className="p-1 rounded-full hover:bg-white/10 disabled:opacity-30 transition-colors"
            title="Sonraki Sayfa (Sağ Ok / Space / PageDown)"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        {/* Fit Controls */}
        <div className="flex items-center gap-1 border-r border-white/15 pr-2">
          <button
            onClick={() => setFitMode(fitMode === 'width' ? 'none' : 'width')}
            className={cn(
              'p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1',
              fitMode === 'width' ? 'bg-sky-500 text-white font-semibold' : 'hover:bg-white/10 text-slate-300'
            )}
            title="Genişliğe Sığdır (Ctrl + 2)"
          >
            <FoldHorizontal className="w-3.5 h-3.5" />
            <span className="text-[11px] hidden sm:inline">Genişlik</span>
          </button>
          <button
            onClick={() => setFitMode(fitMode === 'page' ? 'none' : 'page')}
            className={cn(
              'p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1',
              fitMode === 'page' ? 'bg-sky-500 text-white font-semibold' : 'hover:bg-white/10 text-slate-300'
            )}
            title="Sayfaya Sığdır (Ctrl + 0)"
          >
            <Minimize2 className="w-3.5 h-3.5" />
            <span className="text-[11px] hidden sm:inline">Sayfa</span>
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 border-r border-white/15 pr-2">
          <button
            onClick={zoomOut}
            className="p-1 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
            title="Uzaklaştır (Ctrl + -)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-xs font-semibold min-w-[42px] text-center text-slate-200">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={zoomIn}
            className="p-1 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
            title="Yakınlaştır (Ctrl + +)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Laser Pointer Toggle */}
        <button
          onClick={() => setActiveTool(activeTool === 'laser' ? 'select' : 'laser')}
          className={cn(
            'p-1.5 rounded-lg transition-colors text-xs flex items-center gap-1 border-r border-white/15 pr-2',
            activeTool === 'laser' ? 'bg-red-500 text-white font-semibold shadow-lg shadow-red-500/30' : 'hover:bg-white/10 text-slate-300'
          )}
          title="Sunum Lazer İşaretçisi"
        >
          <Flame className="w-3.5 h-3.5" />
          <span className="text-[11px] hidden md:inline">Lazer</span>
        </button>

        {/* Reading Theme Toggle */}
        <button
          onClick={() => {
            const nextTheme: ReadingTheme =
              readingTheme === 'default'
                ? 'dark'
                : readingTheme === 'dark'
                ? 'sepia'
                : 'default';
            setReadingTheme(nextTheme);
          }}
          className="p-1.5 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white transition-colors border-r border-white/15 pr-2"
          title={`Okuma Modu: ${readingTheme}`}
        >
          {readingTheme === 'dark' ? (
            <Moon className="w-3.5 h-3.5 text-sky-400" />
          ) : readingTheme === 'sepia' ? (
            <BookOpen className="w-3.5 h-3.5 text-amber-300" />
          ) : (
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          )}
        </button>

        {/* Exit Fullscreen */}
        <button
          onClick={handleExit}
          className="p-1.5 rounded-full hover:bg-red-500/30 text-slate-300 hover:text-red-300 transition-colors ml-1"
          title="Tam Ekrandan Çık (Esc / F11)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
