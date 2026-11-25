export interface BookmarkItem {
  id: string;
  title: string;
  pageIndex: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  expanded?: boolean;
  dest?: unknown;
  children?: BookmarkItem[];
}

export interface FormFieldModel {
  name: string;
  type: 'text' | 'checkbox' | 'radio' | 'dropdown';
  value: string | boolean;
  options?: string[];
  pageIndex: number;
  rect: { x: number; y: number; width: number; height: number };
}

export interface CompareState {
  isOpen: boolean;
  docA: { id: string; name: string; pageIndex: number };
  docB: { id: string; name: string; pageIndex: number };
  syncScroll: boolean;
}

export type AIProvider = 'local' | 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  sources?: { pageNumber: number; snippet: string }[];
}

export type SignatureValidityStatus =
  | 'valid'
  | 'invalid'
  | 'untrusted-signer'
  | 'tampered'
  | 'expired'
  | 'unknown';

export interface SignatureCertificateInfo {
  subject: string;
  issuer: string;
  serialNumber?: string;
  validFrom?: string;
  validTo?: string;
  isSelfSigned?: boolean;
  isExpired?: boolean;
  fingerprintSha256?: string;
}

export interface SignatureVerificationResult {
  id: string;
  name: string;
  status: SignatureValidityStatus;
  isValid: boolean;
  integrityVerified: boolean;
  certificateTrusted: boolean;
  byteRangeValid: boolean;
  digestAlgorithm?: string;
  subFilter?: string;
  signedAt?: string;
  reason?: string;
  location?: string;
  pageNumber?: number;
  certificate?: SignatureCertificateInfo;
  error?: string;
  details?: string;
}
