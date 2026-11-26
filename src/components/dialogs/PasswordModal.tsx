import React, { useState, useEffect } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { Lock, X, KeyRound, Loader2, Eye, EyeOff } from 'lucide-react';

export const PasswordModal: React.FC = () => {
  const { isPasswordModalOpen, pendingPasswordDoc, setPasswordModalOpen, addToast } = useUIStore();
  const { setDocument, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Reset form state when modal opens/closes or target document changes
  useEffect(() => {
    setPassword('');
    setShowPassword(false);
    setErrorMessage(null);
    setIsSubmitting(false);
  }, [isPasswordModalOpen, pendingPasswordDoc]);

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
        filePath: pendingPasswordDoc.filePath,
        fileSize: model.fileSize,
        pageCount: model.totalPages,
        lastOpened: Date.now(),
      });

      addToast(`"${model.name}" başarıyla açıldı.`, 'success');
      setPassword('');
      setShowPassword(false);
      setPasswordModalOpen(false, null);
    } catch (err: unknown) {
      console.error('Password unlock failed:', err);
      const eObj = err as { isPasswordProtected?: boolean; name?: string; message?: string };
      const msgLower = String(eObj?.message || '').toLowerCase();

      if (
        eObj?.isPasswordProtected ||
        eObj?.name === 'PasswordException' ||
        msgLower.includes('password') ||
        msgLower.includes('parola')
      ) {
        setErrorMessage('Hatalı parola! Lütfen belge parolasını kontrol edip tekrar deneyin.');
      } else if (
        eObj?.name === 'InvalidPDFException' ||
        msgLower.includes('invalid pdf') ||
        msgLower.includes('corrupt') ||
        msgLower.includes('format')
      ) {
        setErrorMessage('PDF dosyası bozuk veya geçersiz bir yapıya sahip.');
      } else {
        setErrorMessage(
          eObj?.message
            ? `Belge açılırken hata oluştu: ${eObj.message}`
            : 'Belge açılırken beklenmeyen bir hata oluştu.'
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setPassword('');
    setShowPassword(false);
    setErrorMessage(null);
    setPasswordModalOpen(false, null);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
            <span>Parola ile Korunan PDF</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-600 dark:text-slate-400">
            <strong className="text-slate-800 dark:text-slate-200 break-all">
              {pendingPasswordDoc.name}
            </strong>{' '}
            dosyası şifrelenmiştir. Görüntülemek ve düzenlemek için lütfen parolayı girin:
          </p>

          <div className="space-y-1.5">
            <div className="relative">
              <KeyRound className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                autoFocus
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (errorMessage) setErrorMessage(null);
                }}
                placeholder="Döküman parolasını girin..."
                className="w-full pl-9 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 text-slate-900 dark:text-white"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Parolayı gizle' : 'Parolayı göster'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
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
