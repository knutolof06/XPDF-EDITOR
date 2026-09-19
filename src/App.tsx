import React, { useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { historyManager } from '@/core/history/command-manager';
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
import { DocumentPropertiesModal } from './components/dialogs/DocumentPropertiesModal';
import { ShortcutsModal } from './components/dialogs/ShortcutsModal';
import { MergePdfModal } from './components/dialogs/MergePdfModal';
import { SplitPdfModal } from './components/dialogs/SplitPdfModal';
import { InsertPagesModal } from './components/dialogs/InsertPagesModal';
import { PageLayoutSynthesisModal } from './components/dialogs/PageLayoutSynthesisModal';
import { SignatureModal } from './components/dialogs/SignatureModal';
import { StampModal } from './components/dialogs/StampModal';
import { PageNumberModal } from './components/dialogs/PageNumberModal';
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
import { useTabStore } from '@/store/tab-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import { ToastContainer } from './components/ui/ToastContainer';
import { FullscreenHUD } from './components/viewer/FullscreenHUD';
import { cn } from '@/utils/cn';

export const App: React.FC = () => {
  const { currentDocument, setActivePageIndex, selectAllPages, setDocument, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const {
    zoomIn,
    zoomOut,
    setZoom,
    setFitMode,
    openSearch,
    isPageManagerOpen,
    setPageManagerOpen,
    theme,
    appDesignTheme,
    accentColor,
    uiDensity,
  } = useViewerStore();

  const { activeTool, setActiveTool, selectedAnnotationId, deleteAnnotation } =
    useAnnotationStore();

  const {
    isPropertiesModalOpen,
    setPropertiesModalOpen,
    isShortcutsModalOpen,
    setShortcutsModalOpen,
    setSettingsModalOpen,
    isMergeModalOpen,
    setMergeModalOpen,
    isSplitModalOpen,
    setSplitModalOpen,
    isInsertModalOpen,
    setInsertModalOpen,
    isPageLayoutModalOpen,
    setPageLayoutModalOpen,
    isSignatureModalOpen,
    setSignatureModalOpen,
    isStampModalOpen,
    setStampModalOpen,
    isPageNumberModalOpen,
    setPageNumberModalOpen,
    isObjectEditorOpen,
    setObjectEditorOpen,
    isPasswordModalOpen,
    setPasswordModalOpen,
    isCloseConfirmModalOpen,
    setCloseConfirmModalOpen,
    isFindReplaceModalOpen,
    setFindReplaceModalOpen,
    isFormsModalOpen,
    setFormsModalOpen,
    isCompareModalOpen,
    setCompareModalOpen,
    isFullscreenPresentation,
    setFullscreenPresentation,
    toggleFullscreenPresentation,
    addToast,
  } = useUIStore();

  // Expose document store globally for editor components
  useEffect(() => {
    (window as any).__docStore = useDocumentStore;
  }, []);

  // Listen for file open events from Electron (Double-click or Open with in Windows Explorer)
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      const electron = (window as any).electronAPI;

      const handleIncomingPdf = async (fileData: any) => {
        if (fileData && fileData.buffer) {
          try {
            addToast(`"${fileData.name}" açılıyor...`, 'info');
            const { model, pdfDoc } = await PdfLoader.loadDocument(
              fileData.name,
              fileData.buffer,
              fileData.path || undefined   // store disk path for Kaydet (overwrite)
            );
            setDocument(model, pdfDoc);
            addTab(model, pdfDoc);
            addRecentDocument({
              id: model.id,
              name: model.name,
              filePath: fileData.path || undefined,
              fileSize: model.fileSize,
              pageCount: model.totalPages,
              lastOpened: Date.now(),
            });
            addToast(`"${fileData.name}" başarıyla açıldı.`, 'success');
          } catch (err: any) {
            console.error(err);
            if (err?.isPasswordProtected) {
              useUIStore.getState().setPasswordModalOpen(true, {
                name: err.fileName || fileData.name,
                buffer: err.buffer || fileData.buffer,
                filePath: err.filePath || fileData.path,
              });
              addToast('Bu döküman parola ile korunmaktadır. Lütfen parolayı girin.', 'warning');
            } else {
              addToast('PDF açılırken hata oluştu.', 'error');
            }
          }
        }
      };

      // Initial file when launched via CLI or double-click
      electron.getInitialFile().then(handleIncomingPdf);

      // Subsequent files opened while app is running
      const cleanup = electron.onOpenFile(handleIncomingPdf);

      // Auto-updater status toast notifications
      let cleanupUpdater: (() => void) | undefined;
      if (electron.onUpdaterStatus) {
        cleanupUpdater = electron.onUpdaterStatus((status: any) => {
          if (status.type === 'available') {
            addToast('Yeni güncelleme yükleniyor, lütfen bekleyin...', 'info', 5000);
          } else if (status.type === 'downloaded') {
            addToast('Güncelleme yüklendi, uygulama yeniden başlatılıyor...', 'success', 3000);
          } else if (status.type === 'error') {
            console.warn('[Updater]', status.message);
          }
        });
      }


      return () => {
        if (cleanup) cleanup();
        if (cleanupUpdater) cleanupUpdater();
      };
    }
  }, []);


  // Theme synchronization (Rule 1)
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape closes any open modal or search
      if (e.key === 'Escape') {
        if (isPageManagerOpen) setPageManagerOpen(false);
        if (isPropertiesModalOpen) setPropertiesModalOpen(false);
        if (isShortcutsModalOpen) setShortcutsModalOpen(false);
        if (isMergeModalOpen) setMergeModalOpen(false);
        if (isSplitModalOpen) setSplitModalOpen(false);
        if (isInsertModalOpen) setInsertModalOpen(false, null);
        if (isPageLayoutModalOpen) setPageLayoutModalOpen(false);
        if (isSignatureModalOpen) setSignatureModalOpen(false);
        if (isStampModalOpen) setStampModalOpen(false);
        if (isPageNumberModalOpen) setPageNumberModalOpen(false);
        if (isObjectEditorOpen) setObjectEditorOpen(false);
        if (isPasswordModalOpen) setPasswordModalOpen(false, null);
        if (isCloseConfirmModalOpen) setCloseConfirmModalOpen(false, null);
        if (isFindReplaceModalOpen) setFindReplaceModalOpen(false);
        return;
      }

      // Delete key deletes active selected annotation
      if (e.key === 'Delete' && selectedAnnotationId && currentDocument) {
        if (!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
          const activePage = currentDocument.pages[currentDocument.activePageIndex];
          if (activePage) {
            deleteAnnotation(activePage.id, selectedAnnotationId);
            addToast('Öğe silindi', 'info', 1500);
          }
        }
      }

      // Ctrl + Z -> Undo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (historyManager.undo()) {
          addToast('İşlem geri alındı (Undo)', 'info', 1500);
        }
        return;
      }

      // Ctrl + Y or Ctrl + Shift + Z -> Redo
      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        e.preventDefault();
        if (historyManager.redo()) {
          addToast('İşlem yinelendi (Redo)', 'info', 1500);
        }
        return;
      }

      // Ctrl + A -> Select all pages
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        e.preventDefault();
        selectAllPages();
        addToast('Tüm sayfalar seçildi', 'info', 1500);
        return;
      }

      // Ctrl + F -> Open search
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }

      // Ctrl + H -> Open find and replace
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        setFindReplaceModalOpen(true);
        return;
      }

      // Ctrl + P -> Print (Vektör PDF yazdırma motoru)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (!currentDocument) return;
        (async () => {
          try {
            addToast('Yazdırma hazırlanıyor...', 'info', 2000);
            const rawOut = await PdfExporter.exportDocumentWithAnnotations(currentDocument);
            const blob = new Blob([rawOut], { type: 'application/pdf' });
            const blobUrl = URL.createObjectURL(blob);
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.right = '0';
            iframe.style.bottom = '0';
            iframe.style.width = '0';
            iframe.style.height = '0';
            iframe.style.border = '0';
            iframe.src = blobUrl;
            document.body.appendChild(iframe);
            iframe.onload = () => {
              try {
                iframe.contentWindow?.focus();
                iframe.contentWindow?.print();
              } catch {
                window.print();
              }
              setTimeout(() => {
                try {
                  document.body.removeChild(iframe);
                  URL.revokeObjectURL(blobUrl);
                } catch {}
              }, 60000);
            };
          } catch (pErr) {
            console.warn('Print error:', pErr);
            window.print();
          }
        })();
        return;
      }

      // Fullscreen Presentation: F11 or Ctrl + L
      if (e.key === 'F11' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l')) {
        e.preventDefault();
        const next = !isFullscreenPresentation;
        toggleFullscreenPresentation();
        if (next) {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
          addToast('Tam Ekran Sunum Modu (Çıkmak için Esc veya F11)', 'info', 2000);
        } else {
          if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
          }
        }
        return;
      }

      // Escape to exit fullscreen presentation
      if (e.key === 'Escape' && isFullscreenPresentation) {
        setFullscreenPresentation(false);
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }

      // Ctrl + 0: Sayfaya Sığdır (Fit to Page)
      if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setFitMode('page');
        addToast('Sayfaya Sığdırıldı (Ctrl + 0)', 'info', 1000);
        return;
      }

      // Ctrl + 1: Gerçek Boyut %100 (Actual Size)
      if ((e.ctrlKey || e.metaKey) && e.key === '1') {
        e.preventDefault();
        setFitMode('none');
        setZoom(1.0);
        addToast('Gerçek Boyut (%100)', 'info', 1000);
        return;
      }

      // Ctrl + 2: Genişliğe Sığdır (Fit to Width)
      if ((e.ctrlKey || e.metaKey) && e.key === '2') {
        e.preventDefault();
        setFitMode('width');
        addToast('Genişliğe Sığdırıldı (Ctrl + 2)', 'info', 1000);
        return;
      }

      // Ctrl + 3: Görünür İçeriğe Sığdır (Fit Visible Content)
      if ((e.ctrlKey || e.metaKey) && e.key === '3') {
        e.preventDefault();
        setFitMode('content');
        addToast('İçeriğe Sığdırıldı (Metin Odaklı)', 'info', 1000);
        return;
      }

      // Ctrl + ,: Ayarlar Merkezi
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault();
        setSettingsModalOpen(true);
        return;
      }

      // Ctrl + Plus / Minus for zoom
      if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomIn();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        zoomOut();
        return;
      }

      if (!currentDocument) return;

      // Tool shortcut keys (when not in text input)
      if (!['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName) && !e.ctrlKey && !e.metaKey) {
        if (e.key.toLowerCase() === 'v') setActiveTool('select');
        else if (e.key.toLowerCase() === 't') setActiveTool('text-add');
        else if (e.key.toLowerCase() === 'p') setActiveTool('draw');
        else if (e.key.toLowerCase() === 'h') setActiveTool('hand');
        else if (e.key.toLowerCase() === 'z') setActiveTool('marquee-zoom');
      }

      // PageUp / PageDown / ArrowLeft / ArrowRight / Home / End
      if (e.key === 'PageDown' || e.key === 'ArrowRight') {
        if (currentDocument.activePageIndex < currentDocument.totalPages - 1) {
          setActivePageIndex(currentDocument.activePageIndex + 1);
        }
      } else if (e.key === 'PageUp' || e.key === 'ArrowLeft') {
        if (currentDocument.activePageIndex > 0) {
          setActivePageIndex(currentDocument.activePageIndex - 1);
        }
      } else if (e.key === 'Home') {
        setActivePageIndex(0);
      } else if (e.key === 'End') {
        setActivePageIndex(currentDocument.totalPages - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    currentDocument,
    isPageManagerOpen,
    isPropertiesModalOpen,
    isShortcutsModalOpen,
    isMergeModalOpen,
    isSplitModalOpen,
    isInsertModalOpen,
    isPageLayoutModalOpen,
    isSignatureModalOpen,
    isStampModalOpen,
    isPageNumberModalOpen,
    selectedAnnotationId,
    activeTool,
    zoomIn,
    zoomOut,
    openSearch,
    setActiveTool,
    deleteAnnotation,
    setActivePageIndex,
    selectAllPages,
    setPageManagerOpen,
    setPropertiesModalOpen,
    setShortcutsModalOpen,
    setMergeModalOpen,
    setSplitModalOpen,
    setInsertModalOpen,
    setPageLayoutModalOpen,
    setSignatureModalOpen,
    setStampModalOpen,
    setPageNumberModalOpen,
    isFindReplaceModalOpen,
    setFindReplaceModalOpen,
    isFullscreenPresentation,
    setFullscreenPresentation,
    toggleFullscreenPresentation,
    setFitMode,
    setZoom,
    setSettingsModalOpen,
    addToast,
  ]);

  return (
    <div
      data-design-theme={appDesignTheme}
      data-accent={accentColor}
      data-density={uiDensity}
      className={cn(
        'w-screen h-screen flex flex-col font-sans overflow-hidden transition-colors duration-200',
        appDesignTheme === 'linear'
          ? 'bg-[#08090a] text-slate-100'
          : 'bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100'
      )}
    >
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
            <PdfViewer />
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

      {/* Modals & Overlays */}
      <SettingsModal />
      <PageManagerModal />
      <MergePdfModal />
      <SplitPdfModal />
      <InsertPagesModal />
      <PageLayoutSynthesisModal />
      <SignatureModal />
      <StampModal />
      <PageNumberModal />
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
