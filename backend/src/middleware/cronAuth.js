const crypto = require('crypto');

module.exports = function cronAuth(req, res, next) {
  const expected = process.env.CRON_SECRET || '';
  const given = req.header('x-cron-secret') || '';
  const ok = expected.length > 0 && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: 'unauthorized' });
  next();
};
