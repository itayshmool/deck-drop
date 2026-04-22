// Local-only deck management server.
// Run via `npm run manage` — listens on port 4000.
// Not deployed to Render.
require('dotenv').config({ path: '.manage.env' });
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const https = require('https');

const app = express();
const PORT = 4000;
const DECKS_DIR = path.join(__dirname, 'decks');
const CONFIG_FILE = path.join(__dirname, '.manage.env');
const REPO_URL = 'https://github.com/itayshmool/online-decks';
const RENDER_OWNER_ID = 'tea-d4o0qcn5r7bs73cbu0pg';
const AUTH_SERVICE_NAME = 'online-decks-auth';
const AUTH_SERVICE_URL = `https://${AUTH_SERVICE_NAME}.onrender.com`;

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
  // Reload into process.env
  for (const [k, v] of Object.entries(merged)) process.env[k] = v;
}

// --- Slug helpers ---
function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(slug) && !slug.includes('..');
}

function toServiceName(slug) {
  return 'online-decks-' + slug.replace(/[^a-z0-9-]/g, '');
}

// --- Render API helper ---
function renderApi(method, urlPath, body) {
  const apiKey = readConfig().RENDER_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error('RENDER_API_KEY not set. Configure it in Settings.'));
  }
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.render.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(chunks ? JSON.parse(chunks) : {}); }
          catch { resolve(chunks); }
        } else {
          reject(new Error(`Render API ${res.statusCode}: ${chunks}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// --- Auth proxy deploy helper ---
async function ensureAuthProxy(config) {
  // Check if auth proxy service already exists
  const services = await renderApi('GET', `/v1/services?name=${AUTH_SERVICE_NAME}&ownerId=${RENDER_OWNER_ID}`);
  const list = Array.isArray(services) ? services : [];
  const existing = list.find(s => (s.service || s).name === AUTH_SERVICE_NAME);
  if (existing) {
    return { skipped: true, url: AUTH_SERVICE_URL };
  }

  // Ensure AUTH_SECRET exists in config
  if (!config.AUTH_SECRET) {
    config.AUTH_SECRET = crypto.randomBytes(32).toString('hex');
    writeConfig({ AUTH_SECRET: config.AUTH_SECRET });
  }

  const serviceBody = {
    autoDeploy: 'yes',
    branch: 'main',
    name: AUTH_SERVICE_NAME,
    ownerId: RENDER_OWNER_ID,
    repo: REPO_URL,
    type: 'web_service',
    envVars: [
      { key: 'GOOGLE_CLIENT_ID', value: config.GOOGLE_CLIENT_ID },
      { key: 'GOOGLE_CLIENT_SECRET', value: config.GOOGLE_CLIENT_SECRET },
      { key: 'AUTH_SECRET', value: config.AUTH_SECRET },
      { key: 'CALLBACK_URL', value: `${AUTH_SERVICE_URL}/auth/google/callback` },
      { key: 'NODE_ENV', value: 'production' }
    ],
    serviceDetails: {
      runtime: 'node',
      env: 'node',
      plan: 'starter',
      region: 'frankfurt',
      numInstances: 1,
      envSpecificDetails: {
        buildCommand: 'npm install',
        startCommand: 'node auth-proxy.js'
      }
    }
  };
  await renderApi('POST', '/v1/services', serviceBody);
  return { skipped: false, url: AUTH_SERVICE_URL };
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
    return {
      slug,
      name: meta.name,
      renderUrl: meta.renderUrl || null,
      userCount,
      hasHtml,
      htmlSize
    };
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
    // Placeholder so preview doesn't 404
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

  // New deck.json — new name, no renderUrl (fresh service)
  writeDeckMeta(newSlug, { name: newName.trim() });

  // Seed users: copy from source if requested, else empty
  const users = copyUsers ? (readDeckSeed(slug).users || []) : [];
  writeDeckSeed(newSlug, { users });

  // Copy HTML
  const srcHtml = path.join(DECKS_DIR, slug, 'public', 'index.html');
  const dstHtml = path.join(newDir, 'public', 'index.html');
  if (fs.existsSync(srcHtml)) {
    fs.copyFileSync(srcHtml, dstHtml);
  }

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
  if (!Array.isArray(users)) {
    return res.status(400).json({ error: 'users array required' });
  }
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

app.get('/api/decks/:slug/preview', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).send('Invalid slug');
  const htmlPath = path.join(DECKS_DIR, slug, 'public', 'index.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('No HTML for this deck');
  res.sendFile(htmlPath);
});

// Static assets for preview (images referenced relative to the preview HTML)
app.get('/api/decks/:slug/images/*', (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug)) return res.status(400).send('Invalid slug');
  const imgPath = path.join(DECKS_DIR, slug, 'public', 'images', req.params[0]);
  if (!fs.existsSync(imgPath)) return res.status(404).send('Not found');
  res.sendFile(imgPath);
});

app.post('/api/decks/:slug/deploy', async (req, res) => {
  const { slug } = req.params;
  if (!isValidSlug(slug) || !fs.existsSync(path.join(DECKS_DIR, slug))) {
    return res.status(404).json({ error: 'Deck not found' });
  }
  const config = readConfig();
  const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'ADMIN_EMAILS', 'RENDER_API_KEY']
    .filter(k => !config[k]);
  if (missing.length) {
    return res.status(400).json({ error: `Missing config: ${missing.join(', ')}. Configure in Settings.` });
  }

  const steps = [];
  try {
    const meta = readDeckMeta(slug);
    const serviceName = toServiceName(slug);

    // 1. Ensure shared auth proxy exists
    steps.push({ step: 'auth-proxy', status: 'running' });
    const authResult = await ensureAuthProxy(config);
    // Re-read config in case AUTH_SECRET was just generated
    const freshConfig = readConfig();
    steps[steps.length - 1].status = authResult.skipped ? 'skipped' : 'done';
    steps[steps.length - 1].message = authResult.skipped
      ? `Auth proxy already running at ${authResult.url}`
      : `Created auth proxy at ${authResult.url}`;

    // 2. Git operations
    steps.push({ step: 'git-add', status: 'running' });
    git(`add decks/${slug}/`);
    steps[steps.length - 1].status = 'done';

    let commitOk = true;
    try {
      steps.push({ step: 'git-commit', status: 'running' });
      git(`commit -m "Deploy deck: ${meta.name}"`);
      steps[steps.length - 1].status = 'done';
    } catch (e) {
      // Nothing to commit is fine
      steps[steps.length - 1].status = 'skipped';
      steps[steps.length - 1].message = 'No changes to commit';
      commitOk = false;
    }

    steps.push({ step: 'git-push', status: 'running' });
    git('push origin main');
    steps[steps.length - 1].status = 'done';

    // 3. If renderUrl already set, skip service creation (auto-deploy handles it)
    if (meta.renderUrl) {
      steps.push({
        step: 'render-service',
        status: 'skipped',
        message: `Already deployed at ${meta.renderUrl}. Auto-deploy triggered by push.`
      });
      return res.json({ success: true, steps, renderUrl: meta.renderUrl });
    }

    // 4. Create Render service with shared auth proxy config
    steps.push({ step: 'render-service', status: 'running' });
    const sessionSecret = crypto.randomBytes(32).toString('hex');
    const serviceBody = {
      autoDeploy: 'yes',
      branch: 'main',
      name: serviceName,
      ownerId: RENDER_OWNER_ID,
      repo: REPO_URL,
      type: 'web_service',
      envVars: [
        { key: 'DECK_NAME', value: slug },
        { key: 'AUTH_SERVICE_URL', value: AUTH_SERVICE_URL },
        { key: 'AUTH_SECRET', value: freshConfig.AUTH_SECRET },
        { key: 'SESSION_SECRET', value: sessionSecret },
        { key: 'ADMIN_EMAILS', value: freshConfig.ADMIN_EMAILS },
        { key: 'NODE_ENV', value: 'production' },
        { key: 'DATA_DIR', value: '/var/data' }
      ],
      serviceDetails: {
        runtime: 'node',
        env: 'node',
        plan: 'starter',
        region: 'frankfurt',
        numInstances: 1,
        disk: { name: 'disk', mountPath: '/var/data', sizeGB: 1 },
        envSpecificDetails: {
          buildCommand: 'npm install',
          startCommand: 'node server.js'
        }
      }
    };
    const result = await renderApi('POST', '/v1/services', serviceBody);
    const service = result.service || result;
    const renderUrl = service.serviceDetails && service.serviceDetails.url
      ? service.serviceDetails.url
      : `https://${serviceName}.onrender.com`;
    steps[steps.length - 1].status = 'done';
    steps[steps.length - 1].message = renderUrl;

    // 5. Save renderUrl to deck.json
    writeDeckMeta(slug, { ...meta, renderUrl });
    try {
      git(`add decks/${slug}/deck.json`);
      git(`commit -m "Save Render URL for ${slug}"`);
      git('push origin main');
    } catch { /* ignore if nothing to commit */ }

    res.json({
      success: true,
      steps,
      renderUrl,
      dashboardUrl: service.dashboardUrl || null
    });
  } catch (err) {
    if (steps.length) steps[steps.length - 1].status = 'error';
    res.status(500).json({ error: err.message, steps });
  }
});

app.get('/api/config', (req, res) => {
  const c = readConfig();
  const mask = (v) => v ? v.slice(0, 4) + '...' + v.slice(-4) : '';
  res.json({
    googleClientId: c.GOOGLE_CLIENT_ID ? mask(c.GOOGLE_CLIENT_ID) : '',
    hasGoogleSecret: !!c.GOOGLE_CLIENT_SECRET,
    adminEmails: c.ADMIN_EMAILS || '',
    hasRenderApiKey: !!c.RENDER_API_KEY,
    hasAuthSecret: !!c.AUTH_SECRET,
    authServiceUrl: AUTH_SERVICE_URL
  });
});

app.put('/api/config', (req, res) => {
  const { googleClientId, googleClientSecret, adminEmails, renderApiKey, authSecret } = req.body;
  const updates = {};
  if (googleClientId) updates.GOOGLE_CLIENT_ID = googleClientId.trim();
  if (googleClientSecret) updates.GOOGLE_CLIENT_SECRET = googleClientSecret.trim();
  if (adminEmails) updates.ADMIN_EMAILS = adminEmails.trim();
  if (renderApiKey) updates.RENDER_API_KEY = renderApiKey.trim();
  if (authSecret) updates.AUTH_SECRET = authSecret.trim();
  writeConfig(updates);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Deck Manager running on http://localhost:${PORT}`);
});
