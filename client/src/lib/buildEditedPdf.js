import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

function hexToRgb(hex) {
  const m = String(hex || '#000000').replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
  };
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Build a real PDF from the edited live preview. Each source page is embedded
 * as a full-page PNG and text blocks are drawn on top at their positions with
 * their override text.
 *
 * @param {Array<{dataUrl:string,width:number,height:number,blocks?:Array}>} pages
 * @param {Object<string,Object<string,string>>} overridesByPage — { pageNum: { blockId: text } }
 * @returns {Promise<Uint8Array>}
 */
export async function buildEditedPdf(pages, overridesByPage = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (const page of pages) {
    if (!page?.dataUrl) continue;
    const pngBytes = await fetch(page.dataUrl).then((r) => r.arrayBuffer()).catch(() => null);
    if (!pngBytes) continue;

    const img = await doc.embedPng(pngBytes).catch(async () => doc.embedJpg(pngBytes)).catch(() => null);
    if (!img) continue;

    const scale = 72 / 96;
    const w = page.width * scale;
    const h = page.height * scale;

    const pdfPage = doc.addPage([w, h]);
    pdfPage.drawImage(img, { x: 0, y: 0, width: w, height: h });

    const pageOverrides = overridesByPage[String(page.pageNum)] || {};
    for (const block of page.blocks || []) {
      const text = Object.prototype.hasOwnProperty.call(pageOverrides, block.id)
        ? pageOverrides[block.id]
        : block.text;
      if (!text || !String(text).trim()) continue;

      const color = hexToRgb(block.fg || '#000000');
      const fontSize = Math.max(6, (block.height * 0.72 * scale) / 1.75);
      const lineHeight = fontSize * 1.2;
      const x = block.x * scale;
      const topY = h - block.y * scale - block.height * scale;
      const maxWidth = Math.max(10, block.width * scale);

      const lines = wrapText(text, font, fontSize, maxWidth);
      lines.forEach((ln, i) => {
        const y = topY + block.height * scale - fontSize * 0.75 - i * lineHeight;
        pdfPage.drawText(ln, {
          x,
          y: Math.max(0, y),
          size: fontSize,
          font,
          color: rgb(color.r, color.g, color.b),
        });
      });
    }
  }

  return doc.save();
}