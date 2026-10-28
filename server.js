require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');

const connectDB = require('./config/db');
const { getJwtSecret, UPLOAD } = require('./config/constants');
const { sanitizeInput } = require('./middleware/validate');
const { apiLimiter } = require('./middleware/rateLimit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const isProd = process.env.NODE_ENV === 'production';
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);

// ── Security headers ─────────────────────────────────────────────────────────
// The frontend uses external scripts only (no inline JS), and shows PDFs in same-origin iframes.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'blob:'],
        'frame-src': ["'self'", 'blob:'],
        'object-src': ["'self'", 'blob:'],
        'connect-src': ["'self'", ...corsOrigins],
        'frame-ancestors': ["'self'", ...corsOrigins],
        'upgrade-insecure-requests': isProd ? [] : null,
      },
    },
    frameguard: corsOrigins.length ? false : { action: 'sameorigin' },
    crossOriginResourcePolicy: { policy: corsOrigins.length ? 'cross-origin' : 'same-origin' },
  })
);

if (corsOrigins.length) {
  app.use('/api', cors({ origin: corsOrigins, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'Authorization'], maxAge: 600 }));
}

app.use(compression());
if (process.env.NODE_ENV !== 'test') app.use(morgan(isProd ? 'combined' : 'dev'));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(sanitizeInput);

// ── API ──────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok', time: new Date().toISOString() }));

app.use('/api', apiLimiter);
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/subjects', require('./routes/subjectRoutes'));
app.use('/api/resources', require('./routes/resourceRoutes'));
app.use('/api/search', require('./routes/searchRoutes'));
app.use('/api/reviews', require('./routes/reviewRoutes'));
app.use('/api/bookmarks', require('./routes/bookmarkRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/coverage', require('./routes/coverageRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api', notFound); // unknown /api/... paths return JSON 404

// ── Frontend (the "public" folder from the frontend zip, if it is placed next to this file) ──
// NOTE: uploaded PDFs are deliberately NOT served statically. They are only reachable through
// /api/resources/:id/preview and /download, which enforce visibility rules.
const PUBLIC_DIR = path.join(__dirname, 'public');
if (fs.existsSync(PUBLIC_DIR)) {
  app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: isProd ? '1h' : 0 }));
}

app.use(notFound);
app.use(errorHandler);

// ── Start ────────────────────────────────────────────────────────────────────
async function start() {
  getJwtSecret(); // fail fast if the secret is missing/weak
  await connectDB();

  const port = Number(process.env.PORT) || 5000;
  const server = app.listen(port, () => {
    console.log(`StudySphere running on http://localhost:${port}`);
    console.log(`Uploads folder: ${UPLOAD.DIR}`);
    if (!fs.existsSync(PUBLIC_DIR)) console.log('No "public" folder found: running as API only. Put the frontend folder here to serve the website too.');
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down...`);
    server.close(async () => {
      await require('mongoose').connection.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

if (require.main === module) {
  start().catch((err) => {
    console.error(`\nCould not start StudySphere: ${err.message}\n`);
    process.exit(1);
  });
}

module.exports = app;
