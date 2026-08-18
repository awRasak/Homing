import { Router } from 'express';
import { db, nowIso, newId } from '../db.js';
import { generateProposal } from '../ai/providers.js';

const router = Router();

// POST /api/designs/:id/batch-generate
// Body: { recipientIds: string[], provider?: string, model?: string }
// Returns SSE stream with progress events
router.post('/:id/batch-generate', async (req, res) => {
  const design = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const { recipientIds, provider, model } = req.body;
  if (!Array.isArray(recipientIds) || recipientIds.length === 0) {
    return res.status(400).json({ error: 'recipientIds array is required' });
  }

  const recipients = recipientIds
    .map((id) => db.prepare('SELECT * FROM recipients WHERE id = ?').get(id))
    .filter(Boolean);

  if (recipients.length === 0) {
    return res.status(400).json({ error: 'No valid recipients found' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function sendEvent(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  const total = recipients.length;
  let completed = 0;
  let failed = 0;

  sendEvent('start', { total, designId: design.id });

  for (const recipient of recipients) {
    const companyName = recipient.company_name || recipient.email;
    sendEvent('progress', {
      current: completed + failed + 1,
      total,
      status: 'generating',
      companyName,
      recipientId: recipient.id,
    });

    try {
      const copy = await generateProposal({
        design,
        companyName,
        notes: '',
        provider,
        model,
      });

      const ts = nowIso();
      const existing = db
        .prepare('SELECT id FROM proposals WHERE design_id = ? AND company_name = ?')
        .get(design.id, companyName);

      let proposalId;
      if (existing) {
        proposalId = existing.id;
        db.prepare(
          `UPDATE proposals SET notes = ?, headline = ?, opening = ?, body_paragraphs = ?, closing = ?, updated_at = ? WHERE id = ?`
        ).run('', copy.headline, copy.opening, JSON.stringify(copy.bodyParagraphs), copy.closing, ts, proposalId);
      } else {
        proposalId = newId();
        db.prepare(
          `INSERT INTO proposals (id, design_id, company_name, notes, headline, opening, body_paragraphs, closing, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(proposalId, design.id, companyName, '', copy.headline, copy.opening, JSON.stringify(copy.bodyParagraphs), copy.closing, ts, ts);
      }

      completed++;
      sendEvent('progress', {
        current: completed + failed,
        total,
        status: 'done',
        companyName,
        recipientId: recipient.id,
        proposalId,
      });

      // Rate limit: 1 second between requests
      if (completed + failed < total) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (err) {
      failed++;
      sendEvent('progress', {
        current: completed + failed,
        total,
        status: 'error',
        companyName,
        recipientId: recipient.id,
        error: err.message,
      });
    }
  }

  sendEvent('done', { total, completed, failed, designId: design.id });
  res.end();
});

export default router;
