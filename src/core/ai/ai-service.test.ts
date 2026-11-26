import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as pdfjsLib from 'pdfjs-dist';
import { AIService, tokenizeTurkishText } from './ai-service';
import { useAIStore } from './ai-store';

function createMockPdfProxy(pageTexts: string[]): pdfjsLib.PDFDocumentProxy {
  return {
    numPages: pageTexts.length,
    getPage: async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: [
          {
            str: pageTexts[pageNumber - 1] || '',
            transform: [1, 0, 0, 1, 50, 700],
            hasEOL: true,
          },
        ],
      }),
    }),
    getOutline: async () => [
      { title: 'Bölüm 1: Giriş', items: [] },
      { title: 'Bölüm 2: İhale ve KDV Şartları', items: [] },
    ],
  } as unknown as pdfjsLib.PDFDocumentProxy;
}

describe('AIService — Full-Doc Turkish BM25 & Multi-Provider LLM + Store Isolation', () => {
  beforeEach(() => {
    useAIStore.getState().resetConfig();
    useAIStore.getState().clearChat('doc_a');
    useAIStore.getState().clearChat('doc_b');
    vi.restoreAllMocks();
  });

  it('indexes ALL 45 pages (no 15-30 page cap) and ranks Turkish BM25 match on page 42 #1', async () => {
    const pages = Array.from({ length: 45 }, (_, idx) => {
      const pNum = idx + 1;
      if (pNum === 42) {
        return 'İhale Teminatı ve KDV İadesi: Yüklenici sözleşme bedelinin %20 oranında kesin teminat yatırır. KDV tevkifatı ayrıca hesaplanır.';
      }
      if (pNum === 10) {
        return 'Genel idari hükümler ve yazışma kuralları hakkında kısa bilgi yer almaktadır.';
      }
      return `Sayfa ${pNum} standart teknik şartname maddeleri ve genel açıklamalar içermektedir.`;
    });

    const mockPdf = createMockPdfProxy(pages);
    const index = await AIService.buildDocumentIndex(mockPdf);
    expect(index.totalPages).toBe(45);
    expect(index.pages).toHaveLength(45);

    // Verify Turkish lowercase handles İ -> i and keeps short domain term KDV
    const tokens = tokenizeTurkishText('İhale Teminatı ve KDV nedir?');
    expect(tokens).toContain('ihale');
    expect(tokens).toContain('teminatı');
    expect(tokens).toContain('kdv');

    const ranked = await AIService.searchDocumentBM25(mockPdf, 'İhale teminatı KDV oranı');
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].pageNumber).toBe(42);

    const answer = await AIService.answerQuestion(mockPdf, 'İhale teminatı ve KDV nedir?');
    expect(answer.usedProvider).toBe('local');
    expect(answer.content).toContain('[Sayfa 42]');
    expect(answer.sources[0]?.pageNumber).toBe(42);
  });

  it('calls configured OpenAI provider with grounded BM25 chunks and respects AbortSignal', async () => {
    const pages = Array.from({ length: 40 }, (_, i) =>
      i === 35
        ? 'Fatura Ödeme Vadesi: Teslimattan sonraki 30 iş günüdür.'
        : `Genel madde ${i + 1} açıklaması.`
    );
    const mockPdf = createMockPdfProxy(pages);

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Ödeme vadesi 30 iş günüdür [Sayfa 36].' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await AIService.answerQuestion(mockPdf, 'Ödeme vadesi kaç gündür?', {
      config: {
        provider: 'openai',
        apiKey: 'test-key-123',
        model: 'gpt-4o-mini',
        baseUrl: 'https://api.openai.com/v1',
      },
    });

    expect(res.usedProvider).toBe('openai');
    expect(res.content).toContain('[Sayfa 36]');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages[0].content).toContain('[Sayfa 36]');
    expect(body.messages[0].content).toContain('30 iş günüdür');

    // Verify AbortSignal cancels cleanly
    const abortCtrl = new AbortController();
    abortCtrl.abort();
    await expect(
      AIService.answerQuestion(mockPdf, 'Ödeme vadesi', { signal: abortCtrl.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('useAIStore isolates chat history per docId and persists AI config', () => {
    useAIStore.getState().setConfig({ provider: 'ollama', model: 'qwen2.5' });
    expect(useAIStore.getState().config.provider).toBe('ollama');
    expect(useAIStore.getState().config.model).toBe('qwen2.5');

    useAIStore.getState().addMessage('doc_a', {
      id: 'm1',
      role: 'user',
      content: 'Belge A sorusu',
      timestamp: 1,
    });
    useAIStore.getState().addMessage('doc_b', {
      id: 'm2',
      role: 'user',
      content: 'Belge B sorusu',
      timestamp: 2,
    });

    expect(useAIStore.getState().chatsByDoc['doc_a']).toHaveLength(1);
    expect(useAIStore.getState().chatsByDoc['doc_a'][0].content).toBe('Belge A sorusu');
    expect(useAIStore.getState().chatsByDoc['doc_b']).toHaveLength(1);
    expect(useAIStore.getState().chatsByDoc['doc_b'][0].content).toBe('Belge B sorusu');

    useAIStore.getState().clearChat('doc_a');
    expect(useAIStore.getState().chatsByDoc['doc_a']).toBeUndefined();
    expect(useAIStore.getState().chatsByDoc['doc_b']).toHaveLength(1);
  });
});
