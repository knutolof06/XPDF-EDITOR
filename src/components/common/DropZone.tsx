import React, { useState, DragEvent } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { UploadCloud } from 'lucide-react';

interface DropZoneProps {
  children: React.ReactNode;
}

export const DropZone: React.FC<DropZoneProps> = ({ children }) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const { currentDocument, setDocument, setLoading, setError, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const { addToast, setInsertModalOpen } = useUIStore();

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDraggingOver) setIsDraggingOver(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const files = Array.from(e.dataTransfer.files);
    const pdfFile = files.find((f) => f.type === 'application/pdf' || f.name.endsWith('.pdf'));

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
      setLoading(true);
      addToast(`"${pdfFile.name}" yükleniyor...`, 'info');

      const arrayBuffer = await pdfFile.arrayBuffer();
      const { model, pdfDoc } = await PdfLoader.loadDocument(pdfFile.name, arrayBuffer);

      setDocument(model, pdfDoc);
      addTab(model, pdfDoc);
      addRecentDocument({
        id: model.id,
        name: model.name,
        fileSize: model.fileSize,
        pageCount: model.totalPages,
        lastOpened: Date.now(),
      });

      addToast(`"${pdfFile.name}" başarıyla açıldı (${model.totalPages} sayfa).`, 'success');
    } catch (err: any) {
      console.error('PDF yükleme hatası:', err);
      setError(err?.message || 'PDF dosyası yüklenirken bir hata oluştu.');
      addToast('PDF açılamadı. Dosya bozuk veya şifreli olabilir.', 'error');
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
        <div className="absolute inset-0 z-50 bg-sky-950/80 backdrop-blur-md flex flex-col items-center justify-center border-4 border-dashed border-sky-400 m-4 rounded-3xl animate-in fade-in zoom-in-95 duration-200">
          <div className="p-6 bg-sky-500/20 rounded-full mb-4 animate-bounce">
            <UploadCloud className="w-16 h-16 text-sky-400" />
          </div>
          <h3 className="text-2xl font-bold text-white tracking-tight">PDF Dosyasını Buraya Bırakın</h3>
          <p className="text-sky-200 mt-2 font-medium">
            {currentDocument
              ? 'Mevcut dökümana sayfa olarak ekleme veya yeni sekmede açma penceresi açılacaktır'
              : 'Anında yerel olarak işlenip görüntülenecektir'}
          </p>
        </div>
      )}
    </div>
  );
};
