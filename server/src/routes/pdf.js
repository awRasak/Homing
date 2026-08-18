import { Router } from 'express';
import { db } from '../db.js';
import { generatePDF } from '../pdf.js';

const router = Router();

// GET /api/proposals/:id/pdf
router.get('/:id/pdf', async (req, res) => {
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

  const design = db.prepare('SELECT * FROM designs WHERE id = ?').get(proposal.design_id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  try {
    const pdf = await generatePDF(design, {
      headline: proposal.headline,
      opening: proposal.opening,
      body_paragraphs: proposal.body_paragraphs,
      closing: proposal.closing,
    });

    const filename = `${(proposal.company_name || 'proposal').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
});

export default router;
