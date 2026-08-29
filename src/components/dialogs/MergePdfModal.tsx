import React, { useState, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import {
  X,
  FilePlus,
  ArrowUp,
  ArrowDown,
  Trash2,
  Layers,
  FileText,
  CheckCircle2,
} from 'lucide-react';

interface SelectedMergeFile {
  id: string;
  name: string;
  sizeFormatted: string;
  buffer: ArrayBuffer;
}

export const MergePdfModal: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<SelectedMergeFile[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const { setDocument, addRecentDocument } = useDocumentStore();
  const { isMergeModalOpen, setMergeModalOpen, addToast } = useUIStore();

  if (!isMergeModalOpen) return null;

  const handleAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.length === 0) return;

    const newItems: SelectedMergeFile[] = [];
    for (const f of selected) {
      if (f.type === 'application/pdf' || f.name.endsWith('.pdf')) {
        const buffer = await f.arrayBuffer();
        newItems.push({
          id: 'file_' + Math.random().toString(36).substring(2, 7),
          name: f.name,
          sizeFormatted: (f.size / 1024 / 1024).toFixed(2) + ' MB',
          buffer,
        });
      }
    }

    setFiles((prev) => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= files.length) return;

    setFiles((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
  };

  const handleRemove = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleMerge = async () => {
    if (files.length < 2) {
      addToast('Birleştirmek için en az 2 PDF dosyası ekleyin.', 'warning');
      return;
    }

    try {
      setIsProcessing(true);
      addToast('PDF dosyaları birleştiriliyor...', 'info');

      const result = await PdfAssembler.mergePdfs(
        files.map((f) => ({ name: f.name, buffer: f.buffer }))
      );

      const { model, pdfDoc } = await PdfLoader.loadDocument(result.name, result.buffer);
      setDocument(model, pdfDoc);
      addRecentDocument({
        id: model.id,
        name: model.name,
        fileSize: model.fileSize,
        pageCount: model.totalPages,
        lastOpened: Date.now(),
      });

      addToast(`Başarılı! ${files.length} döküman tek PDF olarak açıldı.`, 'success');
      setMergeModalOpen(false);
      setFiles([]);
    } catch (err: any) {
      console.error(err);
      addToast(err?.message || 'Birleştirme sırasında hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleAddFiles}
        accept="application/pdf"
        multiple
        className="hidden"
      />

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">PDF Birleştirici (Merge)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Dosyaları ekleyin, sıralayın ve tek bir PDF yapın</p>
            </div>
          </div>
          <button
            onClick={() => setMergeModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content: File list */}
        <div className="p-6 flex-1 overflow-y-auto space-y-3">
          {files.length === 0 ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-sky-500/70 rounded-2xl p-8 flex flex-col items-center justify-center cursor-pointer bg-slate-50 dark:bg-slate-800/30 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors text-center"
            >
              <FilePlus className="w-10 h-10 text-sky-500 dark:text-sky-400 mb-2" />
              <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Birleştirilecek PDF Dosyalarını Seçin</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Birden fazla dosya seçebilir veya buraya tıklayabilirsiniz</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
                <span>Sıralama ({files.length} dosya)</span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="text-sky-600 dark:text-sky-400 hover:text-sky-500 font-medium flex items-center gap-1"
                >
                  <FilePlus className="w-3.5 h-3.5" /> Daha Fazla Ekle
                </button>
              </div>

              {files.map((file, idx) => (
                <div
                  key={file.id}
                  className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60"
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <span className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center text-xs font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <FileText className="w-4 h-4 text-sky-500 dark:text-sky-400 shrink-0" />
                    <div className="truncate">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{file.name}</p>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">{file.sizeFormatted}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      onClick={() => handleMove(idx, 'up')}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-20"
                      title="Yukarı Taşı"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleMove(idx, 'down')}
                      disabled={idx === files.length - 1}
                      className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-20"
                      title="Aşağı Taşı"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleRemove(file.id)}
                      className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-500/20 text-rose-500 ml-1"
                      title="Listeden Çıkar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <button
            onClick={() => setFiles([])}
            disabled={files.length === 0}
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-30 font-medium"
          >
            Temizle
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMergeModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
            >
              İptal
            </button>
            <button
              onClick={handleMerge}
              disabled={files.length < 2 || isProcessing}
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
            >
              <CheckCircle2 className="w-4 h-4" />
              {isProcessing ? 'Birleştiriliyor...' : 'PDF leri Birleştir'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
