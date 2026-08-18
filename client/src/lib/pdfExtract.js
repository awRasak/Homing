import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { resolveFont } from './googleFonts';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * Render the first page of a PDF (or a plain image) to a canvas.
 * @returns {Promise<{ canvas: HTMLCanvasElement, textItems: Array|null, isPdf: boolean }>}
 */
export async function renderSource(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  if (isPdf) {
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.75 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const content = await page.getTextContent();
    const textItems = content.items.map((item) => {
      const fontSize = Math.hypot(item.transform[2], item.transform[3]);
      const x = item.transform[4];
      const y = item.transform[5];
      // Convert PDF-space (y-up, origin bottom-left) corners into canvas-pixel
      // space (y-down, origin top-left) so overlays can be positioned directly
      // over the rendered raster image.
      const p1 = viewport.convertToViewportPoint(x, y);
      const p2 = viewport.convertToViewportPoint(x + item.width, y + fontSize);
      return {
        str: item.str,
        fontName: item.fontName,
        fontSize,
        x,
        y,
        width: item.width,
        canvasX: Math.min(p1[0], p2[0]),
        canvasY: Math.min(p1[1], p2[1]),
        canvasWidth: Math.abs(p2[0] - p1[0]),
        canvasHeight: Math.abs(p2[1] - p1[1]),
      };
    });

    // Map internal pdf.js font keys (e.g. "g_d0_f1") to real font names via the page's commonObjs.
    const fontNameCache = {};
    for (const key of new Set(textItems.map((t) => t.fontName))) {
      try {
        const fontObj = page.commonObjs.get(key);
        fontNameCache[key] = fontObj?.name || key;
      } catch {
        fontNameCache[key] = key;
      }
    }
    textItems.forEach((t) => {
      t.fontName = fontNameCache[t.fontName] || t.fontName;
    });

    return { canvas, textItems, isPdf: true };
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, textItems: null, isPdf: false };
}

/**
 * Sample the rendered canvas and surface ~5-7 dominant, non-background colors.
 */
export function extractPalette(canvas, maxSwatches = 7) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);

  const buckets = new Map(); // quantized hex -> { count, r, g, b }
  const step = 4; // sample every 4th pixel for speed
  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a < 200) continue;
    // Quantize to reduce near-duplicate colors into the same bucket.
    const qr = Math.round(r / 16) * 16;
    const qg = Math.round(g / 16) * 16;
    const qb = Math.round(b / 16) * 16;
    const key = `${qr},${qg},${qb}`;
    const bucket = buckets.get(key) || { count: 0, r: qr, g: qg, b: qb };
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const isNearWhiteOrBlackOrGray = ({ r, g, b }) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const isNeutral = max - min < 12; // low saturation => grayscale-ish
    const isNearWhite = r > 235 && g > 235 && b > 235;
    const isNearBlack = r < 25 && g < 25 && b < 25;
    return isNearWhite || isNearBlack || isNeutral;
  };

  const ranked = [...buckets.values()]
    .filter((c) => !isNearWhiteOrBlackOrGray(c))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxSwatches);

  return ranked.map((c) => rgbToHex(c.r, c.g, c.b));
}

export function sampleColorAtPixel(canvas, x, y) {
  const ctx = canvas.getContext('2d');
  const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
  return rgbToHex(r, g, b);
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

export function cropCanvasRegion(sourceCanvas, x, y, w, h) {
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w));
  out.height = Math.max(1, Math.round(h));
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, x, y, w, h, 0, 0, out.width, out.height);
  return out.toDataURL('image/png');
}

/**
 * Detect the headline and body fonts from PDF text items, resolving each
 * against the Google Fonts shortlist / metric-compatible map / heuristic.
 */
export function detectFonts(textItems) {
  if (!textItems || textItems.length === 0) return null;

  const sizeCounts = new Map();
  for (const item of textItems) {
    if (!item.str.trim()) continue;
    const size = Math.round(item.fontSize);
    sizeCounts.set(size, (sizeCounts.get(size) || 0) + item.str.length);
  }

  const maxSize = Math.max(...sizeCounts.keys());
  const headlineItem = textItems.find((t) => Math.round(t.fontSize) === maxSize && t.str.trim());

  const bodySizes = [...sizeCounts.entries()]
    .filter(([size]) => size < maxSize)
    .sort((a, b) => b[1] - a[1]);
  const bodySize = bodySizes[0]?.[0];
  const bodyItem = textItems.find((t) => Math.round(t.fontSize) === bodySize && t.str.trim());

  const headline = resolveFont(headlineItem?.fontName, 'headline');
  const body = resolveFont(bodyItem?.fontName, 'body');

  return { headline, body };
}

const HEADING_KEYWORDS =
  /^(why us|our process|process|pricing|investment|about us|our approach|what we offer|scope|timeline|deliverables|next steps|about|services)\b/i;
const SENDER_LABEL = /(prepared by|from)\s*:?\s*(.+)/i;
const RECIPIENT_LABEL = /(prepared for|to)\s*:?\s*(.+)/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

/**
 * Group PDF text items into lines, classify by font-size tier, and pull out
 * the structural pieces the setup form can auto-fill.
 */
export function extractContent(textItems) {
  if (!textItems || textItems.length === 0) return null;

  const sorted = [...textItems].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let current = null;
  const Y_TOLERANCE = 3;
  for (const item of sorted) {
    if (!item.str.trim()) continue;
    if (current && Math.abs(current.y - item.y) <= Y_TOLERANCE) {
      current.str += item.str;
      current.maxSize = Math.max(current.maxSize, item.fontSize);
    } else {
      current = { str: item.str, y: item.y, maxSize: item.fontSize };
      lines.push(current);
    }
  }

  if (lines.length === 0) return null;

  const sizes = lines.map((l) => l.maxSize);
  const maxSize = Math.max(...sizes);
  const sizeFreq = new Map();
  sizes.forEach((s) => sizeFreq.set(Math.round(s), (sizeFreq.get(Math.round(s)) || 0) + 1));
  const bodySize = [...sizeFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? maxSize;

  const tierOf = (size) => {
    if (size >= maxSize - 0.5) return 'title';
    if (size > bodySize + 1.5) return 'heading';
    return 'body';
  };

  const filled = { sections: [], notes: [] };
  const titleLine = lines.find((l) => tierOf(l.maxSize) === 'title');
  filled.detectedHeadline = titleLine?.str.trim() || '';
  if (filled.detectedHeadline) {
    filled.notes.push(`Detected headline: "${filled.detectedHeadline}" (used as a structural hint only, never copied verbatim).`);
  }

  let senderName = '';
  let recipientCompany = '';
  let contactEmail = '';
  const introParagraphLines = [];
  let currentHeading = null;
  const headingBodies = new Map();

  for (const line of lines) {
    const text = line.str.trim();
    if (!text || line === titleLine) continue;

    const senderMatch = text.match(SENDER_LABEL);
    if (senderMatch && !senderName) senderName = senderMatch[2].trim();

    const recipientMatch = text.match(RECIPIENT_LABEL);
    if (recipientMatch && !recipientCompany) recipientCompany = recipientMatch[2].trim();

    const emailMatch = text.match(EMAIL_RE);
    if (emailMatch && !contactEmail) contactEmail = emailMatch[0];

    if (senderMatch || recipientMatch) continue; // don't also treat label lines as body content

    const tier = tierOf(line.maxSize);
    if (tier === 'heading' && HEADING_KEYWORDS.test(text)) {
      currentHeading = text;
      headingBodies.set(currentHeading, []);
    } else if (tier === 'heading') {
      // A heading-sized line that isn't a recognized keyword still starts a new section.
      currentHeading = text;
      headingBodies.set(currentHeading, []);
    } else if (currentHeading) {
      headingBodies.get(currentHeading).push(text);
    } else {
      introParagraphLines.push(text);
    }
  }

  filled.sections = [...headingBodies.entries()]
    .filter(([, bodyLines]) => bodyLines.length > 0)
    .map(([heading, bodyLines]) => ({ heading, body: bodyLines.join(' ') }));

  filled.styleSample = introParagraphLines.join(' ').trim();
  filled.senderName = senderName;
  filled.recipientCompany = recipientCompany;
  filled.contactEmail = contactEmail;

  if (filled.sections.length) {
    filled.notes.push(`Auto-filled ${filled.sections.length} static section(s) from headed body text: ${filled.sections.map((s) => s.heading).join(', ')}.`);
  } else {
    filled.notes.push('No heading-sized sections were detected — static sections were left blank.');
  }
  if (filled.styleSample) {
    filled.notes.push('Auto-filled the style sample from the intro text above the first heading.');
  }
  if (senderName) filled.notes.push(`Auto-filled sender name from a "${senderName ? 'Prepared by / From' : ''}" line.`);
  if (recipientCompany) filled.notes.push(`Detected a recipient/company reference: "${recipientCompany}".`);
  if (contactEmail) filled.notes.push(`Auto-filled contact line from a detected email address: ${contactEmail}.`);

  return filled;
}

/**
 * Sample the most-frequent (background) color in a canvas region, and the
 * color furthest from it in that same region (a decent proxy for foreground
 * text color) — used to mask/replace original PDF text when a block is
 * edited in the live preview.
 */
function sampleBlockColors(canvas, x, y, w, h) {
  const cx = Math.max(0, Math.floor(x));
  const cy = Math.max(0, Math.floor(y));
  const cw = Math.max(1, Math.min(Math.ceil(w), canvas.width - cx));
  const ch = Math.max(1, Math.min(Math.ceil(h), canvas.height - cy));
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(cx, cy, cw, ch);

  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [bgR, bgG, bgB] = sorted[0][0].split(',').map(Number);

  let fg = [0, 0, 0];
  let maxDist = -1;
  for (const [key] of sorted) {
    const [r, g, b] = key.split(',').map(Number);
    const dist = (r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2;
    if (dist > maxDist) {
      maxDist = dist;
      fg = [r, g, b];
    }
  }

  return { bg: rgbToHex(bgR, bgG, bgB), fg: rgbToHex(fg[0], fg[1], fg[2]) };
}

/**
 * Group text items (with canvas-pixel bounding boxes already attached by
 * renderSource) into line-level blocks positioned over the rendered page
 * image, for live in-place editing in the preview.
 */
export function buildTextBlocks(canvas, textItems) {
  if (!textItems || textItems.length === 0) return [];

  const sorted = [...textItems].sort((a, b) => a.canvasY - b.canvasY || a.canvasX - b.canvasX);
  const lines = [];
  let current = null;
  const Y_TOLERANCE = 3;
  for (const item of sorted) {
    if (!item.str.trim()) continue;
    if (current && Math.abs(current.top - item.canvasY) <= Y_TOLERANCE) {
      current.str += item.str;
      current.left = Math.min(current.left, item.canvasX);
      current.right = Math.max(current.right, item.canvasX + item.canvasWidth);
      current.top = Math.min(current.top, item.canvasY);
      current.bottom = Math.max(current.bottom, item.canvasY + item.canvasHeight);
      current.maxSize = Math.max(current.maxSize, item.fontSize);
    } else {
      current = {
        str: item.str,
        left: item.canvasX,
        right: item.canvasX + item.canvasWidth,
        top: item.canvasY,
        bottom: item.canvasY + item.canvasHeight,
        maxSize: item.fontSize,
      };
      lines.push(current);
    }
  }

  const sizes = lines.map((l) => l.maxSize);
  const maxSize = Math.max(...sizes);
  const sizeFreq = new Map();
  sizes.forEach((s) => sizeFreq.set(Math.round(s), (sizeFreq.get(Math.round(s)) || 0) + 1));
  const bodySize = [...sizeFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? maxSize;
  const tierOf = (size) => {
    if (size >= maxSize - 0.5) return 'title';
    if (size > bodySize + 1.5) return 'heading';
    return 'body';
  };

  return lines
    .filter((l) => l.str.trim())
    .map((l, i) => {
      const pad = l.maxSize * 0.15;
      const x = Math.max(0, l.left - pad);
      const y = Math.max(0, l.top - pad);
      const width = l.right - l.left + pad * 2;
      const height = l.bottom - l.top + pad * 2;
      const { bg, fg } = sampleBlockColors(canvas, x, y, width, height);
      return {
        id: `block-${i}`,
        text: l.str.trim(),
        tier: tierOf(l.maxSize),
        x,
        y,
        width,
        height,
        bg,
        fg,
      };
    });
}
