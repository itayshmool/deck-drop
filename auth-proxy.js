// Shared OAuth proxy + user management for all online-decks instances.
// Handles Google OAuth, stores per-deck user whitelists on a single disk.
// Deploy as a single Render service: online-decks-auth
require('dotenv').config();
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const AUTH_SECRET = process.env.AUTH_SECRET;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

if (!AUTH_SECRET) {
  console.error('FATAL: AUTH_SECRET env var is required.');
  process.exit(1);
}

// Only allow redirects back to our own Render services
function isAllowedOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith('.onrender.com') || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

// Sign a token with HMAC-SHA256
function signToken(payload) {
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
}

app.set('trust proxy', 1);

// Minimal session just to hold OAuth state
app.use(session({
  secret: AUTH_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 24 * 60 * 60 * 1000 }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

const CALLBACK_URL = process.env.CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`;

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
  const email = profile.emails && profile.emails[0] && profile.emails[0].value;
  done(null, {
    email,
    name: profile.displayName,
    photo: profile.photos && profile.photos[0] && profile.photos[0].value
  });
}));

app.use(passport.initialize());
app.use(passport.session());

// Step 1: Deck redirects here with ?origin=https://online-decks-{slug}.onrender.com
// Admin dashboard uses ?origin=__admin__ to redirect back to /admin after login
app.get('/auth/google', (req, res, next) => {
  const origin = req.query.origin;
  if (origin === '__admin__') {
    req.session.authOrigin = '__admin__';
  } else if (!origin || !isAllowedOrigin(origin)) {
    return res.status(400).send('Missing or invalid origin parameter');
  } else {
    req.session.authOrigin = origin;
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state: origin
  })(req, res, next);
});

// Step 2: Google redirects here after auth
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/auth/failed' }),
  (req, res) => {
    const origin = req.session.authOrigin || req.query.state;

    // Admin dashboard login flow
    if (origin === '__admin__') {
      delete req.session.authOrigin;
      const email = (req.user.email || '').toLowerCase();
      if (ADMIN_EMAILS.includes(email)) {
        return res.redirect('/admin');
      }
      return res.status(403).send('Your account is not authorized as an admin.');
    }

    if (!origin || !isAllowedOrigin(origin)) {
      return res.status(400).send('Invalid auth origin');
    }

    const token = signToken({
      email: req.user.email,
      name: req.user.name,
      photo: req.user.photo,
      exp: Date.now() + 5 * 60 * 1000 // 5 minutes
    });

    // Clean up session
    delete req.session.authOrigin;

    // Redirect back to the originating deck
    const redirectUrl = new URL('/auth/verify', origin);
    redirectUrl.searchParams.set('token', token);
    res.redirect(redirectUrl.toString());
  }
);

app.get('/auth/failed', (req, res) => {
  res.status(401).send('Authentication failed. Close this tab and try again.');
});

// --- User management API (protected by AUTH_SECRET) ---
app.use(express.json());

function requireApiKey(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token !== AUTH_SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function usersPath(slug) {
  return path.join(DATA_DIR, slug, 'users.json');
}

function readDeckUsers(slug) {
  try {
    return JSON.parse(fs.readFileSync(usersPath(slug), 'utf8'));
  } catch {
    return { users: [] };
  }
}

function writeDeckUsers(slug, data) {
  const dir = path.join(DATA_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(usersPath(slug), JSON.stringify(data, null, 2) + '\n');
}

// Check if email is whitelisted for a deck
app.get('/api/:slug/check/:email', requireApiKey, (req, res) => {
  const data = readDeckUsers(req.params.slug);
  const allowed = data.users.includes(req.params.email.toLowerCase());
  res.json({ allowed });
});

// List users for a deck
app.get('/api/:slug/users', requireApiKey, (req, res) => {
  res.json(readDeckUsers(req.params.slug));
});

// Add users to a deck
app.post('/api/:slug/users', requireApiKey, (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
  const data = readDeckUsers(req.params.slug);
  const added = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (email && !data.users.includes(email)) {
      data.users.push(email);
      added.push(email);
    }
  }
  writeDeckUsers(req.params.slug, data);
  res.json({ added, total: data.users.length });
});

// Remove a user from a deck
app.delete('/api/:slug/users/:email', requireApiKey, (req, res) => {
  const data = readDeckUsers(req.params.slug);
  const email = req.params.email.toLowerCase();
  data.users = data.users.filter(e => e !== email);
  writeDeckUsers(req.params.slug, data);
  res.json({ removed: email, total: data.users.length });
});

// Replace all users for a deck (full overwrite)
app.put('/api/:slug/users', requireApiKey, (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'users array required' });
  const cleaned = users.map(e => e.trim().toLowerCase()).filter(Boolean);
  writeDeckUsers(req.params.slug, { users: cleaned });
  res.json({ replaced: true, count: cleaned.length });
});

// Seed users (only writes if no users exist yet)
app.put('/api/:slug/seed', requireApiKey, (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'users array required' });
  const existing = readDeckUsers(req.params.slug);
  if (existing.users.length > 0) {
    return res.json({ seeded: false, message: 'Users already exist, skipping seed', count: existing.users.length });
  }
  const cleaned = users.map(e => e.trim().toLowerCase()).filter(Boolean);
  writeDeckUsers(req.params.slug, { users: cleaned });
  res.json({ seeded: true, count: cleaned.length });
});

// --- Admin dashboard (session-based auth) ---

function sendView(res, viewName) {
  const html = fs.readFileSync(path.join(__dirname, 'views', viewName), 'utf8');
  res.type('html').send(html);
}

function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/admin/login');
  if (!ADMIN_EMAILS.includes((req.user.email || '').toLowerCase())) {
    return res.status(403).send('Your account is not authorized as an admin.');
  }
  next();
}

app.get('/admin/login', (req, res) => {
  if (req.isAuthenticated() && ADMIN_EMAILS.includes((req.user.email || '').toLowerCase())) {
    return res.redirect('/admin');
  }
  sendView(res, 'dashboard-login.html');
});

app.get('/admin', requireAdmin, (req, res) => {
  sendView(res, 'dashboard.html');
});

app.get('/admin/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy();
    res.redirect('/admin/login');
  });
});

app.get('/admin/api/me', requireAdmin, (req, res) => {
  res.json({ email: req.user.email, name: req.user.name, photo: req.user.photo });
});

app.get('/admin/api/decks', requireAdmin, (req, res) => {
  try {
    const entries = fs.readdirSync(DATA_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .filter(slug => fs.existsSync(path.join(DATA_DIR, slug, 'users.json')));
    const decks = entries.map(slug => {
      const data = readDeckUsers(slug);
      return { slug, userCount: data.users.length };
    });
    res.json({ decks });
  } catch {
    res.json({ decks: [] });
  }
});

app.get('/admin/api/decks/:slug', requireAdmin, (req, res) => {
  res.json(readDeckUsers(req.params.slug));
});

app.post('/admin/api/decks/:slug', requireAdmin, (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
  const data = readDeckUsers(req.params.slug);
  const added = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (email && !data.users.includes(email)) {
      data.users.push(email);
      added.push(email);
    }
  }
  writeDeckUsers(req.params.slug, data);
  res.json({ added, total: data.users.length });
});

app.delete('/admin/api/decks/:slug/:email', requireAdmin, (req, res) => {
  const data = readDeckUsers(req.params.slug);
  const email = req.params.email.toLowerCase();
  data.users = data.users.filter(e => e !== email);
  writeDeckUsers(req.params.slug, data);
  res.json({ removed: email, total: data.users.length });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'online-decks-auth' });
});

app.listen(PORT, () => {
  console.log(`Auth proxy running on http://localhost:${PORT}`);
});
