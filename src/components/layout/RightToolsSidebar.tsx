import React, { useState } from 'react';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { useRulerStore } from '@/store/ruler-store';
import {
  ChevronRight,
  ChevronLeft,
  Search,
  Move,
  LayoutGrid,
  Ruler,
  Minimize2,
  Image as ImageIcon,
  FileImage,
  Layers,
  Scissors,
  CheckSquare,
  PenTool,
  Stamp,
  Hash,
  Grid,
  Magnet,
  Trash2,
  Columns,
  Info,
  Droplet,
  X,
  SlidersHorizontal,
  Lock,
  ShieldCheck,
  FilePlus,
  Replace,
  FileSearch,
} from 'lucide-react';
import { cn } from '@/utils/cn';

interface ToolItem {
  id: string;
  title: string;
  category: 'edit' | 'convert' | 'forms' | 'protect';
  icon: any;
  color: string;
  description: string;
  action: () => void;
  badge?: string;
  active?: boolean;
}

export const RightToolsSidebar: React.FC = () => {
  const { theme, appDesignTheme = 'fluent' } = useViewerStore();
  const isDark = theme === 'dark';

  const {
    isRightToolsSidebarOpen,
    setRightToolsSidebarOpen,
    setObjectEditorOpen,
    setMergeModalOpen,
    setSplitModalOpen,
    setPageEqualizeModalOpen,
    setCompressModalOpen,
    setExportImageModalOpen,
    setImagesToPdfModalOpen,
    setWatermarkModalOpen,
    setSignatureModalOpen,
    setStampModalOpen,
    setHeaderFooterModalOpen,
    setPropertiesModalOpen,
    setSecurityModalOpen,
    setSignatureVerifyModalOpen,
    setInsertBlankPageModalOpen,
    setFindReplaceModalOpen,
    setOcrModalOpen,
    setFormsModalOpen,
    setCompareModalOpen,
    addToast,
  } = useUIStore();

  const { isPageManagerOpen, setPageManagerOpen } = useViewerStore();

  const {
    showRulers,
    toggleRulers,
    showGrid,
    toggleGrid,
    unit,
    setUnit,
    snapToGuides,
    setSnapToGuides,
    clearGuides,
  } = useRulerStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const tools: ToolItem[] = [
    // 1. Sayfa & Döküman Düzenleme
    {
      id: 'page_manager',
      title: 'Sayfa Yöneticisi',
      category: 'edit',
      icon: LayoutGrid,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'Görsel grid üzerinde sayfaları taşıyın, sıralayın, döndürün veya silin',
      active: isPageManagerOpen,
      action: () => setPageManagerOpen(!isPageManagerOpen),
    },
    {
      id: 'find_replace',
      title: 'Bul ve Değiştir',
      category: 'edit',
      icon: Replace,
      color: 'text-indigo-500 bg-indigo-500/10',
      description: 'Dökümandaki metinleri arayın ve doğrudan değiştirin (Ctrl+H)',
      badge: 'Akıllı',
      action: () => setFindReplaceModalOpen(true),
    },
    {
      id: 'object_editor',
      title: 'Nesneleri Düzenle',
      category: 'edit',
      icon: Move,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'PDF içindeki gömülü metin, görsel ve vektör nesnelerini taşıyın veya silin',
      badge: 'Vektör',
      action: () => setObjectEditorOpen(true),
    },
    {
      id: 'geometry_layout',
      title: 'Sayfa Geometrisi & Mizanpaj',
      category: 'edit',
      icon: Ruler,
      color: 'text-orange-500 bg-orange-500/10',
      description: 'A4 standart boyut eşitleme ve 2-up / 4-up çoklu sayfa baskı mizanpajı',
      badge: 'Mizanpaj',
      action: () => setPageEqualizeModalOpen(true),
    },
    {
      id: 'blank_page',
      title: 'Boş Sayfa Ekle',
      category: 'edit',
      icon: FilePlus,
      color: 'text-emerald-500 bg-emerald-500/10',
      description: 'Dökümana A4 veya Letter formatında temiz boş sayfa ekleyin',
      action: () => setInsertBlankPageModalOpen(true),
    },

    // 2. Dönüştür & Akıllı OCR Studio
    {
      id: 'ocr',
      title: 'Metin Tanıma (OCR)',
      category: 'convert',
      icon: FileSearch,
      color: 'text-indigo-500 bg-indigo-500/10',
      description: 'Taranmış belgeleri seçilebilir, aranabilir (Ctrl+F) ve düzenlenebilir hale getirin',
      badge: 'PDF24 / Acrobat',
      action: () => setOcrModalOpen(true),
    },
    {
      id: 'compress',
      title: 'PDF Sıkıştır',
      category: 'convert',
      icon: Minimize2,
      color: 'text-amber-500 bg-amber-500/10',
      description: 'Görselleri optimize ederek dosya boyutunu %70 küçültün',
      badge: '%70 Tasarruf',
      action: () => setCompressModalOpen(true),
    },
    {
      id: 'export_images',
      title: 'Görsele Çevir (ZIP)',
      category: 'convert',
      icon: ImageIcon,
      color: 'text-emerald-500 bg-emerald-500/10',
      description: 'Sayfaları PNG, JPG veya WebP olarak yüksek kalitede indirin',
      action: () => setExportImageModalOpen(true),
    },
    {
      id: 'images_to_pdf',
      title: 'Görsellerden PDF',
      category: 'convert',
      icon: FileImage,
      color: 'text-purple-500 bg-purple-500/10',
      description: 'Fotoğraflardan tek tıkla yeni bir PDF dökümanı oluşturun',
      action: () => setImagesToPdfModalOpen(true),
    },
    {
      id: 'merge',
      title: 'PDF Birleştir',
      category: 'convert',
      icon: Layers,
      color: 'text-blue-500 bg-blue-500/10',
      description: 'Birden fazla PDF dosyasını tek bir dökümanda birleştirin',
      action: () => setMergeModalOpen(true),
    },
    {
      id: 'split',
      title: 'PDF Böl',
      category: 'convert',
      icon: Scissors,
      color: 'text-rose-500 bg-rose-500/10',
      description: 'Sayfa aralıklarına veya tekil sayfalara göre dökümanı ayırın',
      action: () => setSplitModalOpen(true),
    },

    // 3. Form, İmza & Resmi Onay
    {
      id: 'forms',
      title: 'Form Yöneticisi',
      category: 'forms',
      icon: CheckSquare,
      color: 'text-emerald-500 bg-emerald-500/10',
      description: 'PDF form alanlarını doldurun, içe/dışa aktarın veya kilitleyin',
      badge: 'AcroForm',
      action: () => setFormsModalOpen(true),
    },
    {
      id: 'signature',
      title: 'Dijital İmza',
      category: 'forms',
      icon: PenTool,
      color: 'text-indigo-500 bg-indigo-500/10',
      description: 'Çizim veya görsel yükleyerek resmi e-imza ekleyin',
      action: () => setSignatureModalOpen(true),
    },
    {
      id: 'stamp',
      title: 'Kaşe ve Damga',
      category: 'forms',
      icon: Stamp,
      color: 'text-rose-500 bg-rose-500/10',
      description: 'ONAYLANDI, GİZLİ veya özel şirket kaşesi basın',
      action: () => setStampModalOpen(true),
    },
    {
      id: 'page_numbers_header_footer',
      title: 'Sayfa No & Üst/Alt Bilgi',
      category: 'forms',
      icon: Hash,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'Dinamik sayfa numaraları, tarih, kurumsal başlık ve dipnot ekleyin',
      action: () => setHeaderFooterModalOpen(true),
    },
    {
      id: 'verify_signatures',
      title: 'İmzaları İncele',
      category: 'forms',
      icon: ShieldCheck,
      color: 'text-indigo-500 bg-indigo-500/10',
      description: 'Belgedeki elektronik ve dijital imzaları doğrulayın',
      badge: 'e-İmza',
      action: () => setSignatureVerifyModalOpen(true),
    },

    // 4. Güvenlik, Koruma & Denetim
    {
      id: 'security',
      title: 'Şifrele ve İzinler',
      category: 'protect',
      icon: Lock,
      color: 'text-amber-500 bg-amber-500/10',
      description: 'Belgeye parola koyun, yazdırma ve kopyalamayı kısıtlayın',
      badge: 'AES-128',
      action: () => setSecurityModalOpen(true),
    },
    {
      id: 'watermark',
      title: 'Filigran Ekle',
      category: 'protect',
      icon: Droplet,
      color: 'text-blue-500 bg-blue-500/10',
      description: 'GİZLİDİR, TASLAK veya özel kurumsal filigran basın',
      action: () => setWatermarkModalOpen(true),
    },
    {
      id: 'compare',
      title: 'Belgeleri Karşılaştır',
      category: 'protect',
      icon: Columns,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'İki PDF belgesini yan yana açıp görsel ve metinsel farkları inceleyin',
      badge: 'Diff',
      action: () => setCompareModalOpen(true),
    },
    {
      id: 'properties',
      title: 'Belge Özellikleri',
      category: 'protect',
      icon: Info,
      color: 'text-slate-500 bg-slate-500/10',
      description: 'Sayfa sayısı, şifreleme ve döküman meta verilerini görüntüleyin',
      action: () => setPropertiesModalOpen(true),
    },
  ];

  const filteredTools = tools.filter((t) => {
    const matchesSearch =
      searchQuery.trim() === '' ||
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = activeCategory === 'all' || t.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  // Collapsed Mode: Slim icon strip
  if (!isRightToolsSidebarOpen) {
    return (
      <div
        className={cn(
          'w-12 border-l flex flex-col items-center py-2 shrink-0 select-none z-30 transition-all',
          appDesignTheme === 'cupertino' &&
            'cupertino-glass border-l border-black/5 dark:border-white/10',
          appDesignTheme === 'linear' && 'bg-[#08090a] border-l border-white/10 shadow-none',
          appDesignTheme === 'fluent' &&
            (isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'),
          appDesignTheme === 'ribbon' &&
            (isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-100 border-slate-300')
        )}
      >
        <button
          onClick={() => setRightToolsSidebarOpen(true)}
          className={cn(
            'p-2 rounded-xl mb-2 transition-colors',
            isDark ? 'hover:bg-slate-800 text-slate-300' : 'hover:bg-slate-100 text-slate-600'
          )}
          title="Tüm Araçlar Panelini Genişlet"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="w-6 h-[1px] bg-slate-200 dark:bg-slate-800 mb-2" />

        {/* Quick Icon Strip */}
        <div className="flex flex-col gap-1.5 w-full items-center">
          {tools.slice(0, 9).map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={tool.action}
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center transition-all group relative',
                  tool.active
                    ? 'bg-sky-500 text-white shadow-xs'
                    : isDark
                    ? 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'
                    : 'hover:bg-slate-100 text-slate-600 hover:text-slate-900'
                )}
                title={`${tool.title} — ${tool.description}`}
              >
                <Icon className="w-4 h-4" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Expanded Mode: Full Professional Tools Panel
  return (
    <div
      className={cn(
        'w-64 sm:w-72 border-l flex flex-col shrink-0 select-none z-30 transition-all animate-in slide-in-from-right duration-200',
        appDesignTheme === 'cupertino' &&
          'cupertino-glass border-l border-black/5 dark:border-white/10 text-slate-800 dark:text-slate-100',
        appDesignTheme === 'linear' &&
          'bg-[#08090a] border-l border-white/10 text-slate-100 shadow-none',
        appDesignTheme === 'fluent' &&
          (isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-slate-50/90 border-slate-200 text-slate-800'),
        appDesignTheme === 'ribbon' &&
          (isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-slate-100 border-slate-300 text-slate-800')
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'p-3.5 border-b flex items-center justify-between shrink-0',
          appDesignTheme === 'linear'
            ? 'bg-[#0E1015] border-white/10'
            : isDark
            ? 'border-slate-800 bg-slate-900/60'
            : 'border-slate-200/80 bg-white'
        )}
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-sky-500" />
          <h2 className="text-xs font-bold tracking-wide uppercase">Tüm Araçlar</h2>
        </div>

        <button
          onClick={() => setRightToolsSidebarOpen(false)}
          className="p-1 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          title="Paneli Daralt"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Search Input */}
      <div className="p-2.5 shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Araçlarda ara..."
            className={cn(
              'w-full text-xs pl-8 pr-7 py-1.5 rounded-xl border focus:outline-hidden transition-all font-medium',
              appDesignTheme === 'linear'
                ? 'bg-[#0E1015] border-white/10 text-white placeholder-slate-500 focus:border-cyan-500'
                : isDark
                ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500 focus:ring-2 focus:ring-sky-500'
                : 'bg-white border-slate-200 text-slate-900 focus:ring-2 focus:ring-sky-500'
            )}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* COMPACT ALIGNMENT TOOLBAR (Replaces 4 separate cards for rulers/grid/snap/clear) */}
      <div
        className={cn(
          'mx-2.5 mb-2 px-2 py-1.5 rounded-xl border flex items-center justify-between text-xs shrink-0',
          appDesignTheme === 'linear'
            ? 'bg-[#0E1015] border-white/10'
            : isDark
            ? 'bg-slate-800/60 border-slate-700/60'
            : 'bg-white border-slate-200 shadow-2xs'
        )}
      >
        <div className="flex items-center gap-1">
          <button
            onClick={toggleRulers}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              showRulers
                ? 'bg-sky-500 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            )}
            title="Cetvelleri Aç / Kapat (Ctrl+R)"
          >
            <Ruler className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={toggleGrid}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              showGrid
                ? 'bg-sky-500 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            )}
            title="Kareli Izgarayı Aç / Kapat"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => setSnapToGuides(!snapToGuides)}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              snapToGuides
                ? 'bg-emerald-500 text-white shadow-xs'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
            )}
            title={`Manyetik Yapışma: ${snapToGuides ? 'Açık' : 'Kapalı'}`}
          >
            <Magnet className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              clearGuides();
              addToast('Tüm kılavuz çizgileri temizlendi.', 'info');
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            title="Kılavuz Çizgilerini Temizle"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Unit Selector */}
        {showRulers && (
          <div className="flex items-center gap-0.5 border border-slate-200 dark:border-slate-700 rounded-md p-0.5 bg-slate-50 dark:bg-slate-900">
            {(['mm', 'cm', 'pt'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={cn(
                  'px-1 py-0.2 text-[9px] font-bold rounded uppercase transition-all',
                  unit === u
                    ? 'bg-sky-500 text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
                )}
              >
                {u}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Category Pills */}
      <div className="px-2.5 pb-2 flex gap-1 overflow-x-auto no-scrollbar shrink-0 text-[10px] font-semibold">
        {[
          { id: 'all', label: 'Tümü' },
          { id: 'edit', label: 'Düzenle' },
          { id: 'convert', label: 'OCR / Dönüştür' },
          { id: 'forms', label: 'İmza & Form' },
          { id: 'protect', label: 'Güvenlik' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              'px-2.5 py-1 rounded-lg transition-all shrink-0 font-medium',
              activeCategory === cat.id
                ? appDesignTheme === 'linear'
                  ? 'bg-cyan-500 text-black font-semibold shadow-[0_0_10px_rgba(6,182,212,0.25)]'
                  : 'bg-sky-500 text-white shadow-xs'
                : appDesignTheme === 'linear'
                ? 'bg-[#0E1015] border border-white/5 text-slate-400 hover:text-white'
                : isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                : 'bg-white hover:bg-slate-200 border border-slate-200 text-slate-600'
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Tools List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
        {filteredTools.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-400">
            Aradığınız kriterde araç bulunamadı.
          </div>
        ) : (
          filteredTools.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={tool.action}
                className={cn(
                  'w-full p-2.5 rounded-xl border flex items-start gap-2.5 text-left transition-all group select-none',
                  appDesignTheme === 'linear' && [
                    'bg-[#0E1015] border-white/10 rounded-lg hover:border-cyan-500/50 hover:bg-white/[0.03] text-slate-200',
                    tool.active && 'border-cyan-500 bg-cyan-500/10 shadow-[0_0_12px_rgba(6,182,212,0.15)]',
                  ],
                  appDesignTheme === 'cupertino' && [
                    'rounded-2xl border-white/10 dark:border-white/5 hover:bg-white/60 dark:hover:bg-slate-800/60 shadow-2xs hover:shadow-md',
                    tool.active && 'bg-sky-500/15 border-sky-500/30',
                  ],
                  appDesignTheme === 'fluent' && [
                    tool.active
                      ? 'border-sky-500 bg-sky-500/10'
                      : isDark
                      ? 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800/80 shadow-2xs'
                      : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 shadow-2xs',
                  ],
                  appDesignTheme === 'ribbon' && [
                    tool.active
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/30'
                      : 'bg-white dark:bg-slate-850 border-slate-300 dark:border-slate-800 rounded-md hover:bg-slate-50',
                  ]
                )}
              >
                <div
                  className={cn(
                    'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-transform group-hover:scale-105',
                    tool.color
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold truncate text-slate-800 dark:text-slate-100">
                      {tool.title}
                    </span>
                    {tool.badge && (
                      <span
                        className={cn(
                          'text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0',
                          appDesignTheme === 'linear'
                            ? 'bg-cyan-950/80 text-cyan-400 border border-cyan-800/40 font-mono'
                            : 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                        )}
                      >
                        {tool.badge}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">
                    {tool.description}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div
        className={cn(
          'p-2.5 border-t text-center text-[10px] text-slate-400 shrink-0',
          appDesignTheme === 'linear'
            ? 'bg-[#0E1015] border-white/10 font-mono'
            : isDark
            ? 'border-slate-800 bg-slate-900/60'
            : 'border-slate-200 bg-white'
        )}
      >
        <span>XPDF Professional Studio Araç Seti</span>
      </div>
    </div>
  );
};
