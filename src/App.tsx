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
import { useTabStore } from '@/store/tab-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { ToastContainer } from './components/ui/ToastContainer';

export const App: React.FC = () => {
  const { currentDocument, setActivePageIndex, selectAllPages, setDocument, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const {
    zoomIn,
    zoomOut,
    openSearch,
    isPageManagerOpen,
    setPageManagerOpen,
    theme,
  } = useViewerStore();

  const { activeTool, setActiveTool, selectedAnnotationId, deleteAnnotation } =
    useAnnotationStore();

  const {
    isPropertiesModalOpen,
    setPropertiesModalOpen,
    isShortcutsModalOpen,
    setShortcutsModalOpen,
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
      return () => {
        if (cleanup) cleanup();
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

      // Ctrl + P -> Print
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const electron = (window as any).electronAPI;
        if (electron?.printDocument) {
          electron.printDocument();
        } else {
          window.print();
        }
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
        else if (e.key.toLowerCase() === 'h') setActiveTool('highlight');
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
    addToast,
  ]);

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden transition-colors duration-200">
      {/* Top Header Toolbar */}
      <TopToolbar />

      {/* V3 Secondary Editor Toolbar (if document is open) */}
      {currentDocument && <EditorToolbar />}

      {/* Multi-Document Tab Bar */}
      <TabBar />

      {/* Main Workspace Area */}
      <DropZone>
        {currentDocument ? (
          <div className="flex-1 flex overflow-hidden">
            <LeftSidebar />
            <PdfViewer />
          </div>
        ) : (
          <EmptyState />
        )}
      </DropZone>

      {/* Bottom Status / Zoom / Page navigation Bar */}
      <BottomBar />

      {/* Modals & Overlays */}
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
      <ToastContainer />
    </div>
  );
};
