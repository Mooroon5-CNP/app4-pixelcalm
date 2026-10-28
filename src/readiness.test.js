/* eslint-env jest */
'use strict';
const request = require('supertest');
const { createApp } = require('./index');

describe('santé et erreurs de stockage', () => {
  it('conserve la liveness mais refuse le trafic si la base est inaccessible', async () => {
    const fail = async () => { throw new Error('secret-ne-doit-pas-apparaitre'); };
    const app = createApp({ engine: 'postgres', healthy: fail, count: fail, list: fail, add: fail });
    expect((await request(app).get('/healthz')).status).toBe(200);
    for (const url of ['/health', '/ready', '/api/pensees', '/']) {
      const res = await request(app).get(url);
      expect(res.status).toBe(503);
      expect(res.text).not.toContain('secret-ne-doit-pas-apparaitre');
    }
    expect((await request(app).post('/api/pensee').send({ texte: 'test' })).status).toBe(503);
  });
  it('refuse une base en lecture seule même si elle répond', async () => {
    const app = createApp({ engine: 'postgres', healthy: async () => false });
    expect((await request(app).get('/health')).status).toBe(503);
  });
  it('refuse une valeur JSON non textuelle sans erreur serveur', async () => {
    const app = createApp({ engine: 'sqlite' });
    for (const texte of [42, {}, [], null]) {
      expect((await request(app).post('/api/pensee').send({ texte })).status).toBe(400);
    }
  });
});
