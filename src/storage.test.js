/* eslint-env jest */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStorage, postgresConfig } = require('./storage');

describe('stockage Pixelcalm', () => {
  it('réouvre le fichier SQLite historique sans perte', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelcalm-sqlite-'));
    let store;
    try {
      store = createStorage({ DATA_DIR: dir });
      expect(store.engine).toBe('sqlite');
      await store.add('pensée conservée');
      await store.close();
      store = createStorage({ DATA_DIR: dir });
      expect(await store.count()).toBe(1);
      expect((await store.list())[0].texte).toBe('pensée conservée');
      expect(fs.existsSync(path.join(dir, 'pensees.db'))).toBe(true);
    } finally { if (store) await store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });

  const local = { DB_HOST: '127.0.0.1', DB_NAME: 'fixture', DB_USER: 'fixture',
    DB_PASSWORD: 'local-test-only', DB_SSLMODE: 'disable' };
  it('refuse une rétrogradation TLS distante et une configuration incomplète', () => {
    expect(() => postgresConfig({ ...local, DB_HOST: '10.189.0.3' })).toThrow('TLS obligatoire');
    expect(() => postgresConfig({ ...local, DB_SSLMODE: 'require' })).toThrow();
    expect(() => postgresConfig({ ...local, DB_PORT: 'invalid' })).toThrow();
    expect(() => postgresConfig({ ...local, DB_PASSWORD: '' })).toThrow();
    expect(() => postgresConfig({ ...local, DB_SSLMODE: 'verify-full' })).toThrow('CA');
    expect(() => createStorage({ DB_ENGINE: 'postgress' })).toThrow();
  });
});
