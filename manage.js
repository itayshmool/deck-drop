// Local-only deck management server.
// Run via `npm run manage` — listens on port 4000.
// Not deployed to Render.
require('dotenv').config({ path: '.manage.env' });
const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const https = require('https');
const http = require('http');

const app = express();
const PORT = 4000;
const DECKS_DIR = path.join(__dirname, 'decks');
const CONFIG_FILE = path.join(__dirname, '.manage.env');

app.use(express.json({ limit: '50mb' }));

// --- Config helpers (.manage.env) ---
function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  const content = fs.readFileSync(CONFIG_FILE, 'utf8');
  const config = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    config[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return config;
}

function writeConfig(updates) {
  const current = readConfig();
  const merged = { ...current, ...updates };
  const content = Object.entries(merged)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
  fs.writeFileSync(CONFIG_FILE, content);
  for (const [k, v] of Object.entries(merged)) process.env[k] = v;
}

// --- Slug helpers ---
function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(slug) && !slug.includes('..');
}

// --- HTTP request helper ---
function httpRequest(url, method, body) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname,
      method,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(chunks);
        else reject(new Error(`${res.statusCode}: ${chunks}`));
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out (30s)')); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// --- Git helpers ---
function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: __dirname, encoding: 'utf8' }).trim();
}

// --- Deck helpers ---
function readDeckMeta(slug) {
  const file = path.join(DECKS_DIR, slug, 'deck.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeDeckMeta(slug, meta) {
  const file = path.join(DECKS_DIR, slug, 'deck.json');
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + '\n');
}

function readDeckSeed(slug) {
  const file = path.join(DECKS_DIR, slug, 'data', 'users.seed.json');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeDeckSeed(slug, data) {
  const file = path.join(DECKS_DIR, slug, 'data', 'users.seed.json');
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}

function listDecks() {
  if (!fs.existsSync(DECKS_DIR)) return [];
  return fs.readdirSync(DECKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(slug => fs.existsSync(path.join(DECKS_DIR, slug, 'deck.json')));
}

// --- Routes ---
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'manage.html'));
});

app.get('/api/decks', (req, res) => {
  const decks = listDecks().map(slug => {
    const meta = readDeckMeta(slug);
    const htmlPath = path.join(DECKS_DIR, slug, 'public', 'index.html');
    const hasHtml = fs.existsSync(htmlPath);
    const htmlSize = hasHtml ? fs.statSync(htmlPath).size : 0;
    let userCount = 0;
    try { userCount = readDeckSeed(slug).users.length; } catch { /* no seed */ }
    return { slug, name: meta.name, userCount, hasHtml, htmlSize };
  });
  res.json({ decks });
});

app.post('/api/decks', (req, res) => {
  const { slug, name, users, htmlContent } = req.body;
  if (!slug || !isValidSlug(slug)) {
    return res.status(400).json({ error: 'Invalid slug (use lowercase letters, numbers, hyphens, dots)' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Display name required' });
  }
  const deckDir = path.join(DECKS_DIR, slug);
  if (fs.existsSync(deckDir)) {
    return res.status(400).json({ error: `Deck "${slug}" already exists` });
  }
  const userList = Array.isArray(users)
    ? users.map(e => e.trim().toLowerCase()).filter(Boolean)
    : [];

  fs.mkdirSync(path.join(deckDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(deckDir, 'public'), { recursive: true });
  writeDeckMeta(slug, { name: name.trim() });
  writeDeckSeed(slug, { users: userList });
  if (htmlContent && htmlContent.trim()) {
    fs.writeFileSync(path.join(deckDir, 'public', 'index.html'), htmlContent);
  } else {
    fs.writeFileSync(
      path.join(deckDir, 'public', 'index.html'),
      `<!DOCTYPE html><html><body style="background:#0a0a0a;color:#deff9a;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><h1>${name.trim()}</h1></body></html>`
    );
  }
  res.json({ success: true, slug });
});

app.post('/api/decks/:slug/duplicate', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug) || !fs.existsSync(path.join(DECKS_DIR, slug))) {
    return res.status(404).json({ error: 'Source deck not found' });
  }
  const { newSlug, newName, copyUsers } = req.body;
  if (!newSlug || !isValidSlug(newSlug)) {
    return res.status(400).json({ error: 'Invalid new slug (use lowercase letters, numbers, hyphens, dots)' });
  }
  if (!newName || !newName.trim()) {
    return res.status(400).json({ error: 'New display name required' });
  }
  const newDir = path.join(DECKS_DIR, newSlug);
  if (fs.existsSync(newDir)) {
    return res.status(400).json({ error: `Deck "${newSlug}" already exists` });
  }

  fs.mkdirSync(path.join(newDir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(newDir, 'public'), { recursive: true });
  writeDeckMeta(newSlug, { name: newName.trim() });
  const users = copyUsers ? (readDeckSeed(slug).users || []) : [];
  writeDeckSeed(newSlug, { users });
  const srcHtml = path.join(DECKS_DIR, slug, 'public', 'index.html');
  const dstHtml = path.join(newDir, 'public', 'index.html');
  if (fs.existsSync(srcHtml)) fs.copyFileSync(srcHtml, dstHtml);

  res.json({ success: true, slug: newSlug });
});

app.get('/api/decks/:slug/seed', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug) || !fs.existsSync(path.join(DECKS_DIR, slug))) {
    return res.status(404).json({ error: 'Deck not found' });
  }
  try { res.json(readDeckSeed(slug)); }
  catch { res.json({ users: [] }); }
});

app.put('/api/decks/:slug/users', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug) || !fs.existsSync(path.join(DECKS_DIR, slug))) {
    return res.status(404).json({ error: 'Deck not found' });
  }
  const { users } = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'users array required' });
  const cleaned = users.map(e => e.trim().toLowerCase()).filter(Boolean);
  writeDeckSeed(slug, { users: cleaned });
  res.json({ success: true, count: cleaned.length });
});

app.post('/api/decks/:slug/html', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug) || !fs.existsSync(path.join(DECKS_DIR, slug))) {
    return res.status(404).json({ error: 'Deck not found' });
  }
  const { htmlContent } = req.body;
  if (!htmlContent) return res.status(400).json({ error: 'htmlContent required' });
  fs.writeFileSync(path.join(DECKS_DIR, slug, 'public', 'index.html'), htmlContent);
  res.json({ success: true });
});

app.post('/api/decks/:slug/update', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug) || !fs.existsSync(path.join(DECKS_DIR, slug))) {
    return res.status(404).json({ error: 'Deck not found' });
  }
  const meta = readDeckMeta(slug);
  const { htmlContent } = req.body;
  if (!htmlContent) return res.status(400).json({ error: 'htmlContent required' });

  const steps = [];
  try {
    steps.push({ step: 'Write HTML', status: 'done' });
    fs.writeFileSync(path.join(DECKS_DIR, slug, 'public', 'index.html'), htmlContent);

    steps.push({ step: 'Git add', status: 'done' });
    git(`add decks/${slug}/`);

    try {
      git(`commit -m "Update deck: ${meta.name}"`);
      steps.push({ step: 'Git commit', status: 'done' });
    } catch (e) {
      steps.push({ step: 'Git commit', status: 'skipped', message: 'No changes to commit' });
    }

    git('push origin main');
    steps.push({ step: 'Git push', status: 'done', message: 'Auto-deploy triggered' });

    res.json({ success: true, steps });
  } catch (err) {
    steps.push({ step: steps.length ? 'Error' : 'Unknown', status: 'error', message: err.message });
    res.status(500).json({ error: err.message, steps });
  }
});

app.get('/api/decks/:slug/preview', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).send('Invalid slug');
  const htmlPath = path.join(DECKS_DIR, slug, 'public', 'index.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('No HTML for this deck');
  res.sendFile(htmlPath);
});

app.get('/api/decks/:slug/print', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).send('Invalid slug');
  const htmlPath = path.join(DECKS_DIR, slug, 'public', 'index.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('No HTML for this deck');

  let html = fs.readFileSync(htmlPath, 'utf8');

  // Remove all script tags so deck JS doesn't interfere with print layout
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Rewrite relative img src paths to absolute for local preview
  html = html.replace(/(<img[^>]+src=")(?!https?:\/\/|\/|data:)(.*?)(")/gi, `$1/api/decks/${slug}/images/$2$3`);

  // Add deckdrop-print-mode class directly to <body>
  html = html.replace(/<body([^>]*)>/, '<body$1 class="deckdrop-print-mode">');

  const printCSS = `<style>
    .deckdrop-print-mode, .deckdrop-print-mode * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .deckdrop-print-mode {
      overflow: visible !important;
      height: auto !important;
      width: auto !important;
    }
    .deckdrop-print-mode .deck {
      height: auto !important;
      overflow: visible !important;
    }
    .deckdrop-print-mode .slide {
      position: relative !important;
      inset: auto !important;
      opacity: 1 !important;
      visibility: visible !important;
      transform: none !important;
      transition: none !important;
      display: flex !important;
      width: 100vw !important;
      height: 100vh !important;
      overflow: hidden !important;
      break-after: page;
      page-break-after: always;
    }
    .deckdrop-print-mode .nav, .deckdrop-print-mode .progress,
    .deckdrop-print-mode .slide-counter, .deckdrop-print-mode .menu-btn,
    .deckdrop-print-mode .menu-panel, .deckdrop-print-mode .menu-overlay,
    .deckdrop-print-mode [class*="nav-btn"] { display: none !important; }
    @media print {
      @page { size: landscape; margin: 0; }
    }
  </style>`;

  const printScript = `<script>setTimeout(() => window.print(), 600);</script>`;

  html = html.replace('</head>', printCSS + '</head>');
  html = html.replace('</body>', printScript + '</body>');

  res.type('html').send(html);
});

app.get('/api/decks/:slug/images/*', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).send('Invalid slug');
  const imgPath = path.join(DECKS_DIR, slug, 'public', 'images', req.params[0]);
  if (!fs.existsSync(imgPath)) return res.status(404).send('Not found');
  res.sendFile(imgPath);
});

// --- Deploy (simplified: git push + seed) ---
app.post('/api/decks/:slug/deploy', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug) || !fs.existsSync(path.join(DECKS_DIR, slug))) {
    return res.status(404).json({ error: 'Deck not found' });
  }
  const config = readConfig();
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ADMIN_EMAILS']
    .filter(k => !config[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing config: ${missing.join(', ')}. Configure in Settings.` });
  }
  if (!config.BASE_URL) {
    return res.status(400).json({ error: 'Missing BASE_URL. Configure the production URL in Settings.' });
  }

  const steps = [];
  try {
    const meta = readDeckMeta(slug);

    // 1. Git operations
    steps.push({ step: 'git-add', status: 'running' });
    git(`add decks/${slug}/`);
    steps[steps.length - 1].status = 'done';

    try {
      steps.push({ step: 'git-commit', status: 'running' });
      git(`commit -m "Deploy deck: ${meta.name}"`);
      steps[steps.length - 1].status = 'done';
    } catch (e) {
      steps[steps.length - 1].status = 'skipped';
      steps[steps.length - 1].message = 'No changes to commit';
    }

    steps.push({ step: 'git-push', status: 'running' });
    git('push origin main');
    steps[steps.length - 1].status = 'done';
    steps[steps.length - 1].message = 'Auto-deploy triggered';

    // 2. Seed users to running service
    steps.push({ step: 'seed-users', status: 'running' });
    try {
      const seedData = readDeckSeed(slug);
      const seedUrl = `${config.BASE_URL}/api/${slug}/seed`;
      const maxRetries = 3;
      let lastError;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await httpRequest(seedUrl, 'PUT', { users: seedData.users });
          lastError = null;
          break;
        } catch (e) {
          lastError = e;
          if (attempt < maxRetries) {
            await new Promise(r => setTimeout(r, attempt * 5000));
          }
        }
      }
      if (lastError) throw lastError;
      steps[steps.length - 1].status = 'done';
      steps[steps.length - 1].message = `Seeded ${seedData.users.length} users`;
    } catch (e) {
      steps[steps.length - 1].status = 'error';
      steps[steps.length - 1].message = `Seed failed: ${e.message}`;
    }

    const deckUrl = `${config.BASE_URL}/${slug}`;
    res.json({ success: true, steps, deckUrl });
  } catch (err) {
    if (steps.length) steps[steps.length - 1].status = 'error';
    res.status(500).json({ error: err.message, steps });
  }
});

// --- Config ---
app.get('/api/config', (req, res) => {
  const c = readConfig();
  const mask = (v) => v ? v.slice(0, 4) + '...' + v.slice(-4) : '';
  res.json({
    googleClientId: c.GOOGLE_CLIENT_ID ? mask(c.GOOGLE_CLIENT_ID) : '',
    hasGoogleSecret: !!c.GOOGLE_CLIENT_SECRET,
    adminEmails: c.ADMIN_EMAILS || '',
    baseUrl: c.BASE_URL || ''
  });
});

app.put('/api/config', (req, res) => {
  const { googleClientId, googleClientSecret, adminEmails, baseUrl } = req.body;
  const updates = {};
  if (googleClientId) updates.GOOGLE_CLIENT_ID = googleClientId.trim();
  if (googleClientSecret) updates.GOOGLE_CLIENT_SECRET = googleClientSecret.trim();
  if (adminEmails) updates.ADMIN_EMAILS = adminEmails.trim();
  if (baseUrl) updates.BASE_URL = baseUrl.trim().replace(/\/$/, '');
  writeConfig(updates);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Deck Manager running on http://localhost:${PORT}`);
});
