const test = require('node:test');
const assert = require('node:assert');
const T = require('./team.js');

// Faux GitHub en mémoire : lecture publique (raw) + API contents avec clé
function fakeGitHub(validToken) {
  const files = {};
  let n = 0;
  const reply = (status, body) => ({ status, ok: status >= 200 && status < 300,
    text: async () => body, json: async () => JSON.parse(body) });
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.hostname === 'raw.githubusercontent.com') {
      const path = u.pathname.split('/').slice(4).join('/');
      return files[path] ? reply(200, files[path].text) : reply(404, '');
    }
    const auth = (opts.headers || {}).Authorization;
    if (auth !== 'Bearer ' + validToken) return reply(401, '{}');
    const m = u.pathname.match(/\/contents\/(.+)$/);
    if (!m) return reply(200, '{}'); // dépôt
    const path = m[1];
    if ((opts.method || 'GET') === 'GET') {
      const f = files[path];
      return f ? reply(200, JSON.stringify({ sha: f.sha, content: Buffer.from(f.text).toString('base64') })) : reply(404, '{}');
    }
    const body = JSON.parse(opts.body);
    const cur = files[path];
    if ((cur && body.sha !== cur.sha) || (!cur && body.sha)) return reply(409, '{}');
    files[path] = { text: Buffer.from(body.content, 'base64').toString('utf8'), sha: 'sha' + (++n), message: body.message };
    return reply(200, '{}');
  };
  return { files, fetchFn };
}

test('chiffrement : aller-retour, mauvais code refusé, code tolérant aux majuscules et séparateurs', async () => {
  const text = await T.encrypt({ agents: { DUPONT: { 20261101: 'M' } } }, 'Tarmac Cerise-boussole', '2026-10-31T08:00:00Z');
  assert.ok(!text.includes('DUPONT'));
  assert.strictEqual(T.envelopeAt(text), '2026-10-31T08:00:00Z');
  const back = await T.decrypt(text, 'tarmac-cerise-boussole');
  assert.deepStrictEqual(back.agents.DUPONT, { 20261101: 'M' });
  await assert.rejects(T.decrypt(text, 'tarmac-cerise'), /code/);
});

test('équipe : configuration, rejoindre, publier, recevoir, publier une mise à jour', async () => {
  const gh = fakeGitHub('ghp_bonne');
  const code = 'tarmac-cerise-boussole-neige';
  assert.deepStrictEqual(await T.checkCode(code, gh.fetchFn), { status: 'absent' });
  await assert.rejects(T.setupKey(code, 'ghp_fausse', 'RAPH', gh.fetchFn), /cle/);
  await T.setupKey(code, 'ghp_bonne', 'RAPH', gh.fetchFn);
  assert.ok(!gh.files['cle.enc'].text.includes('ghp_bonne'));

  const joined = await T.checkCode(code, gh.fetchFn);
  assert.strictEqual(joined.token, 'ghp_bonne');
  await assert.rejects(T.checkCode('mauvais-code', gh.fetchFn), /code/);

  const first = await T.publishPlan(code, joined.token, 'RAPH', remote => {
    assert.strictEqual(remote, null);
    return { plan: { agents: { DUPONT: { 20261101: 'M' } } }, summary: 'premier' };
  }, gh.fetchFn);
  const fetched = await T.fetchPlan(gh.fetchFn);
  assert.strictEqual(fetched.at, first.at);
  const plan = await T.decrypt(fetched.text, code);
  assert.strictEqual(plan.by, 'RAPH');
  assert.deepStrictEqual(plan.agents, { DUPONT: { 20261101: 'M' } });

  // un collègue publie une mise à jour : il reçoit le planning actuel pour fusionner
  await T.publishPlan(code, joined.token, 'MARTIN', remote => {
    assert.deepStrictEqual(remote.agents, { DUPONT: { 20261101: 'M' } });
    return { plan: { agents: { DUPONT: { 20261101: 'S' } } } };
  }, gh.fetchFn);
  const after = await T.decrypt((await T.fetchPlan(gh.fetchFn)).text, code);
  assert.strictEqual(after.by, 'MARTIN');
  assert.strictEqual(after.agents.DUPONT[20261101], 'S');
  assert.strictEqual(gh.files['planning.enc'].message, 'Planning publié par MARTIN');
});

test('publication : si quelqu\'un publie entre-temps, on refusionne sur sa version', async () => {
  const gh = fakeGitHub('k');
  const code = 'un-deux-trois-quatre';
  await T.setupKey(code, 'k', 'A', gh.fetchFn);
  await T.publishPlan(code, 'k', 'A', () => ({ plan: { agents: { A: { 20261101: 'M' } } } }), gh.fetchFn);
  const seen = [];
  await T.publishPlan(code, 'k', 'B', remote => {
    seen.push(Object.keys(remote.agents).sort().join(','));
    if (seen.length === 1) {
      // C publie pendant que B prépare sa publication
      return { plan: remote, concurrent: true };
    }
    return { plan: { agents: Object.assign({}, remote.agents, { B: { 20261101: 'S' } }) } };
  }, async (url, opts = {}) => {
    if (opts.method === 'PUT' && seen.length === 1 && !gh.cPublished) {
      gh.cPublished = true;
      const cText = await T.encrypt({ agents: { A: { 20261101: 'M' }, C: { 20261101: 'N' } }, by: 'C' }, code, 'x');
      const cur = gh.files['planning.enc'];
      gh.files['planning.enc'] = { text: cText, sha: cur.sha + '-c' };
    }
    return gh.fetchFn(url, opts);
  });
  assert.deepStrictEqual(seen, ['A', 'A,C']);
  const final = await T.decrypt(gh.files['planning.enc'].text, code);
  assert.deepStrictEqual(Object.keys(final.agents).sort(), ['A', 'B', 'C']);
});
