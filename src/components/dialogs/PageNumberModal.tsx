import React, { useEffect, useState } from 'react';
import { useAnnotationStore } from '@/store/annotation-store';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PageNumberConfig } from '@/types/annotations';
import { X, Hash, CheckCircle2, Trash2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { markCurrentDocumentModified, useModalEscape } from './modal-utils';

const COLOR_PRESETS = ['#475569', '#0f172a', '#0284c7', '#1e40af', '#dc2626'];

export const PageNumberModal: React.FC = () => {
  const { isPageNumberModalOpen, setPageNumberModalOpen, addToast } = useUIStore();
  const { pageNumberConfig, setPageNumberConfig } = useAnnotationStore();
  const currentDocument = useDocumentStore((s) => s.currentDocument);

  const [enabled, setEnabled] = useState(true);
  const [position, setPosition] = useState<PageNumberConfig['position']>(pageNumberConfig.position);
  const [format, setFormat] = useState<PageNumberConfig['format']>(pageNumberConfig.format);
  const [prefix, setPrefix] = useState(pageNumberConfig.prefix || '');
  const [fontSize, setFontSize] = useState(pageNumberConfig.fontSize || 10);
  const [color, setColor] = useState(pageNumberConfig.color || '#475569');
  const [startFrom, setStartFrom] = useState(pageNumberConfig.startFrom || 1);

  useEffect(() => {
    if (!isPageNumberModalOpen) return;
    setEnabled(pageNumberConfig.enabled || true);
    setPosition(pageNumberConfig.position || 'bottom-center');
    setFormat(pageNumberConfig.format || 'page-x-of-y');
    setPrefix(pageNumberConfig.prefix || '');
    setFontSize(pageNumberConfig.fontSize || 10);
    setColor(pageNumberConfig.color || '#475569');
    setStartFrom(pageNumberConfig.startFrom || 1);
  }, [isPageNumberModalOpen, pageNumberConfig]);

  useModalEscape(isPageNumberModalOpen, () => setPageNumberModalOpen(false));

  if (!isPageNumberModalOpen) return null;

  const totalPages = currentDocument?.totalPages || 10;

  const formatPreviewText = () => {
    const num = Math.max(1, startFrom || 1);
    const total = Math.max(num, totalPages + num - 1);
    const pfx = prefix.trim();
    if (format === 'number-only') {
      return pfx ? `${pfx} ${num}` : `${num}`;
    }
    if (format === 'custom') {
      if (!pfx) return `${num} / ${total}`;
      if (pfx.includes('{page}') || pfx.includes('{pages}')) {
        return pfx.replace(/\{page\}/g, String(num)).replace(/\{pages\}/g, String(total));
      }
      return `${pfx} ${num}`;
    }
    return pfx ? `${pfx} Sayfa ${num} / ${total}` : `Sayfa ${num} / ${total}`;
  };

  const handleApply = () => {
    setPageNumberConfig({
      enabled,
      position,
      format,
      prefix: prefix.trim() || undefined,
      fontSize: Math.max(6, Math.min(32, fontSize || 10)),
      color: color || '#475569',
      startFrom: Math.max(1, startFrom || 1),
    });

    markCurrentDocumentModified();
    addToast(
      enabled
        ? 'Sayfa numaralandırma ayarları uygulandı (Kaydetme sırasında basılacaktır).'
        : 'Sayfa numaralandırma devre dışı bırakıldı.',
      'success'
    );
    setPageNumberModalOpen(false);
  };

  const handleDisable = () => {
    setPageNumberConfig({ enabled: false });
    markCurrentDocumentModified();
    addToast('Sayfa numaralandırma kapatıldı.', 'info');
    setPageNumberModalOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setPageNumberModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Hash className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Sayfa Numaralandırma</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Konum, biçim, başlangıç numarası ve yazı stilini özelleştirin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPageNumberModalOpen(false)}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto text-xs">
          {/* Enable Switch */}
          <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              Sayfa Numaralarını Göster / Bas
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 accent-sky-500 rounded"
            />
          </label>

          {/* Position selector */}
          <div>
            <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-2">
              Sayfa Numarası Konumu
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'top-left', label: 'Sol Üst' },
                { id: 'top-center', label: 'Orta Üst' },
                { id: 'top-right', label: 'Sağ Üst' },
                { id: 'bottom-left', label: 'Sol Alt' },
                { id: 'bottom-center', label: 'Orta Alt' },
                { id: 'bottom-right', label: 'Sağ Alt' },
              ].map((pos) => (
                <button
                  key={pos.id}
                  type="button"
                  onClick={() => setPosition(pos.id as PageNumberConfig['position'])}
                  className={cn(
                    'p-2.5 rounded-xl border text-xs text-center transition-colors font-medium',
                    position === pos.id
                      ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-bold'
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  )}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          {/* Number format & Prefix */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Numara Formatı
              </label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as PageNumberConfig['format'])}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              >
                <option value="number-only">Yalnızca Sayı (1, 2, 3)</option>
                <option value="page-x-of-y">Sayfa X / Y (Sayfa 1 / 15)</option>
                <option value="custom">Özel Şablon / Ön Ek</option>
              </select>
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                Ön Ek / Şablon {format === 'custom' ? '({page}, {pages})' : '(Opsiyonel)'}
              </label>
              <input
                type="text"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder={format === 'custom' ? 'Örn: Ek-{page}/{pages}' : 'Örn: Bölüm A -'}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {/* FontSize, StartFrom & Color */}
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Başlangıç No
              </label>
              <input
                type="number"
                min={1}
                value={startFrom}
                onChange={(e) => setStartFrom(Math.max(1, parseInt(e.target.value, 10) || 1))}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-center font-semibold"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Punto (pt)
              </label>
              <input
                type="number"
                min={6}
                max={32}
                value={fontSize}
                onChange={(e) =>
                  setFontSize(Math.max(6, Math.min(32, parseInt(e.target.value, 10) || 10)))
                }
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-center font-semibold"
              />
            </div>

            <div>
              <label className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                Yazı Rengi
              </label>
              <div className="flex items-center gap-1 pt-1.5">
                {COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{ backgroundColor: c }}
                    aria-label={`Renk ${c}`}
                    className={cn(
                      'w-5 h-5 rounded-full border transition-transform',
                      color === c ? 'ring-2 ring-sky-500 scale-110' : 'border-slate-300 dark:border-slate-700'
                    )}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent p-0"
                  title="Özel renk"
                />
              </div>
            </div>
          </div>

          {/* Live Preview */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Önizleme ({position}):
            </span>
            <span
              className="px-3 py-1 rounded-lg bg-white border border-slate-200 font-semibold shadow-2xs"
              style={{ color, fontSize: `${Math.max(10, Math.min(18, fontSize))}px` }}
            >
              {enabled ? formatPreviewText() : 'Devre dışı'}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleDisable}
            className="px-3.5 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Numarayı Kaldır</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPageNumberModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
            >
              İptal
            </button>
            <button
              type="button"
              onClick={handleApply}
              className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
            >
              <CheckCircle2 className="w-4 h-4" />
              Kaydet & Uygula
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
