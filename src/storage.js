'use strict';

const fs = require('fs');
const path = require('path');
const tls = require('tls');

function postgresConfig(env) {
  const mode = env.DB_SSLMODE || 'verify-full';
  if (!['verify-full', 'verify-ca', 'disable'].includes(mode)) {
    throw new Error('DB_SSLMODE invalide');
  }
  const port = Number(env.DB_PORT || 5432);
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Configuration PostgreSQL incomplète');
  }
  // Pas de connexion cloud sans authentification TLS. disable est limité à
  // loopback pour les tests ; aucune connexion distante ne peut en hériter.
  if (mode === 'disable' && !['127.0.0.1', '::1'].includes(env.DB_HOST)) {
    throw new Error('TLS obligatoire pour PostgreSQL distant');
  }
  let ssl = false;
  if (mode !== 'disable') {
    const ca = env.DB_SSLROOTCERT_PEM || (env.DB_SSLROOTCERT && fs.readFileSync(env.DB_SSLROOTCERT, 'utf8'));
    if (!ca) throw new Error('CA PostgreSQL requise');
    tls.createSecureContext({ ca });
    ssl = { ca, rejectUnauthorized: true };
    // Cloud SQL avec CA par instance et IP privée : valider sa CA unique.
    // RDS utilise verify-full et conserve également la vérification du nom.
    if (mode === 'verify-ca') ssl.checkServerIdentity = () => undefined;
  }
  return { host: env.DB_HOST, port, database: env.DB_NAME, user: env.DB_USER,
    password: env.DB_PASSWORD, ssl, max: 4, maxUses: 1,
    connectionTimeoutMillis: 3000, query_timeout: 3000,
    statement_timeout: 3000, application_name: 'pixelcalm' };
}

function createStorage(env = process.env) {
  const engine = env.DB_ENGINE || 'sqlite';
  if (engine === 'sqlite') {
    const Database = require('better-sqlite3');
    const dir = env.DATA_DIR || '/tmp';
    fs.mkdirSync(dir, { recursive: true });
    const db = new Database(path.join(dir, 'pensees.db'));
    // Contrat historique conservé : même fichier, schéma et volume GCS.
    db.exec(`CREATE TABLE IF NOT EXISTS pensees (
      id INTEGER PRIMARY KEY AUTOINCREMENT, texte TEXT NOT NULL,
      saved_at TEXT NOT NULL DEFAULT (datetime('now')))`);
    const insert = db.prepare('INSERT INTO pensees (texte) VALUES (?)');
    const list = db.prepare('SELECT id, texte, saved_at FROM pensees ORDER BY id DESC LIMIT 60');
    const count = db.prepare('SELECT COUNT(*) as n FROM pensees');
    return { engine, add: async texte => { insert.run(texte); return count.get().n; },
      list: async () => list.all(), count: async () => count.get().n,
      healthy: async () => { count.get(); return true; }, close: async () => db.close() };
  }
  if (engine !== 'postgres') throw new Error('DB_ENGINE doit être sqlite ou postgres');
  const { Pool } = require('pg');
  const pool = new Pool(postgresConfig(env));
  // Ne jamais journaliser une erreur pg brute : elle peut contenir une requête.
  pool.on('error', () => {});
  const total = async client => Number((await client.query('SELECT count(*) AS n FROM public.pensees')).rows[0].n);
  return { engine,
    add: async texte => {
      const client = await pool.connect();
      try {
        await client.query('INSERT INTO public.pensees (texte) VALUES ($1)', [texte]);
        return await total(client);
      } finally { client.release(); }
    },
    list: async () => (await pool.query(`SELECT id::integer AS id, texte,
      to_char(saved_at, 'YYYY-MM-DD HH24:MI:SS') AS saved_at
      FROM public.pensees ORDER BY id DESC LIMIT 60`)).rows,
    count: async () => total(pool),
    healthy: async () => {
      const client = await pool.connect();
      try {
        const { rows } = await client.query(`SELECT
          current_setting('transaction_read_only') = 'off'
          AND has_table_privilege(current_user, 'public.pensees', 'INSERT')
          AND has_sequence_privilege(current_user, 'public.pensees_id_seq', 'USAGE')
          AND (SELECT rolcanlogin FROM pg_roles WHERE rolname = current_user) AS writable`);
        await client.query('SELECT id FROM public.pensees LIMIT 1');
        return rows[0].writable === true;
      } finally { client.release(); }
    }, close: async () => pool.end() };
}

module.exports = { createStorage, postgresConfig };
