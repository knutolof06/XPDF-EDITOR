import React, { useState } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { binaryStore } from '@/core/storage/binary-store';
import {
  X,
  Scissors,
  Download,
  Split,
  FileText,
  Layers,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const SplitPdfModal: React.FC = () => {
  const { currentDocument } = useDocumentStore();
  const { isSplitModalOpen, setSplitModalOpen, addToast } = useUIStore();

  const [splitMode, setSplitMode] = useState<'range' | 'all-single' | 'odd-even' | 'selected'>('range');
  const [rangeInput, setRangeInput] = useState('1-5, 6-10');
  const [isProcessing, setIsProcessing] = useState(false);

  if (!isSplitModalOpen || !currentDocument) return null;

  const totalPages = currentDocument.totalPages;

  const handleSplit = async () => {
    const rawBuffer = binaryStore.get(currentDocument.id);
    if (!rawBuffer) {
      addToast('Döküman verisi bulunamadı.', 'error');
      return;
    }

    try {
      setIsProcessing(true);
      addToast('PDF bölünüyor...', 'info');

      let rangesToSplit: { from: number; to: number; label?: string }[] = [];

      if (splitMode === 'range') {
        const parts = rangeInput.split(',').map((p) => p.trim()).filter(Boolean);
        for (const part of parts) {
          if (part.includes('-')) {
            const [startStr, endStr] = part.split('-').map((s) => s.trim());
            const from = parseInt(startStr, 10);
            const to = parseInt(endStr, 10);
            if (!isNaN(from) && !isNaN(to)) {
              rangesToSplit.push({ from, to });
            }
          } else {
            const single = parseInt(part, 10);
            if (!isNaN(single)) {
              rangesToSplit.push({ from: single, to: single });
            }
          }
        }
      } else if (splitMode === 'all-single') {
        for (let i = 1; i <= totalPages; i++) {
          rangesToSplit.push({ from: i, to: i, label: `Sayfa_${i}` });
        }
      } else if (splitMode === 'odd-even') {
        addToast('Tek ve Çift sayfalar ayrılıyor...', 'info');
        const { PDFDocument } = await import('pdf-lib');
        const srcDoc = await PDFDocument.load(rawBuffer.slice(0));

        const oddIndices = srcDoc.getPageIndices().filter((i) => i % 2 === 0);
        const evenIndices = srcDoc.getPageIndices().filter((i) => i % 2 === 1);

        const oddDoc = await PDFDocument.create();
        const oddPages = await oddDoc.copyPages(srcDoc, oddIndices);
        oddPages.forEach((p) => oddDoc.addPage(p));

        const evenDoc = await PDFDocument.create();
        const evenPages = await evenDoc.copyPages(srcDoc, evenIndices);
        evenPages.forEach((p) => evenDoc.addPage(p));

        const downloadBlob = (bytes: Uint8Array, suffix: string) => {
          const raw = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          const blob = new Blob([raw], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_${suffix}.pdf`;
          a.click();
          URL.revokeObjectURL(url);
        };

        if (oddIndices.length > 0) downloadBlob(await oddDoc.save(), 'Tek_Sayfalar');
        if (evenIndices.length > 0) downloadBlob(await evenDoc.save(), 'Cift_Sayfalar');

        addToast('Tek ve Çift sayfalar başarıyla indirildi!', 'success');
        setSplitModalOpen(false);
        setIsProcessing(false);
        return;
      }

      if (rangesToSplit.length === 0) {
        addToast('Geçerli bir sayfa aralığı girin.', 'warning');
        setIsProcessing(false);
        return;
      }

      const results = await PdfAssembler.splitPdf(rawBuffer.slice(0), currentDocument.name, rangesToSplit);

      results.forEach((res) => {
        const blob = new Blob([res.buffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.name;
        a.click();
        URL.revokeObjectURL(url);
      });

      addToast(`${results.length} adet PDF parçası başarıyla oluşturuldu ve indirildi!`, 'success');
      setSplitModalOpen(false);
    } catch (err: any) {
      console.error('Split error:', err);
      addToast(err?.message || 'Bölme sırasında hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 dark:text-rose-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">PDF Bölme & Sayfa Ayırma (Split)</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Dökümanı istediğiniz sayfa aralıklarına göre parçalayın</p>
            </div>
          </div>
          <button
            onClick={() => setSplitModalOpen(false)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          {/* Mode Selector */}
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setSplitMode('range')}
              className={cn(
                'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                splitMode === 'range'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
            >
              <Split className="w-4 h-4" />
              <span className="text-xs">Özel Aralıklar</span>
            </button>

            <button
              onClick={() => setSplitMode('all-single')}
              className={cn(
                'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                splitMode === 'all-single'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
            >
              <FileText className="w-4 h-4" />
              <span className="text-xs">Her Sayfa Ayrı</span>
            </button>

            <button
              onClick={() => setSplitMode('odd-even')}
              className={cn(
                'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                splitMode === 'odd-even'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
            >
              <Layers className="w-4 h-4" />
              <span className="text-xs">Tek / Çift</span>
            </button>
          </div>

          {/* Mode Specific Inputs */}
          {splitMode === 'range' && (
            <div className="space-y-2 pt-2">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                Sayfa Aralıkları (Toplam {totalPages} sayfa)
              </label>
              <input
                type="text"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder="Örn: 1-5, 6-10, 15"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 text-xs focus:outline-none focus:border-sky-500 font-mono"
              />
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Virgülle ayırarak birden fazla aralık veya tek sayfa belirtebilirsiniz. Her aralık için ayrı bir PDF oluşturulacaktır.
              </p>
            </div>
          )}

          {splitMode === 'all-single' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
              Bu dökümandaki <strong>{totalPages} sayfanın her biri</strong> ayrı birer PDF dosyası olarak dışa aktarılacaktır.
            </div>
          )}

          {splitMode === 'odd-even' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
              Döküman iki ayrı PDF'e bölünecektir:
              <ul className="list-disc list-inside mt-1 text-slate-500 dark:text-slate-400 space-y-0.5">
                <li>1, 3, 5, 7... sayfalar (Tek Sayfalar PDF'i)</li>
                <li>2, 4, 6, 8... sayfalar (Çift Sayfalar PDF'i)</li>
              </ul>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={() => setSplitModalOpen(false)}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
          >
            İptal
          </button>
          <button
            onClick={handleSplit}
            disabled={isProcessing}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-rose-600/20"
          >
            <Download className="w-4 h-4" />
            {isProcessing ? 'Bölünüyor...' : 'Böl ve İndir'}
          </button>
        </div>
      </div>
    </div>
  );
};
