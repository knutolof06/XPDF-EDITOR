import React, { useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { useDocumentStore } from '@/store/document-store';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import { AlertTriangle, X, Save, Trash2, Loader2 } from 'lucide-react';
import { saveBinaryOrBlobFile, useModalEscape } from './modal-utils';

export const CloseConfirmModal: React.FC = () => {
  const { isCloseConfirmModalOpen, pendingCloseTabId, setCloseConfirmModalOpen, addToast } = useUIStore();
  const { tabs, closeTab } = useTabStore();
  const { setDocument, currentDocument } = useDocumentStore();
  const [isSaving, setIsSaving] = useState(false);

  const isOpen = isCloseConfirmModalOpen && Boolean(pendingCloseTabId);

  const handleCancel = () => {
    if (isSaving) return;
    setCloseConfirmModalOpen(false, null);
  };

  useModalEscape(isOpen, handleCancel, isSaving);

  if (!isOpen || !pendingCloseTabId) return null;

  const targetTab = tabs.find((t) => t.id === pendingCloseTabId);
  const docName = targetTab?.name || 'Bu belge';

  const performCloseTab = () => {
    const prevActiveTabId = useTabStore.getState().activeTabId;
    const wasActive = pendingCloseTabId === prevActiveTabId || currentDocument?.id === pendingCloseTabId;

    closeTab(pendingCloseTabId);

    const { tabs: nextTabs, activeTabId: nextActiveTabId } = useTabStore.getState();
    if (nextTabs.length === 0) {
      useDocumentStore.getState().closeDocument();
    } else if (wasActive) {
      const nextActiveTab = nextTabs.find((t) => t.id === nextActiveTabId) || nextTabs[0];
      setDocument(
        { ...nextActiveTab.model, activePageIndex: nextActiveTab.activePageIndex ?? 0 },
        nextActiveTab.pdfDocProxy
      );
    }

    setCloseConfirmModalOpen(false, null);
  };

  const handleDiscardAndClose = () => {
    if (isSaving) return;
    performCloseTab();
    addToast('Değişiklikler kaydedilmeden kapatıldı.', 'info');
  };

  const handleSaveAndClose = async () => {
    if (!targetTab || isSaving) return;
    const electron = typeof window !== 'undefined' ? window.electronAPI : undefined;

    try {
      setIsSaving(true);
      addToast('Kaydediliyor...', 'info');
      const docToSave =
        currentDocument && currentDocument.id === targetTab.id
          ? currentDocument
          : targetTab.model;

      const rawOut = await PdfExporter.exportDocumentWithAnnotations(docToSave);

      if (electron?.saveFile && docToSave.filePath) {
        const saveRes = await electron.saveFile(docToSave.filePath, rawOut);
        if (!saveRes?.success) {
          addToast('Kaydetme sırasında hata oluştu: ' + (saveRes?.error || 'Bilinmeyen hata'), 'error');
          return;
        }
      } else {
        const saveRes = await saveBinaryOrBlobFile({
          data: rawOut,
          defaultName: targetTab.name,
          dialogTitle: 'Değişiklikleri Kaydet',
          filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
          mimeType: 'application/pdf',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi; belge açık bırakıldı.', 'info');
          return;
        }
      }

      performCloseTab();
      addToast(`"${targetTab.name}" kaydedildi ve kapatıldı.`, 'success');
    } catch (err: unknown) {
      console.error('Save before close failed:', err);
      const message = err instanceof Error ? err.message : 'Kaydetme sırasında hata oluştu.';
      addToast(message, 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150 select-none">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5 text-slate-900 dark:text-white font-bold text-sm">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <span>Kaydedilmemiş Değişiklikler</span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3 text-xs text-slate-600 dark:text-slate-400">
          <p>
            <strong className="text-slate-900 dark:text-slate-100 break-all">{docName}</strong> üzerinde yaptığınız düzenlemeler henüz kaydedilmedi.
          </p>
          <p>
            Sekmeyi kaydetmeden kapatırsanız yaptığınız tüm çizimler, metinler ve sayfa değişiklikleri kaybolacaktır.
          </p>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={isSaving}
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-40"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleDiscardAndClose}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Kaydetmeden Kapat
          </button>
          <button
            type="button"
            onClick={handleSaveAndClose}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-xl shadow transition-colors disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            {isSaving ? 'Kaydediliyor...' : 'Kaydet ve Kapat'}
          </button>
        </div>
      </div>
    </div>
  );
};
