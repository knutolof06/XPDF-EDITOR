import React, { useState, useEffect } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useViewerStore } from '@/store/viewer-store';
import { useTabStore } from '@/store/tab-store';
import { binaryStore } from '@/core/storage/binary-store';
import {
  PdfSecurityEngine,
  DocumentSecurityInfo,
  DocumentPermissions,
} from '@/core/security/pdf-security';
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
  MessageSquare,
  FileCheck2,
  Layers,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
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

async function savePdfOutput(
  bytes: ArrayBuffer,
  defaultFileName: string,
  dialogTitle: string
): Promise<'saved' | 'canceled'> {
  const electron = window.electronAPI;
  if (electron?.showSaveDialog && electron?.saveFile) {
    const dialogRes = await electron.showSaveDialog({
      title: dialogTitle,
      defaultPath: defaultFileName,
      filters: [{ name: 'PDF Dosyası', extensions: ['pdf'] }],
    });
    if (dialogRes.canceled || !dialogRes.filePath) {
      return 'canceled';
    }
    const saveRes = await electron.saveFile(dialogRes.filePath, bytes);
    if (!saveRes.success) {
      throw new Error(saveRes.error || 'Dosya diske kaydedilemedi.');
    }
    return 'saved';
  }

  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = defaultFileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}

export const SecurityPermissionsModal: React.FC = () => {
  const { isSecurityModalOpen, setSecurityModalOpen, addToast } = useUIStore();
  const { currentDocument, pdfDocProxy, setDocument } = useDocumentStore();
  const { addTab } = useTabStore();
  const theme = useViewerStore((s) => s.theme);
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(theme));

  const [activeTab, setActiveTab] = useState<'encrypt' | 'decrypt' | 'info'>('encrypt');
  const [securityInfo, setSecurityInfo] = useState<DocumentSecurityInfo | null>(null);

  // Encryption inputs
  const [userPassword, setUserPassword] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [showUserPwd, setShowUserPwd] = useState(false);
  const [showOwnerPwd, setShowOwnerPwd] = useState(false);

  // Decryption input
  const [decryptPassword, setDecryptPassword] = useState('');
  const [showDecryptPwd, setShowDecryptPwd] = useState(false);

  const [permissions, setPermissions] = useState<DocumentPermissions>({
    canPrint: true,
    canCopy: true,
    canModify: false,
    canAnnotate: true,
    canFillForms: true,
    canAssemble: false,
  });

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  // Sync dark mode including system theme changes
  useEffect(() => {
    setIsDark(resolveIsDark(theme));
    if (theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setIsDark(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  // Clear sensitive passwords on close, document change, or unmount
  const resetPasswords = () => {
    setUserPassword('');
    setOwnerPassword('');
    setDecryptPassword('');
    setShowUserPwd(false);
    setShowOwnerPwd(false);
    setShowDecryptPwd(false);
    setErrorMessage(null);
  };

  useEffect(() => {
    if (!isSecurityModalOpen) {
      resetPasswords();
      setSecurityInfo(null);
    }
    return () => {
      setUserPassword('');
      setOwnerPassword('');
      setDecryptPassword('');
    };
  }, [isSecurityModalOpen, currentDocument?.id]);

  // Load current document security metadata
  useEffect(() => {
    if (!isSecurityModalOpen || !pdfDocProxy || !currentDocument) return;
    let active = true;
    const rawBuffer = binaryStore.get(currentDocument.id);

    PdfSecurityEngine.getDocumentSecurity(pdfDocProxy, rawBuffer).then((info) => {
      if (!active) return;
      setSecurityInfo(info);
      setActiveTab(info.isEncrypted ? 'decrypt' : 'encrypt');
    });

    return () => {
      active = false;
    };
  }, [isSecurityModalOpen, pdfDocProxy, currentDocument]);

  if (!isSecurityModalOpen || !currentDocument) return null;

  const handleClose = () => {
    resetPasswords();
    setSecurityModalOpen(false);
  };

  // 1. Encrypt and Save/Download
  const handleEncryptAndDownload = async () => {
    setErrorMessage(null);
    if (!userPassword && !ownerPassword) {
      const msg = 'Lütfen en az bir açılış parolası veya yönetici parolası belirleyin.';
      setErrorMessage(msg);
      addToast(msg, 'warning');
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
      const saveOutcome = await savePdfOutput(
        encryptedBytes,
        `${baseName}_sifreli.pdf`,
        'Şifreli PDF Kaydet'
      );

      if (saveOutcome === 'canceled') {
        addToast('Kaydetme işlemi iptal edildi.', 'info');
        return;
      }

      addToast('Belge başarıyla şifrelendi ve kaydedildi.', 'success');
      handleClose();
    } catch (err: unknown) {
      console.error('Encrypt error:', err);
      const msg = err instanceof Error ? err.message : 'Şifreleme sırasında bir hata oluştu.';
      setErrorMessage(msg);
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. Remove Password / Decrypt (requires verifying current password)
  const handleRemovePassword = async (openInNewTab: boolean = false) => {
    setErrorMessage(null);
    if (!securityInfo?.isEncrypted) {
      const msg = 'Bu belge zaten şifresizdir.';
      setErrorMessage(msg);
      addToast(msg, 'info');
      return;
    }

    if (!decryptPassword) {
      const msg = 'Şifreyi kaldırmak için lütfen mevcut belge veya yönetici parolasını girin.';
      setErrorMessage(msg);
      addToast(msg, 'warning');
      return;
    }

    const rawBuffer = binaryStore.get(currentDocument.id);
    if (!rawBuffer) {
      addToast('Döküman verisi bulunamadı.', 'error');
      return;
    }

    setIsProcessing(true);
    try {
      const cleanBuffer = await PdfSecurityEngine.removePassword(rawBuffer, decryptPassword);

      if (openInNewTab) {
        const cleanName = `Korumasiz_${currentDocument.name}`;
        const { model, pdfDoc } = await PdfLoader.loadDocument(cleanName, cleanBuffer);
        addTab(model, pdfDoc);
        setDocument(model, pdfDoc);
        addToast('Şifresi kaldırılmış döküman yeni sekmede açıldı!', 'success');
        handleClose();
      } else {
        const baseName = currentDocument.name.replace(/\.[^/.]+$/, '');
        const saveOutcome = await savePdfOutput(
          cleanBuffer,
          `${baseName}_sifresiz.pdf`,
          'Şifresiz PDF Kaydet'
        );
        if (saveOutcome === 'canceled') {
          addToast('Kaydetme işlemi iptal edildi.', 'info');
          return;
        }
        addToast('Şifresiz PDF dosyası başarıyla kaydedildi!', 'success');
        handleClose();
      }
    } catch (err: unknown) {
      console.error('Remove password error:', err);
      const msg = err instanceof Error ? err.message : 'Şifre kaldırılırken hata oluştu.';
      setErrorMessage(msg);
      addToast(msg, 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  const inputClass = cn(
    'w-full pl-9 pr-9 py-2 rounded-xl border focus:outline-none focus:ring-2 focus:ring-sky-500 text-xs font-medium',
    isDark ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-300 text-slate-900'
  );

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
            type="button"
            onClick={handleClose}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-6 pt-3 flex gap-2 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('encrypt');
              setErrorMessage(null);
            }}
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
            type="button"
            onClick={() => {
              setActiveTab('decrypt');
              setErrorMessage(null);
            }}
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
            type="button"
            onClick={() => {
              setActiveTab('info');
              setErrorMessage(null);
            }}
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
        <div className="p-6 overflow-y-auto max-h-[68vh] space-y-4">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. ENCRYPT TAB */}
          {activeTab === 'encrypt' && (
            <div className="space-y-4 text-xs">
              {securityInfo?.isEncrypted && (
                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[11px]">
                  Bu belge zaten şifrelidir. Yeniden şifrelemeden önce <strong>Şifreyi Kaldır</strong> sekmesinden mevcut korumayı kaldırın.
                </div>
              )}

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Açılış Parolası (Kullanıcı Parolası)
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type={showUserPwd ? 'text' : 'password'}
                    value={userPassword}
                    onChange={(e) => {
                      setUserPassword(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="Boş bırakılabilir (yalnızca yönetici kilidi için)..."
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowUserPwd((p) => !p)}
                    aria-label={showUserPwd ? 'Açılış parolasını gizle' : 'Açılış parolasını göster'}
                    className="absolute right-2.5 top-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showUserPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Yönetici Parolası (İzin Kilidi)
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type={showOwnerPwd ? 'text' : 'password'}
                    value={ownerPassword}
                    onChange={(e) => {
                      setOwnerPassword(e.target.value);
                      if (errorMessage) setErrorMessage(null);
                    }}
                    placeholder="İzinleri kilitlemek için yönetici parolası..."
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => setShowOwnerPwd((p) => !p)}
                    aria-label={showOwnerPwd ? 'Yönetici parolasını gizle' : 'Yönetici parolasını göster'}
                    className="absolute right-2.5 top-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showOwnerPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  Açılış parolası boş bırakılıp yalnızca yönetici parolası girilirse belge parolasız açılır ancak aşağıdaki izin kısıtlamaları uygulanır.
                </p>
              </div>

              {/* Permissions Checkboxes — ALL 6 PDF Standard Flags */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <span className="font-bold text-slate-800 dark:text-slate-200 block">
                  Kullanıcı İzinleri:
                </span>

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
                    checked={permissions.canModify}
                    onChange={(e) => setPermissions({ ...permissions, canModify: e.target.checked })}
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Belge içeriğini değiştirmeye izin ver</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.canAnnotate}
                    onChange={(e) =>
                      setPermissions({ ...permissions, canAnnotate: e.target.checked })
                    }
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Açıklama ve yorum eklemeye izin ver</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.canFillForms}
                    onChange={(e) =>
                      setPermissions({ ...permissions, canFillForms: e.target.checked })
                    }
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Form alanlarını doldurmaya ve imzalamaya izin ver</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={permissions.canAssemble}
                    onChange={(e) =>
                      setPermissions({ ...permissions, canAssemble: e.target.checked })
                    }
                    className="w-4 h-4 rounded text-sky-500"
                  />
                  <span>Sayfa ekleme, silme ve döndürmeye (birleştirmeye) izin ver</span>
                </label>
              </div>

              <div className="pt-3">
                <button
                  type="button"
                  onClick={handleEncryptAndDownload}
                  disabled={
                    isProcessing ||
                    Boolean(securityInfo?.isEncrypted) ||
                    (!userPassword && !ownerPassword)
                  }
                  className="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Lock className="w-4 h-4" />
                  )}
                  <span>Belgeyi Şifrele ve Kaydet</span>
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
                  Belgedeki şifreleme koruması kriptografik olarak doğrulanıp çözülecek ve şifresiz yeni bir PDF oluşturulacaktır.
                </p>
              </div>

              {securityInfo && !securityInfo.isEncrypted ? (
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 text-[11px]">
                  Bu belge şu anda şifreli değildir; parola kaldırma işlemi gerekmez.
                </div>
              ) : (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Mevcut Belge veya Yönetici Parolası*
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showDecryptPwd ? 'text' : 'password'}
                      value={decryptPassword}
                      onChange={(e) => {
                        setDecryptPassword(e.target.value);
                        if (errorMessage) setErrorMessage(null);
                      }}
                      placeholder="Doğrulama için mevcut parolayı girin..."
                      className={inputClass}
                    />
                    <button
                      type="button"
                      onClick={() => setShowDecryptPwd((p) => !p)}
                      aria-label={showDecryptPwd ? 'Parolayı gizle' : 'Parolayı göster'}
                      className="absolute right-2.5 top-2 p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      {showDecryptPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleRemovePassword(false)}
                  disabled={isProcessing || !securityInfo?.isEncrypted || !decryptPassword}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>Şifresiz Kaydet</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRemovePassword(true)}
                  disabled={isProcessing || !securityInfo?.isEncrypted || !decryptPassword}
                  className="flex-1 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-md transition-all"
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FilePlus className="w-4 h-4" />
                  )}
                  <span>Yeni Sekmede Aç</span>
                </button>
              </div>
            </div>
          )}

          {/* 3. PERMISSIONS INFO TAB */}
          {activeTab === 'info' && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-800">
                <div>
                  <span className="font-semibold block">Şifreleme Durumu:</span>
                  {securityInfo?.securityHandler && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Motor: {securityInfo.securityHandler}
                    </span>
                  )}
                </div>
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
                <span className="font-bold block text-slate-700 dark:text-slate-300">
                  İzin Matrisi:
                </span>

                {[
                  {
                    label: 'Belge Yazdırma',
                    allowed: securityInfo?.permissions.canPrint ?? true,
                    icon: Printer,
                  },
                  {
                    label: 'Metin ve Görsel Kopyalama',
                    allowed: securityInfo?.permissions.canCopy ?? true,
                    icon: Copy,
                  },
                  {
                    label: 'İçerik Değiştirme',
                    allowed: securityInfo?.permissions.canModify ?? true,
                    icon: Edit3,
                  },
                  {
                    label: 'Açıklama ve Yorum Ekleme',
                    allowed: securityInfo?.permissions.canAnnotate ?? true,
                    icon: MessageSquare,
                  },
                  {
                    label: 'Form Alanı Doldurma ve İmzalama',
                    allowed: securityInfo?.permissions.canFillForms ?? true,
                    icon: FileCheck2,
                  },
                  {
                    label: 'Sayfa Düzenleme / Birleştirme',
                    allowed: securityInfo?.permissions.canAssemble ?? true,
                    icon: Layers,
                  },
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
