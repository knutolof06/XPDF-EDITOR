import { useEffect, useState } from 'react';
import { useViewerStore, ReadingTheme } from '@/store/viewer-store';

export function resolveIsDark(theme: 'dark' | 'light' | 'system'): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function applyThemeToDocument(theme: 'dark' | 'light' | 'system'): boolean {
  const isDark = resolveIsDark(theme);
  if (typeof document !== 'undefined') {
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }
  return isDark;
}

export function useResolvedDarkTheme(): boolean {
  const theme = useViewerStore((s) => s.theme);
  const [isDark, setIsDark] = useState<boolean>(() => resolveIsDark(theme));

  useEffect(() => {
    setIsDark(resolveIsDark(theme));

    if (theme !== 'system' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setIsDark(media.matches);
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', handleChange);
      return () => media.removeEventListener('change', handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [theme]);

  return isDark;
}

export function getReadingFilter(readingTheme: ReadingTheme): string {
  switch (readingTheme) {
    case 'dark':
      return 'invert(0.9) hue-rotate(180deg)';
    case 'sepia':
      return 'sepia(0.38) contrast(0.95) brightness(0.96)';
    case 'high-contrast':
      return 'contrast(1.3) brightness(1.05)';
    default:
      return 'none';
  }
}

export function getReadingThemeLabel(readingTheme: ReadingTheme): string {
  switch (readingTheme) {
    case 'dark':
      return 'Gece Modu';
    case 'sepia':
      return 'Sepya Kitap';
    case 'high-contrast':
      return 'Yüksek Kontrast';
    default:
      return 'Varsayılan';
  }
}
