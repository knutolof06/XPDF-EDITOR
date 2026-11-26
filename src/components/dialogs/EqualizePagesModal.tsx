import React, { useState, useEffect } from 'react';
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { PdfExporter } from '@/core/engine/pdf-exporter';
import { X, ScanLine, Ruler, Download, CheckCircle2, ChevronRight } from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  readAuthorizedDocBuffer,
  saveBinaryOrBlobFile,
  useModalEscape,
} from './modal-utils';

const PT_TO_MM = 25.4 / 72;

interface SizeGroup {
  key: string;
  w: number;
  h: number;
  pages: number[];
  label: string;
}

type Step = 'range' | 'scan-result' | 'processing' | 'done';

function roundPt(v: number): number {
  return Math.round(v);
}
function ptToMm(v: number): string {
  return (v * PT_TO_MM).toFixed(1);
}
function sizeKey(w: number, h: number): string {
  return `${roundPt(w)}x${roundPt(h)}`;
}

const KNOWN: { name: string; w: number; h: number }[] = [
  { name: 'A3', w: 841.89, h: 1190.55 },
  { name: 'A4', w: 595.28, h: 841.89 },
  { name: 'A5', w: 419.53, h: 595.28 },
  { name: 'Letter', w: 612, h: 792 },
  { name: 'Legal', w: 612, h: 1008 },
];

function matchKnown(w: number, h: number): string | null {
  for (const s of KNOWN) {
    if (Math.abs(s.w - w) < 2 && Math.abs(s.h - h) < 2) return s.name;
  }
  return null;
}

export const EqualizePagesModal: React.FC = () => {
  const { currentDocument } = useDocumentStore();
  const { isPageEqualizeModalOpen, setPageEqualizeModalOpen, addToast } = useUIStore();

  const [step, setStep] = useState<Step>('range');
  const [fromPage, setFromPage] = useState(1);
  const [toPage, setToPage] = useState(1);
  const [isScanning, setIsScanning] = useState(false);
  const [sizeGroups, setSizeGroups] = useState<SizeGroup[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultFilename, setResultFilename] = useState('');

  const isBusy = isScanning || step === 'processing';
  const docId = currentDocument?.id;
  const docTotalPages = currentDocument?.totalPages ?? 0;

  useEffect(() => {
    if (!isPageEqualizeModalOpen || !docId) return;
    setStep('range');
    setFromPage(1);
    setToPage(Math.max(1, docTotalPages));
    setSizeGroups([]);
    setSelectedKey('');
    setUseCustom(false);
    setProgress(0);
    setResultFilename('');
  }, [isPageEqualizeModalOpen, docId, docTotalPages]);

  const handleClose = () => {
    if (isBusy) return;
    setPageEqualizeModalOpen(false);
  };

  useModalEscape(isPageEqualizeModalOpen, handleClose, isBusy);

  if (!isPageEqualizeModalOpen || !currentDocument) return null;

  const totalPages = currentDocument.totalPages;

  const getWorkingBuffer = async () => {
    if (currentDocument.isModified) {
      return PdfExporter.exportDocumentWithAnnotations(currentDocument);
    }
    return readAuthorizedDocBuffer(currentDocument.id, currentDocument.filePath);
  };

  const handleScan = async () => {
    const from = Math.max(1, fromPage);
    const to = Math.min(totalPages, toPage);
    if (from > to) {
      addToast('Geçersiz sayfa aralığı.', 'error');
      return;
    }

    setIsScanning(true);
    try {
      const rawBuffer = await getWorkingBuffer();
      const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
      const groups: Record<string, SizeGroup> = {};
      for (let i = from - 1; i <= to - 1; i++) {
        const page = pdfDoc.getPage(i);
        const { width, height } = page.getSize();
        const key = sizeKey(width, height);
        if (!groups[key]) {
          const std = matchKnown(width, height);
          groups[key] = {
            key,
            w: width,
            h: height,
            pages: [],
            label: std
              ? `${std} (${ptToMm(width)} × ${ptToMm(height)} mm)`
              : `Özel (${ptToMm(width)} × ${ptToMm(height)} mm)`,
          };
        }
        groups[key].pages.push(i + 1);
      }

      const sorted: SizeGroup[] = Object.values(groups).sort(
        (a, b) => b.pages.length - a.pages.length
      );
      setSizeGroups(sorted);
      const maxGroup = sorted.reduce(
        (best, g) => (g.w * g.h > best.w * best.h ? g : best),
        sorted[0]
      );
      setSelectedKey(maxGroup.key);
      setStep('scan-result');
    } catch (err: unknown) {
      addToast(
        'Tarama hatası: ' + (err instanceof Error ? err.message : String(err)),
        'error'
      );
    } finally {
      setIsScanning(false);
    }
  };

  const handleApply = async () => {
    let targetW: number;
    let targetH: number;
    if (useCustom) {
      const wMm = parseFloat(customW);
      const hMm = parseFloat(customH);
      if (isNaN(wMm) || isNaN(hMm) || wMm <= 0 || hMm <= 0) {
        addToast('Geçerli boyut girin (mm).', 'error');
        return;
      }
      targetW = wMm / PT_TO_MM;
      targetH = hMm / PT_TO_MM;
    } else {
      const chosen = sizeGroups.find((g) => g.key === selectedKey);
      if (!chosen) {
        addToast('Hedef boyut seçin.', 'error');
        return;
      }
      targetW = chosen.w;
      targetH = chosen.h;
    }

    const from = Math.max(1, fromPage) - 1;
    const to = Math.min(totalPages, toPage) - 1;
    setStep('processing');
    setProgress(0);

    try {
      const rawBuffer = await getWorkingBuffer();
      const srcDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
      const outDoc = await PDFDocument.create();
      const pageCount = srcDoc.getPageCount();

      for (let i = 0; i < pageCount; i++) {
        const srcPage = srcDoc.getPage(i);
        const { width: srcW, height: srcH } = srcPage.getSize();
        if (i >= from && i <= to) {
          const [embedded] = await outDoc.embedPdf(srcDoc, [i]);
          const newPage = outDoc.addPage([targetW, targetH]);
          newPage.drawPage(embedded, {
            x: (targetW - srcW) / 2,
            y: (targetH - srcH) / 2,
            width: srcW,
            height: srcH,
          });
        } else {
          const [copied] = await outDoc.copyPages(srcDoc, [i]);
          outDoc.addPage(copied);
        }
        setProgress(Math.round(((i + 1) / pageCount) * 100));
      }

      const outBytes = await outDoc.save();
      const baseName = currentDocument.name.replace(/\.pdf$/i, '');
      const filename = `${baseName}_esitlendi.pdf`;

      const saveRes = await saveBinaryOrBlobFile({
        data: outBytes,
        defaultName: filename,
        dialogTitle: 'Eşitlenmiş PDF Dosyasını Kaydet',
        filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
        mimeType: 'application/pdf',
      });

      if (saveRes.status === 'canceled') {
        addToast('Kaydetme iptal edildi.', 'info');
        setStep('scan-result');
        return;
      }

      setResultFilename(filename);
      setStep('done');
      addToast('Sayfalar başarıyla eşitlendi!', 'success');
    } catch (err: unknown) {
      addToast(
        'Eşitleme hatası: ' + (err instanceof Error ? err.message : String(err)),
        'error'
      );
      setStep('scan-result');
    }
  };

  const formatPageList = (pages: number[]) => {
    if (pages.length <= 5) return pages.join(', ');
    return `${pages.slice(0, 4).join(', ')} ... (${pages.length - 4} daha)`;
  };

  const getTargetLabel = () => {
    if (useCustom) return `Özel (${customW} × ${customH} mm)`;
    return sizeGroups.find((g) => g.key === selectedKey)?.label ?? 'seçilmedi';
  };

  const maxAreaGroup: SizeGroup | null =
    sizeGroups.length > 0
      ? sizeGroups.reduce(
          (best, g) => (g.w * g.h > best.w * best.h ? g : best),
          sizeGroups[0]
        )
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={handleClose}
    >
      <div
        className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-xl border border-slate-200 dark:border-slate-700 overflow-hidden text-slate-900 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30">
          <div className="flex items-center gap-2.5">
            <Ruler className="w-5 h-5 text-orange-500" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                Sayfaları Eşitle
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sayfa boyutlarını tarayıp eşitler
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isBusy}
            aria-label="Kapat"
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {step === 'range' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                  Sayfa Aralığı
                </label>
                <div className="flex items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">Başlangıç</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={fromPage}
                      onChange={(e) =>
                        setFromPage(Math.max(1, Math.min(totalPages, parseInt(e.target.value, 10) || 1)))
                      }
                      className="w-24 h-9 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-center text-sm font-bold focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 mt-4" />
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] text-slate-400">Bitiş</span>
                    <input
                      type="number"
                      min={1}
                      max={totalPages}
                      value={toPage}
                      onChange={(e) =>
                        setToPage(Math.max(1, Math.min(totalPages, parseInt(e.target.value, 10) || totalPages)))
                      }
                      className="w-24 h-9 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-center text-sm font-bold focus:outline-none focus:border-orange-500"
                    />
                  </div>
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setFromPage(1);
                        setToPage(totalPages);
                      }}
                      className="text-xs text-orange-500 hover:text-orange-600 font-medium underline"
                    >
                      Tüm sayfalar
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 mt-1.5">Toplam {totalPages} sayfa</p>
              </div>

              <button
                type="button"
                onClick={handleScan}
                disabled={isScanning}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-60 text-white font-semibold text-sm transition-colors"
              >
                {isScanning ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Taranıyor...
                  </>
                ) : (
                  <>
                    <ScanLine className="w-4 h-4" />
                    Sayfa Boyutlarını Tara
                  </>
                )}
              </button>
            </>
          )}

          {step === 'scan-result' && (
            <>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    Bulunan Boyutlar ({fromPage}–{toPage}. sayfalar)
                  </label>
                  <button
                    type="button"
                    onClick={() => setStep('range')}
                    className="text-xs text-slate-400 hover:text-slate-600 underline"
                  >
                    Değiştir
                  </button>
                </div>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {sizeGroups.map((g) => (
                    <label
                      key={g.key}
                      className={cn(
                        'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                        !useCustom && selectedKey === g.key
                          ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30'
                          : 'border-slate-200 dark:border-slate-700 hover:border-orange-300'
                      )}
                    >
                      <input
                        type="radio"
                        name="sizeTarget"
                        checked={!useCustom && selectedKey === g.key}
                        onChange={() => {
                          setSelectedKey(g.key);
                          setUseCustom(false);
                        }}
                        className="accent-orange-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                            {g.label}
                          </span>
                          {maxAreaGroup && g.key === maxAreaGroup.key && (
                            <span className="text-[10px] bg-orange-100 dark:bg-orange-900/40 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full font-medium">
                              En Büyük
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {g.pages.length} sayfa — {formatPageList(g.pages)}
                        </p>
                      </div>
                    </label>
                  ))}

                  <label
                    className={cn(
                      'flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors',
                      useCustom
                        ? 'border-orange-400 bg-orange-50 dark:bg-orange-950/30'
                        : 'border-slate-200 dark:border-slate-700 hover:border-orange-300'
                    )}
                  >
                    <input
                      type="radio"
                      name="sizeTarget"
                      checked={useCustom}
                      onChange={() => setUseCustom(true)}
                      className="accent-orange-500 mt-0.5"
                    />
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-slate-900 dark:text-white">
                        Özel Boyut
                      </span>
                      {useCustom && (
                        <div className="flex items-center gap-2 mt-2">
                          <input
                            type="number"
                            placeholder="Genişlik"
                            value={customW}
                            onChange={(e) => setCustomW(e.target.value)}
                            className="w-24 h-8 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-2 text-sm focus:outline-none focus:border-orange-500"
                          />
                          <span className="text-slate-400">×</span>
                          <input
                            type="number"
                            placeholder="Yükseklik"
                            value={customH}
                            onChange={(e) => setCustomH(e.target.value)}
                            className="w-24 h-8 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg px-2 text-sm focus:outline-none focus:border-orange-500"
                          />
                          <span className="text-[11px] text-slate-400">mm</span>
                        </div>
                      )}
                    </div>
                  </label>
                </div>
              </div>

              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
                Küçük sayfalar beyaz boşlukla tamamlanıp <strong>ortalanır</strong>. İçerik kesilmez.
              </div>

              <button
                type="button"
                onClick={handleApply}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm transition-colors"
              >
                <Download className="w-4 h-4" />
                Eşitle ve Kaydet
              </button>
            </>
          )}

          {step === 'processing' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <div className="w-12 h-12 border-4 border-orange-200 border-t-orange-500 rounded-full animate-spin" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                Sayfalar eşitleniyor...
              </p>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-orange-500 h-2 rounded-full transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">%{progress} tamamlandı</p>
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <CheckCircle2 className="w-14 h-14 text-green-500" />
              <div>
                <p className="text-base font-bold text-slate-900 dark:text-white">
                  Eşitleme Tamamlandı!
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Hedef: <strong>{getTargetLabel()}</strong>
                </p>
                <p className="text-xs text-slate-400 mt-1">{resultFilename} kaydedildi</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="px-6 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-sm font-medium transition-colors"
              >
                Kapat
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
