import React, { useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { binaryStore } from '@/core/storage/binary-store';
import {
  SignatureDetector,
  SignatureVerificationResult,
  SignatureValidityStatus,
} from '@/core/security/signature-detector';
import {
  X,
  PenTool,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Calendar,
  MapPin,
  Shield,
  FileCheck,
  Plus,
  Loader2,
  Award,
  Key,
  Clock,
} from 'lucide-react';
import { cn } from '@/utils/cn';

function resolveIsDark(theme: 'dark' | 'light' | 'system'): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
    return true;
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

function getStatusBadge(status: SignatureValidityStatus): {
  label: string;
  badgeClass: string;
  icon: React.ReactNode;
} {
  switch (status) {
    case 'valid':
      return {
        label: 'Geçerli ve Güvenilir İmza',
        badgeClass: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
        icon: <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />,
      };
    case 'untrusted-signer':
      return {
        label: 'Bütünlük Doğrulandı (Güvenilmeyen İmzalayıcı)',
        badgeClass: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
        icon: <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />,
      };
    case 'expired':
      return {
        label: 'Süresi Dolmuş Sertifika',
        badgeClass: 'bg-orange-500/15 text-orange-600 dark:text-orange-400',
        icon: <Clock className="w-4 h-4 text-orange-500 shrink-0" />,
      };
    case 'tampered':
      return {
        label: 'Belge Değiştirilmiş / Bütünlük Bozuk!',
        badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
        icon: <XCircle className="w-4 h-4 text-rose-500 shrink-0" />,
      };
    case 'invalid':
      return {
        label: 'Geçersiz İmza',
        badgeClass: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
        icon: <XCircle className="w-4 h-4 text-rose-500 shrink-0" />,
      };
    default:
      return {
        label: 'İmzasız / Doğrulanamadı',
        badgeClass: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
        icon: <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />,
      };
  }
}

export const SignatureVerifyModal: React.FC = () => {
  const { isSignatureVerifyModalOpen, setSignatureVerifyModalOpen, setSignatureModalOpen } =
    useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const theme = useViewerStore((s) => s.theme);
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(theme));

  const [isLoading, setIsLoading] = useState(false);
  const [signatures, setSignatures] = useState<SignatureVerificationResult[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);

  useEffect(() => {
    setIsDark(resolveIsDark(theme));
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  // Reset old state when closed or document changes
  const currentDocId = currentDocument?.id ?? null;
  useEffect(() => {
    if (!isSignatureVerifyModalOpen || !pdfDocProxy || !currentDocId) {
      setSignatures([]);
      setScanError(null);
      setIsLoading(false);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    setSignatures([]);
    setScanError(null);

    const rawBuffer = binaryStore.get(currentDocId);

    SignatureDetector.detectSignatures(pdfDocProxy, rawBuffer)
      .then((sigs) => {
        if (isMounted) setSignatures(sigs);
      })
      .catch((err: unknown) => {
        console.error('Signature detection failed:', err);
        if (isMounted) {
          setSignatures([]);
          setScanError(
            err instanceof Error
              ? err.message
              : 'İmzalar doğrulanırken beklenmeyen bir hata oluştu.'
          );
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isSignatureVerifyModalOpen, pdfDocProxy, currentDocId]);

  if (!isSignatureVerifyModalOpen || !currentDocument) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className={cn(
          'w-full max-w-xl rounded-2xl border shadow-2xl flex flex-col overflow-hidden transition-colors',
          isDark
            ? 'bg-slate-900 border-slate-800 text-slate-100'
            : 'bg-white border-slate-200 text-slate-900'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'px-6 py-4 border-b flex items-center justify-between shrink-0',
            isDark ? 'border-slate-800 bg-slate-900/80' : 'border-slate-100 bg-slate-50'
          )}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center">
              <PenTool className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Dijital İmzalar ve Sertifika Doğrulama</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                PKCS#7 / CMS imza bütünlüğü, ByteRange kapsamı ve X.509 sertifika ayrıntıları.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSignatureVerifyModalOpen(false)}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[65vh] space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
              <span>Dijital imzalar ve PKCS#7 sertifikaları doğrulanıyor...</span>
            </div>
          ) : scanError ? (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{scanError}</span>
            </div>
          ) : signatures.length === 0 ? (
            <div className="py-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center">
                <FileCheck className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Dijital İmza Bulunamadı
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Bu belgede kriptografik PKCS#7 / e-İmza sertifikası tespit edilmedi. Belgeye görsel bir imza ekleyebilirsiniz.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setSignatureVerifyModalOpen(false);
                    setSignatureModalOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs inline-flex items-center gap-2 shadow-xs transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Yeni Görsel İmza Ekle</span>
                </button>
              </div>
            </div>
          ) : (
            signatures.map((sig, idx) => {
              const badge = getStatusBadge(sig.status);
              return (
                <div
                  key={sig.id || idx}
                  className={cn(
                    'p-4 rounded-xl border transition-all space-y-3',
                    isDark
                      ? 'bg-slate-800/50 border-slate-700'
                      : 'bg-slate-50 border-slate-200 shadow-2xs'
                  )}
                >
                  {/* Top Summary */}
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      {badge.icon}
                      <span className="font-bold text-xs text-slate-900 dark:text-white">
                        {sig.name}
                      </span>
                    </div>
                    <span
                      className={cn(
                        'px-2.5 py-0.5 rounded-full text-[10px] font-bold',
                        badge.badgeClass
                      )}
                    >
                      {badge.label}
                    </span>
                  </div>

                  {/* Verification Matrix Pills */}
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div
                      className={cn(
                        'px-2 py-1.5 rounded-lg border flex items-center justify-between',
                        sig.integrityVerified
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      )}
                    >
                      <span>Bütünlük</span>
                      <strong>{sig.integrityVerified ? 'Doğrulandı' : 'Başarısız'}</strong>
                    </div>

                    <div
                      className={cn(
                        'px-2 py-1.5 rounded-lg border flex items-center justify-between',
                        sig.byteRangeValid
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      )}
                    >
                      <span>ByteRange</span>
                      <strong>{sig.byteRangeValid ? 'Geçerli' : 'Geçersiz'}</strong>
                    </div>

                    <div
                      className={cn(
                        'px-2 py-1.5 rounded-lg border flex items-center justify-between',
                        sig.certificateTrusted
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                      )}
                    >
                      <span>Güven Kökü</span>
                      <strong>{sig.certificateTrusted ? 'Güvenilir' : 'Doğrulanmadı'}</strong>
                    </div>
                  </div>

                  {/* Metadata Details */}
                  <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                    {sig.signedAt && (
                      <div className="flex items-center gap-1.5">
                        <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          İmza Tarihi: <strong>{sig.signedAt}</strong>
                        </span>
                      </div>
                    )}

                    {sig.reason && (
                      <div className="flex items-center gap-1.5">
                        <HelpCircle className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          Gerekçe: <strong>{sig.reason}</strong>
                        </span>
                      </div>
                    )}

                    {sig.location && (
                      <div className="flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          Konum: <strong>{sig.location}</strong>
                        </span>
                      </div>
                    )}

                    {(sig.pageNumber || sig.subFilter || sig.digestAlgorithm) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <Shield className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span>
                          {sig.pageNumber ? `Sayfa ${sig.pageNumber}` : ''}
                          {sig.pageNumber && (sig.subFilter || sig.digestAlgorithm) ? ' • ' : ''}
                          {sig.subFilter ? `Format: ${sig.subFilter}` : ''}
                          {sig.digestAlgorithm ? ` • Özet: ${sig.digestAlgorithm}` : ''}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Certificate Details */}
                  {sig.certificate && (
                    <div
                      className={cn(
                        'p-2.5 rounded-lg border text-[10px] space-y-1',
                        isDark
                          ? 'bg-slate-900/70 border-slate-700/80 text-slate-300'
                          : 'bg-white border-slate-200 text-slate-700'
                      )}
                    >
                      <div className="font-bold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                        <Award className="w-3.5 h-3.5 text-indigo-500" />
                        <span>X.509 Sertifika Bilgileri</span>
                        {sig.certificate.isSelfSigned && (
                          <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
                            Kendi İmzalı (Self-Signed)
                          </span>
                        )}
                        {sig.certificate.isExpired && (
                          <span className="px-1.5 py-0.2 rounded bg-rose-500/15 text-rose-600 dark:text-rose-400 font-semibold">
                            Süresi Dolmuş
                          </span>
                        )}
                      </div>
                      <div className="break-all">
                        <span className="text-slate-500">Sahip (Subject):</span>{' '}
                        {sig.certificate.subject}
                      </div>
                      <div className="break-all">
                        <span className="text-slate-500">Veren (Issuer):</span>{' '}
                        {sig.certificate.issuer}
                      </div>
                      {sig.certificate.serialNumber && (
                        <div>
                          <span className="text-slate-500">Seri No:</span>{' '}
                          <span className="font-mono">{sig.certificate.serialNumber}</span>
                        </div>
                      )}
                      {sig.certificate.validFrom && sig.certificate.validTo && (
                        <div>
                          <span className="text-slate-500">Geçerlilik:</span>{' '}
                          {new Date(sig.certificate.validFrom).toLocaleDateString('tr-TR')} —{' '}
                          {new Date(sig.certificate.validTo).toLocaleDateString('tr-TR')}
                        </div>
                      )}
                      {sig.certificate.fingerprintSha256 && (
                        <div className="flex items-start gap-1 break-all">
                          <Key className="w-3 h-3 text-slate-400 shrink-0 mt-0.5" />
                          <span className="font-mono text-[9px] text-slate-500">
                            SHA-256: {sig.certificate.fingerprintSha256}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {(sig.error || sig.details) && (
                    <p
                      className={cn(
                        'text-[11px] pt-1.5 border-t',
                        isDark ? 'border-slate-700' : 'border-slate-200',
                        sig.error
                          ? 'text-rose-600 dark:text-rose-400 font-medium'
                          : 'text-slate-500 dark:text-slate-400'
                      )}
                    >
                      {sig.error || sig.details}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          className={cn(
            'p-4 border-t flex justify-end shrink-0',
            isDark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-white'
          )}
        >
          <button
            type="button"
            onClick={() => setSignatureVerifyModalOpen(false)}
            className="px-4 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Kapat
          </button>
        </div>
      </div>
    </div>
  );
};
