'use strict';

const crypto = require('crypto');
const config = require('./config');

// Logged-in session tokens live in memory: a server restart just means logging in again.
const sessions = new Set();

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

function isLoggedIn(req) {
  const token = parseCookies(req).session;
  return Boolean(token && sessions.has(token));
}

/** Protects a route: redirects browsers to /login when not authenticated. */
function requireLogin(req, res, next) {
  if (isLoggedIn(req)) return next();
  res.redirect('/login');
}

/** For API-style routes: a valid ?token= works too, so curl commands keep working. */
function tokenOrLogin(req, res, next) {
  if (config.TEST_TOKEN && req.query.token === config.TEST_TOKEN) return next();
  if (isLoggedIn(req)) return next();
  res.status(401).json({ error: 'login at /login or pass ?token=' });
}

function loginPage(error) {
  return `<html><body style="font-family:sans-serif;display:flex;justify-content:center;margin-top:10vh">
    <form method="POST" action="/login" style="display:flex;flex-direction:column;gap:10px;width:260px">
      <h2 style="margin:0">Leave-Bot 🚂</h2>
      ${error ? `<p style="color:#c00;margin:0">${error}</p>` : ''}
      <input name="username" placeholder="Username" autofocus required>
      <input name="password" type="password" placeholder="Password" required>
      <button type="submit">Login</button>
    </form>
  </body></html>`;
}

function register(app) {
  app.get('/login', (req, res) => {
    if (isLoggedIn(req)) return res.redirect('/status');
    res.send(loginPage());
  });

  app.post('/login', (req, res) => {
    const user = config.ADMIN_USER;
    const pass = config.ADMIN_PASS;
    const { username, password } = req.body || {};
    const ok =
      username === user &&
      typeof password === 'string' &&
      password.length === pass.length &&
      crypto.timingSafeEqual(Buffer.from(password), Buffer.from(pass));
    if (!ok) return res.status(401).send(loginPage('Invalid username or password'));
    const token = crypto.randomBytes(32).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `session=${token}; HttpOnly; SameSite=Lax; Path=/`);
    res.redirect('/status');
  });

  app.get('/logout', (req, res) => {
    sessions.delete(parseCookies(req).session);
    res.setHeader('Set-Cookie', 'session=; Max-Age=0; Path=/');
    res.redirect('/login');
  });
}

module.exports = { register, requireLogin, tokenOrLogin };
