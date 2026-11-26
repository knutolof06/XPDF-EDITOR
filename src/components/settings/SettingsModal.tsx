import React, { useEffect, useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { AppDesignTheme, AccentColor } from '@/types/viewer';
import { PageTransitionType, ViewMode } from '@/types/document';
import { pageBitmapCache, thumbnailCache, pageMetadataCache } from '@/core/cache/render-cache';
import { cancelActivePreload } from '@/core/cache/page-preloader';
import {
  X,
  Palette,
  Monitor,
  Sliders,
  Keyboard,
  Info,
  Check,
  Sparkles,
  Sun,
  Moon,
  Trash2,
  ExternalLink,
  Laptop,
  Layers,
  LayoutTemplate,
  Terminal,
  RefreshCw,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { useModalEscape } from '@/components/dialogs/modal-utils';

type SettingsTab = 'appearance' | 'viewer' | 'behavior' | 'about';

interface DesignCard {
  id: AppDesignTheme;
  title: string;
  subtitle: string;
  badge: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
}

const DESIGN_CARDS: DesignCard[] = [
  {
    id: 'fluent',
    title: 'Fluent Studio',
    subtitle: 'Windows 11 & Modern Acrobat Pro',
    badge: 'Varsayılan',
    description: 'Yumuşak akrilik köşeler, modern çift araç çubuğu ve dengeli çalışma alanı.',
    icon: LayoutTemplate,
    accentColor: '#0284c7',
  },
  {
    id: 'cupertino',
    title: 'Cupertino Glass',
    subtitle: 'macOS Sonoma & Apple Preview',
    badge: 'Ultra Şık',
    description: 'Yüksek buzlu cam efekti (frosted glass), yüzen hap (pill) kontroller ve dikkatsiz okuma ferahlığı.',
    icon: Sparkles,
    accentColor: '#0071e3',
  },
  {
    id: 'linear',
    title: 'Linear Pro',
    subtitle: 'Raycast & Developer Dark Geek',
    badge: 'Klavye Odaklı',
    description: 'Koyu obsidiyen taban, 1px hassas kenarlıklar, buton içi kısayol rozetleri ve %15 daha geniş belge alanı.',
    icon: Terminal,
    accentColor: '#06b6d4',
  },
  {
    id: 'ribbon',
    title: 'Classic Ribbon',
    subtitle: 'Microsoft 365 & PDF-XChange Suite',
    badge: 'Kurumsal',
    description: 'Sekmeli zengin şerit menü (Giriş, Düzenle, Açıklama, Sayfalar). Tüm özellikler simge ve başlıklarıyla tek tık mesafesinde.',
    icon: Layers,
    accentColor: '#0f6cbd',
  },
];

const ACCENT_COLORS: { id: AccentColor; label: string; color: string }[] = [
  { id: 'sky', label: 'Gök Mavisi', color: '#0284c7' },
  { id: 'indigo', label: 'İndigo Mor', color: '#6366f1' },
  { id: 'emerald', label: 'Zümrüt Yeşil', color: '#10b981' },
  { id: 'amber', label: 'Kehribar', color: '#f59e0b' },
  { id: 'rose', label: 'Gül Pembesi', color: '#f43f5e' },
];

interface PersistedExtraSettings {
  pageTransition?: PageTransitionType;
  confirmOnClose?: boolean;
  autoCheckUpdates?: boolean;
  viewMode?: ViewMode;
  zoom?: number;
}

const SETTINGS_STORAGE_KEY = 'xpdf_settings';

function readPersistedSettings(): PersistedExtraSettings {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as PersistedExtraSettings;
  } catch {
    // ignore storage errors
  }
  return {};
}

function writePersistedSettings(patch: PersistedExtraSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = readPersistedSettings();
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...existing, ...patch }));
  } catch {
    // ignore storage errors
  }
}

export const SettingsModal: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('appearance');
  const [appVersion, setAppVersion] = useState('1.5.7');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<{
    type: 'idle' | 'available' | 'progress' | 'downloaded' | 'error' | 'up-to-date';
    version?: string;
    percent?: number;
    message?: string;
  }>({ type: 'idle' });

  const [confirmOnClose, setConfirmOnClose] = useState<boolean>(() => {
    const saved = readPersistedSettings();
    return saved.confirmOnClose !== undefined ? saved.confirmOnClose : true;
  });
  const [autoCheckUpdates, setAutoCheckUpdates] = useState<boolean>(() => {
    const saved = readPersistedSettings();
    return saved.autoCheckUpdates !== undefined ? saved.autoCheckUpdates : true;
  });

  const { isSettingsModalOpen, setSettingsModalOpen, addToast } = useUIStore();

  const {
    appDesignTheme,
    setAppDesignTheme,
    accentColor,
    setAccentColor,
    uiDensity,
    setUIDensity,
    theme,
    setTheme,
    fitMode,
    setFitMode,
    viewMode,
    setViewMode,
    zoom,
    setZoom,
    pageTransition,
    setPageTransition,
  } = useViewerStore();

  // Restore pageTransition persisted in localStorage on mount
  useEffect(() => {
    const saved = readPersistedSettings();
    if (saved.pageTransition && saved.pageTransition !== pageTransition) {
      setPageTransition(saved.pageTransition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Real package version + live updater-status IPC subscription
  useEffect(() => {
    const electron = window.electronAPI;
    if (!electron) return;

    if (electron.getAppVersion) {
      electron
        .getAppVersion()
        .then((v) => {
          if (v) setAppVersion(v);
        })
        .catch(() => {});
    }

    if (electron.onUpdaterStatus) {
      const cleanup = electron.onUpdaterStatus((status) => {
        setUpdaterStatus({
          type: status.type,
          version: status.version,
          percent: status.percent,
          message: status.message,
        });
        if (status.type !== 'available') {
          setIsCheckingUpdates(false);
        }
      });
      return cleanup;
    }
  }, []);

  useModalEscape(isSettingsModalOpen, () => setSettingsModalOpen(false));

  if (!isSettingsModalOpen) return null;

  const handlePageTransitionChange = (transition: PageTransitionType) => {
    setPageTransition(transition);
    writePersistedSettings({ pageTransition: transition });
  };

  const handleConfirmOnCloseChange = (checked: boolean) => {
    setConfirmOnClose(checked);
    writePersistedSettings({ confirmOnClose: checked });
  };

  const handleAutoCheckUpdatesChange = (checked: boolean) => {
    setAutoCheckUpdates(checked);
    writePersistedSettings({ autoCheckUpdates: checked });
  };

  const handleCheckUpdates = async () => {
    const electron = window.electronAPI;
    if (!electron?.checkForUpdates) {
      addToast('Otomatik güncelleme yalnızca kurulu Windows uygulamasında aktiftir.', 'info', 3500);
      return;
    }
    setIsCheckingUpdates(true);
    setUpdaterStatus({ type: 'idle' });

    try {
      const res = await electron.checkForUpdates();
      if (res?.status === 'dev-mode') {
        setIsCheckingUpdates(false);
        addToast('Geliştirici modunda güncelleme denetlenemez.', 'info', 3000);
      } else if (res?.status === 'unsupported') {
        setIsCheckingUpdates(false);
        addToast('Taşınabilir (Portable) sürümde otomatik güncelleme desteklenmez.', 'info', 3500);
      } else if (res?.status === 'error') {
        setIsCheckingUpdates(false);
        setUpdaterStatus({ type: 'error', message: res.message });
        addToast(`Güncelleme hatası: ${res.message}`, 'error', 4000);
      } else {
        setIsCheckingUpdates(false);
        if (res?.version && res.version !== appVersion) {
          addToast(`Yeni sürüm bulundu (v${res.version}), indiriliyor...`, 'info', 3500);
        } else {
          setUpdaterStatus({
            type: 'up-to-date',
            message: `XPDF Editor güncel (v${appVersion}).`,
          });
          addToast('Uygulamanız zaten en güncel sürümde.', 'success', 3000);
        }
      }
    } catch {
      setIsCheckingUpdates(false);
      addToast('Güncelleme denetlenemedi.', 'error');
    }
  };

  const handleInstallUpdateNow = async () => {
    try {
      await window.electronAPI?.installUpdateNow?.();
    } catch {
      addToast('Güncelleme başlatılamadı.', 'error');
    }
  };

  const handleClearCache = () => {
    try {
      cancelActivePreload();
      pageBitmapCache.clear();
      thumbnailCache.clear();
      pageMetadataCache.clear();
      addToast('Bellek ve görsel önbelleği başarıyla temizlendi.', 'success', 2000);
    } catch {
      addToast('Önbellek temizlenirken hata oluştu.', 'error');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setSettingsModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Ayarlar Merkezi</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Arayüz tasarımlarını, görünüm seçeneklerini ve davranışı yapılandırın
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSettingsModalOpen(false)}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body with Sidebar Tabs */}
        <div className="flex-1 flex overflow-hidden">
          <div className="w-52 border-r border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 p-3 space-y-1">
            {[
              { id: 'appearance', label: 'Arayüz & Tasarımlar', icon: Palette },
              { id: 'viewer', label: 'Görüntüleme & Motor', icon: Monitor },
              { id: 'behavior', label: 'Davranış & Tercihler', icon: Keyboard },
              { id: 'about', label: 'Hakkında & Güncelleme', icon: Info },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as SettingsTab)}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-xl flex items-center gap-2.5 text-xs font-semibold transition-all text-left',
                    isActive
                      ? 'bg-sky-500 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-white dark:bg-slate-900">
            {/* TAB: APPEARANCE */}
            {activeTab === 'appearance' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">
                    Arayüz Tasarım Sistemi (4 Farklı Tarz)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    Seçtiğiniz tasarım dökümanı kapatmadan anında canlı olarak uygulanır.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {DESIGN_CARDS.map((card) => {
                      const Icon = card.icon;
                      const isSelected = appDesignTheme === card.id;
                      return (
                        <div
                          key={card.id}
                          onClick={() => {
                            setAppDesignTheme(card.id);
                            addToast(`Tasarım uygulandı: ${card.title}`, 'info', 1200);
                          }}
                          className={cn(
                            'p-3.5 rounded-xl border-2 cursor-pointer transition-all flex flex-col justify-between relative group text-left',
                            isSelected
                              ? 'border-sky-500 bg-sky-500/5 shadow-md dark:border-sky-400'
                              : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40'
                          )}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div
                                  className="p-1.5 rounded-lg"
                                  style={{ backgroundColor: `${card.accentColor}20`, color: card.accentColor }}
                                >
                                  <Icon className="w-4 h-4" />
                                </div>
                                <span className="text-xs font-bold text-slate-900 dark:text-white">
                                  {card.title}
                                </span>
                              </div>
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md font-semibold bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                                {card.badge}
                              </span>
                            </div>
                            <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                              {card.subtitle}
                            </div>
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                              {card.description}
                            </p>
                          </div>

                          <div className="mt-3 pt-2 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between">
                            <span className="text-[10px] text-slate-400">
                              {isSelected ? 'Etkin Tasarım' : 'Seçmek için tıkla'}
                            </span>
                            {isSelected && (
                              <div className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center">
                                <Check className="w-3 h-3 stroke-[3]" />
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="h-px bg-slate-200 dark:bg-slate-800" />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-900 dark:text-white mb-2">
                      Genel Renk Teması
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'light', label: 'Açık', icon: Sun },
                        { id: 'dark', label: 'Koyu', icon: Moon },
                        { id: 'system', label: 'Sistem', icon: Laptop },
                      ].map((item) => {
                        const Icon = item.icon;
                        const isSelected = theme === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => setTheme(item.id as 'dark' | 'light' | 'system')}
                            className={cn(
                              'px-3 py-2 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold transition-colors',
                              isSelected
                                ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                            )}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            <span>{item.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-900 dark:text-white mb-2">
                      Vurgu Rengi (Accent)
                    </label>
                    <div className="flex items-center gap-2">
                      {ACCENT_COLORS.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setAccentColor(item.id)}
                          className={cn(
                            'w-7 h-7 rounded-full flex items-center justify-center transition-transform',
                            accentColor === item.id ? 'ring-2 ring-offset-2 ring-sky-500 scale-110' : 'hover:scale-105'
                          )}
                          style={{ backgroundColor: item.color }}
                          title={item.label}
                          aria-label={item.label}
                        >
                          {accentColor === item.id && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="h-px bg-slate-200 dark:bg-slate-800" />

                <div>
                  <label className="block text-xs font-bold text-slate-900 dark:text-white mb-2">
                    Arayüz Yoğunluğu (Density)
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setUIDensity('comfortable')}
                      className={cn(
                        'flex-1 p-2.5 rounded-xl border text-xs font-medium text-left transition-colors',
                        uiDensity === 'comfortable'
                          ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-bold'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      )}
                    >
                      <div>Rahat (Standart)</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        Daha ferah padding ve buton aralıkları
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUIDensity('compact')}
                      className={cn(
                        'flex-1 p-2.5 rounded-xl border text-xs font-medium text-left transition-colors',
                        uiDensity === 'compact'
                          ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 font-bold'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      )}
                    >
                      <div>Kompakt (Yoğun)</div>
                      <div className="text-[10px] text-slate-400 font-normal">
                        Maksimum ekran alanı için sıkı yerleşim
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: VIEWER */}
            {activeTab === 'viewer' && (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-bold text-slate-900 dark:text-white mb-1">
                    Varsayılan Açılış Sığdırma Modu
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Yeni bir PDF açıldığında ilk uygulanacak ölçekleme kuralı.
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'width', label: 'Genişliğe Sığdır (Önerilen)' },
                      { id: 'content', label: 'İçeriğe / Metne Sığdır' },
                      { id: 'page', label: 'Tam Sayfaya Sığdır' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setFitMode(item.id as 'width' | 'content' | 'page')}
                        className={cn(
                          'p-2.5 rounded-xl border text-xs font-semibold transition-colors text-center',
                          fitMode === item.id
                            ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-slate-200 dark:bg-slate-800" />

                <div>
                  <label className="block text-xs font-bold text-slate-900 dark:text-white mb-1">
                    Sayfa Geçiş Animasyonu
                  </label>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Sayfalar arasında gezinirken uygulanacak geçiş efekti (yerel diske kaydedilir).
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'instant', label: 'Kapalı (Anında - En Hızlı)' },
                      { id: 'smooth', label: 'Pürüzsüz Akış' },
                      { id: 'slide', label: 'Klasik Slayt' },
                    ].map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handlePageTransitionChange(item.id as PageTransitionType)}
                        className={cn(
                          'p-2.5 rounded-xl border text-xs font-semibold transition-colors text-center',
                          pageTransition === item.id
                            ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                        )}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-slate-200 dark:bg-slate-800" />

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                        Önbellek & Donanım Hızlandırma
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        LRU ImageBitmap önbelleği ve Web Worker kuyrukları.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleClearCache}
                      className="px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Önbelleği Temizle</span>
                    </button>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
                    DirectX / GPU çift doğrusal (bilinear) filtreleme aktif. Akıcı donanım hızlandırması etkindir.
                  </div>
                </div>
              </div>
            )}

            {/* TAB: BEHAVIOR (Interactive Preferences + Interaction Guide) */}
            {activeTab === 'behavior' && (
              <div className="space-y-5">
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-3">
                    Çalışma & Açılış Tercihleri
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 text-xs">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Varsayılan Görünüm Düzeni
                      </label>
                      <select
                        value={viewMode}
                        onChange={(e) => setViewMode(e.target.value as ViewMode)}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      >
                        <option value="continuous">Sürekli Dikey Kaydırma</option>
                        <option value="single">Tek Sayfa</option>
                        <option value="two-page">İki Sayfa (Kitap)</option>
                        <option value="four-page">Dört Sayfa</option>
                        <option value="continuous-horizontal">Yatay Kaydırma</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                        Varsayılan Yakınlaştırma
                      </label>
                      <select
                        value={Math.round(zoom * 100)}
                        onChange={(e) => {
                          const z = Number(e.target.value) / 100;
                          setZoom(z, false);
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"
                      >
                        {[50, 75, 100, 125, 150, 200].map((pct) => (
                          <option key={pct} value={pct}>
                            %{pct} {pct === 100 ? '(Gerçek Boyut)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 cursor-pointer">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          Kaydedilmemiş Sekmeyi Kapatırken Onay İste
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Değişiklik yapılan sekmeler kapatılmadan önce kaydetme uyarısı gösterir
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={confirmOnClose}
                        onChange={(e) => handleConfirmOnCloseChange(e.target.checked)}
                        className="w-4 h-4 accent-sky-500 rounded"
                      />
                    </label>

                    <label className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 cursor-pointer">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          Güncellemeleri Otomatik Denetle
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Uygulama açılışında yeni sürüm kontrolü yapar
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={autoCheckUpdates}
                        onChange={(e) => handleAutoCheckUpdatesChange(e.target.checked)}
                        className="w-4 h-4 accent-sky-500 rounded"
                      />
                    </label>
                  </div>
                </div>

                <div className="h-px bg-slate-200 dark:bg-slate-800" />

                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white mb-2">
                    Klavye & Fare Etkileşimi
                  </h4>

                  <div className="space-y-2 text-xs">
                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          Ctrl + Fare Tekerleği
                        </div>
                        <div className="text-[11px] text-slate-400">
                          İmlecin altındaki piksel dondurularak odaklı yakınlaştırma
                        </div>
                      </div>
                      <span className="px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md font-bold text-[10px]">
                        Aktif
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          Shift + Sol Tık Sürükle
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Kutu içine alınan alanı ekrana tam sığdırır (Marquee Zoom)
                        </div>
                      </div>
                      <span className="px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md font-bold text-[10px]">
                        Aktif
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800">
                      <div>
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          F11 veya Ctrl + L
                        </div>
                        <div className="text-[11px] text-slate-400">
                          Yüzen HUD ve lazer işaretçili Tam Ekran Sunum Modu
                        </div>
                      </div>
                      <span className="px-2 py-1 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-md font-bold text-[10px]">
                        Aktif
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB: ABOUT */}
            {activeTab === 'about' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/10 to-indigo-500/10 border border-sky-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-sky-500 text-white flex items-center justify-center font-black text-xl shadow-lg shrink-0">
                      X
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        XPDF Editor Pro
                      </h3>
                      <div className="text-xs text-sky-600 dark:text-sky-400 font-semibold">
                        Sürüm {appVersion}
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Profesyonel PDF Görüntüleme, Çizim, Form, OCR ve Vektörel Düzenleme Suite&apos;i.
                      </p>
                    </div>
                  </div>

                  {updaterStatus.type === 'downloaded' ? (
                    <button
                      type="button"
                      onClick={handleInstallUpdateNow}
                      className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 shrink-0"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Yeniden Başlat & Güncelle</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCheckUpdates}
                      disabled={isCheckingUpdates}
                      className="px-3.5 py-2 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                    >
                      {isCheckingUpdates ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>{isCheckingUpdates ? 'Denetleniyor...' : 'Güncellemeleri Denetle'}</span>
                    </button>
                  )}
                </div>

                {updaterStatus.type !== 'idle' && (
                  <div
                    className={cn(
                      'p-3 rounded-xl border text-xs flex items-center justify-between gap-2',
                      updaterStatus.type === 'error'
                        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300'
                        : updaterStatus.type === 'downloaded' || updaterStatus.type === 'up-to-date'
                        ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'
                        : 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300'
                    )}
                  >
                    <span>{updaterStatus.message}</span>
                    {typeof updaterStatus.percent === 'number' && (
                      <span className="font-mono font-bold">%{updaterStatus.percent}</span>
                    )}
                  </div>
                )}

                <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                  <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400">Geliştirici & Depo</span>
                    <a
                      href="https://github.com/knutolof06/XPDF-EDITOR"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sky-500 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <span>knutolof06/XPDF-EDITOR</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400">Lisans</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">MIT License</span>
                  </div>
                  <div className="flex justify-between py-2 border-b border-slate-200 dark:border-slate-800">
                    <span className="text-slate-400">Platform</span>
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      Electron + React + Vite + TypeScript + PDF.js
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <span className="text-xs text-slate-400">
            Tercihler otomatik olarak yerel diske kaydedilmektedir.
          </span>
          <button
            type="button"
            onClick={() => setSettingsModalOpen(false)}
            className="px-4 py-1.5 bg-sky-500 hover:bg-sky-600 text-white rounded-xl text-xs font-bold shadow-sm transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
