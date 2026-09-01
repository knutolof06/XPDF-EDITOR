import React, { useRef, useCallback, useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { ThumbnailItem } from '../viewer/ThumbnailItem';
import { BookmarksPanel } from '../sidebar/BookmarksPanel';
import { AIAssistantPanel } from '../sidebar/AIAssistantPanel';
import {
  FileText,
  Bookmark,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const LeftSidebar: React.FC = () => {
  const { currentDocument, selectPages, setActivePageIndex } = useDocumentStore();
  const {
    sidebarOpen,
    toggleSidebar,
    activeSidebarTab,
    setActiveSidebarTab,
    thumbnailColumns,
    setThumbnailColumns,
    sidebarWidth,
    setSidebarWidth,
  } = useViewerStore();

  const isResizingRef = useRef(false);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(220, Math.min(850, moveEvent.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [setSidebarWidth]);

  if (!currentDocument) return null;

  const cols = Math.min(4, Math.max(1, thumbnailColumns || 2));

  const gridClass = {
    1: 'grid grid-cols-1 gap-4 p-2',
    2: 'grid grid-cols-2 gap-2.5 p-1.5',
    3: 'grid grid-cols-3 gap-2 p-1.5',
    4: 'grid grid-cols-4 gap-1.5 p-1',
  }[cols] || 'grid grid-cols-2 gap-2.5 p-1.5';

  return (
    <aside
      style={sidebarOpen ? { width: `${sidebarWidth}px` } : undefined}
      className={cn(
        'relative bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-20 shrink-0 select-none shadow-sm',
        !isResizing && 'transition-[width] duration-200',
        !sidebarOpen && 'w-12'
      )}
    >
      {/* Resizable Drag Handle on Right Border */}
      {sidebarOpen && (
        <div
          onMouseDown={startResizing}
          onDoubleClick={() => setSidebarWidth(320)}
          className="absolute right-0 top-0 bottom-0 w-1.5 hover:w-2 hover:bg-sky-500/50 cursor-col-resize z-30 transition-all group"
          title="Genişliği Ayarlamak İçin Sürükleyin (Çift Tıklama: Sıfırla)"
        >
          <div className="w-0.5 h-8 bg-slate-300 dark:bg-slate-600 rounded-full mx-auto my-auto group-hover:bg-sky-400 absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2" />
        </div>
      )}

      {/* Sidebar Top Nav Tabs */}
      <div className="h-12 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-2 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm overflow-x-auto">
        {sidebarOpen ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveSidebarTab('pages')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                activeSidebarTab === 'pages'
                  ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Sayfalar"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Sayfalar</span>
            </button>
            <button
              onClick={() => setActiveSidebarTab('bookmarks')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                activeSidebarTab === 'bookmarks'
                  ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="İçindekiler / Bookmarks"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>İçindekiler</span>
            </button>
            <button
              onClick={() => setActiveSidebarTab('ai')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                activeSidebarTab === 'ai'
                  ? 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/40'
                  : 'text-purple-600 dark:text-purple-400/80 hover:text-purple-900 dark:hover:text-purple-200'
              )}
              title="Yapay Zeka Asistanı"
            >
              <Sparkles className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span>AI</span>
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 mx-auto">
            <button
              onClick={() => {
                setActiveSidebarTab('pages');
                toggleSidebar();
              }}
              className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="Sayfalar"
            >
              <FileText className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setActiveSidebarTab('ai');
                toggleSidebar();
              }}
              className="p-1.5 rounded-lg text-purple-600 dark:text-purple-400 hover:text-purple-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
              title="AI Asistanı"
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        )}

        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
          title={sidebarOpen ? 'Paneli Daralt' : 'Paneli Genişlet'}
        >
          {sidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
      </div>

      {/* Sidebar Content */}
      {sidebarOpen && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {activeSidebarTab === 'pages' && (
            <div className="flex-1 flex flex-col overflow-hidden p-3">
              {/* Thumbnail Size Controls (1 - 4 Columns) */}
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 font-medium">
                <span className="truncate">Önizleme ({currentDocument.totalPages} sayfa)</span>
                
                {/* 1 - 4 Columns Stepper / Selector */}
                <div className="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-300/60 dark:border-slate-700/60 shrink-0">
                  <button
                    onClick={() => setThumbnailColumns(Math.max(1, cols - 1))}
                    disabled={cols <= 1}
                    className="p-1 rounded hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Küçült (Daha Az Sütun / 1 Sayfa)"
                  >
                    <Minus className="w-3 h-3" />
                  </button>

                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      onClick={() => setThumbnailColumns(n)}
                      className={cn(
                        'w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center transition-all',
                        cols === n
                          ? 'bg-sky-500 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/60 dark:hover:bg-slate-700/60'
                      )}
                      title={`${n} Sayfa Yan Yana`}
                    >
                      {n}
                    </button>
                  ))}

                  <button
                    onClick={() => setThumbnailColumns(Math.min(4, cols + 1))}
                    disabled={cols >= 4}
                    className="p-1 rounded hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Büyült (Daha Fazla Sütun / Max 4 Sayfa)"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Thumbnails Scroll Grid */}
              <div className={cn('flex-1 overflow-y-auto pr-1', gridClass)}>
                {currentDocument.pages.map((page, index) => (
                  <ThumbnailItem
                    key={page.id}
                    page={page}
                    index={index}
                    isActive={currentDocument.activePageIndex === index}
                    isSelected={currentDocument.selectedPageIds.includes(page.id)}
                    onPageClick={(pageId, idx, isMulti) => {
                      if (isMulti) {
                        selectPages([pageId], true);
                      } else {
                        setActivePageIndex(idx);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {activeSidebarTab === 'bookmarks' && <BookmarksPanel />}

          {activeSidebarTab === 'ai' && <AIAssistantPanel />}

          {activeSidebarTab === 'search' && (
            <div className="p-4 text-xs text-slate-600 dark:text-slate-400">
              <p>Hızlı arama yapmak için üst menüdeki arama butonuna veya <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">Ctrl + F</kbd> tuşuna basın.</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
