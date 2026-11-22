import page from '../public/index.html';

// API de 4 Barres : comptes (pseudo + mot de passe), sessions par cookie, historique et classement.
const enc = new TextEncoder();
const DAY = 86400, SESSION_DAYS = 30;
const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (status, error) => json({ error }, status);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = s => new Uint8Array(s.match(/../g).map(h => parseInt(h, 16)));
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const now = () => Math.floor(Date.now() / 1000);

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256));
}
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const cookie = (token, maxAge) => `s=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const readToken = req => (req.headers.get('cookie') || '').match(/(?:^|;\s*)s=([0-9a-f]{64})/)?.[1];

async function currentUser(req, env) {
  const token = readToken(req); if (!token) return null;
  return env.DB.prepare('SELECT u.id, u.pseudo FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha(token), now()).first();
}
async function openSession(env, user) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha(token), user.id, now() + SESSION_DAYS * DAY).run();
  return json({ user: { pseudo: user.pseudo } }, 200, { 'set-cookie': cookie(token, SESSION_DAYS * DAY) });
}
async function stats(env, id) {
  const s = await env.DB.prepare("SELECT COUNT(*) AS clashs, COALESCE(SUM(result='V'),0) AS victoires, COALESCE(SUM(result='D'),0) AS defaites, COALESCE(SUM(result='N'),0) AS nuls FROM clashes WHERE user_id = ?").bind(id).first();
  const h = await env.DB.prepare('SELECT opponent, my_score, their_score, result, created_at FROM clashes WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 20').bind(id).all();
  return { stats: s, history: h.results };
}

async function api(req, env, path) {
  const post = req.method === 'POST';
  let body = {};
  if (post) {
    // Protection CSRF : même origine et JSON uniquement.
    if (req.headers.get('origin') !== new URL(req.url).origin) return fail(403, 'Origine refusée.');
    if (!(req.headers.get('content-type') || '').includes('application/json')) return fail(415, 'JSON attendu.');
    try { body = await req.json(); } catch { return fail(400, 'Requête illisible.'); }
  } else if (req.method !== 'GET') return fail(405, 'Méthode refusée.');

  if (path === '/api/signup' && post) {
    const pseudo = String(body.pseudo || '').trim(), password = String(body.password || '');
    if (!/^[\p{L}\p{N}_-]{3,14}$/u.test(pseudo)) return fail(400, 'Pseudo : 3 à 14 caractères, lettres, chiffres, tiret ou underscore.');
    if (password.length < 8 || password.length > 200) return fail(400, 'Mot de passe : 8 caractères minimum.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt);
    let row;
    try {
      row = await env.DB.prepare('INSERT INTO users (pseudo, pseudo_key, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id, pseudo')
        .bind(pseudo, pseudo.toLowerCase(), hash, hex(salt), now()).first();
    } catch (e) {
      if (String(e).includes('UNIQUE')) return fail(409, 'Ce pseudo est déjà pris.');
      throw e;
    }
    return openSession(env, row);
  }
  if (path === '/api/login' && post) {
    const pseudo = String(body.pseudo || '').trim().toLowerCase(), password = String(body.password || '').slice(0, 200);
    const u = await env.DB.prepare('SELECT id, pseudo, pass_hash, salt FROM users WHERE pseudo_key = ?').bind(pseudo).first();
    const hash = await hashPassword(password, unhex(u ? u.salt : '00000000000000000000000000000000'));
    if (!u || !sameString(hash, u.pass_hash)) return fail(401, 'Pseudo ou mot de passe incorrect.');
    return openSession(env, u);
  }
  if (path === '/api/logout' && post) {
    const token = readToken(req);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': cookie('', 0) });
  }
  if (path === '/api/leaderboard') {
    const r = await env.DB.prepare("SELECT u.pseudo, COUNT(*) AS clashs, SUM(c.result='V') AS victoires FROM clashes c JOIN users u ON u.id = c.user_id GROUP BY u.id ORDER BY victoires DESC, clashs ASC, u.pseudo ASC LIMIT 20").all();
    return json({ leaderboard: r.results });
  }

  const user = await currentUser(req, env);
  if (path === '/api/me') return json(user ? { user: { pseudo: user.pseudo }, ...(await stats(env, user.id)) } : { user: null });
  if (!user) return fail(401, 'Connecte-toi d\'abord.');
  if (path === '/api/clashes' && post) {
    const opponent = String(body.opponent || '').trim().slice(0, 14) || 'Joueur 2';
    const mine = Number(body.myScore), theirs = Number(body.theirScore);
    if (![mine, theirs].every(n => Number.isInteger(n) && n >= 0 && n <= 20)) return fail(400, 'Score invalide.');
    await env.DB.prepare('INSERT INTO clashes (user_id, opponent, my_score, their_score, result, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.id, opponent, mine, theirs, mine > theirs ? 'V' : mine < theirs ? 'D' : 'N', now()).run();
    return json({ ok: true, ...(await stats(env, user.id)) });
  }
  return fail(404, 'Route inconnue.');
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith('/api/')) {
      if (pathname !== '/' && pathname !== '/index.html') return new Response('Page introuvable', { status: 404 });
      return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache',
        'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' } });
    }
    try { return await api(req, env, pathname); }
    catch (e) { console.error(e); return fail(500, 'Erreur serveur, réessaie dans un instant.'); }
  }
};
