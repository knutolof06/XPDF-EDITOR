import React, { useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { useTabStore } from '@/store/tab-store';
import { binaryStore } from '@/core/storage/binary-store';
import { PdfSecurityEngine, DocumentSecurityInfo, DocumentPermissions } from '@/core/security/pdf-security';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import {
  X,
  Lock,
  Unlock,
  KeyRound,
  ShieldCheck,
  Download,
  FilePlus,
  Printer,
  Copy,
  Edit3,
  Check,
  Loader2,
} from 'lucide-react';
import { cn } from '@/utils/cn';

export const SecurityPermissionsModal: React.FC = () => {
  const { isSecurityModalOpen, setSecurityModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy, setDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const theme = useViewerStore((s) => s.theme);
  const isDark = theme === 'dark';

  const [activeTab, setActiveTab] = useState<'encrypt' | 'decrypt' | 'info'>('encrypt');
  const [securityInfo, setSecurityInfo] = useState<DocumentSecurityInfo | null>(null);

  // Encryption inputs
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [permissions, setPermissions] = useState<DocumentPermissions>({
    canPrint: true,
    canCopy: true,
    canModify: false,
    canAnnotate: true,
    canFillForms: true,
    canAssemble: false,
  });

  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (!isSecurityModalOpen || !pdfDocProxy) return;

    PdfSecurityEngine.getDocumentSecurity(pdfDocProxy).then((info) => {
      setSecurityInfo(info);
      if (info.isEncrypted) {
        setActiveTab('decrypt');
      } else {
        setActiveTab('encrypt');
      }
    });
  }, [isSecurityModalOpen, pdfDocProxy]);

  if (!isSecurityModalOpen || !currentDocument) return null;

  // 1. Encrypt and Download
  const handleEncryptAndDownload = async () => {
    if (!userPassword) {
      addToast('Lütfen en az bir açılış parolası belirleyin.', 'warning');
      return;
    }

    const rawBuffer = binaryStore.get(currentDocument.id);
    if (!rawBuffer) {
      addToast('Döküman verisi bulunamadı.', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const encryptedBytes = await PdfSecurityEngine.encryptPdf(rawBuffer, {
        userPassword,
        ownerPassword: ownerPassword || userPassword,
        permissions,
      });

      const baseName = currentDocument.name.replace(/\.[^/.]+$/, '');
      const blob = new Blob([encryptedBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${baseName}_sifreli.pdf`;
      link.click();
      URL.revokeObjectURL(url);

      addToast('Belge başarıyla şifrelendi ve indirildi.', 'success');
      setSecurityModalOpen(false);
    } catch (err: any) {
      console.error(err);
      addToast('Şifreleme sırasında bir hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Remove Password / Decrypt
  const handleRemovePassword = async (openInNewTab: boolean = false) => {
    const rawBuffer = binaryStore.get(currentDocument.id);
    if (!rawBuffer) {
      addToast('Döküman verisi bulunamadı.', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const cleanBuffer = await PdfSecurityEngine.removePassword(rawBuffer);

      if (openInNewTab) {
        const cleanName = `Korumasiz_${currentDocument.name}`;
        const { model, pdfDoc } = await PdfLoader.loadDocument(cleanName, cleanBuffer);
        addTab(model, pdfDoc);
        setDocument(model, pdfDoc);
        addToast('Şifresi kaldırılmış döküman yeni sekmede açıldı!', 'success');
      } else {
        const baseName = currentDocument.name.replace(/\.[^/.]+$/, '');
        const blob = new Blob([cleanBuffer], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${baseName}_sifresiz.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        addToast('Şifresiz PDF dosyası başarıyla indirildi!', 'success');
      }

      setSecurityModalOpen(false);
    } catch (err: any) {
      console.error(err);
      addToast('Şifre kaldırılırken hata oluştu.', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

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
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center">
              <Lock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold">Belge Güvenliği ve Şifreleme</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Parola koruması ekleyin, izinleri kısıtlayın veya şifreyi kalıcı olarak kaldırın.
              </p>
            </div>
          </div>

          <button
            onClick={() => setSecurityModalOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 flex gap-2 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('encrypt')}
            className={cn(
              'pb-2.5 px-2 border-b-2 transition-all flex items-center gap-1.5',
              activeTab === 'encrypt'
                ? 'border-sky-500 text-sky-500'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            )}
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Şifrele & Parola Koy</span>
          </button>

          <button
            onClick={() => setActiveTab('decrypt')}
            className={cn(
              'pb-2.5 px-2 border-b-2 transition-all flex items-center gap-1.5',
              activeTab === 'decrypt'
                ? 'border-sky-500 text-sky-500'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            )}
          >
            <Unlock className="w-3.5 h-3.5" />
            <span>Şifreyi Kaldır</span>
          </button>

          <button
            onClick={() => setActiveTab('info')}
            className={cn(
              'pb-2.5 px-2 border-b-2 transition-all flex items-center gap-1.5',
              activeTab === 'info'
                ? 'border-sky-500 text-sky-500'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            )}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>İzin Durumu</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* 1. ENCRYPT TAB */}
          {activeTab === 'encrypt' && (
            <div className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Açılış Parolası (Kullanıcı Parolası)*
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    value={userPassword}
                    onChange={(e) => setUserPassword(e.target.value)}
                    placeholder="Belgeyi açmak için gereken parola..."
                    className={cn(
                      'w-full pl-9 pr-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs font-medium',
                      isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                    )}
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Yönetici Parolası (İsteğe Bağlı)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="password"
                    value={ownerPassword}
                    onChange={(e) => setOwnerPassword(e.target.value)}
                    placeholder="İzinleri değiştirmek için yönetici parolası..."
                    className={cn(
                      'w-full pl-9 pr-3 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs font-medium',
                      isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
                    )}
                  />
                </div>
              </div>

              {/* Permissions Checkboxes */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 block">Kullanıcı İzinleri:</span>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.canPrint}
                    onChange={(e) => setPermissions({ ...permissions, canPrint: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Belgeyi yazdırmaya izin ver</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.canCopy}
                    onChange={(e) => setPermissions({ ...permissions, canCopy: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Metin ve görsel kopyalamaya izin ver</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.canFillForms}
                    onChange={(e) => setPermissions({ ...permissions, canFillForms: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Form alanlarını doldurmaya izin ver</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.canModify}
                    onChange={(e) => setPermissions({ ...permissions, canModify: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Sayfa ekleme/çıkarma ve içeriği değiştirmeye izin ver</span>
                </label>
              </div>

              <div className="pt-3">
                <button
                  onClick={handleEncryptAndDownload}
                  disabled={isProcessing || !userPassword}
                  className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                  <span>Belgeyi Şifrele ve İndir</span>
                </button>
              </div>
            </div>
          )}

          {/* 2. DECRYPT TAB */}
          {activeTab === 'decrypt' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <Unlock className="w-4 h-4 text-emerald-500" />
                  <span>Kalıcı Parola Kaldırma</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Şu an açık olan belgedeki şifreleme motoru ve parola gereksinimi tamamen kaldırılacaktır. Oluşturulacak yeni PDF dökümanı hiçbir parola sormadan doğrudan her cihazda açılacaktır.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => handleRemovePassword(false)}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  <span>Şifresiz İndir</span>
                </button>

                <button
                  onClick={() => handleRemovePassword(true)}
                  disabled={isProcessing}
                  className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FilePlus className="w-4 h-4" />}
                  <span>Yeni Sekmede Aç</span>
                </button>
              </div>
            </div>
          )}

          {/* 3. PERMISSIONS INFO TAB */}
          {activeTab === 'info' && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800">
                <span className="font-semibold">Şifreleme Durumu:</span>
                <span
                  className={cn(
                    'px-2 py-0.5 rounded text-[11px] font-bold',
                    securityInfo?.isEncrypted
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  )}
                >
                  {securityInfo?.isEncrypted ? 'Korumalı / Şifreli' : 'Şifresiz (Açık)'}
                </span>
              </div>

              <div className="space-y-2 pt-1">
                <span className="font-bold block text-slate-700 dark:text-slate-300">İzin Matrisi:</span>

                {[
                  { label: 'Belge Yazdırma', allowed: securityInfo?.permissions.canPrint ?? true, icon: Printer },
                  { label: 'Metin ve Görsel Kopyalama', allowed: securityInfo?.permissions.canCopy ?? true, icon: Copy },
                  { label: 'İçerik Değiştirme', allowed: securityInfo?.permissions.canModify ?? true, icon: Edit3 },
                  { label: 'Açıklama & Form Doldurma', allowed: securityInfo?.permissions.canAnnotate ?? true, icon: Check },
                ].map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2 rounded-lg border border-slate-100 dark:border-slate-800 text-[11px]"
                    >
                      <div className="flex items-center gap-2 text-slate-700 dark:text-slate-300">
                        <Icon className="w-3.5 h-3.5 text-slate-400" />
                        <span>{item.label}</span>
                      </div>
                      <span
                        className={cn(
                          'font-bold',
                          item.allowed ? 'text-emerald-500' : 'text-rose-500'
                        )}
                      >
                        {item.allowed ? 'İzin Verildi' : 'Kısıtlandı'}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
