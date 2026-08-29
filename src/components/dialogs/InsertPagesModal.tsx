import React, { useState, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PDFDocument } from 'pdf-lib';
import {
  X,
  FilePlus,
  FileText,
  PlusCircle,
} from 'lucide-react';

export const InsertPagesModal: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentDocument, setDocument } = useDocumentStore();
  const { isInsertModalOpen, setInsertModalOpen, addToast } = useUIStore();

  const [insertType, setInsertType] = useState<'blank' | 'file'>('blank');
  const [selectedFile, setSelectedFile] = useState<{ name: string; buffer: ArrayBuffer } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isInsertModalOpen || !currentDocument) return null;

  const targetIdx = currentDocument.activePageIndex ?? currentDocument.pages.length - 1;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const buffer = await file.arrayBuffer();
    setSelectedFile({ name: file.name, buffer });
  };

  const handleInsert = async () => {
    try {
      setIsProcessing(true);
      addToast('Sayfalar ekleniyor...', 'info');

      if (insertType === 'blank') {
        const blankDoc = await PDFDocument.create();
        blankDoc.addPage([595.28, 841.89]); // Standard A4
        const blankBytes = await blankDoc.save();
        const rawBuffer = blankBytes.buffer.slice(
          blankBytes.byteOffset,
          blankBytes.byteOffset + blankBytes.byteLength
        ) as ArrayBuffer;

        const result = await PdfAssembler.insertPagesIntoDocument(
          currentDocument,
          rawBuffer,
          [0],
          targetIdx + 1
        );

        setDocument(result.model, result.pdfDoc);
        addToast('Boş sayfa başarıyla eklendi.', 'success');
      } else if (insertType === 'file' && selectedFile) {
        const sourceDoc = await PDFDocument.load(selectedFile.buffer);
        const allIndices = sourceDoc.getPageIndices();

        const result = await PdfAssembler.insertPagesIntoDocument(
          currentDocument,
          selectedFile.buffer,
          allIndices,
          targetIdx + 1
        );

        setDocument(result.model, result.pdfDoc);
        addToast(`"${selectedFile.name}" sayfaları başarıyla eklendi.`, 'success');
      }

      setInsertModalOpen(false, null);
    } catch (err: any) {
      console.error(err);
      addToast('Sayfa ekleme sırasında hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="application/pdf"
        className="hidden"
      />

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <FilePlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Araya Sayfa Ekle</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {targetIdx + 1}. sayfadan sonrasına yeni sayfa veya döküman ekleyin
              </p>
            </div>
          </div>
          <button
            onClick={() => setInsertModalOpen(false, null)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setInsertType('blank')}
              className={`p-4 rounded-xl border text-center transition-all flex flex-col items-center gap-2 ${
                insertType === 'blank'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <FileText className="w-6 h-6" />
              <span className="text-xs">Boş A4 Sayfası Ekle</span>
            </button>

            <button
              onClick={() => {
                setInsertType('file');
                fileInputRef.current?.click();
              }}
              className={`p-4 rounded-xl border text-center transition-all flex flex-col items-center gap-2 ${
                insertType === 'file'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <PlusCircle className="w-6 h-6" />
              <span className="text-xs">Başka PDF'den Ekle</span>
            </button>
          </div>

          {insertType === 'file' && selectedFile && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-800 dark:text-slate-200">
              <span className="font-semibold truncate">{selectedFile.name}</span>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-sky-600 dark:text-sky-400 hover:underline shrink-0 ml-2"
              >
                Değiştir
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={() => setInsertModalOpen(false, null)}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleInsert}
            disabled={insertType === 'file' && !selectedFile}
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors"
          >
            {isProcessing ? 'Ekleniyor...' : 'Sayfayı Ekle'}
          </button>
        </div>
      </div>
    </div>
  );
};
