import { Router } from 'express';
import { db, nowIso } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const router = Router();

// PUT /api/proposals/:id — update proposal (e.g. company_logo)
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Proposal not found' });
  if (Object.prototype.hasOwnProperty.call(req.body, 'companyLogo')) {
    db.prepare('UPDATE proposals SET company_logo = ?, updated_at = ? WHERE id = ?')
      .run(req.body.companyLogo || null, nowIso(), req.params.id);
  }
  const row = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
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

// GET /api/proposals/stats — aggregated metrics for the dashboard
router.get('/stats', (req, res) => {
  const totalProposals = db.prepare('SELECT COUNT(*) AS n FROM proposals').get().n;
  const totalRecipients = db.prepare('SELECT COUNT(*) AS n FROM recipients').get().n;
  const totalCampaigns = db.prepare('SELECT COUNT(*) AS n FROM campaigns').get().n;

  const campaignStats = db.prepare(`
    SELECT
      COALESCE(SUM(sent_count), 0) AS totalSent,
      COALESCE(SUM(failed_count), 0) AS totalFailed
    FROM campaigns
  `).get();

  const engagementStats = db.prepare(`
    SELECT
      COUNT(*) AS totalRecipients,
      COUNT(opened_at) AS totalOpened,
      COUNT(clicked_at) AS totalClicked
    FROM campaign_recipients
    WHERE status = 'sent'
  `).get();

  const openRate = engagementStats.totalRecipients > 0
    ? Math.round((engagementStats.totalOpened / engagementStats.totalRecipients) * 100)
    : 0;
  const clickRate = engagementStats.totalRecipients > 0
    ? Math.round((engagementStats.totalClicked / engagementStats.totalRecipients) * 100)
    : 0;

  res.json({
    totalProposals,
    totalRecipients,
    totalCampaigns,
    totalSent: campaignStats.totalSent,
    totalFailed: campaignStats.totalFailed,
    totalOpened: engagementStats.totalOpened,
    totalClicked: engagementStats.totalClicked,
    openRate,
    clickRate,
  });
});

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
      companyLogo: r.company_logo || null,
    }))
  );
});

// GET /api/proposals/:id/pdf — export proposal PDF
router.get('/:id/pdf', async (req, res) => {
  const proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(req.params.id);
  if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

  const design = db.prepare('SELECT * FROM designs WHERE id = ?').get(proposal.design_id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const filename = `${(proposal.company_name || 'proposal').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  // Structural path: if we have the original PDF, modify it in-place
  if (design.source_pdf_path && fs.existsSync(design.source_pdf_path)) {
    try {
      const overrides = {};
      const pageOverrides = JSON.parse(design.page_overrides || '{}');
      const textOverrides = JSON.parse(design.text_overrides || '{}');
      const pages = JSON.parse(design.pages || '[]');

      // Merge page overrides + text overrides into a flat block-id map
      if (Object.keys(pageOverrides).length > 0) {
        for (const [pageKey, pageOvr] of Object.entries(pageOverrides)) {
          overrides[`page${pageKey}`] = pageOvr;
        }
      } else if (Object.keys(textOverrides).length > 0) {
        overrides.page1 = textOverrides;
      }

      // If no overrides but we have a proposal, build overrides from the proposal content
      if (Object.keys(overrides).length === 0 && pages.length > 0) {
        const page1Blocks = pages[0]?.blocks || [];
        const titleBlock = page1Blocks.find((b) => b.tier === 'title');
        const bodyBlocks = page1Blocks.filter((b) => b.tier === 'body').sort((a, b) => a.y - b.y);

        if (titleBlock && proposal.headline) {
          overrides.page1 = overrides.page1 || {};
          overrides.page1[titleBlock.id] = proposal.headline;
        }

        // Map opening/bodyParagraphs/closing to body blocks
        const contentPieces = [];
        if (proposal.opening) contentPieces.push(proposal.opening);
        const bodyParagraphs = JSON.parse(proposal.body_paragraphs || '[]');
        if (bodyParagraphs.length) contentPieces.push(...bodyParagraphs);
        if (proposal.closing) contentPieces.push(proposal.closing);

        if (bodyBlocks.length > 0 && contentPieces.length > 0) {
          const avgHeight = bodyBlocks.reduce((s, b) => s + (b.height || 0), 0) / bodyBlocks.length;
          const gapThreshold = avgHeight * 2.5 || 30;
          const zones = [];
          for (const b of bodyBlocks) {
            const lastZone = zones[zones.length - 1];
            if (lastZone && (b.y - lastZone[lastZone.length - 1].y - (lastZone[lastZone.length - 1].height || 0)) <= gapThreshold) {
              lastZone.push(b);
            } else {
              zones.push([b]);
            }
          }
          for (let i = 0; i < zones.length; i++) {
            const text = i < contentPieces.length ? contentPieces[i] : '';
            overrides.page1 = overrides.page1 || {};
            zones[i].forEach((block, j) => {
              overrides.page1[block.id] = j === 0 ? text : '';
            });
          }
        }
      }

      // Write overrides to temp file, call Python script
      const tmpDir = path.join(__dirname, '..', '..', 'data');
      const overridesPath = path.join(tmpDir, `overrides_${proposal.id}.json`);
      const outputPath = path.join(tmpDir, `export_${proposal.id}.pdf`);
      fs.writeFileSync(overridesPath, JSON.stringify(overrides));

      const scriptPath = path.join(__dirname, '..', 'pdf_edit.py');
      const scriptArgs = [
        '--input', design.source_pdf_path,
        '--output', outputPath,
        '--overrides', overridesPath,
      ];

      // Handle company logo replacement
      if (proposal.company_logo) {
        const logoPath = path.join(tmpDir, `logo_${proposal.id}.png`);
        const logoData = proposal.company_logo.replace(/^data:image\/\w+;base64,/, '');
        fs.writeFileSync(logoPath, Buffer.from(logoData, 'base64'));
        scriptArgs.push('--logo', logoPath);
        // Logo rect will be auto-detected by the Python script (find largest image on page 1)
      }

      await execFileAsync('python3', [scriptPath, ...scriptArgs], { timeout: 30000 });

      // Clean up temp files
      const pdfBuffer = fs.readFileSync(outputPath);
      fs.unlinkSync(overridesPath);
      fs.unlinkSync(outputPath);
      return res.send(pdfBuffer);
    } catch (err) {
      console.error('Structural PDF export failed, falling back to Puppeteer:', err.message);
    }
  }

  // Fallback: Puppeteer path
  try {
    const { generatePDF } = await import('../pdf.js');
    const pdf = await generatePDF(design, {
      headline: proposal.headline,
      opening: proposal.opening,
      body_paragraphs: proposal.body_paragraphs,
      closing: proposal.closing,
    });
    res.send(pdf);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  }
});

export default router;
