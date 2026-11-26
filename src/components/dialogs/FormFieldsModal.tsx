import React, { useEffect, useState, useRef, useCallback } from 'react';
import { PDFDocument } from 'pdf-lib';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useFormStore } from '@/store/form-store';
import { PdfFormsEngine } from '@/core/pdf/pdf-forms';
import { PdfLoader } from '@/core/pdf/pdf-loader';
import { historyManager, DocumentStateSnapshotCommand } from '@/core/history/command-manager';
import { FormFieldModel } from '@/types/advanced';
import {
  X,
  CheckSquare,
  CheckCircle2,
  Download,
  Upload,
  Lock,
  RotateCcw,
  Loader2,
  Plus,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import {
  readAuthorizedDocBuffer,
  saveBinaryOrBlobFile,
  syncReplacedActiveDocument,
  useModalEscape,
} from './modal-utils';

export const FormFieldsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { currentDocument, pdfDocProxy } = useDocumentStore();
  const { addToast } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fields, setFields] = useState<FormFieldModel[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFlattening, setIsFlattening] = useState(false);
  const [confirmFlatten, setConfirmFlatten] = useState(false);
  const [deletingFieldName, setDeletingFieldName] = useState<string | null>(null);

  // Create new AcroForm field panel state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newFieldType, setNewFieldType] = useState<FormFieldModel['type']>('text');
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldPage, setNewFieldPage] = useState(1);
  const [newFieldX, setNewFieldX] = useState(72);
  const [newFieldY, setNewFieldY] = useState(120);
  const [newFieldWidth, setNewFieldWidth] = useState(180);
  const [newFieldHeight, setNewFieldHeight] = useState(26);
  const [newFieldOptions, setNewFieldOptions] = useState('Seçenek 1, Seçenek 2');
  const [newFieldDefault, setNewFieldDefault] = useState('');
  const [isCreatingField, setIsCreatingField] = useState(false);

  const busy = isSaving || isFlattening || isCreatingField;

  useModalEscape(isOpen, onClose, busy);

  const loadFields = useCallback(async () => {
    if (!currentDocument || !isOpen) return;
    setIsLoading(true);
    try {
      const list = await PdfFormsEngine.getFormFields(currentDocument.id);
      setFields(list);

      const storeValues = useFormStore.getState().valuesByDoc[currentDocument.id] || {};
      const initial: Record<string, string | boolean> = {};

      list.forEach((f) => {
        initial[f.name] = storeValues[f.name] !== undefined ? storeValues[f.name] : f.value;
      });

      setFormValues(initial);
    } catch (err) {
      console.error(err);
      addToast('Form alanları yüklenirken hata oluştu.', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [currentDocument, isOpen, addToast]);

  const docId = currentDocument?.id;

  useEffect(() => {
    if (!isOpen || !docId) return;
    const doc = useDocumentStore.getState().currentDocument;
    setConfirmFlatten(false);
    setDeletingFieldName(null);
    setShowCreateForm(false);
    setNewFieldPage((doc?.activePageIndex || 0) + 1);
    loadFields();
  }, [isOpen, docId, loadFields]);

  if (!isOpen || !currentDocument) return null;

  const handleFieldChange = (fieldName: string, value: string | boolean) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
    useFormStore.getState().setFieldValue(currentDocument.id, fieldName, value);
  };

  const applyNewBufferWithSnapshot = async (
    nextBuffer: ArrayBuffer,
    description: string,
    valuesToSync?: Record<string, string | boolean>
  ) => {
    const prevDoc = currentDocument;
    const prevProxy = pdfDocProxy;
    const loaded = await PdfLoader.loadDocument(prevDoc.name, nextBuffer, prevDoc.filePath);
    const synced = syncReplacedActiveDocument(loaded.model, loaded.pdfDoc, prevDoc, {
      isModified: true,
      preserveActivePage: true,
    });
    if (valuesToSync) {
      useFormStore.getState().setAllValues(synced.id, valuesToSync);
    }
    historyManager.push(
      new DocumentStateSnapshotCommand(description, prevDoc, prevProxy, synced, loaded.pdfDoc)
    );
    return synced;
  };

  const handleCreateField = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = newFieldName.trim();
    if (!trimmedName) {
      addToast('Lütfen alan adı girin.', 'warning');
      return;
    }
    if (fields.some((f) => f.name === trimmedName)) {
      addToast(`"${trimmedName}" adında bir form alanı zaten mevcut.`, 'warning');
      return;
    }

    const opts = newFieldOptions
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if ((newFieldType === 'dropdown' || newFieldType === 'radio') && opts.length === 0) {
      addToast('Açılır liste veya radyo grubu için en az bir seçenek girin.', 'warning');
      return;
    }

    try {
      setIsCreatingField(true);
      const rawBuffer = await readAuthorizedDocBuffer(currentDocument.id, currentDocument.filePath);
      const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const targetPageIdx = Math.max(0, Math.min(newFieldPage - 1, pdfDoc.getPageCount() - 1));
      const targetPage = pdfDoc.getPage(targetPageIdx);
      const { height: pageHeight } = targetPage.getSize();

      const safeW = Math.max(12, newFieldWidth || 120);
      const safeH = Math.max(12, newFieldHeight || 24);
      const pdfY = Math.max(8, pageHeight - newFieldY - safeH);

      if (newFieldType === 'text') {
        const tf = form.createTextField(trimmedName);
        tf.addToPage(targetPage, { x: newFieldX, y: pdfY, width: safeW, height: safeH });
        if (newFieldDefault) tf.setText(newFieldDefault);
      } else if (newFieldType === 'checkbox') {
        const cb = form.createCheckBox(trimmedName);
        cb.addToPage(targetPage, { x: newFieldX, y: pdfY, width: safeW, height: safeH });
      } else if (newFieldType === 'dropdown') {
        const dd = form.createDropdown(trimmedName);
        dd.addOptions(opts);
        dd.addToPage(targetPage, { x: newFieldX, y: pdfY, width: safeW, height: safeH });
      } else if (newFieldType === 'radio') {
        const rg = form.createRadioGroup(trimmedName);
        opts.forEach((opt, idx) => {
          const optY = Math.max(8, pdfY - idx * (safeH + 6));
          rg.addOptionToPage(opt, targetPage, {
            x: newFieldX,
            y: optY,
            width: safeW,
            height: safeH,
          });
        });
      }

      const bytes = await pdfDoc.save();
      const outBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      await applyNewBufferWithSnapshot(outBuffer, `Form alanı eklendi: ${trimmedName}`, formValues);
      setNewFieldName('');
      setShowCreateForm(false);
      addToast(`"${trimmedName}" form alanı oluşturuldu!`, 'success');
    } catch (err: unknown) {
      console.error('Create form field error:', err);
      addToast('Form alanı oluşturulurken hata oluştu.', 'error');
    } finally {
      setIsCreatingField(false);
    }
  };

  const handleDeleteField = async (fieldName: string) => {
    try {
      setIsSaving(true);
      const rawBuffer = await readAuthorizedDocBuffer(currentDocument.id, currentDocument.filePath);
      const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const field = form.getField(fieldName);
      form.removeField(field);

      const bytes = await pdfDoc.save();
      const outBuffer = bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength
      ) as ArrayBuffer;

      const remainingValues = { ...formValues };
      delete remainingValues[fieldName];
      await applyNewBufferWithSnapshot(outBuffer, `Form alanı silindi: ${fieldName}`, remainingValues);
      setDeletingFieldName(null);
      addToast(`"${fieldName}" alanı silindi.`, 'info');
    } catch (err: unknown) {
      console.error('Delete form field error:', err);
      addToast('Form alanı silinemedi.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      addToast('Form alanları dökümana kaydediliyor...', 'info');

      const prevDoc = currentDocument;
      const prevProxy = pdfDocProxy;

      const result = await PdfFormsEngine.fillFormFields(
        currentDocument.id,
        currentDocument.name,
        formValues
      );

      const synced = syncReplacedActiveDocument(result.model, result.pdfDoc, prevDoc, {
        isModified: true,
        preserveActivePage: true,
      });
      useFormStore.getState().setAllValues(synced.id, formValues);
      historyManager.push(
        new DocumentStateSnapshotCommand(
          'Form alanları güncellendi',
          prevDoc,
          prevProxy,
          synced,
          result.pdfDoc
        )
      );

      addToast('PDF form alanları başarıyla güncellendi!', 'success');
      onClose();
    } catch (err: unknown) {
      console.error(err);
      addToast('Form kaydedilirken hata oluştu.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFlatten = async () => {
    try {
      setIsFlattening(true);
      addToast('Form alanları düzleştiriliyor (kilitleniyor)...', 'info');

      const prevDoc = currentDocument;
      const prevProxy = pdfDocProxy;

      const result = await PdfFormsEngine.flattenFormFields(
        currentDocument.id,
        currentDocument.name,
        formValues
      );

      useFormStore.getState().clearForm(currentDocument.id);

      const synced = syncReplacedActiveDocument(result.model, result.pdfDoc, prevDoc, {
        isModified: true,
        preserveActivePage: true,
      });
      historyManager.push(
        new DocumentStateSnapshotCommand(
          'Form alanları düzleştirildi',
          prevDoc,
          prevProxy,
          synced,
          result.pdfDoc
        )
      );

      addToast('Form alanları kalıcı metne dönüştürüldü ve kilitlendi!', 'success');
      onClose();
    } catch (err: unknown) {
      console.error(err);
      addToast('Düzleştirme sırasında hata oluştu.', 'error');
    } finally {
      setIsFlattening(false);
      setConfirmFlatten(false);
    }
  };

  const handleExportJson = async () => {
    try {
      const dataStr = JSON.stringify(formValues, null, 2);
      const defaultName = `${currentDocument.name.replace(/\.pdf$/i, '')}_form_verileri.json`;
      const saveRes = await saveBinaryOrBlobFile({
        data: dataStr,
        defaultName,
        dialogTitle: 'Form Verilerini JSON Olarak Kaydet',
        filters: [{ name: 'JSON Dosyası', extensions: ['json'] }],
        mimeType: 'application/json;charset=utf-8',
      });
      if (saveRes.status === 'saved') {
        addToast('Form verileri JSON olarak kaydedildi.', 'success');
      } else {
        addToast('Kaydetme iptal edildi.', 'info');
      }
    } catch {
      addToast('Dışa aktarma hatası.', 'error');
    }
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed: unknown = JSON.parse(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          addToast('Geçersiz JSON nesne formatı (anahtar-değer objesi bekleniyor).', 'warning');
          return;
        }

        const record = parsed as Record<string, unknown>;
        const knownMap = new Map(fields.map((f) => [f.name, f]));
        const validated: Record<string, string | boolean> = {};
        let matchedCount = 0;

        for (const [k, v] of Object.entries(record)) {
          const fieldDef = knownMap.get(k);
          if (!fieldDef) continue;
          if (fieldDef.type === 'checkbox') {
            if (typeof v === 'boolean' || v === 'true' || v === 'false') {
              validated[k] = typeof v === 'boolean' ? v : v === 'true';
              matchedCount++;
            }
          } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            validated[k] = String(v);
            matchedCount++;
          }
        }

        if (matchedCount === 0) {
          addToast('JSON içinde mevcut form alanlarıyla eşleşen geçerli veri bulunamadı.', 'warning');
          return;
        }

        setFormValues((prev) => ({ ...prev, ...validated }));
        useFormStore.getState().setAllValues(currentDocument.id, validated);
        addToast(`${matchedCount} form alanı JSON dosyasından yüklendi!`, 'success');
      } catch {
        addToast('JSON dosyası okunamadı.', 'error');
      }
    };
    reader.readAsText(file);
  };

  const handleClearAll = () => {
    const cleared: Record<string, string | boolean> = {};
    fields.forEach((f) => {
      cleared[f.name] = f.type === 'checkbox' ? false : '';
    });
    setFormValues(cleared);
    useFormStore.getState().setAllValues(currentDocument.id, cleared);
    addToast('Tüm form alanları temizlendi.', 'info');
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={() => !busy && onClose()}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImportJson}
          className="hidden"
        />

        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-500 dark:text-sky-400">
              <CheckSquare className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                PDF Form Yöneticisi (AcroForm)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Form alanları oluşturun, doldurun, içe/dışa aktarın veya kilitleyin
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Kapat"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar */}
        <div className="px-6 py-2.5 bg-slate-100/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowCreateForm((prev) => !prev)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Yeni Alan Ekle</span>
            </button>

            {fields.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5 text-sky-500" />
                  <span>JSON İçe Aktar</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportJson}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors shadow-xs"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-500" />
                  <span>JSON Dışa Aktar</span>
                </button>
              </>
            )}
          </div>

          {fields.length > 0 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleClearAll}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Sıfırla</span>
              </button>

              <button
                type="button"
                onClick={() => setConfirmFlatten(true)}
                disabled={isFlattening}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/60 transition-colors"
              >
                <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Düzleştir (Kilitle)</span>
              </button>
            </div>
          )}
        </div>

        {/* Inline Non-Blocking Flatten Confirmation Banner */}
        {confirmFlatten && (
          <div className="px-6 py-3 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 flex items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
              <span>
                Form alanlarını düzleştirmek alanları kalıcı metne dönüştürür ve düzenlemeye kapatır. Onaylıyor musunuz?
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirmFlatten(false)}
                className="px-3 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-semibold"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleFlatten}
                disabled={isFlattening}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold"
              >
                {isFlattening ? 'Kilitleniyor...' : 'Evet, Düzleştir'}
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {/* Create Form Field Builder */}
          {showCreateForm && (
            <form
              onSubmit={handleCreateField}
              className="p-4 rounded-xl bg-sky-50/70 dark:bg-sky-950/25 border border-sky-200 dark:border-sky-800/60 space-y-3 text-xs"
            >
              <div className="font-bold text-sky-700 dark:text-sky-300 flex items-center justify-between">
                <span>Yeni İnteraktif Form Alanı Oluştur</span>
                <button
                  type="button"
                  onClick={() => setShowCreateForm(false)}
                  className="text-slate-400 hover:text-slate-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Alan Türü
                  </label>
                  <select
                    value={newFieldType}
                    onChange={(e) => {
                      const nextType = e.target.value as FormFieldModel['type'];
                      setNewFieldType(nextType);
                      if (nextType === 'checkbox' || nextType === 'radio') {
                        setNewFieldWidth(20);
                        setNewFieldHeight(20);
                      } else {
                        setNewFieldWidth(180);
                        setNewFieldHeight(26);
                      }
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  >
                    <option value="text">Metin Kutusu (Text)</option>
                    <option value="checkbox">Onay Kutusu (Checkbox)</option>
                    <option value="dropdown">Açılır Liste (Dropdown)</option>
                    <option value="radio">Radyo Grubu (Radio)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Alan Adı (Benzersiz)
                  </label>
                  <input
                    type="text"
                    value={newFieldName}
                    onChange={(e) => setNewFieldName(e.target.value)}
                    placeholder="Örn: ad_soyad"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Sayfa No (1–{currentDocument.totalPages})
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={currentDocument.totalPages}
                    value={newFieldPage}
                    onChange={(e) =>
                      setNewFieldPage(
                        Math.max(1, Math.min(currentDocument.totalPages, Number(e.target.value) || 1))
                      )
                    }
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">X (pt)</label>
                  <input
                    type="number"
                    min={0}
                    value={newFieldX}
                    onChange={(e) => setNewFieldX(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Y Üstten (pt)</label>
                  <input
                    type="number"
                    min={0}
                    value={newFieldY}
                    onChange={(e) => setNewFieldY(Math.max(0, Number(e.target.value) || 0))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Genişlik (pt)</label>
                  <input
                    type="number"
                    min={12}
                    value={newFieldWidth}
                    onChange={(e) => setNewFieldWidth(Math.max(12, Number(e.target.value) || 12))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">Yükseklik (pt)</label>
                  <input
                    type="number"
                    min={12}
                    value={newFieldHeight}
                    onChange={(e) => setNewFieldHeight(Math.max(12, Number(e.target.value) || 12))}
                    className="w-full px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              </div>

              {(newFieldType === 'dropdown' || newFieldType === 'radio') && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Seçenekler (Virgülle ayırın)
                  </label>
                  <input
                    type="text"
                    value={newFieldOptions}
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              )}

              {newFieldType === 'text' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Varsayılan Değer (Opsiyonel)
                  </label>
                  <input
                    type="text"
                    value={newFieldDefault}
                    onChange={(e) => setNewFieldDefault(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="submit"
                  disabled={isCreatingField || !newFieldName.trim()}
                  className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white font-semibold flex items-center gap-1.5"
                >
                  {isCreatingField ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Sayfaya Ekle</span>
                </button>
              </div>
            </form>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-6 h-6 text-sky-500 animate-spin mx-auto mb-2" />
              Form alanları taranıyor...
            </div>
          ) : fields.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              <CheckSquare className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
              <p className="font-semibold text-slate-700 dark:text-slate-300">Form Alanı Bulunamadı</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Bu PDF'de henüz interaktif form alanı yok. Yukarıdan &quot;Yeni Alan Ekle&quot; ile oluşturabilirsiniz.
              </p>
            </div>
          ) : (
            fields.map((f) => (
              <div
                key={f.name}
                className="p-3 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-2 transition-all"
              >
                <div className="flex items-center justify-between text-xs gap-2">
                  <label className="font-bold text-slate-800 dark:text-slate-200 truncate">
                    {f.name}
                  </label>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 uppercase">
                      {f.type}
                    </span>

                    {deletingFieldName === f.name ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleDeleteField(f.name)}
                          disabled={busy}
                          className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-semibold"
                        >
                          Sil
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingFieldName(null)}
                          className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-semibold"
                        >
                          Vazgeç
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setDeletingFieldName(f.name)}
                        title="Form alanını sil"
                        className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950/40 text-rose-500"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {f.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer pt-1 text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(formValues[f.name])}
                      onChange={(e) => handleFieldChange(f.name, e.target.checked)}
                      className="w-4 h-4 text-sky-600 rounded focus:ring-sky-500 cursor-pointer accent-sky-500"
                    />
                    <span>{formValues[f.name] ? 'Seçili (İşaretli)' : 'Seçili Değil'}</span>
                  </label>
                ) : f.type === 'dropdown' || f.type === 'radio' ? (
                  <select
                    value={String(formValues[f.name] || '')}
                    onChange={(e) => handleFieldChange(f.name, e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                  >
                    <option value="">-- Seçiniz --</option>
                    {f.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={String(formValues[f.name] || '')}
                    onChange={(e) => handleFieldChange(f.name, e.target.value)}
                    placeholder="Metin girin..."
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500"
                  />
                )}
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/90 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <span className="text-xs text-slate-500">
            {fields.length > 0 ? `${fields.length} interaktif form alanı bulundu` : ''}
          </span>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors disabled:opacity-40"
            >
              Kapat
            </button>
            {fields.length > 0 && (
              <button
                type="button"
                onClick={handleSave}
                disabled={busy}
                className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-bold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                <span>{isSaving ? 'Kaydediliyor...' : 'Değerleri Uygula'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
