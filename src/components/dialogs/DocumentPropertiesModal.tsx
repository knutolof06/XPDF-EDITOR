import React, { useEffect, useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { X, Info, CheckCircle2, Loader2 } from 'lucide-react';
import { markCurrentDocumentModified, useModalEscape } from './modal-utils';

export const DocumentPropertiesModal: React.FC = () => {
  const { currentDocument } = useDocumentStore();
  const { isPropertiesModalOpen, setPropertiesModalOpen, addToast } = useUIStore();

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [subject, setSubject] = useState('');
  const [keywords, setKeywords] = useState('');
  const [creator, setCreator] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  useEffect(() => {
    if (!isPropertiesModalOpen || !currentDocument) return;
    const m = currentDocument.metadata;
    setTitle(m.title || '');
    setAuthor(m.author || '');
    setSubject(m.subject || '');
    setKeywords(m.keywords || '');
    setCreator(m.creator || '');
  }, [isPropertiesModalOpen, currentDocument]);

  useModalEscape(isPropertiesModalOpen, () => setPropertiesModalOpen(false));

  if (!isPropertiesModalOpen || !currentDocument) return null;

  const { metadata, name, totalPages, filePath } = currentDocument;

  const handleSaveMetadata = (e: React.FormEvent) => {
    e.preventDefault();
    markCurrentDocumentModified({
      metadata: {
        ...currentDocument.metadata,
        title: title.trim() || undefined,
        author: author.trim() || undefined,
        subject: subject.trim() || undefined,
        keywords: keywords.trim() || undefined,
        creator: creator.trim() || undefined,
      },
    });
    addToast('Belge meta verileri güncellendi (Kaydederken PDF içine yazılacaktır).', 'success');
    setPropertiesModalOpen(false);
  };

  const handleRegisterAssociation = async () => {
    const electron = window.electronAPI;
    if (!electron?.registerPdfAssociation) {
      addToast('Bu özellik Windows Masaüstü (.exe) sürümünde aktiftir.', 'info');
      return;
    }

    try {
      setIsRegistering(true);
      addToast('XPDF varsayılan PDF programı olarak kaydediliyor...', 'info');
      const res = await electron.registerPdfAssociation();
      if (res?.success) {
        addToast(res.message || 'Varsayılan program yapıldı!', 'success');
      } else {
        addToast(res?.error || 'Kayıt başarısız oldu.', 'error');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Varsayılan program kaydı başarısız.';
      addToast(msg, 'error');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setPropertiesModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Info className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Döküman Özellikleri & Meta Veriler
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                PDF dosya bilgilerini inceleyin ve meta veri etiketlerini düzenleyin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPropertiesModalOpen(false)}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form & Info Body */}
        <form onSubmit={handleSaveMetadata} className="p-6 space-y-4 overflow-y-auto text-xs">
          {/* Read-only System File Properties */}
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-3 space-y-2">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">Dosya Adı:</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{name}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500 dark:text-slate-400 shrink-0">Dosya Yolu:</span>
              <span className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate" title={filePath || ''}>
                {filePath || 'Bellek içi / Tarayıcı'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
              <div>
                <span className="text-[10px] text-slate-400 block">Sayfa Sayısı</span>
                <span className="font-semibold">{totalPages} sayfa</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Dosya Boyutu</span>
                <span className="font-semibold">{metadata.fileSizeFormatted || 'Bilinmiyor'}</span>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 block">Güvenlik</span>
                <span className="font-semibold">
                  {metadata.isEncrypted ? 'Şifreli' : 'Şifresiz'}
                </span>
              </div>
            </div>
            {(metadata.producer || metadata.creationDate || metadata.modificationDate) && (
              <div className="pt-1 border-t border-slate-200/70 dark:border-slate-700/70 space-y-1 text-[11px]">
                {metadata.producer && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">PDF Üreticisi:</span>
                    <span className="truncate">{metadata.producer}</span>
                  </div>
                )}
                {metadata.creationDate && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Oluşturulma:</span>
                    <span className="truncate font-mono">{metadata.creationDate}</span>
                  </div>
                )}
                {metadata.modificationDate && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Değiştirilme:</span>
                    <span className="truncate font-mono">{metadata.modificationDate}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Editable Metadata Inputs */}
          <div className="space-y-2.5">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Belge Başlığı (Title)
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Başlık girin..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Yazar (Author)
                </label>
                <input
                  type="text"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  placeholder="Yazar adı..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Oluşturan Uygulama (Creator)
                </label>
                <input
                  type="text"
                  value={creator}
                  onChange={(e) => setCreator(e.target.value)}
                  placeholder="Uygulama adı..."
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Konu (Subject)
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Belge konusu..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Anahtar Kelimeler (Keywords)
              </label>
              <input
                type="text"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="Örn: sözleşme, 2026, finans"
                className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* Windows Integration */}
          <div className="pt-2 space-y-1.5 border-t border-slate-200 dark:border-slate-800">
            <span className="text-slate-500 dark:text-slate-400 font-semibold block text-[11px]">
              Windows Entegrasyonu:
            </span>
            <button
              type="button"
              onClick={handleRegisterAssociation}
              disabled={isRegistering}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900 border border-sky-300 dark:border-sky-800 text-sky-700 dark:text-sky-300 text-xs font-medium transition-colors disabled:opacity-50"
            >
              {isRegistering && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {isRegistering
                  ? 'Kaydediliyor...'
                  : "XPDF'i Varsayılan PDF Yöneticisi Yap"}
              </span>
            </button>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPropertiesModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
            >
              İptal
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Kaydet & Uygula</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
