import React, { useState } from 'react';
import { useAnnotationStore } from '@/store/annotation-store';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { X, Stamp, CheckCircle2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { markCurrentDocumentModified, useModalEscape } from './modal-utils';

interface StampPreset {
  id: string;
  text: string;
  color: string;
  borderColor: string;
}

const PRESET_STAMPS: StampPreset[] = [
  { id: 'approved', text: 'ONAYLANDI (APPROVED)', color: '#16a34a', borderColor: '#16a34a' },
  { id: 'rejected', text: 'REDDEDİLDİ (REJECTED)', color: '#dc2626', borderColor: '#dc2626' },
  { id: 'confidential', text: 'GİZLİDİR (CONFIDENTIAL)', color: '#dc2626', borderColor: '#dc2626' },
  { id: 'draft', text: 'TASLAK (DRAFT)', color: '#ea580c', borderColor: '#ea580c' },
  { id: 'important', text: 'ÖNEMLİ (IMPORTANT)', color: '#0284c7', borderColor: '#0284c7' },
  { id: 'copy', text: 'KOPYADIR (COPY)', color: '#64748b', borderColor: '#64748b' },
];

export const StampModal: React.FC = () => {
  const { isStampModalOpen, setStampModalOpen, addToast } = useUIStore();
  const { addAnnotation, setSelectedAnnotationId, setActiveTool } = useAnnotationStore();
  const { currentDocument } = useDocumentStore();

  const [selectedStamp, setSelectedStamp] = useState<StampPreset>(PRESET_STAMPS[0]);
  const [customText, setCustomText] = useState('');

  useModalEscape(isStampModalOpen, () => setStampModalOpen(false));

  if (!isStampModalOpen || !currentDocument) return null;

  const createStampImage = (
    text: string,
    color: string
  ): { dataUrl: string; canvasWidth: number; canvasHeight: number } | null => {
    const upper = text.toLocaleUpperCase('tr-TR');
    const measureCanvas = document.createElement('canvas');
    const measureCtx = measureCanvas.getContext('2d');
    if (!measureCtx) return null;

    const font = '900 22px system-ui, -apple-system, sans-serif';
    measureCtx.font = font;
    const textWidth = measureCtx.measureText(upper).width;

    const canvasWidth = Math.max(320, Math.min(720, Math.ceil(textWidth + 88)));
    const canvasHeight = 110;

    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    ctx.translate(cx, cy);
    ctx.rotate((-6 * Math.PI) / 180);
    ctx.translate(-cx, -cy);

    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.strokeRect(12, 14, canvasWidth - 24, canvasHeight - 28);

    ctx.lineWidth = 1.5;
    ctx.strokeRect(18, 20, canvasWidth - 36, canvasHeight - 40);

    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(upper, cx, cy);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      canvasWidth,
      canvasHeight,
    };
  };

  const handleApply = () => {
    const text = customText.trim() || selectedStamp.text;
    const color = customText.trim() ? '#0284c7' : selectedStamp.color;
    const stampAsset = createStampImage(text, color);

    if (!stampAsset || !stampAsset.dataUrl) {
      addToast('Damga görseli oluşturulamadı.', 'error');
      return;
    }

    const activePage =
      currentDocument.pages[currentDocument.activePageIndex] || currentDocument.pages[0];
    const pageId = currentDocument.activePageId || activePage.id;

    const annHeight = 60;
    const annWidth = Math.min(
      Math.max(160, Math.round((stampAsset.canvasWidth / stampAsset.canvasHeight) * annHeight)),
      Math.max(160, activePage.width - 40)
    );
    const x = Math.max(20, Math.round((activePage.width - annWidth) / 2));
    const y = Math.max(20, Math.round((activePage.height - annHeight) / 2));

    const stampAnn = {
      id: 'stamp_' + Date.now(),
      pageId,
      type: 'stamp' as const,
      x,
      y,
      width: annWidth,
      height: annHeight,
      dataUrl: stampAsset.dataUrl,
      label: text,
      opacity: 0.85,
    };

    addAnnotation(pageId, stampAnn);
    setSelectedAnnotationId(stampAnn.id);
    setActiveTool('select');
    markCurrentDocumentModified();
    addToast('Damga sayfaya eklendi!', 'success');
    setStampModalOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => setStampModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <Stamp className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">Damga / Stamp Ekle</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Hazır resmi damgalardan seçin veya özel damga yazın
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setStampModalOpen(false)}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block mb-2">
              Hazır Damgalar
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {PRESET_STAMPS.map((stamp) => (
                <button
                  key={stamp.id}
                  type="button"
                  onClick={() => {
                    setSelectedStamp(stamp);
                    setCustomText('');
                  }}
                  className={cn(
                    'p-3 rounded-xl border text-center font-black tracking-wider text-xs transition-all',
                    selectedStamp.id === stamp.id && !customText
                      ? 'border-sky-500 bg-sky-50 dark:bg-slate-800 ring-2 ring-sky-400/30'
                      : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800'
                  )}
                  style={{ color: stamp.color }}
                >
                  {stamp.text}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
              Veya Özel Damga Metni Yazın
            </label>
            <input
              type="text"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Örn: MÜŞTERİ NÜSHASI, KONTROL EDİLDİ"
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:border-sky-500 uppercase"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setStampModalOpen(false)}
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
            Damgayı Uygula
          </button>
        </div>
      </div>
    </div>
  );
};
