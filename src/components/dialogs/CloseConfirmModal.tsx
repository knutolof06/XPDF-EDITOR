import React from 'react';
import { useUIStore } from '@/store/ui-store';
import { useTabStore } from '@/store/tab-store';
import { useDocumentStore } from '@/store/document-store';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import { AlertTriangle, X, Save, Trash2 } from 'lucide-react';

export const CloseConfirmModal: React.FC = () => {
  const { isCloseConfirmModalOpen, pendingCloseTabId, setCloseConfirmModalOpen, addToast } = useUIStore();
  const { tabs, closeTab } = useTabStore();
  const { setDocument } = useDocumentStore();

  if (!isCloseConfirmModalOpen || !pendingCloseTabId) return null;

  const targetTab = tabs.find((t) => t.id === pendingCloseTabId);
  const docName = targetTab?.name || 'Bu belge';

  const handleDiscardAndClose = () => {
    closeTab(pendingCloseTabId);
    const remaining = tabs.filter((t) => t.id !== pendingCloseTabId);
    if (remaining.length > 0) {
      const next = remaining[0];
      setDocument({ ...next.model, activePageIndex: next.activePageIndex ?? 0 }, next.pdfDocProxy);
    } else {
      useDocumentStore.getState().closeDocument();
    }
    setCloseConfirmModalOpen(false, null);
    addToast('Değişiklikler kaydedilmeden kapatıldı.', 'info');
  };

  const handleSaveAndClose = async () => {
    if (!targetTab) return;
    const electron = (window as any).electronAPI;
    try {
      addToast('Kaydediliyor...', 'info');
      const rawOut = await PdfExporter.exportDocumentWithAnnotations(targetTab.model);

      if (electron?.saveFile && targetTab.model.filePath) {
        await electron.saveFile(targetTab.model.filePath, rawOut);
      } else if (electron?.showSaveDialog) {
        const savePath = await electron.showSaveDialog({ defaultPath: targetTab.name });
        if (savePath) {
          await electron.saveFile(savePath, rawOut);
        }
      } else {
        const blob = new Blob([rawOut], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = targetTab.name;
        a.click();
        URL.revokeObjectURL(url);
      }

      addToast(`"${targetTab.name}" kaydedildi ve kapatıldı.`, 'success');
      handleDiscardAndClose();
    } catch (err) {
      console.error('Save before close failed:', err);
      addToast('Kaydetme sırasında hata oluştu.', 'error');
    }
  };

  const handleCancel = () => {
    setCloseConfirmModalOpen(false, null);
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
            onClick={handleCancel}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
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
            className="px-3.5 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={handleDiscardAndClose}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Kaydetmeden Kapat
          </button>
          <button
            type="button"
            onClick={handleSaveAndClose}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 rounded-xl shadow transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            Kaydet ve Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
