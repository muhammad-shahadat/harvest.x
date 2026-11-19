const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const { query } = require('./db/pool');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.set('trust proxy', 1); // Render puts a proxy in front of us; needed for correct IP in rate limiting

app.use(helmet());
app.use(cors({
  origin: [env.CLIENT_URL, 'http://localhost:5173'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '100kb' }));

// FR-40: rate limiting. Login is limited more strictly.
app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.RATE_LIMIT_MAX) || 600, standardHeaders: true, legacyHeaders: false }));
app.use('/api/auth/google', rateLimit({ windowMs: 15 * 60 * 1000, limit: Number(process.env.RATE_LIMIT_AUTH_MAX) || 30, standardHeaders: true, legacyHeaders: false }));

app.get('/api/health', async (req, res, next) => {
  try { await query('SELECT 1'); res.json({ ok: true, db: true }); } catch (e) { next(e); }
});

const meRoutes = require('./routes/me');
const applications = require('./routes/applications');

app.use('/api/auth', require('./routes/auth'));
app.use('/api/me', meRoutes);
app.use('/api/addresses', meRoutes.addresses);
app.use('/api/farmer/application', applications.farmer);
app.use('/api/buyer/application', applications.buyer);
app.use('/api', require('./routes/locations'));
app.use('/api/admin', require('./routes/admin'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
