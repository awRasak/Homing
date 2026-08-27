import { db } from '../db.js';

// Shared by /api/buffer/generate (social) and /api/becca/pipeline/image (blog
// cover) so a tweet and a blog cover generated on the same day pull from the
// same brand identity instead of drifting apart visually. There's no saved
// canvas template to composite yet (the Design tool's fabric canvas is never
// persisted to the designs table) — this styles the Pollinations prompt with
// the design's accent color and sender name instead of true logo/layout
// compositing.
export async function generateBrandImage({ headline, topic, designId, style, width = 1080, height = 1080 }) {
  let accentColor = null;
  let senderName = '';
  if (designId) {
    const d = db.prepare('SELECT accent_color, sender_name FROM designs WHERE id = ?').get(designId);
    if (d) {
      accentColor = d.accent_color || null;
      senderName = d.sender_name || '';
    }
  }

  const subject = headline || topic || 'brand announcement';
  const promptParts = [
    `Professional social media graphic for "${subject}"`,
    senderName ? `branded for ${senderName}` : '',
    accentColor ? `dominant accent color ${accentColor}` : '',
    style || 'modern minimalist design, clean composition, bold negative space for text overlay',
    'no readable text, no watermark, high quality',
  ].filter(Boolean);
  const prompt = promptParts.join(', ');

  const encoded = encodeURIComponent(prompt);
  // Pollinations rejects seeds above the 32-bit signed int max.
  const seed = Math.floor(Math.random() * 2147483647);
  const url = `https://image.pollinations.ai/prompt/${encoded}?model=flux&width=${width}&height=${height}&nologo=true&seed=${seed}`;

  // GET, not HEAD — pollinations.ai returns 200 on HEAD even when the actual
  // generation subsequently fails.
  const imgRes = await fetch(url, { redirect: 'follow' });
  const contentType = imgRes.headers.get('content-type') || '';
  if (!imgRes.ok || !contentType.startsWith('image/')) {
    const body = await imgRes.text().catch(() => '');
    throw new Error(`Image generation failed (${imgRes.status}): ${body.slice(0, 200)}`);
  }

  return { url: imgRes.url || url, prompt };
}
