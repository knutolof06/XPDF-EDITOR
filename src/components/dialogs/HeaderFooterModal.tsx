import React, { useEffect, useState } from 'react';
import { useAnnotationStore } from '@/store/annotation-store';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { HeaderFooterConfig } from '@/types/annotations';
import { X, PanelTop, CheckCircle2, Trash2, Sparkles } from 'lucide-react';
import { cn } from '@/utils/cn';
import { markCurrentDocumentModified, useModalEscape } from './modal-utils';

type SlotField =
  | 'headerLeft'
  | 'headerCenter'
  | 'headerRight'
  | 'footerLeft'
  | 'footerCenter'
  | 'footerRight';

const COLOR_PRESETS = ['#64748b', '#0f172a', '#0284c7', '#1e40af', '#dc2626'];

function resolvePreviewTokens(template: string | undefined, pageNum: number, totalPages: number): string {
  if (!template) return '';
  const today = new Date().toLocaleDateString('tr-TR');
  return template
    .replace(/\{page\}/g, String(pageNum))
    .replace(/\{pages\}/g, String(totalPages))
    .replace(/\{date\}/g, today);
}

export const HeaderFooterModal: React.FC = () => {
  const { isHeaderFooterModalOpen, setHeaderFooterModalOpen, addToast } = useUIStore();
  const { headerFooterConfig, setHeaderFooterConfig } = useAnnotationStore();
  const currentDocument = useDocumentStore((s) => s.currentDocument);

  const totalPages = currentDocument?.totalPages || 1;

  const [enabled, setEnabled] = useState(true);
  const [headerLeft, setHeaderLeft] = useState('');
  const [headerCenter, setHeaderCenter] = useState('');
  const [headerRight, setHeaderRight] = useState('');
  const [footerLeft, setFooterLeft] = useState('');
  const [footerCenter, setFooterCenter] = useState('');
  const [footerRight, setFooterRight] = useState('');
  const [fontSize, setFontSize] = useState(9);
  const [color, setColor] = useState('#64748b');
  const [marginX, setMarginX] = useState(32);
  const [marginY, setMarginY] = useState(24);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(totalPages);
  const [activeField, setActiveField] = useState<SlotField>('headerCenter');

  useEffect(() => {
    if (!isHeaderFooterModalOpen) return;
    const hasConfiguredContent = Boolean(
      headerFooterConfig.headerLeft ||
        headerFooterConfig.headerCenter ||
        headerFooterConfig.headerRight ||
        headerFooterConfig.footerLeft ||
        headerFooterConfig.footerCenter ||
        headerFooterConfig.footerRight ||
        headerFooterConfig.headerText ||
        headerFooterConfig.footerText
    );
    setEnabled(hasConfiguredContent ? Boolean(headerFooterConfig.enabled) : true);
    setHeaderLeft(headerFooterConfig.headerLeft || '');
    setHeaderCenter(headerFooterConfig.headerCenter || headerFooterConfig.headerText || '');
    setHeaderRight(headerFooterConfig.headerRight || '');
    setFooterLeft(headerFooterConfig.footerLeft || '');
    setFooterCenter(headerFooterConfig.footerCenter || headerFooterConfig.footerText || '');
    setFooterRight(headerFooterConfig.footerRight || '');
    setFontSize(headerFooterConfig.fontSize || 9);
    setColor(headerFooterConfig.color || '#64748b');
    setMarginX(headerFooterConfig.marginX ?? 32);
    setMarginY(headerFooterConfig.marginY ?? 24);
    setStartPage(Math.max(1, Math.min(totalPages, headerFooterConfig.startPage ?? 1)));
    setEndPage(Math.max(1, Math.min(totalPages, headerFooterConfig.endPage ?? totalPages)));
  }, [isHeaderFooterModalOpen, headerFooterConfig, totalPages]);

  useModalEscape(isHeaderFooterModalOpen, () => setHeaderFooterModalOpen(false));

  if (!isHeaderFooterModalOpen) return null;

  const insertPlaceholder = (token: string) => {
    const setters: Record<SlotField, React.Dispatch<React.SetStateAction<string>>> = {
      headerLeft: setHeaderLeft,
      headerCenter: setHeaderCenter,
      headerRight: setHeaderRight,
      footerLeft: setFooterLeft,
      footerCenter: setFooterCenter,
      footerRight: setFooterRight,
    };
    setters[activeField]((prev) => (prev ? `${prev} ${token}` : token));
  };

  const hasAnyContent = Boolean(
    headerLeft.trim() ||
      headerCenter.trim() ||
      headerRight.trim() ||
      footerLeft.trim() ||
      footerCenter.trim() ||
      footerRight.trim()
  );

  const handleApply = () => {
    const safeStart = Math.max(1, Math.min(totalPages, startPage || 1));
    const safeEnd = Math.max(safeStart, Math.min(totalPages, endPage || totalPages));

    const nextConfig: Partial<HeaderFooterConfig> = {
      enabled: enabled && hasAnyContent,
      headerLeft: headerLeft.trim() || undefined,
      headerCenter: headerCenter.trim() || undefined,
      headerRight: headerRight.trim() || undefined,
      footerLeft: footerLeft.trim() || undefined,
      footerCenter: footerCenter.trim() || undefined,
      footerRight: footerRight.trim() || undefined,
      headerText: headerCenter.trim() || undefined,
      footerText: footerCenter.trim() || undefined,
      fontSize: Math.max(6, Math.min(24, fontSize || 9)),
      color: color || '#64748b',
      marginX: Math.max(8, Math.min(120, marginX)),
      marginY: Math.max(8, Math.min(120, marginY)),
      startPage: safeStart,
      endPage: safeEnd,
    };

    setHeaderFooterConfig(nextConfig);
    markCurrentDocumentModified();

    addToast(
      nextConfig.enabled
        ? 'Üst ve alt bilgi ayarları uygulandı (Dışa aktarma/kaydetme sırasında basılacaktır).'
        : 'Üst ve alt bilgi devre dışı bırakıldı.',
      'success'
    );
    setHeaderFooterModalOpen(false);
  };

  const handleResetAndDisable = () => {
    setHeaderFooterConfig({
      enabled: false,
      headerLeft: undefined,
      headerCenter: undefined,
      headerRight: undefined,
      footerLeft: undefined,
      footerCenter: undefined,
      footerRight: undefined,
      headerText: undefined,
      footerText: undefined,
    });
    markCurrentDocumentModified();
    addToast('Üst ve alt bilgi kaldırıldı.', 'info');
    setHeaderFooterModalOpen(false);
  };

  const previewPage = Math.max(1, Math.min(totalPages, startPage || 1));

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setHeaderFooterModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <PanelTop className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Üst Bilgi & Alt Bilgi (Header / Footer)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sayfaların üst ve alt bölümlerine dinamik tarih, başlık ve sayfa numarası yerleştirin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setHeaderFooterModalOpen(false)}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Enable Switch & Placeholders */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
            <label className="flex items-center gap-2.5 cursor-pointer select-none font-semibold text-slate-800 dark:text-slate-100">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 rounded accent-sky-500"
              />
              <span>Üst / Alt Bilgiyi Etkinleştir</span>
            </label>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-sky-500" />
                Değişken Ekle:
              </span>
              {[
                { token: '{page}', label: 'Sayfa No' },
                { token: '{pages}', label: 'Toplam Sayfa' },
                { token: '{date}', label: 'Tarih' },
              ].map((item) => (
                <button
                  key={item.token}
                  type="button"
                  onClick={() => insertPlaceholder(item.token)}
                  className="px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-sky-500 text-[11px] font-mono font-semibold text-sky-600 dark:text-sky-400 transition-colors"
                  title={`${item.label} ekle`}
                >
                  {item.token}
                </button>
              ))}
            </div>
          </div>

          {/* Header 3-Column Inputs */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2">
              Üst Bilgi Alanları (Header)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <span className="block text-[10px] text-slate-400 mb-1">Sol Üst</span>
                <input
                  type="text"
                  value={headerLeft}
                  onFocus={() => setActiveField('headerLeft')}
                  onChange={(e) => setHeaderLeft(e.target.value)}
                  placeholder="Örn: Şirket Adı"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-400 mb-1">Orta Üst</span>
                <input
                  type="text"
                  value={headerCenter}
                  onFocus={() => setActiveField('headerCenter')}
                  onChange={(e) => setHeaderCenter(e.target.value)}
                  placeholder="Örn: Yıllık Rapor"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-400 mb-1">Sağ Üst</span>
                <input
                  type="text"
                  value={headerRight}
                  onFocus={() => setActiveField('headerRight')}
                  onChange={(e) => setHeaderRight(e.target.value)}
                  placeholder="Örn: {date}"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Footer 3-Column Inputs */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-2">
              Alt Bilgi Alanları (Footer)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <span className="block text-[10px] text-slate-400 mb-1">Sol Alt</span>
                <input
                  type="text"
                  value={footerLeft}
                  onFocus={() => setActiveField('footerLeft')}
                  onChange={(e) => setFooterLeft(e.target.value)}
                  placeholder="Örn: Gizli Belge"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-400 mb-1">Orta Alt</span>
                <input
                  type="text"
                  value={footerCenter}
                  onFocus={() => setActiveField('footerCenter')}
                  onChange={(e) => setFooterCenter(e.target.value)}
                  placeholder="Örn: Sayfa {page} / {pages}"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <span className="block text-[10px] text-slate-400 mb-1">Sağ Alt</span>
                <input
                  type="text"
                  value={footerRight}
                  onFocus={() => setActiveField('footerRight')}
                  onChange={(e) => setFooterRight(e.target.value)}
                  placeholder="Örn: Tüm Hakları Saklıdır"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>
          </div>

          {/* Style, Margins & Page Range */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Yazı Boyutu (pt)
              </label>
              <input
                type="number"
                min={6}
                max={24}
                value={fontSize}
                onChange={(e) => setFontSize(Math.max(6, Math.min(24, Number(e.target.value) || 9)))}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-center font-semibold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Yatay Kenar (pt)
              </label>
              <input
                type="number"
                min={8}
                max={120}
                value={marginX}
                onChange={(e) => setMarginX(Math.max(8, Math.min(120, Number(e.target.value) || 0)))}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-center font-semibold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Dikey Kenar (pt)
              </label>
              <input
                type="number"
                min={8}
                max={120}
                value={marginY}
                onChange={(e) => setMarginY(Math.max(8, Math.min(120, Number(e.target.value) || 0)))}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-center font-semibold"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Renk
              </label>
              <div className="flex items-center gap-1.5 pt-1">
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
                  className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent p-0"
                  title="Özel renk seç"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Başlangıç Sayfası (1–{totalPages})
              </label>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={startPage}
                onChange={(e) => {
                  const val = Math.max(1, Math.min(totalPages, Number(e.target.value) || 1));
                  setStartPage(val);
                  if (endPage < val) setEndPage(val);
                }}
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-semibold"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Bitiş Sayfası ({startPage}–{totalPages})
              </label>
              <input
                type="number"
                min={startPage}
                max={totalPages}
                value={endPage}
                onChange={(e) =>
                  setEndPage(Math.max(startPage, Math.min(totalPages, Number(e.target.value) || totalPages)))
                }
                className="w-full px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-semibold"
              />
            </div>
          </div>

          {/* Live Mini-Preview */}
          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">
              Canlı Sayfa Önizlemesi (Sayfa {previewPage} / {totalPages})
            </label>
            <div className="mx-auto w-full max-w-md h-44 bg-white rounded-xl border border-slate-300 shadow-inner flex flex-col justify-between p-3 text-slate-800 relative overflow-hidden">
              <div
                className="grid grid-cols-3 gap-2 items-center border-b border-dashed border-slate-200 pb-1.5"
                style={{
                  color,
                  fontSize: `${Math.max(8, Math.min(14, fontSize))}px`,
                  paddingLeft: `${Math.round(marginX / 6)}px`,
                  paddingRight: `${Math.round(marginX / 6)}px`,
                }}
              >
                <span className="truncate text-left">
                  {enabled ? resolvePreviewTokens(headerLeft, previewPage, totalPages) : ''}
                </span>
                <span className="truncate text-center font-medium">
                  {enabled ? resolvePreviewTokens(headerCenter, previewPage, totalPages) : ''}
                </span>
                <span className="truncate text-right">
                  {enabled ? resolvePreviewTokens(headerRight, previewPage, totalPages) : ''}
                </span>
              </div>

              <div className="flex-1 flex flex-col items-center justify-center gap-1.5 opacity-20 px-10">
                <div className="w-full h-2 bg-slate-400 rounded" />
                <div className="w-4/5 h-2 bg-slate-400 rounded" />
                <div className="w-full h-2 bg-slate-400 rounded" />
                <div className="w-3/4 h-2 bg-slate-400 rounded" />
              </div>

              <div
                className="grid grid-cols-3 gap-2 items-center border-t border-dashed border-slate-200 pt-1.5"
                style={{
                  color,
                  fontSize: `${Math.max(8, Math.min(14, fontSize))}px`,
                  paddingLeft: `${Math.round(marginX / 6)}px`,
                  paddingRight: `${Math.round(marginX / 6)}px`,
                }}
              >
                <span className="truncate text-left">
                  {enabled ? resolvePreviewTokens(footerLeft, previewPage, totalPages) : ''}
                </span>
                <span className="truncate text-center font-medium">
                  {enabled ? resolvePreviewTokens(footerCenter, previewPage, totalPages) : ''}
                </span>
                <span className="truncate text-right">
                  {enabled ? resolvePreviewTokens(footerRight, previewPage, totalPages) : ''}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleResetAndDisable}
            className="px-3.5 py-2 rounded-xl text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Kaldır / Sıfırla</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setHeaderFooterModalOpen(false)}
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
              <span>Uygula</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
