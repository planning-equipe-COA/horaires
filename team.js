// Mes Horaires — planning partagé de l'équipe.
// Le planning (noms + codes par jour, jamais le fichier Excel) est chiffré sur le téléphone avec le
// code d'équipe (PBKDF2-SHA256 → AES-GCM, WebCrypto) puis déposé dans un dépôt GitHub à part
// (DATA_REPO), qui ne contient que des fichiers chiffrés. Lecture : publique (raw.githubusercontent).
// Écriture : clé GitHub limitée à ce seul dépôt, elle-même chiffrée avec le code d'équipe
// (KEY_FILE) : quiconque a le code d'équipe peut publier, personne d'autre.
// Module UMD : window.TeamSync dans le navigateur, require('./team.js') dans les tests node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TeamSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATA_REPO = { owner: 'planning-equipe-COA', repo: 'donnees', branch: 'main' };
  const PLAN_FILE = 'planning.enc';
  const KEY_FILE = 'cle.enc';
  const ITERATIONS = 600000;

  const subtle = () => globalThis.crypto.subtle;
  const utf8 = new TextEncoder();
  const fromUtf8 = new TextDecoder();

  function toB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    const s = atob(String(b64).replace(/\s+/g, ''));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // « Tarmac Cerise-boussole » et « tarmac-cerise-boussole » donnent le même code
  function normCode(code) {
    return String(code || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().trim().split(/[\s\-_.,;]+/).filter(Boolean).join('-');
  }

  async function deriveKey(code, salt, iterations) {
    const base = await subtle().importKey('raw', utf8.encode(normCode(code)), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // Enveloppe JSON ; seul `at` (date de publication) est lisible sans le code
  async function encrypt(obj, code, at) {
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(code, salt, ITERATIONS);
    const data = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(JSON.stringify(obj))));
    return JSON.stringify({ v: 1, at: at || null, kdf: 'PBKDF2-SHA256', iter: ITERATIONS,
      salt: toB64(salt), iv: toB64(iv), data: toB64(data) });
  }

  function envelopeAt(text) {
    try { return JSON.parse(text).at || null; } catch (e) { return null; }
  }

  async function decrypt(text, code) {
    let env;
    try { env = JSON.parse(text); } catch (e) { throw new Error('format'); }
    if (!env || env.v !== 1) throw new Error('format');
    const key = await deriveKey(code, fromB64(env.salt), env.iter || ITERATIONS);
    let plain;
    try {
      plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(env.iv) }, key, fromB64(env.data));
    } catch (e) { throw new Error('code'); } // mauvais code d'équipe (ou fichier abîmé)
    return JSON.parse(fromUtf8.decode(plain));
  }

  // ── GitHub ───────────────────────────────────────────────────────────────
  function rawUrl(path) {
    const r = DATA_REPO;
    return `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${r.branch}/${path}?t=${Date.now()}`;
  }
  function apiUrl(path) {
    const r = DATA_REPO;
    return `https://api.github.com/repos/${r.owner}/${r.repo}/contents/${path}`;
  }

  // Lecture publique, sans clé ; null si le fichier n'existe pas encore
  async function readPublic(path, fetchFn) {
    const res = await (fetchFn || fetch)(rawUrl(path), { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('reseau');
    return res.text();
  }

  function apiHeaders(token) {
    return { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  function apiError(res) {
    return new Error(res.status === 401 || res.status === 403 ? 'cle' : res.status === 404 ? 'depot' : 'reseau');
  }

  // Lecture avec la clé (contenu frais + sha nécessaire pour écrire) ; null si absent
  async function readWithKey(path, token, fetchFn) {
    const res = await (fetchFn || fetch)(apiUrl(path) + '?ref=' + DATA_REPO.branch + '&t=' + Date.now(), { headers: apiHeaders(token), cache: 'no-store' });
    if (res.status === 404) {
      // 404 = fichier absent… ou dépôt invisible pour cette clé : on vérifie le dépôt
      const repo = await (fetchFn || fetch)(`https://api.github.com/repos/${DATA_REPO.owner}/${DATA_REPO.repo}`, { headers: apiHeaders(token) });
      if (!repo.ok) throw apiError(repo);
      return null;
    }
    if (!res.ok) throw apiError(res);
    const json = await res.json();
    return { sha: json.sha, text: fromUtf8.decode(fromB64(json.content)) };
  }

  async function write(path, text, sha, token, message, fetchFn) {
    const body = { message, content: toB64(utf8.encode(text)), branch: DATA_REPO.branch };
    if (sha) body.sha = sha;
    const res = await (fetchFn || fetch)(apiUrl(path), { method: 'PUT', headers: apiHeaders(token), body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) throw new Error('conflit'); // quelqu'un a publié entre-temps
    if (!res.ok) throw apiError(res);
  }

  // ── Opérations de l'appli ─────────────────────────────────────────────────
  // Rejoindre : vérifie le code en déchiffrant la clé de publication. 'absent' = équipe pas configurée.
  async function checkCode(code, fetchFn) {
    const text = await readPublic(KEY_FILE, fetchFn);
    if (text == null) return { status: 'absent' };
    const key = await decrypt(text, code); // lève 'code' si le code est faux
    return { status: 'ok', token: key.token };
  }

  // Première configuration : la clé GitHub est chiffrée avec le code d'équipe et déposée
  async function setupKey(code, token, by, fetchFn) {
    const existing = await readWithKey(KEY_FILE, token, fetchFn); // vérifie au passage que la clé marche
    const text = await encrypt({ token, by, at: new Date().toISOString() }, code, new Date().toISOString());
    await write(KEY_FILE, text, existing && existing.sha, token, 'Clé de publication de l\'équipe', fetchFn);
  }

  // Planning de l'équipe : { at, text } (chiffré) ou null
  async function fetchPlan(fetchFn) {
    const text = await readPublic(PLAN_FILE, fetchFn);
    return text == null ? null : { at: envelopeAt(text), text };
  }

  // Publie : merge(planningActuel) → planningPublié. merge reçoit le planning d'équipe actuel
  // (déchiffré, ou null) et rend { plan, summary } ; on réessaie une fois si quelqu'un a publié entre-temps.
  async function publishPlan(code, token, by, merge, fetchFn) {
    for (let attempt = 0; ; attempt++) {
      const current = await readWithKey(PLAN_FILE, token, fetchFn);
      const remote = current ? await decrypt(current.text, code) : null;
      const out = merge(remote);
      const at = new Date().toISOString();
      const text = await encrypt(Object.assign({}, out.plan, { at, by }), code, at);
      try {
        await write(PLAN_FILE, text, current && current.sha, token, 'Planning publié par ' + by, fetchFn);
        return { at, summary: out.summary };
      } catch (e) {
        if (e.message !== 'conflit' || attempt > 0) throw e;
      }
    }
  }

  return { DATA_REPO, PLAN_FILE, KEY_FILE, normCode, encrypt, decrypt, envelopeAt,
    checkCode, setupKey, fetchPlan, publishPlan, readWithKey };
});
