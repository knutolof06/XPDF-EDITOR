import React, { useState, useMemo, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfImageExporter, ImageExportFormat } from '@/core/engine/pdf-image-exporter';
import { X, Image as ImageIcon, Download, Loader2, FileArchive } from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  parsePageRange,
  saveBinaryOrBlobFile,
  useModalEscape,
  useResolvedDarkMode,
} from './modal-utils';

export const ExportImageModal: React.FC = () => {
  const { isExportImageModalOpen, setExportImageModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const isDark = useResolvedDarkMode();

  const [format, setFormat] = useState<ImageExportFormat>('png');
  const [scale, setScale] = useState<number>(2.0);
  const [scope, setScope] = useState<'all' | 'active' | 'custom'>('all');
  const [customRange, setCustomRange] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const cancelRequestedRef = useRef(false);

  const totalPages = pdfDocProxy?.numPages || 0;
  const activePageIndex = currentDocument?.activePageIndex || 0;

  useEffect(() => {
    if (isExportImageModalOpen) {
      setCustomRange('');
      setProgress(null);
      cancelRequestedRef.current = false;
    }
  }, [isExportImageModalOpen, currentDocument?.id]);

  useModalEscape(
    isExportImageModalOpen,
    () => setExportImageModalOpen(false),
    isProcessing
  );

  const rangeValidation = useMemo(() => {
    if (scope !== 'custom') {
      return { pages: [] as number[], isValid: true, error: undefined as string | undefined };
    }
    return parsePageRange(customRange, totalPages);
  }, [scope, customRange, totalPages]);

  if (!isExportImageModalOpen || !currentDocument || !pdfDocProxy) return null;

  const canSubmit = !isProcessing && (scope !== 'custom' || rangeValidation.isValid);

  const handleCancelExport = () => {
    if (isProcessing) {
      cancelRequestedRef.current = true;
      addToast('Görsel dışa aktarma iptal ediliyor...', 'info');
    } else {
      setExportImageModalOpen(false);
    }
  };

  const handleExport = async () => {
    if (scope === 'custom' && !rangeValidation.isValid) {
      addToast(rangeValidation.error || 'Lütfen geçerli bir sayfa aralığı girin.', 'warning');
      return;
    }

    cancelRequestedRef.current = false;
    try {
      setIsProcessing(true);
      const ext = format === 'jpeg' ? 'jpg' : format;
      const baseName = currentDocument.name.replace(/\.pdf$/i, '');

      if (scope === 'active') {
        const pageNum = activePageIndex + 1;
        setProgress({ current: 1, total: 1 });
        const { blob } = await PdfImageExporter.exportSinglePage(pdfDocProxy, pageNum, {
          format,
          scale,
        });

        if (cancelRequestedRef.current) return;

        const saveRes = await saveBinaryOrBlobFile({
          data: blob,
          defaultName: `${baseName}_sayfa_${pageNum}.${ext}`,
          dialogTitle: 'Sayfa Görselini Kaydet',
          filters: [{ name: `${format.toUpperCase()} Görseli`, extensions: [ext] }],
          mimeType:
            format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }

        addToast(`Sayfa ${pageNum} başarıyla ${format.toUpperCase()} olarak kaydedildi.`, 'success');
      } else {
        const targetPages =
          scope === 'custom'
            ? rangeValidation.pages
            : Array.from({ length: totalPages }, (_, i) => i + 1);

        if (targetPages.length === 0) {
          addToast('Dışa aktarılacak geçerli sayfa bulunamadı.', 'warning');
          return;
        }

        setProgress({ current: 0, total: targetPages.length });
        const zip = new JSZip();
        const mimeType =
          format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';

        for (let idx = 0; idx < targetPages.length; idx++) {
          if (cancelRequestedRef.current) {
            addToast('Görsel dışa aktarma iptal edildi.', 'info');
            return;
          }

          const pageNum = targetPages[idx];
          setProgress({ current: idx + 1, total: targetPages.length });

          const canvas = await PdfImageExporter.renderPageToCanvas(pdfDocProxy, pageNum, scale);
          const dataUrl = canvas.toDataURL(mimeType, 0.92);
          const base64Data = dataUrl.split(',')[1];
          const paddedIndex = String(pageNum).padStart(3, '0');
          zip.file(`${baseName}_sayfa_${paddedIndex}.${ext}`, base64Data, { base64: true });
          canvas.width = 0;
          canvas.height = 0;
        }

        if (cancelRequestedRef.current) {
          addToast('Görsel dışa aktarma iptal edildi.', 'info');
          return;
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `${baseName}_gorseller_${ext.toUpperCase()}.zip`;

        const saveRes = await saveBinaryOrBlobFile({
          data: zipBlob,
          defaultName: zipName,
          dialogTitle: 'Görselleri ZIP Olarak Kaydet',
          filters: [{ name: 'ZIP Arşivi', extensions: ['zip'] }],
          mimeType: 'application/zip',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }

        addToast(`${targetPages.length} sayfa ZIP arşivi olarak kaydedildi.`, 'success');
      }

      setExportImageModalOpen(false);
    } catch (err: unknown) {
      console.error('Export image error:', err);
      const msg = err instanceof Error ? err.message : 'Görsel dışa aktarılırken hata oluştu.';
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
      setProgress(null);
      cancelRequestedRef.current = false;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => !isProcessing && setExportImageModalOpen(false)}
    >
      <div
        className={cn(
          'w-full max-w-lg rounded-2xl shadow-2xl border flex flex-col overflow-hidden transition-all',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between px-6 py-4 border-b',
            isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/50'
          )}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">PDF&apos;i Görsele Dönüştür</h2>
              <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>
                Sayfaları PNG, JPG veya WebP formatında dışa aktarın
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isProcessing && setExportImageModalOpen(false)}
            disabled={isProcessing}
            aria-label="Kapat"
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5">
          {/* Format Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-2">
              Görsel Formatı:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'png', title: 'PNG', desc: 'Kayıpsız, Şeffaflık' },
                { id: 'jpeg', title: 'JPG', desc: 'Küçük Boyut' },
                { id: 'webp', title: 'WebP', desc: 'Modern & Hızlı' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormat(f.id as ImageExportFormat)}
                  className={cn(
                    'p-3 rounded-xl border-2 text-center transition-all flex flex-col items-center justify-center',
                    format === f.id
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold'
                      : isDark
                      ? 'border-slate-800 hover:border-slate-700 bg-slate-800/30 text-slate-300'
                      : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                  )}
                >
                  <span className="text-sm font-bold">{f.title}</span>
                  <span className="text-[10px] opacity-70 mt-0.5">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution / DPI Scale */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-2">
              Çözünürlük / Netlik:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { s: 1.0, title: 'Standart (1x)', desc: '~72 DPI' },
                { s: 2.0, title: 'Net (2x)', desc: '~150 DPI (Önerilen)' },
                { s: 3.0, title: 'Baskı (3x)', desc: '~300 DPI Ultra HD' },
              ].map((res) => (
                <button
                  key={res.s}
                  type="button"
                  onClick={() => setScale(res.s)}
                  className={cn(
                    'p-2.5 rounded-xl border text-center transition-all',
                    scale === res.s
                      ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold'
                      : isDark
                      ? 'border-slate-800 hover:border-slate-700 bg-slate-800/20 text-slate-300'
                      : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                  )}
                >
                  <div className="text-xs font-bold">{res.title}</div>
                  <div className="text-[10px] opacity-70">{res.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Scope Selector */}
          <div>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 block mb-2">
              Dışa Aktarılacak Sayfalar:
            </label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'all'}
                  onChange={() => setScope('all')}
                  className="text-emerald-500 focus:ring-emerald-500"
                />
                <span>Tüm Sayfalar ({totalPages} Sayfa — ZIP arşivi olarak)</span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'active'}
                  onChange={() => setScope('active')}
                  className="text-emerald-500 focus:ring-emerald-500"
                />
                <span>Yalnızca Aktif Sayfa (Sayfa {activePageIndex + 1})</span>
              </label>

              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input
                  type="radio"
                  name="scope"
                  checked={scope === 'custom'}
                  onChange={() => setScope('custom')}
                  className="text-emerald-500 focus:ring-emerald-500"
                />
                <span>Özel Sayfa Aralığı (ZIP):</span>
              </label>

              {scope === 'custom' && (
                <div className="ml-6 space-y-1">
                  <input
                    type="text"
                    value={customRange}
                    onChange={(e) => setCustomRange(e.target.value)}
                    placeholder={`Örn: 1-3, 5 (1–${totalPages})`}
                    className={cn(
                      'w-full text-xs px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono',
                      isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
                    )}
                  />
                  {!rangeValidation.isValid && rangeValidation.error ? (
                    <p className="text-[11px] text-rose-500">{rangeValidation.error}</p>
                  ) : (
                    <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold">
                      {rangeValidation.pages.length} sayfa dışa aktarılacak
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {isProcessing && (
            <div className="flex flex-col items-center justify-center py-4 gap-2">
              <Loader2 className="w-7 h-7 text-emerald-500 animate-spin" />
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Görseller oluşturuluyor... ({progress?.current || 0} / {progress?.total || 0})
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={cn(
            'flex items-center justify-end gap-2 px-6 py-4 border-t',
            isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/50'
          )}
        >
          <button
            type="button"
            onClick={handleCancelExport}
            className="px-4 py-2 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
          >
            {isProcessing ? 'İşlemi İptal Et' : 'Vazgeç'}
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={!canSubmit}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
          >
            {scope !== 'active' ? (
              <FileArchive className="w-3.5 h-3.5" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            <span>{scope !== 'active' ? 'ZIP Olarak Kaydet' : 'Görseli Kaydet'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
