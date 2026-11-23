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

## Jeu en ligne

Deux amis connectés peuvent se défier à distance. Il n'y a pas de serveur temps réel :

- l'hôte crée un défi (réglages + graine aléatoire) ; les deux appareils tirent les mêmes mots à partir de la graine ;
- quand les deux ont chargé l'instru, le serveur fixe une heure de départ commune, et chaque appareil corrige l'écart de son horloge ;
- le salon interroge le serveur toutes les 4 s tant qu'il est ouvert, l'attente du départ toutes les secondes, et il n'y a aucune requête pendant le clash ;
- chacun vote, le serveur tranche (désaccord = égalité) et enregistre le résultat pour les deux comptes.

La voix ne passe pas par le site : les joueurs s'appellent en parallèle.

## Instrus

Les instrus de `public/beats/` sont sous licence CC0 (domaine public), récupérées sur OpenGameArt :

| Fichier | Titre | Auteur | Tempo | Source |
| --- | --- | --- | --- | --- |
| `tension.mp3` | Tension In The Air | HoliznaCC0 | 90 BPM | https://opengameart.org/content/horror-beats-collection |
| `abducted.mp3` | Abducted | HoliznaCC0 | 95 BPM | idem |
| `shadow.mp3` | Shadow Self | HoliznaCC0 | 95 BPM | idem |
| `cobwebs.mp3` | CobWebs | HoliznaCC0 | 89,98 BPM | idem |
| `mystery.mp3` | Mystery Go Brrrr | Fupi | 80 BPM | https://opengameart.org/content/mystery-go-brrrr |

Chaque fichier commence exactement sur un premier temps, 2 mesures avant l'entrée de la batterie : le décompte se fait sur la fin de l'intro et le premier mot tombe sur la première mesure de batterie.
Pour ajouter une instru : la découper de la même façon, la poser dans `public/beats/` et ajouter une ligne dans `BEATS` (`public/index.html`) avec son tempo exact et le nombre de mesures disponibles (`max`), puis son identifiant dans `BEAT_IDS` (`src/worker.js`).
