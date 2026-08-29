import React from 'react';
import { useAnnotationStore } from '@/store/annotation-store';
import { useUIStore } from '@/store/ui-store';
import { ActiveTool } from '@/types/viewer';
import {
  MousePointer,
  Type,
  Pen,
  Highlighter,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  FileSignature,
  Stamp,
  Image as ImageIcon,
  Hash,
  Bold,
  Italic,
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

export const EditorToolbar: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    toolStyles,
    setToolStyles,
  } = useAnnotationStore();

  const {
    setSignatureModalOpen,
    setStampModalOpen,
    setPageNumberModalOpen,
  } = useUIStore();

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const { addAnnotation, setSelectedAnnotationId } = useAnnotationStore.getState();
      const { currentDocument } = (window as any).__docStore?.getState?.() || {};

      const pageId = currentDocument?.activePageId || currentDocument?.pages?.[0]?.id;
      if (pageId) {
        const newImgAnn = {
          id: 'img_' + Date.now(),
          pageId,
          type: 'image' as const,
          x: 100,
          y: 100,
          width: 200,
          height: 150,
          dataUrl,
        };
        addAnnotation(pageId, newImgAnn);
        setSelectedAnnotationId(newImgAnn.id);
        setActiveTool('select');
      }
    };
    reader.readAsDataURL(file);
  };

  const imageInputRef = React.useRef<HTMLInputElement>(null);

  const tools: { id: ActiveTool; label: string; icon: React.ReactNode }[] = [
    { id: 'select', label: 'Seç / Taşı (V)', icon: <MousePointer className="w-4 h-4" /> },
    { id: 'text-add', label: 'Metin Ekle (T)', icon: <Type className="w-4 h-4" /> },
    { id: 'draw', label: 'Çizim Kalemi (P)', icon: <Pen className="w-4 h-4" /> },
    { id: 'highlight', label: 'Fosforlu Kalem (H)', icon: <Highlighter className="w-4 h-4" /> },
    { id: 'rect', label: 'Dikdörtgen', icon: <Square className="w-4 h-4" /> },
    { id: 'circle', label: 'Daire', icon: <Circle className="w-4 h-4" /> },
    { id: 'line', label: 'Çizgi', icon: <Minus className="w-4 h-4" /> },
    { id: 'arrow', label: 'Ok', icon: <ArrowUpRight className="w-4 h-4" /> },
  ];

  return (
    <div className="h-11 bg-white dark:bg-slate-900/90 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between text-xs text-slate-700 dark:text-slate-200 select-none z-20 shrink-0 backdrop-blur-sm overflow-x-auto shadow-sm transition-colors">
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
            onClick={() => setActiveTool(t.id)}
            className={cn(
              'p-1.5 rounded-lg transition-colors flex items-center gap-1',
              activeTool === t.id
                ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/40 shadow-sm font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            )}
            title={t.label}
          >
            {t.icon}
          </button>
        ))}

        <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-800 mx-1" />

        {/* Signature & Stamp & Image & Page Numbers */}
        <button
          onClick={() => setSignatureModalOpen(true)}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="İmza Ekle"
        >
          <FileSignature className="w-4 h-4" />
          <span className="hidden xl:inline">İmza</span>
        </button>

        <button
          onClick={() => setStampModalOpen(true)}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="Damga / Stamp Ekle"
        >
          <Stamp className="w-4 h-4" />
          <span className="hidden xl:inline">Damga</span>
        </button>

        <button
          onClick={() => imageInputRef.current?.click()}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="Resim Ekle"
        >
          <ImageIcon className="w-4 h-4" />
          <span className="hidden xl:inline">Resim</span>
        </button>

        <button
          onClick={() => setPageNumberModalOpen(true)}
          className="p-1.5 rounded-lg text-slate-600 dark:text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1"
          title="Sayfa Numaralandırma & Header/Footer"
        >
          <Hash className="w-4 h-4" />
          <span className="hidden xl:inline">Numaralandır</span>
        </button>
      </div>

      {/* Contextual Styling Palette */}
      <div className="flex items-center gap-2">
        {/* Colors Palette */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg border border-slate-200 dark:border-slate-700/80">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setToolStyles({ color: c })}
              style={{ backgroundColor: c }}
              className={cn(
                'w-4 h-4 rounded-full transition-transform border border-slate-300 dark:border-transparent',
                toolStyles.color === c ? 'scale-125 ring-2 ring-sky-500 ring-offset-1 ring-offset-white dark:ring-offset-slate-900' : 'hover:scale-110'
              )}
            />
          ))}
        </div>

        {/* Stroke / Size Slider */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
          <span>Kalınlık</span>
          <input
            type="range"
            min="1"
            max="20"
            value={toolStyles.strokeWidth}
            onChange={(e) => setToolStyles({ strokeWidth: parseInt(e.target.value, 10) })}
            className="w-16 accent-sky-500 h-1 bg-slate-300 dark:bg-slate-700 rounded cursor-pointer"
          />
        </div>

        {/* Text Styling (if text active) */}
        {activeTool === 'text-add' && (
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/80">
            <select
              value={toolStyles.fontSize}
              onChange={(e) => setToolStyles({ fontSize: parseInt(e.target.value, 10) })}
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
              onClick={() => setToolStyles({ isBold: !toolStyles.isBold })}
              className={cn(
                'p-1 rounded text-xs',
                toolStyles.isBold ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'text-slate-600 dark:text-slate-400'
              )}
              title="Kalın"
            >
              <Bold className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setToolStyles({ isItalic: !toolStyles.isItalic })}
              className={cn(
                'p-1 rounded text-xs',
                toolStyles.isItalic ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 italic' : 'text-slate-600 dark:text-slate-400'
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
