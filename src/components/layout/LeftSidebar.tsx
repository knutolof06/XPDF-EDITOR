import React, { useRef, useCallback, useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import {
  historyManager,
  RotatePageCommand,
  DeletePageCommand,
  DocumentStateSnapshotCommand,
} from '@/core/history/command-manager';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { ThumbnailItem } from '../viewer/ThumbnailItem';
import { BookmarksPanel } from '../sidebar/BookmarksPanel';
import { AIAssistantPanel } from '../sidebar/AIAssistantPanel';
import { useResolvedDarkTheme } from '../common/theme-utils';
import {
  FileText,
  Bookmark,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  CopyPlus,
  FileOutput,
  Trash2,
} from 'lucide-react';
import { cn } from '@/utils/cn';

interface PageContextMenuState {
  x: number;
  y: number;
  pageId: string;
  index: number;
}

export const LeftSidebar: React.FC = () => {
  const { currentDocument, pdfDocProxy, selectPages, setActivePageIndex } = useDocumentStore();
  const {
    sidebarOpen,
    toggleSidebar,
    activeSidebarTab,
    setActiveSidebarTab,
    thumbnailColumns,
    setThumbnailColumns,
    sidebarWidth,
    setSidebarWidth,
    appDesignTheme,
  } = useViewerStore();
  const isDark = useResolvedDarkTheme();

  const isResizingRef = useRef(false);
  const lastClickedIndexRef = useRef<number | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const [contextMenu, setContextMenu] = useState<PageContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setContextMenu(null);
      }
    };
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('blur', closeMenu);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('blur', closeMenu);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const startResizing = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [setSidebarWidth]
  );

  if (!currentDocument) return null;

  const cols = Math.min(4, Math.max(1, thumbnailColumns || 2));
  const thumbnailSize: 'small' | 'medium' | 'large' =
    cols === 1 ? 'large' : cols === 2 ? 'medium' : 'small';

  const gridClass =
    {
      1: 'grid grid-cols-1 gap-4 p-2',
      2: 'grid grid-cols-2 gap-2.5 p-1.5',
      3: 'grid grid-cols-3 gap-2 p-1.5',
      4: 'grid grid-cols-4 gap-1.5 p-1',
    }[cols] || 'grid grid-cols-2 gap-2.5 p-1.5';

  const handlePageClick = (pageId: string, idx: number, isMulti: boolean, isShift: boolean) => {
    if (isShift && lastClickedIndexRef.current !== null) {
      const start = Math.min(lastClickedIndexRef.current, idx);
      const end = Math.max(lastClickedIndexRef.current, idx);
      const rangeIds = currentDocument.pages.slice(start, end + 1).map((p) => p.id);
      selectPages(rangeIds, false);
      return;
    }

    lastClickedIndexRef.current = idx;
    if (isMulti) {
      selectPages([pageId], true);
    } else {
      setActivePageIndex(idx);
    }
  };

  const handlePageContextMenu = (e: React.MouseEvent, pageId: string, idx: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!currentDocument.selectedPageIds.includes(pageId)) {
      selectPages([pageId], false);
      lastClickedIndexRef.current = idx;
    }
    setContextMenu({ x: e.clientX, y: e.clientY, pageId, index: idx });
  };

  const getContextTargetIds = (): string[] => {
    if (!contextMenu) return [];
    return currentDocument.selectedPageIds.includes(contextMenu.pageId)
      ? currentDocument.selectedPageIds
      : [contextMenu.pageId];
  };

  const handleDuplicateFromContext = async () => {
    const targetIds = getContextTargetIds();
    setContextMenu(null);
    if (targetIds.length === 0) return;
    try {
      const prevModel = currentDocument;
      const prevProxy = pdfDocProxy;
      const result = await PdfAssembler.duplicatePages(currentDocument, targetIds);
      historyManager.execute(
        new DocumentStateSnapshotCommand(
          `${targetIds.length} sayfa çoğaltıldı`,
          prevModel,
          prevProxy,
          result.model,
          result.pdfDoc
        )
      );
      useTabStore.getState().replaceActiveTab(result.model, result.pdfDoc);
      useUIStore.getState().addToast(`${targetIds.length} sayfa çoğaltıldı.`, 'success', 2000);
    } catch (err) {
      console.error('Duplicate page error:', err);
      useUIStore.getState().addToast('Sayfa çoğaltılamadı.', 'error');
    }
  };

  const handleDeleteFromContext = () => {
    const targetIds = getContextTargetIds();
    setContextMenu(null);
    if (targetIds.length === 0 || currentDocument.pages.length <= targetIds.length) {
      useUIStore.getState().addToast('Belgede en az 1 sayfa kalmalıdır.', 'warning');
      return;
    }
    const items = targetIds
      .map((id) => {
        const index = currentDocument.pages.findIndex((p) => p.id === id);
        return index !== -1 ? { page: currentDocument.pages[index], index } : null;
      })
      .filter((x): x is { page: (typeof currentDocument.pages)[number]; index: number } => Boolean(x));

    if (items.length > 0) {
      historyManager.execute(new DeletePageCommand(items));
    }
  };

  const isLinearDark = appDesignTheme === 'linear' && isDark;
  const isLinearLight = appDesignTheme === 'linear' && !isDark;

  return (
    <aside
      aria-label="Sol Gezinme Paneli"
      style={sidebarOpen ? { width: `${sidebarWidth}px` } : undefined}
      className={cn(
        'no-print relative flex flex-col z-20 shrink-0 select-none shadow-sm transition-colors duration-200',
        appDesignTheme === 'cupertino' && 'bg-white/60 dark:bg-slate-900/60 backdrop-blur-md border-r border-black/5 dark:border-white/10',
        isLinearDark && 'bg-[#08090a] border-r border-white/10 text-slate-300 shadow-none',
        isLinearLight && 'bg-slate-50 border-r border-slate-200 text-slate-800 shadow-none',
        appDesignTheme === 'ribbon' && 'bg-slate-100 dark:bg-slate-900 border-r border-slate-300 dark:border-slate-800',
        appDesignTheme === 'fluent' && 'bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800',
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
      <div
        className={cn(
          'h-12 border-b flex items-center justify-between px-2 overflow-x-auto transition-colors',
          isLinearDark
            ? 'bg-[#0E1015] border-white/10'
            : isLinearLight
            ? 'bg-white border-slate-200'
            : appDesignTheme === 'cupertino'
            ? 'bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border-black/5 dark:border-white/10'
            : appDesignTheme === 'ribbon'
            ? 'bg-slate-200/80 dark:bg-slate-950 border-slate-300 dark:border-slate-800'
            : 'bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm border-slate-200 dark:border-slate-800'
        )}
      >
        {sidebarOpen ? (
          <div className="flex items-center gap-1" role="tablist" aria-label="Kenar Çubuğu Sekmeleri">
            <button
              type="button"
              role="tab"
              aria-selected={activeSidebarTab === 'pages'}
              onClick={() => setActiveSidebarTab('pages')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                activeSidebarTab === 'pages'
                  ? isLinearDark
                    ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-800/50'
                    : appDesignTheme === 'cupertino'
                    ? 'bg-black/10 dark:bg-white/10 rounded-full px-3 text-slate-900 dark:text-white'
                    : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="Sayfalar"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Sayfalar</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSidebarTab === 'bookmarks'}
              onClick={() => setActiveSidebarTab('bookmarks')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
                activeSidebarTab === 'bookmarks'
                  ? isLinearDark
                    ? 'bg-cyan-950/60 text-cyan-400 border border-cyan-800/50'
                    : appDesignTheme === 'cupertino'
                    ? 'bg-black/10 dark:bg-white/10 rounded-full px-3 text-slate-900 dark:text-white'
                    : 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
              title="İçindekiler / Yer İmleri"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>İçindekiler</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeSidebarTab === 'ai'}
              onClick={() => setActiveSidebarTab('ai')}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
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
              type="button"
              aria-label="Sayfalar Panelini Aç"
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
              type="button"
              aria-label="Yapay Zeka Asistanını Aç"
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
          type="button"
          aria-label={sidebarOpen ? 'Sol Paneli Daralt' : 'Sol Paneli Genişlet'}
          aria-expanded={sidebarOpen}
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

                <div
                  className={cn(
                    'flex items-center gap-1 p-0.5 rounded-lg border shrink-0',
                    isLinearDark
                      ? 'bg-[#0E1015] border-white/10'
                      : 'bg-slate-200/70 dark:bg-slate-800/80 border-slate-300/60 dark:border-slate-700/60'
                  )}
                >
                  <button
                    type="button"
                    aria-label="Sütun Sayısını Azalt"
                    onClick={() => setThumbnailColumns(Math.max(1, cols - 1))}
                    disabled={cols <= 1}
                    className="p-1 rounded hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Küçült (Daha Az Sütun)"
                  >
                    <Minus className="w-3 h-3" />
                  </button>

                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${n} Sayfa Yan Yana`}
                      aria-pressed={cols === n}
                      onClick={() => setThumbnailColumns(n)}
                      className={cn(
                        'w-5 h-5 rounded text-[11px] font-bold flex items-center justify-center transition-all',
                        cols === n
                          ? isLinearDark
                            ? 'bg-cyan-500 text-black shadow-sm font-mono'
                            : 'bg-sky-500 text-white shadow-sm'
                          : isLinearDark
                          ? 'text-slate-400 hover:text-white font-mono'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/60 dark:hover:bg-slate-700/60'
                      )}
                      title={`${n} Sayfa Yan Yana`}
                    >
                      {n}
                    </button>
                  ))}

                  <button
                    type="button"
                    aria-label="Sütun Sayısını Artır"
                    onClick={() => setThumbnailColumns(Math.min(4, cols + 1))}
                    disabled={cols >= 4}
                    className="p-1 rounded hover:bg-slate-300 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-600 dark:text-slate-300 transition-colors"
                    title="Büyüt (Daha Fazla Sütun)"
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
                    thumbnailSize={thumbnailSize}
                    isActive={currentDocument.activePageIndex === index}
                    isSelected={currentDocument.selectedPageIds.includes(page.id)}
                    onPageClick={handlePageClick}
                    onContextMenu={handlePageContextMenu}
                  />
                ))}
              </div>
            </div>
          )}

          {activeSidebarTab === 'bookmarks' && <BookmarksPanel />}

          {activeSidebarTab === 'ai' && <AIAssistantPanel />}

          {activeSidebarTab === 'search' && (
            <div className="p-4 text-xs text-slate-600 dark:text-slate-400">
              <p>
                Hızlı arama yapmak için üst menüdeki arama butonuna veya{' '}
                <kbd className="px-1.5 py-0.5 bg-slate-200 dark:bg-slate-800 rounded text-slate-700 dark:text-slate-300">
                  Ctrl + F
                </kbd>{' '}
                tuşuna basın.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Thumbnail Right-Click Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          className="fixed z-50 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-700 dark:text-slate-200"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const targetIds = getContextTargetIds();
              setContextMenu(null);
              if (targetIds.length > 0) {
                historyManager.execute(new RotatePageCommand(targetIds, -90));
              }
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5 text-sky-500" />
            <span>Sola Döndür (-90°)</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const targetIds = getContextTargetIds();
              setContextMenu(null);
              if (targetIds.length > 0) {
                historyManager.execute(new RotatePageCommand(targetIds, 90));
              }
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5 text-sky-500" />
            <span>Sağa Döndür (+90°)</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              useUIStore.getState().setExtractPagesModalOpen(true);
            }}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <FileOutput className="w-3.5 h-3.5 text-emerald-500" />
            <span>Sayfaları Ayıkla...</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleDuplicateFromContext}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <CopyPlus className="w-3.5 h-3.5 text-indigo-500" />
            <span>Sayfayı Çoğalt</span>
          </button>

          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />

          <button
            type="button"
            role="menuitem"
            disabled={currentDocument.pages.length <= getContextTargetIds().length}
            onClick={handleDeleteFromContext}
            className="w-full px-3 py-1.5 text-left flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Sayfayı Sil</span>
          </button>
        </div>
      )}
    </aside>
  );
};
