import React, { useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { WatermarkEngine, WatermarkConfig } from '@/core/engine/watermark-engine';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { X, Stamp, Sparkles, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';

const PRESETS = ['GİZLİDİR', 'TASLAK', 'ÖZEL', 'KOPYALANAMAZ', 'ONAYLANDI'];
const WATERMARK_COLORS = [
  '#64748b', // Slate Gray
  '#ef4444', // Red
  '#0284c7', // Sky Blue
  '#f59e0b', // Amber
  '#10b981', // Emerald
  '#0f172a', // Black
];

export const WatermarkModal: React.FC = () => {
  const { isWatermarkModalOpen, setWatermarkModalOpen, addToast } = useUIStore();
  const { currentDocument, setDocument } = useDocumentStore();
  const theme = useViewerStore((s) => s.theme);

  const [text, setText] = useState('GİZLİDİR');
  const [fontSize, setFontSize] = useState(54);
  const [color, setColor] = useState('#64748b');
  const [opacity, setOpacity] = useState(0.20);
  const [rotation, setRotation] = useState(45);
  const [layout, setLayout] = useState<'center' | 'tiled'>('center');
  const [pages, setPages] = useState<'all' | 'first' | 'custom'>('all');
  const [customPages, setCustomPages] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isWatermarkModalOpen || !currentDocument) return null;

  const isDark = theme === 'dark';

  const handleApply = async () => {
    if (!text.trim()) {
      addToast('Lütfen filigran metni girin.', 'warning');
      return;
    }

    try {
      setIsProcessing(true);
      const config: WatermarkConfig = {
        text: text.trim(),
        fontSize,
        color,
        opacity,
        rotation,
        layout,
        pages,
        customPages: pages === 'custom' ? customPages : undefined,
      };

      const updatedBuffer = await WatermarkEngine.applyWatermark(currentDocument.id, config);
      const loaded = await PdfLoader.loadDocument(currentDocument.name, updatedBuffer);

      setDocument(
        {
          ...loaded.model,
          isModified: true,
          filePath: currentDocument.filePath,
        },
        loaded.pdfDoc
      );

      setWatermarkModalOpen(false);
      addToast('Filigran dökümana başarıyla uygulandı!', 'success');
    } catch (err: any) {
      console.error('Watermark apply error:', err);
      addToast('Filigran eklenirken hata oluştu: ' + (err?.message || ''), 'error');
    } finally {
      setIsProcessing(false);
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
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center">
              <Stamp className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Filigran (Watermark) Ekle</h2>
              <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>
                Döküman sayfalarına güvenlik veya durum filigranı ekleyin
              </p>
            </div>
          </div>
          <button
            onClick={() => !isProcessing && setWatermarkModalOpen(false)}
            disabled={isProcessing}
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 flex flex-col gap-4 max-h-[75vh] overflow-y-auto">
          {/* Preset Buttons */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">
              Hazır Şablonlar:
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setText(p)}
                  className={cn(
                    'text-[11px] px-2.5 py-1 rounded-lg border font-semibold transition-all',
                    text === p
                      ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                      : isDark
                      ? 'border-slate-800 hover:border-slate-700 bg-slate-800/40 text-slate-300'
                      : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Custom Text Input */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
              Filigran Metni:
            </label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Örn: GİZLİDİR veya Şirket Adı"
              className={cn(
                'w-full text-xs font-bold px-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500',
                isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
              )}
            />
          </div>

          {/* Sliders: Size & Opacity */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex justify-between text-[11px] font-semibold mb-1 text-slate-500 dark:text-slate-400">
                <span>Yazı Boyutu:</span>
                <span className="font-mono">{fontSize} pt</span>
              </div>
              <input
                type="range"
                min={24}
                max={96}
                step={2}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-[11px] font-semibold mb-1 text-slate-500 dark:text-slate-400">
                <span>Opaklık (Saydamlık):</span>
                <span className="font-mono">%{Math.round(opacity * 100)}</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={0.80}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full accent-sky-500 cursor-pointer"
              />
            </div>
          </div>

          {/* Layout & Angle */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                Yerleşim:
              </label>
              <select
                value={layout}
                onChange={(e) => setLayout(e.target.value as any)}
                className={cn(
                  'w-full text-xs p-2 rounded-xl border font-medium focus:outline-none focus:ring-2 focus:ring-sky-500',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                )}
              >
                <option value="center">Merkezde Tek Filigran</option>
                <option value="tiled">Döşeli Izgara (Tüm Sayfayı Kapla)</option>
              </select>
            </div>

            <div>
              <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1">
                Açı:
              </label>
              <select
                value={rotation}
                onChange={(e) => setRotation(Number(e.target.value))}
                className={cn(
                  'w-full text-xs p-2 rounded-xl border font-medium focus:outline-none focus:ring-2 focus:ring-sky-500',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-800'
                )}
              >
                <option value={45}>45° (Çapraz — Standart)</option>
                <option value={0}>0° (Yatay)</option>
                <option value={90}>90° (Dikey)</option>
                <option value={-45}>-45° (Ters Çapraz)</option>
              </select>
            </div>
          </div>

          {/* Color Palette */}
          <div>
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">
              Filigran Rengi:
            </label>
            <div className="flex items-center gap-2">
              {WATERMARK_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  style={{ backgroundColor: c }}
                  className={cn(
                    'w-6 h-6 rounded-full border transition-all',
                    color === c ? 'ring-2 ring-sky-500 ring-offset-2 scale-110' : 'border-slate-300 dark:border-slate-700'
                  )}
                />
              ))}
            </div>
          </div>

          {/* Target Pages */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 block mb-1.5">
              Hedef Sayfalar:
            </label>
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="wm_pages"
                  checked={pages === 'all'}
                  onChange={() => setPages('all')}
                  className="text-sky-500"
                />
                <span>Tüm Sayfalar</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="wm_pages"
                  checked={pages === 'first'}
                  onChange={() => setPages('first')}
                  className="text-sky-500"
                />
                <span>Yalnızca 1. Sayfa</span>
              </label>

              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="wm_pages"
                  checked={pages === 'custom'}
                  onChange={() => setPages('custom')}
                  className="text-sky-500"
                />
                <span>Özel Aralık</span>
              </label>
            </div>

            {pages === 'custom' && (
              <input
                type="text"
                value={customPages}
                onChange={(e) => setCustomPages(e.target.value)}
                placeholder="Örn: 1-3, 5"
                className={cn(
                  'w-full text-xs px-3 py-1.5 rounded-xl border mt-2 focus:outline-none focus:ring-2 focus:ring-sky-500',
                  isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'
                )}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className={cn(
            'flex items-center justify-end gap-2 px-6 py-4 border-t',
            isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/50'
          )}
        >
          <button
            onClick={() => setWatermarkModalOpen(false)}
            disabled={isProcessing}
            className="px-4 py-2 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
          >
            Vazgeç
          </button>

          <button
            onClick={handleApply}
            disabled={isProcessing || !text.trim()}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 transition-all disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            <span>Filigranı Uygula</span>
          </button>
        </div>
      </div>
    </div>
  );
};
