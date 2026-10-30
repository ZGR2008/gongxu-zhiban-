import type { TextPage } from './chunk.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export class PdfError extends Error {
  constructor(public readonly code: 'pdf_parser_unavailable' | 'invalid_pdf' | 'pdf_too_large' | 'pdf_too_many_pages' | 'pdf_no_text') { super(code); }
}
type PdfDocument = { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> };
type PdfTask = { promise: Promise<PdfDocument>; destroy: () => Promise<void> };
type PdfEngine = { getDocument: (options: { data: Uint8Array; isEvalSupported: false; disableFontFace: true; useSystemFonts: false; standardFontDataUrl?: string; cMapUrl?: string; cMapPacked?: true; useWorkerFetch?: false }) => PdfTask };

export async function pdfParserAvailable(): Promise<boolean> {
  try { const name = 'pdfjs-dist/legacy/build/pdf.mjs'; await import(name); return true; } catch { return false; }
}

/** Extract text only. Never execute document scripts or user-submitted code. */
export async function extractPdf(bytes: Uint8Array, engine?: PdfEngine): Promise<TextPage[]> {
  if (bytes.length > 3_000_000) throw new PdfError('pdf_too_large');
  if (bytes.length < 6 || Buffer.from(bytes.subarray(0, 5)).toString('ascii') !== '%PDF-') throw new PdfError('invalid_pdf');
  let assets: { standardFontDataUrl?: string; cMapUrl?: string; cMapPacked?: true; useWorkerFetch?: false } = {};
  if (!engine) {
    try {
      const name = 'pdfjs-dist/legacy/build/pdf.mjs'; engine = await import(name) as PdfEngine;
      const packageRoot = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
      assets = {
        standardFontDataUrl: join(packageRoot, 'standard_fonts').replace(/\\/g, '/') + '/',
        cMapUrl: join(packageRoot, 'cmaps').replace(/\\/g, '/') + '/',
        cMapPacked: true, useWorkerFetch: false,
      };
    }
    catch { throw new PdfError('pdf_parser_unavailable'); }
  }
  let task: PdfTask | undefined;
  try {
    task = engine.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, ...assets });
    const document = await task.promise;
    if (document.numPages > 80) throw new PdfError('pdf_too_many_pages');
    const pages: TextPage[] = []; let total = 0;
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent();
      const text = content.items.map((item) => typeof item === 'object' && item !== null && 'str' in item && typeof item.str === 'string' ? item.str : '').join(' ').trim();
      total += text.length;
      if (total > 200_000) throw new PdfError('pdf_too_large');
      if (text) pages.push({ page, text });
    }
    if (!pages.length) throw new PdfError('pdf_no_text');
    return pages;
  } catch (error) { if (error instanceof PdfError) throw error; throw new PdfError('invalid_pdf'); }
  finally { if (task) await task.destroy(); }
}
