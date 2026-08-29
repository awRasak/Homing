import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_ATTACHMENT_CHARS = 25000;

const TEXT_EXTENSIONS = /\.(txt|md)$/i;

export function isSupportedAttachment(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ||
    file.type === 'text/plain' || file.type === 'text/markdown' || TEXT_EXTENSIONS.test(file.name);
}

async function extractPdfText(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(' '));
  }
  return pageTexts.join('\n\n');
}

/**
 * Extract plain text from a PDF or .txt/.md file for use as chat context.
 * Truncates to MAX_ATTACHMENT_CHARS — the server folds this into a single
 * flat prompt string with no chunking/RAG, so it must stay bounded.
 * @returns {Promise<{ name: string, text: string, truncated: boolean }>}
 */
export async function extractAttachmentText(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`"${file.name}" is too large (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB).`);
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const raw = isPdf ? await extractPdfText(file) : await file.text();
  const text = raw.trim();
  if (!text) throw new Error(`Couldn't find any text in "${file.name}".`);

  const truncated = text.length > MAX_ATTACHMENT_CHARS;
  return {
    name: file.name,
    text: truncated ? text.slice(0, MAX_ATTACHMENT_CHARS) : text,
    truncated,
  };
}
