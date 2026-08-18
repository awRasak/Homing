import { Router } from 'express';
import { db, nowIso } from '../db.js';

const router = Router();

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

// GET /api/track/open/:proposalId/:recipientId
router.get('/open/:proposalId/:recipientId', (req, res) => {
  const { proposalId, recipientId } = req.params;

  try {
    // Update campaign_recipients opened_at if not already set
    db.prepare(`
      UPDATE campaign_recipients
      SET opened_at = COALESCE(opened_at, ?)
      WHERE proposal_id = ? AND recipient_id = ? AND status = 'sent'
    `).run(nowIso(), proposalId, recipientId);

    // Log the event
    db.prepare(`
      INSERT INTO email_events (id, event_type, proposal_id, recipient_id, timestamp, ip, user_agent)
      VALUES (?, 'open', ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      proposalId,
      recipientId,
      nowIso(),
      req.ip,
      req.get('user-agent') || '',
    );
  } catch {
    // Silently ignore tracking errors
  }

  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.send(PIXEL);
});

// GET /api/track/click/:proposalId/:recipientId?url=<original_url>
router.get('/click/:proposalId/:recipientId', (req, res) => {
  const { proposalId, recipientId } = req.params;
  const url = req.query.url || 'https://example.com';

  try {
    // Update campaign_recipients clicked_at if not already set
    db.prepare(`
      UPDATE campaign_recipients
      SET clicked_at = COALESCE(clicked_at, ?)
      WHERE proposal_id = ? AND recipient_id = ? AND status = 'sent'
    `).run(nowIso(), proposalId, recipientId);

    // Log the event
    db.prepare(`
      INSERT INTO email_events (id, event_type, proposal_id, recipient_id, timestamp, ip, user_agent)
      VALUES (?, 'click', ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      proposalId,
      recipientId,
      nowIso(),
      req.ip,
      req.get('user-agent') || '',
    );
  } catch {
    // Silently ignore tracking errors
  }

  res.redirect(302, url);
});

export default router;
