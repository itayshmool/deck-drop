require('dotenv').config();
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const path = require('path');
const FileStore = require('session-file-store')(session);
const { createAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const DECKS_DIR = path.join(__dirname, 'decks');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

// --- Deck discovery ---
function listDecks() {
  if (!fs.existsSync(DECKS_DIR)) return [];
  return fs.readdirSync(DECKS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(slug => fs.existsSync(path.join(DECKS_DIR, slug, 'deck.json')));
}

function readDeckMeta(slug) {
  return JSON.parse(fs.readFileSync(path.join(DECKS_DIR, slug, 'deck.json'), 'utf8'));
}

// --- View helper ---
function sendView(res, viewName, replacements) {
  let html = fs.readFileSync(path.join(__dirname, 'views', viewName), 'utf8');
  for (const [key, value] of Object.entries(replacements || {})) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  res.type('html').send(html);
}

// --- Passport setup ---
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

// --- Middleware ---
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  store: new FileStore({
    path: path.join(DATA_DIR, 'sessions'),
    ttl: 7 * 24 * 60 * 60,
    retries: 1,
    logFn: () => {}
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use(passport.initialize());
app.use(passport.session());

// --- Slug validation middleware ---
function resolveSlug(req, res, next) {
  const slug = req.params.slug;
  const deckDir = path.join(DECKS_DIR, slug);
  const metaFile = path.join(deckDir, 'deck.json');
  if (!fs.existsSync(metaFile)) return res.status(404).send('Deck not found');
  req.deckSlug = slug;
  req.deckDir = deckDir;
  req.deckMeta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  req.deckAuth = createAuth(DATA_DIR, slug);
  next();
}

// --- Global admin middleware ---
function requireGlobalAdmin(req, res, next) {
  if (!req.isAuthenticated()) return res.redirect('/admin/login');
  if (!ADMIN_EMAILS.includes((req.user.email || '').toLowerCase())) {
    return res.status(403).send('Your account is not authorized as an admin.');
  }
  next();
}

// =============================================
// FIXED ROUTES FIRST (before /:slug wildcards)
// =============================================

// --- Health check ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'deck-drop', decks: listDecks().length });
});

// --- Static assets ---
app.get('/favicon.svg', (req, res) => {
  const svgPath = path.join(__dirname, 'views', 'favicon.svg');
  if (fs.existsSync(svgPath)) res.type('image/svg+xml').send(fs.readFileSync(svgPath));
  else res.status(404).end();
});

// --- OAuth callback + failure ---
app.get('/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', (err, user, info) => {
    if (err) { console.error('OAuth error:', err); return res.redirect('/auth/failed'); }
    if (!user) { console.error('OAuth no user:', info); return res.redirect('/auth/failed'); }
    req.logIn(user, (loginErr) => {
      if (loginErr) { console.error('Login error:', loginErr); return res.redirect('/auth/failed'); }
      next();
    });
  })(req, res, next);
}, (req, res) => {
    const target = req.session.authTarget;
    console.log('OAuth callback — authTarget:', target, 'sessionID:', req.sessionID);
    delete req.session.authTarget;

    if (target === '__admin__') {
      const email = (req.user.email || '').toLowerCase();
      if (ADMIN_EMAILS.includes(email)) return res.redirect('/admin');
      return res.status(403).send('Your account is not authorized as an admin.');
    }

    if (!target) return res.redirect('/auth/failed');

    // Check deck whitelist
    const auth = createAuth(DATA_DIR, target);
    const email = (req.user.email || '').toLowerCase();
    if (auth.isAdmin(email) || auth.isWhitelisted(email)) {
      return res.redirect(`/${target}`);
    }
    return res.redirect(`/${target}/denied`);
  }
);

app.get('/auth/failed', (req, res) => {
  res.status(401).send('Authentication failed. Close this tab and try again.');
});

// --- Global admin routes ---
app.get('/admin/auth/google', (req, res, next) => {
  req.session.authTarget = '__admin__';
  req.session.save(() => {
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });
});

app.get('/admin/login', (req, res) => {
  if (req.isAuthenticated() && ADMIN_EMAILS.includes((req.user.email || '').toLowerCase())) {
    return res.redirect('/admin');
  }
  sendView(res, 'dashboard-login.html');
});

app.get('/admin', requireGlobalAdmin, (req, res) => {
  sendView(res, 'dashboard.html');
});

app.get('/admin/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy();
    res.redirect('/admin/login');
  });
});

app.get('/admin/api/me', requireGlobalAdmin, (req, res) => {
  res.json({ email: req.user.email, name: req.user.name, photo: req.user.photo });
});

app.get('/admin/api/decks', requireGlobalAdmin, (req, res) => {
  const decks = listDecks().map(slug => {
    const meta = readDeckMeta(slug);
    const auth = createAuth(DATA_DIR, slug);
    const data = auth.readUsers();
    return { slug, name: meta.name, userCount: data.users.length };
  });
  res.json({ decks });
});

app.get('/admin/api/decks/:slug', requireGlobalAdmin, (req, res) => {
  const auth = createAuth(DATA_DIR, req.params.slug);
  res.json(auth.readUsers());
});

app.post('/admin/api/decks/:slug', requireGlobalAdmin, (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
  const auth = createAuth(DATA_DIR, req.params.slug);
  const data = auth.readUsers();
  const added = [];
  for (const raw of emails) {
    const email = raw.trim().toLowerCase();
    if (email && !data.users.includes(email)) {
      data.users.push(email);
      added.push(email);
    }
  }
  auth.writeUsers(data);
  res.json({ added, total: data.users.length });
});

app.delete('/admin/api/decks/:slug/:email', requireGlobalAdmin, (req, res) => {
  const auth = createAuth(DATA_DIR, req.params.slug);
  const data = auth.readUsers();
  const email = req.params.email.toLowerCase();
  data.users = data.users.filter(e => e !== email);
  auth.writeUsers(data);
  res.json({ removed: email, total: data.users.length });
});

// --- Print-ready deck for PDF export ---
app.get('/admin/api/decks/:slug/print', requireGlobalAdmin, (req, res) => {
  const slug = req.params.slug;
  const htmlPath = path.join(DECKS_DIR, slug, 'public', 'index.html');
  if (!fs.existsSync(htmlPath)) return res.status(404).send('Deck not found');

  let html = fs.readFileSync(htmlPath, 'utf8');

  // Rewrite relative img src paths to absolute
  html = html.replace(/(<img[^>]+src=")(?!https?:\/\/|\/|data:)(.*?)(")/gi, `$1/${slug}/$2$3`);

  const printCSS = `<style>
    .deckdrop-print-mode .slide { display: flex !important; break-after: page; }
    .deckdrop-print-mode .nav, .deckdrop-print-mode .progress,
    .deckdrop-print-mode .slide-counter, .deckdrop-print-mode [class*="nav"] { display: none !important; }
    @media print {
      @page { size: landscape; margin: 0; }
      body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .slide { display: flex !important; break-after: page; page-break-after: always; }
    }
  </style>`;

  const printScript = `<script>
    document.body.classList.add('deckdrop-print-mode');
    setTimeout(() => window.print(), 600);
  </script>`;

  html = html.replace('</head>', printCSS + '</head>');
  html = html.replace('</body>', printScript + '</body>');

  res.type('html').send(html);
});

// --- User seed API (called by manager during deploy) ---
app.put('/api/:slug/seed', (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users)) return res.status(400).json({ error: 'users array required' });
  const auth = createAuth(DATA_DIR, req.params.slug);
  const existing = auth.readUsers();
  if (existing.users.length > 0) {
    return res.json({ seeded: false, message: 'Users already exist, skipping seed', count: existing.users.length });
  }
  const cleaned = users.map(e => e.trim().toLowerCase()).filter(Boolean);
  auth.writeUsers({ users: cleaned });
  res.json({ seeded: true, count: cleaned.length });
});

// =============================================
// PARAMETERIZED /:slug ROUTES (after fixed routes)
// =============================================

app.get('/:slug/auth/google', resolveSlug, (req, res, next) => {
  req.session.authTarget = req.deckSlug;
  req.session.save(() => {
    passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });
});

app.get('/:slug/login', resolveSlug, (req, res) => {
  if (req.isAuthenticated()) return res.redirect(`/${req.deckSlug}`);
  sendView(res, 'login.html', { DECK_NAME: req.deckMeta.name, SLUG: req.deckSlug });
});

app.get('/:slug/logout', (req, res) => {
  const slug = req.params.slug;
  req.logout(() => {
    req.session.destroy();
    res.redirect(`/${slug}/login`);
  });
});

app.get('/:slug/denied', resolveSlug, (req, res) => {
  sendView(res, 'denied.html', { DECK_NAME: req.deckMeta.name, SLUG: req.deckSlug });
});

app.get('/:slug/admin', resolveSlug, (req, res) => {
  req.deckAuth.requireAdmin(req, res, () => {
    sendView(res, 'admin.html', { DECK_NAME: req.deckMeta.name, SLUG: req.deckSlug });
  });
});

app.get('/:slug/api/users', resolveSlug, (req, res) => {
  req.deckAuth.requireAdmin(req, res, async () => {
    const data = req.deckAuth.readUsers();
    data.admins = ADMIN_EMAILS;
    res.json(data);
  });
});

app.post('/:slug/api/users', resolveSlug, (req, res) => {
  req.deckAuth.requireAdmin(req, res, () => {
    const { emails } = req.body;
    if (!emails || !Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
    const data = req.deckAuth.readUsers();
    const added = [];
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (email && !data.users.includes(email)) {
        data.users.push(email);
        added.push(email);
      }
    }
    req.deckAuth.writeUsers(data);
    res.json({ added, total: data.users.length });
  });
});

app.delete('/:slug/api/users/:email', resolveSlug, (req, res) => {
  req.deckAuth.requireAdmin(req, res, () => {
    const email = req.params.email.toLowerCase();
    if (ADMIN_EMAILS.includes(email)) return res.status(400).json({ error: 'Cannot remove admin' });
    const data = req.deckAuth.readUsers();
    data.users = data.users.filter(e => e !== email);
    req.deckAuth.writeUsers(data);
    res.json({ removed: email, total: data.users.length });
  });
});

app.get('/:slug/api/me', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ email: req.user.email, name: req.user.name, photo: req.user.photo });
});

// Serve deck HTML (protected)
app.get('/:slug', resolveSlug, (req, res) => {
  req.deckAuth.requireAuth(req, res, () => {
    res.sendFile(path.join(req.deckDir, 'public', 'index.html'));
  });
});

// Static assets from deck's public/ folder
app.use('/:slug', (req, res, next) => {
  const slug = req.params.slug;
  const deckPublic = path.join(DECKS_DIR, slug, 'public');
  if (!fs.existsSync(path.join(DECKS_DIR, slug, 'deck.json'))) return next();
  express.static(deckPublic, { index: false })(req, res, next);
});

// --- Start ---
app.listen(PORT, () => {
  const decks = listDecks();
  console.log(`DeckDrop running on http://localhost:${PORT}`);
  console.log(`Serving ${decks.length} decks: ${decks.join(', ')}`);
});
