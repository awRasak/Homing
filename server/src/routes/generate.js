import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';
import { generateProposal, getActiveProvider } from '../ai/providers.js';

const router = Router();

// POST /api/designs/:id/generate
router.post('/:id/generate', async (req, res) => {
  const design = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const companyName = (req.body?.companyName || '').trim();
  if (!companyName) return res.status(400).json({ error: 'companyName is required' });
  const notes = req.body?.notes || '';
  const provider = req.body?.provider || undefined;
  const model = req.body?.model || undefined;

  let copy;
  try {
    copy = await generateProposal({ design, companyName, notes, provider, model });
  } catch (err) {
    console.error('AI generation failed:', err);
    return res.status(502).json({ error: 'AI generation failed: ' + err.message });
  }

  const ts = nowIso();
  const existing = db
    .prepare('SELECT id FROM proposals WHERE design_id = ? AND company_name = ?')
    .get(design.id, companyName);

  let proposalId;
  if (existing) {
    proposalId = existing.id;
    db.prepare(
      `UPDATE proposals SET notes = ?, headline = ?, opening = ?, body_paragraphs = ?, closing = ?, updated_at = ? WHERE id = ?`
    ).run(notes, copy.headline, copy.opening, JSON.stringify(copy.bodyParagraphs), copy.closing, ts, proposalId);
  } else {
    proposalId = newId();
    db.prepare(
      `INSERT INTO proposals (id, design_id, company_name, notes, headline, opening, body_paragraphs, closing, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(proposalId, design.id, companyName, notes, copy.headline, copy.opening, JSON.stringify(copy.bodyParagraphs), copy.closing, ts, ts);
  }

  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(proposalId);
  res.json({
    ...row,
    designId: row.design_id,
    companyName: row.company_name,
    bodyParagraphs: JSON.parse(row.body_paragraphs || '[]'),
    companyLogo: row.company_logo || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
});

export default router;
