const os = require('os');
process.env.DATA_DIR = os.tmpdir();

const request = require('supertest');
const app = require('./index');

describe('app4-pixelcalm', () => {
  it('GET /healthz returns 200', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /ready returns 200', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('POST /api/pensee saves a thought and returns total', async () => {
    const res = await request(app)
      .post('/api/pensee')
      .send({ texte: 'Le ciel est infini.' });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('POST /api/pensee rejects empty text', async () => {
    const res = await request(app).post('/api/pensee').send({ texte: '' });
    expect(res.status).toBe(400);
  });

  it('POST /api/pensee rejects text over 280 chars', async () => {
    const res = await request(app).post('/api/pensee').send({ texte: 'a'.repeat(281) });
    expect(res.status).toBe(400);
  });

  it('GET /api/pensees returns an array', async () => {
    const res = await request(app).get('/api/pensees');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/pensees contains previously saved thought', async () => {
    await request(app).post('/api/pensee').send({ texte: 'Une pensée de test.' });
    const res = await request(app).get('/api/pensees');
    expect(res.body.some(p => p.texte === 'Une pensée de test.')).toBe(true);
  });

  it('GET / returns HTML with pixel calm UI', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Pixel Calm');
    expect(res.text).toContain('Lâcher prise');
    expect(res.text).toContain('/api/pensee');
  });
});
