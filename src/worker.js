// API de 4 Barres : comptes (pseudo + mot de passe), sessions par cookie, historique et classement.
const enc = new TextEncoder();
const DAY = 86400, SESSION_DAYS = 30;
const INVITE_TTL = 600;          // un défi sans réponse expire au bout de 10 minutes
const START_DELAY_MS = 6000;     // délai entre « les deux sont prêts » et le départ commun
const BEAT_IDS = ['tension', 'abducted', 'shadow', 'cobwebs', 'mystery', 'boombap', 'oldschool', 'trap', 'drill'];
function cleanCfg(c) {           // ne stocke que des réglages connus
  if (!c || typeof c !== 'object') return null;
  const bpm = Number(c.bpm), bars = Number(c.bars);
  if (![16, 32, 64].includes(bars) || !BEAT_IDS.includes(c.beat) || !(bpm >= 60 && bpm <= 130)) return null;
  if (!['AABB', 'ABAB', 'AAAA'].includes(c.scheme) || !['all', 'first', 'last', 'none'].includes(c.fill) || !['mix', 'vannes', 'quotidien'].includes(c.list)) return null;
  return { bars, beat: c.beat, bpm, scheme: c.scheme, fill: c.fill, list: c.list, angle: c.angle === '0' ? '0' : '1' };
}
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
  // Série : jours consécutifs avec au moins un clash (en cours si le dernier date d'aujourd'hui ou d'hier).
  const d = await env.DB.prepare("SELECT DISTINCT CAST(created_at / 86400 AS INTEGER) AS j FROM clashes WHERE user_id = ? ORDER BY j DESC LIMIT 400").bind(id).all();
  const days = d.results.map(r => r.j), today = Math.floor(now() / DAY);
  let serie = 0, record = 0, run = 0;
  days.forEach((j, i) => { run = i && days[i - 1] - j === 1 ? run + 1 : 1; record = Math.max(record, run); if (run === i + 1 && today - days[0] <= 1) serie = run; });
  return { stats: { ...s, serie, record }, history: h.results };
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
  /* ---------- Amis ---------- */
  const byPseudo = p => env.DB.prepare('SELECT id, pseudo FROM users WHERE pseudo_key = ?').bind(String(p || '').trim().toLowerCase()).first();
  if (path === '/api/online') {      // salon : amis, demandes et défis reçus, en un seul aller-retour
    const [fr, rq, st, inv] = await env.DB.batch([
      env.DB.prepare("SELECT u.pseudo FROM friends f JOIN users u ON u.id = CASE WHEN f.user_id = ?1 THEN f.friend_id ELSE f.user_id END WHERE (f.user_id = ?1 OR f.friend_id = ?1) AND f.status = 'ok' ORDER BY u.pseudo_key LIMIT 100").bind(user.id),
      env.DB.prepare("SELECT u.pseudo FROM friends f JOIN users u ON u.id = f.user_id WHERE f.friend_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 30").bind(user.id),
      env.DB.prepare("SELECT u.pseudo FROM friends f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? AND f.status = 'pending' ORDER BY f.created_at DESC LIMIT 30").bind(user.id),
      env.DB.prepare("SELECT m.id, m.cfg, u.pseudo AS host FROM matches m JOIN users u ON u.id = m.host_id WHERE m.guest_id = ? AND m.status = 'invited' AND m.created_at > ? ORDER BY m.id DESC LIMIT 5").bind(user.id, now() - INVITE_TTL)
    ]);
    return json({ now: Date.now(), friends: fr.results.map(r => r.pseudo), requests: rq.results.map(r => r.pseudo), sent: st.results.map(r => r.pseudo),
      invites: inv.results.map(r => ({ id: r.id, host: r.host, cfg: JSON.parse(r.cfg) })) });
  }
  if (path === '/api/friends' && post) {
    const f = await byPseudo(body.pseudo);
    if (!f) return fail(404, 'Aucun compte avec ce pseudo.');
    if (f.id === user.id) return fail(400, 'Tu ne peux pas t\'ajouter toi-même.');
    const rows = (await env.DB.prepare('SELECT user_id, status FROM friends WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)').bind(user.id, f.id).all()).results;
    if (rows.some(r => r.status === 'ok')) return json({ ok: true, state: 'ok', pseudo: f.pseudo });
    if (rows.some(r => r.user_id === f.id)) {      // l'autre avait déjà demandé : on accepte
      await env.DB.prepare("UPDATE friends SET status = 'ok' WHERE user_id = ? AND friend_id = ?").bind(f.id, user.id).run();
      return json({ ok: true, state: 'ok', pseudo: f.pseudo });
    }
    if (!rows.length) {
      const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM friends WHERE user_id = ?1 OR friend_id = ?1').bind(user.id).first();
      if (n.n >= 100) return fail(400, 'Liste d\'amis pleine (100).');
      await env.DB.prepare("INSERT OR IGNORE INTO friends (user_id, friend_id, status, created_at) VALUES (?, ?, 'pending', ?)").bind(user.id, f.id, now()).run();
    }
    return json({ ok: true, state: 'pending', pseudo: f.pseudo });
  }
  if (path === '/api/friends/remove' && post) {    // retire un ami, refuse ou annule une demande
    const f = await byPseudo(body.pseudo);
    if (f) await env.DB.prepare('DELETE FROM friends WHERE (user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)').bind(user.id, f.id).run();
    return json({ ok: true });
  }

  /* ---------- Défis en ligne ----------
     Le serveur ne fait que stocker le défi (réglages + graine) et fixer une heure de départ commune.
     Les mots sont tirés à l'identique sur les deux appareils à partir de la graine : aucune requête pendant le clash. */
  if (path === '/api/matches' && post) {
    const f = await byPseudo(body.friend), cfg = cleanCfg(body.cfg);
    if (!f || !cfg) return fail(400, 'Défi invalide.');
    const ok = await env.DB.prepare("SELECT 1 FROM friends WHERE ((user_id = ?1 AND friend_id = ?2) OR (user_id = ?2 AND friend_id = ?1)) AND status = 'ok'").bind(user.id, f.id).first();
    if (!ok) return fail(403, 'Vous devez être amis pour vous défier.');
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const [, ins] = await env.DB.batch([
      env.DB.prepare("UPDATE matches SET status = 'cancelled' WHERE host_id = ? AND status IN ('invited','accepted') AND start_at IS NULL").bind(user.id),
      env.DB.prepare("INSERT INTO matches (host_id, guest_id, cfg, seed, status, created_at) VALUES (?, ?, ?, ?, 'invited', ?) RETURNING id").bind(user.id, f.id, JSON.stringify(cfg), seed, now())
    ]);
    return json({ now: Date.now(), id: ins.results[0].id });
  }
  const mm = path.match(/^\/api\/matches\/(\d+)(?:\/(accept|cancel|ready|vote))?$/);
  if (mm) {
    const id = +mm[1], act = mm[2];
    const m = await env.DB.prepare('SELECT m.*, h.pseudo AS host, g.pseudo AS guest FROM matches m JOIN users h ON h.id = m.host_id JOIN users g ON g.id = m.guest_id WHERE m.id = ?').bind(id).first();
    if (!m || (m.host_id !== user.id && m.guest_id !== user.id)) return fail(404, 'Défi introuvable.');
    const isHost = m.host_id === user.id;
    if (act && !post) return fail(405, 'Méthode refusée.');
    if (act === 'accept') {
      if (isHost) return fail(403, 'Seul l\'invité peut accepter.');
      if (m.status === 'invited' && m.created_at > now() - INVITE_TTL) { await env.DB.prepare("UPDATE matches SET status = 'accepted' WHERE id = ? AND status = 'invited'").bind(id).run(); m.status = 'accepted'; }
      else if (m.status !== 'accepted') return fail(410, 'Ce défi n\'est plus disponible.');
    }
    if (act === 'cancel' && m.status !== 'done' && !m.start_at) { await env.DB.prepare("UPDATE matches SET status = 'cancelled' WHERE id = ? AND start_at IS NULL").bind(id).run(); m.status = 'cancelled'; }
    if (act === 'ready' && m.status !== 'cancelled') {
      const start = Date.now() + START_DELAY_MS;
      const r = await env.DB.batch([
        env.DB.prepare(`UPDATE matches SET ${isHost ? 'host_ready' : 'guest_ready'} = 1 WHERE id = ?`).bind(id),
        env.DB.prepare("UPDATE matches SET start_at = ? WHERE id = ? AND status = 'accepted' AND host_ready = 1 AND guest_ready = 1 AND start_at IS NULL RETURNING start_at").bind(start, id)
      ]);
      if (r[1].results.length) m.start_at = start;
    }
    if (act === 'vote') {
      const w = Number(body.w);
      if (![-1, 0, 1].includes(w) || !m.start_at || m.status === 'cancelled') return fail(400, 'Vote invalide.');
      if (m.status !== 'done') {
        await env.DB.prepare(`UPDATE matches SET ${isHost ? 'host_vote' : 'guest_vote'} = ? WHERE id = ? AND status != 'done'`).bind(w, id).run();
        if (isHost) m.host_vote = w; else m.guest_vote = w;
        if (m.host_vote !== null && m.guest_vote !== null) {       // les deux ont voté : désaccord = égalité
          const done = await env.DB.prepare("UPDATE matches SET status = 'done' WHERE id = ? AND status != 'done' RETURNING id").bind(id).first();
          if (done) {
            const win = m.host_vote === m.guest_vote ? m.host_vote : -1, sc = win === 0 ? [1, 0] : win === 1 ? [0, 1] : [1, 1], res = a => a[0] > a[1] ? 'V' : a[0] < a[1] ? 'D' : 'N';
            const ins = 'INSERT INTO clashes (user_id, opponent, my_score, their_score, result, created_at) VALUES (?, ?, ?, ?, ?, ?)';
            await env.DB.batch([env.DB.prepare(ins).bind(m.host_id, m.guest, sc[0], sc[1], res(sc), now()), env.DB.prepare(ins).bind(m.guest_id, m.host, sc[1], sc[0], res([sc[1], sc[0]]), now())]);
          }
          m.status = 'done';
        }
      }
    }
    const both = m.host_vote !== null && m.guest_vote !== null;
    return json({ now: Date.now(), id, status: m.status, start_at: m.start_at, cfg: JSON.parse(m.cfg), seed: m.seed, host: m.host, guest: m.guest, role: isHost ? 0 : 1,
      voted: [m.host_vote !== null, m.guest_vote !== null], result: both ? (m.host_vote === m.guest_vote ? m.host_vote : -1) : null, agreed: both ? m.host_vote === m.guest_vote : null });
  }
  return fail(404, 'Route inconnue.');
}

export default {
  async fetch(req, env) {
    const { pathname } = new URL(req.url);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(req);   // page et instrus : fichiers statiques de public/
    try { return await api(req, env, pathname); }
    catch (e) { console.error(e); return fail(500, 'Erreur serveur, réessaie dans un instant.'); }
  }
};
