const fs = require('fs');
const path = require('path');

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function createAuth(dataDir, slug) {
  const slugDir = path.join(dataDir, slug);
  const USERS_FILE = path.join(slugDir, 'users.json');

  function readUsers() {
    try {
      return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch {
      return { users: [] };
    }
  }

  function writeUsers(data) {
    fs.mkdirSync(slugDir, { recursive: true });
    fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2) + '\n');
  }

  function isWhitelisted(email) {
    const data = readUsers();
    return data.users.includes(email.toLowerCase());
  }

  function isAdmin(email) {
    return ADMIN_EMAILS.includes(email.toLowerCase());
  }

  function requireAuth(req, res, next) {
    if (!req.isAuthenticated()) return res.redirect(`/${slug}/login`);
    const email = req.user.email;
    if (isAdmin(email) || isWhitelisted(email)) return next();
    return res.redirect(`/${slug}/denied`);
  }

  function requireAdmin(req, res, next) {
    if (!req.isAuthenticated()) return res.redirect(`/${slug}/login`);
    if (!isAdmin(req.user.email)) return res.status(403).send('Forbidden');
    next();
  }

  return { requireAuth, requireAdmin, readUsers, writeUsers, isAdmin, isWhitelisted, ADMIN_EMAILS };
}

module.exports = { createAuth };
