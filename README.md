# 4 Barres

Le clash en impro : une instru, quatre phrases chacun, le dernier mot de chaque phrase est imposé, et le public vote.

En ligne : https://4-barres.romainfalanga83.workers.dev

## Structure

- `public/index.html` : toute l'interface (jeu, comptes, profil, classement, dictionnaire de rimes).
- `public/beats/` : les instrus (MP3).
- `src/worker.js` : Worker Cloudflare. Expose l'API `/api/*` (inscription, connexion, résultats, classement) ; la page et les instrus sont servies comme fichiers statiques.
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

## Déploiement

Chaque push sur `main` est déployé automatiquement sur Cloudflare (Workers Builds).

## Instrus

Les instrus de `public/beats/` sont sous licence CC0 (domaine public), récupérées sur OpenGameArt :

| Fichier | Titre | Auteur | Tempo | Source |
| --- | --- | --- | --- | --- |
| `tension.mp3` | Tension In The Air | HoliznaCC0 | 90 BPM | https://opengameart.org/content/horror-beats-collection |
| `abducted.mp3` | Abducted | HoliznaCC0 | 95 BPM | idem |
| `shadow.mp3` | Shadow Self | HoliznaCC0 | 95 BPM | idem |
| `cobwebs.mp3` | CobWebs | HoliznaCC0 | 90 BPM | idem |
| `mystery.mp3` | Mystery Go Brrrr | Fupi | 80 BPM | https://opengameart.org/content/mystery-go-brrrr |

Chaque fichier est découpé pour commencer exactement 2 mesures avant le couplet (le décompte), sur un premier temps.
Pour ajouter une instru : la découper de la même façon, la poser dans `public/beats/` et ajouter une ligne dans `BEATS` (`public/index.html`) avec son tempo exact et le nombre de mesures disponibles (`max`).
