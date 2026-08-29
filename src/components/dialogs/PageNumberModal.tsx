import React, { useState } from 'react';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { PageNumberConfig } from '@/types/annotations';
import { X, Hash, CheckCircle2 } from 'lucide-react';
import { cn } from '@/utils/cn';

export const PageNumberModal: React.FC = () => {
  const { isPageNumberModalOpen, setPageNumberModalOpen, addToast } = useUIStore();
  const {
    pageNumberConfig,
    setPageNumberConfig,
    headerFooterConfig,
    setHeaderFooterConfig,
  } = useAnnotationStore();

  const [position, setPosition] = useState<PageNumberConfig['position']>(pageNumberConfig.position);
  const [format, setFormat] = useState<PageNumberConfig['format']>(pageNumberConfig.format);
  const [headerText, setHeaderText] = useState(headerFooterConfig.headerText || '');
  const [footerText, setFooterText] = useState(headerFooterConfig.footerText || '');

  if (!isPageNumberModalOpen) return null;

  const handleApply = () => {
    setPageNumberConfig({
      enabled: true,
      position,
      format,
      fontSize: 10,
      color: '#475569',
      startFrom: 1,
    });

    setHeaderFooterConfig({
      headerText: headerText.trim() || undefined,
      footerText: footerText.trim() || undefined,
      fontSize: 9,
      color: '#64748b',
    });

    addToast('Sayfa numaralandırma ve Header/Footer ayarları kaydedildi (Kaydetme sırasında basılacaktır).', 'success');
    setPageNumberModalOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Hash className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Sayfa Numaralandırma & Header/Footer</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Döküman sayfalarına otomatik numara ve başlık/altbilgi ekleyin</p>
            </div>
          </div>
          <button
            onClick={() => setPageNumberModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          {/* Position selector */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">Sayfa Numarası Konumu</label>
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
                  onClick={() => setPosition(pos.id as any)}
                  className={cn(
                    'p-2.5 rounded-xl border text-xs text-center transition-colors font-medium',
                    position === pos.id
                      ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300'
                      : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  )}
                >
                  {pos.label}
                </button>
              ))}
            </div>
          </div>

          {/* Number format */}
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Numara Formatı</label>
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as any)}
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
            >
              <option value="number-only">Yalnızca Sayı (Örn: 1, 2, 3)</option>
              <option value="page-x-of-y">Sayfa X / Y (Örn: Sayfa 1 / 15)</option>
            </select>
          </div>

          {/* Header text */}
          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Header (Üst Başlık Metni)</label>
              <input
                type="text"
                value={headerText}
                onChange={(e) => setHeaderText(e.target.value)}
                placeholder="Örn: 2026 Deneme Sınavı"
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1">Footer (Alt Bilgi Metni)</label>
              <input
                type="text"
                value={footerText}
                onChange={(e) => setFooterText(e.target.value)}
                placeholder="Örn: Gizli Döküman - Tüm Hakları Saklıdır"
                className="w-full px-3.5 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={() => setPageNumberModalOpen(false)}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleApply}
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
          >
            <CheckCircle2 className="w-4 h-4" />
            Kaydet & Uygula
          </button>
        </div>
      </div>
    </div>
  );
};
