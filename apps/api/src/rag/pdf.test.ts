import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractPdf, pdfParserAvailable } from './pdf.js';

test('PDF extraction retains page references and disables dynamic evaluation', async () => {
  let destroyed = false;
  const pages = await extractPdf(Buffer.from('%PDF-1.7'), { getDocument: (options) => {
    assert.equal(options.isEvalSupported, false);
    return { promise: Promise.resolve({ numPages: 2, getPage: async (n) => ({ getTextContent: async () => ({ items: [{ str: `第 ${n} 页` }] }) }) }), destroy: async () => { destroyed = true; } };
  } });
  assert.deepEqual(pages.map((page) => page.page), [1, 2]);
  assert.equal(destroyed, true);
});

test('invalid and scanned PDFs do not pretend to contain extracted text', async () => {
  await assert.rejects(extractPdf(Buffer.from('not a PDF')), /invalid_pdf/);
  await assert.rejects(extractPdf(Buffer.from('%PDF-1.7'), { getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) }), destroy: async () => {} }) }), /pdf_no_text/);
});

test('extracts text and page from a real PDF when PDF.js is installed', async (context) => {
  if (!(await pdfParserAvailable())) { context.skip('PDF.js dependency not installed'); return; }
  const bytes = await readFile(new URL('../../test-data/minimal.pdf', import.meta.url));
  const pages = await extractPdf(bytes);
  assert.deepEqual(pages, [{ page: 1, text: 'Software engineering requirements' }]);
});
