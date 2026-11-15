// Relais de notifications de Planning COA (Cloudflare Worker, offre gratuite).
// À coller tel quel dans l'éditeur du Worker ; lier un espace KV sous le nom « SUBS ».
// Aucun secret à saisir : les clés VAPID sont créées au premier appel et gardées dans SUBS.
// Ne connaît ni les noms ni le planning : seulement les adresses techniques des téléphones abonnés.
// Accès : la « clé d'équipe » = SHA-256 du code d'équipe (calculée par l'appli). La première clé reçue
// est retenue ; si le code d'équipe change, supprimer l'entrée « cle » dans SUBS (elle sera reprise).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const SUBJECT = 'https://planning-equipe-coa.github.io/horaires/';
const enc = new TextEncoder();

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function sha256hex(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// Clés VAPID (ECDSA P-256), créées une fois
async function vapidKeys(env) {
  let saved = await env.SUBS.get('vapid', 'json');
  if (!saved) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    saved = { priv: await crypto.subtle.exportKey('jwk', kp.privateKey), pub: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) };
    await env.SUBS.put('vapid', JSON.stringify(saved));
  }
  return saved;
}
async function vapidHeader(endpoint, keys) {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const k = await crypto.subtle.importKey('jwk', keys.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, k, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${keys.pub}`;
}

// Chiffrement du message (RFC 8291, aes128gcm)
async function encryptPayload(sub, text) {
  const uaPub = unb64u(sub.keys.p256dh), auth = unb64u(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65;
  return concat(header, asPub, ct);
}
async function sendPush(sub, text, keys) {
  return fetch(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: await vapidHeader(sub.endpoint, keys), 'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    body: await encryptPayload(sub, text),
  });
}

async function checkKey(env, key) {
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) return false;
  const saved = await env.SUBS.get('cle');
  if (!saved) { await env.SUBS.put('cle', key); return true; } // première clé reçue : retenue
  return saved === key;
}
const validSub = s => s && typeof s.endpoint === 'string' && /^https:\/\//.test(s.endpoint) && s.endpoint.length < 1000 &&
  s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const path = new URL(request.url).pathname;
    try {
      if (request.method === 'GET' && path === '/vapid') return json({ key: (await vapidKeys(env)).pub });
      if (request.method === 'GET' && path === '/') return json({ ok: true, app: 'planning-coa-notif' });
      if (request.method !== 'POST') return json({ error: 'introuvable' }, 404);
      const data = await request.json().catch(() => ({}));
      if (!(await checkKey(env, data.key))) return json({ error: 'cle' }, 403);
      if (path === '/subscribe') {
        if (!validSub(data.sub)) return json({ error: 'abonnement' }, 400);
        const id = 'sub:' + (await sha256hex(data.sub.endpoint));
        await env.SUBS.put(id, JSON.stringify({ endpoint: data.sub.endpoint, keys: data.sub.keys, at: new Date().toISOString() }));
        return json({ ok: true });
      }
      if (path === '/unsubscribe') {
        if (data.endpoint) await env.SUBS.delete('sub:' + (await sha256hex(String(data.endpoint))));
        return json({ ok: true });
      }
      if (path === '/test') { // essai : un message à ce seul téléphone (bouton « Tester » de l'appli)
        const sub = await env.SUBS.get('sub:' + (await sha256hex(String(data.endpoint || ''))), 'json');
        if (!sub) return json({ error: 'inconnu' }, 404);
        const res = await sendPush(sub, JSON.stringify({ title: 'Planning COA', body: 'Essai réussi : les notifications arrivent sur ce téléphone.' }), await vapidKeys(env));
        return json({ ok: res.ok, status: res.status });
      }
      if (path === '/notify') {
        const msg = JSON.stringify({ title: String(data.title || 'Planning COA').slice(0, 80), body: String(data.body || 'Nouveau planning en ligne').slice(0, 200) });
        const keys = await vapidKeys(env);
        const skip = data.except ? 'sub:' + (await sha256hex(String(data.except))) : null;
        let sent = 0, gone = 0, cursor;
        do {
          const page = await env.SUBS.list({ prefix: 'sub:', cursor });
          await Promise.all(page.keys.filter(k => k.name !== skip).map(async k => {
            const sub = await env.SUBS.get(k.name, 'json');
            if (!sub) return;
            const res = await sendPush(sub, msg, keys).catch(() => null);
            if (res && (res.status === 404 || res.status === 410)) { gone++; await env.SUBS.delete(k.name); }
            else if (res && res.ok) sent++;
          }));
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
        return json({ ok: true, sent, gone });
      }
      return json({ error: 'introuvable' }, 404);
    } catch (e) {
      return json({ error: 'serveur' }, 500);
    }
  },
};
