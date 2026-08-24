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
    const { images, shapes, bgColor } = await extractPageContent(page, viewport);

    let content = null;
    let fonts = null;
    let designData = null;
    let blocks = [];
    if (textItems?.length) {
      content = extractContent(textItems);
      if (i === 1) {
        fonts = detectFonts(textItems);
        designData = extractDesignData(shapes, images, textItems, bgColor);
      }
      blocks = buildTextBlocks(canvas, textItems);
      eraseTextItems(canvas, textItems);
      // Erase background images from the canvas — they'll be re-rendered as
      // divs with reduced opacity so they sit quietly behind the content.
      const bgs = images.filter((img) => img.isBackground);
      if (bgs.length) eraseBackgroundImages(canvas, bgs);
    }

    pages.push({
      canvas,
      textItems,
      blocks,
      images,
      shapes,
      bgColor,
      content: i === 1 ? content : null,
      fonts: i === 1 ? fonts : null,
      designData: i === 1 ? designData : null,
      pageNum: i,
      totalPages,
      dataUrl: canvas.toDataURL('image/png'),
      width: canvas.width,
      height: canvas.height,
    });

    // Yield a frame between pages so spinners/step UI keep animating
    // instead of freezing while the main thread renders the next page.
    await new Promise((r) => setTimeout(r, 16));
  }

  return pages;
}

function rgbaToHex(r, g, b) {
  return '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

function parsePdfColor(args) {
  if (!args || args.length < 3) return null;
  const r = Math.round(Math.min(1, Math.max(0, args[0])) * 255);
  const g = Math.round(Math.min(1, Math.max(0, args[1])) * 255);
  const b = Math.round(Math.min(1, Math.max(0, args[2])) * 255);
  return rgbaToHex(r, g, b);
}

/**
 * Extract embedded raster images (logos, photos, graphics) AND vector shapes
 * (filled/stroked rectangles) from a PDF page using the operator list.
 * Returns { images, shapes } positioned in canvas-pixel space (scale 1.75).
 */
export async function extractPageContent(page, viewport) {
  const images = [];
  const shapes = [];
  try {
    const ops = await page.getOperatorList();
    const processed = new Set();

    const pageVp = page.getViewport({ scale: 1 });
    const pageRect = [0, 0, pageVp.width, pageVp.height];

    const tracker = document.createElement('canvas').getContext('2d');
    const ctmStack = [];
    const clipStack = [pageRect.slice()];
    let pendingClip = false;

    let fillColor = null;
    let strokeColor = null;
    let lineWidth = 1;
    let currentPathOps = [];
    let currentPathCoords = [];
    let pathMatrix = null;

    const readCtm = () => {
      const t = tracker.getTransform();
      return [t.a, t.b, t.c, t.d, t.e, t.f];
    };

    const mapPoint = (ctm, x, y) => [
      ctm[0] * x + ctm[2] * y + ctm[4],
      ctm[1] * x + ctm[3] * y + ctm[5],
    ];

    const mapRect = (ctm, [rx, ry, rw, rh]) => {
      const [x0, y0] = mapPoint(ctm, rx, ry);
      const [x1, y1] = mapPoint(ctm, rx + rw, ry + rh);
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

    const viewportConvert = (x, y) => viewport.convertToViewportPoint(x, y);

    const flushPathAsShape = (isFill, isStroke) => {
      if (currentPathOps.length === 0) return;
      const ctm = pathMatrix || readCtm();

      for (let i = 0; i < currentPathOps.length; i++) {
        const op = currentPathOps[i];
        if (op === 3) {
          const coords = currentPathCoords[i];
          if (!coords || coords.length < 4) continue;
          const [rx, ry, rw, rh] = coords;
          const [x0, y0] = mapPoint(ctm, rx, ry);
          const [x1, y1] = mapPoint(ctm, rx + rw, ry + rh);
          const sx = Math.min(x0, x1);
          const sy = Math.min(y0, y1);
          const sw = Math.abs(x1 - x0);
          const sh = Math.abs(y1 - y0);
          if (sw < 2 || sh < 2) continue;

          const clipped = intersectRect([sx, sy, sw, sh], currentClip());
          const [cx, cy, cw, ch] = clipped || [sx, sy, sw, sh];
          if (cw < 2 || ch < 2) continue;

          const [vp1x, vp1y] = viewportConvert(cx, cy);
          const [vp2x, vp2y] = viewportConvert(cx + cw, cy + ch);
          const canvasX = Math.min(vp1x, vp2x);
          const canvasY = Math.min(vp1y, vp2y);
          const canvasW = Math.abs(vp2x - vp1x);
          const canvasH = Math.abs(vp2y - vp1y);

          shapes.push({
            type: 'rect',
            x: canvasX,
            y: canvasY,
            width: canvasW,
            height: canvasH,
            fill: isFill ? fillColor : null,
            stroke: isStroke ? strokeColor : null,
            strokeWidth: isStroke ? lineWidth * viewport.scale : 0,
          });
        }
      }
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i] || [];

      if (fn === pdfjsLib.OPS.save || fn === pdfjsLib.OPS.beginGroup || fn === pdfjsLib.OPS.paintFormXObjectBegin) {
        ctmStack.push({ ctm: readCtm(), fill: fillColor, stroke: strokeColor, lineW: lineWidth });
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
        const saved = ctmStack.pop();
        if (saved) {
          fillColor = saved.fill;
          strokeColor = saved.stroke;
          lineWidth = saved.lineW;
        }
        if (clipStack.length > 1) clipStack.pop();
        pendingClip = false;
        currentPathOps = [];
        currentPathCoords = [];
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
      }

      if (fn === pdfjsLib.OPS.constructPath) {
        const subPaths = args[0];
        const pathArgs = args[1];
        const matrix = args[2];
        pathMatrix = matrix ? [...matrix] : null;
        let coordIdx = 0;
        for (const op of subPaths) {
          if (op === 0) {
            currentPathOps.push(0);
            currentPathCoords.push([pathArgs[coordIdx], pathArgs[coordIdx + 1]]);
            coordIdx += 2;
          } else if (op === 1) {
            currentPathOps.push(1);
            currentPathCoords.push([pathArgs[coordIdx], pathArgs[coordIdx + 1]]);
            coordIdx += 2;
          } else if (op === 3) {
            currentPathOps.push(3);
            currentPathCoords.push([
              pathArgs[coordIdx], pathArgs[coordIdx + 1],
              pathArgs[coordIdx + 2], pathArgs[coordIdx + 3],
            ]);
            coordIdx += 4;
          } else if (op === 4) {
            currentPathOps.push(4);
            currentPathCoords.push([]);
          }
        }
        continue;
      }

      if (fn === pdfjsLib.OPS.setFillColor && args.length >= 3) {
        fillColor = parsePdfColor(args);
        continue;
      }
      if (fn === pdfjsLib.OPS.setFillColorSpace) {
        continue;
      }
      if (fn === pdfjsLib.OPS.setStrokeColor && args.length >= 3) {
        strokeColor = parsePdfColor(args);
        continue;
      }
      if (fn === pdfjsLib.OPS.setLineWidth) {
        lineWidth = args[0] || 1;
        continue;
      }

      if (fn === pdfjsLib.OPS.fill || fn === pdfjsLib.OPS.eoFill) {
        flushPathAsShape(true, false);
        currentPathOps = [];
        currentPathCoords = [];
        pathMatrix = null;
        continue;
      }
      if (fn === pdfjsLib.OPS.stroke || fn === pdfjsLib.OPS.closeStroke) {
        flushPathAsShape(false, true);
        currentPathOps = [];
        currentPathCoords = [];
        pathMatrix = null;
        continue;
      }
      if (fn === pdfjsLib.OPS.fillStroke || fn === pdfjsLib.OPS.eoFillStroke || fn === pdfjsLib.OPS.closeFillStroke) {
        flushPathAsShape(true, true);
        currentPathOps = [];
        currentPathCoords = [];
        pathMatrix = null;
        continue;
      }
      if (fn === pdfjsLib.OPS.endPath) {
        currentPathOps = [];
        currentPathCoords = [];
        pathMatrix = null;
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

      const ctm = readCtm();
      const [p1x, p1y] = mapPoint(ctm, 0, 0);
      const [p2x, p2y] = mapPoint(ctm, iw, ih);
      let x = Math.min(p1x, p2x);
      let y = Math.min(p1y, p2y);
      let w = Math.abs(p2x - p1x);
      let h = Math.abs(p2y - p1y);
      const clipped = intersectRect([x, y, w, h], currentClip());
      if (clipped) [x, y, w, h] = clipped;
      if (w <= 4 || h <= 4) continue;

      const [vp1x, vp1y] = viewportConvert(x, y);
      const [vp2x, vp2y] = viewportConvert(x + w, y + h);
      const canvasX = Math.min(vp1x, vp2x);
      const canvasY = Math.min(vp1y, vp2y);
      const cw = Math.abs(vp2x - vp1x);
      const ch = Math.abs(vp2y - vp1y);
      if (cw <= 6 || ch <= 6) continue;

      let dataUrl = null;
      try {
        const imgCanvas = document.createElement('canvas');
        imgCanvas.width = iw;
        imgCanvas.height = ih;
        const imgCtx = imgCanvas.getContext('2d');
        let drawable = obj.bitmap;
        if (drawable && typeof drawable.close === 'function') {
          try { drawable = await createImageBitmap(drawable); } catch { drawable = null; }
        }
        if (!drawable && obj.data) {
          const imgData = new ImageData(new Uint8ClampedArray(obj.data), iw, ih);
          imgCtx.putImageData(imgData, 0, 0);
          dataUrl = imgCanvas.toDataURL('image/png');
        } else if (drawable) {
          imgCtx.drawImage(drawable, 0, 0);
          dataUrl = imgCanvas.toDataURL('image/png');
        }
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

    const deduped = images.filter((img, i) => {
      for (let j = 0; j < i; j++) {
        const b = images[j];
        if (!img.dataUrl || !b.dataUrl) continue;
        const overlapX = Math.max(0, Math.min(img.x + img.width, b.x + b.width) - Math.max(img.x, b.x));
        const overlapY = Math.max(0, Math.min(img.y + img.height, b.y + b.height) - Math.max(img.y, b.y));
        if (overlapX / Math.min(img.width, b.width) > 0.8 && overlapY / Math.min(img.height, b.height) > 0.8) {
          return false;
        }
      }
      return true;
    });

    const pageW = viewport.width;
    const pageH = viewport.height;
    const pageArea = pageW * pageH;

    // Classify images: large images covering >25% of the page are background
    // and should be rendered at reduced opacity.
    for (const img of deduped) {
      const coverage = (img.width * img.height) / pageArea;
      img.isBackground = coverage > 0.25;
      img.opacity = img.isBackground ? 0.08 : 1;
    }
    const minArea = pageArea * 0.0005;

    // Deduplicate: merge shapes at nearly identical positions, keeping the
    // last (topmost) fill color.
    const shapeDeduped = [];
    for (const s of shapes) {
      // Keep thin accent bars (min 2px in either dimension) but skip tiny noise.
      // A shape must have at least one dimension ≥ 10px OR the other ≥ 2px with
      // enough area to be structural (accent bars are often ~100×3px).
      if (s.width < 2 || s.height < 2) continue;
      if (s.width < 10 && s.height < 10) continue;
      if (s.width * s.height < minArea) continue;
      if (!s.fill && !s.stroke) continue;

      let merged = false;
      for (const existing of shapeDeduped) {
        const dx = Math.abs(s.x - existing.x);
        const dy = Math.abs(s.y - existing.y);
        const dw = Math.abs(s.width - existing.width);
        const dh = Math.abs(s.height - existing.height);
        if (dx < 2 && dy < 2 && dw < 2 && dh < 2) {
          if (s.fill) existing.fill = s.fill;
          if (s.stroke) {
            existing.stroke = s.stroke;
            existing.strokeWidth = s.strokeWidth;
          }
          merged = true;
          break;
        }
      }
      if (!merged) shapeDeduped.push(s);
    }

    // Separate full-page background fills from structural shapes.
    // Full-page fills (≥95% coverage) set the page background color.
    let bgColor = null;
    const structuralShapes = [];
    for (const s of shapeDeduped) {
      const coverage = (s.width * s.height) / pageArea;
      if (coverage >= 0.95 && s.fill) {
        bgColor = s.fill;
      } else {
        structuralShapes.push(s);
      }
    }

    return { images: deduped, shapes: structuralShapes, bgColor };
  } catch {
    return { images: [], shapes: [], bgColor: null };
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
  const fontInfoCache = {};
  for (const key of new Set(textItems.map((t) => t.fontName))) {
    try {
      const fontObj = page.commonObjs.get(key);
      const rawName = fontObj?.name || key;
      fontNameCache[key] = rawName;

      // Detect Type3 fonts by their generated names (e.g. "g_d0_f1").
      // These are fonts where each glyph is a vector drawing program —
      // they duplicate text content and cause stray marks if rendered as shapes.
      const isType3 = /^g_d\d+_f\d+$/.test(rawName) || /^ ([A-Z]\d+)$/.test(rawName);
      fontInfoCache[key] = { name: rawName, isType3 };
    } catch {
      fontNameCache[key] = key;
      fontInfoCache[key] = { name: key, isType3: false };
    }
  }
  textItems.forEach((t) => {
    t.fontName = fontNameCache[t.fontName] || t.fontName;
    t.isType3 = fontInfoCache[t.fontName]?.isType3 || false;
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

  // Skip Type3 font items — they're glyph duplicates, not real text.
  const realItems = textItems.filter((t) => !t.isType3 && t.str.trim());

  const sizeCounts = new Map();
  for (const item of realItems) {
    const size = Math.round(item.fontSize);
    sizeCounts.set(size, (sizeCounts.get(size) || 0) + item.str.length);
  }

  if (sizeCounts.size === 0) return null;

  const maxSize = Math.max(...sizeCounts.keys());
  const headlineItem = realItems.find((t) => Math.round(t.fontSize) === maxSize && t.str.trim());

  const bodySizes = [...sizeCounts.entries()]
    .filter(([size]) => size < maxSize)
    .sort((a, b) => b[1] - a[1]);
  const bodySize = bodySizes[0]?.[0];
  const bodyItem = realItems.find((t) => Math.round(t.fontSize) === bodySize && t.str.trim());

  const headline = resolveFont(headlineItem?.fontName, 'headline');
  const body = resolveFont(bodyItem?.fontName, 'body');

  console.log('[font detection]', {
    headlineRaw: headlineItem?.fontName,
    headlineResult: headline,
    bodyRaw: bodyItem?.fontName,
    bodyResult: body,
    type3Count: textItems.filter((t) => t.isType3).length,
    realCount: realItems.length,
  });

  return { headline, body };
}

const HEADING_KEYWORDS =
  /^(why us|our process|process|pricing|investment|about us|our approach|what we offer|scope|timeline|deliverables|next steps|about|services)\b/i;
const SENDER_LABEL = /(prepared by|from)\s*:?\s*(.+)/i;
const RECIPIENT_LABEL = /(prepared for|to)\s*:?\s*(.+)/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}/;
const URL_RE = /https?:\/\/[^\s]+|www\.[^\s]+/i;

/**
 * Extract design-level metadata (accent color, logo, phone) from page 1's
 * shapes, images, and text items. Called once during import for the first page.
 */
export function extractDesignData(shapes, images, textItems, bgColor) {
  const result = { accentColor: null, logoDataUrl: null, phoneNumber: null };

  // --- Accent color: most frequent non-white, non-bg fill/stroke from shapes ---
  if (shapes?.length) {
    const colorCounts = new Map();
    const isBg = (c) => {
      if (!c) return true;
      if (bgColor && c.toLowerCase() === bgColor.toLowerCase()) return true;
      // Skip white, near-white, black, near-black
      const hex = c.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;
      if (brightness > 240 || brightness < 15) return true;
      // Skip very desaturated (grays)
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min < 15) return true;
      return false;
    };
    for (const s of shapes) {
      if (s.fill && !isBg(s.fill)) {
        colorCounts.set(s.fill, (colorCounts.get(s.fill) || 0) + s.width * s.height);
      }
      if (s.stroke && !isBg(s.stroke)) {
        colorCounts.set(s.stroke, (colorCounts.get(s.stroke) || 0) + (s.strokeWidth || 1) * Math.max(s.width, s.height));
      }
    }
    if (colorCounts.size > 0) {
      result.accentColor = [...colorCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
  }

  // --- Logo: smallest non-background image near the top of the page ---
  if (images?.length) {
    const candidates = images
      .filter((img) => img.dataUrl && !img.isBackground && img.width > 10 && img.height > 10)
      .sort((a, b) => (a.width * a.height) - (b.width * b.height));
    // Prefer images in the top third of the page
    const topCandidates = candidates.filter((img) => img.y < (images[0]?.srcHeight || 1000) * 0.35);
    const logo = topCandidates[0] || candidates[0];
    if (logo) result.logoDataUrl = logo.dataUrl;
  }

  // --- Phone number from text ---
  if (textItems?.length) {
    const allText = textItems.map((t) => t.str).join(' ');
    const phoneMatch = allText.match(PHONE_RE);
    if (phoneMatch && phoneMatch[0].replace(/\D/g, '').length >= 7) {
      result.phoneNumber = phoneMatch[0].trim();
    }
  }

  return result;
}

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
    if (item.isType3) continue;
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
  const titleLines = lines.filter((l) => tierOf(l.maxSize) === 'title');
  // Join adjacent title lines (e.g. "Motoka x LagRide, Drive-to-" + "Own Compliance")
  // into a single headline when they are vertically close.
  let detectedHeadline = '';
  if (titleLines.length) {
    const joined = [];
    let current = titleLines[0].str.trim();
    for (let i = 1; i < titleLines.length; i++) {
      const gap = Math.abs(titleLines[i].y - titleLines[i - 1].y);
      // Title lines are large; gap < 4× maxSize means same headline block
      if (gap < titleLines[i - 1].maxSize * 4) {
        current += ' ' + titleLines[i].str.trim();
      } else {
        joined.push(current);
        current = titleLines[i].str.trim();
      }
    }
    joined.push(current);
    detectedHeadline = joined[0] || '';
  }
  filled.detectedHeadline = detectedHeadline;
  if (filled.detectedHeadline) {
    filled.notes.push(`Detected headline: "${filled.detectedHeadline}" (used as a structural hint only, never copied verbatim).`);
  }
  const titleSet = new Set(titleLines);

  let senderName = '';
  let recipientCompany = '';
  let contactEmail = '';
  const introParagraphLines = [];
  let currentHeading = null;
  const headingBodies = new Map();

  for (const line of lines) {
    const text = line.str.trim();
    if (!text || titleSet.has(line)) continue;

    // Filter decorative / non-content lines that pollute the tone sample:
    // - single-char markers like "x" (close icon)
    // - kicker labels that sit directly above the headline (e.g. "A PARTNERSHIP PROPOSAL")
    // - footer lines that are just contact info
    if (text.length <= 2) continue;
    // Skip if line is >90% uppercase and <40 chars and sits flush above a title
    // (heuristic for kickers like "A PARTNERSHIP PROPOSAL")
    if (text.length < 40 && text === text.toUpperCase() && /PARTNERSHIP|PROPOSAL|CONFIDENTIAL/i.test(text)) continue;

    const senderMatch = text.match(SENDER_LABEL);
    if (senderMatch && !senderName) senderName = senderMatch[2].trim();

    const recipientMatch = text.match(RECIPIENT_LABEL);
    if (recipientMatch && !recipientCompany) recipientCompany = recipientMatch[2].trim();

    const emailMatch = text.match(EMAIL_RE);
    if (emailMatch && !contactEmail) contactEmail = emailMatch[0];

    // Don't treat sender/recipient/email/phone-only lines as body copy
    if (senderMatch || recipientMatch) continue;
    if (emailMatch) continue;
    if (PHONE_RE.test(text) && text.replace(/\D/g, '').length >= 7 && text.length < 80) {
      // Phone-like line that is mostly numbers/symbols — skip from intro
      const digits = text.replace(/\D/g, '');
      if (digits.length >= 10 && text.length < 50) continue;
    }
    // Skip footer-style lines containing the website + email concatenated without space
    if (/motoka\.ng/i.test(text) && /@/.test(text)) continue;

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
 *
 * Erases at the per-text-item level (exact bounding boxes from getTextContent)
 * rather than grouped blocks, so only text pixels are painted over — logos,
 * shapes, and graphics remain untouched.
 */
function eraseTextItems(canvas, textItems) {
  if (!textItems || textItems.length === 0) return;
  const ctx = canvas.getContext('2d');

  for (const item of textItems) {
    if (!item.str.trim()) continue;
    const cx = Math.max(0, Math.floor(item.canvasX));
    const cy = Math.max(0, Math.floor(item.canvasY));
    const cw = Math.max(1, Math.ceil(item.canvasWidth));
    const ch = Math.max(1, Math.ceil(item.canvasHeight));
    if (cx >= canvas.width || cy >= canvas.height) continue;

    const { bg } = sampleBlockColors(canvas, cx, cy, cw, ch);
    ctx.fillStyle = bg;
    ctx.fillRect(cx, cy, cw, ch);
  }
}

/**
 * Paint over background images on the canvas using the local background color
 * sampled from the image's edge pixels. The image will be re-rendered as a
 * positioned div with reduced opacity in the live preview.
 */
function eraseBackgroundImages(canvas, bgImages) {
  if (!bgImages || bgImages.length === 0) return;
  const ctx = canvas.getContext('2d');

  for (const img of bgImages) {
    const cx = Math.max(0, Math.floor(img.x));
    const cy = Math.max(0, Math.floor(img.y));
    const cw = Math.max(1, Math.ceil(img.width));
    const ch = Math.max(1, Math.ceil(img.height));
    if (cx >= canvas.width || cy >= canvas.height) continue;

    const { bg } = sampleBlockColors(canvas, cx, cy, cw, ch);
    ctx.fillStyle = bg;
    ctx.fillRect(cx, cy, cw, ch);
  }
}

/**
 * Sample the most-common color in the top-left 20x20 pixel region.
 * This is reliably the page background in virtually all PDFs.
 */
function samplePageBackground(canvas) {
  const size = 20;
  const ctx = canvas.getContext('2d');
  const w = Math.min(size, canvas.width);
  const h = Math.min(size, canvas.height);
  if (w <= 0 || h <= 0) return '#ffffff';
  const { data } = ctx.getImageData(0, 0, w, h);
  const counts = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
    counts.set(key, (counts.get(key) || 0) + 1);
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

  // Pass 1: group items into lines by Y tolerance
  const lineGroups = [];
  let current = null;
  for (const item of sorted) {
    if (!item.str.trim()) continue;
    if (item.isType3) continue;
    if (item.canvasWidth < item.fontSize * 0.2) continue;
    if (/^[\u2000-\u2FFF\uFE00-\uFEFF\u2E80-\u9FFF]+$/.test(item.str.trim())) continue;
    if (/fontawesome|material.?icons|glyph|icon|symbol|dingbats|emoji/i.test(item.fontName || '')) continue;
    if (item.fontSize < 6) continue;
    const yTol = Math.max(3, (item.fontSize || 12) * 0.45);
    if (current && Math.abs(current.yAnchor - item.canvasY) <= yTol) {
      current.items.push(item);
      current.yAnchor = Math.min(current.yAnchor, item.canvasY);
      current.maxSize = Math.max(current.maxSize, item.fontSize);
    } else {
      current = {
        items: [item],
        yAnchor: item.canvasY,
        maxSize: item.fontSize,
      };
      lineGroups.push(current);
    }
  }

  // Pass 2: within each line, sort by X and split into sub-lines when
  // horizontal gaps are large (e.g. footer items spread across the page).
  const lines = [];
  for (const g of lineGroups) {
    const splitThreshold = (g.maxSize || 12) * 3;
    g.items.sort((a, b) => a.canvasX - b.canvasX);
    let str = '';
    let lastRight = -Infinity;
    let subLeft = Infinity;
    let subRight = -Infinity;
    let subTop = Infinity;
    let subBottom = -Infinity;
    let subMax = 0;

    const flush = () => {
      if (!str.trim()) return;
      lines.push({
        str,
        left: subLeft,
        right: subRight,
        top: subTop,
        bottom: subBottom,
        maxSize: subMax,
      });
    };

    for (const item of g.items) {
      const gap = item.canvasX - lastRight;
      if (lastRight > -Infinity && gap > splitThreshold) {
        flush();
        str = '';
        subLeft = Infinity;
        subRight = -Infinity;
        subTop = Infinity;
        subBottom = -Infinity;
        subMax = 0;
      }
      const spaceThreshold = g.maxSize * 0.3;
      if (lastRight > -Infinity && gap > spaceThreshold) {
        str += ' ' + item.str;
      } else {
        str += item.str;
      }
      lastRight = item.canvasX + item.canvasWidth;
      subLeft = Math.min(subLeft, item.canvasX);
      subRight = Math.max(subRight, item.canvasX + item.canvasWidth);
      subTop = Math.min(subTop, item.canvasY);
      subBottom = Math.max(subBottom, item.canvasY + item.canvasHeight);
      subMax = Math.max(subMax, item.fontSize);
    }
    flush();
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
      const pad = l.maxSize * 0.05;
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
      const topPct = canvas.height > 0 ? (y / canvas.height * 100).toFixed(1) : '?';
      if (y / canvas.height > 0.85 || i < 3) {
        console.log(`[block ${i}] top=${topPct}% h=${canvas.height}px text="${l.str.slice(0,40)}"`);
      }
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
