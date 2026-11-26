import React from 'react';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { useDocumentStore } from '@/store/document-store';
import { useViewerStore } from '@/store/viewer-store';
import { syncActiveTool } from '@/components/common/pdf-actions';
import { useResolvedDarkTheme } from '@/components/common/theme-utils';
import { useViewerUIState } from '@/components/viewer/viewer-ui-state';
import { ActiveTool } from '@/types/viewer';
import { TextAnnotation, AnyAnnotation, ShapeAnnotation } from '@/types/annotations';
import {
  MousePointer,
  Hand,
  Type,
  Pen,
  Highlighter,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Eraser,
  ShieldAlert,
  FileSignature,
  Stamp,
  Image as ImageIcon,
  Hash,
  Bold,
  Italic,
  Copy,
  Trash2,
  Crosshair,
  Move,
} from 'lucide-react';
import { cn } from '@/utils/cn';

const COLORS = [
  '#0284c7', // Sky
  '#ef4444', // Red
  '#10b981', // Green
  '#f59e0b', // Amber
  '#8b5cf6', // Purple
  '#0f172a', // Black
  '#ffffff', // White
];

const FONT_FAMILIES = [
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, Times New Roman, serif', label: 'Serif' },
  { value: 'ui-monospace, Consolas, monospace', label: 'Mono' },
];

export const EditorToolbar: React.FC = () => {
  const {
    activeTool,
    toolStyles,
    setToolStyles,
    selectedAnnotationId,
    cloneAnnotation,
    deleteAnnotation,
    updateAnnotation,
  } = useAnnotationStore();

  const {
    setSignatureModalOpen,
    setStampModalOpen,
    setPageNumberModalOpen,
    setSnipOcrModalOpen,
  } = useUIStore();

  const currentDocument = useDocumentStore((s) => s.currentDocument);
  const appDesignTheme = useViewerStore((s) => s.appDesignTheme);
  const isDark = useResolvedDarkTheme();
  const { inlineNativeEdit, toggleInlineNativeEdit } = useViewerUIState();
  const imageInputRef = React.useRef<HTMLInputElement>(null);

  if (appDesignTheme === 'ribbon') {
    return null;
  }

  // Locate selected annotation across pages (usually on active page)
  let selectedAnnotationPageId: string | undefined =
    currentDocument?.activePageId ||
    currentDocument?.pages?.[currentDocument?.activePageIndex || 0]?.id;
  let selectedAnnotation: AnyAnnotation | undefined;

  if (currentDocument && selectedAnnotationId) {
    for (const p of currentDocument.pages) {
      const found = p.annotations.find((a) => a.id === selectedAnnotationId);
      if (found) {
        selectedAnnotation = found;
        selectedAnnotationPageId = p.id;
        break;
      }
    }
  }

  const activePageId = selectedAnnotationPageId;

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activePageId) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new window.Image();
      img.onload = () => {
        const maxWidth = 240;
        const natW = img.naturalWidth || 200;
        const natH = img.naturalHeight || 150;
        const width = Math.min(maxWidth, natW);
        const height = Math.max(24, Math.round((width * natH) / natW));

        const { addAnnotation, setSelectedAnnotationId } = useAnnotationStore.getState();
        const newImgAnn = {
          id: 'img_' + Date.now(),
          pageId: activePageId,
          type: 'image' as const,
          x: 80,
          y: 80,
          width,
          height,
          dataUrl,
          opacity: toolStyles.opacity,
        };
        addAnnotation(activePageId, newImgAnn);
        setSelectedAnnotationId(newImgAnn.id);
        syncActiveTool('select');
      };
      img.onerror = () => {
        useUIStore.getState().addToast('Görsel dosyası yüklenemedi.', 'error');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const applyColorStyle = (color: string) => {
    setToolStyles({ color });
    if (selectedAnnotation && activePageId) {
      if (selectedAnnotation.type === 'text' || selectedAnnotation.type === 'draw' || selectedAnnotation.type === 'highlight' || selectedAnnotation.type === 'whiteout') {
        updateAnnotation(activePageId, selectedAnnotation.id, { color });
      } else if (
        selectedAnnotation.type === 'rect' ||
        selectedAnnotation.type === 'circle' ||
        selectedAnnotation.type === 'line' ||
        selectedAnnotation.type === 'arrow'
      ) {
        updateAnnotation(activePageId, selectedAnnotation.id, { strokeColor: color });
      }
    }
  };

  const applyStrokeWidth = (strokeWidth: number) => {
    setToolStyles({ strokeWidth });
    if (selectedAnnotation && activePageId) {
      if (
        selectedAnnotation.type === 'rect' ||
        selectedAnnotation.type === 'circle' ||
        selectedAnnotation.type === 'line' ||
        selectedAnnotation.type === 'arrow' ||
        selectedAnnotation.type === 'draw' ||
        selectedAnnotation.type === 'highlight'
      ) {
        updateAnnotation(activePageId, selectedAnnotation.id, { strokeWidth });
      }
    }
  };

  const applyOpacity = (opacity: number) => {
    setToolStyles({ opacity });
    if (selectedAnnotation && activePageId) {
      updateAnnotation(activePageId, selectedAnnotation.id, { opacity });
    }
  };

  const applyTextPatch = (patch: Partial<TextAnnotation>) => {
    setToolStyles(patch);
    if (selectedAnnotation?.type === 'text' && activePageId) {
      updateAnnotation(activePageId, selectedAnnotation.id, patch);
    }
  };

  const selectedTextAnn = selectedAnnotation?.type === 'text' ? (selectedAnnotation as TextAnnotation) : null;
  const showTextControls = activeTool === 'text-add' || Boolean(selectedTextAnn);
  const currentFontSize = selectedTextAnn?.fontSize ?? toolStyles.fontSize;
  const currentFontFamily = selectedTextAnn?.fontFamily ?? toolStyles.fontFamily;
  const currentIsBold = selectedTextAnn ? Boolean(selectedTextAnn.isBold) : toolStyles.isBold;
  const currentIsItalic = selectedTextAnn ? Boolean(selectedTextAnn.isItalic) : toolStyles.isItalic;
  const currentOpacity = selectedAnnotation?.opacity ?? toolStyles.opacity;
  const currentColor =
    selectedAnnotation && 'color' in selectedAnnotation && selectedAnnotation.color
      ? selectedAnnotation.color
      : selectedAnnotation && 'strokeColor' in selectedAnnotation
      ? (selectedAnnotation as ShapeAnnotation).strokeColor
      : toolStyles.color;

  const tools: { id: ActiveTool; label: string; keyHint?: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Seç / Taşı / Klonla (V)', keyHint: 'V', icon: <MousePointer className="w-4 h-4" /> },
    { id: 'hand', label: 'El (Kaydır) Aracı (Boşluk)', icon: <Hand className="w-4 h-4" /> },
    { id: 'text-add', label: 'Metin Ekle (T)', keyHint: 'T', icon: <Type className="w-4 h-4" /> },
    { id: 'whiteout', label: 'Beyazlat / Öğe Kapat (W)', keyHint: 'W', icon: <ShieldAlert className="w-4 h-4" /> },
    { id: 'draw', label: 'Çizim Kalemi (P)', keyHint: 'P', icon: <Pen className="w-4 h-4" /> },
    { id: 'highlight', label: 'Fosforlu Kalem (H)', keyHint: 'H', icon: <Highlighter className="w-4 h-4" /> },
    { id: 'eraser', label: 'Silgi (E)', keyHint: 'E', icon: <Eraser className="w-4 h-4" /> },
    { id: 'rect', label: 'Dikdörtgen (R)', keyHint: 'R', icon: <Square className="w-4 h-4" /> },
    { id: 'circle', label: 'Daire (C)', keyHint: 'C', icon: <Circle className="w-4 h-4" /> },
    { id: 'line', label: 'Çizgi (L)', keyHint: 'L', icon: <Minus className="w-4 h-4" /> },
    { id: 'arrow', label: 'Ok (A)', keyHint: 'A', icon: <ArrowUpRight className="w-4 h-4" /> },
  ];

  const isLinearDark = appDesignTheme === 'linear' && isDark;
  const isLinearLight = appDesignTheme === 'linear' && !isDark;

  return (
    <div
      role="toolbar"
      aria-label="Düzenleme Araç Çubuğu"
      className={cn(
        'no-print flex items-center justify-between text-xs select-none z-20 shrink-0 overflow-x-auto transition-all duration-200',
        appDesignTheme === 'cupertino' && 'h-10 mx-auto my-1 cupertino-glass rounded-2xl px-4 shadow-md border max-w-fit text-slate-700 dark:text-slate-200',
        isLinearDark && 'h-9 bg-[#0e1015] border-b border-white/10 px-3 text-slate-200 shadow-none',
        isLinearLight && 'h-9 bg-slate-50 border-b border-slate-200 px-3 text-slate-800 shadow-none',
        appDesignTheme === 'fluent' && 'h-11 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 text-slate-700 dark:text-slate-200 shadow-sm'
      )}
    >
      <input
        type="file"
        ref={imageInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        className="hidden"
      />

      {/* Main Tool Selector */}
      <div className="flex items-center gap-1">
        {tools.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-label={t.label}
            aria-pressed={activeTool === t.id}
            onClick={() => syncActiveTool(t.id)}
            className={cn(
              'p-1.5 rounded-lg transition-colors flex items-center gap-1',
              activeTool === t.id
                ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/40 shadow-sm font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
            title={t.label}
          >
            {t.icon}
            {appDesignTheme === 'linear' && t.keyHint && (
              <span className="linear-kbd text-[8px]">{t.keyHint}</span>
            )}
          </button>
        ))}

        <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />

        {/* Inline Native Object Edit Mode Toggle */}
        <button
          type="button"
          aria-label="Sayfa İçi PDF Nesnelerini Taşıma Modu"
          aria-pressed={inlineNativeEdit}
          onClick={() => {
            const next = !inlineNativeEdit;
            toggleInlineNativeEdit();
            if (next) syncActiveTool('select');
          }}
          className={cn(
            'p-1.5 rounded-lg transition-colors flex items-center gap-1',
            inlineNativeEdit
              ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/40 font-semibold'
              : 'text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          )}
          title="Sayfa İçi PDF Metin ve Nesnelerini Taşı"
        >
          <Move className="w-4 h-4" />
          <span className="hidden xl:inline">Nesne Taşı</span>
        </button>

        <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />

        {/* Signature & Stamp & Image & Page Numbers */}
        <button
          type="button"
          aria-label="İmza Ekle"
          onClick={() => setSignatureModalOpen(true)}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="İmza Ekle"
        >
          <FileSignature className="w-4 h-4" />
          <span className="hidden xl:inline">İmza</span>
        </button>

        <button
          type="button"
          aria-label="Damga veya Kaşe Ekle"
          onClick={() => setStampModalOpen(true)}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="Damga / Kaşe Ekle"
        >
          <Stamp className="w-4 h-4" />
          <span className="hidden xl:inline">Damga</span>
        </button>

        <button
          type="button"
          aria-label="Resim Ekle"
          onClick={() => imageInputRef.current?.click()}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="Resim Ekle"
        >
          <ImageIcon className="w-4 h-4" />
          <span className="hidden xl:inline">Resim</span>
        </button>

        <button
          type="button"
          aria-label="Sayfa Numaralandırma"
          onClick={() => setPageNumberModalOpen(true)}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="Sayfa Numaralandırma"
        >
          <Hash className="w-4 h-4" />
          <span className="hidden xl:inline">Numaralandır</span>
        </button>

        <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />

        <button
          type="button"
          aria-label="Bölge OCR"
          onClick={() => setSnipOcrModalOpen(true)}
          className="p-1.5 rounded-lg text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 hover:bg-sky-100 dark:hover:bg-sky-900/60 border border-sky-300 dark:border-sky-800 transition-colors flex items-center gap-1.5 font-medium shadow-sm"
          title="Bölge OCR (Ekrandan seçilen alanı metne dönüştür)"
        >
          <Crosshair className="w-4 h-4 text-sky-500" />
          <span>Bölge OCR</span>
        </button>
      </div>

      {/* Contextual Styling & Selection Actions */}
      <div className="flex items-center gap-2 ml-2">
        {selectedAnnotationId && activePageId && (
          <div className="flex items-center gap-1 bg-sky-50 dark:bg-sky-950/40 px-2 py-0.5 rounded-lg border border-sky-200 dark:border-sky-800/60 animate-in fade-in duration-100">
            <span className="text-[11px] font-semibold text-sky-700 dark:text-sky-300 mr-1 hidden md:inline">Seçili:</span>
            <button
              type="button"
              aria-label="Seçili Öğeyi Klonla"
              onClick={() => cloneAnnotation(activePageId, selectedAnnotationId)}
              className="flex items-center gap-1 px-1.5 py-1 hover:bg-sky-100 dark:hover:bg-sky-900 rounded text-sky-700 dark:text-sky-300 font-medium text-xs transition-colors"
              title="Nesneyi Klonla / Çoğalt (Ctrl+D)"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Klonla</span>
            </button>
            <button
              type="button"
              aria-label="Seçili Öğeyi Sil"
              onClick={() => deleteAnnotation(activePageId, selectedAnnotationId)}
              className="flex items-center gap-1 px-1.5 py-1 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded text-rose-600 dark:text-rose-400 font-medium text-xs transition-colors"
              title="Nesneyi Kaldır / Sil (Delete)"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Sil</span>
            </button>
          </div>
        )}

        {/* Colors Palette */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700/80">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Renk ${c}`}
              aria-pressed={currentColor === c}
              onClick={() => applyColorStyle(c)}
              style={{ backgroundColor: c }}
              className={cn(
                'w-4 h-4 rounded-full transition-transform border border-slate-300 dark:border-transparent',
                currentColor === c ? 'scale-125 ring-2 ring-sky-500 ring-offset-1 ring-offset-white dark:ring-offset-slate-900' : 'hover:scale-110'
              )}
            />
          ))}
        </div>

        {/* Stroke / Size Slider */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
          <span>Kalınlık</span>
          <input
            type="range"
            aria-label="Çizgi Kalınlığı"
            min="1"
            max="20"
            value={toolStyles.strokeWidth}
            onChange={(e) => applyStrokeWidth(parseInt(e.target.value, 10))}
            className="w-14 accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded cursor-pointer"
          />
        </div>

        {/* Opacity Slider */}
        <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
          <span>Opaklık</span>
          <input
            type="range"
            aria-label="Öğe Opaklığı"
            min="0.1"
            max="1"
            step="0.05"
            value={currentOpacity}
            onChange={(e) => applyOpacity(parseFloat(e.target.value))}
            className="w-12 accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded cursor-pointer"
          />
        </div>

        {/* Text Styling (active text-add tool OR selected TextAnnotation) */}
        {showTextControls && (
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/80">
            <select
              aria-label="Yazı Tipi"
              value={currentFontFamily}
              onChange={(e) => applyTextPatch({ fontFamily: e.target.value })}
              className="bg-white dark:bg-slate-800 text-[11px] text-slate-800 dark:text-slate-200 rounded px-1 py-0.5 border border-slate-200 dark:border-transparent focus:outline-none"
            >
              {FONT_FAMILIES.map((ff) => (
                <option key={ff.value} value={ff.value}>
                  {ff.label}
                </option>
              ))}
            </select>

            <select
              aria-label="Yazı Boyutu"
              value={currentFontSize}
              onChange={(e) => applyTextPatch({ fontSize: parseInt(e.target.value, 10) })}
              className="bg-white dark:bg-slate-800 text-[11px] text-slate-800 dark:text-slate-200 rounded px-1.5 py-0.5 border border-slate-200 dark:border-transparent focus:outline-none"
            >
              <option value="12">12 px</option>
              <option value="14">14 px</option>
              <option value="16">16 px</option>
              <option value="20">20 px</option>
              <option value="24">24 px</option>
              <option value="32">32 px</option>
            </select>

            <button
              type="button"
              aria-label="Kalın Yazı"
              aria-pressed={currentIsBold}
              onClick={() => applyTextPatch({ isBold: !currentIsBold })}
              className={cn(
                'p-1 rounded text-xs',
                currentIsBold ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'text-slate-600 dark:text-slate-400'
              )}
              title="Kalın"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="İtalik Yazı"
              aria-pressed={currentIsItalic}
              onClick={() => applyTextPatch({ isItalic: !currentIsItalic })}
              className={cn(
                'p-1 rounded text-xs',
                currentIsItalic ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 italic' : 'text-slate-600 dark:text-slate-400'
              )}
              title="İtalik"
            >
              <Italic className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
