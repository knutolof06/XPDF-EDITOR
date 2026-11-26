import React from 'react';
import { useUIStore } from '@/store/ui-store';
import { X, Keyboard } from 'lucide-react';
import { useModalEscape } from './modal-utils';

const GENERAL_SHORTCUTS = [
  { key: 'V', desc: 'Seç / Taşı / Metin Seçim Aracı' },
  { key: 'T', desc: 'Metin Ekleme Aracı' },
  { key: 'P', desc: 'Serbest Çizim Kalemi' },
  { key: 'H', desc: 'El (Kaydırma) Aracı' },
  { key: 'Z', desc: 'Alan Yakınlaştırma (Marquee Zoom)' },
  { key: 'Ctrl + O', desc: 'Yeni PDF Dosyası Aç' },
  { key: 'Ctrl + S', desc: 'Değişiklikleri PDF Olarak Kaydet' },
  { key: 'Ctrl + Shift + S', desc: 'PDF Farklı Kaydet' },
  { key: 'Ctrl + P', desc: 'Vektör Kalitesinde Yazdır (Print)' },
  { key: 'Ctrl + F', desc: 'Döküman İçinde Metin Ara' },
  { key: 'Ctrl + H', desc: 'Döküman İçi Bul ve Değiştir / Karart' },
  { key: 'Ctrl + R', desc: 'Hassas Cetvelleri Aç / Kapat' },
  { key: 'Ctrl + Z', desc: 'Son İşlemi Geri Al' },
  { key: 'Ctrl + Y / Ctrl + Shift + Z', desc: 'Son İşlemi Yinele' },
  { key: 'Ctrl + + / -', desc: 'Yakınlaştır / Uzaklaştır' },
  { key: 'Ctrl + 0 / 1 / 2 / 3', desc: 'Sayfaya / %100 / Genişliğe / İçeriğe Sığdır' },
  { key: 'F11 / Ctrl + L', desc: 'Tam Ekran Sunum Modunu Aç / Kapat' },
  { key: 'Ctrl + ,', desc: 'Ayarlar Merkezini Aç' },
  { key: 'Delete', desc: 'Seçili İmza / Metin Kutusunu Sil' },
  { key: 'PageUp / Sol Ok', desc: 'Önceki Sayfaya Git' },
  { key: 'PageDown / Sağ Ok', desc: 'Sonraki Sayfaya Git' },
  { key: 'Home / End', desc: 'İlk / Son Sayfaya Git' },
  { key: 'Esc', desc: 'Açık Modalı, Tam Ekranı veya Aramayı Kapat' },
];

const PAGE_MANAGER_SHORTCUTS = [
  { key: 'Ctrl + A', desc: 'Tüm Sayfaları Seç' },
  { key: 'Delete / Backspace', desc: 'Seçili Sayfaları Sil' },
  { key: 'Ctrl + Z / Ctrl + Y', desc: 'Sayfa İşlemini Geri Al / Yinele' },
  { key: 'Esc', desc: 'Açık Menüyü veya Sayfa Yöneticisini Kapat' },
];

export const ShortcutsModal: React.FC = () => {
  const { isShortcutsModalOpen, setShortcutsModalOpen } = useUIStore();

  useModalEscape(isShortcutsModalOpen, () => setShortcutsModalOpen(false));

  if (!isShortcutsModalOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setShortcutsModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                Klavye Kısayolları
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Hızlı düzenleme, görünüm ve sayfa yöneticisi tuşları
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShortcutsModalOpen(false)}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-5">
          <div className="space-y-2">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Genel & Düzenleyici Kısayolları
            </h4>
            {GENERAL_SHORTCUTS.map((s, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs"
              >
                <span className="text-slate-700 dark:text-slate-300 font-medium">{s.desc}</span>
                <kbd className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-[11px] font-bold text-sky-600 dark:text-sky-400 font-mono shadow-sm shrink-0 ml-2">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>

          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Sayfa Yöneticisi Açıkken
            </h4>
            {PAGE_MANAGER_SHORTCUTS.map((s, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs"
              >
                <span className="text-slate-700 dark:text-slate-300 font-medium">{s.desc}</span>
                <kbd className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-[11px] font-bold text-sky-600 dark:text-sky-400 font-mono shadow-sm shrink-0 ml-2">
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
            type="button"
            onClick={() => setShortcutsModalOpen(false)}
            className="px-5 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
