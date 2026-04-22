// Shared OAuth proxy for all online-decks instances.
// Handles Google OAuth and redirects back to the originating deck with a signed token.
// Deploy as a single Render service: online-decks-auth
require('dotenv').config();
const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;
const AUTH_SECRET = process.env.AUTH_SECRET;

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
  saveUninitialized: true,
  cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 10 * 60 * 1000 }
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
app.get('/auth/google', (req, res, next) => {
  const origin = req.query.origin;
  if (!origin || !isAllowedOrigin(origin)) {
    return res.status(400).send('Missing or invalid origin parameter');
  }
  req.session.authOrigin = origin;
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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'online-decks-auth' });
});

app.listen(PORT, () => {
  console.log(`Auth proxy running on http://localhost:${PORT}`);
});
