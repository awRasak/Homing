import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();

// Mounted without requireAuth at the app level (Buffer's own servers must be
// able to GET the image directly, with no JWT) — so the write path checks
// auth itself while the read path stays open.

// POST /api/social-assets  { dataUrl: "data:image/png;base64,..." } → { id, url }
router.post('/', requireAuth, (req, res) => {
  const { dataUrl } = req.body;
  if (!dataUrl || !dataUrl.startsWith('data:image/')) {
    return res.status(400).json({ error: 'dataUrl (a data:image/... URI) is required' });
  }
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const id = newId();
  db.prepare('INSERT INTO social_assets (id, data_base64, created_at) VALUES (?, ?, ?)')
    .run(id, base64, nowIso());
  res.status(201).json({ id });
});

// GET /api/social-assets/:idPng — serve back as a real PNG, unauthenticated
// (Buffer's servers need to fetch this URL directly, without our JWT).
router.get('/:idPng', (req, res) => {
  const id = req.params.idPng.replace(/\.png$/i, '');
  const row = db.prepare('SELECT data_base64 FROM social_assets WHERE id = ?').get(id);
  if (!row) return res.status(404).end();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(row.data_base64, 'base64'));
});

export default router;
