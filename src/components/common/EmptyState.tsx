import React, { useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import {
  Upload,
  FilePlus2,
  Clock,
  Sparkles,
  Layers,
  Zap,
  ShieldCheck,
} from 'lucide-react';

export const EmptyState: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    setDocument,
    setLoading,
    setError,
    recentDocuments,
    addRecentDocument,
  } = useDocumentStore();

  const { addTab } = useTabStore();
  const { setMergeModalOpen, addToast } = useUIStore();

  const handleOpenFile = async (file: File) => {
    try {
      setLoading(true);
      addToast(`"${file.name}" yükleniyor...`, 'info');
      const arrayBuffer = await file.arrayBuffer();
      const { model, pdfDoc } = await PdfLoader.loadDocument(file.name, arrayBuffer);
      setDocument(model, pdfDoc);
      addTab(model, pdfDoc);
      addRecentDocument({
        id: model.id,
        name: model.name,
        fileSize: model.fileSize,
        pageCount: model.totalPages,
        lastOpened: Date.now(),
      });
      addToast(`"${file.name}" başarıyla açıldı.`, 'success');
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'PDF yüklenemedi.');
      addToast('PDF yüklenemedi.', 'error');
    }
  };

  const handleCreateBlankPdf = async () => {
    try {
      addToast('Boş PDF dökümanı oluşturuluyor...', 'info');
      const { PDFDocument } = await import('pdf-lib');
      const pdfDoc = await PDFDocument.create();
      pdfDoc.addPage([595.28, 841.89]); // A4
      const bytes = await pdfDoc.save();
      const rawBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      const loaded = await PdfLoader.loadDocument('Yeni_Belge.pdf', rawBuffer);
      setDocument(loaded.model, loaded.pdfDoc);
      addTab(loaded.model, loaded.pdfDoc);
      addToast('Yeni boş PDF oluşturuldu.', 'success');
    } catch (err) {
      console.error(err);
      addToast('Boş PDF oluşturulamadı.', 'error');
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center select-none bg-slate-100 dark:bg-slate-950 transition-colors">
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleOpenFile(file);
        }}
        accept="application/pdf"
        className="hidden"
      />

      <div className="max-w-xl w-full flex flex-col items-center">
        {/* Modern App Icon */}
        <div className="w-28 h-28 flex items-center justify-center mb-4 group hover:scale-105 transition-transform duration-300">
          <img src="./icons/icon256.png" alt="XPDF Logo" className="w-full h-full object-contain drop-shadow-2xl" />
        </div>

        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
          XPDF Profesyonel PDF Editörü
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-8 max-w-md">
          Gelişmiş düzenleme, sayfa yönetimi, birleştirme, imzalama ve yapay zeka asistanı içeren modern PDF çalışma alanı.
        </p>

        {/* Primary Action Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-3 w-full max-w-md mb-10">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex-1 min-w-[140px] flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold shadow-lg shadow-sky-600/25 transition-all transform active:scale-95"
          >
            <Upload className="w-4 h-4" />
            PDF Dosyası Aç
          </button>

          <button
            onClick={handleCreateBlankPdf}
            className="flex-1 min-w-[140px] flex items-center justify-center gap-2 py-3 px-5 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-sm font-semibold transition-all transform active:scale-95 shadow-sm"
          >
            <FilePlus2 className="w-4 h-4 text-sky-500 dark:text-sky-400" />
            Boş Belge Oluştur
          </button>

          <button
            onClick={() => setMergeModalOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-200 dark:bg-slate-900 hover:bg-slate-300 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-800 text-xs font-medium transition-colors"
          >
            <Layers className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            Birden Fazla PDF'i Birleştir
          </button>
        </div>

        {/* Feature Highlights */}
        <div className="grid grid-cols-3 gap-3 w-full max-w-lg mb-8 text-left">
          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600 dark:text-sky-400 mb-2">
              <Zap className="w-4 h-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-200">Hızlı & Yerel</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Tüm işlemler tarayıcınızda 60 FPS çalışır.</p>
          </div>

          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-2">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-200">%100 Güvenli</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Dosyalarınız hiçbir sunucuya yüklenmez.</p>
          </div>

          <div className="p-3.5 rounded-xl bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 shadow-sm">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-2">
              <Sparkles className="w-4 h-4" />
            </div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-200">Yapay Zeka</h4>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Döküman özeti ve soru-cevap asistanı.</p>
          </div>
        </div>

        {/* Recent Documents */}
        {recentDocuments.length > 0 && (
          <div className="w-full max-w-md text-left">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 px-1">
              <Clock className="w-3.5 h-3.5" />
              <span>Son Açılan Belgeler</span>
            </div>
            <div className="space-y-1.5">
              {recentDocuments.slice(0, 3).map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-slate-900/50 hover:bg-slate-50 dark:hover:bg-slate-800/80 border border-slate-200 dark:border-slate-800/80 text-xs transition-colors"
                >
                  <span className="font-medium text-slate-800 dark:text-slate-300 truncate max-w-xs">{doc.name}</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-500">{doc.pageCount} sayfa</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
