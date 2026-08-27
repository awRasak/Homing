import * as fabric from 'fabric';
import { api, BASE } from '../api';

// Loads a saved canvas (from DesignEditor's canvas_json) into an off-screen
// StaticCanvas, swaps the objects tagged _role:'headline' / _role:'logo'
// and exports a PNG data URL. Pure rendering — no network calls.
//
// Accepts either renderTemplateImage(json, "headline") for back-compat or
// renderTemplateImage(json, { headlineText, logoDataUrl }).
export async function renderTemplateImage(canvasJson, headlineOrOpts, logoDataUrl) {
  let headlineText = null;
  let logoUrl = null;
  if (typeof headlineOrOpts === 'string') {
    headlineText = headlineOrOpts;
    logoUrl = logoDataUrl || null;
  } else if (headlineOrOpts && typeof headlineOrOpts === 'object') {
    headlineText = headlineOrOpts.headlineText ?? null;
    logoUrl = headlineOrOpts.logoDataUrl ?? null;
  }

  if (!canvasJson) return null;
  const width = canvasJson.width || 1080;
  const height = canvasJson.height || 1080;
  const canvas = new fabric.StaticCanvas(null, { width, height });
  try {
    await canvas.loadFromJSON(canvasJson);
    if (headlineText) {
      const headlineObj = canvas.getObjects().find((o) => o._role === 'headline');
      if (headlineObj && typeof headlineObj.set === 'function') {
        headlineObj.set('text', headlineText);
      }
    }
    if (logoUrl) {
      const logoObj = canvas.getObjects().find((o) => o._role === 'logo' && o.type === 'image');
      if (logoObj) {
        try {
          const newImg = await fabric.FabricImage.fromURL(logoUrl, { crossOrigin: 'anonymous' });
          const origW = (logoObj.width || 100) * (logoObj.scaleX || 1);
          const origH = (logoObj.height || 100) * (logoObj.scaleY || 1);
          const scale = Math.min(origW / (newImg.width || 1), origH / (newImg.height || 1));
          const idx = canvas.getObjects().indexOf(logoObj);
          newImg.set({
            left: logoObj.left,
            top: logoObj.top,
            scaleX: scale,
            scaleY: scale,
            angle: logoObj.angle || 0,
            originX: logoObj.originX || 'left',
            originY: logoObj.originY || 'top',
            _id: logoObj._id,
            _role: logoObj._role,
            name: logoObj.name || 'Logo',
          });
          canvas.remove(logoObj);
          canvas.insertAt(idx, newImg);
        } catch (e) {
          console.warn('[renderTemplate] logo swap failed:', e.message);
        }
      }
    }
    canvas.renderAll();
    return canvas.toDataURL({ format: 'png', multiplier: 2 });
  } finally {
    canvas.dispose();
  }
}

// High-level helper for the social generation flows: if the workspace has a
// social template configured, render it with the given headline (and optional
// logo) and upload the result to get a stable, publicly-fetchable URL.
// Returns null (never throws) when there's no template or anything about it
// fails, so callers can fall back to the existing prompt-styled image path.
export async function composeSocialImage({ headline, logoDataUrl }) {
  try {
    const { designId } = await api.becca.getSocialTemplate();
    if (!designId) return null;
    const design = await api.getDesign(designId);
    if (!design?.canvasJson) return null;
    const dataUrl = await renderTemplateImage(design.canvasJson, { headlineText: headline, logoDataUrl: logoDataUrl || design.logoDataUrl || null });
    if (!dataUrl) return null;
    const { id } = await api.socialAssets.upload(dataUrl);
    // Buffer's servers fetch this URL directly — it must be a fully-qualified
    // public URL, not a path relative to this dev/browser origin.
    const apiOrigin = /^https?:\/\//.test(BASE) ? new URL(BASE).origin : window.location.origin;
    return `${apiOrigin}/api/social-assets/${id}.png`;
  } catch (err) {
    console.error('[renderTemplate] template compose failed, falling back:', err.message);
    return null;
  }
}
