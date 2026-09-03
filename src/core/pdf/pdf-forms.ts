import { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import { FormFieldModel } from '@/types/advanced';
import { binaryStore } from '../storage/binary-store';
import { PdfLoader, LoadedPdfResult } from '../pdf/pdf-loader';

export class PdfFormsEngine {
  /**
   * Reads all interactive form fields from the PDF document
   */
  public static async getFormFields(docId: string): Promise<FormFieldModel[]> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) return [];

    try {
      const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
      const form = pdfDoc.getForm();
      const fields = form.getFields();
      const results: FormFieldModel[] = [];

      fields.forEach((field) => {
        const name = field.getName();
        let type: FormFieldModel['type'] = 'text';
        let value: string | boolean = '';
        let options: string[] | undefined;

        if (field instanceof PDFTextField) {
          type = 'text';
          value = field.getText() || '';
        } else if (field instanceof PDFCheckBox) {
          type = 'checkbox';
          value = field.isChecked();
        } else if (field instanceof PDFDropdown) {
          type = 'dropdown';
          value = field.getSelected()[0] || '';
          options = field.getOptions();
        } else if (field instanceof PDFRadioGroup) {
          type = 'radio';
          value = field.getSelected() || '';
          options = field.getOptions();
        }

        results.push({
          name,
          type,
          value,
          options,
          pageIndex: 0,
          rect: { x: 0, y: 0, width: 150, height: 30 },
        });
      });

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Fills form fields and returns updated document
   */
  public static async fillFormFields(
    docId: string,
    docName: string,
    values: Record<string, string | boolean>
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('Döküman verisi bulunamadı.');

    const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    Object.entries(values).forEach(([fieldName, val]) => {
      try {
        const field = form.getField(fieldName);
        if (field instanceof PDFTextField && typeof val === 'string') {
          field.setText(val);
        } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
          if (val) field.check();
          else field.uncheck();
        } else if (field instanceof PDFDropdown && typeof val === 'string') {
          field.select(val);
        } else if (field instanceof PDFRadioGroup && typeof val === 'string') {
          field.select(val);
        }
      } catch (err) {
        console.warn(`Field ${fieldName} could not be updated:`, err);
      }
    });

    const bytes = await pdfDoc.save();
    const outBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    return await PdfLoader.loadDocument(docName, outBuffer);
  }

  /**
   * Flattens all form fields into permanent vector text and shapes.
   * Locked against further editing.
   */
  public static async flattenFormFields(
    docId: string,
    docName: string,
    currentValues?: Record<string, string | boolean>
  ): Promise<LoadedPdfResult> {
    const rawBuffer = binaryStore.get(docId);
    if (!rawBuffer) throw new Error('Döküman verisi bulunamadı.');

    const pdfDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true });
    const form = pdfDoc.getForm();

    // If current in-memory values provided, apply before flattening
    if (currentValues) {
      Object.entries(currentValues).forEach(([fieldName, val]) => {
        try {
          const field = form.getField(fieldName);
          if (field instanceof PDFTextField && typeof val === 'string') {
            field.setText(val);
          } else if (field instanceof PDFCheckBox && typeof val === 'boolean') {
            if (val) field.check();
            else field.uncheck();
          } else if (field instanceof PDFDropdown && typeof val === 'string') {
            field.select(val);
          } else if (field instanceof PDFRadioGroup && typeof val === 'string') {
            field.select(val);
          }
        } catch {}
      });
    }

    form.flatten();

    const bytes = await pdfDoc.save();
    const outBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;

    return await PdfLoader.loadDocument(docName, outBuffer);
  }
}
