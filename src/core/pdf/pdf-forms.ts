import {
  PDFDocument,
  PDFField,
  PDFTextField,
  PDFCheckBox,
  PDFDropdown,
  PDFOptionList,
  PDFRadioGroup,
  PDFButton,
  PDFSignature,
  PDFArray,
  PDFName,
  PDFRef,
} from 'pdf-lib';
import { FormFieldModel } from '@/types/advanced';
import { PdfDocumentModel } from '@/types/document';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from '../pdf/pdf-loader';
import { embedPreferredFont, loadPdfLibSafe, uint8ToArrayBuffer } from './pdf-helpers';
import { useDocumentStore } from '@/store/document-store';
import { useFormStore } from '@/store/form-store';
import { useNativeObjectStore } from '@/store/native-object-store';
import { clearDocumentCaches } from '@/core/cache/render-cache';
import { cloneAnnotation } from '@/core/history/command-manager';

export type ExtendedFormFieldType =
  | FormFieldModel['type']
  | 'option-list'
  | 'button'
  | 'signature';

export interface ExtendedFormFieldModel extends FormFieldModel {
  rawFieldType: ExtendedFormFieldType;
  multiSelect?: boolean;
  selectedValues?: string[];
  readOnly?: boolean;
}

export interface CreateFormFieldOptions {
  name: string;
  type: 'text' | 'checkbox' | 'dropdown' | 'radio';
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  options?: string[];
  defaultValue?: string | boolean;
  multiline?: boolean;
  fontSize?: number;
}

function buildPageRefIndexMap(pdfDoc: PDFDocument): Map<string, number> {
  const map = new Map<string, number>();
  const pages = pdfDoc.getPages();
  pages.forEach((page, idx) => {
    map.set(page.ref.toString(), idx);
  });
  return map;
}

function resolveWidgetPageIndex(
  pdfDoc: PDFDocument,
  widget: ReturnType<PDFField['acroField']['getWidgets']>[number],
  pageRefMap: Map<string, number>
): number {
  try {
    const pRef = widget.P?.();
    if (pRef) {
      const found = pageRefMap.get(pRef.toString());
      if (found !== undefined) return found;
    }
  } catch {
    // fallback to scanning Annots
  }

  const pages = pdfDoc.getPages();
  const widgetRef = pdfDoc.context.getObjectRef(widget.dict);
  for (let i = 0; i < pages.length; i++) {
    const annots = pages[i].node.lookup(PDFName.of('Annots'));
    if (annots instanceof PDFArray) {
      for (let j = 0; j < annots.size(); j++) {
        const entry = annots.get(j);
        if (entry === widget.dict || (widgetRef && entry instanceof PDFRef && entry.toString() === widgetRef.toString())) {
          return i;
        }
      }
    }
  }
  return 0;
}

function applyValuesToPdfForm(
  pdfDoc: PDFDocument,
  values: Record<string, string | boolean | string[]>
): void {
  const form = pdfDoc.getForm();
  Object.entries(values).forEach(([fieldName, val]) => {
    try {
      const field = form.getField(fieldName);
      if (field instanceof PDFButton || field instanceof PDFSignature) {
        return;
      }
      if (field instanceof PDFTextField && typeof val === 'string') {
        field.setText(val);
      } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
        if (val) field.check();
        else field.uncheck();
      } else if (field instanceof PDFDropdown) {
        if (Array.isArray(val)) {
          if (val.length > 0) field.select(val);
        } else if (typeof val === 'string') {
          if (field.isMultiselect() && val.includes(',')) {
            const parts = val
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            if (parts.length > 0) field.select(parts);
          } else if (val !== '') {
            field.select(val);
          }
        }
      } else if (field instanceof PDFOptionList) {
        if (Array.isArray(val)) {
          if (val.length > 0) field.select(val);
        } else if (typeof val === 'string' && val !== '') {
          const parts = field.isMultiselect()
            ? val
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : [val];
          if (parts.length > 0) field.select(parts);
        }
      } else if (field instanceof PDFRadioGroup && typeof val === 'string' && val !== '') {
        field.select(val);
      }
    } catch (err) {
      console.warn(`Field ${fieldName} could not be updated:`, err);
    }
  });
}

async function saveAndReloadPreservingState(
  docId: string,
  docName: string,
  pdfDoc: PDFDocument,
  explicitDocModel?: PdfDocumentModel
): Promise<LoadedPdfResult> {
  const prevDoc =
    explicitDocModel ||
    (useDocumentStore.getState().currentDocument?.id === docId
      ? useDocumentStore.getState().currentDocument
      : null);

  const { font } = await embedPreferredFont(pdfDoc, 'regular', false);
  try {
    pdfDoc.getForm().updateFieldAppearances(font);
  } catch (err) {
    console.warn('Form appearance update warning:', err);
  }

  const bytes = await pdfDoc.save({ updateFieldAppearances: false });
  const outBuffer = uint8ToArrayBuffer(bytes);

  clearDocumentCaches(docId);

  const loaded = await PdfLoader.loadDocument(
    docName,
    outBuffer,
    prevDoc?.filePath,
    undefined,
    { preserveDocId: docId }
  );

  if (prevDoc) {
    loaded.model.isModified = true;
    loaded.model.metadata = {
      ...loaded.model.metadata,
      ...prevDoc.metadata,
      fileSizeFormatted: loaded.model.metadata.fileSizeFormatted,
      pageCount: loaded.model.totalPages,
    };
    loaded.model.activePageIndex = Math.max(
      0,
      Math.min(prevDoc.activePageIndex, Math.max(0, loaded.model.pages.length - 1))
    );
    loaded.model.activePageId = loaded.model.pages[loaded.model.activePageIndex]?.id || '';
    loaded.model.selectedPageIds = loaded.model.activePageId ? [loaded.model.activePageId] : [];

    loaded.model.pages = loaded.model.pages.map((newPage, idx) => {
      const oldPage = prevDoc.pages[idx];
      if (!oldPage) return newPage;
      if (oldPage.id !== newPage.id) {
        useNativeObjectStore.getState().migratePageObjects(oldPage.id, newPage.id);
      }
      return {
        ...newPage,
        rotation: oldPage.rotation,
        crop: oldPage.crop ? { ...oldPage.crop } : undefined,
        annotations: oldPage.annotations.map((ann) => ({
          ...cloneAnnotation(ann),
          pageId: newPage.id,
        })),
      };
    });
  } else {
    loaded.model.isModified = true;
  }

  return loaded;
}

export class PdfFormsEngine {
  /**
   * Reads all interactive form fields from the PDF document with real page indices and rects.
   */
  public static async getFormFields(docId: string): Promise<ExtendedFormFieldModel[]> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) return [];

    const pdfDoc = await loadPdfLibSafe(rawBuffer, 'Form alanlarını okuma');
    const form = pdfDoc.getForm();
    const fields = form.getFields();
    const pageRefMap = buildPageRefIndexMap(pdfDoc);
    const results: ExtendedFormFieldModel[] = [];

    fields.forEach((field) => {
      const name = field.getName();
      let type: FormFieldModel['type'] = 'text';
      let rawFieldType: ExtendedFormFieldType = 'text';
      let value: string | boolean = '';
      let options: string[] | undefined;
      let multiSelect = false;
      let selectedValues: string[] | undefined;
      let readOnly = field.isReadOnly();

      if (field instanceof PDFTextField) {
        type = 'text';
        rawFieldType = 'text';
        value = field.getText() || '';
      } else if (field instanceof PDFCheckBox) {
        type = 'checkbox';
        rawFieldType = 'checkbox';
        value = field.isChecked();
      } else if (field instanceof PDFDropdown) {
        type = 'dropdown';
        rawFieldType = 'dropdown';
        multiSelect = field.isMultiselect();
        selectedValues = field.getSelected();
        value = multiSelect ? selectedValues.join(', ') : selectedValues[0] || '';
        options = field.getOptions();
      } else if (field instanceof PDFOptionList) {
        type = 'dropdown';
        rawFieldType = 'option-list';
        multiSelect = field.isMultiselect();
        selectedValues = field.getSelected();
        value = multiSelect ? selectedValues.join(', ') : selectedValues[0] || '';
        options = field.getOptions();
      } else if (field instanceof PDFRadioGroup) {
        type = 'radio';
        rawFieldType = 'radio';
        value = field.getSelected() || '';
        options = field.getOptions();
      } else if (field instanceof PDFSignature) {
        type = 'text';
        rawFieldType = 'signature';
        value = '[Dijital İmza Alanı]';
        readOnly = true;
      } else if (field instanceof PDFButton) {
        type = 'text';
        rawFieldType = 'button';
        value = '';
        readOnly = true;
      }

      const widgets = field.acroField.getWidgets();
      let pageIndex = 0;
      let rect = { x: 0, y: 0, width: 150, height: 30 };

      if (widgets.length > 0) {
        const firstWidget = widgets[0];
        pageIndex = resolveWidgetPageIndex(pdfDoc, firstWidget, pageRefMap);
        try {
          const r = firstWidget.getRectangle();
          if (r && Number.isFinite(r.x) && Number.isFinite(r.y)) {
            rect = {
              x: r.x,
              y: r.y,
              width: Math.max(1, r.width),
              height: Math.max(1, r.height),
            };
          }
        } catch {
          // fallback rect
        }
      }

      results.push({
        name,
        type,
        rawFieldType,
        value,
        options,
        multiSelect,
        selectedValues,
        readOnly,
        pageIndex,
        rect,
      });
    });

    return results;
  }

  /**
   * Fills form fields and returns updated document while preserving filePath, annotations, and state.
   */
  public static async fillFormFields(
    docId: string,
    docName: string,
    values: Record<string, string | boolean | string[]>,
    docModel?: PdfDocumentModel
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('Döküman verisi bulunamadı.');

    const pdfDoc = await loadPdfLibSafe(rawBuffer, 'Form alanlarını doldurma');
    applyValuesToPdfForm(pdfDoc, values);

    return await saveAndReloadPreservingState(docId, docName, pdfDoc, docModel);
  }

  /**
   * Flattens all form fields into permanent vector text and shapes.
   */
  public static async flattenFormFields(
    docId: string,
    docName: string,
    currentValues?: Record<string, string | boolean | string[]>,
    docModel?: PdfDocumentModel
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('Döküman verisi bulunamadı.');

    const pdfDoc = await loadPdfLibSafe(rawBuffer, 'Form düzleştirme');
    const form = pdfDoc.getForm();

    if (currentValues) {
      applyValuesToPdfForm(pdfDoc, currentValues);
    }

    const { font } = await embedPreferredFont(pdfDoc, 'regular', false);
    try {
      form.updateFieldAppearances(font);
    } catch {
      // ignore individual appearance issues
    }
    form.flatten({ updateFieldAppearances: false });

    const bytes = await pdfDoc.save({ updateFieldAppearances: false });
    const outBuffer = uint8ToArrayBuffer(bytes);

    const prevDoc =
      docModel ||
      (useDocumentStore.getState().currentDocument?.id === docId
        ? useDocumentStore.getState().currentDocument
        : null);

    clearDocumentCaches(docId);
    useFormStore.getState().clearDocValues(docId);

    const loaded = await PdfLoader.loadDocument(
      docName,
      outBuffer,
      prevDoc?.filePath,
      undefined,
      { preserveDocId: docId }
    );
    loaded.model.isModified = true;
    if (prevDoc) {
      loaded.model.metadata = {
        ...loaded.model.metadata,
        ...prevDoc.metadata,
        fileSizeFormatted: loaded.model.metadata.fileSizeFormatted,
      };
      loaded.model.pages = loaded.model.pages.map((newPage, idx) => {
        const oldPage = prevDoc.pages[idx];
        if (!oldPage) return newPage;
        return {
          ...newPage,
          rotation: oldPage.rotation,
          crop: oldPage.crop ? { ...oldPage.crop } : undefined,
          annotations: oldPage.annotations.map((ann) => ({
            ...cloneAnnotation(ann),
            pageId: newPage.id,
          })),
        };
      });
    }

    return loaded;
  }

  /**
   * Creates a new interactive AcroForm field on a specified page and reloads cleanly.
   */
  public static async createFormField(
    docId: string,
    docName: string,
    options: CreateFormFieldOptions,
    docModel?: PdfDocumentModel
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('Döküman verisi bulunamadı.');

    const fieldName = options.name.trim();
    if (!fieldName) throw new Error('Form alanı adı boş olamaz.');

    const pdfDoc = await loadPdfLibSafe(rawBuffer, 'Form alanı oluşturma');
    const pages = pdfDoc.getPages();
    const targetPageIdx = Math.max(0, Math.min(options.pageIndex, pages.length - 1));
    const targetPage = pages[targetPageIdx];
    const form = pdfDoc.getForm();

    if (form.getFields().some((f) => f.getName() === fieldName)) {
      throw new Error(`"${fieldName}" adlı bir form alanı zaten mevcut.`);
    }

    const { font } = await embedPreferredFont(pdfDoc, 'regular', false);
    const { x, y, width, height } = options.rect;

    if (options.type === 'text') {
      const tf = form.createTextField(fieldName);
      if (options.multiline) tf.enableMultiline();
      if (options.fontSize) tf.setFontSize(options.fontSize);
      if (typeof options.defaultValue === 'string' && options.defaultValue) {
        tf.setText(options.defaultValue);
      }
      tf.addToPage(targetPage, { x, y, width, height, font });
    } else if (options.type === 'checkbox') {
      const cb = form.createCheckBox(fieldName);
      cb.addToPage(targetPage, { x, y, width, height });
      if (options.defaultValue === true) {
        cb.check();
      }
    } else if (options.type === 'dropdown') {
      const dd = form.createDropdown(fieldName);
      const opts = options.options && options.options.length > 0 ? options.options : ['Seçenek 1', 'Seçenek 2'];
      dd.addOptions(opts);
      if (typeof options.defaultValue === 'string' && opts.includes(options.defaultValue)) {
        dd.select(options.defaultValue);
      }
      dd.addToPage(targetPage, { x, y, width, height, font });
    } else if (options.type === 'radio') {
      const rg = form.createRadioGroup(fieldName);
      const opts = options.options && options.options.length > 0 ? options.options : ['Seçenek 1', 'Seçenek 2'];
      const optionHeight = Math.max(12, Math.min(height, 20));
      const gap = 4;
      opts.forEach((opt, idx) => {
        const optY = Math.max(0, y - idx * (optionHeight + gap));
        rg.addOptionToPage(opt, targetPage, {
          x,
          y: optY,
          width: Math.min(width, optionHeight),
          height: optionHeight,
        });
      });
      if (typeof options.defaultValue === 'string' && opts.includes(options.defaultValue)) {
        rg.select(options.defaultValue);
      }
    }

    return await saveAndReloadPreservingState(docId, docName, pdfDoc, docModel);
  }

  /**
   * Removes an interactive AcroForm field by name and reloads cleanly.
   */
  public static async removeFormField(
    docId: string,
    docName: string,
    fieldName: string,
    docModel?: PdfDocumentModel
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('Döküman verisi bulunamadı.');

    const pdfDoc = await loadPdfLibSafe(rawBuffer, 'Form alanı silme');
    const form = pdfDoc.getForm();
    const field = form.getField(fieldName);
    form.removeField(field);

    const values = { ...(useFormStore.getState().valuesByDoc[docId] || {}) };
    if (fieldName in values) {
      delete values[fieldName];
      useFormStore.setState((s) => ({
        valuesByDoc: {
          ...s.valuesByDoc,
          [docId]: values,
        },
      }));
    }

    return await saveAndReloadPreservingState(docId, docName, pdfDoc, docModel);
  }
}
