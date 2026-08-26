import * as fabric from 'fabric';
import { ensureGoogleFontLoaded } from './googleFonts';

// "Image to layers": turn an extracted proposal page (rendered image + text
// blocks + embedded images + shapes) into editable fabric objects.
//
// Stack order: locked page render at the back → shapes → images → text.
// Each text block sits on a mask rect painted with the block's sampled
// background color, hiding the baked-in text behind the editable copy.

async function loadImage(dataUrl) {
  return fabric.FabricImage.fromURL(dataUrl, { crossOrigin: 'anonymous' });
}

export async function buildLayersFromPage(page, { targetW, headlineFont, bodyFont, genId }) {
  const pageW = page.width || targetW;
  const scale = targetW / pageW;
  const objects = [];

  // 1. Page render — the fidelity floor, locked.
  const bg = await loadImage(page.dataUrl);
  bg.set({
    left: 0,
    top: 0,
    scaleX: scale,
    scaleY: scale,
    selectable: false,
    evented: false,
    _id: genId(),
    name: 'Page background',
  });
  objects.push(bg);

  // 2. Vector shapes captured at import.
  for (const s of page.shapes || []) {
    if (s.width < 4 || s.height < 4) continue;
    objects.push(new fabric.Rect({
      left: (s.x || 0) * scale,
      top: (s.y || 0) * scale,
      width: s.width * scale,
      height: s.height * scale,
      fill: s.fill || s.color || 'rgba(0,0,0,0)',
      selectable: false,
      evented: false,
      _id: genId(),
      name: 'Shape',
    }));
  }

  // 3. Embedded images (logos, photos) — same pixels as the background, so
  // they cover seamlessly but are now movable/replaceable.
  for (const img of page.images || []) {
    if (!img.dataUrl || img.width < 8 || img.height < 8) continue;
    try {
      const fimg = await loadImage(img.dataUrl);
      fimg.set({
        left: (img.x || 0) * scale,
        top: (img.y || 0) * scale,
        scaleX: (img.width * scale) / Math.max(fimg.width, 1),
        scaleY: (img.height * scale) / Math.max(fimg.height, 1),
        _id: genId(),
        name: 'Image',
      });
      objects.push(fimg);
    } catch { /* skip broken crop */ }
  }

  // 4. Text blocks: mask rect (hides baked text) + editable Textbox.
  for (const b of page.blocks || []) {
    if (!b.text?.trim()) continue;
    const left = (b.x || 0) * scale;
    const top = (b.y || 0) * scale;
    const width = (b.width || 100) * scale;
    const height = (b.height || 20) * scale;
    if (width < 4 || height < 4) continue;

    objects.push(new fabric.Rect({
      left,
      top,
      width,
      height,
      fill: b.bg || '#ffffff',
      selectable: false,
      evented: false,
      _id: genId(),
      name: `Mask · ${b.text.slice(0, 18)}`,
    }));

    const isHeadline = b.tier === 'title' || b.tier === 'heading';
    ensureGoogleFontLoaded(isHeadline ? headlineFont : bodyFont);
    const fontSize = Math.max(6, Math.round(height * 0.78));
    const textbox = new fabric.Textbox(b.text, {
      left,
      top: top - height * 0.08,
      width: width * 1.04,
      fontSize,
      lineHeight: 1.05,
      fontFamily: `"${isHeadline ? headlineFont : bodyFont || headlineFont}", sans-serif`,
      fontWeight: isHeadline ? 700 : 400,
      fill: b.fg || '#000000',
      textAlign: 'left',
      splitByGrapheme: false,
      _id: genId(),
      name: `Text · ${b.text.slice(0, 18)}`,
    });
    objects.push(textbox);
  }

  return objects;
}

export function pickPresetForPage(page) {
  const ratio = (page.width || 1) / (page.height || 1);
  return ratio > 1.05 ? 'a4-landscape' : 'a4-portrait';
}
