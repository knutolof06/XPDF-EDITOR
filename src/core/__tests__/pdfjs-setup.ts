import * as pdfjsLib from 'pdfjs-dist';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function setupPdfJsWorker(): void {
  const workerPath = path.resolve(
    process.cwd(),
    'node_modules',
    'pdfjs-dist',
    'build',
    'pdf.worker.mjs'
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}
