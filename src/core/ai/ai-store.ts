import { create } from 'zustand';
import type { AIConfig, AIChatMessage, AIProvider } from '@/types/advanced';

const CONFIG_STORAGE_KEY = 'xpdf_ai_config';
const CHATS_STORAGE_KEY = 'xpdf_ai_chats';
const MAX_MESSAGES_PER_DOC = 50;
const MAX_PERSISTED_DOCS = 20;

export const AI_PROVIDER_DEFAULTS: Record<
  AIProvider,
  { label: string; defaultModel: string; defaultBaseUrl: string; requiresApiKey: boolean }
> = {
  local: {
    label: 'Yerel Analiz (Çevrimdışı)',
    defaultModel: 'local-bm25',
    defaultBaseUrl: '',
    requiresApiKey: false,
  },
  openai: {
    label: 'OpenAI',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: true,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-3-5-sonnet-latest',
    defaultBaseUrl: 'https://api.anthropic.com',
    requiresApiKey: true,
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-2.0-flash',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    requiresApiKey: true,
  },
  ollama: {
    label: 'Ollama (Yerel Sunucu)',
    defaultModel: 'llama3.2',
    defaultBaseUrl: 'http://localhost:11434',
    requiresApiKey: false,
  },
  custom: {
    label: 'Özel (OpenAI Uyumlu)',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    requiresApiKey: false,
  },
};

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'local',
  apiKey: '',
  baseUrl: '',
  model: 'local-bm25',
  temperature: 0.3,
  maxTokens: 1500,
  systemPrompt: '',
};

function loadPersistedConfig(): AIConfig {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_AI_CONFIG };
  }
  try {
    const raw = window.localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_CONFIG };
    const parsed = JSON.parse(raw) as Partial<AIConfig>;
    const provider: AIProvider =
      parsed.provider && parsed.provider in AI_PROVIDER_DEFAULTS ? parsed.provider : 'local';
    return {
      ...DEFAULT_AI_CONFIG,
      ...parsed,
      provider,
      model: parsed.model || AI_PROVIDER_DEFAULTS[provider].defaultModel,
    };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

function savePersistedConfig(config: AIConfig): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore storage quota errors
  }
}

function loadPersistedChats(): Record<string, AIChatMessage[]> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(CHATS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, AIChatMessage[]>;
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Record<string, AIChatMessage[]> = {};
    for (const [docId, msgs] of Object.entries(parsed)) {
      if (Array.isArray(msgs)) {
        clean[docId] = msgs.slice(-MAX_MESSAGES_PER_DOC);
      }
    }
    return clean;
  } catch {
    return {};
  }
}

function savePersistedChats(chatsByDoc: Record<string, AIChatMessage[]>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const entries = Object.entries(chatsByDoc);
    // Retain most recently active documents if over limit
    const sorted = entries
      .sort((a, b) => {
        const lastA = a[1][a[1].length - 1]?.timestamp || 0;
        const lastB = b[1][b[1].length - 1]?.timestamp || 0;
        return lastB - lastA;
      })
      .slice(0, MAX_PERSISTED_DOCS);

    const trimmed: Record<string, AIChatMessage[]> = {};
    for (const [docId, msgs] of sorted) {
      trimmed[docId] = msgs.slice(-MAX_MESSAGES_PER_DOC);
    }
    window.localStorage.setItem(CHATS_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // ignore storage quota errors
  }
}

interface AIStoreState {
  config: AIConfig;
  chatsByDoc: Record<string, AIChatMessage[]>;
  generatingByDoc: Record<string, boolean>;

  setConfig: (partial: Partial<AIConfig>) => void;
  resetConfig: () => void;
  addMessage: (docId: string, message: AIChatMessage) => void;
  clearChat: (docId: string) => void;
  setDocGenerating: (docId: string, generating: boolean) => void;
}

export const useAIStore = create<AIStoreState>((set) => ({
  config: loadPersistedConfig(),
  chatsByDoc: loadPersistedChats(),
  generatingByDoc: {},

  setConfig: (partial) =>
    set((state) => {
      const nextProvider = partial.provider ?? state.config.provider;
      const providerChanged = partial.provider && partial.provider !== state.config.provider;
      const providerMeta = AI_PROVIDER_DEFAULTS[nextProvider];

      const nextConfig: AIConfig = {
        ...state.config,
        ...partial,
        provider: nextProvider,
        model:
          partial.model !== undefined
            ? partial.model
            : providerChanged
            ? providerMeta.defaultModel
            : state.config.model,
        baseUrl:
          partial.baseUrl !== undefined
            ? partial.baseUrl
            : providerChanged
            ? providerMeta.defaultBaseUrl
            : state.config.baseUrl,
      };

      savePersistedConfig(nextConfig);
      return { config: nextConfig };
    }),

  resetConfig: () =>
    set(() => {
      const fresh = { ...DEFAULT_AI_CONFIG };
      savePersistedConfig(fresh);
      return { config: fresh };
    }),

  addMessage: (docId, message) =>
    set((state) => {
      if (!docId) return state;
      const existing = state.chatsByDoc[docId] || [];
      const updatedList = [...existing, message].slice(-MAX_MESSAGES_PER_DOC);
      const nextChats = { ...state.chatsByDoc, [docId]: updatedList };
      savePersistedChats(nextChats);
      return { chatsByDoc: nextChats };
    }),

  clearChat: (docId) =>
    set((state) => {
      if (!docId) return state;
      const nextChats = { ...state.chatsByDoc };
      delete nextChats[docId];
      savePersistedChats(nextChats);
      return { chatsByDoc: nextChats };
    }),

  setDocGenerating: (docId, generating) =>
    set((state) => {
      if (!docId) return state;
      if (generating) {
        return { generatingByDoc: { ...state.generatingByDoc, [docId]: true } };
      }
      const next = { ...state.generatingByDoc };
      delete next[docId];
      return { generatingByDoc: next };
    }),
}));
