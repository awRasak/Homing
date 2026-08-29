import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import designsRouter from './routes/designs.js';
import generateRouter from './routes/generate.js';
import proposalsRouter from './routes/proposals.js';
import recipientsRouter from './routes/recipients.js';
import batchRouter from './routes/batch.js';
import campaignsRouter from './routes/campaigns.js';
import trackingRouter from './routes/tracking.js';
import beccaRouter from './routes/becca.js';
import socialRouter from './routes/social.js';
import bufferRouter from './routes/buffer.js';
import authRouter from './routes/auth.js';
import socialAssetsRouter from './routes/socialAssets.js';
import chatwootRouter from './routes/chatwoot.js';
import { getAvailableProviders, getActiveProvider } from './ai/providers.js';
import { startScheduler, startSocialAssetsPruner } from './scheduler.js';
import { requireAuth } from './auth.js';
import { probePyMuPDF } from './pdfTool.js';
import './db.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    providers: getAvailableProviders(),
    activeProvider: getActiveProvider(),
  });
});

// Auth routes — public
app.use('/api/auth', authRouter);

// Chatwoot — single router handles its own auth (webhook public, rest requires JWT)
app.use('/api/chatwoot', chatwootRouter);
app.use('/api/designs', requireAuth, designsRouter);
app.use('/api/designs', requireAuth, generateRouter);
app.use('/api/designs', requireAuth, batchRouter);
app.use('/api/proposals', requireAuth, proposalsRouter);
app.use('/api/recipients', requireAuth, recipientsRouter);
app.use('/api/campaigns', requireAuth, campaignsRouter);
app.use('/api/track', requireAuth, trackingRouter);
app.use('/api/becca', requireAuth, beccaRouter);
app.use('/api/social', requireAuth, socialRouter);
app.use('/api/buffer', requireAuth, bufferRouter);
// Not gated by requireAuth at this level — Buffer's servers must be able to
// GET the composited image directly; the router itself guards the write path.
app.use('/api/social-assets', socialAssetsRouter);

// Body-parser errors (oversized payload, malformed JSON) otherwise fall
// through to Express's default HTML error page, which leaks internal file
// paths and returns HTML to a client expecting JSON.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  if (err?.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Malformed request body.' });
  }
  next(err);
});

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Homing server listening on http://localhost:${port}`);
  probePyMuPDF();
  startScheduler();
  startSocialAssetsPruner();
});
