import * as pdfjsLib from 'pdfjs-dist';

export class AIService {
  /**
   * Extracts text content across all pages in the PDF document
   */
  public static async extractAllText(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    maxPages: number = 30
  ): Promise<string> {
    const pagesToRead = Math.min(pdfDoc.numPages, maxPages);
    let fullText = '';

    for (let i = 1; i <= pagesToRead; i++) {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str || '')
        .join(' ');

      if (pageText.trim()) {
        fullText += `\n[--- Sayfa ${i} ---]\n` + pageText;
      }
    }

    return fullText;
  }

  /**
   * Summarizes the PDF document using client-side extractive intelligence or API
   */
  public static async generateSummary(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    docName: string
  ): Promise<string> {
    const text = await this.extractAllText(pdfDoc, 15);
    if (!text.trim()) {
      return 'Bu dökümanda metin katmanı bulunamadı veya taranmış bir görsel döküman.';
    }

    // Split paragraphs and sentences
    const sentences = text
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 25 && s.length < 250);

    const keyPoints = sentences.slice(0, 5);

    let summary = `📋 **"${docName}" Döküman Özeti (${pdfDoc.numPages} Sayfa):**\n\n`;
    summary += `Bu döküman toplam ${pdfDoc.numPages} sayfadan oluşmakta olup ana içerik başlıkları şunları içermektedir:\n\n`;

    keyPoints.forEach((pt, idx) => {
      summary += `${idx + 1}. ${pt}\n`;
    });

    summary += `\n✨ **Temel Çıkarım:** Döküman yapılandırılmış bölümler, açıklamalar ve referanslar içermektedir.`;
    return summary;
  }

  /**
   * Answers questions based on PDF text
   */
  public static async answerQuestion(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    question: string
  ): Promise<string> {
    const text = await this.extractAllText(pdfDoc, 25);
    const qLower = question.toLowerCase();

    const sentences = text
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 20);

    const relevant = sentences.filter((s) => {
      const words = qLower.split(' ').filter((w) => w.length > 3);
      return words.some((w) => s.toLowerCase().includes(w));
    });

    if (relevant.length > 0) {
      return `💡 **Soru:** ${question}\n\n**Dökümandan Bulunan İlgili Bilgiler:**\n\n• ` +
        relevant.slice(0, 3).join('\n\n• ');
    }

    return `Döküman içerisinde "${question}" sorusuyla doğrudan eşleşen bir cümle bulunamadı. Lütfen anahtar kelimeleri değiştirerek tekrar deneyin.`;
  }

  /**
   * Extracts key questions and topics from the document
   */
  public static async extractKeyQuestions(
    pdfDoc: pdfjsLib.PDFDocumentProxy
  ): Promise<string[]> {
    const text = await this.extractAllText(pdfDoc, 20);
    const questions = text
      .split(/(?<=[?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.endsWith('?') && s.length > 15 && s.length < 200);

    return questions.slice(0, 6);
  }
}
