const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// HTTP helper for auth service calls
function authRequest(baseUrl, method, urlPath, body) {
  const secret = process.env.AUTH_SECRET;
  const parsed = new URL(urlPath, baseUrl);
  const transport = parsed.protocol === 'https:' ? https : http;
  const data = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = transport.request({
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Authorization': `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(chunks)); }
          catch { resolve(chunks); }
        } else {
          reject(new Error(`Auth service ${res.statusCode}: ${chunks}`));
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createAuth(deckDir, opts) {
  const { authServiceUrl, deckSlug } = opts || {};
  const remote = !!authServiceUrl;

  // --- Remote mode: HTTP calls to auth service ---
  if (remote) {
    async function readUsers() {
      return authRequest(authServiceUrl, 'GET', `/api/${deckSlug}/users`);
    }

    async function writeUsers(data) {
      return authRequest(authServiceUrl, 'PUT', `/api/${deckSlug}/users`, { users: data.users });
    }

    async function isWhitelisted(email) {
      const result = await authRequest(authServiceUrl, 'GET', `/api/${deckSlug}/check/${encodeURIComponent(email.toLowerCase())}`);
      return result.allowed;
    }

    function isAdmin(email) {
      return ADMIN_EMAILS.includes(email.toLowerCase());
    }

    async function requireAuth(req, res, next) {
      if (!req.isAuthenticated()) return res.redirect('/login');
      const email = req.user.email;
      if (isAdmin(email)) return next();
      try {
        const allowed = await isWhitelisted(email);
        if (allowed) return next();
      } catch (err) {
        console.error('Auth service check failed:', err.message);
      }
      return res.redirect('/denied');
    }

    function requireAdmin(req, res, next) {
      if (!req.isAuthenticated()) return res.redirect('/login');
      if (!isAdmin(req.user.email)) return res.status(403).send('Forbidden');
      next();
    }

    return { requireAuth, requireAdmin, readUsers, writeUsers, isAdmin, ADMIN_EMAILS };
  }

  // --- Local mode: file-based (unchanged) ---
  const DATA_DIR = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, path.basename(deckDir))
    : path.join(deckDir, 'data');
  const USERS_FILE = path.join(DATA_DIR, 'users.json');
  const SEED_FILE = path.join(deckDir, 'data', 'users.seed.json');

  function readUsers() {
    try {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
      const data = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
      return data;
    }
  }

  function writeUsers(data) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
  }

  function isWhitelisted(email) {
    const data = readUsers();
    return data.users.includes(email.toLowerCase());
  }

  function isAdmin(email) {
    return ADMIN_EMAILS.includes(email.toLowerCase());
  }

  function requireAuth(req, res, next) {
    if (!req.isAuthenticated()) return res.redirect('/login');
    const email = req.user.email;
    if (!isWhitelisted(email) && !isAdmin(email)) return res.redirect('/denied');
    next();
  }

  function requireAdmin(req, res, next) {
    if (!req.isAuthenticated()) return res.redirect('/login');
    if (!isAdmin(req.user.email)) return res.status(403).send('Forbidden');
    next();
  }

  return { requireAuth, requireAdmin, readUsers, writeUsers, isAdmin, ADMIN_EMAILS };
}

module.exports = { createAuth };
