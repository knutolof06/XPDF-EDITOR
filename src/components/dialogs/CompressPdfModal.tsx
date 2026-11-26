import React, { useState, useEffect, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useTabStore } from '@/store/tab-store';
import { useUIStore } from '@/store/ui-store';
import { PdfCompressor, CompressionLevel, CompressionResult } from '@/core/engine/pdf-compressor';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import {
  X,
  Minimize2,
  Loader2,
  Download,
  CheckCircle2,
  FileText,
  ExternalLink,
  Zap,
  Info,
} from 'lucide-react';
import { cn } from '@/utils/cn';
import {
  saveBinaryOrBlobFile,
  useModalEscape,
  useResolvedDarkMode,
} from './modal-utils';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export const CompressPdfModal: React.FC = () => {
  const { isCompressModalOpen, setCompressModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy, setDocument, addRecentDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const isDark = useResolvedDarkMode();

  const [level, setLevel] = useState<CompressionLevel>('recommended');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [result, setResult] = useState<CompressionResult | null>(null);
  const cancelRequestedRef = useRef(false);

  useEffect(() => {
    setResult(null);
    setProgress(null);
    cancelRequestedRef.current = false;
  }, [isCompressModalOpen, currentDocument?.id]);

  useModalEscape(
    isCompressModalOpen,
    () => {
      if (!isProcessing) {
        setResult(null);
        setCompressModalOpen(false);
      }
    },
    isProcessing
  );

  if (!isCompressModalOpen || !currentDocument || !pdfDocProxy) return null;

  const handleCompress = async () => {
    cancelRequestedRef.current = false;
    try {
      setIsProcessing(true);
      setResult(null);
      setProgress({ current: 0, total: pdfDocProxy.numPages });

      const compResult = await PdfCompressor.compressPdf(
        currentDocument.id,
        pdfDocProxy,
        level,
        (current, total) => {
          if (!cancelRequestedRef.current) {
            setProgress({ current, total });
          }
        }
      );

      if (cancelRequestedRef.current) {
        addToast('Sıkıştırma iptal edildi.', 'info');
        return;
      }

      setResult(compResult);
      const actualSaved = compResult.originalSize - compResult.compressedSize;
      if (actualSaved > 0) {
        addToast(
          `PDF boyutu %${compResult.reductionPercentage} oranında küçültüldü!`,
          'success'
        );
      } else {
        addToast(
          'Dosya zaten optimize edilmiş; ek boyut küçültmesi sağlanamadı.',
          'info'
        );
      }
    } catch (err: unknown) {
      if (!cancelRequestedRef.current) {
        console.error('Compression error:', err);
        addToast('Sıkıştırma sırasında hata oluştu.', 'error');
      }
    } finally {
      setIsProcessing(false);
      setProgress(null);
      cancelRequestedRef.current = false;
    }
  };

  const handleCancelOrClose = () => {
    if (isProcessing) {
      cancelRequestedRef.current = true;
      setIsProcessing(false);
      setProgress(null);
      addToast('Sıkıştırma işlemi iptal edildi.', 'info');
      return;
    }
    setResult(null);
    setCompressModalOpen(false);
  };

  const handleDownload = async () => {
    if (!result) return;
    try {
      const defaultName =
        currentDocument.name.replace(/\.pdf$/i, '') + '_sikistirilmis.pdf';
      const saveRes = await saveBinaryOrBlobFile({
        data: result.compressedBuffer,
        defaultName,
        dialogTitle: 'Sıkıştırılmış PDF Dosyasını Kaydet',
        filters: [{ name: 'PDF Dökümanı', extensions: ['pdf'] }],
        mimeType: 'application/pdf',
      });

      if (saveRes.status === 'canceled') {
        addToast('Kaydetme iptal edildi.', 'info');
        return;
      }
      addToast('Sıkıştırılmış PDF kaydedildi.', 'success');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Kaydetme başarısız oldu.';
      addToast(msg, 'error');
    }
  };

  const handleOpenInNewTab = async () => {
    if (!result) return;
    try {
      const newName = currentDocument.name.replace(/\.pdf$/i, '') + ' (Sıkıştırılmış).pdf';
      const loaded = await PdfLoader.loadDocument(newName, result.compressedBuffer);
      setDocument(loaded.model, loaded.pdfDoc);
      addTab(loaded.model, loaded.pdfDoc);
      addRecentDocument({
        id: loaded.model.id,
        name: loaded.model.name,
        fileSize: loaded.model.fileSize,
        pageCount: loaded.model.totalPages,
        lastOpened: Date.now(),
      });
      setResult(null);
      setCompressModalOpen(false);
      addToast('Sıkıştırılmış PDF yeni sekmede açıldı.', 'success');
    } catch (err) {
      console.error(err);
      addToast('Dosya açılırken hata oluştu.', 'error');
    }
  };

  const actualSavedBytes = result ? result.originalSize - result.compressedSize : 0;
  const actualReductionPct =
    result && result.originalSize > 0
      ? Math.round((actualSavedBytes / result.originalSize) * 100)
      : 0;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => !isProcessing && handleCancelOrClose()}
    >
      <div
        className={cn(
          'w-full max-w-lg rounded-2xl shadow-2xl border flex flex-col overflow-hidden transition-all',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-800'
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between px-6 py-4 border-b',
            isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/50'
          )}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center">
              <Minimize2 className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold">PDF Dosya Boyutunu Küçült</h2>
              <p className={cn('text-xs', isDark ? 'text-slate-400' : 'text-slate-500')}>
                Görselleri optimize edin ve dosya boyutunu düşürün
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !isProcessing && handleCancelOrClose()}
            disabled={isProcessing}
            aria-label="Kapat"
            className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-400 transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-5">
          <div
            className={cn(
              'flex items-center gap-3 p-3 rounded-xl border',
              isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/80'
            )}
          >
            <FileText className="w-5 h-5 text-sky-500 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold truncate">{currentDocument.name}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {pdfDocProxy.numPages} Sayfa • {formatBytes(currentDocument.fileSize)}
              </div>
            </div>
          </div>

          {!result && (
            <div className="flex flex-col gap-2.5">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                Sıkıştırma Seviyesi Seçin:
              </label>

              <div
                onClick={() => !isProcessing && setLevel('recommended')}
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all',
                  level === 'recommended'
                    ? 'border-sky-500 bg-sky-500/10'
                    : isDark
                    ? 'border-slate-800 hover:border-slate-700 bg-slate-800/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                )}
              >
                <div className="w-4 h-4 rounded-full border-2 border-sky-500 mt-0.5 flex items-center justify-center">
                  {level === 'recommended' && <div className="w-2 h-2 rounded-full bg-sky-500" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">Dengeli Sıkıştırma (Önerilen)</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded">
                      ~%60 Tasarruf
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Görsel kalitesi ve boyut arasında dengeli optimizasyon sağlar.
                  </p>
                </div>
              </div>

              <div
                onClick={() => !isProcessing && setLevel('extreme')}
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all',
                  level === 'extreme'
                    ? 'border-sky-500 bg-sky-500/10'
                    : isDark
                    ? 'border-slate-800 hover:border-slate-700 bg-slate-800/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                )}
              >
                <div className="w-4 h-4 rounded-full border-2 border-sky-500 mt-0.5 flex items-center justify-center">
                  {level === 'extreme' && <div className="w-2 h-2 rounded-full bg-sky-500" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">Yüksek Sıkıştırma (En Küçük Boyut)</span>
                    <span className="text-[10px] bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold px-1.5 py-0.5 rounded">
                      ~%80 Tasarruf
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Mümkün olan en düşük dosya boyutu. E-posta ekleri ve yükleme limitleri için uygundur.
                  </p>
                </div>
              </div>

              <div
                onClick={() => !isProcessing && setLevel('less')}
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border-2 cursor-pointer transition-all',
                  level === 'less'
                    ? 'border-sky-500 bg-sky-500/10'
                    : isDark
                    ? 'border-slate-800 hover:border-slate-700 bg-slate-800/20'
                    : 'border-slate-200 hover:border-slate-300 bg-white'
                )}
              >
                <div className="w-4 h-4 rounded-full border-2 border-sky-500 mt-0.5 flex items-center justify-center">
                  {level === 'less' && <div className="w-2 h-2 rounded-full bg-sky-500" />}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold">Hafif Sıkıştırma (Yüksek Kalite)</span>
                    <span className="text-[10px] bg-blue-500/20 text-blue-600 dark:text-blue-400 font-bold px-1.5 py-0.5 rounded">
                      Yüksek Netlik
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Görsel netliğini koruyarak dosya yapısını optimize eder.
                  </p>
                </div>
              </div>
            </div>
          )}

          {isProcessing && (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <Loader2 className="w-8 h-8 text-sky-500 animate-spin" />
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Sayfalar optimize ediliyor... ({progress?.current || 0} / {progress?.total || 0})
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-sky-500 h-full transition-all duration-200"
                  style={{
                    width: `${((progress?.current || 0) / (progress?.total || 1)) * 100}%`,
                  }}
                />
              </div>
            </div>
          )}

          {result && !isProcessing && (
            <div
              className={cn(
                'flex flex-col gap-4 p-4 rounded-xl border',
                actualSavedBytes > 0
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : 'bg-amber-500/10 border-amber-500/30'
              )}
            >
              <div
                className={cn(
                  'flex items-center gap-2 font-bold text-sm',
                  actualSavedBytes > 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-amber-600 dark:text-amber-400'
                )}
              >
                {actualSavedBytes > 0 ? (
                  <CheckCircle2 className="w-5 h-5" />
                ) : (
                  <Info className="w-5 h-5" />
                )}
                <span>
                  {actualSavedBytes > 0
                    ? 'PDF Başarıyla Sıkıştırıldı!'
                    : 'Dosya Boyutu Zaten Minimum Seviyede'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Orijinal Boyut</div>
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-200">
                    {formatBytes(result.originalSize)}
                  </div>
                </div>

                <div className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                    Yeni Boyut
                  </div>
                  <div
                    className={cn(
                      'text-base font-extrabold',
                      actualSavedBytes > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    )}
                  >
                    {formatBytes(result.compressedSize)}
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  'text-center text-xs font-bold',
                  actualSavedBytes > 0
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-amber-700 dark:text-amber-300'
                )}
              >
                {actualSavedBytes > 0
                  ? `Toplam %${actualReductionPct} dosya boyutu kazancı sağlandı (${formatBytes(actualSavedBytes)} tasarruf)`
                  : actualSavedBytes === 0
                  ? 'Dosya boyutu değişmedi (%0 fark). Orijinal dosya zaten yeterince küçük.'
                  : `Bu belge metin/vektör ağırlıklı olduğu için yeniden paketleme boyutu ${formatBytes(Math.abs(actualSavedBytes))} artırdı. Orijinal dosyayı kullanmanız önerilir.`}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          className={cn(
            'flex items-center justify-end gap-2 px-6 py-4 border-t',
            isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-100 bg-slate-50/50'
          )}
        >
          <button
            type="button"
            onClick={handleCancelOrClose}
            className="px-4 py-2 text-xs font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors"
          >
            {isProcessing ? 'İptal Et' : 'Kapat'}
          </button>

          {!result ? (
            <button
              type="button"
              onClick={handleCompress}
              disabled={isProcessing}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-600/20 transition-all disabled:opacity-50"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Sıkıştırmayı Başlat</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenInNewTab}
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Yeni Sekmede Aç</span>
              </button>

              <button
                type="button"
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Kaydet</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
