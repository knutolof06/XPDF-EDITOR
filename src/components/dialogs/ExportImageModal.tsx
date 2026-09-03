import React, { useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { PdfImageExporter, ImageExportFormat } from '@/core/engine/pdf-image-exporter';
import { X, Image as ImageIcon, Download, Loader2, FileArchive } from 'lucide-react';
import { cn } from '@/utils/cn';

export const ExportImageModal: React.FC = () => {
  const { isExportImageModalOpen, setExportImageModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const theme = useViewerStore((s) => s.theme);

  const [format, setFormat] = useState<ImageExportFormat>('png');
  const [scale, setScale] = useState<number>(2.0); // 1 = 72 DPI, 2 = 150 DPI, 3 = 300 DPI
  const [scope, setScope] = useState<'all' | 'active' | 'custom'>('all');
  const [customRange, setCustomRange] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  if (!isExportImageModalOpen || !currentDocument || !pdfDocProxy) return null;

  const isDark = theme === 'dark';
  const totalPages = pdfDocProxy.numPages;
  const activePageIndex = currentDocument.activePageIndex || 0;

  const handleExport = async () => {
    try {
      setIsProcessing(true);
      const ext = format === 'jpeg' ? 'jpg' : format;

      if (scope === 'active') {
        const pageNum = activePageIndex + 1;
        setProgress({ current: 1, total: 1 });
        const { blob } = await PdfImageExporter.exportSinglePage(pdfDocProxy, pageNum, {
          format,
          scale,
        });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_sayfa_${pageNum}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        addToast(`Sayfa ${pageNum} başarıyla ${format.toUpperCase()} olarak indirildi.`, 'success');
      } else {
        // Multi-page export into ZIP
        let pageIndices: number[] | undefined;

        if (scope === 'custom' && customRange.trim()) {
          const pagesSet = new Set<number>();
          const parts = customRange.split(',');
          for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed.includes('-')) {
              const [start, end] = trimmed.split('-').map(Number);
              if (!isNaN(start) && !isNaN(end)) {
                for (let k = Math.min(start, end); k <= Math.max(start, end); k++) {
                  if (k >= 1 && k <= totalPages) pagesSet.add(k);
                }
              }
            } else {
              const n = Number(trimmed);
              if (!isNaN(n) && n >= 1 && n <= totalPages) pagesSet.add(n);
            }
          }
          pageIndices = Array.from(pagesSet).sort((a, b) => a - b);
        }

        const count = pageIndices ? pageIndices.length : totalPages;
        setProgress({ current: 0, total: count });

        const zipBlob = await PdfImageExporter.exportPagesAsZip(
          pdfDocProxy,
          currentDocument.name,
          { format, scale },
          pageIndices,
          (cur, tot) => setProgress({ current: cur, total: tot })
        );

        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_gorseller_${ext.toUpperCase()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        addToast(`${count} sayfa ZIP arşivi olarak başarıyla indirildi.`, 'success');
      }

      setExportImageModalOpen(false);
    } catch (err: any) {
      console.error('Export image error:', err);
      addToast('Görsel dışa aktarılırken hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div
        className={cn(
          'w-full max-w-lg rounded-2xl shadow-2xl border flex flex-col overflow-hidden transition-all',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
        )}
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
              <h2 className="text-sm font-bold">PDF'i Görsele Dönüştür</h2>
              <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>
                Sayfaları PNG, JPG veya WebP formatında dışa aktarın
              </p>
            </div>
          </div>
          <button
            onClick={() => !isProcessing && setExportImageModalOpen(false)}
            disabled={isProcessing}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 transition-colors"
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
                <span>Özel Sayfa Aralığı:</span>
              </label>

              {scope === 'custom' && (
                <input
                  type="text"
                  value={customRange}
                  onChange={(e) => setCustomRange(e.target.value)}
                  placeholder="Örn: 1-3, 5, 8"
                  className={cn(
                    'text-xs px-3 py-2 rounded-xl border ml-6 focus:outline-none focus:ring-2 focus:ring-emerald-500',
                    isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-900'
                  )}
                />
              )}
            </div>
          </div>

          {/* Progress Indicator */}
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
            onClick={() => setExportImageModalOpen(false)}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
          >
            Vazgeç
          </button>

          <button
            onClick={handleExport}
            disabled={isProcessing}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all disabled:opacity-50"
          >
            {scope === 'all' ? <FileArchive className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />}
            <span>{scope === 'all' ? 'ZIP Olarak İndir' : 'Görseli İndir'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
