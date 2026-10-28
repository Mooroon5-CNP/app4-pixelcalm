# Pixelcalm : stockage historique et recette PostgreSQL

Le nom du dépôt est `app4-pixelcalm`. Le nom utilisé par la plateforme, les images
et les manifests est **`app4-pixelcam`** : cette différence existait déjà et est
conservée pour ne pas créer une seconde application par erreur.

## Comportement par défaut

Sans `DB_ENGINE`, l'application utilise toujours SQLite :
`$DATA_DIR/pensees.db`, avec `/tmp` par défaut. Le volume GCS existant monté sur
`/data` continue à fonctionner. Le mode PostgreSQL ne lit, ne supprime et ne migre
pas ce fichier. Les données historiques du bucket restent dans le bucket.

Les routes et l'interface sont conservées : `POST /api/pensee`,
`GET /api/pensees`, `GET /`. Le processus écoute sur `PORT`, 8080 par défaut.

## Mode PostgreSQL pour le failover

Ce mode doit être choisi explicitement **dans le déploiement** : ajouter le code
ne transforme pas le déploiement GCP actuel en déploiement Cloud SQL.

| Variable | Valeur attendue |
| --- | --- |
| `DB_ENGINE` | `postgres` |
| `DB_HOST` | IP privée réelle Cloud SQL sur GCP ; endpoint réel RDS sur AWS |
| `DB_PORT` | `5432` |
| `DB_NAME` | `pixelcalm` pour la recette |
| `DB_USER` | `cnp_runtime`, limité aux opérations applicatives |
| `DB_PASSWORD` | Injecté par Secret Manager ou Secrets Manager, jamais dans Git |
| `DB_SSLMODE` | `verify-ca` avec la CA unique de Cloud SQL ; `verify-full` avec RDS |
| `DB_SSLROOTCERT_PEM` | Certificat(s) CA public(s) du serveur ; pas une clé privée |

`DB_SSLROOTCERT` permet aussi de fournir le chemin d'un fichier de CA monté.
`disable` est accepté seulement avec un hôte loopback pour les tests locaux.
Une erreur PostgreSQL ne provoque aucun retour automatique à SQLite.

Le schéma de [sql/pixelcalm.sql](sql/pixelcalm.sql) doit être installé par un
administrateur dans une base dédiée. Le compte runtime ne crée pas de schéma.
Les tables de suivi, la publication et les droits de réplication sont préparés
par les outils de phase 1 du dépôt d'infrastructure, avec le profil `pixelcalm`.
Cette procédure est spécifique à cette application ; elle ne prétend pas migrer
automatiquement une application arbitraire.

## Santé

- `/healthz` : processus vivant, sans dépendance à la base.
- `/ready` et `/health` : 200 si la base et les droits runtime sont utilisables,
  503 si la connexion échoue, si PostgreSQL est en lecture seule ou si le rôle
  runtime est fermé. Aucun mot de passe ni message SQL brut n'est renvoyé.

ALB et Route53 doivent utiliser **`/health`**, pas `/healthz`. Les identifiants
runtime de secours restent fermés avant promotion. L'app peut ainsi rester
lancée tout en refusant le trafic applicatif jusqu'à la bascule.

## Vérification locale

```sh
npm ci
npm run lint
npm test -- --runInBand
docker build --platform linux/amd64 -t cnp-pixelcalm:local .
```

Les tests vérifient notamment la réouverture de SQLite, les routes existantes,
les réponses 503 et le refus des configurations PostgreSQL distantes sans TLS
vérifié. Le lanceur `deployment/failover-phase1/tests/run_docker_postgres.py` du
dépôt d'infrastructure lance deux PostgreSQL 15 jetables et cette vraie API :
copie initiale, réplication continue, clôture du rôle GCP simulé, interruption
puis reprise de promotion, conservation des pensées et recalage de séquence.
Il ne déploie rien dans les clouds.

Le workflow existant conserve `gitops_mode: portal` : un push sur `main`
construit et scanne l'image. La publication du déploiement reste gérée par le
portail et, pour prod, sa validation manager. Aucune modification de workflow
ou de manifeste de déploiement n'est ajoutée dans ce dépôt.
