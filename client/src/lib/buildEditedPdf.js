import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ═══════════════════════════════════════════
// Single, intentional PDF export path.
//
// buildProposalPdf(design, proposal) is THE entry point for exports:
//   - Designs with an uploaded source document (design.sourceImageDataUrl)
//     export as page images with edited text drawn over them.
//   - Template-mode designs (built from scratch) render the same layout
//     as PreviewDocument.jsx directly into the PDF.
// Both embed the design's configured Google Fonts so typography matches
// the on-screen live preview.
// ═══════════════════════════════════════════

const INK = rgb(0x1f / 255, 0x24 / 255, 0x30 / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const GREEN_DARK = rgb(0xa0 / 255, 0xc2 / 255, 0); // --green-dark (light theme — matches printed white bg)

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

// ── Google Fonts loading ────────────────────────────────────
// The live preview loads fonts via the CSS2 stylesheet; exports fetch the
// same families and embed them with fontkit. Browsers receive WOFF2 from
// this endpoint and @pdf-lib/fontkit decodes it fine.

const fontCache = new Map(); // `${family}:${weight}` -> PDFFont | null

// Modern Chrome UA → Google serves WOFF2 (compact, and what @pdf-lib/fontkit
// parses most reliably). Browsers forbid overriding User-Agent in fetch(), so
// this header only matters outside the browser (tests, SSR) — harmless there.
const FONT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchFontBytes(family, weight) {
  const cssRes = await fetch(
    `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`,
    { headers: { Accept: 'text/css', 'User-Agent': FONT_UA } }
  );
  if (!cssRes.ok) throw new Error(`fonts css ${cssRes.status}`);
  const css = await cssRes.text();
  // Prefer the latin subset block (listed last in the stylesheet).
  const urls = [...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]);
  if (!urls.length) throw new Error('no font url in css');
  const binRes = await fetch(urls[urls.length - 1]);
  if (!binRes.ok) throw new Error(`font binary ${binRes.status}`);
  return new Uint8Array(await binRes.arrayBuffer());
}

async function getFont(doc, family, weight = 400) {
  const key = `${family}:${weight}`;
  if (fontCache.has(key)) return fontCache.get(key);

  // Announced fallback: bundled Helvetica when the configured Google Font
  // can't be fetched or parsed (offline, network failure, unsupported file).
  let result;
  try {
    const bytes = await fetchFontBytes(family, weight);
    const font = await doc.embedFont(bytes);
    font.widthOfTextAtSize('Ag', 12); // force glyph metrics — some files parse but fail here later
    result = font;
  } catch (err) {
    console.warn(`[pdf-export] Could not embed Google Font "${family}" (${err.message}); falling back to Helvetica.`);
    try {
      result = await doc.embedFont(weight >= 600 ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
    } catch {
      result = null;
    }
  }
  return result;
}

// ── Uploaded-source designs: page images + text overlays ────

/**
 * @param {Array<{dataUrl:string,width:number,height:number,pageNum:string|number,blocks?:Array}>} pages
 * @param {Object<string,Object<string,string>>} overridesByPage — { pageNum: { blockId: text } }
 * @param {{headlineFont?:string, bodyFont?:string}} fonts
 * @returns {Promise<Uint8Array>}
 */
export async function buildEditedPdf(pages, overridesByPage = {}, fonts = {}) {
  const headlineFamily = fonts.headlineFont || 'Inter';
  const bodyFamily = fonts.bodyFont || 'Inter';

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const headlineFont = await getFont(doc, headlineFamily, 700);
  const bodyFont = await getFont(doc, bodyFamily, 400);

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

      // Title-tier blocks use the design's headline font, everything else the body font.
      const isTitle = block.tier === 'title';
      const font = isTitle ? headlineFont : bodyFont;
      if (!font) continue;

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

// ── Template-mode designs: PreviewDocument layout as real PDF ──

const LETTER = [612, 792];
const MARGIN = 48;
const CONTENT_W = LETTER[0] - MARGIN * 2;

async function embedDataUrlImage(doc, dataUrl) {
  if (!dataUrl) return null;
  const bytes = await fetch(dataUrl).then((r) => r.arrayBuffer()).catch(() => null);
  if (!bytes) return null;
  return (await doc.embedPng(bytes).catch(() => null))
    ?? (await doc.embedJpg(bytes).catch(() => null));
}

/**
 * Renders the same layout as components/PreviewDocument.jsx using the
 * design's actual headline/body fonts.
 * @returns {Promise<Uint8Array>}
 */
export async function buildTemplatePdf(design, proposal) {
  const headlineFamily = design.headlineFont || 'Inter';
  const bodyFamily = design.bodyFont || 'Inter';

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const headline700 = await getFont(doc, headlineFamily, 700);
  const headline400 = await getFont(doc, headlineFamily, 400);
  const body400 = await getFont(doc, bodyFamily, 400);
  const body600 = await getFont(doc, bodyFamily, 600);

  let page = doc.addPage(LETTER);
  let y = LETTER[1] - MARGIN;

  const ensureSpace = (needed) => {
    if (y - needed < MARGIN) {
      page = doc.addPage(LETTER);
      y = LETTER[1] - MARGIN;
    }
  };

  function drawWrapped(text, { font, size, color, lineHeight = 1.35, gapAfter = 0, maxWidth = CONTENT_W }) {
    if (!text || !font) return;
    const lines = wrapText(text, font, size, maxWidth);
    for (const ln of lines) {
      ensureSpace(size * lineHeight + 2);
      y -= size * lineHeight;
      page.drawText(ln, { x: MARGIN, y, size, font, color, lineHeight: size * lineHeight });
    }
    y -= gapAfter;
  }

  // Header: logo left, sender right (mirrors .proposal-doc-header)
  const logoImg = await embedDataUrlImage(doc, design.logoDataUrl);
  let headerH = 0;
  if (logoImg) {
    // .proposal-logo { max-height: 44px; max-width: 160px } → pt at 0.75 scale
    const drawH = Math.min(33, logoImg.height);
    const drawW = Math.min(120, drawH * (logoImg.width / logoImg.height));
    page.drawImage(logoImg, {
      x: MARGIN,
      y: y - Math.max(drawH, 0),
      width: drawW,
      height: drawH,
    });
    headerH = drawH;
  }
  if (design.senderName || design.tagline) {
    const nameSize = 13;
    const tagSize = 11;
    const rightX = MARGIN + CONTENT_W / 2;
    let ry = y;
    let rightH = 0;
    if (design.senderName && body600) {
      ry -= nameSize;
      page.drawText(design.senderName, { x: rightX, y: ry, size: nameSize, font: body600, color: INK });
      rightH += nameSize * 1.3;
    }
    if (design.tagline && body400) {
      ry -= tagSize * 1.4;
      page.drawText(design.tagline, { x: rightX, y: ry, size: tagSize, font: body400, color: MUTED });
      rightH += tagSize * 1.4;
    }
    headerH = Math.max(headerH, rightH);
  }
  y -= headerH;
  y -= 18; // header margin-bottom 1.5rem

  // Hero image (.proposal-hero)
  if (design.heroImageDataUrl) {
    const hero = await embedDataUrlImage(doc, design.heroImageDataUrl);
    if (hero) {
      const heroH = Math.min(CONTENT_W * (hero.height / hero.width), 300);
      ensureSpace(heroH + 12);
      y -= heroH;
      page.drawImage(hero, { x: MARGIN, y, width: CONTENT_W, height: heroH });
      y -= 18;
    }
  }

  // Headline (.proposal-headline: 2rem, accent/green-dark)
  drawWrapped(proposal?.headline || '', {
    font: headline700,
    size: 27,
    color: GREEN_DARK,
    lineHeight: 1.15,
    gapAfter: 14,
  });

  // Opening (.proposal-opening: 1.15rem)
  drawWrapped(proposal?.opening || '', { font: body400, size: 15.5, color: INK, gapAfter: 13 });

  // Body paragraphs (.proposal-body-paragraph)
  for (const p of proposal?.bodyParagraphs || []) {
    drawWrapped(p, { font: body400, size: 13, color: INK, gapAfter: 11 });
  }

  // Static sections (.proposal-static-section)
  for (const s of (design.staticSections || []).filter((sec) => sec.heading || sec.body)) {
    ensureSpace(60);
    y -= 10;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_W, y },
      thickness: 0.75,
      color: rgb(0xe2 / 255, 0xe4 / 255, 0xe9 / 255),
    });
    y -= 8;
    if (s.heading) {
      drawWrapped(s.heading, { font: headline400, size: 15.5, color: GREEN_DARK, gapAfter: 6 });
    }
    drawWrapped(s.body, { font: body400, size: 13, color: INK, gapAfter: 6 });
  }

  // Closing (.proposal-closing)
  if (proposal?.closing) {
    ensureSpace(50);
    y -= 14;
    drawWrapped(proposal.closing, { font: body400, size: 13, color: INK, gapAfter: 0 });
  }

  return doc.save();
}

// ── Unified entry point ─────────────────────────────────────

/**
 * The one export entry point. Branches on whether the design has an uploaded
 * source document — deliberate, not accidental: uploaded designs keep their
 * original artwork as embedded page images, template designs render natively.
 *
 * @param {object} design — active design (client-side shape)
 * @param {object|null} proposal — current proposal (client-side shape)
 * @returns {Promise<Uint8Array>} PDF bytes
 */
export async function buildProposalPdf(design, proposal) {
  if (design.sourceImageDataUrl) {
    // Uploaded-document mode: pages are PNG screenshots of each source page,
    // edited text is drawn over them at its original position.
    const pages = (design.pages?.length
      ? design.pages
      : [{
          pageNum: '1',
          dataUrl: design.sourceImageDataUrl,
          width: design.sourceImageWidth,
          height: design.sourceImageHeight,
          blocks: design.sourceTextBlocks || [],
        }]
    ).filter((p) => p?.dataUrl);
    if (!pages.length) throw new Error('Design has no rendered pages to export.');

    return buildEditedPdf(pages, design.pageOverrides || {}, {
      headlineFont: design.headlineFont,
      bodyFont: design.bodyFont,
    });
  }

  // Template mode: no source document — render the document natively.
  return buildTemplatePdf(design, proposal);
}

export function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
