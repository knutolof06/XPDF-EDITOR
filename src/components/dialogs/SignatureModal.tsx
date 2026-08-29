import React, { useRef, useState, useEffect } from 'react';
import { useAnnotationStore } from '@/store/annotation-store';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import {
  X,
  FileSignature,
  PenTool,
  Type,
  Upload,
  RotateCcw,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const SignatureModal: React.FC = () => {
  const { isSignatureModalOpen, setSignatureModalOpen, addToast } = useUIStore();
  const { addAnnotation, setSelectedAnnotationId, setActiveTool } = useAnnotationStore();
  const { currentDocument } = useDocumentStore();

  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [typedName, setTypedName] = useState('Ahmet Yılmaz');
  const [typedColor, setTypedColor] = useState('#0f172a');
  const [isDrawing, setIsDrawing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isSignatureModalOpen && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [isSignatureModalOpen, tab]);

  if (!isSignatureModalOpen || !currentDocument) return null;

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const insertSignature = (dataUrl: string) => {
    const pageId = currentDocument.activePageId || currentDocument.pages[0].id;
    const newSignatureAnn = {
      id: 'sig_' + Date.now(),
      pageId,
      type: 'signature' as const,
      x: 100,
      y: 100,
      width: 160,
      height: 70,
      dataUrl,
    };

    addAnnotation(pageId, newSignatureAnn);
    setSelectedAnnotationId(newSignatureAnn.id);
    setActiveTool('select');
    addToast('İmza dökümana eklendi. Taşıyabilir veya boyutlandırabilirsiniz.', 'success');
    setSignatureModalOpen(false);
  };

  const handleApply = () => {
    if (tab === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      insertSignature(dataUrl);
    } else if (tab === 'type') {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 400;
      tempCanvas.height = 150;
      const ctx = tempCanvas.getContext('2d');
      if (ctx) {
        ctx.font = 'italic bold 42px "Brush Script MT", cursive, sans-serif';
        ctx.fillStyle = typedColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(typedName, 200, 75);
        insertSignature(tempCanvas.toDataURL('image/png'));
      }
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      insertSignature(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <input
        type="file"
        ref={uploadInputRef}
        onChange={handleImageUpload}
        accept="image/*"
        className="hidden"
      />

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <FileSignature className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">İmza Ekle</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Çizin, metin olarak yazın veya imza görseli yükleyin</p>
            </div>
          </div>
          <button
            onClick={() => setSignatureModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 pt-3 gap-2 bg-slate-50/50 dark:bg-slate-900">
          <button
            onClick={() => setTab('draw')}
            className={cn(
              'pb-2.5 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors',
              tab === 'draw'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <PenTool className="w-3.5 h-3.5" />
            Çiz
          </button>
          <button
            onClick={() => setTab('type')}
            className={cn(
              'pb-2.5 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors',
              tab === 'type'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <Type className="w-3.5 h-3.5" />
            Yaz
          </button>
          <button
            onClick={() => {
              setTab('upload');
              uploadInputRef.current?.click();
            }}
            className={cn(
              'pb-2.5 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-colors',
              tab === 'upload'
                ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            )}
          >
            <Upload className="w-3.5 h-3.5" />
            Resim Yükle
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-6">
          {tab === 'draw' && (
            <div className="space-y-3">
              <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white rounded-xl overflow-hidden cursor-crosshair shadow-inner">
                <canvas
                  ref={canvasRef}
                  width={440}
                  height={180}
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  className="w-full h-[180px] block"
                />
                <button
                  onClick={clearCanvas}
                  className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-[11px] font-semibold text-white flex items-center gap-1 shadow"
                >
                  <RotateCcw className="w-3 h-3" />
                  Temizle
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Mouse veya dokunmatik kalem ile beyaz alana imzanızı çizin.</p>
            </div>
          )}

          {tab === 'type' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">Adınız / Soyadınız</label>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Signature Preview */}
              <div className="p-6 bg-slate-50 dark:bg-white rounded-xl flex items-center justify-center min-h-[120px] shadow-inner border border-slate-200 dark:border-transparent">
                <span
                  style={{ color: typedColor }}
                  className="text-4xl italic font-serif tracking-wide"
                >
                  {typedName || 'İmza Önizleme'}
                </span>
              </div>

              {/* Color options */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">İmza Rengi:</span>
                {['#0f172a', '#1e3a8a', '#0284c7'].map((c) => (
                  <button
                    key={c}
                    onClick={() => setTypedColor(c)}
                    style={{ backgroundColor: c }}
                    className={cn(
                      'w-5 h-5 rounded-full transition-transform',
                      typedColor === c ? 'scale-125 ring-2 ring-sky-400' : ''
                    )}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={() => setSignatureModalOpen(false)}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleApply}
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
          >
            <CheckCircle2 className="w-4 h-4" />
            İmzayı Ekle
          </button>
        </div>
      </div>
    </div>
  );
};
