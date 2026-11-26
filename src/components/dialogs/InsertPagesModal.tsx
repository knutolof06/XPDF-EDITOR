import React, { useState, useRef, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { historyManager, DocumentStateSnapshotCommand } from '@/core/history/command-manager';
import { PDFDocument } from 'pdf-lib';
import {
  X,
  FilePlus,
  FileText,
  PlusCircle,
} from 'lucide-react';
import { syncReplacedActiveDocument, useModalEscape } from './modal-utils';

export const InsertPagesModal: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const { isInsertModalOpen, pendingInsertFile, setInsertModalOpen, addToast } = useUIStore();

  const [insertType, setInsertType] = useState<'blank' | 'file'>('blank');
  const [selectedFile, setSelectedFile] = useState<{ name: string; buffer: ArrayBuffer } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Hydrate pendingInsertFile from DropZone / UI store or reset cleanly on reopen
  useEffect(() => {
    if (!isInsertModalOpen) {
      setSelectedFile(null);
      setInsertType('blank');
      return;
    }

    if (pendingInsertFile) {
      let cancelled = false;
      pendingInsertFile
        .arrayBuffer()
        .then((buffer) => {
          if (cancelled) return;
          setInsertType('file');
          setSelectedFile({ name: pendingInsertFile.name, buffer });
        })
        .catch(() => {
          if (!cancelled) {
            addToast('Bırakılan PDF dosyası okunamadı.', 'error');
          }
        });
      return () => {
        cancelled = true;
      };
    }

    setSelectedFile(null);
    setInsertType('blank');
  }, [isInsertModalOpen, pendingInsertFile, addToast]);

  const handleClose = () => {
    if (isProcessing) return;
    setSelectedFile(null);
    setInsertType('blank');
    setInsertModalOpen(false, null);
  };

  useModalEscape(isInsertModalOpen, handleClose, isProcessing);

  if (!isInsertModalOpen || !currentDocument) return null;

  const targetIdx = currentDocument.activePageIndex ?? currentDocument.pages.length - 1;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      setSelectedFile({ name: file.name, buffer });
    } catch {
      addToast('Dosya okunamadı.', 'error');
    }
  };

  const handleInsert = async () => {
    try {
      setIsProcessing(true);
      addToast('Sayfalar ekleniyor...', 'info');

      const prevDoc = currentDocument;
      const prevProxy = pdfDocProxy;

      if (insertType === 'blank') {
        const blankDoc = await PDFDocument.create();
        blankDoc.addPage([595.28, 841.89]);
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

        const synced = syncReplacedActiveDocument(result.model, result.pdfDoc, prevDoc, {
          isModified: true,
        });
        historyManager.push(
          new DocumentStateSnapshotCommand(
            'Boş sayfa eklendi',
            prevDoc,
            prevProxy,
            synced,
            result.pdfDoc
          )
        );
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

        const synced = syncReplacedActiveDocument(result.model, result.pdfDoc, prevDoc, {
          isModified: true,
        });
        historyManager.push(
          new DocumentStateSnapshotCommand(
            `"${selectedFile.name}" sayfaları eklendi`,
            prevDoc,
            prevProxy,
            synced,
            result.pdfDoc
          )
        );
        addToast(`"${selectedFile.name}" sayfaları başarıyla eklendi.`, 'success');
      }

      setSelectedFile(null);
      setInsertModalOpen(false, null);
    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Sayfa ekleme sırasında hata oluştu.';
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={handleClose}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,application/pdf"
        className="hidden"
      />

      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
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
            type="button"
            onClick={handleClose}
            disabled={isProcessing}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
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
              type="button"
              onClick={() => {
                setInsertType('file');
                if (!selectedFile) fileInputRef.current?.click();
              }}
              className={`p-4 rounded-xl border text-center transition-all flex flex-col items-center gap-2 ${
                insertType === 'file'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <PlusCircle className="w-6 h-6" />
              <span className="text-xs">Başka PDF&apos;den Ekle</span>
            </button>
          </div>

          {insertType === 'file' && selectedFile && (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-800 dark:text-slate-200">
              <span className="font-semibold truncate">{selectedFile.name}</span>
              <button
                type="button"
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
            type="button"
            onClick={handleClose}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-40"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleInsert}
            disabled={(insertType === 'file' && !selectedFile) || isProcessing}
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors"
          >
            {isProcessing ? 'Ekleniyor...' : 'Sayfayı Ekle'}
          </button>
        </div>
      </div>
    </div>
  );
};
