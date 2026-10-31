import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
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

test('a small PDF with too much extracted text reports its text boundary and destroys the parser',async()=>{
 let destroyed=false;
 await assert.rejects(extractPdf(Buffer.from('%PDF-1.7'),{getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[{str:'字'.repeat(200001)}]})})}),destroy:async()=>{destroyed=true;}})}),/pdf_text_too_large/);
 assert.equal(destroyed,true);
 await assert.rejects(extractPdf(Buffer.alloc(3000001)),/pdf_too_large/);
});

function compressedTextPdf(length:number){
 // Keep every line inside its page. Text outside the MediaBox can legitimately
 // be omitted by PDF.js; such a fixture would not exercise the text-size limit.
 const pageCount=25,linesPerPage=40,lineLength=199,fontId=28,streamStart=29;
 const bodies=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from(`<< /Type /Pages /Kids [${Array.from({length:pageCount},(_,i)=>`${i+3} 0 R`).join(' ')}] /Count ${pageCount} >>`)];
 for(let i=0;i<pageCount;i++)bodies.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 900] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamStart+i} 0 R >>`));
 bodies.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));
 const finalLength=length-pageCount*(linesPerPage-1)-(pageCount*linesPerPage-1)*lineLength;
 for(let p=0;p<pageCount;p++){
  const lines=Array.from({length:linesPerPage},(_,i)=>`1 0 0 1 20 ${880-i*20} Tm (${'x'.repeat(p===pageCount-1&&i===linesPerPage-1?finalLength:lineLength)}) Tj`);
  const stream=deflateSync(Buffer.from('BT /F1 4 Tf '+lines.join('\n')+' ET','ascii'));
  bodies.push(Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`),stream,Buffer.from('\nendstream')]));
 }
 const parts=[Buffer.from('%PDF-1.4\n')],offsets=[0];let offset=parts[0].length;
 bodies.forEach((body,i)=>{offsets.push(offset);const object=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),body,Buffer.from('\nendobj\n')]);parts.push(object);offset+=object.length;});
 parts.push(Buffer.from(`xref\n0 ${bodies.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${bodies.length+1} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF`));return Buffer.concat(parts);
}
test('real PDF parser rejects a compressed small file by extracted characters, not file bytes',async context=>{
 if(!await pdfParserAvailable()){context.skip('PDF.js dependency not installed');return;}
 const oversized=compressedTextPdf(200001);assert.ok(oversized.length<20000);
 await assert.rejects(extractPdf(oversized),/pdf_text_too_large/);
 const boundary=await extractPdf(compressedTextPdf(200000));assert.equal(boundary.length,25);assert.equal(boundary.reduce((n,p)=>n+p.text.length,0),200000);assert.equal(boundary.at(-1)?.text.at(-1),'x');
});

test('extracts text and page from a real PDF when PDF.js is installed', async (context) => {
  if (!(await pdfParserAvailable())) { context.skip('PDF.js dependency not installed'); return; }
  const bytes = await readFile(new URL('../../test-data/minimal.pdf', import.meta.url));
  const pages = await extractPdf(bytes);
  assert.deepEqual(pages, [{ page: 1, text: 'Software engineering requirements' }]);
});
