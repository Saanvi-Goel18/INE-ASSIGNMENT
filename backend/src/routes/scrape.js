const express = require('express');
const router = express.Router();
const { startRun, isRunning, getLastRun } = require('../scraper/runAll');

// cron-job.org times out after 30 s and a full run takes minutes, so we answer
// immediately and scrape in the background. ?wait=1 blocks until done (manual testing).
// ?simulate_layout_change=<tracked product id> blocks the store's layout manifest for that
// one product, to demonstrate change detection on the live site.
router.post('/run', async (req, res) => {
  const { started, promise } = startRun({ simulateLayoutChangeFor: req.query.simulate_layout_change || null });
  if (req.query.wait) return res.json({ started, ...(await promise) });
  res.status(started ? 202 : 409).json({ started, message: started ? 'scrape run started' : 'a run is already in progress' });
});

router.get('/status', (req, res) => {
  res.json({ running: isRunning(), lastRun: getLastRun() });
});

module.exports = router;
