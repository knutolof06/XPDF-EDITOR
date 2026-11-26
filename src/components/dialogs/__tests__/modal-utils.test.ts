import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parsePageRange,
  parseSplitRanges,
  resolveIsDark,
  saveBinaryOrBlobFile,
} from '../modal-utils';

describe('modal-utils', () => {
  const originalElectronAPI = window.electronAPI;

  beforeEach(() => {
    document.documentElement.classList.remove('dark', 'light');
  });

  afterEach(() => {
    window.electronAPI = originalElectronAPI;
    vi.restoreAllMocks();
  });

  describe('parsePageRange', () => {
    it('parses valid single pages and ranges sorted and deduplicated', () => {
      const res = parsePageRange('5, 1-3, 2, 8–9', 10);
      expect(res.isValid).toBe(true);
      expect(res.pages).toEqual([1, 2, 3, 5, 8, 9]);
    });

    it('rejects empty, malformed, out-of-bounds, and reversed ranges', () => {
      expect(parsePageRange('', 10).isValid).toBe(false);
      expect(parsePageRange('abc', 10).isValid).toBe(false);
      expect(parsePageRange('1-abc', 10).isValid).toBe(false);
      expect(parsePageRange('-3', 10).isValid).toBe(false);
      expect(parsePageRange('3-', 10).isValid).toBe(false);
      expect(parsePageRange('0', 10).isValid).toBe(false);
      expect(parsePageRange('1-11', 10).isValid).toBe(false);
      expect(parsePageRange('5-2', 10).isValid).toBe(false);
      expect(parsePageRange('1, ', 10).isValid).toBe(false);
    });
  });

  describe('parseSplitRanges', () => {
    it('preserves ordered range segments cleanly', () => {
      const res = parseSplitRanges('1-4, 5-8, 10', 10);
      expect(res.isValid).toBe(true);
      expect(res.ranges).toEqual([
        { from: 1, to: 4 },
        { from: 5, to: 8 },
        { from: 10, to: 10 },
      ]);
    });

    it('rejects out-of-bounds and reversed split segments', () => {
      expect(parseSplitRanges('1-12', 10).isValid).toBe(false);
      expect(parseSplitRanges('8-3', 10).isValid).toBe(false);
      expect(parseSplitRanges('', 10).isValid).toBe(false);
    });
  });

  describe('resolveIsDark', () => {
    it('resolves explicit dark/light and system mode via html.dark class', () => {
      expect(resolveIsDark('dark')).toBe(true);
      expect(resolveIsDark('light')).toBe(false);

      document.documentElement.classList.add('light');
      expect(resolveIsDark('system')).toBe(false);

      document.documentElement.classList.remove('light');
      document.documentElement.classList.add('dark');
      expect(resolveIsDark('system')).toBe(true);
    });
  });

  describe('saveBinaryOrBlobFile', () => {
    it('never falls back to anchor download when Electron showSaveDialog is canceled', async () => {
      const showSaveDialog = vi.fn().mockResolvedValue({ canceled: true, filePath: null });
      const saveFile = vi.fn();
      const createElementSpy = vi.spyOn(document, 'createElement');

      window.electronAPI = {
        isElectron: true,
        platform: 'win32',
        showSaveDialog,
        saveFile,
      } as unknown as typeof window.electronAPI;

      const res = await saveBinaryOrBlobFile({
        data: new Uint8Array([1, 2, 3]),
        defaultName: 'test.pdf',
      });

      expect(res.status).toBe('canceled');
      expect(saveFile).not.toHaveBeenCalled();
      expect(createElementSpy).not.toHaveBeenCalledWith('a');
    });

    it('writes to selected filePath in Electron and throws when saveFile fails', async () => {
      const showSaveDialog = vi.fn().mockResolvedValue({
        canceled: false,
        filePath: 'C:\\docs\\saved.pdf',
      });
      const saveFile = vi
        .fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'İzin reddedildi' });

      window.electronAPI = {
        isElectron: true,
        platform: 'win32',
        showSaveDialog,
        saveFile,
      } as unknown as typeof window.electronAPI;

      const ok = await saveBinaryOrBlobFile({
        data: new Uint8Array([1, 2, 3]),
        defaultName: 'test.pdf',
      });
      expect(ok).toEqual({ status: 'saved', filePath: 'C:\\docs\\saved.pdf' });

      await expect(
        saveBinaryOrBlobFile({
          data: new Uint8Array([1, 2, 3]),
          defaultName: 'test.pdf',
        })
      ).rejects.toThrow('İzin reddedildi');
    });
  });
});
