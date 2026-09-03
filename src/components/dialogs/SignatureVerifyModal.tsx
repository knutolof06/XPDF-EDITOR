import React, { useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { binaryStore } from '@/core/storage/binary-store';
import { SignatureDetector, DigitalSignatureInfo } from '@/core/security/signature-detector';
import {
  X,
  PenTool,
  CheckCircle2,
  Calendar,
  MapPin,
  HelpCircle,
  Shield,
  FileCheck,
  Plus,
  Loader2,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const SignatureVerifyModal: React.FC = () => {
  const { isSignatureVerifyModalOpen, setSignatureVerifyModalOpen, setSignatureModalOpen } = useUIStore();
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === 'dark';

  const [isLoading, setIsLoading] = useState(false);
  const [signatures, setSignatures] = useState<DigitalSignatureInfo[]>([]);

  useEffect(() => {
    if (!isSignatureVerifyModalOpen || !pdfDocProxy || !currentDocument) return;

    let isMounted = true;
    setIsLoading(true);

    const rawBuffer = binaryStore.get(currentDocument.id);

    SignatureDetector.detectSignatures(pdfDocProxy, rawBuffer)
      .then((sigs) => {
        if (isMounted) setSignatures(sigs);
      })
      .catch((err) => {
        console.error('Signature detection failed:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isSignatureVerifyModalOpen, pdfDocProxy, currentDocument]);

  if (!isSignatureVerifyModalOpen || !currentDocument) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className={cn(
          'w-full max-w-lg rounded-2xl border shadow-2xl flex flex-col overflow-hidden transition-colors',
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
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
              <h2 className="text-base font-bold">Dijital İmzalar ve Sertifikalar</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Belgedeki elektronik ve dijital imza katmanlarını inceleyin.
              </p>
            </div>
          </div>

          <button
            onClick={() => setSignatureVerifyModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh] space-y-3">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-2 text-slate-500 text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-sky-500" />
              <span>Dijital imzalar taranıyor...</span>
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
                  Bu belgede kriptografik PKCS#7 / e-İmza sertifikası tespit edilmedi. Kendinize ait resmi veya çizili bir imza ekleyebilirsiniz.
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => {
                    setSignatureVerifyModalOpen(false);
                    setSignatureModalOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-600 text-white font-semibold text-xs inline-flex items-center gap-2 shadow-xs transition-all"
                >
                  <Plus className="w-4 h-4" />
                  <span>Yeni İmza Ekle</span>
                </button>
              </div>
            </div>
          ) : (
            signatures.map((sig, idx) => (
              <div
                key={sig.id || idx}
                className={cn(
                  'p-4 rounded-xl border transition-all space-y-2.5',
                  isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200 shadow-2xs'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <span className="font-bold text-xs text-slate-900 dark:text-white">
                      {sig.name}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                    Geçerli İmza
                  </span>
                </div>

                <div className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                  {sig.date && (
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>İmza Tarihi: <strong>{sig.date}</strong></span>
                    </div>
                  )}

                  {sig.reason && (
                    <div className="flex items-center gap-1.5">
                      <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                      <span>Gerekçe: <strong>{sig.reason}</strong></span>
                    </div>
                  )}

                  {sig.location && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      <span>Konum: <strong>{sig.location}</strong></span>
                    </div>
                  )}

                  {sig.pageNumber && (
                    <div className="flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5 text-slate-400" />
                      <span>Sayfa: <strong>{sig.pageNumber}</strong></span>
                    </div>
                  )}

                  {sig.signerDetails && (
                    <p className="text-[10px] text-slate-400 pt-1 border-t border-slate-200 dark:border-slate-700">
                      {sig.signerDetails}
                    </p>
                  )}
                </div>
              </div>
            ))
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
