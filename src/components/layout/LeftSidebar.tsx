import React from 'react';
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
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const LeftSidebar: React.FC = () => {
  const { currentDocument, selectPages, setActivePageIndex } = useDocumentStore();
  const {
    sidebarOpen,
    toggleSidebar,
    activeSidebarTab,
    setActiveSidebarTab,
    thumbnailSize,
    setThumbnailSize,
  } = useViewerStore();

  if (!currentDocument) return null;

  return (
    <aside
      className={cn(
        'relative bg-slate-50 dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 transition-all duration-300 flex flex-col z-20 shrink-0 select-none shadow-sm',
        sidebarOpen ? 'w-72 sm:w-80' : 'w-12'
      )}
    >
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
              {/* Thumbnail Size Controls */}
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 font-medium">
                <span>Önizleme ({currentDocument.totalPages} sayfa)</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setThumbnailSize('small')}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[11px]',
                      thumbnailSize === 'small' ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                    )}
                  >
                    S
                  </button>
                  <button
                    onClick={() => setThumbnailSize('medium')}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[11px]',
                      thumbnailSize === 'medium' ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                    )}
                  >
                    M
                  </button>
                  <button
                    onClick={() => setThumbnailSize('large')}
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[11px]',
                      thumbnailSize === 'large' ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400'
                    )}
                  >
                    L
                  </button>
                </div>
              </div>

              {/* Thumbnails Scroll Grid */}
              <div
                className={cn(
                  'flex-1 overflow-y-auto pr-1 gap-3',
                  thumbnailSize === 'small'
                    ? 'grid grid-cols-2'
                    : thumbnailSize === 'medium'
                    ? 'flex flex-col'
                    : 'flex flex-col space-y-2'
                )}
              >
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
