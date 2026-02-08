# Concours Dev Web RSS

Une application Next.js qui agrège les annonces de concours du secteur public liées au développement web et à l'informatique depuis [wadifa-info.com](https://www.wadifa-info.com). Elle filtre les annonces par mots-clés configurables, sert les résultats sous forme de flux RSS, les affiche sur un tableau de bord web, et notifie optionnellement les abonnés par email lorsque de nouveaux concours sont trouvés.

## Fonctionnalités

- **Web scraping** -- Pagination des pages de liste de wadifa-info.com et scraping des pages de détail avec Cheerio
- **Filtrage par mots-clés** -- Correspond aux concours selon des mots-clés d'inclusion/exclusion configurables (pas d'IA, correspondance de texte pure)
- **Flux RSS** -- Sert un flux RSS 2.0 valide à `/feed.xml` avec mise en cache edge
- **Tableau de bord web** -- Affiche les concours correspondants avec détails dépliables, échéances et liens sources
- **Abonnements email** -- Les abonnés reçoivent des emails récapitulatifs lorsque de nouveaux concours correspondants sont trouvés (via Brevo)
- **Historique persistant** -- Les résultats scrapés sont stockés dans Vercel KV (Redis) et survivent aux déploiements
- **Rafraîchissement déclenché par cron** -- Les planificateurs externes peuvent déclencher le scraping et les notifications email via un endpoint API sécurisé
- **Désabonnement sécurisé** -- Liens de désabonnement en un clic signés HMAC-SHA256 dans chaque email

## Stack Technique

| Couche | Technologie |
|---|---|
| Framework | [Next.js](https://nextjs.org) 16 (App Router) |
| Langage | TypeScript 5.9 |
| UI | React 19, CSS Modules |
| Scraping | [Cheerio](https://cheerio.js.org) |
| Validation | [Zod](https://zod.dev) 4 |
| Email | [Brevo](https://www.brevo.com) (API SMTP transactionnelle) |
| Stockage | [@vercel/kv](https://vercel.com/docs/storage/vercel-kv) (Redis) |
| Polices | [Geist](https://vercel.com/font) (woff2 auto-hébergé) |

## Démarrage

### Prérequis

- [Bun](https://bun.sh) (gestionnaire de paquets)
- Node.js 22+

### Développement Local

```sh
cp .env.example .env    # configurez vos variables d'environnement
bun install
bun run dev             # démarre le serveur de dev sur http://localhost:3000
```

### Build de Production

```sh
bun run build
bun run start
```

### Docker

```sh
cp .env.example .env    # configurez vos variables d'environnement
docker compose up --build
```

L'application sera disponible sur `http://localhost:3000`.

## Déploiement

### Vercel (Recommandé)

1. Importez le dépôt dans [Vercel](https://vercel.com)
2. Ajoutez un store [Vercel KV](https://vercel.com/docs/storage/vercel-kv) à votre projet
3. Configurez les variables d'environnement dans le tableau de bord Vercel (voir [Configuration](#configuration))
4. Déployez -- l'application fonctionne sans état avec RSS mis en cache edge

### Docker / Auto-hébergé

Utilisez les fichiers `Dockerfile` et `docker-compose.yml` inclus. Toute la configuration passe par `.env`.

> **Note :** En auto-hébergement, vous avez besoin d'une instance Redis externe pour Vercel KV, ou vous pouvez fonctionner sans historique persistant (l'application fonctionnera toujours avec le cache en mémoire).

## Configuration

Toute la configuration se fait via des variables d'environnement. Voir `.env.example` pour un modèle.

### Requises

| Variable | Description |
|---|---|
| `APP_BASE_URL` | URL publique de votre déploiement (ex. `https://concours.mouadlotfi.com`) |

### Email (Brevo)

| Variable | Description |
|---|---|
| `BREVO_API_KEY` | Clé API Brevo pour les emails transactionnels et la gestion des contacts |
| `BREVO_LIST_ID` | ID de la liste de contacts Brevo pour les abonnés |
| `BREVO_SENDER_EMAIL` | Adresse email de l'expéditeur pour les notifications |
| `BREVO_SENDER_NAME` | Nom d'affichage de l'expéditeur (par défaut : `Concours Developpement Web`) |

### Sécurité

| Variable | Description |
|---|---|
| `CRON_SECRET` | Jeton secret pour authentifier les requêtes de rafraîchissement cron (recommandé) |
| `UNSUBSCRIBE_SECRET` | Secret HMAC pour signer les jetons de désabonnement (par défaut `BREVO_API_KEY`) |

### Scraper (Optionnel)

| Variable | Défaut | Description |
|---|---|---|
| `KEYWORDS` | `developpement,informatique` | Mots-clés d'inclusion séparés par des virgules |
| `EXCLUDE_KEYWORDS` | _(vide)_ | Mots-clés d'exclusion séparés par des virgules |
| `MAX_PAGES` | `5` | Nombre max de pages de liste à scraper |
| `MAX_FEED_ITEMS` | `30` | Nombre max d'éléments dans le flux RSS |
| `CACHE_SECONDS` | `3600` | TTL du cache en mémoire en secondes |
| `BASE_URL` | `https://www.wadifa-info.com` | URL de base de la cible du scraper |
| `LIST_PATH` | `/fr/concours-emplois-publics-maroc` | Chemin de la page de liste |
| `LIST_SORT_BY` | `4` | Paramètre de tri pour les listes |
| `USER_AGENT` | Chaîne UA Chrome 120 | User-Agent HTTP pour les requêtes du scraper |

## Endpoints API

| Méthode | Chemin | Description |
|---|---|---|
| `GET` | `/` | Tableau de bord web avec les concours correspondants |
| `GET` | `/feed.xml` | Flux RSS 2.0 (mis en cache edge) |
| `GET` | `/healthz` | Vérification de santé (`{ ok: true }`) |
| `GET` | `/unsubscribe?token=...` | Page de confirmation de désabonnement |
| `POST` | `/api/subscribe` | Ajouter un abonné email |
| `POST` | `/api/unsubscribe` | Retirer un abonné email (vérifié par jeton) |
| `POST` | `/api/cron/refresh` | Déclencher scrape + notifications email |

### Rafraîchissement Cron

`POST /api/cron/refresh` scrape pour de nouvelles correspondances et envoie un récapitulatif aux abonnés.

- Si `CRON_SECRET` est défini, inclure l'en-tête `x-cron-secret: <secret>`
- Ajouter `?dryRun=1` pour scraper sans envoyer d'emails
- Ajouter `?force=1` pour contourner le cache en mémoire

Déclenchez cet endpoint depuis un planificateur externe comme [cron-job.org](https://cron-job.org), GitHub Actions, ou un crontab système.

## Structure du Projet

```
src/
  app/
    page.tsx                    # Page d'accueil (composant serveur)
    subscribe-card.tsx          # Formulaire d'abonnement email (composant client)
    layout.tsx                  # Layout racine
    globals.css                 # Thème, polices, variables CSS
    icon.svg                    # Favicon
    feed.xml/route.ts           # Endpoint du flux RSS
    healthz/route.ts            # Vérification de santé
    unsubscribe/                # Page de confirmation de désabonnement
    api/
      subscribe/route.ts        # API d'abonnement
      unsubscribe/route.ts      # API de désabonnement
      cron/refresh/route.ts     # API de rafraîchissement cron
  lib/
    config.ts                   # Configuration centrale
    wadifa.ts                   # Scraper web + correspondance de mots-clés
    wadifa-cache.ts             # Cache TTL en mémoire
    concours-store.ts           # Persistence Vercel KV
    rss.ts                      # Constructeur de flux RSS 2.0
    brevo.ts                    # Client API Brevo
    mailer.ts                   # Composition + envoi d'email
    date.ts                     # Utilitaires d'analyse de date
    normalize.ts                # Normalisation de texte
    unsubscribe-token.ts        # Signature/vérification de jeton HMAC
scripts/
  smoke-http.ts                 # Suite de tests de fumée HTTP
  selftest.ts                   # Auto-test de bout en bout
```

## Tests

```sh
# Tests de fumée contre un serveur en cours d'exécution
bun run test:smoke -- --url=http://localhost:3000

# Auto-test complet (build, démarrer le serveur, exécuter les tests de fumée, arrêt)
bun run test:self
```

## Licence

[GNU GPL v3.0](https://www.gnu.org/licenses/gpl-3.0.html)
