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
  Sparkles,
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
  FileText,
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
} from 'lucide-react';
import { cn } from '@/utils/cn';

interface ToolItem {
  id: string;
  title: string;
  category: 'edit' | 'convert' | 'forms' | 'rulers' | 'protect';
  icon: any;
  color: string;
  description: string;
  action: () => void;
  badge?: string;
  active?: boolean;
}

export const RightToolsSidebar: React.FC = () => {
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === 'dark';

  const {
    isRightToolsSidebarOpen,
    setRightToolsSidebarOpen,
    setObjectEditorOpen,
    setMergeModalOpen,
    setSplitModalOpen,
    setPageLayoutModalOpen,
    setPageEqualizeModalOpen,
    setCompressModalOpen,
    setExportImageModalOpen,
    setImagesToPdfModalOpen,
    setWatermarkModalOpen,
    setSignatureModalOpen,
    setStampModalOpen,
    setPageNumberModalOpen,
    setHeaderFooterModalOpen,
    setPropertiesModalOpen,
    setExtractTextModalOpen,
    setSecurityModalOpen,
    setSignatureVerifyModalOpen,
    setInsertBlankPageModalOpen,
    addToast,
  } = useUIStore();

  const {
    isPageManagerOpen,
    setPageManagerOpen,
  } = useViewerStore();

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
    // 1. PDF Edit
    {
      id: 'object_editor',
      title: 'Nesneleri Düzenle',
      category: 'edit',
      icon: Move,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'PDF içindeki metin, görsel ve QR kodları taşıyın veya silin',
      badge: 'Gelişmiş',
      action: () => setObjectEditorOpen(true),
    },
    {
      id: 'page_manager',
      title: 'Sayfa Yöneticisi',
      category: 'edit',
      icon: LayoutGrid,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'Sayfaları sıralayın, döndürün veya silin',
      active: isPageManagerOpen,
      action: () => setPageManagerOpen(!isPageManagerOpen),
    },
    {
      id: 'equalize',
      title: 'Boyutları Eşitle',
      category: 'edit',
      icon: Ruler,
      color: 'text-orange-500 bg-orange-500/10',
      description: 'Farklı boyutlardaki sayfaları A4 standardına eşitleyin',
      action: () => setPageEqualizeModalOpen(true),
    },
    {
      id: 'nup',
      title: 'N-up Sayfa Düzeni',
      category: 'edit',
      icon: Sparkles,
      color: 'text-purple-500 bg-purple-500/10',
      description: 'Birden fazla sayfayı tek sayfada birleştirin (2-up, 4-up)',
      action: () => setPageLayoutModalOpen(true),
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

    // 2. Convert & Compress
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
      description: 'Sayfaları PNG, JPG veya WebP olarak toplu indirin',
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
      description: 'Birden fazla PDF dosyasını tek bir dökümanda toplayın',
      action: () => setMergeModalOpen(true),
    },
    {
      id: 'split',
      title: 'PDF Böl',
      category: 'convert',
      icon: Scissors,
      color: 'text-rose-500 bg-rose-500/10',
      description: 'Sayfa aralıklarına göre dökümanı parçalara ayırın',
      action: () => setSplitModalOpen(true),
    },
    {
      id: 'extract_text',
      title: 'Metin Çıkar (TXT/JSON)',
      category: 'convert',
      icon: FileText,
      color: 'text-amber-500 bg-amber-500/10',
      description: 'PDF metinlerini kopyalayın veya TXT/JSON formatında indirin',
      badge: 'TXT/JSON',
      action: () => setExtractTextModalOpen(true),
    },

    // 3. Forms & Signatures
    {
      id: 'forms',
      title: 'Form Yöneticisi',
      category: 'forms',
      icon: CheckSquare,
      color: 'text-emerald-500 bg-emerald-500/10',
      description: 'Form alanlarını doldurun, JSON içe/dışa aktarın veya kilitleyin',
      badge: 'AcroForm',
      action: () => {
        // Trigger FormFieldsModal through global state
        const btn = document.getElementById('btn-open-forms-modal');
        if (btn) btn.click();
      },
    },
    {
      id: 'signature',
      title: 'Dijital İmza',
      category: 'forms',
      icon: PenTool,
      color: 'text-indigo-500 bg-indigo-500/10',
      description: 'Çizim veya görsel yükleyerek resmi imza ekleyin',
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
      id: 'page_numbers',
      title: 'Sayfa Numaraları',
      category: 'forms',
      icon: Hash,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'Sayfaların altına/üstüne otomatik numaralandırma ekleyin',
      action: () => setPageNumberModalOpen(true),
    },
    {
      id: 'header_footer',
      title: 'Üst ve Alt Bilgi',
      category: 'forms',
      icon: FileText,
      color: 'text-slate-500 bg-slate-500/10',
      description: 'Döküman genelinde başlık ve dipnot metinleri ekleyin',
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

    // 4. Rulers & Guides (FAZ 5)
    {
      id: 'rulers',
      title: showRulers ? 'Cetvelleri Gizle' : 'Cetvelleri Göster',
      category: 'rulers',
      icon: Ruler,
      color: showRulers ? 'text-sky-600 bg-sky-500/20' : 'text-slate-500 bg-slate-500/10',
      description: 'Sayfa kenarlarında hassas ölçüm cetvelleri (Ctrl+R)',
      badge: showRulers ? 'Açık' : 'Kapalı',
      active: showRulers,
      action: toggleRulers,
    },
    {
      id: 'grid',
      title: showGrid ? 'Izgarayı Gizle' : 'Izgarayı Göster',
      category: 'rulers',
      icon: Grid,
      color: showGrid ? 'text-sky-600 bg-sky-500/20' : 'text-slate-500 bg-slate-500/10',
      description: 'Sayfa üzerinde milimetrik kareli ızgara çizgileri',
      badge: showGrid ? 'Açık' : 'Kapalı',
      active: showGrid,
      action: toggleGrid,
    },
    {
      id: 'snap',
      title: snapToGuides ? 'Manyetik Yapışma: Açık' : 'Manyetik Yapışma: Kapalı',
      category: 'rulers',
      icon: Magnet,
      color: snapToGuides ? 'text-emerald-600 bg-emerald-500/20' : 'text-slate-500 bg-slate-500/10',
      description: 'Nesneleri ve kılavuzları sayfa ortasına otomatik hizalar',
      action: () => setSnapToGuides(!snapToGuides),
    },
    {
      id: 'clear_guides',
      title: 'Kılavuzları Temizle',
      category: 'rulers',
      icon: Trash2,
      color: 'text-rose-500 bg-rose-500/10',
      description: 'Çekilmiş tüm dikey ve yatay kılavuz çizgilerini siler',
      action: () => {
        clearGuides();
        addToast('Tüm kılavuz çizgileri temizlendi.', 'info');
      },
    },

    // 5. Protect & Security
    {
      id: 'security',
      title: 'Şifrele ve İzinler',
      category: 'protect',
      icon: Lock,
      color: 'text-amber-500 bg-amber-500/10',
      description: 'Belgeye parola koyun, izinleri kısıtlayın veya şifreyi kaldırın',
      badge: 'AES-128',
      action: () => setSecurityModalOpen(true),
    },
    {
      id: 'watermark',
      title: 'Filigran Ekle',
      category: 'protect',
      icon: Droplet,
      color: 'text-blue-500 bg-blue-500/10',
      description: 'GİZLİDİR, TASLAK veya özel metin filigranı basın',
      action: () => setWatermarkModalOpen(true),
    },
    {
      id: 'compare',
      title: 'Belgeleri Karşılaştır',
      category: 'protect',
      icon: Columns,
      color: 'text-sky-500 bg-sky-500/10',
      description: 'İki PDF belgesini yan yana açıp farkları inceleyin',
      action: () => {
        const btn = document.getElementById('btn-open-compare-modal');
        if (btn) btn.click();
      },
    },
    {
      id: 'properties',
      title: 'Belge Özellikleri',
      category: 'protect',
      icon: Info,
      color: 'text-slate-500 bg-slate-500/10',
      description: 'Sayfa sayısı, şifreleme ve meta verilerini görüntüleyin',
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

  // If collapsed: show Acrobat style slim vertical icon strip
  if (!isRightToolsSidebarOpen) {
    return (
      <div
        className={cn(
          'w-12 border-l flex flex-col items-center py-2 shrink-0 select-none z-30 transition-all',
          isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-white border-slate-200'
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

        {/* Quick Icon Access */}
        <div className="flex flex-col gap-1 w-full items-center">
          {tools.slice(0, 8).map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                onClick={tool.action}
                className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center transition-all group relative',
                  tool.active
                    ? 'bg-sky-500 text-white'
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

  // Expanded Mode: Comprehensive Adobe Acrobat Tools Panel
  return (
    <div
      className={cn(
        'w-64 sm:w-72 border-l flex flex-col shrink-0 select-none z-30 transition-all animate-in slide-in-from-right duration-200',
        isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-slate-50/80 border-slate-200 text-slate-800'
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'p-3.5 border-b flex items-center justify-between shrink-0',
          isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200/80 bg-white'
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
              'w-full text-xs pl-8 pr-7 py-1.5 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all font-medium',
              isDark ? 'bg-slate-800 border-slate-700 text-white placeholder-slate-500' : 'bg-white border-slate-200 text-slate-900'
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

      {/* Category Pills */}
      <div className="px-2.5 pb-2 flex gap-1 overflow-x-auto no-scrollbar shrink-0 text-[10px] font-semibold">
        {[
          { id: 'all', label: 'Tümü' },
          { id: 'edit', label: 'Düzenle' },
          { id: 'convert', label: 'Dönüştür' },
          { id: 'forms', label: 'Formlar' },
          { id: 'rulers', label: 'Cetvel/Hizala' },
          { id: 'protect', label: 'Güvenlik' },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              'px-2 py-1 rounded-lg transition-colors shrink-0',
              activeCategory === cat.id
                ? 'bg-sky-500 text-white shadow-xs'
                : isDark
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                : 'bg-white hover:bg-slate-200 border border-slate-200 text-slate-600'
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* FAZ 5 Unit Selector if in rulers or all */}
      {(activeCategory === 'all' || activeCategory === 'rulers') && showRulers && (
        <div className="mx-2.5 mb-2 p-2 rounded-xl border bg-sky-500/5 border-sky-500/20 flex items-center justify-between text-xs">
          <span className="font-semibold text-slate-600 dark:text-slate-300 text-[11px]">Cetvel Birimi:</span>
          <div className="flex gap-1">
            {(['mm', 'cm', 'pt', 'in'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={cn(
                  'px-1.5 py-0.5 rounded text-[10px] font-bold transition-all uppercase',
                  unit === u
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                )}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
      )}

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
                  'w-full p-2.5 rounded-xl border flex items-start gap-2.5 text-left transition-all group',
                  tool.active
                    ? 'border-sky-500 bg-sky-500/10'
                    : isDark
                    ? 'bg-slate-800/40 border-slate-800 hover:border-slate-700 hover:bg-slate-800'
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 shadow-2xs'
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
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-600 dark:text-sky-400 shrink-0">
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
          isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-white'
        )}
      >
        <span>XPDF Adobe Acrobat Araç Seti</span>
      </div>
    </div>
  );
};
