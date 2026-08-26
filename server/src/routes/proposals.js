import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isPyMuPDFAvailable } from '../pdfTool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);

const router = Router();

function serializeProposalRow(row) {
  return {
    ...row,
    designId: row.design_id,
    companyName: row.company_name,
    bodyParagraphs: JSON.parse(row.body_paragraphs || '[]'),
    companyLogo: row.company_logo || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// POST /api/proposals/upsert — create or update the proposal for (designId, companyName)
router.post('/upsert', (req, res) => {
  const { designId, companyName, companyLogo, headline, opening, bodyParagraphs, closing, notes } = req.body || {};
  if (!designId || !String(companyName || '').trim()) {
    return res.status(400).json({ error: 'designId and companyName are required' });
  }
  const design = db.prepare('SELECT id FROM designs WHERE id = ?').get(designId);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const name = String(companyName).trim();
  const ts = nowIso();
  const existing = db.prepare('SELECT * FROM proposals WHERE design_id = ? AND company_name = ?').get(designId, name);
  let id;
  if (existing) {
    id = existing.id;
    db.prepare('UPDATE proposals SET company_logo = COALESCE(?, company_logo), updated_at = ? WHERE id = ?')
      .run(companyLogo ?? null, ts, id);
  } else {
    id = newId();
    db.prepare(
      `INSERT INTO proposals (id, design_id, company_name, notes, headline, opening, body_paragraphs, closing, company_logo, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, designId, name, notes || '', headline || '', opening || '',
      JSON.stringify(bodyParagraphs || []), closing || '', companyLogo || null, ts, ts);
  }
  res.json(serializeProposalRow(db.prepare('SELECT * FROM proposals WHERE id = ?').get(id)));
});

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
    // PyMuPDF missing → skip straight to the fallback with a clear reason
    if (isPyMuPDFAvailable() === false) {
      console.error('Structural PDF export unavailable: PyMuPDF not installed (pip install pymupdf). Falling back to Puppeteer.');
    } else {
    try {
      const overrides = {};
      const pageOverrides = JSON.parse(design.page_overrides || '{}');
      const textOverrides = JSON.parse(design.text_overrides || '{}');
      const pages = JSON.parse(design.pages || '[]');
      const logoSlots = JSON.parse(design.logo_slots || '[]');

      // Per-block bg/fg sampled at import time — so redaction fills match
      // dark panels etc. Keyed by "pageNum:blockId".
      const blockMeta = new Map();
      for (const p of pages) {
        for (const b of p.blocks || []) {
          blockMeta.set(`${p.pageNum || 1}:${b.id}`, { bg: b.bg, fg: b.fg });
        }
      }
      const enrich = (pageNum, blockId, text) => {
        const meta = blockMeta.get(`${pageNum}:${blockId}`);
        return meta ? { text, bg: meta.bg, fg: meta.fg } : text;
      };

      // Merge page overrides + text overrides into a per-page map, enriching
      // every entry with the block's stored colors.
      if (Object.keys(pageOverrides).length > 0) {
        for (const [pageKey, pageOvr] of Object.entries(pageOverrides)) {
          const pageNum = parseInt(pageKey, 10) || 1;
          const out = {};
          for (const [blockId, text] of Object.entries(pageOvr)) {
            out[blockId] = enrich(pageNum, blockId, text);
          }
          overrides[`page${pageKey}`] = out;
        }
      } else if (Object.keys(textOverrides).length > 0) {
        const out = {};
        for (const [blockId, text] of Object.entries(textOverrides)) {
          out[blockId] = enrich(1, blockId, text);
        }
        overrides.page1 = out;
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

      // Logo/cover slot replacement: canvas px → PDF points (render scale 1.75).
      // kind 'logo' gets the recipient logo, kind 'cover' the design's cover image.
      const RENDER_SCALE = 1.75;
      const writeTempImage = (dataUrl, name) => {
        const p = path.join(tmpDir, name);
        fs.writeFileSync(p, Buffer.from(String(dataUrl).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        return p;
      };
      const logoImgPath = proposal.company_logo
        ? writeTempImage(proposal.company_logo, `logo_${proposal.id}.png`)
        : null;
      const coverImgPath = design.hero_image_data_url
        ? writeTempImage(design.hero_image_data_url, `cover_${proposal.id}.png`)
        : null;

      const slotArgs = [];
      for (const slot of logoSlots) {
        const imgPath = slot.kind === 'cover' ? coverImgPath : logoImgPath;
        if (!imgPath) continue;
        const scale = 1 / RENDER_SCALE;
        slotArgs.push('--logo-slot', `${slot.pageNum},${(slot.x * scale).toFixed(2)},${(slot.y * scale).toFixed(2)},${(slot.width * scale).toFixed(2)},${(slot.height * scale).toFixed(2)},${slot.kind === 'cover' ? 'cover' : 'logo'}`);
        slotArgs.push('--logo-image', imgPath);
      }
      scriptArgs.push(...slotArgs);

      // Fallback: no tagged slots → legacy largest-image-on-page-1 swap
      if (slotArgs.length === 0 && proposal.company_logo) {
        scriptArgs.push('--logo', logoImgPath);
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
    } // end PyMuPDF-available else
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
