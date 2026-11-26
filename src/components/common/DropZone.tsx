import React, { useState, DragEvent } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { UploadCloud } from 'lucide-react';
import { openPdfFromBuffer } from './pdf-actions';

interface DropZoneProps {
  children: React.ReactNode;
}

function isExternalFileDrag(e: DragEvent<HTMLDivElement>): boolean {
  if (typeof window !== 'undefined' && (window as Window & { __xpdf_internal_drag?: unknown }).__xpdf_internal_drag) {
    return false;
  }
  const types = e.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes('Files');
}

export const DropZone: React.FC<DropZoneProps> = ({ children }) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const { addToast, setInsertModalOpen } = useUIStore();

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) {
      if (isDraggingOver) setIsDraggingOver(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!isDraggingOver) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    if (!isExternalFileDrag(e)) {
      setIsDraggingOver(false);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files || []);
    if (files.length === 0) return;

    const pdfFile = files.find((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'));

    if (!pdfFile) {
      addToast('Lütfen geçerli bir .pdf dosyası bırakın.', 'warning');
      return;
    }

    // If a document is already open, ask to insert pages into current PDF
    if (currentDocument) {
      setInsertModalOpen(true, pdfFile);
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const filePath = (pdfFile as File & { path?: string }).path || undefined;
      await openPdfFromBuffer(pdfFile.name, arrayBuffer, filePath);
    } catch (err) {
      console.error('PDF bırakma hatası:', err);
      useDocumentStore.getState().setLoading(false);
      addToast('PDF açılamadı. Dosya bozuk veya desteklenmiyor olabilir.', 'error');
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="relative w-full h-full flex flex-col flex-1 overflow-hidden"
    >
      {children}

      {isDraggingOver && (
        <div className="no-print absolute inset-0 z-50 bg-sky-950/80 backdrop-blur-md flex flex-col items-center justify-center border-4 border-dashed border-sky-400 m-4 rounded-3xl animate-in fade-in zoom-in-95 duration-200">
          <div className="p-6 bg-sky-500/20 rounded-full mb-4 animate-bounce">
            <UploadCloud className="w-16 h-16 text-sky-400" />
          </div>
          <h3 className="text-2xl font-bold text-white tracking-tight">PDF Dosyasını Buraya Bırakın</h3>
          <p className="text-sky-200 mt-2 font-medium">
            {currentDocument
              ? 'Mevcut belgeye sayfa olarak ekleme veya yeni sekmede açma penceresi açılacaktır'
              : 'Anında yerel olarak işlenip görüntülenecektir'}
          </p>
        </div>
      )}
    </div>
  );
};
