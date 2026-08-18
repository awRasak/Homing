import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';
import { sendEmail, resolveTemplate, buildEmailHTML } from '../email.js';
import { generatePDF } from '../pdf.js';

const router = Router();

// GET /api/campaigns
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, d.name AS design_name, d.accent_color AS design_accent_color
    FROM campaigns c
    LEFT JOIN designs d ON d.id = c.design_id
    ORDER BY c.created_at DESC
  `).all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      designId: r.design_id,
      designName: r.design_name,
      designAccentColor: r.design_accent_color,
      name: r.name,
      subjectTemplate: r.subject_template,
      status: r.status,
      provider: r.provider,
      totalRecipients: r.total_recipients,
      sentCount: r.sent_count,
      failedCount: r.failed_count,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }))
  );
});

// GET /api/campaigns/:id
router.get('/:id', (req, res) => {
  const row = db.prepare(`
    SELECT c.*, d.name AS design_name, d.accent_color AS design_accent_color
    FROM campaigns c
    LEFT JOIN designs d ON d.id = c.design_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Campaign not found' });

  const recipients = db.prepare(`
    SELECT cr.*, r.email, r.company_name, r.first_name, r.last_name
    FROM campaign_recipients cr
    JOIN recipients r ON r.id = cr.recipient_id
    WHERE cr.campaign_id = ?
    ORDER BY cr.sent_at DESC
  `).all(req.params.id);

  res.json({
    id: row.id,
    designId: row.design_id,
    designName: row.design_name,
    name: row.name,
    subjectTemplate: row.subject_template,
    status: row.status,
    provider: row.provider,
    totalRecipients: row.total_recipients,
    sentCount: row.sent_count,
    failedCount: row.failed_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    recipients: recipients.map((r) => ({
      id: r.id,
      recipientId: r.recipient_id,
      proposalId: r.proposal_id,
      status: r.status,
      error: r.error,
      email: r.email,
      companyName: r.company_name,
      firstName: r.first_name,
      lastName: r.last_name,
      sentAt: r.sent_at,
      openedAt: r.opened_at,
      clickedAt: r.clicked_at,
    })),
  });
});

// POST /api/campaigns
router.post('/', (req, res) => {
  const { designId, name, subjectTemplate, provider } = req.body;
  if (!designId) return res.status(400).json({ error: 'designId is required' });

  const design = db.prepare('SELECT id FROM designs WHERE id = ?').get(designId);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const id = newId();
  const ts = nowIso();
  db.prepare(
    `INSERT INTO campaigns (id, design_id, name, subject_template, status, provider, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(id, designId, name || '', subjectTemplate || 'Proposal for {{company_name}}', provider || 'resend', ts, ts);

  const row = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
  res.status(201).json({
    id: row.id,
    designId: row.design_id,
    name: row.name,
    subjectTemplate: row.subject_template,
    status: row.status,
    provider: row.provider,
    createdAt: row.created_at,
  });
});

// POST /api/campaigns/:id/add-recipients — add recipients to a campaign
router.post('/:id/add-recipients', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
  if (campaign.status !== 'draft') return res.status(400).json({ error: 'Can only add recipients to draft campaigns' });

  const { recipientIds } = req.body;
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'recipientIds array is required' });
  }

  const insert = db.prepare(
    `INSERT OR IGNORE INTO campaign_recipients (id, campaign_id, recipient_id, status, created_at)
     VALUES (?, ?, ?, 'pending', ?)`
  );
  const ts = nowIso();
  let added = 0;
  for (const rid of recipientIds) {
    const r = db.prepare('SELECT id FROM recipients WHERE id = ?').get(rid);
    if (r) {
      insert.run(newId(), campaign.id, r.id, ts);
      added++;
    }
  }

  const total = db.prepare('SELECT COUNT(*) AS c FROM campaign_recipients WHERE campaign_id = ?').get(campaign.id).c;
  db.prepare('UPDATE campaigns SET total_recipients = ?, updated_at = ? WHERE id = ?').run(total, ts, campaign.id);

  res.json({ added, total });
});

// POST /api/campaigns/:id/send — send emails to all pending recipients
router.post('/:id/send', async (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

  const design = db.prepare('SELECT * FROM designs WHERE id = ?').get(campaign.design_id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const pending = db.prepare(`
    SELECT cr.*, r.email, r.company_name, r.first_name, r.last_name
    FROM campaign_recipients cr
    JOIN recipients r ON r.id = cr.recipient_id
    WHERE cr.campaign_id = ? AND cr.status = 'pending'
  `).all(campaign.id);

  if (pending.length === 0) {
    return res.status(400).json({ error: 'No pending recipients to send to' });
  }

  const baseUrl = req.protocol + '://' + req.get('host');
  const provider = req.body?.provider || campaign.provider;

  db.prepare('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?').run('sending', nowIso(), campaign.id);

  let sent = 0;
  let failed = 0;

  for (const cr of pending) {
    try {
      // Find or generate proposal for this recipient
      let proposal = db.prepare('SELECT * FROM proposals WHERE design_id = ? AND company_name = ?')
        .get(design.id, cr.company_name);

      if (!proposal) {
        // Generate one on the fly (skip if no AI configured)
        const { generateProposal } = await import('../ai/providers.js');
        try {
          const copy = await generateProposal({
            design,
            companyName: cr.company_name,
            notes: '',
          });
          const ts = nowIso();
          const pid = newId();
          db.prepare(
            `INSERT INTO proposals (id, design_id, company_name, notes, headline, opening, body_paragraphs, closing, created_at, updated_at)
             VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?)`
          ).run(pid, design.id, cr.company_name, copy.headline, copy.opening, JSON.stringify(copy.bodyParagraphs), copy.closing, ts, ts);
          proposal = db.prepare('SELECT * FROM proposals WHERE id = ?').get(pid);
        } catch {
          throw new Error('No existing proposal and AI generation failed');
        }
      }

      const subject = resolveTemplate(campaign.subject_template, {
        company_name: cr.company_name,
        first_name: cr.first_name,
        last_name: cr.last_name,
        headline: proposal.headline,
      });

      const trackingPixelUrl = `${baseUrl}/api/track/open/${proposal.id}/${cr.recipient_id}`;
      const clickBaseUrl = `${baseUrl}/api/track/click/${proposal.id}/${cr.recipient_id}`;

      const html = buildEmailHTML({
        headline: proposal.headline,
        opening: proposal.opening,
        bodyParagraphs: JSON.parse(proposal.body_paragraphs || '[]'),
        closing: proposal.closing,
        accentColor: design.accent_color,
        senderName: design.sender_name,
        companyName: cr.company_name,
        trackingPixelUrl,
        clickLinks: { opening: clickBaseUrl },
      });

      await sendEmail({
        to: cr.email,
        subject,
        html,
        provider,
      });

      db.prepare(
        `UPDATE campaign_recipients SET status = 'sent', proposal_id = ?, sent_at = ?, updated_at = ? WHERE id = ?`
      ).run(proposal.id, nowIso(), nowIso(), cr.id);
      sent++;
    } catch (err) {
      failed++;
      db.prepare(
        `UPDATE campaign_recipients SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`
      ).run(err.message, nowIso(), cr.id);
    }
  }

  const finalStatus = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
  db.prepare('UPDATE campaigns SET status = ?, sent_count = sent_count + ?, failed_count = failed_count + ?, updated_at = ? WHERE id = ?')
    .run(finalStatus, sent, failed, nowIso(), campaign.id);

  res.json({ sent, failed, total: pending.length, status: finalStatus });
});

// DELETE /api/campaigns/:id
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Campaign not found' });
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

export default router;
