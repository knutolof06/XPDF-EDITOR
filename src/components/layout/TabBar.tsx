import React, { useEffect, useRef, useState } from 'react';
import { useTabStore, TabItem } from '@/store/tab-store';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useUIStore } from '@/store/ui-store';
import { openPdfFileDialog, openPdfFiles } from '@/components/common/pdf-actions';
import { useResolvedDarkTheme } from '@/components/common/theme-utils';
import { FileText, X, Plus } from 'lucide-react';
import { cn } from '@/utils/cn';

interface TabContextMenuState {
  x: number;
  y: number;
  tabId: string;
}

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, setActiveTab, closeTab, updateActiveTabState, updateTabModel } = useTabStore();
  const { currentDocument, setDocument } = useDocumentStore();
  const { appDesignTheme, fitMode, zoom, setZoom } = useViewerStore();
  const isDark = useResolvedDarkTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    window.addEventListener('mousedown', closeMenu);
    window.addEventListener('blur', closeMenu);
    return () => {
      window.removeEventListener('mousedown', closeMenu);
      window.removeEventListener('blur', closeMenu);
    };
  }, [contextMenu]);

  if (tabs.length === 0) return null;

  const persistCurrentTabBeforeSwitch = () => {
    if (!currentDocument) return;
    const scrollEl = document.getElementById('pdf-viewer-scroll');
    const scrollTop = scrollEl ? scrollEl.scrollTop : undefined;
    updateTabModel({ ...currentDocument });
    updateActiveTabState(currentDocument.activePageIndex, scrollTop, zoom);
  };

  const activateTab = (tab: TabItem) => {
    setActiveTab(tab.id);
    const modelToSet = {
      ...tab.model,
      activePageIndex: tab.activePageIndex ?? tab.model.activePageIndex ?? 0,
    };
    setDocument(modelToSet, tab.pdfDocProxy);
    if (fitMode === 'none' && tab.zoom && Math.abs(tab.zoom - zoom) >= 0.01) {
      setZoom(tab.zoom, true);
    }
  };

  const handleTabClick = (tabId: string) => {
    if (tabId === activeTabId) return;
    persistCurrentTabBeforeSwitch();
    const freshTabs = useTabStore.getState().tabs;
    const targetTab = freshTabs.find((t) => t.id === tabId);
    if (targetTab) {
      activateTab(targetTab);
    }
  };

  const isTabDirty = (tab: TabItem): boolean => {
    const isCurrentDirty = tab.id === currentDocument?.id && currentDocument.isModified;
    return Boolean(tab.model.isModified || isCurrentDirty);
  };

  const closeSingleTab = (tabId: string) => {
    const targetTab = useTabStore.getState().tabs.find((t) => t.id === tabId);
    if (!targetTab) return;

    if (isTabDirty(targetTab)) {
      useUIStore.getState().setCloseConfirmModalOpen(true, tabId);
      return;
    }

    const allTabs = useTabStore.getState().tabs;
    const closingIdx = allTabs.findIndex((t) => t.id === tabId);
    const wasActive = tabId === activeTabId;

    closeTab(tabId);
    const remaining = useTabStore.getState().tabs;
    if (remaining.length > 0) {
      if (wasActive) {
        const nextIdx = Math.max(0, Math.min(closingIdx > 0 ? closingIdx - 1 : 0, remaining.length - 1));
        const nextActive = remaining[nextIdx];
        activateTab(nextActive);
      }
    } else {
      useDocumentStore.getState().closeDocument();
    }
  };

  const closeManyTabs = (tabIds: string[]) => {
    for (const id of tabIds) {
      const freshTab = useTabStore.getState().tabs.find((t) => t.id === id);
      if (!freshTab) continue;
      if (isTabDirty(freshTab)) {
        useUIStore.getState().setCloseConfirmModalOpen(true, id);
        return;
      }
      closeSingleTab(id);
    }
  };

  const isLinearDark = appDesignTheme === 'linear' && isDark;
  const isLinearLight = appDesignTheme === 'linear' && !isDark;

  return (
    <div
      id="tab-bar"
      role="tablist"
      aria-label="Açık Belgeler"
      className={cn(
        'no-print flex items-center gap-1.5 select-none overflow-x-auto z-20 shrink-0 transition-all duration-200',
        appDesignTheme === 'cupertino' && 'h-9 px-4 py-1 cupertino-glass border-b border-black/5 dark:border-white/10 shadow-sm',
        isLinearDark && 'h-8 px-2 bg-[#08090a] border-b border-white/10 text-xs shadow-none',
        isLinearLight && 'h-8 px-2 bg-slate-100 border-b border-slate-200 text-xs shadow-none',
        appDesignTheme === 'ribbon' && 'h-8 px-2 bg-slate-200/80 dark:bg-slate-900 border-b border-slate-300 dark:border-slate-800 text-xs',
        appDesignTheme === 'fluent' && 'h-10 bg-slate-200 dark:bg-slate-950 border-b border-slate-300 dark:border-slate-800/80 px-2'
      )}
    >
      <input
        type="file"
        ref={fileInputRef}
        multiple
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            await openPdfFiles(e.target.files);
          }
          e.target.value = '';
        }}
        accept="application/pdf"
        className="hidden"
      />

      {/* List of Document Tabs */}
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const dirty = isTabDirty(tab);

        return (
          <div
            key={tab.id}
            role="tab"
            tabIndex={0}
            aria-selected={isActive}
            onClick={() => handleTabClick(tab.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleTabClick(tab.id);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ x: e.clientX, y: e.clientY, tabId: tab.id });
            }}
            title={dirty ? `${tab.name} (Kaydedilmemiş değişiklikler)` : tab.name}
            className={cn(
              'group flex items-center gap-2 text-xs font-medium cursor-pointer transition-all shrink-0 min-w-[140px] max-w-[360px]',
              appDesignTheme === 'cupertino' && (
                isActive
                  ? 'h-7 px-3 rounded-full bg-white dark:bg-slate-800 text-sky-600 dark:text-sky-400 font-bold shadow-sm border border-black/5 dark:border-white/10'
                  : 'h-7 px-3 rounded-full hover:bg-white/50 dark:hover:bg-slate-800/50 text-slate-600 dark:text-slate-400'
              ),
              isLinearDark && (
                isActive
                  ? 'h-7 px-2.5 bg-[#141820] text-cyan-400 font-bold border-b-2 border-cyan-400 rounded-none'
                  : 'h-7 px-2.5 text-slate-400 hover:text-slate-200 hover:bg-white/5 rounded-none'
              ),
              isLinearLight && (
                isActive
                  ? 'h-7 px-2.5 bg-white text-sky-600 font-bold border-b-2 border-sky-600 rounded-none'
                  : 'h-7 px-2.5 text-slate-600 hover:text-slate-900 hover:bg-black/5 rounded-none'
              ),
              appDesignTheme === 'ribbon' && (
                isActive
                  ? 'h-7 px-3 bg-white dark:bg-slate-800 border-t-2 border-sky-500 text-sky-600 dark:text-sky-400 font-bold rounded-t shadow-sm'
                  : 'h-7 px-3 text-slate-600 dark:text-slate-400 hover:bg-slate-300/50 dark:hover:bg-slate-800/50 rounded-t'
              ),
              appDesignTheme === 'fluent' && (
                isActive
                  ? 'h-9 px-3.5 rounded-t-lg bg-white dark:bg-slate-900 border-t border-x border-slate-300 dark:border-slate-800 text-sky-600 dark:text-sky-400 shadow-sm font-semibold'
                  : 'h-9 px-3.5 rounded-t-lg bg-slate-300/60 dark:bg-slate-900/40 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-200'
              )
            )}
          >
            <FileText className="w-3.5 h-3.5 shrink-0 text-sky-500 dark:text-sky-400" />
            <span className="truncate flex-1 font-medium select-none" title={tab.name}>
              {dirty && (
                <span className="text-amber-500 font-bold mr-1" aria-label="Kaydedilmemiş değişiklik">
                  *
                </span>
              )}
              {tab.name}
            </span>

            {/* Close Tab Button */}
            <button
              type="button"
              aria-label={`${tab.name} sekmesini kapat`}
              onClick={(e) => {
                e.stopPropagation();
                closeSingleTab(tab.id);
              }}
              className="opacity-60 hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-opacity ml-1"
              title="Sekmeyi Kapat"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}

      {/* Add New Tab Button */}
      <button
        type="button"
        aria-label="Yeni PDF Sekmesi Aç"
        onClick={() => openPdfFileDialog(fileInputRef.current)}
        className="p-1 rounded-md text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-300/80 dark:hover:bg-slate-800 transition-colors ml-1"
        title="Yeni PDF Sekmesi Aç"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>

      {/* Tab Context Menu */}
      {contextMenu && (
        <div
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          className="fixed z-50 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-1 text-xs text-slate-700 dark:text-slate-200"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const id = contextMenu.tabId;
              setContextMenu(null);
              closeSingleTab(id);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Kapat
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={tabs.length <= 1}
            onClick={() => {
              const id = contextMenu.tabId;
              setContextMenu(null);
              const target = tabs.find((t) => t.id === id);
              if (target && id !== activeTabId) {
                persistCurrentTabBeforeSwitch();
                activateTab(target);
              }
              closeManyTabs(tabs.filter((t) => t.id !== id).map((t) => t.id));
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            Diğerlerini Kapat
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={tabs.findIndex((t) => t.id === contextMenu.tabId) >= tabs.length - 1}
            onClick={() => {
              const id = contextMenu.tabId;
              const idx = tabs.findIndex((t) => t.id === id);
              setContextMenu(null);
              if (idx !== -1) {
                closeManyTabs(tabs.slice(idx + 1).map((t) => t.id));
              }
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            Sağa Kapat
          </button>
          <div className="my-1 border-t border-slate-200 dark:border-slate-800" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              openPdfFileDialog(fileInputRef.current);
            }}
            className="w-full px-3 py-1.5 text-left hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Yeni PDF Sekmesi Aç
          </button>
        </div>
      )}
    </div>
  );
};
