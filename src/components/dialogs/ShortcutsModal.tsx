import React from 'react';
import { useUIStore } from '@/store/ui-store';
import { X, Keyboard } from 'lucide-react';

const SHORTCUTS = [
  { key: 'V', desc: 'Seç / Taşı / Metin Seçim Aracı' },
  { key: 'T', desc: 'Metin Ekleme Aracı' },
  { key: 'P', desc: 'Serbest Çizim Kalemi' },
  { key: 'H', desc: 'Fosforlu Vurgulama Kalemi' },
  { key: 'Ctrl + S', desc: 'Değişiklikleri PDF Olarak Kaydet' },
  { key: 'Ctrl + P', desc: 'Vektör Kalitesinde Yazdır (Print)' },
  { key: 'Ctrl + O', desc: 'Yeni PDF Dosyası Aç' },
  { key: 'Ctrl + F', desc: 'Döküman İçinde Metin Ara' },
  { key: 'Ctrl + R', desc: 'Hassas Cetvelleri Aç / Kapat' },
  { key: 'Ctrl + Z', desc: 'Son İşlemi Geri Al (Undo)' },
  { key: 'Ctrl + Y', desc: 'Son İşlemi Yinele (Redo)' },
  { key: 'Ctrl + A', desc: 'Tüm Sayfaları Seç' },
  { key: 'Ctrl + +', desc: 'Sayfayı Yakınlaştır' },
  { key: 'Ctrl + -', desc: 'Sayfayı Uzaklaştır' },
  { key: 'Delete', desc: 'Seçili İmza / Metin Kutusunu Sil' },
  { key: 'PageUp / Sol Ok', desc: 'Önceki Sayfaya Git' },
  { key: 'PageDown / Sağ Ok', desc: 'Sonraki Sayfaya Git' },
  { key: 'Home / End', desc: 'İlk / Son Sayfaya Git' },
  { key: 'Esc', desc: 'Açık Modalı / Arama Penceresini Kapat' },
];

export const ShortcutsModal: React.FC = () => {
  const { isShortcutsModalOpen, setShortcutsModalOpen } = useUIStore();

  if (!isShortcutsModalOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Keyboard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Klavye Kısayolları</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Hızlı düzenleme ve gezinme tuşları</p>
            </div>
          </div>
          <button
            onClick={() => setShortcutsModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-2">
          {SHORTCUTS.map((s, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-xs"
            >
              <span className="text-slate-700 dark:text-slate-300 font-medium">{s.desc}</span>
              <kbd className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-[11px] font-bold text-sky-600 dark:text-sky-400 font-mono shadow-sm">
                {s.key}
              </kbd>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex justify-end">
          <button
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
