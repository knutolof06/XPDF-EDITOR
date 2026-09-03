import React, { useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { Lock, X, KeyRound, Loader2 } from 'lucide-react';

export const PasswordModal: React.FC = () => {
  const { isPasswordModalOpen, pendingPasswordDoc, setPasswordModalOpen, addToast } = useUIStore();
  const { setDocument, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();

  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isPasswordModalOpen || !pendingPasswordDoc) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setErrorMessage('Lütfen belge parolasını girin.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const { model, pdfDoc } = await PdfLoader.loadDocument(
        pendingPasswordDoc.name,
        pendingPasswordDoc.buffer,
        pendingPasswordDoc.filePath,
        password
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

      addToast(`"${model.name}" başarıyla açıldı.`, 'success');
      setPassword('');
      setPasswordModalOpen(false, null);
    } catch (err: any) {
      console.error('Password unlock failed:', err);
      if (err?.isPasswordProtected || err?.name === 'PasswordException' || err?.message?.toLowerCase().includes('password')) {
        setErrorMessage('Hatalı parola! Lütfen tekrar deneyin.');
      } else {
        setErrorMessage('Belge açılırken bir hata oluştu.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setPassword('');
    setErrorMessage(null);
    setPasswordModalOpen(false, null);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <span>Parola ile Korunan PDF</span>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            <strong className="text-slate-800 dark:text-slate-200 break-all">{pendingPasswordDoc.name}</strong> dosyası şifrelenmiştir. Görüntülemek ve düzenlemek için lütfen parolayı girin:
          </p>

          <div className="space-y-1.5">
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Döküman parolasını girin..."
                className="w-full pl-9 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900 dark:text-white"
              />
            </div>

            {errorMessage && (
              <p className="text-xs text-rose-500 font-medium animate-in fade-in">
                {errorMessage}
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !password}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-sky-600 hover:bg-sky-500 disabled:opacity-50 rounded-xl shadow transition-colors"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Doğrulanıyor...
                </>
              ) : (
                'Kilidi Aç ve Görüntüle'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
