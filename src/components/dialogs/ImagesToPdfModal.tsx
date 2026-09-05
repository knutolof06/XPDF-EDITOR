import React, { useState, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { ImagesToPdfConverter, ImageToPdfItem, ImageToPdfConfig } from '@/core/engine/images-to-pdf';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { X, FilePlus, Upload, Trash2, ArrowUp, ArrowDown, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export const ImagesToPdfModal: React.FC = () => {
  const { isImagesToPdfModalOpen, setImagesToPdfModalOpen, addToast } = useUIStore();
  const { setDocument, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const theme = useViewerStore((s) => s.theme);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [images, setImages] = useState<ImageToPdfItem[]>([]);
  const [pageSize, setPageSize] = useState<'a4' | 'original' | 'letter'>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [margin, setMargin] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  if (!isImagesToPdfModalOpen) return null;

  const isDark = theme === 'dark';

  const handleFilesSelected = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const newItems: ImageToPdfItem[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        newItems.push({
          id: 'img_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
          file,
          previewUrl,
          width: 0,
          height: 0,
        });
      }
    });

    if (newItems.length === 0) {
      addToast('Lütfen geçerli bir görsel dosyası seçin (JPG, PNG, WebP).', 'warning');
      return;
    }

    setImages((prev) => [...prev, ...newItems]);
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    setImages((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleMoveDown = (index: number) => {
    if (index >= images.length - 1) return;
    setImages((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const handleRemove = (id: string) => {
    setImages((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleConvert = async () => {
    if (images.length === 0) {
      addToast('Lütfen en az bir görsel ekleyin.', 'warning');
      return;
    }

    try {
      setIsProcessing(true);
      setProgress({ current: 0, total: images.length });

      const config: ImageToPdfConfig = {
        pageSize,
        orientation,
        margin,
      };

      const pdfBuffer = await ImagesToPdfConverter.convertImagesToPdf(
        images,
        config,
        (current, total) => setProgress({ current, total })
      );

      const docName = `Gorsellerden_Olusturulan_${Date.now().toString().slice(-4)}.pdf`;
      const loaded = await PdfLoader.loadDocument(docName, pdfBuffer);
      setDocument(loaded.model, loaded.pdfDoc);
      addTab(loaded.model, loaded.pdfDoc);
      addRecentDocument({
        id: loaded.model.id,
        name: loaded.model.name,
        fileSize: loaded.model.fileSize,
        pageCount: loaded.model.totalPages,
        lastOpened: Date.now(),
      });

      // Clean up object URLs
      images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      setImages([]);
      setImagesToPdfModalOpen(false);

      addToast(`${images.length} görselden yeni PDF dökümanı başarıyla oluşturuldu ve açıldı!`, 'success');
    } catch (err: any) {
      console.error('Images to PDF conversion error:', err);
      addToast('Görseller PDF\'e dönüştürülürken hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const handleClose = () => {
    if (isProcessing) return;
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
    setImagesToPdfModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={cn(
          'w-full max-w-2xl rounded-2xl shadow-2xl border flex flex-col max-h-[90vh] overflow-hidden transition-all',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
        )}
      >
        {/* Hidden File Input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleFilesSelected(e.target.files)}
          className="hidden"
        />

        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between px-6 py-4 border-b shrink-0',
            isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/50'
          )}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <FilePlus className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Görsellerden PDF Oluştur</h2>
              <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>
                Fotoğrafları, taranmış belgeleri veya çizimleri birleştirip tek bir PDF yapın
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isProcessing}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto flex-1">
          {/* Upload Drop Area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFilesSelected(e.dataTransfer.files);
            }}
            className={cn(
              'border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center cursor-pointer transition-all gap-2 text-center',
              isDark
                ? 'border-slate-700 hover:border-purple-500 bg-slate-800/30 hover:bg-purple-500/5'
                : 'border-slate-300 hover:border-purple-500 bg-slate-50 hover:bg-purple-50/40'
            )}
          >
            <div className="w-10 h-10 rounded-full bg-purple-500/10 text-purple-500 flex items-center justify-center">
              <Upload className="w-5 h-5" />
            </div>
            <div className="text-xs font-bold">Görselleri buraya sürükleyin veya seçmek için tıklayın</div>
            <div className="text-[11px] text-slate-400">JPG, PNG, WebP formatları desteklenir</div>
          </div>

          {/* Image List Preview */}
          {images.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold">
                  Seçilen Görseller ({images.length}):
                </span>
                <button
                  onClick={() => setImages([])}
                  className="text-[11px] text-rose-500 hover:underline font-medium"
                >
                  Tümünü Temizle
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-56 overflow-y-auto p-1">
                {images.map((img, index) => (
                  <div
                    key={img.id}
                    className={cn(
                      'relative group rounded-xl border p-2 flex flex-col items-center gap-1.5 transition-all',
                      isDark ? 'bg-slate-800/60 border-slate-700' : 'bg-white border-slate-200 shadow-xs'
                    )}
                  >
                    <div className="w-full h-24 bg-slate-100 dark:bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center">
                      <img
                        src={img.previewUrl}
                        alt={img.file.name}
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>

                    <div className="w-full flex items-center justify-between text-[11px]">
                      <span className="font-mono font-bold text-sky-500">#{index + 1}</span>
                      <span className="truncate max-w-[90px] text-slate-500">{img.file.name}</span>
                    </div>

                    {/* Quick Move and Delete actions */}
                    <div className="flex items-center gap-1 w-full pt-1 border-t border-slate-100 dark:border-slate-700/60 justify-between">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={index === 0}
                          onClick={() => handleMoveUp(index)}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-600 dark:text-slate-300"
                          title="Yukarı Taşı"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={index === images.length - 1}
                          onClick={() => handleMoveDown(index)}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30 text-slate-600 dark:text-slate-300"
                          title="Aşağı Taşı"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemove(img.id)}
                        className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/50 text-rose-500"
                        title="Kaldır"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Options */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            {/* Page Size */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                Sayfa Boyutu:
              </label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as any)}
                className={cn(
                  'w-full text-xs p-2 rounded-xl border font-medium focus:outline-none focus:ring-2 focus:ring-purple-500',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                )}
              >
                <option value="a4">A4 (Standart 210 x 297 mm)</option>
                <option value="original">Görselin Kendi Boyutu</option>
                <option value="letter">Letter (Amerikan Format)</option>
              </select>
            </div>

            {/* Orientation */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                Sayfa Yönü:
              </label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as any)}
                disabled={pageSize === 'original'}
                className={cn(
                  'w-full text-xs p-2 rounded-xl border font-medium focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-40',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                )}
              >
                <option value="auto">Otomatik (Görsele Göre)</option>
                <option value="portrait">Dikey (Portrait)</option>
                <option value="landscape">Yatay (Landscape)</option>
              </select>
            </div>

            {/* Margin */}
            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                Kenarlık:
              </label>
              <select
                value={margin}
                onChange={(e) => setMargin(Number(e.target.value))}
                className={cn(
                  'w-full text-xs p-2 rounded-xl border font-medium focus:outline-none focus:ring-2 focus:ring-purple-500',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                )}
              >
                <option value={0}>Kenarlıksız (Tam Sayfa)</option>
                <option value={15}>İnce Kenarlık (~5 mm)</option>
                <option value={30}>Normal Kenarlık (~10 mm)</option>
              </select>
            </div>
          </div>

          {/* Progress Indicator */}
          {isProcessing && (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <Loader2 className="w-7 h-7 text-purple-500 animate-spin" />
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                PDF oluşturuluyor... ({progress?.current || 0} / {progress?.total || 0})
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={cn(
            'flex items-center justify-between px-6 py-4 border-t shrink-0',
            isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/50'
          )}
        >
          <span className="text-xs text-slate-500">
            {images.length > 0 ? `${images.length} görsel eklendi` : 'Görsel bekleniyor'}
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="px-4 py-2 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
            >
              Vazgeç
            </button>

            <button
              onClick={handleConvert}
              disabled={isProcessing || images.length === 0}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20 transition-all disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>PDF Oluştur ve Aç</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
