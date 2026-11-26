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
  Image as ImageIcon,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import { markCurrentDocumentModified, useModalEscape } from './modal-utils';

const SIGNATURE_FONT_STACK = '"Brush Script MT", "Segoe Script", "Lucida Handwriting", Georgia, cursive';

async function processUploadedSignature(
  dataUrl: string,
  removeWhiteBg: boolean
): Promise<string> {
  if (!removeWhiteBg) return dataUrl;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 400;
      canvas.height = img.naturalHeight || 150;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 230 && d[i + 1] > 230 && d[i + 2] > 230) {
          d[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export const SignatureModal: React.FC = () => {
  const { isSignatureModalOpen, setSignatureModalOpen, addToast } = useUIStore();
  const { addAnnotation, setSelectedAnnotationId, setActiveTool } = useAnnotationStore();
  const { currentDocument } = useDocumentStore();

  const [tab, setTab] = useState<'draw' | 'type' | 'upload'>('draw');
  const [drawColor, setDrawColor] = useState('#0f172a');
  const [hasDrawn, setHasDrawn] = useState(false);

  const [typedName, setTypedName] = useState('Ahmet Yılmaz');
  const [typedColor, setTypedColor] = useState('#0f172a');

  const [rawUploadedUrl, setRawUploadedUrl] = useState<string | null>(null);
  const [processedUploadedUrl, setProcessedUploadedUrl] = useState<string | null>(null);
  const [removeWhiteBg, setRemoveWhiteBg] = useState(true);

  const isDrawingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isSignatureModalOpen) return;
    setHasDrawn(false);
    isDrawingRef.current = false;
    setRawUploadedUrl(null);
    setProcessedUploadedUrl(null);
  }, [isSignatureModalOpen]);

  useEffect(() => {
    if (isSignatureModalOpen && tab === 'draw' && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = drawColor;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
      setHasDrawn(false);
    }
  }, [isSignatureModalOpen, tab, drawColor]);

  useEffect(() => {
    if (!rawUploadedUrl) {
      setProcessedUploadedUrl(null);
      return;
    }
    let cancelled = false;
    processUploadedSignature(rawUploadedUrl, removeWhiteBg).then((out) => {
      if (!cancelled) setProcessedUploadedUrl(out);
    });
    return () => {
      cancelled = true;
    };
  }, [rawUploadedUrl, removeWhiteBg]);

  useModalEscape(isSignatureModalOpen, () => setSignatureModalOpen(false));

  if (!isSignatureModalOpen || !currentDocument) return null;

  const getCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(1, rect.width);
    const scaleY = canvas.height / Math.max(1, rect.height);
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.setPointerCapture?.(e.pointerId);
    const pt = getCanvasPoint(e);
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x + 0.01, pt.y + 0.01);
    ctx.stroke();

    isDrawingRef.current = true;
    setHasDrawn(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pt = getCanvasPoint(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const stopDrawing = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (e && canvasRef.current?.hasPointerCapture?.(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId);
    }
    isDrawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    setHasDrawn(false);
  };

  const insertSignature = (dataUrl: string) => {
    const activePage =
      currentDocument.pages[currentDocument.activePageIndex] || currentDocument.pages[0];
    const pageId = currentDocument.activePageId || activePage.id;
    const sigWidth = 160;
    const sigHeight = 70;
    const x = Math.max(24, Math.round((activePage.width - sigWidth) / 2));
    const y = Math.max(24, Math.round((activePage.height - sigHeight) / 2));

    const newSignatureAnn = {
      id: 'sig_' + Date.now(),
      pageId,
      type: 'signature' as const,
      x,
      y,
      width: sigWidth,
      height: sigHeight,
      dataUrl,
    };

    addAnnotation(pageId, newSignatureAnn);
    setSelectedAnnotationId(newSignatureAnn.id);
    setActiveTool('select');
    markCurrentDocumentModified();
    addToast('İmza dökümana eklendi. Taşıyabilir veya boyutlandırabilirsiniz.', 'success');
    setSignatureModalOpen(false);
  };

  const handleApply = () => {
    if (tab === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas || !hasDrawn) {
        addToast('Lütfen önce imza alanına bir imza çizin.', 'warning');
        return;
      }
      insertSignature(canvas.toDataURL('image/png'));
    } else if (tab === 'type') {
      const trimmed = typedName.trim();
      if (!trimmed) {
        addToast('Lütfen imza metni girin.', 'warning');
        return;
      }
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = 480;
      tempCanvas.height = 160;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return;

      ctx.font = `italic bold 48px ${SIGNATURE_FONT_STACK}`;
      ctx.fillStyle = typedColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(trimmed, tempCanvas.width / 2, tempCanvas.height / 2);
      insertSignature(tempCanvas.toDataURL('image/png'));
    } else if (tab === 'upload') {
      if (!processedUploadedUrl) {
        addToast('Lütfen geçerli bir imza görseli yükleyin.', 'warning');
        return;
      }
      insertSignature(processedUploadedUrl);
    }
  };

  const loadImageFile = (file: File | undefined) => {
    if (!file) return;
    const valid =
      ['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
      /\.(png|jpe?g|webp)$/i.test(file.name);
    if (!valid) {
      addToast('Lütfen PNG, JPG veya WebP formatında bir görsel seçin.', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setRawUploadedUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    loadImageFile(file);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setSignatureModalOpen(false)}
    >
      <input
        type="file"
        ref={uploadInputRef}
        onChange={handleImageUpload}
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        className="hidden"
      />

      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <FileSignature className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">İmza Ekle</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Çizin, metin olarak yazın veya imza görseli yükleyin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setSignatureModalOpen(false)}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 px-6 pt-3 gap-2 bg-slate-50/50 dark:bg-slate-900">
          <button
            type="button"
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
            type="button"
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
            type="button"
            onClick={() => setTab('upload')}
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
        <div className="p-6 space-y-4">
          {tab === 'draw' && (
            <div className="space-y-3">
              <div className="relative border-2 border-dashed border-slate-300 dark:border-slate-700 bg-white rounded-xl overflow-hidden cursor-crosshair shadow-inner">
                <canvas
                  ref={canvasRef}
                  width={480}
                  height={190}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={stopDrawing}
                  onPointerCancel={stopDrawing}
                  className="w-full h-[180px] block touch-none"
                />
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="absolute bottom-2 right-2 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-900 text-[11px] font-semibold text-white flex items-center gap-1 shadow"
                >
                  <RotateCcw className="w-3 h-3" />
                  Temizle
                </button>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Fare, dokunmatik ekran veya kalem ile imzanızı çizin.
                </p>
                <div className="flex items-center gap-1.5">
                  {['#0f172a', '#1e3a8a', '#0284c7'].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDrawColor(c)}
                      style={{ backgroundColor: c }}
                      aria-label={`Kalem rengi ${c}`}
                      className={cn(
                        'w-4 h-4 rounded-full transition-transform',
                        drawColor === c ? 'scale-125 ring-2 ring-sky-400' : ''
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === 'type' && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-1.5">
                  Adınız / Soyadınız
                </label>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="p-6 bg-slate-50 dark:bg-white rounded-xl flex items-center justify-center min-h-[120px] shadow-inner border border-slate-200 dark:border-transparent">
                <span
                  style={{
                    color: typedColor,
                    fontFamily: SIGNATURE_FONT_STACK,
                    fontStyle: 'italic',
                    fontWeight: 700,
                  }}
                  className="text-4xl tracking-wide select-none"
                >
                  {typedName.trim() || 'İmza Önizleme'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 dark:text-slate-400">İmza Rengi:</span>
                {['#0f172a', '#1e3a8a', '#0284c7'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setTypedColor(c)}
                    style={{ backgroundColor: c }}
                    aria-label={`İmza rengi ${c}`}
                    className={cn(
                      'w-5 h-5 rounded-full transition-transform',
                      typedColor === c ? 'scale-125 ring-2 ring-sky-400' : ''
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          {tab === 'upload' && (
            <div className="space-y-3">
              {!processedUploadedUrl ? (
                <div
                  onClick={() => uploadInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    loadImageFile(e.dataTransfer.files?.[0]);
                  }}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-sky-500 rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer bg-slate-50 dark:bg-slate-800/40 transition-colors gap-2"
                >
                  <ImageIcon className="w-8 h-8 text-sky-500" />
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                    İmza görselini buraya sürükleyin veya seçin
                  </p>
                  <p className="text-[11px] text-slate-400">
                    PNG, JPG veya WebP desteklenir
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%,transparent_75%,#f1f5f9_75%,#f1f5f9),linear-gradient(45deg,#f1f5f9_25%,transparent_25%,transparent_75%,#f1f5f9_75%,#f1f5f9)] bg-[length:16px_16px] bg-[position:0_0,8px_8px] flex items-center justify-center min-h-[140px]">
                    <img
                      src={processedUploadedUrl}
                      alt="Yüklenen imza önizleme"
                      className="max-h-32 max-w-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <label className="flex items-center gap-2 cursor-pointer text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={removeWhiteBg}
                        onChange={(e) => setRemoveWhiteBg(e.target.checked)}
                        className="accent-sky-500 rounded"
                      />
                      <span>Beyaz arka planı şeffaf yap</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => uploadInputRef.current?.click()}
                        className="text-sky-600 dark:text-sky-400 font-semibold hover:underline"
                      >
                        Değiştir
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRawUploadedUrl(null);
                          setProcessedUploadedUrl(null);
                        }}
                        className="text-rose-500 font-semibold hover:underline"
                      >
                        Temizle
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            Not: Bu araç görsel imza ekler. PKCS#7 dijital sertifikaları doğrulamak için &quot;İmzaları İncele&quot; aracını kullanın.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setSignatureModalOpen(false)}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={
              (tab === 'draw' && !hasDrawn) ||
              (tab === 'type' && !typedName.trim()) ||
              (tab === 'upload' && !processedUploadedUrl)
            }
            className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
          >
            <CheckCircle2 className="w-4 h-4" />
            İmzayı Ekle
          </button>
        </div>
      </div>
    </div>
  );
};
