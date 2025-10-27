const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs/promises');
const { v4: uuidv4 } = require('uuid');
const dayjs = require('dayjs');
const { runAgent } = require('./agent');

const app = express();
const PORT = process.env.PORT || 4000;

const uploadsDir = path.join(__dirname, 'uploads');
const upload = multer({ dest: uploadsDir });

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, ts: dayjs().toISOString(), message: 'ok' });
});

app.post('/api/run-agent', upload.single('tripsFile'), async (req, res) => {
  const runId = uuidv4();
  const pricingUrl = (req.body?.pricingUrl || '').trim();
  const csvPath = req.file?.path;

  if (!csvPath) {
    return res.status(400).json({ success: false, error: 'Missing CSV upload.' });
  }

  if (!pricingUrl) {
    await fs.unlink(csvPath).catch(() => {});
    return res.status(400).json({ success: false, error: 'Missing pricing URL.' });
  }

  try {
    const result = await runAgent({
      runId,
      csvPath,
      pricingUrl
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[agent:error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Agent run failed.'
    });
  } finally {
    if (csvPath) {
      await fs.unlink(csvPath).catch(() => {});
    }
  }
});

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found.' });
});

app.listen(PORT, async () => {
  await fs.mkdir(uploadsDir, { recursive: true }).catch(() => {});
  console.log(`Bike pass optimizer listening on port ${PORT}`);
});
