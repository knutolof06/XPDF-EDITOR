import React, { useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PageLayoutEngine, SynthesisOptions } from '@/core/engine/page-layout-engine';
import {
  X,
  Grid2X2,
  Columns,
  Layers,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const PageLayoutSynthesisModal: React.FC = () => {
  const { currentDocument, setDocument } = useDocumentStore();
  const { isPageLayoutModalOpen, setPageLayoutModalOpen, addToast } = useUIStore();

  const [layout, setLayout] = useState<SynthesisOptions['layout']>('4-up');
  const [pageSize, setPageSize] = useState<SynthesisOptions['pageSize']>('A4');
  const [orientation, setOrientation] = useState<SynthesisOptions['orientation']>('portrait');
  const [margin, setMargin] = useState(20);
  const [spacing, setSpacing] = useState(15);
  const [drawBorder, setDrawBorder] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isPageLayoutModalOpen || !currentDocument) return null;

  const selectedPages = currentDocument.pages.filter((p) =>
    currentDocument.selectedPageIds.includes(p.id)
  );

  const pagesToUse = selectedPages.length > 0 ? selectedPages : currentDocument.pages.slice(0, 4);

  const handleSynthesize = async () => {
    try {
      setIsProcessing(true);
      addToast('Sayfalar tek bir sayfada birleştiriliyor...', 'info');

      const slots = pagesToUse.map((p) => ({
        sourceDocId: p.sourceDocId,
        sourcePageIndex: p.sourcePageIndex,
        rotation: p.rotation,
      }));

      const result = await PageLayoutEngine.synthesizeSinglePage(
        slots,
        {
          layout,
          pageSize,
          orientation,
          margin,
          spacing,
          drawBorder,
        },
        currentDocument.name
      );

      setDocument(result.model, result.pdfDoc);
      addToast(`Başarılı! ${slots.length} sayfa tek bir ${pageSize} sayfada birleştirildi.`, 'success');
      setPageLayoutModalOpen(false);
    } catch (err: any) {
      console.error(err);
      addToast(err?.message || 'Birleştirme sırasında hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Grid2X2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Sayfaları Birleştirip Yeni Sayfa Oluştur</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seçili {pagesToUse.length} sayfayı tek bir A4/A3 sayfada N-up ızgara olarak birleştirin
              </p>
            </div>
          </div>
          <button
            onClick={() => setPageLayoutModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          {/* Layout Presets */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
              Sayfa Dizilim Düzeni (N-up Layout)
            </label>
            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={() => setLayout('2-up')}
                className={cn(
                  'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                  layout === '2-up'
                    ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                )}
              >
                <Columns className="w-4 h-4" />
                <span className="text-xs">2'li Sayfa</span>
              </button>

              <button
                onClick={() => setLayout('4-up')}
                className={cn(
                  'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                  layout === '4-up'
                    ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                )}
              >
                <Grid2X2 className="w-4 h-4" />
                <span className="text-xs">4'lü Grid</span>
              </button>

              <button
                onClick={() => setLayout('6-up')}
                className={cn(
                  'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                  layout === '6-up'
                    ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                )}
              >
                <Layers className="w-4 h-4" />
                <span className="text-xs">6'lı Grid</span>
              </button>

              <button
                onClick={() => setLayout('8-up')}
                className={cn(
                  'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                  layout === '8-up'
                    ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                )}
              >
                <Sparkles className="w-4 h-4" />
                <span className="text-xs">8'li Grid</span>
              </button>
            </div>
          </div>

          {/* Orientation & Page Size */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Kağıt Boyutu</label>
              <select
                value={pageSize}
                onChange={(e) => setPageSize(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="A4">A4 (Standart)</option>
                <option value="A3">A3 (Büyük Boy)</option>
                <option value="Letter">US Letter</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Yönlendirme</label>
              <select
                value={orientation}
                onChange={(e) => setOrientation(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="portrait">Dikey (Portrait)</option>
                <option value="landscape">Yatay (Landscape)</option>
              </select>
            </div>
          </div>

          {/* Margins & Border */}
          <div className="grid grid-cols-2 gap-4 pt-1">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Kenar Boşluğu: {margin} pt
              </label>
              <input
                type="range"
                min="0"
                max="50"
                value={margin}
                onChange={(e) => setMargin(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Sayfalar Arası Boşluk: {spacing} pt
              </label>
              <input
                type="range"
                min="0"
                max="40"
                value={spacing}
                onChange={(e) => setSpacing(parseInt(e.target.value, 10))}
                className="w-full accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={drawBorder}
              onChange={(e) => setDrawBorder(e.target.checked)}
              className="accent-sky-500 rounded"
            />
            <span>Sayfaların etrafına ince sınır çizgisi çiz</span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={() => setPageLayoutModalOpen(false)}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSynthesize}
            disabled={isProcessing}
            className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-purple-600/20"
          >
            <Sparkles className="w-4 h-4" />
            {isProcessing ? 'Oluşturuluyor...' : 'Yeni Sayfada Birleştir'}
          </button>
        </div>
      </div>
    </div>
  );
};
