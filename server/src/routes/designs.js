import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PDF_DIR = path.join(__dirname, '..', '..', 'data', 'pdfs');
fs.mkdirSync(PDF_DIR, { recursive: true });

const router = Router();

function serializeDesign(row) {
  if (!row) return null;
  return {
    ...row,
    staticSections: JSON.parse(row.static_sections || '[]'),
    senderName: row.sender_name,
    accentColor: row.accent_color,
    backgroundColor: row.background_color || '#ffffff',
    brandColors: JSON.parse(row.brand_colors || '[]'),
    logoSlots: JSON.parse(row.logo_slots || '[]'),
    logoDataUrl: row.logo_data_url,
    logoVariations: JSON.parse(row.logo_variations || '[]'),
    heroImageDataUrl: row.hero_image_data_url,
    headlineFont: row.headline_font,
    bodyFont: row.body_font,
    styleSample: row.style_sample,
    detectedHeadline: row.detected_headline,
    fontDetectionNote: row.font_detection_note,
    extractionNote: row.extraction_note,
    sourceImageDataUrl: row.source_image_data_url,
    sourceImageWidth: row.source_image_width,
    sourceImageHeight: row.source_image_height,
    sourceTextBlocks: JSON.parse(row.source_text_blocks || '[]'),
    textOverrides: JSON.parse(row.text_overrides || '{}'),
    pages: JSON.parse(row.pages || '[]'),
    pageOverrides: JSON.parse(row.page_overrides || '{}'),
    canvasJson: row.canvas_json ? JSON.parse(row.canvas_json) : null,
    sourcePdfPath: row.source_pdf_path || null,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const EDITABLE_FIELDS = {
  name: 'name',
  senderName: 'sender_name',
  tagline: 'tagline',
  accentColor: 'accent_color',
  backgroundColor: 'background_color',
  logoDataUrl: 'logo_data_url',
  heroImageDataUrl: 'hero_image_data_url',
  headlineFont: 'headline_font',
  bodyFont: 'body_font',
  styleSample: 'style_sample',
  detectedHeadline: 'detected_headline',
  fontDetectionNote: 'font_detection_note',
  extractionNote: 'extraction_note',
  sourceImageDataUrl: 'source_image_data_url',
  sourceImageWidth: 'source_image_width',
  sourceImageHeight: 'source_image_height',
};

// GET /api/designs
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM designs ORDER BY sort_order ASC, created_at ASC').all();
  res.json(rows.map(serializeDesign));
});

// POST /api/designs/:id/source-pdf  (upload raw PDF for structural export)
router.post('/:id/source-pdf', (req, res) => {
  const existing = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Design not found' });

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (buf.length === 0) return res.status(400).json({ error: 'No PDF data' });
    const filename = `${req.params.id}.pdf`;
    const filePath = path.join(PDF_DIR, filename);
    fs.writeFileSync(filePath, buf);
    db.prepare('UPDATE designs SET source_pdf_path = ?, updated_at = ? WHERE id = ?')
      .run(filePath, nowIso(), req.params.id);
    res.json({ ok: true, path: filePath });
  });
  req.on('error', (err) => res.status(500).json({ error: err.message }));
});

// GET /api/designs/:id/source-pdf  (download raw PDF)
router.get('/:id/source-pdf', (req, res) => {
  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Design not found' });
  if (!row.source_pdf_path || !fs.existsSync(row.source_pdf_path)) {
    return res.status(404).json({ error: 'No source PDF stored' });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(row.source_pdf_path);
});

// POST /api/designs  (create new blank design)
router.post('/', (req, res) => {
  const id = newId();
  const ts = nowIso();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM designs').get().m;
  const name = (req.body && req.body.name) || 'Untitled design';
  db.prepare(
    `INSERT INTO designs (id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(id, name, maxOrder + 1, ts, ts);
  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(id);
  res.status(201).json(serializeDesign(row));
});

// GET /api/designs/:id
router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Design not found' });
  res.json(serializeDesign(row));
});

// PUT /api/designs/:id  (partial update; auto-save from client)
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Design not found' });

  const sets = [];
  const values = [];
  for (const [clientKey, column] of Object.entries(EDITABLE_FIELDS)) {
    if (Object.prototype.hasOwnProperty.call(req.body, clientKey)) {
      sets.push(`${column} = ?`);
      values.push(req.body[clientKey]);
    }
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'staticSections')) {
    sets.push('static_sections = ?');
    values.push(JSON.stringify(req.body.staticSections || []));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'sourceTextBlocks')) {
    sets.push('source_text_blocks = ?');
    values.push(JSON.stringify(req.body.sourceTextBlocks || []));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'textOverrides')) {
    sets.push('text_overrides = ?');
    values.push(JSON.stringify(req.body.textOverrides || {}));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'pages')) {
    sets.push('pages = ?');
    values.push(JSON.stringify(req.body.pages || []));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'pageOverrides')) {
    sets.push('page_overrides = ?');
    values.push(JSON.stringify(req.body.pageOverrides || {}));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'brandColors')) {
    sets.push('brand_colors = ?');
    values.push(JSON.stringify(req.body.brandColors || []));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'logoVariations')) {
    sets.push('logo_variations = ?');
    values.push(JSON.stringify(req.body.logoVariations || []));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'logoSlots')) {
    sets.push('logo_slots = ?');
    values.push(JSON.stringify(req.body.logoSlots || []));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'canvasJson')) {
    sets.push('canvas_json = ?');
    values.push(req.body.canvasJson ? JSON.stringify(req.body.canvasJson) : null);
  }
  sets.push('updated_at = ?');
  values.push(nowIso());
  values.push(req.params.id);

  db.prepare(`UPDATE designs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  res.json(serializeDesign(row));
});

// DELETE /api/designs/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Design not found' });
  db.prepare('DELETE FROM designs WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// GET /api/designs/:id/proposals
router.get('/:id/proposals', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM proposals WHERE design_id = ? ORDER BY updated_at DESC')
    .all(req.params.id);
  res.json(
    rows.map((r) => ({
      ...r,
      designId: r.design_id,
      companyName: r.company_name,
      bodyParagraphs: JSON.parse(r.body_paragraphs || '[]'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );
});

// GET /api/designs/:id/proposals/:pid
router.get('/:id/proposals/:pid', (req, res) => {
  const row = db
    .prepare('SELECT * FROM proposals WHERE design_id = ? AND id = ?')
    .get(req.params.id, req.params.pid);
  if (!row) return res.status(404).json({ error: 'Proposal not found' });
  res.json({
    ...row,
    designId: row.design_id,
    companyName: row.company_name,
    bodyParagraphs: JSON.parse(row.body_paragraphs || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

export default router;
