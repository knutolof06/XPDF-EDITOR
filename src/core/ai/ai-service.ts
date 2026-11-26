import type * as pdfjsLib from 'pdfjs-dist';
import type { AIConfig, AIChatMessage } from '@/types/advanced';
import { AI_PROVIDER_DEFAULTS } from './ai-store';

export interface IndexedPage {
  pageNumber: number;
  text: string;
}

export interface IndexedChunk {
  id: string;
  pageNumber: number;
  text: string;
  length: number;
  termFreqs: Map<string, number>;
  foldedTermFreqs: Map<string, number>;
}

export interface DocumentIndex {
  totalPages: number;
  pages: IndexedPage[];
  chunks: IndexedChunk[];
  docFreq: Map<string, number>;
  foldedDocFreq: Map<string, number>;
  avgChunkLength: number;
  outlineTitles: string[];
}

export interface RankedChunkResult {
  pageNumber: number;
  snippet: string;
  fullChunk: string;
  score: number;
  matchedTerms: string[];
}

export interface AIResponseSource {
  pageNumber: number;
  snippet: string;
}

export interface AIResponseResult {
  content: string;
  sources: AIResponseSource[];
  usedProvider: AIConfig['provider'];
}

export interface AIRequestOptions {
  config?: AIConfig;
  history?: AIChatMessage[];
  signal?: AbortSignal;
}

const TURKISH_STOP_WORDS = new Set([
  // Turkish
  'acaba', 'ama', 'ancak', 'artık', 'aslında', 'ayrıca', 'az', 'bana', 'bazı', 'belki',
  'ben', 'beni', 'benim', 'beri', 'bile', 'bir', 'biraz', 'birçok', 'biri', 'birkaç',
  'birşey', 'biz', 'bize', 'bizi', 'bizim', 'bu', 'buna', 'bunu', 'bunun', 'burada',
  'böyle', 'bütün', 'çok', 'çünkü', 'da', 'daha', 'dahi', 'de', 'defa', 'değil',
  'diğer', 'diye', 'dolayı', 'en', 'eğer', 'fakat', 'falan', 'filan', 'gibi', 'göre',
  'hala', 'hangi', 'hani', 'hatta', 'hem', 'henüz', 'hep', 'hepsi', 'her', 'herkes',
  'hiç', 'için', 'ile', 'ilgili', 'ise', 'işte', 'kadar', 'karşı', 'kendi', 'kendine',
  'ki', 'kim', 'kime', 'kimi', 'kimse', 'madem', 'mı', 'mi', 'mu', 'mü', 'nasıl',
  'ne', 'neden', 'nerede', 'nereye', 'neyse', 'niçin', 'niye', 'olan', 'olarak', 'oldu',
  'olduğu', 'olduğunu', 'olmak', 'olması', 'olur', 'ona', 'onlar', 'onları', 'onların',
  'onu', 'onun', 'oysa', 'pek', 'rağmen', 'sadece', 'sanki', 'sen', 'senden', 'seni',
  'senin', 'siz', 'size', 'sizi', 'sizin', 'şey', 'şimdi', 'şöyle', 'şu', 'şuna', 'şunu',
  'tabii', 'tamam', 'tarafından', 'tüm', 'üzere', 'var', 've', 'veya', 'ya', 'yani',
  'yerine', 'yine', 'yok', 'zaten',
  // English
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has',
  'have', 'had', 'not', 'but', 'what', 'when', 'where', 'which', 'who', 'why', 'how',
  'can', 'could', 'would', 'should', 'will', 'into', 'about', 'than', 'then', 'there',
]);

const documentIndexCache = new WeakMap<pdfjsLib.PDFDocumentProxy, DocumentIndex>();

function createAbortError(message = 'İstek iptal edildi.'): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, 'AbortError');
  }
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function foldTurkishDiacritics(input: string): string {
  return input
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u');
}

export function tokenizeTurkishText(text: string, dropStopWords = true): string[] {
  if (!text) return [];
  const lower = text.toLocaleLowerCase('tr-TR');
  const rawTokens = lower.match(/[\p{L}\p{N}]+/gu) || [];
  const filtered = rawTokens.filter((t) => {
    if (t.length < 2) return false;
    if (dropStopWords && TURKISH_STOP_WORDS.has(t)) return false;
    return true;
  });

  if (filtered.length === 0 && dropStopWords) {
    return rawTokens.filter((t) => t.length >= 2);
  }
  return filtered;
}

function reconstructPageText(items: unknown[]): string {
  const lines: string[] = [];
  let currentLine = '';
  let lastY: number | null = null;

  for (const rawItem of items) {
    const item = rawItem as { str?: string; hasEOL?: boolean; transform?: number[] };
    const str = item?.str ?? '';
    const y = Array.isArray(item?.transform) ? item.transform[5] : null;

    if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = str;
    } else {
      if (currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ')) {
        currentLine += ' ' + str;
      } else {
        currentLine += str;
      }
    }

    if (item?.hasEOL) {
      if (currentLine.trim()) lines.push(currentLine.trim());
      currentLine = '';
      lastY = null;
    } else if (y !== null) {
      lastY = y;
    }
  }

  if (currentLine.trim()) {
    lines.push(currentLine.trim());
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function chunkPageText(pageNumber: number, pageText: string): IndexedChunk[] {
  const clean = pageText.trim();
  if (!clean) return [];

  const MAX_CHUNK_CHARS = 950;
  const OVERLAP_CHARS = 120;
  const segments: string[] = [];

  if (clean.length <= MAX_CHUNK_CHARS) {
    segments.push(clean);
  } else {
    let start = 0;
    while (start < clean.length) {
      let end = Math.min(clean.length, start + MAX_CHUNK_CHARS);
      if (end < clean.length) {
        const lastBoundary = Math.max(
          clean.lastIndexOf('\n', end),
          clean.lastIndexOf('. ', end),
          clean.lastIndexOf(' ', end)
        );
        if (lastBoundary > start + MAX_CHUNK_CHARS * 0.5) {
          end = lastBoundary + 1;
        }
      }
      const slice = clean.slice(start, end).trim();
      if (slice) segments.push(slice);
      if (end >= clean.length) break;
      start = Math.max(start + 1, end - OVERLAP_CHARS);
    }
  }

  return segments.map((seg, idx) => {
    const tokens = tokenizeTurkishText(seg, false);
    const termFreqs = new Map<string, number>();
    const foldedTermFreqs = new Map<string, number>();

    for (const tok of tokens) {
      termFreqs.set(tok, (termFreqs.get(tok) || 0) + 1);
      const folded = foldTurkishDiacritics(tok);
      foldedTermFreqs.set(folded, (foldedTermFreqs.get(folded) || 0) + 1);
    }

    return {
      id: `p${pageNumber}_c${idx}`,
      pageNumber,
      text: seg,
      length: tokens.length || 1,
      termFreqs,
      foldedTermFreqs,
    };
  });
}

function extractBestSnippet(chunkText: string, queryTokens: string[]): string {
  const sentences = chunkText
    .split(/(?<=[.?!\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length === 0) return chunkText.slice(0, 260);

  const foldedQueries = queryTokens.map(foldTurkishDiacritics);
  let bestIdx = 0;
  let bestHits = -1;

  for (let i = 0; i < sentences.length; i++) {
    const sFolded = foldTurkishDiacritics(sentences[i]);
    let hits = 0;
    for (const qt of foldedQueries) {
      if (sFolded.includes(qt)) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestIdx = i;
    }
  }

  const chosen = sentences.slice(Math.max(0, bestIdx), Math.min(sentences.length, bestIdx + 2)).join(' ');
  return chosen.length > 320 ? chosen.slice(0, 317) + '...' : chosen;
}

export class AIService {
  /**
   * Returns true if the active config points to a usable external LLM endpoint.
   */
  public static isExternalProviderReady(config?: AIConfig): boolean {
    if (!config || config.provider === 'local') return false;
    const meta = AI_PROVIDER_DEFAULTS[config.provider];
    if (!meta) return false;
    if (config.provider === 'custom') {
      return Boolean(config.baseUrl?.trim() && config.model?.trim());
    }
    if (config.provider === 'ollama') {
      return Boolean((config.baseUrl?.trim() || meta.defaultBaseUrl) && config.model?.trim());
    }
    return Boolean(config.apiKey?.trim() && config.model?.trim());
  }

  /**
   * Extracts text from ALL pages of the PDF (no arbitrary 15-30 page truncation)
   * and builds a BM25 inverted index cached per PDFDocumentProxy.
   */
  public static async buildDocumentIndex(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    signal?: AbortSignal
  ): Promise<DocumentIndex> {
    throwIfAborted(signal);
    const cached = documentIndexCache.get(pdfDoc);
    if (cached && cached.totalPages === pdfDoc.numPages) {
      return cached;
    }

    const pages: IndexedPage[] = [];
    const chunks: IndexedChunk[] = [];
    const docFreq = new Map<string, number>();
    const foldedDocFreq = new Map<string, number>();
    let totalLen = 0;

    for (let p = 1; p <= pdfDoc.numPages; p++) {
      throwIfAborted(signal);
      const page = await pdfDoc.getPage(p);
      throwIfAborted(signal);
      const textContent = await page.getTextContent();
      const pageText = reconstructPageText(textContent.items as unknown[]);
      if (pageText) {
        pages.push({ pageNumber: p, text: pageText });
        const pageChunks = chunkPageText(p, pageText);
        for (const ch of pageChunks) {
          chunks.push(ch);
          totalLen += ch.length;
          for (const term of ch.termFreqs.keys()) {
            docFreq.set(term, (docFreq.get(term) || 0) + 1);
          }
          for (const fTerm of ch.foldedTermFreqs.keys()) {
            foldedDocFreq.set(fTerm, (foldedDocFreq.get(fTerm) || 0) + 1);
          }
        }
      }
    }

    let outlineTitles: string[] = [];
    try {
      const outline = await pdfDoc.getOutline();
      if (Array.isArray(outline)) {
        const collect = (nodes: typeof outline, depth = 0) => {
          for (const node of nodes) {
            if (node?.title && outlineTitles.length < 25) {
              outlineTitles.push(`${'  '.repeat(depth)}${node.title.trim()}`);
            }
            if (Array.isArray(node?.items) && node.items.length > 0 && depth < 2) {
              collect(node.items, depth + 1);
            }
          }
        };
        collect(outline);
      }
    } catch {
      outlineTitles = [];
    }

    const index: DocumentIndex = {
      totalPages: pdfDoc.numPages,
      pages,
      chunks,
      docFreq,
      foldedDocFreq,
      avgChunkLength: chunks.length > 0 ? totalLen / chunks.length : 1,
      outlineTitles,
    };

    documentIndexCache.set(pdfDoc, index);
    return index;
  }

  /**
   * Extracts text from all pages (or up to optional maxPages when explicitly requested).
   */
  public static async extractAllText(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    maxPages?: number,
    signal?: AbortSignal
  ): Promise<string> {
    const idx = await this.buildDocumentIndex(pdfDoc, signal);
    const limit = maxPages !== undefined ? Math.min(maxPages, idx.totalPages) : idx.totalPages;
    return idx.pages
      .filter((p) => p.pageNumber <= limit)
      .map((p) => `[Sayfa ${p.pageNumber}]\n${p.text}`)
      .join('\n\n');
  }

  /**
   * Performs Turkish-aware Okapi BM25 ranking across ALL chunks in the PDF.
   */
  public static async searchDocumentBM25(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    query: string,
    topK: number = 8,
    signal?: AbortSignal
  ): Promise<RankedChunkResult[]> {
    const index = await this.buildDocumentIndex(pdfDoc, signal);
    if (index.chunks.length === 0) return [];

    const queryTokens = tokenizeTurkishText(query, true);
    if (queryTokens.length === 0) return [];

    const N = index.chunks.length;
    const avgLen = Math.max(1, index.avgChunkLength);
    const k1 = 1.5;
    const b = 0.75;

    const scored: RankedChunkResult[] = [];

    for (const chunk of index.chunks) {
      let score = 0;
      const matchedTerms = new Set<string>();

      for (const qTok of queryTokens) {
        const qFolded = foldTurkishDiacritics(qTok);
        const exactTf = chunk.termFreqs.get(qTok) || 0;
        const foldedTf = chunk.foldedTermFreqs.get(qFolded) || 0;

        // Prefix/stem match for Turkish agglutinative suffixes (e.g. sözleşme -> sözleşmenin)
        let prefixTf = 0;
        if (exactTf === 0 && foldedTf === 0 && qFolded.length >= 4) {
          const stem = qFolded.slice(0, Math.min(qFolded.length, 6));
          for (const [term, count] of chunk.foldedTermFreqs.entries()) {
            if (term.startsWith(stem) || (term.length >= 4 && qFolded.startsWith(term))) {
              prefixTf += count;
            }
          }
        }

        const effectiveTf = exactTf > 0 ? exactTf : foldedTf > 0 ? foldedTf * 0.85 : prefixTf * 0.55;
        if (effectiveTf <= 0) continue;

        matchedTerms.add(qTok);
        const df =
          exactTf > 0
            ? index.docFreq.get(qTok) || 1
            : index.foldedDocFreq.get(qFolded) || 1;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const normLen = 1 - b + b * (chunk.length / avgLen);
        score += idf * ((effectiveTf * (k1 + 1)) / (effectiveTf + k1 * normLen));
      }

      // Bonus for multi-term co-occurrence and exact phrase match
      if (matchedTerms.size > 1) {
        score *= 1 + 0.15 * (matchedTerms.size - 1);
      }
      if (queryTokens.length >= 2) {
        const qNorm = foldTurkishDiacritics(query.trim());
        if (qNorm.length > 4 && foldTurkishDiacritics(chunk.text).includes(qNorm)) {
          score *= 1.35;
        }
      }

      if (score > 0) {
        scored.push({
          pageNumber: chunk.pageNumber,
          snippet: extractBestSnippet(chunk.text, queryTokens),
          fullChunk: chunk.text,
          score,
          matchedTerms: Array.from(matchedTerms),
        });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /**
   * Summarizes the entire PDF using external LLM (if configured) or honest local analysis.
   */
  public static async generateSummary(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    docName: string,
    options: AIRequestOptions = {}
  ): Promise<AIResponseResult> {
    const index = await this.buildDocumentIndex(pdfDoc, options.signal);

    if (index.chunks.length === 0) {
      return {
        content:
          'Bu belgede seçilebilir metin katmanı bulunamadı (taranmış görsel PDF olabilir). İçeriği analiz edebilmek için önce **Metin Tanıma (OCR)** aracını çalıştırabilirsiniz.',
        sources: [],
        usedProvider: 'local',
      };
    }

    const config = options.config;
    if (config && this.isExternalProviderReady(config)) {
      const sampledPages = this.sampleRepresentativePages(index, 12, 13000);
      const outlineBlock =
        index.outlineTitles.length > 0
          ? `Belge İçindekiler Başlıkları:\n${index.outlineTitles.join('\n')}\n\n`
          : '';
      const contextText =
        outlineBlock +
        sampledPages.map((p) => `[Sayfa ${p.pageNumber}]\n${p.text}`).join('\n\n');

      const prompt = `Lütfen "${docName}" (${index.totalPages} sayfa) adlı PDF belgesini Türkçe olarak net, yapılandırılmış ve gerçeğe sadık biçimde özetle. Önemli noktaları madde işaretleriyle belirt ve bilgi aldığın sayfaları mutlaka [Sayfa N] biçiminde referans göster.`;
      const reply = await this.callExternalLLM(config, prompt, contextText, options.history, options.signal);
      return {
        content: reply,
        sources: sampledPages.slice(0, 6).map((p) => ({
          pageNumber: p.pageNumber,
          snippet: p.text.slice(0, 140),
        })),
        usedProvider: config.provider,
      };
    }

    // Enhanced Honest Local Summary
    const keyTerms = this.extractTopKeyTerms(index, 10);
    const sampled = this.sampleRepresentativePages(index, 6, 6000);
    const sources: AIResponseSource[] = [];
    const bulletLines: string[] = [];

    for (const p of sampled) {
      const sentences = p.text
        .split(/(?<=[.?!])\s+|\n+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 25 && s.length <= 260);
      const bestSentence = sentences[0] || p.text.slice(0, 200).trim();
      if (bestSentence) {
        bulletLines.push(`- [Sayfa ${p.pageNumber}] ${bestSentence}`);
        sources.push({ pageNumber: p.pageNumber, snippet: bestSentence.slice(0, 150) });
      }
    }

    let content = `### "${docName}" — Yerel Belge Analizi (${index.totalPages} Sayfa)\n\n`;
    content += `**İndekslenen Sayfa:** ${index.pages.length} / ${index.totalPages}\n`;
    if (keyTerms.length > 0) {
      content += `**Öne Çıkan Anahtar Kavramlar:** ${keyTerms.map((t) => `\`${t}\``).join(', ')}\n\n`;
    }
    if (index.outlineTitles.length > 0) {
      content += `**Belge Bölüm Başlıkları:**\n`;
      index.outlineTitles.slice(0, 8).forEach((title) => {
        content += `- ${title}\n`;
      });
      content += '\n';
    }
    content += `**Belge Genelinden Öne Çıkan Bölümler:**\n`;
    content += bulletLines.join('\n');

    return {
      content,
      sources,
      usedProvider: 'local',
    };
  }

  /**
   * Answers user questions grounded on BM25-retrieved pages across the ENTIRE PDF.
   */
  public static async answerQuestion(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    question: string,
    options: AIRequestOptions = {}
  ): Promise<AIResponseResult> {
    const index = await this.buildDocumentIndex(pdfDoc, options.signal);
    if (index.chunks.length === 0) {
      return {
        content:
          'Bu belgede metin katmanı bulunamadı. Sorunuzu yanıtlayabilmek için önce OCR ile metin katmanı ekleyin.',
        sources: [],
        usedProvider: 'local',
      };
    }

    const ranked = await this.searchDocumentBM25(pdfDoc, question, 8, options.signal);
    const sources: AIResponseSource[] = ranked.slice(0, 5).map((r) => ({
      pageNumber: r.pageNumber,
      snippet: r.snippet,
    }));

    const config = options.config;
    if (config && this.isExternalProviderReady(config)) {
      const contextChunks =
        ranked.length > 0
          ? ranked.map((r) => `[Sayfa ${r.pageNumber}]\n${r.fullChunk}`).join('\n\n')
          : this.sampleRepresentativePages(index, 6, 8000)
              .map((p) => `[Sayfa ${p.pageNumber}]\n${p.text}`)
              .join('\n\n');

      const reply = await this.callExternalLLM(
        config,
        question,
        contextChunks,
        options.history,
        options.signal
      );

      return {
        content: reply,
        sources,
        usedProvider: config.provider,
      };
    }

    // Honest Local BM25 Extractive Response
    if (ranked.length === 0) {
      return {
        content: `Belgenin tüm **${index.totalPages}** sayfası tarandı ancak **"${question}"** ile doğrudan eşleşen bir bölüm bulunamadı.\n\nDaha farklı anahtar kelimeler deneyebilir veya sağ üstteki Ayarlar simgesinden OpenAI / Anthropic / Gemini / Ollama sağlayıcısı bağlayabilirsiniz.`,
        sources: [],
        usedProvider: 'local',
      };
    }

    const lines = ranked.slice(0, 4).map(
      (r) => `- [Sayfa ${r.pageNumber}] ${r.snippet}`
    );

    const content =
      `**Yerel Arama Sonuçları** (${index.totalPages} sayfa içinden en ilgili bölümler):\n\n` +
      lines.join('\n\n');

    return {
      content,
      sources,
      usedProvider: 'local',
    };
  }

  /**
   * Extracts key questions and topic inquiries across ALL pages of the document.
   */
  public static async extractKeyQuestions(
    pdfDoc: pdfjsLib.PDFDocumentProxy,
    options: AIRequestOptions = {}
  ): Promise<AIResponseResult> {
    const index = await this.buildDocumentIndex(pdfDoc, options.signal);
    if (index.chunks.length === 0) {
      return {
        content: 'Bu belgede metin katmanı bulunamadığı için konu/soru çıkarımı yapılamadı.',
        sources: [],
        usedProvider: 'local',
      };
    }

    const config = options.config;
    if (config && this.isExternalProviderReady(config)) {
      const sampled = this.sampleRepresentativePages(index, 10, 12000);
      const contextText = sampled
        .map((p) => `[Sayfa ${p.pageNumber}]\n${p.text}`)
        .join('\n\n');
      const prompt =
        'Bu PDF belgesindeki temel konu başlıklarını ve okuyucunun belge hakkında sorabileceği en önemli 5-6 soruyu madde halinde Türkçe listele. İlgili sayfa numaralarını [Sayfa N] biçiminde belirt.';
      const reply = await this.callExternalLLM(
        config,
        prompt,
        contextText,
        options.history,
        options.signal
      );
      return {
        content: reply,
        sources: sampled.slice(0, 5).map((p) => ({
          pageNumber: p.pageNumber,
          snippet: p.text.slice(0, 120),
        })),
        usedProvider: config.provider,
      };
    }

    // Local extraction across ALL pages
    const explicitQuestions: { pageNumber: number; text: string }[] = [];
    for (const page of index.pages) {
      const matches = page.text
        .split(/(?<=[.?!\n])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.endsWith('?') && s.length >= 15 && s.length <= 200);
      for (const q of matches) {
        if (!explicitQuestions.some((eq) => eq.text === q)) {
          explicitQuestions.push({ pageNumber: page.pageNumber, text: q });
        }
        if (explicitQuestions.length >= 6) break;
      }
      if (explicitQuestions.length >= 6) break;
    }

    if (explicitQuestions.length > 0) {
      const content =
        `**Belgede Tespit Edilen Sorular** (${index.totalPages} sayfa tarandı):\n\n` +
        explicitQuestions.map((q, i) => `${i + 1}. [Sayfa ${q.pageNumber}] ${q.text}`).join('\n\n');
      return {
        content,
        sources: explicitQuestions.map((q) => ({ pageNumber: q.pageNumber, snippet: q.text })),
        usedProvider: 'local',
      };
    }

    // If document has no literal '?' sentences, extract key concepts & headings honestly
    const keyTerms = this.extractTopKeyTerms(index, 8);
    const items: string[] = [];
    const sources: AIResponseSource[] = [];

    for (const term of keyTerms.slice(0, 5)) {
      const hits = await this.searchDocumentBM25(pdfDoc, term, 1, options.signal);
      if (hits[0]) {
        items.push(`- **${term}** ile ilgili detaylar: [Sayfa ${hits[0].pageNumber}] ${hits[0].snippet}`);
        sources.push({ pageNumber: hits[0].pageNumber, snippet: hits[0].snippet });
      }
    }

    const content =
      items.length > 0
        ? `**Belgede Öne Çıkan Konular ve Referanslar** (${index.totalPages} sayfa tarandı):\n\n` +
          items.join('\n\n')
        : 'Belge içinde belirgin soru cümlesi veya konu başlığı tespit edilemedi.';

    return {
      content,
      sources,
      usedProvider: 'local',
    };
  }

  private static extractTopKeyTerms(index: DocumentIndex, count: number): string[] {
    const scores = new Map<string, number>();
    const N = Math.max(1, index.chunks.length);

    for (const chunk of index.chunks) {
      for (const [term, tf] of chunk.termFreqs.entries()) {
        if (term.length < 3 || /^\d+$/.test(term) || TURKISH_STOP_WORDS.has(term)) continue;
        const df = index.docFreq.get(term) || 1;
        const idf = Math.log(1 + N / df);
        scores.set(term, (scores.get(term) || 0) + tf * idf);
      }
    }

    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, count)
      .map(([term]) => term);
  }

  private static sampleRepresentativePages(
    index: DocumentIndex,
    maxPagesCount: number,
    maxChars: number
  ): IndexedPage[] {
    if (index.pages.length === 0) return [];
    const picked: IndexedPage[] = [];
    const total = index.pages.length;

    if (total <= maxPagesCount) {
      picked.push(...index.pages);
    } else {
      const seenIndices = new Set<number>();
      for (let i = 0; i < maxPagesCount; i++) {
        const idx = Math.min(total - 1, Math.round((i * (total - 1)) / (maxPagesCount - 1)));
        if (!seenIndices.has(idx)) {
          seenIndices.add(idx);
          picked.push(index.pages[idx]);
        }
      }
    }

    const perPageCap = Math.max(400, Math.floor(maxChars / Math.max(1, picked.length)));
    let remaining = maxChars;
    const result: IndexedPage[] = [];

    for (const p of picked) {
      if (remaining <= 0) break;
      const sliceLen = Math.min(p.text.length, perPageCap, remaining);
      result.push({
        pageNumber: p.pageNumber,
        text: p.text.slice(0, sliceLen),
      });
      remaining -= sliceLen;
    }

    return result;
  }

  private static async callExternalLLM(
    config: AIConfig,
    userPrompt: string,
    groundedContext: string,
    history: AIChatMessage[] = [],
    signal?: AbortSignal
  ): Promise<string> {
    throwIfAborted(signal);

    const systemInstruction =
      (config.systemPrompt?.trim()
        ? config.systemPrompt.trim() + '\n\n'
        : '') +
      'Sen XPDF PDF asistanısın. Yanıtlarını YALNIZCA aşağıda verilen PDF içeriğine dayandır, uydurma bilgi ekleme, Türkçe yanıt ver ve bilgi aldığın sayfaları mutlaka [Sayfa N] biçiminde belirt.\n\n' +
      '--- PDF BAĞLAMI ---\n' +
      groundedContext;

    const recentHistory = history
      .filter((m) => m.id !== 'welcome' && (m.role === 'user' || m.role === 'assistant'))
      .slice(-6)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const temperature = config.temperature ?? 0.3;
    const maxTokens = config.maxTokens ?? 1500;
    const defaults = AI_PROVIDER_DEFAULTS[config.provider];
    const baseUrl = (config.baseUrl?.trim() || defaults.defaultBaseUrl).replace(/\/+$/, '');
    const model = config.model?.trim() || defaults.defaultModel;

    if (config.provider === 'openai' || config.provider === 'custom') {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (config.apiKey?.trim()) {
        headers.Authorization = `Bearer ${config.apiKey.trim()}`;
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemInstruction },
            ...recentHistory,
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
        throw new Error(`${defaults.label} API hatası (${res.status}): ${errMsg}`);
      }

      const text = data?.choices?.[0]?.message?.content;
      if (!text) throw new Error('API boş yanıt döndürdü.');
      return String(text).trim();
    }

    if (config.provider === 'anthropic') {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey?.trim() || '',
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal,
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          temperature,
          system: systemInstruction,
          messages: [...recentHistory, { role: 'user', content: userPrompt }],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
        throw new Error(`Anthropic API hatası (${res.status}): ${errMsg}`);
      }

      const blocks = Array.isArray(data?.content) ? data.content : [];
      const text = blocks
        .filter((b: { type?: string; text?: string }) => b?.type === 'text' && b?.text)
        .map((b: { text: string }) => b.text)
        .join('\n')
        .trim();
      if (!text) throw new Error('Anthropic boş yanıt döndürdü.');
      return text;
    }

    if (config.provider === 'gemini') {
      const apiKey = encodeURIComponent(config.apiKey?.trim() || '');
      const endpoint = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
      const contents = [
        ...recentHistory.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        { role: 'user', parts: [{ text: userPrompt }] },
      ];

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents,
          generationConfig: {
            temperature,
            maxOutputTokens: maxTokens,
          },
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error?.message || res.statusText || `HTTP ${res.status}`;
        throw new Error(`Gemini API hatası (${res.status}): ${errMsg}`);
      }

      const parts = data?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((p: { text?: string }) => p?.text || '').join('').trim()
        : '';
      if (!text) throw new Error('Gemini boş yanıt döndürdü.');
      return text;
    }

    if (config.provider === 'ollama') {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          model,
          stream: false,
          options: {
            temperature,
            num_predict: maxTokens,
          },
          messages: [
            { role: 'system', content: systemInstruction },
            ...recentHistory,
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg = data?.error || res.statusText || `HTTP ${res.status}`;
        throw new Error(`Ollama API hatası (${res.status}): ${errMsg}`);
      }

      const text = data?.message?.content;
      if (!text) throw new Error('Ollama boş yanıt döndürdü.');
      return String(text).trim();
    }

    throw new Error(`Desteklenmeyen AI sağlayıcısı: ${config.provider}`);
  }
}
