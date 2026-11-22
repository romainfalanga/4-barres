# 4 Barres

Le clash en impro : une instru, quatre phrases chacun, le dernier mot de chaque phrase est imposé, et le public vote.

En ligne : https://4-barres.romainfalanga83.workers.dev

## Structure

- `public/index.html` : toute l'interface (jeu, instru synthétisée, comptes, profil, classement).
- `src/worker.js` : Worker Cloudflare. Sert la page et expose l'API `/api/*` (inscription, connexion, résultats, classement).
- `schema.sql` : tables de la base D1 (`users`, `sessions`, `clashes`).
- `wrangler.jsonc` : configuration du déploiement.

## Commandes

```bash
npm install
```

```bash
npm run db:init:local
```

```bash
npm run dev
```

```bash
npm run deploy
```

## Comptes

Pseudo + mot de passe, sans e-mail. Les mots de passe sont hachés (PBKDF2-SHA256, sel par utilisateur) et la session tient dans un cookie `HttpOnly`.
