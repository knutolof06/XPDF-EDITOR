export interface ElectronFileFilter {
  name: string;
  extensions: string[];
}

export interface ElectronOpenedFile {
  name: string;
  path: string;
  buffer: Uint8Array | ArrayBuffer;
}

export interface ElectronFileData {
  name: string;
  path: string;
  buffer: ArrayBuffer;
  byteOffset?: number;
  byteLength?: number;
}

export interface SaveDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: ElectronFileFilter[];
}

export interface SaveDialogResult {
  canceled: boolean;
  filePath: string | null;
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: ElectronFileFilter[];
  multiSelections?: boolean;
}

export interface OpenDialogResult {
  canceled: boolean;
  filePaths: string[];
  files?: ElectronFileData[];
}

export interface SaveFileResult {
  success: boolean;
  error?: string;
}

export interface PrintDocumentOptions {
  deviceName?: string;
  silent?: boolean;
}

export interface PrintDocumentResult {
  success: boolean;
  canceled?: boolean;
  error?: string;
}

export interface PrepareDragFileRequest {
  fileName: string;
  buffer: ArrayBuffer | Uint8Array;
}

export interface PrepareDragFileResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface StartDragFileRequest {
  filePath: string;
  iconDataUrl?: string;
}

export interface UpdaterStatusEvent {
  type: 'available' | 'progress' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message: string;
}

export interface UpdateCheckResult {
  status: 'checking' | 'dev-mode' | 'unsupported' | 'error';
  version?: string;
  message?: string;
}

export interface WinRtOcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WinRtOcrLine {
  text: string;
  words: WinRtOcrWord[];
}

export interface WinRtOcrResult {
  success: boolean;
  text?: string;
  lines?: WinRtOcrLine[];
  error?: string;
}

export interface WinRtOcrLanguage {
  tag: string;
  name: string;
}

export interface WinRtOcrLanguagesResult {
  success: boolean;
  languages: WinRtOcrLanguage[];
}

export interface ElectronAPI {
  isElectron: boolean;
  platform: string;

  // Event listeners
  onOpenFile: (callback: (data: ElectronOpenedFile) => void) => () => void;

  // File operations
  getInitialFile: () => Promise<ElectronOpenedFile | null>;
  readFile: (filePath: string) => Promise<ElectronFileData>;
  showSaveDialog: (options?: SaveDialogOptions) => Promise<SaveDialogResult>;
  showOpenDialog: (options?: OpenDialogOptions) => Promise<OpenDialogResult>;
  saveFile: (filePath: string, buffer: ArrayBuffer | Uint8Array) => Promise<SaveFileResult>;
  printDocument: (options?: PrintDocumentOptions) => Promise<PrintDocumentResult>;

  // Windows Integration & Native Drag
  registerPdfAssociation: () => Promise<{ success: boolean; message?: string; error?: string }>;
  prepareDragFile: (data: PrepareDragFileRequest) => Promise<PrepareDragFileResult>;
  startDragFile: (data: StartDragFileRequest) => void;

  // Auto Updater
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  installUpdateNow: () => Promise<void>;
  onUpdaterStatus: (callback: (status: UpdaterStatusEvent) => void) => () => void;

  // Windows Region OCR (exposed only on win32)
  winrtOcrRegion?: (imageDataUrl: string, lang?: string) => Promise<WinRtOcrResult>;
  winrtOcrGetLanguages?: () => Promise<WinRtOcrLanguagesResult>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
