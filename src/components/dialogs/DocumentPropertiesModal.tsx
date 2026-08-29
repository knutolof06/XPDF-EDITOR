import React from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { X, Info } from 'lucide-react';

export const DocumentPropertiesModal: React.FC = () => {
  const { currentDocument } = useDocumentStore();
  const { isPropertiesModalOpen, setPropertiesModalOpen, addToast } = useUIStore();

  if (!isPropertiesModalOpen || !currentDocument) return null;

  const { metadata, name, totalPages } = currentDocument;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Döküman Özellikleri</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">PDF dosya bilgileri ve meta verileri</p>
            </div>
          </div>
          <button
            onClick={() => setPropertiesModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-3 text-xs">
          <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">Dosya Adı:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">{name}</span>
          </div>

          <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">Toplam Sayfa:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{totalPages} sayfa</span>
          </div>

          <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400">Dosya Boyutu:</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">{metadata.fileSizeFormatted || 'Bilinmiyor'}</span>
          </div>

          {metadata.title && (
            <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">Başlık:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">{metadata.title}</span>
            </div>
          )}

          {metadata.author && (
            <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">Yazar:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">{metadata.author}</span>
            </div>
          )}

          {metadata.producer && (
            <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-slate-500 dark:text-slate-400">Üretici:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[220px]">{metadata.producer}</span>
            </div>
          )}

          {/* Windows Integration */}
          <div className="pt-2 space-y-2">
            <span className="text-slate-500 dark:text-slate-400 font-semibold block text-[11px]">Windows Entegrasyonu:</span>
            <button
              onClick={async () => {
                if (typeof window !== 'undefined' && (window as any).electronAPI?.registerPdfAssociation) {
                  addToast('XPDF varsayılan PDF programı olarak kaydediliyor...', 'info');
                  const res = await (window as any).electronAPI.registerPdfAssociation();
                  if (res?.success) addToast(res.message || 'Varsayılan program yapıldı!', 'success');
                  else addToast(res?.error || 'Kayıt başarısız oldu.', 'error');
                } else {
                  addToast('Bu özellik Windows Masaüstü (.exe) sürümünde aktiftir.', 'info');
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-xs font-medium transition-colors"
            >
              <span>XPDF'i Varsayılan PDF Yöneticisi Yap</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            onClick={() => setPropertiesModalOpen(false)}
            className="px-5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
