const fs = require('fs');
const path = require('path');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function createAuth(deckDir) {
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
