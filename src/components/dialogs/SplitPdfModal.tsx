import React, { useState, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfAssembler } from '@/core/engine/pdf-assembler';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import {
  X,
  Scissors,
  Download,
  Split,
  FileText,
  Layers,
  CheckSquare,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  parseSplitRanges,
  readAuthorizedDocBuffer,
  saveBinaryOrBlobFile,
  useModalEscape,
} from './modal-utils';

export const SplitPdfModal: React.FC = () => {
  const { currentDocument } = useDocumentStore();
  const { isSplitModalOpen, setSplitModalOpen, addToast } = useUIStore();

  const [splitMode, setSplitMode] = useState<'range' | 'all-single' | 'odd-even' | 'selected'>('range');
  const [rangeInput, setRangeInput] = useState('1-5, 6-10');
  const [isProcessing, setIsProcessing] = useState(false);

  const totalPages = currentDocument?.totalPages || 0;
  const selectedCount = currentDocument?.selectedPageIds.length || 0;

  const docId = currentDocument?.id;

  useEffect(() => {
    if (!isSplitModalOpen || !docId) return;
    const doc = useDocumentStore.getState().currentDocument;
    if (!doc) return;
    setRangeInput(doc.totalPages > 1 ? `1-${Math.ceil(doc.totalPages / 2)}` : '1');
    setSplitMode((prev) => (prev === 'selected' && doc.selectedPageIds.length === 0 ? 'range' : prev));
  }, [isSplitModalOpen, docId]);

  useModalEscape(isSplitModalOpen, () => setSplitModalOpen(false), isProcessing);

  const rangeValidation = useMemo(() => {
    if (!currentDocument || splitMode !== 'range') {
      return { ranges: [] as { from: number; to: number }[], isValid: true, error: undefined as string | undefined };
    }
    return parseSplitRanges(rangeInput, totalPages);
  }, [currentDocument, splitMode, rangeInput, totalPages]);

  if (!isSplitModalOpen || !currentDocument) return null;

  const handleSplit = async () => {
    try {
      setIsProcessing(true);
      addToast('PDF bölünüyor...', 'info');

      const baseName = currentDocument.name.replace(/\.pdf$/i, '');

      // Honor in-memory modifications (rotations, reorder, annotations) when document is dirty
      const workingBuffer = currentDocument.isModified
        ? await PdfExporter.exportDocumentWithAnnotations(currentDocument)
        : await readAuthorizedDocBuffer(currentDocument.id, currentDocument.filePath);

      if (splitMode === 'selected') {
        if (selectedCount === 0) {
          addToast('Seçili sayfa bulunmuyor.', 'warning');
          return;
        }
        const selectedNumbers = currentDocument.pages
          .map((p, idx) => (currentDocument.selectedPageIds.includes(p.id) ? idx + 1 : -1))
          .filter((n) => n !== -1);

        const srcDoc = await PDFDocument.load(workingBuffer.slice(0));
        const outDoc = await PDFDocument.create();
        const copied = await outDoc.copyPages(
          srcDoc,
          selectedNumbers.map((n) => n - 1)
        );
        copied.forEach((p) => outDoc.addPage(p));
        const bytes = await outDoc.save();
        const defaultName = `${baseName}_secili_${selectedNumbers.length}_sayfa.pdf`;

        const saveRes = await saveBinaryOrBlobFile({
          data: bytes,
          defaultName,
          dialogTitle: 'Seçili Sayfaları Kaydet',
          filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
          mimeType: 'application/pdf',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }

        addToast(`${selectedNumbers.length} seçili sayfa PDF olarak kaydedildi!`, 'success');
        setSplitModalOpen(false);
        return;
      }

      let results: { name: string; buffer: ArrayBuffer }[] = [];

      if (splitMode === 'odd-even') {
        const srcDoc = await PDFDocument.load(workingBuffer.slice(0));
        const oddIndices = srcDoc.getPageIndices().filter((i) => i % 2 === 0);
        const evenIndices = srcDoc.getPageIndices().filter((i) => i % 2 === 1);

        if (oddIndices.length > 0) {
          const oddDoc = await PDFDocument.create();
          const oddPages = await oddDoc.copyPages(srcDoc, oddIndices);
          oddPages.forEach((p) => oddDoc.addPage(p));
          const bytes = await oddDoc.save();
          results.push({
            name: `${baseName}_Tek_Sayfalar.pdf`,
            buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          });
        }

        if (evenIndices.length > 0) {
          const evenDoc = await PDFDocument.create();
          const evenPages = await evenDoc.copyPages(srcDoc, evenIndices);
          evenPages.forEach((p) => evenDoc.addPage(p));
          const bytes = await evenDoc.save();
          results.push({
            name: `${baseName}_Cift_Sayfalar.pdf`,
            buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
          });
        }
      } else {
        let rangesToSplit: { from: number; to: number; label?: string }[] = [];

        if (splitMode === 'range') {
          if (!rangeValidation.isValid || rangeValidation.ranges.length === 0) {
            addToast(rangeValidation.error || 'Geçerli bir sayfa aralığı girin.', 'warning');
            return;
          }
          rangesToSplit = rangeValidation.ranges;
        } else {
          for (let i = 1; i <= totalPages; i++) {
            rangesToSplit.push({ from: i, to: i, label: `Sayfa_${i}` });
          }
        }

        results = await PdfAssembler.splitPdf(workingBuffer.slice(0), currentDocument.name, rangesToSplit);
      }

      if (results.length === 0) {
        addToast('Bölünecek geçerli sayfa bulunamadı.', 'warning');
        return;
      }

      if (results.length === 1) {
        const saveRes = await saveBinaryOrBlobFile({
          data: results[0].buffer,
          defaultName: results[0].name,
          dialogTitle: 'Bölünen PDF Dosyasını Kaydet',
          filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
          mimeType: 'application/pdf',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }
        addToast(`${results[0].name} başarıyla kaydedildi!`, 'success');
      } else {
        // Bundle multiple split PDFs into a single clean ZIP archive
        const zip = new JSZip();
        results.forEach((res) => {
          zip.file(res.name, res.buffer);
        });
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const zipName = `${baseName}_bolunmus_${results.length}_parca.zip`;

        const saveRes = await saveBinaryOrBlobFile({
          data: zipBlob,
          defaultName: zipName,
          dialogTitle: 'Bölünen PDF Parçalarını ZIP Olarak Kaydet',
          filters: [{ name: 'ZIP Arşivi', extensions: ['zip'] }],
          mimeType: 'application/zip',
        });

        if (saveRes.status === 'canceled') {
          addToast('Kaydetme iptal edildi.', 'info');
          return;
        }
        addToast(`${results.length} adet PDF parçası ZIP arşivi olarak kaydedildi!`, 'success');
      }

      setSplitModalOpen(false);
    } catch (err: unknown) {
      console.error('Split error:', err);
      const msg = err instanceof Error ? err.message : 'Bölme sırasında hata oluştu.';
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const canSubmit =
    !isProcessing &&
    (splitMode !== 'range' || rangeValidation.isValid) &&
    (splitMode !== 'selected' || selectedCount > 0);

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => !isProcessing && setSplitModalOpen(false)}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500 dark:text-rose-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                PDF Bölme & Sayfa Ayırma (Split)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Dökümanı istediğiniz sayfa aralıklarına göre parçalayın
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isProcessing && setSplitModalOpen(false)}
            disabled={isProcessing}
            aria-label="Kapat"
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-sm">
          {currentDocument.isModified && (
            <div className="p-2.5 rounded-xl bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800/60 flex items-center gap-2 text-[11px] text-sky-700 dark:text-sky-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                Belgedeki kaydedilmemiş düzenlemeler (döndürme, sıralama, notlar) bölme çıktısına yansıtılacaktır.
              </span>
            </div>
          )}

          {/* Mode Selector (4 modes) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              type="button"
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
              type="button"
              onClick={() => setSplitMode('all-single')}
              className={cn(
                'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                splitMode === 'all-single'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              )}
            >
              <FileText className="w-4 h-4" />
              <span className="text-xs">Her Sayfa (ZIP)</span>
            </button>

            <button
              type="button"
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

            <button
              type="button"
              onClick={() => setSplitMode('selected')}
              disabled={selectedCount === 0}
              className={cn(
                'p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5',
                splitMode === 'selected'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-300 font-semibold'
                  : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200',
                selectedCount === 0 && 'opacity-40 cursor-not-allowed'
              )}
            >
              <CheckSquare className="w-4 h-4" />
              <span className="text-xs">Seçili ({selectedCount})</span>
            </button>
          </div>

          {splitMode === 'range' && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Sayfa Aralıkları (Toplam {totalPages} sayfa)
                </label>
                {rangeValidation.isValid ? (
                  <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400">
                    {rangeValidation.ranges.length} parça
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-rose-500">Geçersiz aralık</span>
                )}
              </div>
              <input
                type="text"
                value={rangeInput}
                onChange={(e) => setRangeInput(e.target.value)}
                placeholder="Örn: 1-5, 6-10, 15"
                className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 text-xs focus:outline-none focus:border-sky-500 font-mono"
              />
              {!rangeValidation.isValid && rangeValidation.error ? (
                <p className="text-[11px] text-rose-500">{rangeValidation.error}</p>
              ) : (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Virgülle ayırarak birden fazla aralık belirtebilirsiniz. Birden fazla parça ZIP olarak kaydedilir.
                </p>
              )}
            </div>
          )}

          {splitMode === 'all-single' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
              Bu dökümandaki <strong>{totalPages} sayfanın her biri</strong> ayrı birer PDF dosyası yapılıp tek bir ZIP arşivi olarak kaydedilecektir.
            </div>
          )}

          {splitMode === 'odd-even' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
              Döküman iki ayrı PDF&apos;e bölünüp ZIP arşivi (veya tek dosya) olarak kaydedilecektir:
              <ul className="list-disc list-inside mt-1 text-slate-500 dark:text-slate-400 space-y-0.5">
                <li>1, 3, 5, 7... sayfalar (Tek Sayfalar PDF&apos;i)</li>
                <li>2, 4, 6, 8... sayfalar (Çift Sayfalar PDF&apos;i)</li>
              </ul>
            </div>
          )}

          {splitMode === 'selected' && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300">
              Seçili <strong>{selectedCount} sayfa</strong> ayrı bir PDF dosyası olarak kaydedilecektir.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setSplitModalOpen(false)}
            disabled={isProcessing}
            className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-40"
          >
            İptal
          </button>
          <button
            type="button"
            onClick={handleSplit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:opacity-40 text-xs font-semibold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-rose-600/20"
          >
            <Download className="w-4 h-4" />
            {isProcessing ? 'Bölünüyor...' : 'Böl ve Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
};
