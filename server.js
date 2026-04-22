require('dotenv').config();
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const crypto = require('crypto');
const path = require('path');

// --- Deck resolution ---
const DECK_NAME = process.env.DECK_NAME;
if (!DECK_NAME) {
  console.error('FATAL: DECK_NAME env var is required. Set it to a folder name under decks/');
  process.exit(1);
}

const DECK_DIR = path.join(__dirname, 'decks', DECK_NAME);
const deckMeta = JSON.parse(fs.readFileSync(path.join(DECK_DIR, 'deck.json'), 'utf8'));

const { createAuth } = require('./middleware/auth');
const { requireAuth, requireAdmin, readUsers, writeUsers, isAdmin, ADMIN_EMAILS } = createAuth(DECK_DIR, {
  authServiceUrl: process.env.AUTH_SERVICE_URL,
  deckSlug: DECK_NAME
});

const app = express();
const PORT = process.env.PORT || 3000;
const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL; // shared auth proxy
const AUTH_SECRET = process.env.AUTH_SECRET;

// Verify a signed token from the auth proxy
function verifyToken(tokenStr) {
  if (!AUTH_SECRET) return null;
  try {
    const { data, sig } = JSON.parse(Buffer.from(tokenStr, 'base64url').toString());
    const expected = crypto.createHmac('sha256', AUTH_SECRET).update(data).digest('hex');
    if (sig !== expected) return null;
    const payload = JSON.parse(data);
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Trust Render's reverse proxy (required for secure cookies)
app.set('trust proxy', 1);

// --- View helper ---
function sendView(res, viewName) {
  let html = fs.readFileSync(path.join(__dirname, 'views', viewName), 'utf8');
  html = html.replace(/\{\{DECK_NAME\}\}/g, deckMeta.name);
  res.type('html').send(html);
}

// --- Passport setup ---
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// Only configure Google Strategy for local dev (when no shared auth proxy)
if (!AUTH_SERVICE_URL) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL || `http://localhost:${PORT}/auth/google/callback`
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails && profile.emails[0] && profile.emails[0].value;
    done(null, {
      id: profile.id,
      email: email,
      name: profile.displayName,
      photo: profile.photos && profile.photos[0] && profile.photos[0].value
    });
  }));
}

// --- Middleware ---
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));
app.use(passport.initialize());
app.use(passport.session());

// --- Auth routes ---
app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/');
  sendView(res, 'login.html');
});

if (AUTH_SERVICE_URL) {
  // Shared auth proxy mode: redirect to the proxy with our origin
  app.get('/auth/google', (req, res) => {
    const origin = `${req.protocol}://${req.get('host')}`;
    const authUrl = new URL('/auth/google', AUTH_SERVICE_URL);
    authUrl.searchParams.set('origin', origin);
    res.redirect(authUrl.toString());
  });

  // Receive signed token back from auth proxy
  app.get('/auth/verify', (req, res) => {
    const { token } = req.query;
    if (!token) return res.redirect('/login');
    const user = verifyToken(token);
    if (!user) return res.redirect('/login');

    // Create session (same shape as Passport user)
    req.login({ email: user.email, name: user.name, photo: user.photo }, async (err) => {
      if (err) return res.redirect('/login');
      const email = user.email;
      if (isAdmin(email)) return res.redirect('/');
      try {
        const data = await readUsers();
        if (data.users.includes(email.toLowerCase())) {
          return res.redirect('/');
        }
      } catch (e) {
        console.error('Failed to check user whitelist:', e.message);
      }
      return res.redirect('/denied');
    });
  });
} else {
  // Local dev mode: direct Google OAuth
  app.get('/auth/google', passport.authenticate('google', {
    scope: ['profile', 'email']
  }));

  app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    async (req, res) => {
      const email = req.user.email;
      if (isAdmin(email)) return res.redirect('/');
      try {
        const data = await readUsers();
        if (data.users.includes(email.toLowerCase())) {
          return res.redirect('/');
        }
      } catch (e) {
        console.error('Failed to check user whitelist:', e.message);
      }
      return res.redirect('/denied');
    }
  );
}

app.get('/logout', (req, res) => {
  req.logout(() => {
    req.session.destroy();
    res.redirect('/login');
  });
});

app.get('/denied', (req, res) => {
  sendView(res, 'denied.html');
});

// --- Deck (protected) ---
app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(DECK_DIR, 'public', 'index.html'));
});

// Static assets from deck's public/ folder (images, etc.) — index: false so / stays auth-protected
app.use(express.static(path.join(DECK_DIR, 'public'), { index: false }));

// --- Admin routes ---
app.get('/admin', requireAdmin, (req, res) => {
  sendView(res, 'admin.html');
});

app.get('/api/users', requireAdmin, async (req, res) => {
  try {
    const data = await readUsers();
    data.admins = ADMIN_EMAILS;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: 'Failed to read users: ' + e.message });
  }
});

app.post('/api/users', requireAdmin, async (req, res) => {
  const { emails } = req.body;
  if (!emails || !Array.isArray(emails)) {
    return res.status(400).json({ error: 'emails array required' });
  }
  try {
    const data = await readUsers();
    const added = [];
    for (const raw of emails) {
      const email = raw.trim().toLowerCase();
      if (email && !data.users.includes(email)) {
        data.users.push(email);
        added.push(email);
      }
    }
    await writeUsers(data);
    res.json({ added, total: data.users.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to update users: ' + e.message });
  }
});

app.delete('/api/users/:email', requireAdmin, async (req, res) => {
  const email = req.params.email.toLowerCase();
  if (ADMIN_EMAILS.includes(email)) {
    return res.status(400).json({ error: 'Cannot remove admin' });
  }
  try {
    const data = await readUsers();
    data.users = data.users.filter(e => e !== email);
    await writeUsers(data);
    res.json({ removed: email, total: data.users.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to remove user: ' + e.message });
  }
});

app.get('/api/me', (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ email: req.user.email, name: req.user.name, photo: req.user.photo });
});

// --- Start ---
app.listen(PORT, () => {
  console.log(`${deckMeta.name} deck running on http://localhost:${PORT}`);
});
