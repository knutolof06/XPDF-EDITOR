import React, { useEffect, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { useRulerStore } from '@/store/ruler-store';
import { historyManager, RotatePageCommand } from '@/core/history/command-manager';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { DropZone } from './components/common/DropZone';
import { EmptyState } from './components/common/EmptyState';
import { TopToolbar } from './components/layout/TopToolbar';
import { EditorToolbar } from './components/toolbar/EditorToolbar';
import { TabBar } from './components/layout/TabBar';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { RightToolsSidebar } from './components/layout/RightToolsSidebar';
import { BottomBar } from './components/layout/BottomBar';
import { PdfViewer } from './components/viewer/PdfViewer';
import { PageManagerModal } from './components/page-manager/PageManagerModal';
import { ExtractPagesModal } from './components/page-manager/ExtractPagesModal';
import { DocumentPropertiesModal } from './components/dialogs/DocumentPropertiesModal';
import { ShortcutsModal } from './components/dialogs/ShortcutsModal';
import { MergePdfModal } from './components/dialogs/MergePdfModal';
import { SplitPdfModal } from './components/dialogs/SplitPdfModal';
import { InsertPagesModal } from './components/dialogs/InsertPagesModal';
import { PageLayoutSynthesisModal } from './components/dialogs/PageLayoutSynthesisModal';
import { SignatureModal } from './components/dialogs/SignatureModal';
import { StampModal } from './components/dialogs/StampModal';
import { PageNumberModal } from './components/dialogs/PageNumberModal';
import { HeaderFooterModal } from './components/dialogs/HeaderFooterModal';
import { EqualizePagesModal } from './components/dialogs/EqualizePagesModal';
import { ObjectEditorModal } from './components/dialogs/ObjectEditorModal';
import { PasswordModal } from './components/dialogs/PasswordModal';
import { CloseConfirmModal } from './components/dialogs/CloseConfirmModal';
import { CompressPdfModal } from './components/dialogs/CompressPdfModal';
import { ExportImageModal } from './components/dialogs/ExportImageModal';
import { ImagesToPdfModal } from './components/dialogs/ImagesToPdfModal';
import { WatermarkModal } from './components/dialogs/WatermarkModal';
import { ExtractTextModal } from './components/dialogs/ExtractTextModal';
import { SecurityPermissionsModal } from './components/dialogs/SecurityPermissionsModal';
import { SignatureVerifyModal } from './components/dialogs/SignatureVerifyModal';
import { InsertBlankPageModal } from './components/dialogs/InsertBlankPageModal';
import { FindReplaceModal } from './components/dialogs/FindReplaceModal';
import { OcrRecognizeModal } from './components/dialogs/OcrRecognizeModal';
import { SnipOcrModal } from './components/dialogs/SnipOcrModal';
import { FormFieldsModal } from './components/dialogs/FormFieldsModal';
import { CompareModal } from './components/dialogs/CompareModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { RibbonToolbar } from './components/toolbar/RibbonToolbar';
import { ToastContainer } from './components/ui/ToastContainer';
import { FullscreenHUD } from './components/viewer/FullscreenHUD';
import { useViewerUIState } from './components/viewer/viewer-ui-state';
import { applyThemeToDocument, useResolvedDarkTheme } from './components/common/theme-utils';
import {
  openPdfFileDialog,
  openPdfFiles,
  openPdfFromBuffer,
  printDocumentWithAnnotations,
  saveDocument,
  syncActiveTool,
} from './components/common/pdf-actions';
import { ActiveTool } from '@/types/viewer';
import { ElectronOpenedFile, UpdaterStatusEvent } from '@/types/electron';
import { cn } from '@/utils/cn';
import { Download, RefreshCw, X } from 'lucide-react';

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

function hasAnyOpenModal(): boolean {
  const ui = useUIStore.getState();
  const viewer = useViewerStore.getState();
  return Boolean(
    viewer.isPageManagerOpen ||
      ui.isSettingsModalOpen ||
      ui.isExtractPagesModalOpen ||
      ui.isPageEqualizeModalOpen ||
      ui.isCompressModalOpen ||
      ui.isExportImageModalOpen ||
      ui.isImagesToPdfModalOpen ||
      ui.isWatermarkModalOpen ||
      ui.isExtractTextModalOpen ||
      ui.isInsertBlankPageModalOpen ||
      ui.isFormsModalOpen ||
      ui.isCompareModalOpen ||
      ui.isObjectEditorOpen ||
      ui.isPasswordModalOpen ||
      ui.isCloseConfirmModalOpen ||
      ui.isHeaderFooterModalOpen ||
      ui.isPropertiesModalOpen ||
      ui.isShortcutsModalOpen ||
      ui.isMergeModalOpen ||
      ui.isSplitModalOpen ||
      ui.isInsertModalOpen ||
      ui.isPageLayoutModalOpen ||
      ui.isSignatureModalOpen ||
      ui.isStampModalOpen ||
      ui.isPageNumberModalOpen ||
      ui.isSecurityModalOpen ||
      ui.isSignatureVerifyModalOpen ||
      ui.isOcrModalOpen ||
      ui.isSnipOcrModalOpen ||
      ui.isFindReplaceModalOpen
  );
}

function closeAllOpenModals(): boolean {
  const ui = useUIStore.getState();
  const viewer = useViewerStore.getState();
  let closedAny = false;

  if (viewer.isPageManagerOpen) {
    viewer.setPageManagerOpen(false);
    closedAny = true;
  }

  const uiFlags: [boolean, () => void][] = [
    [ui.isSettingsModalOpen, () => ui.setSettingsModalOpen(false)],
    [ui.isExtractPagesModalOpen, () => ui.setExtractPagesModalOpen(false)],
    [ui.isPageEqualizeModalOpen, () => ui.setPageEqualizeModalOpen(false)],
    [ui.isCompressModalOpen, () => ui.setCompressModalOpen(false)],
    [ui.isExportImageModalOpen, () => ui.setExportImageModalOpen(false)],
    [ui.isImagesToPdfModalOpen, () => ui.setImagesToPdfModalOpen(false)],
    [ui.isWatermarkModalOpen, () => ui.setWatermarkModalOpen(false)],
    [ui.isExtractTextModalOpen, () => ui.setExtractTextModalOpen(false)],
    [ui.isInsertBlankPageModalOpen, () => ui.setInsertBlankPageModalOpen(false, null)],
    [ui.isFormsModalOpen, () => ui.setFormsModalOpen(false)],
    [ui.isCompareModalOpen, () => ui.setCompareModalOpen(false)],
    [ui.isObjectEditorOpen, () => ui.setObjectEditorOpen(false)],
    [ui.isPasswordModalOpen, () => ui.setPasswordModalOpen(false, null)],
    [ui.isCloseConfirmModalOpen, () => ui.setCloseConfirmModalOpen(false, null)],
    [ui.isHeaderFooterModalOpen, () => ui.setHeaderFooterModalOpen(false)],
    [ui.isPropertiesModalOpen, () => ui.setPropertiesModalOpen(false)],
    [ui.isShortcutsModalOpen, () => ui.setShortcutsModalOpen(false)],
    [ui.isMergeModalOpen, () => ui.setMergeModalOpen(false)],
    [ui.isSplitModalOpen, () => ui.setSplitModalOpen(false)],
    [ui.isInsertModalOpen, () => ui.setInsertModalOpen(false, null)],
    [ui.isPageLayoutModalOpen, () => ui.setPageLayoutModalOpen(false)],
    [ui.isSignatureModalOpen, () => ui.setSignatureModalOpen(false)],
    [ui.isStampModalOpen, () => ui.setStampModalOpen(false)],
    [ui.isPageNumberModalOpen, () => ui.setPageNumberModalOpen(false)],
    [ui.isSecurityModalOpen, () => ui.setSecurityModalOpen(false)],
    [ui.isSignatureVerifyModalOpen, () => ui.setSignatureVerifyModalOpen(false)],
    [ui.isOcrModalOpen, () => ui.setOcrModalOpen(false)],
    [ui.isSnipOcrModalOpen, () => ui.setSnipOcrModalOpen(false)],
    [ui.isFindReplaceModalOpen, () => ui.setFindReplaceModalOpen(false)],
  ];

  for (const [isOpen, closeFn] of uiFlags) {
    if (isOpen) {
      closeFn();
      closedAny = true;
    }
  }

  return closedAny;
}

export const App: React.FC = () => {
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const { theme, appDesignTheme, accentColor, uiDensity } = useViewerStore();
  const isDark = useResolvedDarkTheme();
  const {
    isFormsModalOpen,
    setFormsModalOpen,
    isCompareModalOpen,
    setCompareModalOpen,
    isFullscreenPresentation,
  } = useUIStore();

  const {
    updaterProgress,
    downloadedUpdateVersion,
    setUpdaterProgress,
    setDownloadedUpdateVersion,
  } = useViewerUIState();

  const globalFileInputRef = useRef<HTMLInputElement>(null);
  const spacePanPrevToolRef = useRef<ActiveTool | null>(null);

  // Keep viewer-store and annotation-store activeTool synchronized symmetrically
  useEffect(() => {
    const unsubViewer = useViewerStore.subscribe((state, prevState) => {
      if (state.activeTool !== prevState.activeTool) {
        const annStore = useAnnotationStore.getState();
        if (annStore.activeTool !== state.activeTool) {
          annStore.setActiveTool(state.activeTool);
        }
      }
    });

    const unsubAnn = useAnnotationStore.subscribe((state, prevState) => {
      if (state.activeTool !== prevState.activeTool) {
        const viewerStore = useViewerStore.getState();
        if (viewerStore.activeTool !== state.activeTool) {
          viewerStore.setActiveTool(state.activeTool);
        }
      }
    });

    return () => {
      unsubViewer();
      unsubAnn();
    };
  }, []);

  // Listen for file open events and auto-updater events from Electron
  useEffect(() => {
    const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;
    if (!electron) return;

    const handleIncomingPdf = async (fileData: ElectronOpenedFile | null) => {
      if (fileData && fileData.buffer) {
        await openPdfFromBuffer(fileData.name, fileData.buffer, fileData.path || undefined);
      }
    };

    electron.getInitialFile().then(handleIncomingPdf).catch(() => {});
    const cleanupOpenFile = electron.onOpenFile(handleIncomingPdf);

    let cleanupUpdater: (() => void) | undefined;
    if (electron.onUpdaterStatus) {
      cleanupUpdater = electron.onUpdaterStatus((status: UpdaterStatusEvent) => {
        const addToast = useUIStore.getState().addToast;
        if (status.type === 'available') {
          setUpdaterProgress(0);
          addToast(
            `Yeni güncelleme bulundu${status.version ? ` (v${status.version})` : ''}, indiriliyor...`,
            'info',
            5000
          );
        } else if (status.type === 'progress') {
          setUpdaterProgress(Math.round(status.percent ?? 0));
        } else if (status.type === 'downloaded') {
          setUpdaterProgress(null);
          setDownloadedUpdateVersion(status.version || 'Yeni Sürüm');
          addToast(
            'Güncelleme indirildi. Kurmak için "Yeniden Başlat & Güncelle" butonuna tıklayın.',
            'success',
            6000
          );
        } else if (status.type === 'error') {
          setUpdaterProgress(null);
          console.warn('[Updater]', status.message);
        }
      });
    }

    return () => {
      cleanupOpenFile?.();
      cleanupUpdater?.();
    };
  }, [setDownloadedUpdateVersion, setUpdaterProgress]);

  // Theme synchronization (including live OS prefers-color-scheme listener for 'system')
  useEffect(() => {
    applyThemeToDocument(theme);

    if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      applyThemeToDocument('system');
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleSystemThemeChange);
      return () => media.removeEventListener('change', handleSystemThemeChange);
    }
    media.addListener(handleSystemThemeChange);
    return () => media.removeListener(handleSystemThemeChange);
  }, [theme]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;

      const uiState = useUIStore.getState();
      const viewerState = useViewerStore.getState();
      const docState = useDocumentStore.getState();
      const annState = useAnnotationStore.getState();
      const activeDoc = docState.currentDocument;
      const editable = isEditableTarget(e.target);

      // 1. Escape closes modals -> search -> selected annotation -> fullscreen -> resets tool
      if (e.key === 'Escape') {
        if (closeAllOpenModals()) {
          e.preventDefault();
          return;
        }
        if (viewerState.searchState.isOpen) {
          e.preventDefault();
          window.getSelection()?.removeAllRanges();
          viewerState.closeSearch();
          return;
        }
        if (annState.selectedAnnotationId) {
          e.preventDefault();
          annState.setSelectedAnnotationId(null);
          return;
        }
        if (uiState.isFullscreenPresentation) {
          e.preventDefault();
          uiState.setFullscreenPresentation(false);
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
          return;
        }
        if (annState.activeTool !== 'select') {
          e.preventDefault();
          syncActiveTool('select');
        }
        return;
      }

      const modalOpen = hasAnyOpenModal();

      // 2. Delete key deletes active selected annotation (only outside inputs/modals)
      if (
        e.key === 'Delete' &&
        annState.selectedAnnotationId &&
        activeDoc &&
        !editable &&
        !modalOpen
      ) {
        const activePage = activeDoc.pages[activeDoc.activePageIndex];
        if (activePage) {
          e.preventDefault();
          annState.deleteAnnotation(activePage.id, annState.selectedAnnotationId);
          uiState.addToast('Öğe silindi', 'info', 1500);
        }
        return;
      }

      // 3. Ctrl/Meta shortcuts
      if (e.ctrlKey || e.metaKey) {
        const keyLower = e.key.toLowerCase();

        // Undo / Redo (yield to native editing when focus is in an input or modal)
        if (keyLower === 'z' && !e.shiftKey) {
          if (editable || modalOpen) return;
          e.preventDefault();
          if (historyManager.undo()) {
            uiState.addToast('İşlem geri alındı', 'info', 1500);
          }
          return;
        }

        if (keyLower === 'y' || (keyLower === 'z' && e.shiftKey)) {
          if (editable || modalOpen) return;
          e.preventDefault();
          if (historyManager.redo()) {
            uiState.addToast('İşlem yinelendi', 'info', 1500);
          }
          return;
        }

        // Ctrl + A -> Select all pages (only outside inputs/modals)
        if (keyLower === 'a') {
          if (editable || modalOpen || !activeDoc) return;
          e.preventDefault();
          docState.selectAllPages();
          uiState.addToast('Tüm sayfalar seçildi', 'info', 1500);
          return;
        }

        // Ctrl + O -> Open PDF
        if (keyLower === 'o') {
          e.preventDefault();
          openPdfFileDialog(globalFileInputRef.current);
          return;
        }

        // Ctrl + S / Ctrl + Shift + S -> Save / Save As
        if (keyLower === 's') {
          e.preventDefault();
          if (activeDoc) {
            saveDocument(activeDoc, e.shiftKey);
          }
          return;
        }

        // Ctrl + F -> Open search
        if (keyLower === 'f') {
          e.preventDefault();
          if (activeDoc) {
            viewerState.openSearch();
          }
          return;
        }

        // Ctrl + H -> Open find and replace
        if (keyLower === 'h') {
          e.preventDefault();
          if (activeDoc) {
            uiState.setFindReplaceModalOpen(true);
          }
          return;
        }

        // Ctrl + P -> Print (Vector PDF export print)
        if (keyLower === 'p') {
          e.preventDefault();
          if (activeDoc) {
            printDocumentWithAnnotations(activeDoc);
          }
          return;
        }

        // Ctrl + R -> Toggle rulers (Ctrl+Shift+R -> Rotate active/selected pages +90°)
        if (keyLower === 'r') {
          e.preventDefault();
          if (e.shiftKey && activeDoc) {
            const targetIds =
              activeDoc.selectedPageIds.length > 0
                ? activeDoc.selectedPageIds
                : activeDoc.pages[activeDoc.activePageIndex]
                ? [activeDoc.pages[activeDoc.activePageIndex].id]
                : [];
            if (targetIds.length > 0) {
              historyManager.execute(new RotatePageCommand(targetIds, 90));
              uiState.addToast('Sayfa sağa döndürüldü (+90°)', 'info', 1200);
            }
          } else {
            useRulerStore.getState().toggleRulers();
          }
          return;
        }

        // Ctrl + L -> Toggle Fullscreen Presentation
        if (keyLower === 'l') {
          e.preventDefault();
          const next = !uiState.isFullscreenPresentation;
          uiState.toggleFullscreenPresentation();
          if (next) {
            if (!document.fullscreenElement) {
              document.documentElement.requestFullscreen().catch(() => {});
            }
            uiState.addToast('Tam Ekran Sunum Modu (Çıkmak için Esc veya F11)', 'info', 2000);
          } else if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
          return;
        }

        // Zoom shortcuts
        if (e.key === '0') {
          e.preventDefault();
          viewerState.setFitMode('page');
          uiState.addToast('Sayfaya Sığdırıldı (Ctrl + 0)', 'info', 1000);
          return;
        }
        if (e.key === '1') {
          e.preventDefault();
          viewerState.setFitMode('none');
          viewerState.setZoom(1.0);
          uiState.addToast('Gerçek Boyut (%100)', 'info', 1000);
          return;
        }
        if (e.key === '2') {
          e.preventDefault();
          viewerState.setFitMode('width');
          uiState.addToast('Genişliğe Sığdırıldı (Ctrl + 2)', 'info', 1000);
          return;
        }
        if (e.key === '3') {
          e.preventDefault();
          viewerState.setFitMode('content');
          uiState.addToast('İçeriğe Sığdırıldı (Metin Odaklı)', 'info', 1000);
          return;
        }
        if (e.key === ',') {
          e.preventDefault();
          uiState.setSettingsModalOpen(true);
          return;
        }
        if (e.key === '+' || e.key === '=') {
          e.preventDefault();
          viewerState.zoomIn();
          return;
        }
        if (e.key === '-' || e.key === '_') {
          e.preventDefault();
          viewerState.zoomOut();
          return;
        }

        return;
      }

      // 4. F11 -> Fullscreen Presentation
      if (e.key === 'F11') {
        e.preventDefault();
        const next = !uiState.isFullscreenPresentation;
        uiState.toggleFullscreenPresentation();
        if (next) {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
          uiState.addToast('Tam Ekran Sunum Modu (Çıkmak için Esc veya F11)', 'info', 2000);
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }

      if (!activeDoc || editable || modalOpen) return;

      // 5. Spacebar: Next page in Fullscreen Presentation, temporary Hand pan in Viewer
      if (e.key === ' ') {
        const targetEl = e.target as HTMLElement | null;
        if (targetEl && (targetEl.tagName === 'BUTTON' || targetEl.tagName === 'A')) {
          return;
        }
        e.preventDefault();
        if (uiState.isFullscreenPresentation) {
          if (activeDoc.activePageIndex < activeDoc.totalPages - 1) {
            docState.setActivePageIndex(activeDoc.activePageIndex + 1);
          }
        } else if (!e.repeat && annState.activeTool !== 'hand') {
          spacePanPrevToolRef.current = annState.activeTool;
          syncActiveTool('hand');
        }
        return;
      }

      // 6. Single-letter Tool Shortcuts (consistent with EditorToolbar & ShortcutsModal)
      if (!e.altKey) {
        const keyLower = e.key.toLowerCase();
        const toolMap: Record<string, ActiveTool> = {
          v: 'select',
          t: 'text-add',
          w: 'whiteout',
          p: 'draw',
          h: 'highlight',
          r: 'rect',
          c: 'circle',
          l: 'line',
          a: 'arrow',
          e: 'eraser',
          z: 'marquee-zoom',
        };
        const mappedTool = toolMap[keyLower];
        if (mappedTool) {
          e.preventDefault();
          syncActiveTool(mappedTool);
          return;
        }
      }

      // 7. Page Navigation (skip ArrowLeft/ArrowRight when an annotation is selected so AnnotationLayer can nudge it)
      const hasSelectedAnn = Boolean(annState.selectedAnnotationId);
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !hasSelectedAnn)) {
        if (activeDoc.activePageIndex < activeDoc.totalPages - 1) {
          e.preventDefault();
          docState.setActivePageIndex(activeDoc.activePageIndex + 1);
        }
      } else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !hasSelectedAnn)) {
        if (activeDoc.activePageIndex > 0) {
          e.preventDefault();
          docState.setActivePageIndex(activeDoc.activePageIndex - 1);
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        docState.setActivePageIndex(0);
      } else if (e.key === 'End') {
        e.preventDefault();
        docState.setActivePageIndex(activeDoc.totalPages - 1);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ' && spacePanPrevToolRef.current !== null) {
        const prev = spacePanPrevToolRef.current;
        spacePanPrevToolRef.current = null;
        syncActiveTool(prev);
      }
    };

    const handleWindowBlur = () => {
      if (spacePanPrevToolRef.current !== null) {
        const prev = spacePanPrevToolRef.current;
        spacePanPrevToolRef.current = null;
        syncActiveTool(prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);

  const isLinearDark = appDesignTheme === 'linear' && isDark;
  const isLinearLight = appDesignTheme === 'linear' && !isDark;

  return (
    <div
      data-design-theme={appDesignTheme}
      data-accent={accentColor}
      data-density={uiDensity}
      className={cn(
        'w-screen h-screen flex flex-col font-sans overflow-hidden transition-colors duration-200',
        isLinearDark
          ? 'bg-[#08090a] text-slate-100'
          : isLinearLight
          ? 'bg-slate-50 text-slate-900'
          : 'bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100'
      )}
    >
      {/* Hidden global file input for Ctrl+O browser fallback */}
      <input
        id="global-pdf-open-input"
        ref={globalFileInputRef}
        type="file"
        multiple
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          if (e.target.files && e.target.files.length > 0) {
            await openPdfFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />

      {/* Top Header Toolbar */}
      {!isFullscreenPresentation && <TopToolbar />}

      {/* Classic Ribbon Suite Toolbar (Active when 'ribbon' design is selected) */}
      {!isFullscreenPresentation && currentDocument && appDesignTheme === 'ribbon' && <RibbonToolbar />}

      {/* Secondary Editor Toolbar (Active when document is open and not in ribbon mode) */}
      {!isFullscreenPresentation && currentDocument && appDesignTheme !== 'ribbon' && <EditorToolbar />}

      {/* Multi-Document Tab Bar */}
      {!isFullscreenPresentation && <TabBar />}

      {/* Main Workspace Area */}
      <DropZone>
        {currentDocument ? (
          <div className="flex-1 flex overflow-hidden">
            {!isFullscreenPresentation && <LeftSidebar />}
            <ErrorBoundary scope="viewer">
              <PdfViewer />
            </ErrorBoundary>
            {!isFullscreenPresentation && <RightToolsSidebar />}
          </div>
        ) : (
          <EmptyState />
        )}
      </DropZone>

      {/* Bottom Status / Zoom / Page navigation Bar */}
      {!isFullscreenPresentation && <BottomBar />}

      {/* Floating Fullscreen Presentation HUD */}
      <FullscreenHUD />

      {/* Electron Auto-Updater Progress & Restart Banner */}
      {(updaterProgress !== null || downloadedUpdateVersion) && (
        <div
          id="updater-banner"
          role="status"
          className="no-print fixed bottom-16 left-6 z-50 max-w-sm bg-white dark:bg-slate-900 border border-sky-500/40 rounded-2xl shadow-2xl p-3.5 text-xs text-slate-800 dark:text-slate-100 flex flex-col gap-2"
        >
          {updaterProgress !== null ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-semibold text-sky-600 dark:text-sky-400">
                  <Download className="w-4 h-4 animate-bounce" />
                  Güncelleme indiriliyor...
                </span>
                <span className="font-mono font-bold">{updaterProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-sky-500 transition-all duration-200"
                  style={{ width: `${Math.min(100, Math.max(0, updaterProgress))}%` }}
                />
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-emerald-600 dark:text-emerald-400">
                  Güncelleme Hazır ({downloadedUpdateVersion})
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Kurulumu tamamlamak için yeniden başlatın.
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => window.electronAPI?.installUpdateNow()}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Yeniden Başlat & Güncelle</span>
                </button>
                <button
                  type="button"
                  aria-label="Güncelleme bildirimini kapat"
                  onClick={() => setDownloadedUpdateVersion(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modals & Overlays */}
      <SettingsModal />
      <PageManagerModal />
      <ExtractPagesModal />
      <MergePdfModal />
      <SplitPdfModal />
      <InsertPagesModal />
      <PageLayoutSynthesisModal />
      <SignatureModal />
      <StampModal />
      <PageNumberModal />
      <HeaderFooterModal />
      <DocumentPropertiesModal />
      <ShortcutsModal />
      <EqualizePagesModal />
      <ObjectEditorModal />
      <PasswordModal />
      <CloseConfirmModal />
      <CompressPdfModal />
      <ExportImageModal />
      <ImagesToPdfModal />
      <WatermarkModal />
      <ExtractTextModal />
      <SecurityPermissionsModal />
      <SignatureVerifyModal />
      <InsertBlankPageModal />
      <FindReplaceModal />
      <OcrRecognizeModal />
      <SnipOcrModal />
      <FormFieldsModal isOpen={isFormsModalOpen} onClose={() => setFormsModalOpen(false)} />
      <CompareModal isOpen={isCompareModalOpen} onClose={() => setCompareModalOpen(false)} />
      <ToastContainer />
    </div>
  );
};
