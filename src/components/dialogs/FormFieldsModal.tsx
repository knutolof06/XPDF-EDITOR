import React, { useEffect, useState, useRef } from 'react';
import { useDocumentStore } from '@/store/document-store';
import { useUIStore } from '@/store/ui-store';
import { useFormStore } from '@/store/form-store';
import { PdfFormsEngine } from '@/core/pdf/pdf-forms';
import { FormFieldModel } from '@/types/advanced';
import { X, CheckSquare, CheckCircle2, Download, Upload, Lock, RotateCcw, Loader2 } from 'lucide-react';

export const FormFieldsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { currentDocument, setDocument } = useDocumentStore();
  const { addToast } = useUIStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fields, setFields] = useState<FormFieldModel[]>([]);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isFlattening, setIsFlattening] = useState(false);

  useEffect(() => {
    async function loadFields() {
      if (!currentDocument || !isOpen) return;
      setIsLoading(true);
      try {
        const list = await PdfFormsEngine.getFormFields(currentDocument.id);
        setFields(list);

        const storeValues = useFormStore.getState().valuesByDoc[currentDocument.id] || {};
        const initial: Record<string, string | boolean> = {};

        list.forEach((f) => {
          if (storeValues[f.name] !== undefined) {
            initial[f.name] = storeValues[f.name];
          } else {
            initial[f.name] = f.value;
          }
        });

        setFormValues(initial);
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    loadFields();
  }, [currentDocument, isOpen]);

  if (!isOpen || !currentDocument) return null;

  const handleFieldChange = (fieldName: string, value: string | boolean) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
    useFormStore.getState().setFieldValue(currentDocument.id, fieldName, value);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      addToast('Form alanları dökümana kaydediliyor...', 'info');

      const result = await PdfFormsEngine.fillFormFields(
        currentDocument.id,
        currentDocument.name,
        formValues
      );

      // Synchronize back to form store
      useFormStore.getState().setAllValues(currentDocument.id, formValues);

      setDocument(
        {
          ...result.model,
          isModified: true,
          filePath: currentDocument.filePath,
        },
        result.pdfDoc
      );

      addToast('PDF form alanları başarıyla güncellendi!', 'success');
      onClose();
    } catch (err: any) {
      console.error(err);
      addToast('Form kaydedilirken hata oluştu.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleFlatten = async () => {
    if (!window.confirm('Form alanlarını düzleştirmek (flatten) istediğinize emin misiniz? Bu işlem form alanlarını kalıcı vektör metin ve şekillere dönüştürür; alanlar bir daha düzenlenemez hale gelir.')) {
      return;
    }

    try {
      setIsFlattening(true);
      addToast('Form alanları düzleştiriliyor (kilitleniyor)...', 'info');

      const result = await PdfFormsEngine.flattenFormFields(
        currentDocument.id,
        currentDocument.name,
        formValues
      );

      useFormStore.getState().clearForm(currentDocument.id);

      setDocument(
        {
          ...result.model,
          isModified: true,
          filePath: currentDocument.filePath,
        },
        result.pdfDoc
      );

      addToast('Form alanları kalıcı metne dönüştürüldü ve kilitlendi!', 'success');
      onClose();
    } catch (err: any) {
      console.error(err);
      addToast('Düzleştirme sırasında hata oluştu.', 'error');
    } finally {
      setIsFlattening(false);
    }
  };

  const handleExportJson = () => {
    try {
      const dataStr = JSON.stringify(formValues, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${currentDocument.name.replace(/\.pdf$/i, '')}_form_verileri.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addToast('Form verileri JSON olarak indirildi.', 'success');
    } catch (err) {
      addToast('Dışa aktarma hatası.', 'error');
    }
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const imported = JSON.parse(text);
        if (typeof imported === 'object' && imported !== null) {
          setFormValues((prev) => ({ ...prev, ...imported }));
          useFormStore.getState().setAllValues(currentDocument.id, imported);
          addToast('Form verileri JSON dosyasından başarıyla yüklendi!', 'success');
        } else {
          addToast('Geçersiz JSON formatı.', 'warning');
        }
      } catch (err) {
        addToast('JSON dosyası okunamadı.', 'error');
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
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
    <div className="fixed inset-0 z-50 bg-slate-950/60 dark:bg-slate-950/85 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 w-full max-w-xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200 text-slate-800 dark:text-slate-100">
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
              <h3 className="text-base font-bold text-slate-900 dark:text-white">PDF Form Yöneticisi</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Form alanlarını doldurun, içe/dışa aktarın veya kalıcı kilitleyin
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Toolbar */}
        {fields.length > 0 && (
          <div className="px-6 py-2.5 bg-slate-100/70 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors shadow-xs"
                title="JSON formatında kaydedilmiş form verilerini içeri aktar"
              >
                <Upload className="w-3.5 h-3.5 text-sky-500" />
                <span>JSON İçe Aktar</span>
              </button>

              <button
                type="button"
                onClick={handleExportJson}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors shadow-xs"
                title="Doldurulan verileri JSON olarak indir"
              >
                <Download className="w-3.5 h-3.5 text-emerald-500" />
                <span>JSON Dışa Aktar</span>
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleClearAll}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 transition-colors"
                title="Tüm kutuları temizle"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Sıfırla</span>
              </button>

              <button
                type="button"
                onClick={handleFlatten}
                disabled={isFlattening}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700/60 transition-colors"
                title="Form alanlarını kalıcı metne dönüştürüp kilitler"
              >
                <Lock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Formu Düzleştir (Kilitle)</span>
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto space-y-4">
          {isLoading ? (
            <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="w-6 h-6 text-sky-500 animate-spin mx-auto mb-2" />
              Form alanları taranıyor...
            </div>
          ) : fields.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500 dark:text-slate-400">
              <CheckSquare className="w-8 h-8 text-slate-400 dark:text-slate-600 mx-auto mb-2" />
              <p className="font-semibold text-slate-700 dark:text-slate-300">Form Alanı Bulunamadı</p>
              <p className="mt-1 text-[11px] text-slate-500">Bu PDF'de doldurulabilir interaktif form (AcroForm) alanı bulunmuyor.</p>
            </div>
          ) : (
            fields.map((f) => (
              <div
                key={f.name}
                className="p-3 bg-slate-50/70 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 space-y-1.5 transition-all"
              >
                <div className="flex items-center justify-between text-xs">
                  <label className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[320px]">
                    {f.name}
                  </label>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 uppercase">
                    {f.type}
                  </span>
                </div>

                {f.type === 'checkbox' ? (
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer pt-1 text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={Boolean(formValues[f.name])}
                      onChange={(e) => handleFieldChange(f.name, e.target.checked)}
                      className="w-4 h-4 text-sky-600 rounded focus:ring-sky-500 cursor-pointer accent-sky-500"
                    />
                    <span>{Boolean(formValues[f.name]) ? 'Seçili (İşaretli)' : 'Seçili Değil'}</span>
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
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
            >
              Kapat
            </button>
            {fields.length > 0 && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-xs font-bold text-white transition-colors flex items-center gap-1.5 shadow-md shadow-sky-600/20"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                <span>{isSaving ? 'Kaydediliyor...' : 'Değerleri Uygula'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
