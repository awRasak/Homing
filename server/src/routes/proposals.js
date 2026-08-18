import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

// GET /api/proposals — all proposals across every design, newest first
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.*, d.name AS design_name, d.accent_color AS design_accent_color,
              d.headline_font AS design_headline_font, d.sender_name AS design_sender_name
       FROM proposals p
       JOIN designs d ON d.id = p.design_id
       ORDER BY p.updated_at DESC`
    )
    .all();

  res.json(
    rows.map((r) => ({
      id: r.id,
      designId: r.design_id,
      companyName: r.company_name,
      notes: r.notes,
      headline: r.headline,
      opening: r.opening,
      bodyParagraphs: JSON.parse(r.body_paragraphs || '[]'),
      closing: r.closing,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      designName: r.design_name,
      designAccentColor: r.design_accent_color,
      designHeadlineFont: r.design_headline_font,
      designSenderName: r.design_sender_name,
    }))
  );
});

export default router;
