# Concours Watcher

Une application Next.js qui agrege les annonces de concours du secteur public liees au developpement web et a l'informatique. Elle filtre les annonces par mots-cles configurables, sert les resultats sous forme de flux RSS, les affiche sur un tableau de bord web, et notifie les abonnes par email lorsque de nouveaux concours sont trouves.

## Fonctionnalites

- **Web scraping** -- Pagination des pages de liste de wadifa-info.com et scraping des pages de detail avec Cheerio
- **Filtrage par mots-cles** -- Correspond aux concours selon des mots-cles d'inclusion/exclusion configurables (correspondance de texte pure)
- **Flux RSS** -- Sert un flux RSS 2.0 valide a `/feed.xml`
- **Tableau de bord web** -- Affiche les concours correspondants avec details depliables, echeances et liens sources
- **Abonnements email** -- Les abonnes recoivent des emails recapitulatifs lorsque de nouveaux concours correspondants sont trouves (via Brevo)
- **Historique persistant** -- Les resultats scrapes sont stockes dans un fichier JSON local avec ecritures atomiques
- **Rafraichissement automatique** -- Planificateur `node-cron` integre (toutes les 5 heures par defaut) + endpoint API securise pour declenchement externe
- **Desabonnement securise** -- Liens de desabonnement en un clic signes HMAC-SHA256 dans chaque email
- **Rate limiting** -- Protection de l'endpoint d'abonnement par limiteur a fenetre glissante

## Stack Technique

| Couche | Technologie |
|---|---|
| Framework | [Next.js](https://nextjs.org) 16 (App Router, standalone output) |
| Langage | TypeScript 5.9 |
| UI | React 19, CSS Modules |
| Scraping | [Cheerio](https://cheerio.js.org) |
| Validation | [Zod](https://zod.dev) 4 |
| Email | [Brevo](https://www.brevo.com) (API SMTP transactionnelle) |
| Stockage | Fichier JSON local (`data/concours.json`) avec ecritures atomiques |
| Planification | [node-cron](https://github.com/node-cron/node-cron) |
| Polices | [Geist](https://vercel.com/font) (woff2 auto-heberge) |
| Conteneur | Docker (multi-stage alpine, ~337 MB) |

## Demarrage

### Prerequis

- [Bun](https://bun.sh) (gestionnaire de paquets)
- Node.js 22+

### Developpement Local

```sh
cp .env.example .env    # configurez vos variables d'environnement
bun install
bun run dev             # demarre le serveur de dev sur http://localhost:3000
```

### Build de Production

```sh
bun run build
bun run start
```

## Deploiement (Docker)

L'application est concue pour etre auto-hebergee avec Docker. Le `Dockerfile` utilise un build multi-stage (bun pour les deps, node pour le build, runner alpine minimal).

```sh
cp .env.example .env    # configurez vos variables d'environnement
docker compose up -d --build
```

L'application sera disponible sur `http://localhost:3000`.

Le planificateur `node-cron` integre declenche automatiquement le scraping toutes les 5 heures. Aucun cron externe n'est requis, mais l'endpoint `/api/cron/refresh` reste disponible pour des declenchements manuels.

### Docker Compose

Le fichier `docker-compose.yml` inclut :

- **Limites de ressources** -- CPU et memoire plafonnes
- **Securite** -- Systeme de fichiers racine en lecture seule, `tmpfs` pour les caches temporaires, utilisateur non-root
- **Volume persistant** -- Volume Docker nomme (`concours-data`) monte sur `/app/data`
- **Healthcheck** -- Verification automatique de `/healthz`
- **Redemarrage automatique** -- `unless-stopped`

### Variables d'environnement pour Docker

Configurez votre fichier `.env` a la racine du projet. Voir la section [Configuration](#configuration) pour les details.

## Configuration

Toute la configuration se fait via des variables d'environnement. Voir `.env.example` pour un modele.

### Requises

| Variable | Description |
|---|---|
| `APP_BASE_URL` | URL publique de votre deploiement (ex. `https://concours.example.com`) |
| `BREVO_API_KEY` | Cle API Brevo pour les emails transactionnels et la gestion des contacts |
| `BREVO_LIST_ID` | ID de la liste de contacts Brevo pour les abonnes |
| `BREVO_SENDER_EMAIL` | Adresse email de l'expediteur pour les notifications |
| `CRON_SECRET` | Jeton secret pour authentifier les requetes de rafraichissement cron |
| `UNSUBSCRIBE_SECRET` | Secret HMAC pour signer les jetons de desabonnement |

### Optionnelles

| Variable | Defaut | Description |
|---|---|---|
| `BREVO_SENDER_NAME` | `Concours Developpement Web` | Nom d'affichage de l'expediteur |
| `REFRESH_CRON` | `0 */5 * * *` | Expression cron pour le planificateur integre |
| `DATA_DIR` | `./data` | Repertoire pour le fichier JSON de stockage |
| `KEYWORDS` | `developpement,informatique` | Mots-cles d'inclusion separes par des virgules |
| `EXCLUDE_KEYWORDS` | _(vide)_ | Mots-cles d'exclusion separes par des virgules |
| `MAX_PAGES` | `5` | Nombre max de pages de liste a scraper |
| `MAX_FEED_ITEMS` | `30` | Nombre max d'elements dans le flux RSS |
| `CACHE_SECONDS` | `3600` | TTL du cache en memoire en secondes |
| `BASE_URL` | `https://www.wadifa-info.com` | URL de base de la cible du scraper |
| `LIST_PATH` | `/fr/concours-emplois-publics-maroc` | Chemin de la page de liste |
| `LIST_SORT_BY` | `4` | Parametre de tri pour les listes |
| `USER_AGENT` | Chaine UA Chrome 120 | User-Agent HTTP pour les requetes du scraper |

## Endpoints API

| Methode | Chemin | Description |
|---|---|---|
| `GET` | `/` | Tableau de bord web avec les concours correspondants |
| `GET` | `/feed.xml` | Flux RSS 2.0 |
| `GET` | `/healthz` | Verification de sante (`{ ok: true }`) |
| `GET` | `/unsubscribe?token=...` | Page de confirmation de desabonnement |
| `POST` | `/api/subscribe` | Ajouter un abonne email (rate limited) |
| `POST` | `/api/unsubscribe` | Retirer un abonne email (verifie par jeton) |
| `POST` | `/api/cron/refresh` | Declencher scrape + notifications email |

### Rafraichissement Cron

Le scraping est effectue automatiquement par le planificateur `node-cron` integre (toutes les 5 heures par defaut, configurable via `REFRESH_CRON`).

Pour un declenchement manuel, utilisez `POST /api/cron/refresh` :

```sh
curl -X POST -H "x-cron-secret: <votre-secret>" https://concours.example.com/api/cron/refresh
```

- L'en-tete `x-cron-secret` est **obligatoire**
- Ajouter `?dryRun=1` pour scraper sans envoyer d'emails
- Ajouter `?force=1` pour contourner le cache en memoire

## Structure du Projet

```
src/
  app/
    page.tsx                    # Page d'accueil (composant serveur)
    subscribe-card.tsx          # Formulaire d'abonnement email (composant client)
    layout.tsx                  # Layout racine
    globals.css                 # Theme, polices, variables CSS
    icon.svg                    # Favicon
    feed.xml/route.ts           # Endpoint du flux RSS
    healthz/route.ts            # Verification de sante
    unsubscribe/                # Page de confirmation de desabonnement
    api/
      subscribe/route.ts        # API d'abonnement (rate limited)
      unsubscribe/route.ts      # API de desabonnement
      cron/refresh/route.ts     # API de rafraichissement cron
  lib/
    config.ts                   # Configuration centrale
    wadifa.ts                   # Scraper web + correspondance de mots-cles
    wadifa-cache.ts             # Cache TTL en memoire
    concours-store.ts           # Stockage JSON local (ecritures atomiques)
    refresh.ts                  # Pipeline partage scrape -> merge -> notify
    rate-limit.ts               # Limiteur a fenetre glissante par IP
    rss.ts                      # Constructeur de flux RSS 2.0
    brevo.ts                    # Client API Brevo
    mailer.ts                   # Composition + envoi d'email
    date.ts                     # Utilitaires d'analyse de date
    normalize.ts                # Normalisation de texte
    unsubscribe-token.ts        # Signature/verification de jeton HMAC
  instrumentation.ts            # Hook serveur Next.js (planificateur node-cron)
data/
  concours.json                 # Donnees persistantes (genere automatiquement)
scripts/
  smoke-http.ts                 # Suite de tests de fumee HTTP
  selftest.ts                   # Auto-test de bout en bout
Dockerfile                      # Build multi-stage (bun + node alpine)
docker-compose.yml              # Config Docker avec securite et limites
```

## Tests

```sh
# Tests de fumee contre un serveur en cours d'execution
bun run test:smoke -- --url=http://localhost:3000

# Auto-test complet (build, demarrer le serveur, executer les tests de fumee, arret)
bun run test:self
```

## Licence

[GNU GPL v3.0](https://www.gnu.org/licenses/gpl-3.0.html)
