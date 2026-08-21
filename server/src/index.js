import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import designsRouter from './routes/designs.js';
import generateRouter from './routes/generate.js';
import proposalsRouter from './routes/proposals.js';
import recipientsRouter from './routes/recipients.js';
import batchRouter from './routes/batch.js';
import pdfRouter from './routes/pdf.js';
import campaignsRouter from './routes/campaigns.js';
import trackingRouter from './routes/tracking.js';
import beccaRouter from './routes/becca.js';
import { getAvailableProviders, getActiveProvider } from './ai/providers.js';
import { startScheduler } from './scheduler.js';
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

app.use('/api/designs', designsRouter);
app.use('/api/designs', generateRouter);
app.use('/api/designs', batchRouter);
app.use('/api/proposals', proposalsRouter);
app.use('/api/proposals', pdfRouter);
app.use('/api/recipients', recipientsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/track', trackingRouter);
app.use('/api/becca', beccaRouter);

const port = process.env.PORT || 4000;
app.listen(port, () => {
  console.log(`Homing server listening on http://localhost:${port}`);
  startScheduler();
});
