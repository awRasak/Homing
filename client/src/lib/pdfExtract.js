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

    const textItems = await extractTextItems(page, viewport);

    return { canvas, textItems, isPdf: true, pageCount: pdf.numPages };
  }

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0);
  return { canvas, textItems: null, isPdf: false, pageCount: 1 };
}

/**
 * Render ALL pages of a PDF to canvases with text blocks per page.
 * For images, returns a single page.
 * @returns {Promise<Array<{ canvas, textItems, blocks, content, fonts, pageNum }>>}
 */
export async function renderAllPages(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

  if (!isPdf) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    return [{
      canvas,
      textItems: null,
      blocks: [],
      images: [],
      content: null,
      fonts: null,
      pageNum: 1,
      totalPages: 1,
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    }];
  }

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const totalPages = pdf.numPages;
  const pages = [];

  for (let i = 1; i <= totalPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1.75 });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    const textItems = await extractTextItems(page, viewport);
    const images = await extractPageImages(page, viewport);

    let content = null;
    let fonts = null;
    let blocks = [];
    if (textItems?.length) {
      content = extractContent(textItems);
      if (i === 1) {
        fonts = detectFonts(textItems);
      }
      blocks = buildTextBlocks(canvas, textItems);
      eraseTextBlocks(canvas, blocks);
    }

    pages.push({
      canvas,
      textItems,
      blocks,
      images,
      content: i === 1 ? content : null,
      fonts: i === 1 ? fonts : null,
      pageNum: i,
      totalPages,
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    });
  }

  return pages;
}

/**
 * Extract embedded raster images (logos, photos, graphics) from a PDF page
 * using the page's operator list. Returns array of { dataUrl, x, y, width,
 * height } positioned in canvas-pixel space (scale 1.75 render), or [].
 */
export async function extractPageImages(page, viewport) {
  try {
    const ops = await page.getOperatorList();
    const images = [];
    const processed = new Set();

    // Page bounds in PDF user space (scale 1 viewport).
    const pageVp = page.getViewport({ scale: 1 });
    const pageRect = [0, 0, pageVp.width, pageVp.height];

    // Track the current transform matrix using a real canvas context so the
    // semantics match the renderer exactly. pdf.js reports
    // paintImageXObject args as [name, width, height]; the destination is
    // derived by applying the CTM in effect at the paint op.
    const tracker = document.createElement('canvas').getContext('2d');
    const ctmStack = [];
    const clipStack = [pageRect.slice()];
    let pendingClip = false;

    const readCtm = () => {
      const t = tracker.getTransform();
      return [t.a, t.b, t.c, t.d, t.e, t.f];
    };

    const mapRect = (ctm, [rx, ry, rw, rh]) => {
      const x0 = ctm[0] * rx + ctm[2] * ry + ctm[4];
      const y0 = ctm[1] * rx + ctm[3] * ry + ctm[5];
      const x1 = ctm[0] * (rx + rw) + ctm[2] * (ry + rh) + ctm[4];
      const y1 = ctm[1] * (rx + rw) + ctm[3] * (ry + rh) + ctm[5];
      return [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];
    };

    const intersectRect = (a, b) => {
      const x = Math.max(a[0], b[0]);
      const y = Math.max(a[1], b[1]);
      const w = Math.min(a[0] + a[2], b[0] + b[2]) - x;
      const h = Math.min(a[1] + a[3], b[1] + b[3]) - y;
      if (w <= 0 || h <= 0) return null;
      return [x, y, w, h];
    };

    const currentClip = () => {
      let acc = null;
      for (const r of clipStack) acc = acc ? intersectRect(acc, r) : r;
      return acc || [0, 0, 0, 0];
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] || [];

      if (fn === pdfjsLib.OPS.save || fn === pdfjsLib.OPS.beginGroup || fn === pdfjsLib.OPS.paintFormXObjectBegin) {
        ctmStack.push(readCtm());
        tracker.save();
        clipStack.push(clipStack[clipStack.length - 1].slice());
        if (fn === pdfjsLib.OPS.beginGroup || fn === pdfjsLib.OPS.paintFormXObjectBegin) {
          const g = args[0];
          if (g?.matrix) tracker.transform(...g.matrix.map(Number));
          else if (Array.isArray(args[0]) && args.length >= 6) tracker.transform(...args.slice(0, 6).map(Number));
        }
        continue;
      }
      if (fn === pdfjsLib.OPS.restore || fn === pdfjsLib.OPS.endGroup || fn === pdfjsLib.OPS.paintFormXObjectEnd) {
        tracker.restore();
        if (clipStack.length > 1) clipStack.pop();
        pendingClip = false;
        continue;
      }
      if (fn === pdfjsLib.OPS.transform) {
        tracker.transform(...args.map(Number));
        continue;
      }
      if (fn === pdfjsLib.OPS.clip) {
        pendingClip = true;
        continue;
      }
      if (fn === pdfjsLib.OPS.constructPath && pendingClip) {
        pendingClip = false;
        const bbox = args[2];
        if (bbox) {
          const clip = mapRect(readCtm(), [bbox[0], bbox[1], bbox[2] - bbox[0], bbox[3] - bbox[1]]);
          const top = clipStack[clipStack.length - 1];
          clipStack[clipStack.length - 1] = intersectRect(top, clip) || [0, 0, 0, 0];
        }
        continue;
      }
      if (fn !== pdfjsLib.OPS.paintImageXObject) continue;
      const name = args[0];
      if (!name || processed.has(name)) continue;
      processed.add(name);

      let obj = null;
      try {
        obj = await Promise.resolve(page.objs.get(name)).catch(() => null);
      } catch {
        obj = null;
      }
      if (!obj) continue;

      const iw = obj.width;
      const ih = obj.height;
      if (!iw || !ih) continue;
      const drawable = obj.bitmap || obj;

      const ctm = readCtm();
      const mapPoint = (x, y) => [
        ctm[0] * x + ctm[2] * y + ctm[4],
        ctm[1] * x + ctm[3] * y + ctm[5],
      ];

      // Destination rectangle in PDF user space from the CTM, then intersect
      // with the current clip so only the visible region is reported (many
      // PDFs paint images at huge scale and clip them to a small area).
      const [p1x, p1y] = mapPoint(0, 0);
      const [p2x, p2y] = mapPoint(iw, ih);
      let x = Math.min(p1x, p2x);
      let y = Math.min(p1y, p2y);
      let w = Math.abs(p2x - p1x);
      let h = Math.abs(p2y - p1y);
      const clipped = intersectRect([x, y, w, h], currentClip());
      if (clipped) {
        [x, y, w, h] = clipped;
      }

      if (w <= 4 || h <= 4) continue;

      const p1 = viewport.convertToViewportPoint(x, y);
      const p2 = viewport.convertToViewportPoint(x + w, y + h);
      const canvasX = Math.min(p1[0], p2[0]);
      const canvasY = Math.min(p1[1], p2[1]);
      const cw = Math.abs(p2[0] - p1[0]);
      const ch = Math.abs(p2[1] - p1[1]);
      if (cw <= 6 || ch <= 6) continue;

      let dataUrl = null;
      try {
        const imgCanvas = document.createElement('canvas');
        imgCanvas.width = iw;
        imgCanvas.height = ih;
        imgCanvas.getContext('2d').drawImage(drawable, 0, 0);
        dataUrl = imgCanvas.toDataURL('image/png');
      } catch {}

      images.push({
        dataUrl,
        x: canvasX,
        y: canvasY,
        width: cw,
        height: ch,
        srcWidth: iw,
        srcHeight: ih,
      });
    }

    // Deduplicate overlapping crops.
    return images.filter((img, i) => {
      for (let j = 0; j < i; j++) {
        const a = img;
        const b = images[j];
        const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
        const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
        if (overlapX / Math.min(a.width, b.width) > 0.8 && overlapY / Math.min(a.height, b.height) > 0.8) {
          return false;
        }
      }
      return true;
    });
  } catch {
    return [];
  }
}

async function extractTextItems(page, viewport) {
  const content = await page.getTextContent();
  const textItems = content.items.map((item) => {
    const fontSize = Math.hypot(item.transform[2], item.transform[3]);
    const x = item.transform[4];
    const y = item.transform[5];
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

  return textItems;
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

/**
 * Auto-detect a likely logo region. Logos usually sit in the top corners,
 * are compact, and stand out from the page background (higher colorfulness
 * and/or contrast). Returns canvas-pixel { x, y, width, height } or null.
 */
export function detectLogoRegion(canvas) {
  const ctx = canvas.getContext('2d');
  const { width, height } = canvas;
  const cell = Math.max(8, Math.round(Math.min(width, height) / 60));

  const scoreAt = (cx, cy) => {
    const { data } = ctx.getImageData(cx, cy, cell, cell);
    let satSum = 0;
    let lumSum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 180) continue;
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      satSum += sat;
      lumSum += lum;
      n += 1;
    }
    if (n === 0) return { sat: 0, lum: 0, n: 0 };
    return { sat: satSum / n, lum: lumSum / n, n };
  };

  // Build a coarse score grid over the top 35% of the page.
  const scanH = Math.max(1, Math.round(height * 0.35));
  const cols = Math.floor(width / cell);
  const rows = Math.floor(scanH / cell);
  const grid = [];
  for (let r = 0; r < rows; r++) {
    grid[r] = [];
    for (let c = 0; c < cols; c++) {
      const s = scoreAt(c * cell, r * cell);
      grid[r][c] = s.n === 0 ? 0 : s.sat * (s.n / (cell * cell));
    }
  }

  const threshold = 0.22;
  let bestScore = 0;
  let seed = null;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] > bestScore) {
        bestScore = grid[r][c];
        seed = { r, c };
      }
    }
  }
  if (!seed || bestScore < 0.28) return null;

  // Connected-component expansion from the seed (4-neighbour, keep only cells
  // above threshold) so the box stays on the actual logo blob, not the page.
  const visited = new Set();
  const stack = [seed];
  visited.add(`${seed.r},${seed.c}`);
  let minR = seed.r, maxR = seed.r, minC = seed.c, maxC = seed.c;
  while (stack.length) {
    const { r, c } = stack.pop();
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    const neigh = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
    for (const [nr, nc] of neigh) {
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const key = `${nr},${nc}`;
      if (visited.has(key)) continue;
      if (grid[nr][nc] >= threshold) {
        visited.add(key);
        stack.push({ r: nr, c: nc });
      }
    }
  }

  const pad = Math.round(cell * 0.6);
  const x = Math.max(0, minC * cell - pad);
  const y = Math.max(0, minR * cell - pad);
  const w = Math.min(width, (maxC + 1) * cell + pad) - x;
  const h = Math.min(scanH + cell, (maxR + 1) * cell + pad) - y;

  // Logos are compact: reject anything that spans most of the page.
  if (w < 12 || h < 12) return null;
  if (w > width * 0.45 || h > height * 0.3) return null;

  return { x, y, width: w, height: h };
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
 * Paint over each text block's bounding region on the canvas using the
 * background color sampled from the block's edge pixels. This strips
 * baked-in text from the rendered page image so the live preview's
 * contenteditable overlays are the only visible text.
 */
function eraseTextBlocks(canvas, blocks) {
  if (!blocks || blocks.length === 0) return;
  const ctx = canvas.getContext('2d');

  for (const block of blocks) {
    const cx = Math.max(0, Math.floor(block.x));
    const cy = Math.max(0, Math.floor(block.y));
    const cw = Math.min(Math.ceil(block.width), canvas.width - cx);
    const ch = Math.min(Math.ceil(block.height), canvas.height - cy);
    if (cw <= 0 || ch <= 0) continue;

    const edgeColor = sampleEdgeColor(canvas, cx, cy, cw, ch);
    ctx.fillStyle = edgeColor;
    ctx.fillRect(cx, cy, cw, ch);
  }
}

/**
 * Sample the most-common color along the 1-pixel border of a canvas
 * rectangle. Edge pixels are almost always page background (text rarely
 * touches the exact bounding-box edge).
 */
function sampleEdgeColor(canvas, x, y, w, h) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(x, y, Math.max(1, Math.min(w, canvas.width - x)), Math.max(1, Math.min(h, canvas.height - y)));
  const cw = Math.max(1, Math.min(w, canvas.width - x));

  const counts = new Map();

  function sample(px, py) {
    const idx = (py * cw + px) * 4;
    if (idx + 2 < data.length) {
      const key = `${data[idx]},${data[idx + 1]},${data[idx + 2]}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const lastRow = Math.min(h - 1, data.length / (cw * 4) - 1);
  for (let px = 0; px < cw; px++) {
    sample(px, 0);
    if (lastRow > 0) sample(px, lastRow);
  }
  const lastCol = cw - 1;
  const rows = Math.min(h, Math.floor(data.length / (cw * 4)));
  for (let py = 0; py < rows; py++) {
    sample(0, py);
    if (lastCol > 0) sample(lastCol, py);
  }

  if (counts.size === 0) return '#ffffff';
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
  return rgbToHex(top[0], top[1], top[2]);
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
  for (const item of sorted) {
    if (!item.str.trim()) continue;
    const yTol = Math.max(3, (item.fontSize || 12) * 0.45);
    if (current && Math.abs(current.top - item.canvasY) <= yTol) {
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
      const measuredWidth = l.right - l.left + pad * 2;
      const measuredHeight = l.bottom - l.top + pad * 2;
      const estCharWidth = l.maxSize * 0.55;
      const minWidth = l.str.trim().length * estCharWidth + pad * 2;
      const minHeight = l.maxSize * 1.3;
      const width = Math.max(measuredWidth, minWidth);
      const height = Math.max(measuredHeight, minHeight);
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
