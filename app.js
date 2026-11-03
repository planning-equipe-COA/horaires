(function () {
  'use strict';
  const C = window.PlanningCore;
  const STORAGE_CODES_KEY = 'mh_codes';
  const STORAGE_NAME_KEY = 'mh_name';
  const STORAGE_CODES_VERSION_KEY = 'mh_codes_v';
  const STORAGE_FROM_TODAY_KEY = 'mh_from_today';
  const STORAGE_SNAPSHOTS_KEY = 'mh_snap'; // ancien suivi des exports, repris une fois dans mh_plan
  const STORAGE_PLAN_KEY = 'mh_plan';
  const STORAGE_VIEW_KEY = 'mh_view';
  const STORAGE_NOTES_KEY = 'mh_notes'; // notes perso par jour, sur ce téléphone uniquement
  const STORAGE_SUM_KEY = 'mh_sum';
  const STORAGE_TAB_KEY = 'mh_tab'; // dernier onglet consulté : Planning ou Équipe (jamais Réglages)
  const PLAN_KEEP_DAYS = 400;
  const CODES_VERSION = 9;
  const $ = id => document.getElementById(id);

  // icône au trait (voir les <symbol> en tête de index.html)
  const ICON = n => `<svg class="ic" aria-hidden="true"><use href="#i-${n}"/></svg>`;
  function esc(s) {
    return String(s).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* stockage indisponible (navigation privée) */ }
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function cloneDefaults() { return C.DEFAULT_CODES.map(c => Object.assign({}, c)); }
  function loadCodes() {
    try {
      const saved = JSON.parse(load(STORAGE_CODES_KEY));
      if (Array.isArray(saved) && saved.length) {
        const version = +load(STORAGE_CODES_VERSION_KEY) || 0;
        // v2 : tout apparaît par défaut → on recoche tout une fois
        if (version < 2) saved.forEach(c => { c.include = true; });
        // v3 : libellés courts RF / RC
        if (version < 3) {
          saved.forEach(c => {
            if (c.code === 'RF' && c.label === 'Repos forcé') c.label = 'RF';
            if (c.code === 'RC' && c.label === 'Repos compensé') c.label = 'RC';
          });
        }
        // v4 : ATT = repos
        if (version < 4) {
          saved.forEach(c => {
            if (C.normCode(c.code) === C.normCode('ATT') && c.label === 'Absence') c.label = 'Repos';
          });
        }
        // v5 : couleurs par défaut (marron matin, jaune soir, bleu nuit, blanc repos, vert congés)
        if (version < 5) {
          const defaults = new Map(C.DEFAULT_CODES.map(d => [C.normCode(d.code), d.color]));
          saved.forEach(c => { if (c.color === undefined) c.color = defaults.get(C.normCode(c.code)) || ''; });
        }
        // v6 : RECU (ajouté à la main depuis « codes non reconnus ») → « Recup », blanc comme les repos
        if (version < 6) {
          saved.forEach(c => {
            if (C.normCode(c.code) !== 'RECU') return;
            if (!c.label || C.normCode(c.label) === 'RECU') c.label = 'Recup';
            if (!c.color) c.color = 'blanc';
            if (!c.abbr) c.abbr = 'Recup';
          });
        }
        // v7 : FORM = Formation (jour travaillé, violet) ; durées par défaut (JS, Formation : 7 h)
        if (version < 7) {
          const defaults = new Map(C.DEFAULT_CODES.map(d => [C.normCode(d.code), d]));
          saved.forEach(c => {
            const d = defaults.get(C.normCode(c.code));
            if (!d) return;
            if (C.normCode(c.code) === 'FORM') {
              if (!c.label || C.normCode(c.label) === 'FORM') c.label = d.label;
              if (!c.color) c.color = d.color;
            }
            if (c.hours === undefined && d.hours) c.hours = d.hours;
            if (c.abbr === undefined && d.abbr) c.abbr = d.abbr;
          });
        }
        // v8 : X affiché « X » tel quel (motif volontairement non affiché)
        if (version < 8) {
          saved.forEach(c => { if (C.normCode(c.code) === 'X' && c.label === 'Absence') c.label = 'X'; });
        }
        // v9 : ABJ = Absence justifiée (s'il avait été ajouté à la main depuis « codes non reconnus »)
        if (version < 9) {
          saved.forEach(c => { if (C.normCode(c.code) === 'ABJ' && (!c.label || C.normCode(c.label) === 'ABJ')) c.label = 'Absence justifiée'; });
        }
        if (version < CODES_VERSION) {
          store(STORAGE_CODES_VERSION_KEY, String(CODES_VERSION));
          store(STORAGE_CODES_KEY, JSON.stringify(saved));
        }
        // codes ajoutés aux valeurs par défaut depuis la dernière sauvegarde
        const have = new Set(saved.map(c => C.normCode(c.code)));
        return saved.concat(cloneDefaults().filter(c => !have.has(C.normCode(c.code))));
      }
    } catch (e) { /* réglages illisibles : on repart des valeurs par défaut */ }
    return cloneDefaults();
  }

  // Planning de l'équipe gardé sur le téléphone uniquement :
  // { agents: { NOM: { AAAAMMJJ: CODE } }, at, file, changes: { NOM: [{key, before, after}] }, changesSeen }
  function loadPlan() {
    try {
      const plan = JSON.parse(load(STORAGE_PLAN_KEY));
      if (plan && plan.agents) return plan;
    } catch (e) { /* illisible : on repart de l'ancien suivi des exports */ }
    try {
      const snaps = JSON.parse(load(STORAGE_SNAPSHOTS_KEY)) || {};
      const agents = {};
      Object.keys(snaps).forEach(n => { if (snaps[n] && snaps[n].days) agents[n] = snaps[n].days; });
      if (Object.keys(agents).length) return { agents, at: null, changes: {} };
    } catch (e) { /* rien à reprendre */ }
    return null;
  }
  function savePlan() { if (state.plan) store(STORAGE_PLAN_KEY, JSON.stringify(state.plan)); }

  function todayDate() { const n = new Date(); return { y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() }; }
  function keyToDate(k) { return { y: +k.slice(0, 4), m: +k.slice(4, 6), d: +k.slice(6, 8) }; }
  function utc(d) { return new Date(Date.UTC(d.y, d.m - 1, d.d)); }
  function defOf(code) { return state.codes.find(c => C.normCode(c.code) === code); }
  function codeTitle(code) {
    if (!code) return 'vide';
    const def = defOf(code);
    return def ? C.eventTitle(def) : code;
  }
  function codeLabel(code) { const def = defOf(code); return def ? (def.label || def.code) : code; }
  function chip(code) {
    const def = defOf(code);
    const text = def ? (def.abbr || def.code) : code;
    return `<span class="chip${text.length > 3 ? ' long' : ''}" data-color="${esc(def && def.color || '')}">${esc(text)}</span>`;
  }

  const today = todayDate();
  const state = { workbook: null, fileName: '', result: null, codes: loadCodes(), events: [],
    plan: loadPlan(), planBefore: undefined,
    tab: load(STORAGE_TAB_KEY) === 'equipe' || load(STORAGE_VIEW_KEY) === 'team' ? 'equipe' : 'planning',
    cal: { y: today.y, m: today.m, agent: load(STORAGE_NAME_KEY) || '', selected: C.dateKey(today),
      view: load(STORAGE_VIEW_KEY) === 'list' ? 'list' : 'month', // onglet Planning : Mois ou Liste
      sum: load(STORAGE_SUM_KEY) === 'year' ? 'year' : 'month', compare: '', hl: '' } };

  function loadNotes() { try { return JSON.parse(load(STORAGE_NOTES_KEY)) || {}; } catch (e) { return {}; } }
  const notes = loadNotes();
  function saveNote(key, text) {
    const t = text.trim();
    if (t) notes[key] = t.slice(0, 500); else delete notes[key];
    store(STORAGE_NOTES_KEY, JSON.stringify(notes));
    if (t) askPersist();
  }

  // ── Fichier ───────────────────────────────────────────────────────────────
  function showError(msg) {
    $('error').textContent = msg || '';
    $('error').hidden = !msg;
  }

  // Le lecteur Excel (xlsx.full.min.js, près de 1 Mo) n'est chargé qu'au moment d'importer : l'appli s'ouvre plus vite
  let xlsxPromise = null;
  function ensureXLSX() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxPromise) {
      xlsxPromise = new Promise((resolve, reject) => {
        const tag = document.createElement('script');
        tag.src = 'xlsx.full.min.js';
        tag.onload = () => resolve();
        tag.onerror = () => { xlsxPromise = null; tag.remove(); reject(new Error('xlsx')); };
        document.head.appendChild(tag);
      });
    }
    return xlsxPromise;
  }

  // Un ou plusieurs fichiers Excel (ex. novembre + décembre) : combinés en un seul planning
  function readOne(file) {
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onerror = () => resolve({ name: file.name, error: true });
      reader.onload = () => {
        try {
          resolve({ name: file.name, wb: XLSX.read(new Uint8Array(reader.result), { type: 'array', cellNF: true }) });
        } catch (e) { resolve({ name: file.name, error: true }); }
      };
      reader.readAsArrayBuffer(file);
    });
  }
  async function readFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    showError('');
    try { await ensureXLSX(); } catch (e) {
      showError('Le lecteur Excel n\'a pas pu être chargé : vérifie la connexion puis réessaie.');
      return;
    }
    const read = await Promise.all(files.map(readOne));
    const bad = read.filter(b => b.error).map(b => b.name);
    const books = read.filter(b => !b.error);
    if (!books.length) {
      state.workbook = null; state.books = [];
      showError(files.length > 1 ? 'Aucun de ces fichiers n\'est un classeur Excel lisible.' : 'Ce fichier n\'est pas un classeur Excel lisible.');
      return;
    }
    // feuille par défaut : la plus remplie, « PLANIFIE » avant « THEORIQUE » (C.bestSheet)
    $('month').value = '';
    for (const b of books) {
      b.sheet = C.bestSheet(b.wb.SheetNames, b.wb.SheetNames.map((n, i) => parseBook(b, i).total));
    }
    // ordre chronologique (le plus récent l'emporte en cas de jours communs)
    const firstKey = b => { const r = parseBook(b, b.sheet); const k = r.agents.flatMap(a => a.entries.map(e => C.dateKey(e.date))).sort(); return k[0] || ''; };
    books.forEach(b => { b.first = firstKey(b); });
    books.sort((a, b) => a.first.localeCompare(b.first));
    state.books = books;
    state.workbook = books[0].wb;
    $('importDetails').open = true; // l'aperçu et « Envoyer à l'équipe » sont dans cette carte
    state.fileName = books.map(b => b.name).join(' + ');
    state.planBefore = state.plan; // les tableaux remplacent leur période dans ce planning
    $('saved').hidden = true;
    $('fileName').innerHTML = books.map(b => esc(b.name)).join('<br>') +
      (bad.length ? `<br><span class="warn-text">Illisible, ignoré : ${bad.map(esc).join(', ')}</span>` : '');
    const multi = books.length > 1;
    const names = books[0].wb.SheetNames;
    $('sheet').innerHTML = names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
    $('sheet').value = String(books[0].sheet);
    $('sheetRow').hidden = multi || names.length < 2;
    refresh();
  }

  // Compte rendu fichier par fichier (plusieurs fichiers) : période lue, agents, ton nom retrouvé ou non
  function renderImportReport(multi, results) {
    const box = $('importReport');
    box.hidden = !multi;
    if (!multi) { box.innerHTML = ''; return; }
    const me = load(STORAGE_NAME_KEY) || '';
    const first = s => C.normCode(String(s).split(/\s+/)[0]);
    const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    box.innerHTML = '<p class="day-sub">Lecture des fichiers</p>' + state.books.map((b, i) => {
      const r = results[i];
      const keys = r.agents.flatMap(a => a.entries.map(e => C.dateKey(e.date))).sort();
      if (!r.agents.length || !keys.length) {
        return `<div class="rep-row bad"><strong>${esc(b.name)}</strong><span><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> aucun planning reconnu (feuille « ${esc(b.wb.SheetNames[b.sheet])} »)</span></div>`;
      }
      const found = r.agents.some(a => a.name === me);
      const alike = !found && me ? r.agents.filter(a => first(a.name) === first(me)).map(a => a.name) : [];
      return `<div class="rep-row${found || !me ? '' : ' warn'}"><strong>${esc(b.name)}</strong>` +
        `<span>du ${esc(fmt(keys[0]))} au ${esc(fmt(keys[keys.length - 1]))} · ${r.agents.length} agents` +
        (b.wb.SheetNames.length > 1 ? ` · feuille « ${esc(b.wb.SheetNames[b.sheet])} »` : '') +
        (r.monthAssumed ? ' · <svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> mois deviné' : '') +
        '</span>' +
        (me ? `<span>${found ? '✓ ' + esc(shown(me)) + ' trouvé' : alike.length
          ? '<svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> ' + esc(shown(me)) + ' écrit ici « ' + alike.map(esc).join(' », « ') + ' »'
          : '<svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> ' + esc(shown(me)) + ' absent de ce fichier'}</span>` : '') + '</div>';
    }).join('');
  }

  function parseBook(book, index) {
    const name = book.wb.SheetNames[index];
    const matrix = C.sheetToMatrix(XLSX, book.wb.Sheets[name]);
    const opts = { codes: state.codes, sheetName: name + ' ' + book.name };
    const ym = state.books && state.books.length === 1 && $('month').value.match(/^(\d{4})-(\d{2})$/);
    if (ym) { opts.year = +ym[1]; opts.month = +ym[2]; }
    return C.parseMatrix(matrix, opts);
  }
  function parseSheet(index) { return parseBook(state.books[0], index); }

  // ── Affichage ─────────────────────────────────────────────────────────────
  function refresh() {
    if (!state.workbook || !state.books || !state.books.length) return;
    const multi = state.books.length > 1;
    if (!multi) state.books[0].sheet = +$('sheet').value;
    const results = state.books.map(b => parseBook(b, b.sheet));
    const res = state.result = multi ? C.combineResults(results) : results[0];
    // plusieurs fichiers : pas de réglage du mois fichier par fichier, mais un avertissement
    const guessed = multi ? state.books.filter((b, i) => results[i].monthAssumed && results[i].agents.length) : [];
    $('multiWarn').hidden = !guessed.length;
    $('multiWarn').textContent = guessed.length
      ? `Le mois n'est pas écrit dans ${guessed.map(b => '« ' + b.name + ' »').join(', ')} : l'appli a supposé le mois en cours. Si c'est faux, importe ce fichier seul pour régler le mois.` : '';
    renderImportReport(multi, results);
    $('monthRow').hidden = multi || !res.monthAssumed;
    if (!multi && res.monthAssumed && !$('month').value && res.ctx) {
      $('month').value = res.ctx.y + '-' + String(res.ctx.m).padStart(2, '0');
    }
    if (!res.agents.length) {
      showError(multi ? 'Aucun planning reconnu dans ces fichiers. Vérifie les codes ci-dessous.'
        : 'Aucun planning reconnu dans cette feuille. Vérifie les codes ci-dessous ou essaie une autre feuille.');
      return;
    }
    showError('');
    savePlanFromImport(res);
  }

  // Range le tableau lu dans le planning du téléphone (recalculé à chaque réglage du fichier)
  function minKeep() {
    const min = new Date(Date.now() - PLAN_KEEP_DAYS * 864e5);
    return C.dateKey({ y: min.getFullYear(), m: min.getMonth() + 1, d: min.getDate() });
  }
  // Planning (forme stockée) → agents/entries (forme lue dans un tableau)
  // ── Rôles des agents : règles saisies dans l'appli, gardées sur le téléphone (mh_roles)
  // et transmises chiffrées avec le planning d'équipe ({ roa, np, at })
  const STORAGE_ROLES_KEY = 'mh_roles';
  let rolesCache;
  function loadRoles() {
    if (rolesCache === undefined) { try { rolesCache = JSON.parse(load(STORAGE_ROLES_KEY)) || null; } catch (e) { rolesCache = null; } }
    return rolesCache;
  }
  function saveRoles(r) { rolesCache = r || null; store(STORAGE_ROLES_KEY, JSON.stringify(r)); }
  function newestRoles(a, b) { if (!a) return b || null; if (!b) return a; return (a.at || '') >= (b.at || '') ? a : b; }
  // menus de noms : ordre alphabétique simple (les rôles ne regroupent que le tableau Équipe)
  // Nom affiché : le nom du tableau, ou celui choisi dans « Réorganiser les noms » (✏️), envoyé chiffré
  // avec le planning d'équipe (mh_roles.alias { NOM du tableau: nom affiché }). Les clés restent les noms du tableau.
  // Sans surnom, la mention de contrat du tableau (« 1/2 T (1) », « 32 », « 80% ») quitte le nom et devient un
  // badge (C.splitName) ; si deux agents ont alors le même nom, on garde leurs noms complets pour les distinguer.
  let nameCache = { key: null, map: new Map() };
  function nameTable() {
    const names = Object.keys(planView().agents);
    const alias = (loadRoles() || {}).alias || {};
    const key = names.join('\u0001') + '\u0002' + JSON.stringify(alias);
    if (nameCache.key === key) return nameCache.map;
    const parts = new Map(names.map(n => [n, C.splitName(n)]));
    const count = new Map();
    for (const n of names) if (!alias[n]) { const b = parts.get(n).base.toUpperCase(); count.set(b, (count.get(b) || 0) + 1); }
    const map = new Map();
    for (const n of names) {
      const p = parts.get(n);
      if (alias[n]) map.set(n, { text: alias[n], tags: p.tags });
      else map.set(n, count.get(p.base.toUpperCase()) > 1 ? { text: n, tags: [] } : { text: p.base, tags: p.tags });
    }
    nameCache = { key, map };
    return map;
  }
  function shown(n) { const i = nameTable().get(n); return i ? i.text : C.splitName(n).base; }
  function nameTags(n) { const i = nameTable().get(n); return i ? i.tags : C.splitName(n).tags; }
  function tagsHTML(n) { const t = nameTags(n); return t.length ? ` <span class="ctr">${t.map(esc).join(' ')}</span>` : ''; }
  function nameHTML(n, bold) { const t = esc(shown(n)); return (bold ? `<strong>${t}</strong>` : t) + tagsHTML(n); }
  function nameText(n) { const t = nameTags(n); return shown(n) + (t.length ? ' (' + t.join(' ') + ')' : ''); }
  function orderNames(names) { return names.slice().sort((a, b) => shown(a).localeCompare(shown(b), 'fr')); }
  // markMe : « · moi » après le nom de l'utilisateur (menu du planning affiché)
  function nameOptions(names, exclude, prefix, markMe) {
    const me = load(STORAGE_NAME_KEY);
    return orderNames(names).filter(n => n !== exclude).map(n =>
      `<option value="${esc(n)}">${esc((prefix || '') + nameText(n))}${markMe && n === me ? ' · moi' : ''}</option>`).join('');
  }

  // ── Numéros de téléphone (volontaires) : chacun ajoute le sien, transmis chiffré avec le planning
  // d'équipe ({ NOM: { tel, at } }) ; copie locale mh_contacts mise à jour à chaque synchro.
  const STORAGE_CONTACTS_KEY = 'mh_contacts';
  function loadContacts() { try { return JSON.parse(load(STORAGE_CONTACTS_KEY)) || {}; } catch (e) { return {}; } }
  function saveContacts(c) { store(STORAGE_CONTACTS_KEY, JSON.stringify(c || {})); }
  // 06 12 34 56 78 / +33 6 12 34 56 78 → affichage lisible ; null si invalide
  function normalizePhone(v) {
    let d = String(v || '').replace(/[^\d+]/g, '');
    if (d.startsWith('+33')) d = '0' + d.slice(3);
    else if (d.startsWith('0033')) d = '0' + d.slice(4);
    if (/^0\d{9}$/.test(d)) return d.replace(/(\d{2})(?=\d)/g, '$1 ');
    if (/^\+\d{8,15}$/.test(d)) return d;
    return null;
  }
  // nom + liens Appeler / SMS si l'agent a partagé son numéro
  function nameWithPhone(n, bold) {
    const c = loadContacts()[n];
    const label = nameHTML(n, bold);
    if (!c || !c.tel || !teamCode()) return label;
    const raw = c.tel.replace(/\s/g, '');
    return `<span class="with-tel">${label} <a class="tel-link" href="tel:${esc(raw)}" aria-label="Appeler ${esc(shown(n))}"><svg class="ic" aria-hidden="true"><use href="#i-phone"/></svg></a>` +
      `<a class="tel-link" href="sms:${esc(raw)}" aria-label="SMS à ${esc(shown(n))}"><svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg></a></span>`;
  }

  // ── Numéros utiles (opérationnels) : liste tenue par le responsable seul (code responsable),
  // transmise chiffrée avec le planning d'équipe ; copie locale mh_utiles { list, at, admin }.
  const STORAGE_UTILES_KEY = 'mh_utiles';
  function loadUtiles() { try { return JSON.parse(load(STORAGE_UTILES_KEY)) || { list: [] }; } catch (e) { return { list: [] }; } }
  function saveUtiles(u) { store(STORAGE_UTILES_KEY, JSON.stringify(u || { list: [] })); }
  // à reporter dans TOUTE publication, sinon la liste et le verrou seraient perdus
  function keepShared(current) {
    return { utiles: (current && current.utiles) || null, admin: (current && current.admin) || null };
  }

  function planToAgents(agents, remarks) {
    return Object.keys(agents || {}).map(name => ({ name,
      entries: Object.keys(agents[name]).sort().map(k => {
        const note = remarks && remarks[name] && remarks[name][k];
        return note ? { date: keyToDate(k), code: agents[name][k], note } : { date: keyToDate(k), code: agents[name][k] };
      }) }));
  }

  // Range des agents (tableau importé ou planning d'équipe reçu) dans le planning du téléphone
  function applyAgents(before, agents, meta) {
    const plan = C.mergePlan(before, agents, minKeep());
    plan.changes = {};
    let count = 0;
    for (const ag of agents) {
      const prev = before && before.agents[ag.name];
      if (!prev) continue;
      const diff = C.diffSnapshot(prev, ag.entries);
      if (diff.changes.length) { plan.changes[ag.name] = diff.changes; count += diff.changes.length; }
    }
    plan.changesSince = before && before.at || null;
    plan.changesSeen = false;
    plan.changesAt = meta && meta.at || new Date().toISOString();
    plan.changesFrom = meta && meta.file || '';
    plan.changesUpdated = meta && meta.updated || null; // date « mise à jour » du tableau (tapée), AAAAMMJJ
    // rien de changé (ex. on reçoit de l'équipe la version qu'on vient d'envoyer) : on garde les dernières
    // modifications au lieu de les effacer
    if (!count && before && before.changes && Object.keys(before.changes).length) {
      plan.changes = before.changes;
      for (const f of ['changesSince', 'changesSeen', 'changesAt', 'changesFrom', 'changesUpdated']) plan[f] = before[f];
      if (meta && meta.updated) plan.changesUpdated = meta.updated; // date de mise à jour envoyée seule
    }
    plan.teamAt = before && before.teamAt || null;
    plan.teamBy = before && before.teamBy || null;
    Object.assign(plan, meta);
    state.plan = plan;
    savePlan();
    return count;
  }

  function savePlanFromImport(res) {
    applyAgents(state.planBefore || null, res.agents, { at: new Date().toISOString(), file: state.fileName, updated: null });
    // date « mise à jour » : tapée à la main (illisible dans les copies du tableau), facultative
    $('updRow').hidden = false;
    $('updDate').value = '';
    $('updRow').classList.remove('filled');
    state.importAgents = res.agents;

    // calendrier : on montre le mois en cours s'il est dans le tableau, sinon son premier mois
    const keys = res.agents.flatMap(a => a.entries.map(e => C.dateKey(e.date))).sort();
    const todayKey = C.dateKey(todayDate());
    if (keys.length) {
      const target = todayKey >= keys[0] && todayKey <= keys[keys.length - 1] ? todayDate() : keyToDate(keys[0]);
      state.cal.y = target.y; state.cal.m = target.m;
    }
    // on garde le planning affiché s'il est dans le tableau, sinon le mien, sinon le premier nom
    // (le nom de l'utilisateur ne se choisit jamais tout seul : accueil ou « Je suis »)
    const names = res.agents.map(a => a.name), me = load(STORAGE_NAME_KEY);
    if (!names.includes(state.cal.agent)) state.cal.agent = names.includes(me) ? me : orderNames(names)[0];
    const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const nRemarks = res.agents.reduce((n, a) => n + a.entries.filter(e => e.note).length, 0);
    const mine = (res.agents.find(a => a.name === state.cal.agent) || { entries: [] }).entries.filter(e => e.note).length;
    $('saved').hidden = !keys.length;
    $('saved').innerHTML = keys.length
      ? `✓ Planning enregistré sur ce téléphone, du ${esc(fmt(keys[0]))} au ${esc(fmt(keys[keys.length - 1]))}` +
        (state.books && state.books.length > 1 ? ` (${state.books.length} fichiers combinés).` : '.') +

        (nRemarks ? `<br><span class="saved-remarks"><svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg> ${nRemarks} commentaire${nRemarks > 1 ? 's' : ''} de case${nRemarks > 1 ? 's' : ''} lu${nRemarks > 1 ? 's' : ''} dans le fichier` +
          (mine ? ` (dont ${mine} sur ton planning)` : '') + ' : repère le <svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg> dans le calendrier.</span>' : '') +
        '<br><button type="button" class="saved-go" data-go-tab="planning"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg> Voir le planning</button>' : '';
    renderCalendar();
    schedulePublish();
    // premier lancement : « Qui es-tu ? » attend dans l'onglet Planning
    if (!$('welcome').hidden && state.tab !== 'planning') setTab('planning');
  }

  // ── Planning d'équipe (voir team.js) ──────────────────────────────────────
  const STORAGE_TEAM_KEY = 'mh_team_code';
  const T = window.TeamSync;
  function teamCode() { return load(STORAGE_TEAM_KEY) || ''; }
  const longDate = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const timeOf = iso => new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const ERRORS = {
    code: 'Code d\'équipe incorrect.',
    cle: 'La clé de publication est refusée par GitHub (expirée ou retirée). Renouvelle-la dans « Planning d\'équipe ».',
    depot: 'Le dépôt « donnees » est introuvable pour cette clé.',
    reseau: 'Pas de connexion à GitHub pour l\'instant. Réessaie plus tard.',
    format: 'Le fichier de l\'équipe est illisible.',
  };
  // « Renouveler la clé » n'apparaît que si GitHub refuse vraiment la clé (sinon, inutile et inquiétant)
  const errText = e => {
    if (e && e.message === 'cle' && document.getElementById('teamRenewRow')) $('teamRenewRow').hidden = false;
    return ERRORS[e && e.message] || ERRORS.reseau;
  };

  function teamMsg(text, kind) {
    $('teamMsg').hidden = !text;
    $('teamMsg').textContent = text || '';
    $('teamMsg').className = 'team-msg ' + (kind || '');
  }

  function renderTeam() {
    const joined = !!teamCode();
    $('teamOut').hidden = joined;
    $('teamIn').hidden = !joined;
    $('iosCopy').hidden = !(joined && isIOS && !isStandalone);
    $('utilesBtn').hidden = !joined;
    if (joined) {
      const p = state.plan;
      $('teamInfo').innerHTML = p && p.teamAt
        ? `✓ Tu es dans l'équipe. Dernier planning reçu : publié le ${esc(longDate(p.teamAt))} à ${esc(timeOf(p.teamAt))}` +
          (p.teamBy ? ` par ${esc(p.teamBy)}` : '') + '.'
        : '✓ Tu es dans l\'équipe. Aucun planning publié pour l\'instant.';
    }
    const p = state.plan;
    $('teamStatus').hidden = !(joined && p && p.teamAt);
    const syncOk = renderTeamAlerts();
    if (!$('teamStatus').hidden) {
      // « publié par X le … » : la date de publication, à ne pas confondre avec la date « mise à jour » du tableau
      $('teamStatus').innerHTML = ICON('users') + esc(' Planning d\'équipe publié' + (p.teamBy ? ` par ${shown(p.teamBy)}` : '') +
        ` le ${longDate(p.teamAt)}` + (syncOk ? ` · vérifié ${agoText(syncOk)}` : ''));
    }
    $('importHint').textContent = joined
      ? 'Le fichier Excel reste sur ton appareil. Comme tu es dans l\'équipe, l\'appli te proposera d\'envoyer les noms et les codes à tes collègues, chiffrés avec le code d\'équipe.'
      : 'Le fichier est lu sur ton appareil et le planning reste sur ce téléphone : rien n\'est envoyé sur Internet.';
  }

  // ── Alertes d'équipe : clé de publication bientôt expirée, planning d'équipe pas vérifié depuis longtemps
  const STORAGE_SYNC_OK_KEY = 'mh_sync_ok'; // dernière vérification réussie auprès de GitHub
  const STORAGE_KEY_INFO_KEY = 'mh_key';    // { exp: 'AAAA-MM-JJ' | null, checkedAt }
  const KEY_WARN_DAYS = 14, STALE_DAYS = 3;
  function loadKeyInfo() { try { return JSON.parse(load(STORAGE_KEY_INFO_KEY)) || {}; } catch (e) { return {}; } }
  function saveKeyInfo(exp) { store(STORAGE_KEY_INFO_KEY, JSON.stringify({ exp: exp || null, checkedAt: Date.now() })); }
  // GitHub ne laisse pas le navigateur lire la date d'expiration : elle est saisie à la main et gardée
  // chiffrée avec la clé (cle.enc) ; relue au plus une fois par jour (déchiffrement un peu lent)
  async function refreshKeyInfo(force) {
    const code = teamCode(), info = loadKeyInfo();
    if (!code || (!force && info.checkedAt && Date.now() - info.checkedAt < 864e5)) return;
    try {
      const key = await T.checkCode(code);
      if (key.status === 'ok') { saveKeyInfo(key.exp); renderTeam(); }
    } catch (e) { /* réessayé à la prochaine synchro */ }
  }
  function keyDaysLeft(exp) {
    if (!exp) return null;
    const t = todayDate(), end = keyToDate(exp.replace(/-/g, ''));
    return Math.round((utc(end) - utc(t)) / 864e5);
  }
  const fmtLongDay = iso => utc(keyToDate(iso.replace(/-/g, ''))).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  function agoText(ms) {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 2) return 'à l\'instant';
    if (min < 60) return `il y a ${min} min`;
    const d = new Date(ms), n = new Date();
    if (d.toDateString() === n.toDateString()) return 'aujourd\'hui à ' + timeOf(d.toISOString());
    const days = Math.max(1, Math.round((n - d) / 864e5));
    return days === 1 ? 'hier' : `il y a ${days} jours`;
  }
  function renderTeamAlerts() {
    const joined = !!teamCode();
    const exp = joined ? loadKeyInfo().exp : null, left = keyDaysLeft(exp);
    // carte « Code d'équipe » : date de la clé
    $('keyInfo').innerHTML = !joined ? '' : exp
      ? `<svg class="ic" aria-hidden="true"><use href="#i-key"/></svg> Clé de publication valable jusqu'au <strong>${esc(fmtLongDay(exp))}</strong>${left < 0 ? ' — <strong>expirée</strong>' : ''}. <a href="#" id="keyExpChange">Modifier la date</a>`
      : '<svg class="ic" aria-hidden="true"><use href="#i-key"/></svg> Date d\'expiration de la clé de publication non indiquée : l\'appli ne pourra pas prévenir avant qu\'elle expire. ' +
        '<a href="#" id="keyExpChange">Indiquer la date</a> <span class="muted">(GitHub l\'affiche à la création de la clé)</span>';
    // onglet Planning : alertes
    const lines = [];
    if (left !== null && left <= KEY_WARN_DAYS) {
      lines.push(left < 0
        ? `<svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> La clé de publication de l'équipe a expiré le ${esc(fmtLongDay(exp))} : plus personne ne peut envoyer le planning. La personne qui a configuré l'équipe doit en créer une nouvelle (Réglages → Code d'équipe).`
        : `<svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> La clé de publication de l'équipe expire ${left === 0 ? 'aujourd\'hui' : left === 1 ? 'demain' : 'dans ' + left + ' jours'} (le ${esc(fmtLongDay(exp))}). Préviens la personne qui a configuré l'équipe : sans nouvelle clé, plus personne ne pourra envoyer le planning.`);
    }
    const ok = +load(STORAGE_SYNC_OK_KEY) || 0;
    const stale = joined && ok && Date.now() - ok > STALE_DAYS * 864e5;
    if (stale) lines.push(`<svg class="ic" aria-hidden="true"><use href="#i-signal"/></svg> Planning d'équipe pas vérifié depuis ${esc(agoText(ok).replace('il y a ', ''))} (pas de connexion ?) : les derniers changements de tes collègues peuvent manquer. <strong>Touche ici pour vérifier.</strong>`);
    $('teamWarn').hidden = !lines.length;
    $('teamWarn').dataset.act = stale ? 'sync' : 'key';
    $('teamWarn').innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    return ok;
  }

  let syncing = false, lastSync = 0;
  async function syncTeam(manual) {
    const code = teamCode();
    if (!code || syncing || state.workbook) return; // pas pendant un import en cours
    syncing = true; lastSync = Date.now();
    if (manual) teamMsg('Vérification…');
    try {
      const remote = await T.fetchPlan();
      store(STORAGE_SYNC_OK_KEY, String(Date.now()));
      refreshKeyInfo(false);
      if (!remote) { if (manual) teamMsg('Aucun planning publié pour l\'instant.'); return; }
      if (state.plan && state.plan.teamAt === remote.at) { if (manual) teamMsg('✓ Ton planning est à jour.', 'ok'); return; }
      // GitHub garde l'ancien fichier en cache ~5 min : juste après un envoi, la lecture peut rendre la version
      // d'AVANT. Ne jamais remplacer le planning du téléphone par une publication plus ancienne que la sienne
      // (sinon les modifications qu'on vient d'envoyer disparaissent à la réouverture).
      if (state.plan && state.plan.teamAt && remote.at && remote.at < state.plan.teamAt) {
        if (manual) teamMsg('✓ Ton planning est à jour (GitHub met quelques minutes à afficher le dernier envoi).', 'ok');
        return;
      }
      const data = await T.decrypt(remote.text, code);
      if (data.roles && newestRoles(loadRoles(), data.roles) === data.roles) saveRoles(data.roles);
      saveContacts(data.contacts || {});
      saveUtiles({ list: (data.utiles && data.utiles.list) || [], at: data.utiles && data.utiles.at, admin: data.admin || null });
      const n = applyAgents(state.plan, planToAgents(data.agents, data.remarks),
        { at: remote.at, file: 'équipe', teamAt: remote.at, teamBy: data.by || null, updated: data.updated || null });
      openOnUsefulMonth();
      renderCalendar();
      teamMsg(`✓ Nouveau planning reçu${data.by ? ' (publié par ' + data.by + ')' : ''}` +
        (n ? ` : ${n} jour${n > 1 ? 's changent' : ' change'}.` : '.'), 'ok');
    } catch (e) {
      if (manual || e.message === 'code') teamMsg(e.message === 'code'
        ? 'Le code d\'équipe a changé : saisis le nouveau code.' : errText(e), 'err');
      if (e.message === 'code') { store(STORAGE_TEAM_KEY, ''); }
    } finally {
      syncing = false;
      renderTeam();
    }
  }

  let pendingCode = '';
  // iPhone : l'icône de l'écran d'accueil a un stockage séparé de Safari (code, planning, notes)
  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  // Rejoindre depuis la carte équipe ou depuis l'accueil (champ et message différents)
  async function joinTeam(fromWelcome) {
    const input = fromWelcome ? $('wCode') : $('teamCode');
    const btn = fromWelcome ? $('wJoin') : $('teamJoin');
    const say = fromWelcome ? (text, kind) => { welcomeMsg(text, kind); teamMsg(text, kind); } : teamMsg;
    const code = T.normCode(input.value);
    if (code.split('-').length < 3 || code.length < 12) {
      say('Le code d\'équipe doit faire au moins 3 mots (ex. tarmac-cerise-boussole-neige).', 'err');
      return;
    }
    btn.disabled = true;
    say('Vérification du code…');
    try {
      const res = await T.checkCode(code);
      if (res.status === 'absent') {
        pendingCode = code;
        $('teamSetup').hidden = false;
        say('L\'équipe n\'est pas encore configurée avec ce code. Vérifie les 4 mots.');
        return;
      }
      store(STORAGE_TEAM_KEY, code);
      input.value = '';
      say('✓ Code accepté, récupération du planning…', 'ok');
      renderTeam();
      await syncTeam(true);
      if (fromWelcome) welcomeMsg(state.plan && Object.keys(state.plan.agents).length
        ? '✓ Planning reçu.' : '✓ Code accepté. Aucun planning publié pour l\'instant : importe le tableau.', 'ok');
    } catch (e) {
      say(errText(e), 'err');
    } finally {
      btn.disabled = false;
    }
  }
  function welcomeMsg(text, kind) {
    $('wMsg').hidden = !text;
    $('wMsg').textContent = text || '';
    $('wMsg').className = 'w-msg ' + (kind || '');
  }

  async function setupTeam() {
    const code = pendingCode || teamCode();
    const token = $('teamToken').value.trim();
    if (!code || !token) return;
    $('teamSetupOk').disabled = true;
    teamMsg('Enregistrement de la clé…');
    try {
      const exp = $('teamTokenExp').value || null;
      await T.setupKey(code, token, load(STORAGE_NAME_KEY) || '', undefined, exp);
      store(STORAGE_TEAM_KEY, code);
      saveKeyInfo(exp);
      pendingCode = '';
      $('teamToken').value = '';
      $('teamSetup').hidden = true;
      teamMsg('✓ Équipe configurée. Importe le tableau : l\'appli te proposera de l\'envoyer à toute l\'équipe.', 'ok');
      renderTeam();
      schedulePublish();
    } catch (e) {
      teamMsg(errText(e), 'err');
    } finally {
      $('teamSetupOk').disabled = false;
    }
  }

  // Après un import, l'appli compare d'elle-même le fichier au planning de l'équipe et propose
  // l'envoi avec un aperçu (« N cases changent ») : rien ne part sans « Envoyer à l'équipe ».
  // Garde-fous : rien à proposer si le fichier ne change rien, rappel si le mois a été deviné,
  // et « Annuler l'envoi » pendant 2 minutes (republie le planning d'avant).
  const UNDO_MS = 120000;
  let publishTimer = null, undoTimer = null, undoInfo = null;
  function publishMsg(text, kind) {
    $('publishMsg').textContent = text || '';
    $('publishMsg').className = 'publish-msg ' + (kind || '');
  }
  function countChanges(before, after) {
    let n = 0;
    const a = (before && before.agents) || {}, b = after.agents;
    for (const name of new Set(Object.keys(a).concat(Object.keys(b)))) {
      const x = a[name] || {}, y = b[name] || {};
      for (const k of new Set(Object.keys(x).concat(Object.keys(y)))) if (x[k] !== y[k]) n++;
    }
    return n;
  }
  // Liste des cases qui changent, par agent (moi d'abord) : [{ name, items: [{ key, before, after }] }]
  function listChanges(before, after) {
    const a = (before && before.agents) || {}, b = after.agents, out = [];
    for (const name of new Set(Object.keys(a).concat(Object.keys(b)))) {
      const x = a[name] || {}, y = b[name] || {}, items = [];
      for (const k of new Set(Object.keys(x).concat(Object.keys(y)))) if (x[k] !== y[k]) items.push({ key: k, before: x[k] || '', after: y[k] || '' });
      if (items.length) out.push({ name, items: items.sort((p, q) => p.key.localeCompare(q.key)) });
    }
    return sortGroups(out);
  }
  // Liste « agent → date · avant → après » (aperçu d'envoi et « Modifications du dernier planning »)
  function changeGroupsHTML(groups, max, todayKey) {
    const me = load(STORAGE_NAME_KEY) || '';
    const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const cell = c => c ? chip(c) : '<span class="muted">vide</span>';
    let count = 0, html = '';
    for (const g of groups) {
      if (count >= max) break;
      const items = g.items.slice(0, max - count);
      count += items.length;
      html += `<div class="pl-agent${g.name === me ? ' me' : ''}"><p class="pl-name">${nameHTML(g.name, g.name === me)} ` +
        `<span class="muted">(${g.items.length})</span></p><ul>` +
        items.map(i => `<li${todayKey && i.key < todayKey ? ' class="pl-past"' : ''}><span class="pl-date">${esc(fmt(i.key))}</span> ${cell(i.before)} → ${cell(i.after)}</li>`).join('') + '</ul></div>';
    }
    return { html, count };
  }
  function sortGroups(groups) {
    const me = load(STORAGE_NAME_KEY) || '';
    return groups.sort((p, q) => (q.name === me) - (p.name === me) || shown(p.name).localeCompare(shown(q.name), 'fr'));
  }
  const CHANGES_SHOWN = 300;
  function renderPublishList(groups, total) {
    const box = $('publishList');
    if (!groups || !groups.length) { box.hidden = true; return; }
    const r = changeGroupsHTML(groups, CHANGES_SHOWN);
    const shownCount = r.count;
    let html = '<p class="hint pl-hint">Planning actuel de l\'équipe → ton fichier</p>' + r.html;
    if (total > shownCount) html += `<p class="muted">… et ${total - shownCount} autres.</p>`;
    box.querySelector('summary').textContent = `Voir les cases qui changent (${groups.length} agent${groups.length > 1 ? 's' : ''})`;
    $('publishListBody').innerHTML = html;
    box.open = groups.length === 1 || total <= 12;
    box.hidden = false;
  }
  function publishButtons(send, skip, undo) {
    $('publish').hidden = !send;
    $('publishSkip').hidden = !skip;
    $('publishUndo').hidden = !undo;
    $('settingsDot').hidden = !send;
  }
  function schedulePublish() {
    clearTimeout(publishTimer);
    previewRun++;
    if (!teamCode() || !state.importAgents || !state.importAgents.length) { $('publishBox').hidden = true; $('settingsDot').hidden = true; return; }
    $('publishBox').hidden = false;
    $('publishList').hidden = true;
    publishButtons(false, false, false);
    publishMsg('Comparaison avec le planning de l\'équipe…');
    publishTimer = setTimeout(previewPublish, 800); // laisse le temps de changer de feuille ou de mois
  }
  let previewRun = 0;
  async function previewPublish() {
    const run = previewRun, agents = state.importAgents;
    try {
      const remote = await T.fetchPlan();
      const current = remote ? await T.decrypt(remote.text, teamCode()) : null;
      if (run !== previewRun) return; // un autre réglage a relancé la comparaison
      const after = { agents: C.mergePlan(current, agents, minKeep()).agents };
      const n = countChanges(current, after);
      const newDate = typedUpdated() && typedUpdated() !== (current && current.updated || null) ? typedUpdated() : null;
      if (current && !n && !newDate) { publishMsg('✓ L\'équipe a déjà ce planning : rien à envoyer.', 'ok'); return; }
      if (current && !n) { // aucune case ne change, mais la date de mise à jour tapée est nouvelle : on peut l'envoyer seule
        $('publishList').hidden = true;
        publishMsg(`Aucune case ne change. Tu peux envoyer à l'équipe la date de mise à jour du tableau (${updLabel(newDate)}).`);
        $('publish').innerHTML = ICON('send') + ' Envoyer la date à l\'équipe';
        publishButtons(true, true, false);
        return;
      }
      renderPublishList(current ? listChanges(current, after) : null, n);
      const keys = agents.flatMap(a => a.entries.map(e => C.dateKey(e.date))).sort();
      const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      const period = `du ${fmt(keys[0])} au ${fmt(keys[keys.length - 1])}`;
      publishMsg((current
        ? `Ton fichier remplace la période ${period} pour toute l'équipe : ${n} case${n > 1 ? 's changent' : ' change'} ` +
          `par rapport au planning publié le ${longDate(remote.at)}${current.by ? ' par ' + current.by : ''}.`
        : `Premier planning de l'équipe : ${agents.length} agents, ${period}.`) +
        (state.result && state.result.monthAssumed ? ' Vérifie d\'abord le mois ci-dessus : il n\'est pas écrit dans le fichier.' : ''));
      $('publish').innerHTML = ICON('send') + ' Envoyer à l\'équipe';
      publishButtons(true, true, false);
    } catch (e) {
      if (run !== previewRun) return;
      publishMsg('Comparaison impossible : ' + errText(e), 'err');
      $('publish').textContent = 'Envoyer quand même';
      publishButtons(!!(e && e.message === 'reseau'), true, false);
    }
  }
  async function publishKey() {
    const key = await T.checkCode(teamCode());
    if (key.status !== 'ok') throw new Error('cle');
    return key.token;
  }
  async function doPublish() {
    publishButtons(false, false, false);
    $('publishList').hidden = true;
    publishMsg('Envoi à l\'équipe…');
    const agents = state.importAgents;
    const by = load(STORAGE_NAME_KEY) || '';
    let previous = null, n = 0;
    try {
      const token = await publishKey();
      const res = await T.publishPlan(teamCode(), token, by, current => {
        previous = current;
        const full = C.mergePlan(current, agents, minKeep());
        const merged = { agents: full.agents, remarks: full.remarks, roles: newestRoles(current && current.roles, loadRoles()),
          contacts: (current && current.contacts) || {}, ...keepShared(current), updated: typedUpdated() };
        n = countChanges(current, merged);
        if (current && !n && (merged.updated || null) === (current.updated || null)) throw new Error('identique'); // déjà envoyé
        return { plan: merged };
      });
      if (agents !== state.importAgents) return; // un autre réglage a déjà relancé l'envoi
      state.plan.teamAt = res.at;
      state.plan.teamBy = by;
      savePlan();
      renderTeam();
      publishMsg(previous && !n
        ? '✓ Date de mise à jour envoyée à l\'équipe. Tes collègues la verront à l\'ouverture de l\'appli.'
        : previous
        ? `✓ Envoyé à l'équipe : ${n} case${n > 1 ? 's changent' : ' change'}. Tes collègues le recevront à l'ouverture de l'appli.`
        : `✓ Premier planning de l'équipe envoyé (${agents.length} agents).`, 'ok');
      undoInfo = { previous, by };
      $('publishUndo').hidden = false;
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { $('publishUndo').hidden = true; undoInfo = null; }, UNDO_MS);
    } catch (e) {
      if (e.message === 'identique') { publishMsg('✓ L\'équipe a déjà ce planning.', 'ok'); return; }
      publishMsg('Pas envoyé à l\'équipe : ' + errText(e), 'err');
      $('publish').textContent = 'Réessayer l\'envoi';
      $('publish').hidden = false;
    }
  }
  async function undoPublish() {
    if (!undoInfo) return;
    const info = undoInfo;
    $('publishUndo').disabled = true;
    publishMsg('Annulation…');
    try {
      const token = await publishKey();
      const res = await T.publishPlan(teamCode(), token, info.by,
        current => ({ plan: { agents: info.previous ? info.previous.agents : {}, remarks: info.previous && info.previous.remarks || {},
          roles: info.previous && info.previous.roles || loadRoles(), contacts: (current && current.contacts) || {}, ...keepShared(current) } }));
      state.plan.teamAt = res.at;
      savePlan();
      undoInfo = null;
      $('publishUndo').hidden = true;
      publishMsg('↩︎ Envoi annulé : l\'équipe garde le planning d\'avant. Ton fichier reste sur ce téléphone seulement.', 'ok');
    } catch (e) {
      publishMsg('Annulation impossible : ' + errText(e), 'err');
    } finally {
      $('publishUndo').disabled = false;
    }
  }


  // ── Calendrier ────────────────────────────────────────────────────────────
  const WEEKDAYS = ['lu', 'ma', 'me', 'je', 've', 'sa', 'di'];
  // Sans planning sur le téléphone, le calendrier s'affiche quand même, vide (même organisation)
  const EMPTY_PLAN = { agents: {}, changes: {}, changesSeen: true, at: 'vide' };
  function planView() { return state.plan || EMPTY_PLAN; }
  function renderCalendar() {
    $('calPrint').hidden = !(state.plan && Object.keys(state.plan.agents || {}).length); // Imprimer / PDF
    const plan = planView();
    const names = orderNames(Object.keys(plan.agents));
    const empty = !names.length;
    state.lastRenderDay = C.dateKey(todayDate());
    $('calCard').hidden = false;
    $('importTitle').textContent = 'Importer un nouveau planning';
    // carte 1 ouverte tant qu'il n'y a aucun planning (ou pendant un import), repliée sinon
    if (!state.foldInit) { state.foldInit = true; $('importDetails').open = empty; }
    if (empty) $('importDetails').open = true;
    const me = load(STORAGE_NAME_KEY);
    if (!empty && !names.includes(state.cal.agent)) state.cal.agent = names.includes(me) ? me : names[0];
    const name = empty ? '' : state.cal.agent;
    const teamTab = state.tab === 'equipe';
    $('calAgent').hidden = empty;
    $('calAgent').innerHTML = nameOptions(names, null, '', true);
    if (!empty) $('calAgent').value = name;
    $('calEmptyText').textContent = empty
      ? (teamCode() ? 'Pas encore de planning sur ce téléphone : il arrivera dès qu\'un collègue l\'aura envoyé à l\'équipe. Tu peux aussi importer le tableau de service.'
        : 'Pas encore de planning sur ce téléphone : importe le tableau de service pour remplir le calendrier.')
      : 'Pas de planning pour ce mois.';

    const { y, m } = state.cal;
    $('calTitle').textContent = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const days = plan.agents[name] || {};
    const changes = new Map(((plan.changes || {})[name] || []).map(ch => [ch.key, ch]));
    const todayKey = C.dateKey(todayDate());
    const remarks = (plan.remarks || {})[name] || {};
    updateTodayPill();

    // comparaison avec un collègue (préparer un échange de poste)
    if (state.cal.compare === name || !plan.agents[state.cal.compare] || teamTab) state.cal.compare = '';
    $('calCompare').innerHTML = `<option value="">${state.cal.compare ? '✕ Arrêter de comparer' : '⇄ Comparer…'}</option>` + nameOptions(names, name, '⇄ ');
    $('calCompare').value = state.cal.compare;
    $('calCompare').classList.toggle('on', !!state.cal.compare);
    $('calCompare').hidden = empty || names.length < 2;
    const cmp = state.cal.compare ? plan.agents[state.cal.compare] : null;
    $('compareLegend').hidden = !cmp;
    if (cmp) $('compareLegend').innerHTML = `En haut <strong>${esc(shown(name))}</strong>, en bas <strong>${esc(shown(state.cal.compare))}</strong>. ` +
      '<span class="legend-swap">Cadre vert</span> : l\'un travaille pendant que l\'autre est en repos (échange possible).';
    const swapDay = k => {
      if (!cmp || !days[k] || !cmp[k]) return false;
      const a = C.dayKind(defOf(days[k])), b = C.dayKind(defOf(cmp[k]));
      return (a === 'travail' && b === 'repos') || (a === 'repos' && b === 'travail');
    };

    let html = WEEKDAYS.map(w => `<div class="cal-wd">${w}</div>`).join('');
    let inMonth = 0;
    for (const week of C.monthGrid(y, m)) {
      for (const d of week) {
        if (!d) { html += '<div class="cal-cell blank"></div>'; continue; }
        const k = C.dateKey(d), code = days[k];
        if (code) inMonth++;
        const cls = ['cal-cell'];
        if (k === todayKey) cls.push('today');
        if (k === state.cal.selected) cls.push('selected');
        if (changes.has(k) && !plan.changesSeen) cls.push('changed');
        if (C.holidayName(k)) cls.push('holiday');
        if (swapDay(k)) cls.push('swap');
        if (remarks[k]) cls.push('remark');
        html += `<button class="${cls.join(' ')}" data-key="${k}" aria-label="${d.d}${code ? ' : ' + esc(codeLabel(code)) : ''}">` +
          `<span class="n">${d.d}</span>${code ? chip(code) : ''}` +
          (cmp ? `<span class="cmp-chip">${cmp[k] ? chip(cmp[k]) : '<span class="chip cmp-none">·</span>'}</span>` : '') +
          `${notes[k] ? '<span class="note-dot" aria-label="note"><svg class="ic" aria-hidden="true"><use href="#i-note"/></svg></span>' : ''}</button>`;
      }
    }
    $('calGrid').innerHTML = html;
    // onglet Équipe : le tableau de toute l'équipe ; onglet Planning : Mois ou Liste
    const view = teamTab ? 'team' : state.cal.view;
    $('calGrid').hidden = view !== 'month';
    $('calList').hidden = view !== 'list';
    $('calTeam').hidden = view !== 'team' || empty;
    $('calGrid').classList.toggle('comparing', !!cmp);
    $('viewMonth').setAttribute('aria-selected', String(view === 'month'));
    $('viewList').setAttribute('aria-selected', String(view === 'list'));
    if (view === 'list') renderList(days, changes, todayKey, cmp, swapDay, remarks);
    if (view === 'team' && !empty) renderTeamTable(plan, names, me && names.includes(me) ? me : name, todayKey);
    $('calEmpty').hidden = teamTab ? !empty : inMonth > 0;
    renderWelcome(names);
    renderSummary(days);
    renderNextDays();
    renderRemind();
    renderMeCard(names);
    renderPreview();

    renderChangesLink(plan);
    // changements apportés par le dernier tableau importé
    const list = [...changes.values()].filter(ch => ch.key >= todayKey);
    const box = $('calChanges');
    box.hidden = plan.changesSeen || !list.length;
    $('teamChangesBtn').classList.toggle('dup', !box.hidden); // onglet Planning : le bandeau suffit
    if (!box.hidden) {
      const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      box.innerHTML = `<strong><svg class="ic" aria-hidden="true"><use href="#i-bell"/></svg> ${list.length} jour${list.length > 1 ? 's ont' : ' a'} changé dans le nouveau planning :</strong><ul>` +
        list.slice(0, 8).map(ch => `<li>${esc(fmt(ch.key))} : ${esc(codeTitle(ch.before))} → <strong>${esc(codeTitle(ch.after))}</strong></li>`).join('') +
        (list.length > 8 ? `<li>… et ${list.length - 8} autre${list.length - 8 > 1 ? 's' : ''} (marqués d'un point)</li>` : '') +
        '</ul><button id="calChangesOk">J\'ai vu</button>' +
        '<button id="calChangesAll" class="primary" type="button">Voir toutes les modifications</button>' +
        '<button id="calChangesExport" class="link" type="button"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg> Mettre à jour l\'agenda du téléphone</button>';
    }
    renderDay();
  }

  // Résumé du mois ou de l'année : jours travaillés (détail Matin / Soir / Nuit), repos, congés,
  // autres, puis dimanches / fériés / nuits travaillés (majorations)
  function renderSummary(days) {
    const year = state.cal.sum === 'year';
    const prefix = year ? String(state.cal.y) : String(state.cal.y) + String(state.cal.m).padStart(2, '0');
    const any = Object.keys(days || {}).some(k => k.slice(0, prefix.length) === prefix);
    $('sumMonth').setAttribute('aria-selected', String(!year));
    $('sumYear').setAttribute('aria-selected', String(year));
    $('sumYear').textContent = 'Année ' + state.cal.y;
    $('calTally').classList.toggle('empty', !any); // même résumé, à zéro, tant qu'il n'y a pas de planning
    const keys = Object.keys(days || {}).filter(k => k.slice(0, 4) === String(state.cal.y)).sort();
    $('sumNote').hidden = !year || !any;
    if (year && keys.length) {
      const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      $('sumNote').textContent = `D'après les plannings gardés sur ce téléphone, du ${fmt(keys[0])} au ${fmt(keys[keys.length - 1])}.`;
    }
    const s = C.monthSummary(days, state.codes, state.cal.y, year ? null : state.cal.m);
    const groups = [['travail', 'Jours travaillés'], ['repos', 'Repos'], ['conge', 'Congés'], ['autre', 'Autres']];
    let html = groups.filter(([k]) => s[k].total || k === 'travail' || k === 'repos').map(([k, title]) =>
      `<div class="sum-row sum-${k}"><span class="sum-n">${s[k].total}</span><span class="sum-title">${title}</span>` +
      `<span class="sum-detail">${s[k].detail.map(d =>
        `<span class="sum-item">${chip(d.code)} ${d.n} ${esc(codeLabel(d.code))}</span>`).join('')}</span></div>`).join('');
    const fmtShort = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const extra = [];
    extra.push(`<span class="sum-item"><strong>${s.sundays.length}</strong> dimanche${s.sundays.length > 1 ? 's' : ''}` +
      (!year && s.sundays.length ? ` <span class="muted">(${s.sundays.map(fmtShort).map(esc).join(', ')})</span>` : '') + '</span>');
    extra.push(`<span class="sum-item"><strong>${s.holidays.length}</strong> férié${s.holidays.length > 1 ? 's' : ''}` +
      (s.holidays.length && (!year || s.holidays.length <= 4) ? ` <span class="muted">(${s.holidays.map(h => esc(h.name)).join(', ')})</span>` : '') + '</span>');
    extra.push(`<span class="sum-item"><strong>${s.nights}</strong> nuit${s.nights > 1 ? 's' : ''}</span>`);
    html += `<div class="sum-row sum-maj"><span class="sum-n"><svg class="ic" aria-hidden="true"><use href="#i-euro"/></svg></span><span class="sum-title">Travaillés en majoration</span>` +
      `<span class="sum-detail">${extra.join('')}</span></div>`;
    const hours = C.monthHours(days, state.codes, state.cal.y, year ? null : state.cal.m);
    const fmtH = min => { const h = Math.floor(min / 60), r = min % 60; return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : ''); };
    html += `<div class="sum-row sum-hours"><span class="sum-n"><svg class="ic" aria-hidden="true"><use href="#i-clock"/></svg></span><span class="sum-title">${fmtH(hours.minutes)} <span class="muted">théoriques${year ? ' sur l\'année' : ' ce mois'}</span></span>` +
      `<span class="sum-detail">${year ? '' : hours.weeks.map(w =>
        `<span class="sum-item">S${w.w} : <strong>${fmtH(w.minutes)}</strong></span>`).join('')}</span></div>`;
    $('calTally').innerHTML = html;
  }

  // ── Premier lancement : récupérer le planning, puis « Qui es-tu ? » ─────────
  const STORAGE_WELCOME_KEY = 'mh_welcome';
  // déjà installé avant cette version (planning + nom connus à l'ouverture) : pas d'accueil
  const alreadySetUp = !!(state.plan && load(STORAGE_NAME_KEY) && state.plan.agents[load(STORAGE_NAME_KEY)]);
  function renderWelcome(names) {
    const me = load(STORAGE_NAME_KEY);
    // le nom compte comme confirmé seulement s'il a été choisi (pas le premier de la liste par défaut)
    const hasPlan = names.length > 0, known = hasPlan && names.includes(me) && load('mh_name_ok') === '1';
    if (load(STORAGE_WELCOME_KEY) === 'done' || alreadySetUp) {
      if (alreadySetUp) store(STORAGE_WELCOME_KEY, 'done');
      $('welcome').hidden = true;
      return;
    }
    $('welcome').hidden = false;
    $('wTeam').classList.toggle('done', hasPlan);
    $('wWho').classList.toggle('done', known);
    $('wWho').classList.toggle('todo', hasPlan && !known);
    if (hasPlan) {
      $('wName').innerHTML = '<option value="">Choisis ton nom…</option>' + nameOptions(names);
      $('wName').value = known ? me : '';
    }
    $('wNameDone').textContent = known ? shown(me) : '';
    $('wOk').hidden = !known;
  }
  function closeWelcome() { store(STORAGE_WELCOME_KEY, 'done'); $('welcome').hidden = true; }

  // ── Aujourd'hui / Demain (toujours pour « moi ») ─────────────────────────
  function meName() {
    const me = load(STORAGE_NAME_KEY);
    return state.plan && state.plan.agents[me] ? me : state.cal.agent;
  }
  function renderNextDays() {
    const plan = planView(), me = meName();
    const days = (plan && plan.agents[me]) || {};
    const t = todayDate(), tomorrow = utc(t); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const items = [['Aujourd\'hui', t], ['Demain', { y: tomorrow.getUTCFullYear(), m: tomorrow.getUTCMonth() + 1, d: tomorrow.getUTCDate() }]];
    if (!items.some(([, d]) => days[C.dateKey(d)])) { $('nextDays').hidden = true; return; }
    $('nextDays').hidden = false;
    $('nextDays').innerHTML = items.map(([label, d]) => {
      const k = C.dateKey(d), code = days[k];
      const mates = code ? C.sameShift(plan, k, code, me) : [];
      const wd = utc(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', timeZone: 'UTC' });
      return `<button class="next-day" data-key="${k}"><span class="next-label">${label} <span class="muted">${esc(wd)}</span></span>` +
        `<span class="next-code">${code ? chip(code) + ' ' + esc(codeLabel(code)) : '<span class="muted">pas de planning</span>'}</span>` +
        (code && C.dayKind(defOf(code)) === 'travail'
          ? `<span class="next-mates">${mates.length ? 'avec ' + mates.slice(0, 3).map(n => esc(shown(n))).join(', ') + (mates.length > 3 ? ` +${mates.length - 3}` : '') : 'seul(e) en ' + esc(codeLabel(code))}</span>`
          : '') +
        (((plan.remarks || {})[me] || {})[k] ? `<span class="next-note next-remark"><svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg> ${esc(plan.remarks[me][k])}</span>` : '') +
        (notes[k] ? `<span class="next-note"><svg class="ic" aria-hidden="true"><use href="#i-note"/></svg> ${esc(notes[k])}</span>` : '') + '</button>';
    }).join('');
  }

  // ── Rappel de fin de mois : le planning du mois prochain n'est pas encore là ──
  function renderRemind() {
    const t = todayDate(), box = $('calRemind');
    const next = t.m === 12 ? { y: t.y + 1, m: 1 } : { y: t.y, m: t.m + 1 };
    const prefix = String(next.y) + String(next.m).padStart(2, '0');
    const days = (state.plan && state.plan.agents[meName()]) || {};
    box.hidden = t.d < 20 || Object.keys(days).some(k => k.slice(0, 6) === prefix);
    if (box.hidden) return;
    const month = new Date(Date.UTC(next.y, next.m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
    box.innerHTML = ICON('cal') + esc(` Le planning de ${month} n'est pas encore là. Dès qu'il sort, touche ici pour l'importer` +
      (teamCode() ? ' : l\'appli te proposera de l\'envoyer à toute l\'équipe.' : '.'));
  }

  // ── Détail d'un jour : férié, changement, équipe du jour, échanges, note perso ──
  function noteFieldHTML(k) {
    return `<label class="day-note"><span class="day-sub"><svg class="ic" aria-hidden="true"><use href="#i-note"/></svg> Ma note <span class="muted">(gardée sur ce téléphone)</span></span>` +
      `<textarea data-note="${k}" rows="2" maxlength="500" placeholder="ex. échangé avec Paul, RDV…">${esc(notes[k] || '')}</textarea></label>`;
  }
  function dayDetailHTML(k, withHead, mode) {
    const plan = planView(), name = state.cal.agent, d = keyToDate(k);
    const code = (plan.agents[name] || {})[k];
    const teamMode = mode === 'equipe', isMe = name === load(STORAGE_NAME_KEY);
    const working = !!code && C.dayKind(defOf(code)) === 'travail';
    let html = '';
    if (withHead) {
      const title = utc(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      html += `<div class="cal-day-head"><strong>${esc(title)}</strong>` +
        (code ? ` ${chip(code)} <span>${esc(codeLabel(code))}</span>` : ' <span class="muted">pas de planning</span>') + '</div>';
    }
    const holiday = C.holidayName(k);
    if (holiday) html += `<p class="day-holiday"><svg class="ic" aria-hidden="true"><use href="#i-flag"/></svg> Férié : ${esc(holiday)}</p>`;
    const remark = ((plan.remarks || {})[name] || {})[k];
    if (remark) html += `<p class="day-remark"><svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg> <span class="muted">Commentaire sur le planning :</span> ${esc(remark)}</p>`;
    const ch = ((plan.changes || {})[name] || []).find(c => c.key === k);
    if (ch && !plan.changesSeen) html += `<p class="was">Avant le nouveau planning : ${esc(codeTitle(ch.before))}</p>`;

    if (!teamMode && working) {
      const mates = C.sameShift(plan, k, code, name);
      html += `<p class="day-mates">${mates.length
        ? `<span class="muted">Avec ${isMe ? 'toi' : esc(shown(name))} :</span> ${mates.map(n => nameWithPhone(n)).join(', ')}`
        : `<span class="muted">Seul(e) en ${esc(codeLabel(code))}</span>`}</p>`;
    }
    const team = C.teamOfDay(plan, k, state.codes);
    if (team.length > 1 || (team.length === 1 && team[0].names.length > 1)) {
      const rows = team.map(g =>
        `<div class="team-row${g.code === code ? ' mine' : ''}"><span class="team-code">${chip(g.code)} ${esc(codeLabel(g.code))} <span class="muted">(${g.names.length})</span></span>` +
        `<span class="team-names">${g.names.map(n => nameWithPhone(n, n === name)).join(', ')}</span></div>`).join('');
      const total = team.reduce((n, g) => n + g.names.length, 0);
      html += teamMode
        ? `<div class="day-team"><p class="day-sub">Équipe du jour</p>${rows}</div>`
        : `<details class="day-team day-team-fold"><summary><svg class="ic" aria-hidden="true"><use href="#i-users"/></svg> <strong>Toute l'équipe ce jour-là</strong> <span class="muted">(${total})</span></summary>${rows}</details>`;
    }
    if (working && k >= C.dateKey(todayDate())) html += swapHTML(plan, name, k, code, isMe);
    if (!teamMode) html += notes[k] ? noteFieldHTML(k) : `<button class="link note-add" type="button" data-note-add="${k}"><svg class="ic" aria-hidden="true"><use href="#i-note"/></svg> Ajouter une note</button>`;
    return html;
  }

  // Permutations possibles un jour travaillé, de la meilleure à la moins intéressante (C.swapOptions)
  const SWAP_SHOWN = 6;
  function swapHTML(plan, name, k, code, isMe) {
    const r = C.swapOptions(plan, name, k, state.codes, { today: C.dateKey(todayDate()) });
    const n = r.options.length;
    if (isMe) state.swapCtx = { k, code, options: r.options };
    const fmt = key => utc(keyToDate(key)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
    const hm = min => Math.floor(min / 60) + ' h' + (min % 60 ? ' ' + String(min % 60).padStart(2, '0') : '');
    const item = (o, i) => {
      const what = o.type === 'meme-jour'
        ? `son ${chip(o.code)} ${esc(codeLabel(o.code))} contre ton ${chip(code)}, <span class="muted">le même jour</span>`
        : `prend ton ${chip(code)} ; tu prends son ${chip(o.backCode)} le <strong>${esc(fmt(o.back))}</strong>`;
      const tags = [];
      if (i === 0 && o.gap >= 660) tags.push('<span class="swap-tag best"><svg class="ic" aria-hidden="true"><use href="#i-star"/></svg> Meilleure option</span>');
      if (o.gap < 660) tags.push(`<span class="swap-tag warn"><svg class="ic" aria-hidden="true"><use href="#i-alert"/></svg> repos de ${hm(o.gap)} seulement</span>`);
      if (o.weekMin > 48 * 60) tags.push(`<span class="swap-tag warn">semaine de ${hm(o.weekMin)}</span>`);
      if (o.overHours) tags.push(`<span class="swap-tag warn">au-delà des ${o.overHours} h du contrat</span>`);
      if (o.run >= 6) tags.push(`<span class="swap-tag">${o.run} jours d'affilée</span>`);
      return `<li${i >= SWAP_SHOWN ? ' class="swap-more" hidden' : ''}>${nameWithPhone(o.name)}${o.type === 'meme-jour' ? ' :' : ''} ${what}` +
        (tags.length ? ' ' + tags.join(' ') : '') +
        (isMe ? ` <button class="swap-ask" type="button" data-swap="${i}"><svg class="ic" aria-hidden="true"><use href="#i-mail"/></svg> Proposer</button>` : '') + '</li>';
    };
    let html = `<details class="day-swap"><summary><svg class="ic" aria-hidden="true"><use href="#i-swap"/></svg> <strong>Permutations possibles</strong> ` +
      `<span class="muted">(${n ? n + ' solution' + (n > 1 ? 's' : '') : 'aucune'})</span></summary>`;
    if (n) {
      html += '<ol class="swap-list">' + r.options.map(item).join('') + '</ol>';
      if (n > SWAP_SHOWN) html += `<button class="link swap-all" type="button">Voir les ${n - SWAP_SHOWN} autres</button>`;
    } else html += '<p class="muted">Aucune permutation qui respecte les règles ci-dessous.</p>';
    if (r.free.length) html += `<p class="muted">En repos ce jour-là, sans jour à rendre trouvé : ${r.free.map(f => nameWithPhone(f)).join(', ')}</p>`;
    html += '<p class="hint">Classement : 11 h de repos ou plus d\'abord, puis même jour, jour rendu proche, même horaire. ' +
      'Semaine de plus de 48 h classée après. Jamais moins de 9 h de repos, plus de 6 jours ni plus de 3 nuits d\'affilée, ni plus de 3 jours par semaine pour un mi-temps (toi et ton collègue). Jour rendu : jusqu\'à un mois avant ou après.</p></details>';
    return html;
  }

  // Vue « Équipe » : tous les agents en lignes, les jours du mois en colonnes (comme le tableau Excel)
  // Lignes de la vue Équipe pour des jours donnés (aussi pour l'impression) : seulement les agents qui ont un code
  // ces jours-là (sauf moi) ; un même nom écrit autrement d'un tableau à l'autre (« BLANCKAERT 1/2 T (2) » /
  // « BLANCKAERT ») fait une seule ligne s'ils ne travaillent jamais les mêmes jours (deux homonymes, eux, se chevauchent)
  function teamRowsFor(plan, names, me, keys) {
    const inPeriod = n => keys.some(k => (plan.agents[n] || {})[k]);
    const ordered = teamOrder(names, me).filter(n => n === me || inPeriod(n));
    const byBase = new Map();
    for (const n of ordered) { const b = C.splitName(n).base.toUpperCase(); if (!byBase.has(b)) byBase.set(b, []); byBase.get(b).push(n); }
    const rows = [], used = new Set();
    for (const n of ordered) {
      if (used.has(n)) continue;
      const group = byBase.get(C.splitName(n).base.toUpperCase());
      const overlap = group.length > 1 && keys.some(k => group.filter(x => (plan.agents[x] || {})[k]).length > 1);
      const members = overlap ? [n] : group;
      members.forEach(x => used.add(x));
      // nom affiché : celui qui a le plus de jours ce mois-ci (le nom du tableau le plus récent, en pratique)
      const count = x => keys.filter(k => (plan.agents[x] || {})[k]).length;
      const main = members.includes(me) ? me : members.slice().sort((a, b) => count(b) - count(a))[0];
      const days = Object.assign({}, ...members.map(x => plan.agents[x] || {}));
      const remarks = Object.assign({}, ...members.map(x => (plan.remarks || {})[x] || {}));
      rows.push({ name: main, days, remarks, me: members.includes(me) });
    }
    return rows;
  }

  // Date « mise à jour » du tableau, tapée après l'import (#updDate) : AAAAMMJJ ou null
  function typedUpdated() { const v = $('updDate') && $('updDate').value; return /^\d{4}-\d{2}-\d{2}$/.test(v || '') ? v.replace(/-/g, '') : null; }
  function updLabel(k, long) {
    return utc(keyToDate(k)).toLocaleDateString('fr-FR', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  // ── « Modifications du dernier planning » : toute l'équipe, gardées jusqu'au planning suivant (plan.changes) ──
  function changeGroupsOf(plan) {
    return sortGroups(Object.keys((plan && plan.changes) || {}).filter(n => plan.changes[n].length)
      .map(n => ({ name: n, items: plan.changes[n].slice().sort((a, b) => a.key.localeCompare(b.key)) })));
  }
  function openChanges() {
    const plan = planView(), groups = changeGroupsOf(plan), todayKey = C.dateKey(todayDate());
    const total = groups.reduce((n, g) => n + g.items.length, 0);
    const when = plan.changesAt ? longDate(plan.changesAt) : '';
    const src = plan.changesFrom === 'équipe' ? 'reçu de l\'équipe' : 'importé';
    let html = (plan.changesUpdated ? `<p class="pl-updated">${ICON('clock')}<span>Tableau de service mis à jour le <strong>${esc(updLabel(plan.changesUpdated, true))}</strong></span></p>` : '') +
      `<p class="hint">Planning ${esc(src)}${when ? ' le ' + esc(when) : ''}` +
      (plan.changesSince ? `, comparé au précédent (du ${esc(longDate(plan.changesSince))})` : '') + '. Ancien code → nouveau code.</p>';
    if (!groups.length) html += '<p class="muted">Aucune case n\'a changé avec le dernier planning.</p>';
    else {
      const r = changeGroupsHTML(groups, 1000, todayKey);
      html += `<p><strong>${total} case${total > 1 ? 's' : ''}</strong> pour ${groups.length} agent${groups.length > 1 ? 's' : ''}` +
        ' <span class="muted">(jours passés en gris)</span></p>' + r.html;
    }
    $('changesBody').innerHTML = html;
    $('changesSheet').hidden = false;
    $('changesSheet').querySelector('.sheet-panel').scrollTop = 0;
    document.body.classList.add('sheet-open');
  }
  function closeChanges() {
    $('changesSheet').hidden = true;
    if ($('utilesSheet').hidden && $('daySheet').hidden && $('printSheet').hidden) document.body.classList.remove('sheet-open');
  }
  function renderChangesLink(plan) {
    const groups = changeGroupsOf(plan), total = groups.reduce((n, g) => n + g.items.length, 0);
    const btn = $('teamChangesBtn');
    btn.hidden = !total;
    btn.classList.toggle('seen', !!plan.changesSeen);
    if (total) btn.innerHTML = ICON('bell') +
      `<span class="cl-text"><strong>${plan.changesUpdated ? 'Dernier planning modifié le ' + esc(updLabel(plan.changesUpdated)) : 'Le dernier planning a changé'}</strong><span class="cl-sub">${total} case${total > 1 ? 's' : ''} modifiée${total > 1 ? 's' : ''} · ${groups.length} agent${groups.length > 1 ? 's' : ''}</span></span>` +
      '<span class="cl-go">Voir ›</span>';
  }

  // ── Imprimer / PDF : mon planning (seulement le mien), celui de l'équipe, ou les deux ; mois affiché ou période ──
  // La page à imprimer est fabriquée sur le téléphone dans #printArea (seule partie imprimée, voir @media print).
  const PRINT_MAX_DAYS = 93;
  const isoOf = k => k.slice(0, 4) + '-' + k.slice(4, 6) + '-' + k.slice(6, 8);
  const keyOf = iso => String(iso || '').replace(/-/g, '');
  function monthBounds(y, m) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [C.dateKey({ y, m, d: 1 }), C.dateKey({ y, m, d: last })];
  }
  function printChoice(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; }
  function openPrint() {
    const me = load(STORAGE_NAME_KEY) || '';
    const hasMe = !!(me && planView().agents[me]);
    $('prMeName').textContent = hasMe ? '(' + nameText(me) + ')' : '';
    $('prNoMe').hidden = hasMe;
    document.querySelectorAll('input[name="prWhat"]').forEach(r => { r.disabled = !hasMe && r.value !== 'team'; });
    const what = !hasMe || state.tab === 'equipe' ? 'team' : 'me';
    document.querySelector(`input[name="prWhat"][value="${what}"]`).checked = true;
    const { y, m } = state.cal, [a, b] = monthBounds(y, m);
    $('prMonthLabel').textContent = 'Le mois affiché (' + utc({ y, m, d: 1 }).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }) + ')';
    if (!printChoice('prWhen')) document.querySelector('input[name="prWhen"][value="month"]').checked = true;
    if (printChoice('prWhen') === 'month' || !$('prFrom').value) { $('prFrom').value = isoOf(a); $('prTo').value = isoOf(b); }
    $('prRange').hidden = printChoice('prWhen') !== 'range';
    $('prMsg').hidden = true;
    $('printSheet').hidden = false;
    document.body.classList.add('sheet-open');
  }
  function closePrint() {
    $('printSheet').hidden = true;
    if ($('utilesSheet').hidden && $('daySheet').hidden) document.body.classList.remove('sheet-open');
  }
  // découpe [from, to] en morceaux d'un mois : [{ y, m, from, to }]
  function monthSegments(from, to) {
    const out = [];
    let y = +from.slice(0, 4), m = +from.slice(4, 6);
    for (let guard = 0; guard < 24; guard++) {
      const [a, b] = monthBounds(y, m);
      if (a > to) break;
      out.push({ y, m, from: a < from ? from : a, to: b > to ? to : b });
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }
  function periodLabel(seg) {
    const raw = utc({ y: seg.y, m: seg.m, d: 1 }).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const month = raw.charAt(0).toUpperCase() + raw.slice(1);
    const [a, b] = monthBounds(seg.y, seg.m);
    if (seg.from === a && seg.to === b) return month;
    return month + ' · du ' + +seg.from.slice(6) + ' au ' + +seg.to.slice(6);
  }
  function legendHTML(codes) {
    const order = state.codes.map(c => C.normCode(c.code));
    const list = [...codes].sort((a, b) => ((order.indexOf(a) + 1) || 999) - ((order.indexOf(b) + 1) || 999) || a.localeCompare(b));
    return list.length ? '<p class="pr-legend">' + list.map(c => `<span>${chip(c)} ${esc(codeLabel(c))}</span>`).join('') + '</p>' : '';
  }
  const printedOn = () => 'Planning COA · imprimé le ' + new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  function printMePage(plan, me, seg) {
    const days = plan.agents[me] || {}, remarks = (plan.remarks || {})[me] || {};
    const used = new Set();
    let worked = 0, rest = 0, leave = 0, other = 0, minutes = 0;
    const byCode = {};
    let html = `<section class="pr-page pr-me"><header class="pr-head"><h1>Planning de ${esc(nameText(me))}</h1>` +
      `<p>${esc(periodLabel(seg))}</p></header><table class="pr-cal"><thead><tr>` +
      ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(d => `<th>${d}</th>`).join('') + '</tr></thead><tbody>';
    for (const week of C.monthGrid(seg.y, seg.m)) {
      html += '<tr>';
      for (const d of week) {
        if (!d) { html += '<td class="pr-out"></td>'; continue; }
        const k = C.dateKey(d), inside = k >= seg.from && k <= seg.to;
        const code = inside ? days[k] : '', hol = C.holidayName(k), wd = utc(d).getUTCDay();
        if (code) {
          used.add(code);
          const def = defOf(code), kind = C.dayKind(def);
          if (kind === 'travail') { worked++; byCode[code] = (byCode[code] || 0) + 1; }
          else if (kind === 'repos') rest++; else if (kind === 'conge') leave++; else other++;
          minutes += C.codeMinutes(def);
        }
        const cls = [!inside ? 'pr-off' : '', wd === 0 || wd === 6 ? 'pr-we' : '', hol ? 'pr-hol' : ''].filter(Boolean).join(' ');
        html += `<td class="${cls}"><span class="pr-num">${d.d}</span>` + (hol && inside ? `<span class="pr-holname">${esc(hol)}</span>` : '') +
          (code ? `<div class="pr-code">${chip(code)}<span>${esc(codeLabel(code))}</span></div>` : '') +
          (inside && remarks[k] ? `<div class="pr-remark">${esc(remarks[k])}</div>` : '') + '</td>';
      }
      html += '</tr>';
    }
    const h = Math.floor(minutes / 60), mn = minutes % 60;
    const detail = Object.keys(byCode).map(c => `${byCode[c]} ${esc(codeLabel(c))}`).join(', ');
    html += '</tbody></table><p class="pr-sum">' +
      `<strong>${worked}</strong> jour${worked > 1 ? 's' : ''} travaillé${worked > 1 ? 's' : ''}` + (detail ? ` (${detail})` : '') +
      ` · <strong>${rest}</strong> repos` + (leave ? ` · <strong>${leave}</strong> congé${leave > 1 ? 's' : ''}` : '') +
      (other ? ` · <strong>${other}</strong> autre${other > 1 ? 's' : ''}` : '') +
      (minutes ? ` · <strong>${h} h${mn ? ' ' + String(mn).padStart(2, '0') : ''}</strong> théoriques` : '') + '</p>' +
      legendHTML(used) + `<footer class="pr-foot">${esc(printedOn())}</footer></section>`;
    return html;
  }
  function printTeamPage(plan, me, seg) {
    const names = Object.keys(plan.agents);
    const keys = [];
    for (let k = seg.from; k <= seg.to; k = C.dateKey((d => { const t = new Date(Date.UTC(d.y, d.m - 1, d.d + 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; })(keyToDate(k)))) keys.push(k);
    const rows = teamRowsFor(plan, names, me, keys);
    const used = new Set();
    let html = `<section class="pr-page pr-team"><header class="pr-head"><h1>Planning de l'équipe</h1>` +
      `<p>${esc(periodLabel(seg))}</p></header><table class="pr-tt"><colgroup><col class="pr-tt-name">` +
      keys.map(() => '<col>').join('') + '</colgroup><thead><tr><th></th>';
    for (const k of keys) {
      const d = keyToDate(k), wd = utc(d).getUTCDay();
      html += `<th class="${wd === 0 || wd === 6 ? 'pr-we' : ''}${C.holidayName(k) ? ' pr-hol' : ''}"><span>${WEEKDAYS[(wd + 6) % 7].slice(0, 1).toUpperCase()}</span>${d.d}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const row of rows) {
      html += `<tr${row.me ? ' class="pr-mine"' : ''}><th>${esc(nameText(row.name))}</th>`;
      for (const k of keys) {
        const code = row.days[k], wd = utc(keyToDate(k)).getUTCDay();
        if (code) used.add(code);
        html += `<td class="${wd === 0 || wd === 6 ? 'pr-we' : ''}">${code ? chip(code) : ''}${row.remarks[k] ? '<sup>*</sup>' : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>' + legendHTML(used) +
      (rows.some(r => keys.some(k => r.remarks[k])) ? '<p class="pr-note">* commentaire sur le tableau de service</p>' : '') +
      `<footer class="pr-foot">${esc(printedOn())}</footer></section>`;
    return html;
  }
  function doPrint() {
    const plan = planView(), me = load(STORAGE_NAME_KEY) || '';
    const what = printChoice('prWhat') || 'team';
    let from, to;
    if (printChoice('prWhen') === 'range') { from = keyOf($('prFrom').value); to = keyOf($('prTo').value); }
    else [from, to] = monthBounds(state.cal.y, state.cal.m);
    const msg = t => { $('prMsg').textContent = t; $('prMsg').hidden = !t; };
    if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to)) return msg('Choisis les deux dates.');
    if (from > to) [from, to] = [to, from];
    const span = Math.round((utc(keyToDate(to)) - utc(keyToDate(from))) / 864e5) + 1;
    if (span > PRINT_MAX_DAYS) return msg('Trois mois au plus à la fois.');
    const segs = monthSegments(from, to);
    let html = '';
    // pas de page pour un mois sans aucun code (planning pas encore sorti)
    const filled = (names, seg) => names.some(n => Object.keys(plan.agents[n] || {}).some(k => k >= seg.from && k <= seg.to));
    if (what !== 'team' && me) html += segs.filter(seg => filled([me], seg)).map(seg => printMePage(plan, me, seg)).join('');
    if (what !== 'me') html += segs.filter(seg => filled(Object.keys(plan.agents), seg)).map(seg => printTeamPage(plan, me, seg)).join('');
    if (!html) return msg('Pas de planning sur le téléphone pour cette période.');
    $('printArea').innerHTML = html;
    closePrint();
    document.body.classList.add('printing');
    setTimeout(() => window.print(), 60);
  }
  window.addEventListener('afterprint', () => { document.body.classList.remove('printing'); $('printArea').innerHTML = ''; });

  function renderTeamTable(plan, names, me, todayKey) {
    const { y, m } = state.cal;
    const dates = C.monthGrid(y, m).flat().filter(Boolean);
    if (state.reorder) { renderReorder(names, me); return; }
    const keys = dates.map(d => C.dateKey(d));
    const rows = teamRowsFor(plan, names, me, keys);
    // codes présents ce mois-ci (dans l'ordre des codes) : touchés, ils sont surlignés dans le tableau
    const present = new Set();
    for (const n of names) for (const d of dates) { const c = (plan.agents[n] || {})[C.dateKey(d)]; if (c) present.add(c); }
    const order = state.codes.map(c => C.normCode(c.code));
    const legend = [...present].sort((a, b) => ((order.indexOf(a) + 1) || 999) - ((order.indexOf(b) + 1) || 999) || a.localeCompare(b));
    const hl = present.has(state.cal.hl) ? state.cal.hl : '';
    // Deux tableaux aux colonnes identiques : l'en-tête des dates reste collé en haut de l'écran (seule la page
    // défile verticalement : une seule barre de défilement), le corps défile horizontalement, synchronisé.
    const width = `style="width:${(8.6 + dates.length * 2.3).toFixed(1)}em"`;
    const cols = '<colgroup><col style="width:8.6em">' + dates.map(() => '<col style="width:2.3em">').join('') + '</colgroup>';
    let head = `<table class="team-table" ${width}>${cols}<thead><tr><th class="tt-name"></th>`;
    for (const d of dates) {
      const k = C.dateKey(d), wd = utc(d).getUTCDay();
      const cls = [wd === 0 || wd === 6 ? 'we' : '', k === todayKey ? 'today' : '', k === state.cal.selected ? 'sel' : '', C.holidayName(k) ? 'hol' : ''].filter(Boolean).join(' ');
      head += `<th class="${cls}" data-key="${k}"><span>${WEEKDAYS[(wd + 6) % 7].slice(0, 1).toUpperCase()}</span>${d.d}</th>`;
    }
    head += '</tr></thead></table>';
    let html = `<table class="team-table${hl ? ' hl-on' : ''}" ${width}>${cols}<tbody>`;
    for (const row of rows) {
      if (row.header) { html += `<tr class="tt-group"><th class="tt-name" scope="rowgroup">${esc(row.header)}</th><td colspan="${dates.length}"></td></tr>`; continue; }
      const n = row.name;
      const days = row.days;
      html += `<tr${row.me ? ' class="me"' : ''}><th class="tt-name" scope="row">${esc(shown(n))}${tagsHTML(n)}</th>`;
      for (const d of dates) {
        const k = C.dateKey(d), wd = utc(d).getUTCDay();
        const cls = [wd === 0 || wd === 6 ? 'we' : '', k === todayKey ? 'today' : '', k === state.cal.selected ? 'sel' : '',
          hl && days[k] === hl ? 'hl' : ''].filter(Boolean).join(' ');
        const rk = row.remarks[k];
        html += `<td class="${cls}${rk ? ' remark' : ''}" data-key="${k}"${rk ? ` title="${esc(rk)}"` : ''}>${days[k] ? chip(days[k]) : ''}${rk ? '<span class="tt-remark"><svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg></span>' : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody>';
    if (hl) {
      html += `<tfoot><tr><th class="tt-name" scope="row">Total ${chip(hl)}</th>` + dates.map(d => {
        const k = C.dateKey(d), n = names.filter(x => (plan.agents[x] || {})[k] === hl).length;
        return `<td data-key="${k}">${n || ''}</td>`;
      }).join('') + '</tr></tfoot>';
    }
    html += '</table>';
    const legendHTML = legend.length > 1 ? '<div class="tt-legend"><span>Surligner :</span>' + legend.map(c =>
      `<button class="hl-btn" type="button" data-hl="${esc(c)}" aria-pressed="${c === hl}" aria-label="Surligner ${esc(codeLabel(c))}">${chip(c)}</button>`).join('') + '</div>' : '';
    $('calTeam').innerHTML = legendHTML + `<div class="tt-head"><div class="tt-head-in">${head}</div></div><div class="tt-wrap">${html}</div>` +
      '<div class="tt-tools"><button id="ttReorder" type="button">↕︎ Réorganiser les noms</button></div>' +
      `<p id="orderMsg" class="hint order-msg"${state.orderMsg ? '' : ' hidden'}>${esc(state.orderMsg || '')}</p>` +
      '<p class="hint">Touche un jour pour voir l\'équipe de ce jour-là, ou un code pour le surligner. Fais glisser le tableau pour voir tout le mois.</p>';
    const wrap = $('calTeam').querySelector('.tt-wrap'), headIn = $('calTeam').querySelector('.tt-head-in');
    wrap.addEventListener('scroll', () => { if (headIn.scrollLeft !== wrap.scrollLeft) headIn.scrollLeft = wrap.scrollLeft; }, { passive: true });
    headIn.addEventListener('scroll', () => { if (wrap.scrollLeft !== headIn.scrollLeft) wrap.scrollLeft = headIn.scrollLeft; }, { passive: true });
    const target = headIn.querySelector('th.sel, th.today');
    if (target) wrap.scrollLeft = headIn.scrollLeft = Math.max(0, target.offsetLeft - 140);
  }

  // Vue liste : les jours du mois de haut en bas ; toucher un jour déplie les collègues du même service
  function renderList(days, changes, todayKey, cmp, swapDay, remarks) {
    const { y, m } = state.cal, plan = planView();
    let html = '';
    for (const d of C.monthGrid(y, m).flat()) {
      if (!d) continue;
      const k = C.dateKey(d), code = days[k];
      const wd = utc(d).getUTCDay(); // 0 = dimanche
      const cls = ['cal-row'];
      if (wd === 1) cls.push('monday');
      if (wd === 0 || wd === 6) cls.push('weekend');
      if (k === todayKey) cls.push('today');
      if (k === state.cal.selected) cls.push('selected');
      const ch = !plan.changesSeen && changes.get(k);
      if (ch) cls.push('changed');
      const dayName = utc(d).toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');
      if (C.holidayName(k)) cls.push('holiday');
      if (swapDay(k)) cls.push('swap');
      html += `<button class="${cls.join(' ')}" data-key="${k}" aria-expanded="${k === state.cal.selected}">` +
        `<span class="cal-row-date"><span class="wd">${esc(dayName)}</span><span class="n">${d.d}</span></span>` +
        `<span class="cal-row-code">${code ? chip(code) + ' ' + esc(codeLabel(code)) : '<span class="muted">—</span>'}` +
        (ch ? ` <span class="was">avant : ${esc(codeTitle(ch.before))}</span>` : '') +
        (notes[k] ? ' <span class="note-dot"><svg class="ic" aria-hidden="true"><use href="#i-note"/></svg></span>' : '') +
        (cmp ? `<span class="cmp-inline">⇄ ${cmp[k] ? chip(cmp[k]) + ' ' + esc(codeLabel(cmp[k])) : '<span class="muted">—</span>'}</span>` : '') +
        '</span>' +
        (remarks[k] ? `<span class="row-remark"><svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg> ${esc(remarks[k])}</span>` : '') + '</button>';
      if (k === state.cal.selected) html += `<div class="cal-row-detail">${dayDetailHTML(k, false, 'planning')}</div>`;
    }
    $('calList').innerHTML = html;
  }

  // Détail d'un jour (vue Mois, vue Équipe) : panneau qui monte du bas, ouvert en touchant un jour.
  // La vue Liste garde son détail déplié dans la liste.
  function renderDay() {
    if (!state.dayOpen) return;
    const k = state.cal.selected, d = k && keyToDate(k);
    if (!d) { closeDay(); return; }
    $('calDay').innerHTML = dayDetailHTML(k, true, state.tab === 'equipe' ? 'equipe' : 'planning');
  }
  function openDay(k) {
    state.cal.selected = k;
    state.dayOpen = true;
    renderDay();
    $('daySheet').hidden = false;
    $('daySheet').querySelector('.sheet-panel').scrollTop = 0;
    document.body.classList.add('sheet-open');
  }
  function closeDay() {
    if (!state.dayOpen && $('daySheet').hidden) return;
    state.dayOpen = false;
    $('daySheet').hidden = true;
    if ($('utilesSheet').hidden) document.body.classList.remove('sheet-open');
  }

  // À l'ouverture : le mois en cours s'il a des jours, sinon le prochain mois rempli, sinon le dernier
  function openOnUsefulMonth() {
    if (!state.plan) return;
    const names = Object.keys(state.plan.agents);
    const me = load(STORAGE_NAME_KEY);
    const days = state.plan.agents[names.includes(me) ? me : orderNames(names)[0]] || {};
    const keys = Object.keys(days).sort();
    if (!keys.length) return;
    const t = todayDate(), monthKey = String(t.y) + String(t.m).padStart(2, '0');
    if (keys.some(k => k.slice(0, 6) === monthKey)) return;
    const next = keys.find(k => k.slice(0, 6) > monthKey) || keys[keys.length - 1];
    const d = keyToDate(next);
    state.cal.y = d.y; state.cal.m = d.m;
  }

  // « Aujourd'hui » n'apparaît que si on regarde un autre mois ou un autre jour
  function updateTodayPill() {
    const t = todayDate();
    $('calToday').classList.toggle('ghost', state.cal.y === t.y && state.cal.m === t.m && state.cal.selected === C.dateKey(t));
  }

  function moveMonth(delta) {
    closeDay();
    let { y, m } = state.cal;
    m += delta;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    state.cal.y = y; state.cal.m = m;
    renderCalendar();
  }

  // Toujours disponible dès qu'un planning est sur le téléphone (importé ou reçu de l'équipe), pas seulement
  // juste après un import. Planning exporté : celui de l'utilisateur, sinon celui affiché.
  function renderPreview() {
    const plan = state.plan;
    const names = plan ? Object.keys(plan.agents) : [];
    $('previewCard').hidden = !names.length;
    if (!names.length) { state.events = []; state.exportName = ''; return; }
    const me = load(STORAGE_NAME_KEY);
    const name = names.includes(me) ? me : names.includes(state.cal.agent) ? state.cal.agent : orderNames(names)[0];
    const agent = planToAgents({ [name]: plan.agents[name] }, plan.remarks)[0];
    state.exportName = agent.name;
    const built = C.buildEvents(agent.entries, state.codes);
    const unknown = built.unknown;
    const now = new Date();
    const today = C.dateKey({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
    const fromToday = $('fromToday').checked;
    const events = fromToday ? built.events.filter(e => C.dateKey(e.date) >= today) : built.events;
    const pastOnly = fromToday && built.events.length > 0 && events.length === 0;
    state.events = events;
    $('previewCard').hidden = false;

    const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    // (même après « J'ai vu » dans le calendrier : l'agenda du téléphone, lui, n'est pas encore à jour)
    const changes = ((plan.changes || {})[agent.name] || []).filter(ch => !fromToday || ch.key >= today);
    const changed = new Map(changes.map(ch => [ch.key, ch]));
    $('changes').hidden = !changes.length;
    $('changes').innerHTML = changes.length
      ? `<svg class="ic" aria-hidden="true"><use href="#i-bell"/></svg> ${changes.length} jour${changes.length > 1 ? 's ont' : ' a'} changé (marqués ci-dessous) : refais l'export pour mettre ton agenda à jour.`
      : '';

    const counts = {};
    events.forEach(e => { const t = C.eventTitle(e.def); counts[t] = (counts[t] || 0) + 1; });
    const detail = Object.keys(counts).map(k => `${counts[k]} ${esc(k)}`).join(', ');
    $('summary').innerHTML = events.length
      ? `<strong>${events.length} événement${events.length > 1 ? 's' : ''}</strong> pour ${esc(shown(agent.name))} : ${detail}.`
      : pastOnly
        ? 'Tous les jours de ce planning sont passés. Décoche « Seulement à partir d\'aujourd\'hui » pour tout exporter.'
        : 'Aucun événement à exporter avec les codes cochés.';
    $('download').disabled = !events.length;

    const unknownCodes = Object.keys(unknown);
    $('unknown').hidden = !unknownCodes.length;
    $('unknown').innerHTML = unknownCodes.length
      ? 'Codes non reconnus, ignorés pour l\'instant :<br>' + unknownCodes.map(code =>
        `<button data-add="${esc(code)}">+ ${esc(code.slice(0, 20))} (${unknown[code]})</button>`).join('')
      : '';

    const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    let html = '', lastMonth = '';
    for (const e of events) {
      const date = new Date(Date.UTC(e.date.y, e.date.m - 1, e.date.d));
      const month = monthFmt.format(date);
      if (month !== lastMonth) { html += `<tr class="month"><td colspan="2">${esc(month)}</td></tr>`; lastMonth = month; }
      const ch = changed.get(C.dateKey(e.date));
      html += `<tr${ch ? ' class="changed"' : ''}><td>${esc(dayFmt.format(date))}</td><td>${esc(C.eventTitle(e.def))}` +
        (ch ? ` <span class="was">avant : ${esc(codeTitle(ch.before))}</span>` : '') + '</td></tr>';
    }
    $('preview').innerHTML = html;
  }

  function renderCodes() {
    const colorOptions = sel => '<option value="">Aucune</option>' + Object.keys(C.COLORS).map(k =>
      `<option value="${k}" ${sel === k ? 'selected' : ''}>${C.COLORS[k].emoji} ${k}</option>`).join('');
    let html = '<tr><th title="Mettre dans l\'agenda du téléphone" aria-label="Agenda"><svg class="ic" aria-hidden="true"><use href="#i-cal"/></svg></th><th>Code</th><th>Libellé</th><th>Couleur</th><th></th></tr>';
    state.codes.forEach((c, i) => {
      html += `<tr data-i="${i}">` +
        `<td><input type="checkbox" data-f="include" ${c.include ? 'checked' : ''}></td>` +
        `<td><input type="text" class="code" data-f="code" value="${esc(c.code)}"></td>` +
        `<td><input type="text" class="label" data-f="label" value="${esc(c.label)}"></td>` +
        `<td><select data-f="color">${colorOptions(c.color)}</select></td>` +
        `<td><button data-del title="Supprimer">✕</button></td></tr>`;
    });
    $('codes').innerHTML = html;
  }

  function codesChanged(rerender) {
    store(STORAGE_CODES_KEY, JSON.stringify(state.codes));
    store(STORAGE_CODES_VERSION_KEY, String(CODES_VERSION));
    if (rerender) renderCodes();
    refresh();
    renderCalendar();
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function download() {
    if (!state.events.length) return;
    const name = state.exportName;
    const ics = C.buildICS(state.events, { name, alarm: $('alarm').checked });
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'horaires-' + C.slug(name) + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── Événements UI ─────────────────────────────────────────────────────────
  $('file').addEventListener('change', e => { readFiles(e.target.files); e.target.value = ''; });
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => readFiles(e.dataTransfer.files));
  $('sheet').addEventListener('change', () => { $('month').value = ''; refresh(); });
  $('month').addEventListener('change', refresh);

  $('teamChangesBtn').addEventListener('click', openChanges);
  $('changesSheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeChanges(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('changesSheet').hidden) closeChanges(); });
  $('updDate').addEventListener('change', () => {
    if (!state.plan) return;
    state.plan.updated = typedUpdated();
    $('updRow').classList.toggle('filled', !!state.plan.updated); // cadre vert une fois la date saisie
    state.plan.changesUpdated = state.plan.updated; // ce tableau vient d'être importé : c'est sa date
    savePlan();
    renderCalendar();
    if (teamCode() && state.importAgents) schedulePublish(); // la date seule peut justifier un envoi
  });
  $('calPrint').addEventListener('click', openPrint);
  $('printSheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closePrint(); });
  $('printSheet').addEventListener('change', e => {
    if (e.target.name === 'prWhen') { $('prRange').hidden = e.target.value !== 'range'; $('prMsg').hidden = true; }
  });
  $('prGo').addEventListener('click', doPrint);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('printSheet').hidden) closePrint(); });
  $('calPrev').addEventListener('click', () => moveMonth(-1));
  $('calNext').addEventListener('click', () => moveMonth(1));
  $('calToday').addEventListener('click', () => {
    const t = todayDate();
    state.cal.y = t.y; state.cal.m = t.m; state.cal.selected = C.dateKey(t);
    renderCalendar();
  });
  // regarder le planning d'un collègue ne change pas « Je suis » (sinon ton numéro ou tes envois partiraient à son nom)
  $('calAgent').addEventListener('change', e => {
    state.cal.agent = e.target.value;
    renderCalendar();
  });
  ['viewMonth', 'viewList'].forEach(id => $(id).addEventListener('click', e => {
    state.cal.view = e.currentTarget.dataset.view;
    store(STORAGE_VIEW_KEY, state.cal.view);
    renderCalendar();
    if (state.cal.view === 'list') scrollToSelected();
  }));
  // Glisser-déposer des noms (poignée ☰), au doigt comme à la souris
  let drag = null;
  $('calTeam').addEventListener('pointerdown', e => {
    const handle = e.target.closest('.ro-handle');
    if (!handle) return;
    e.preventDefault();
    const li = handle.closest('li');
    const rect = li.getBoundingClientRect();
    drag = { li, id: e.pointerId, offset: e.clientY - rect.top, dy: 0 };
    li.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  });
  $('calTeam').addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const li = drag.li;
    const place = () => {
      const natural = li.getBoundingClientRect().top - drag.dy;
      drag.dy = e.clientY - drag.offset - natural;
      li.style.transform = `translateY(${drag.dy}px)`;
    };
    place();
    // échange avec le voisin dès que le doigt passe sa moitié
    const prev = li.previousElementSibling, next = li.nextElementSibling;
    if (prev && e.clientY < prev.getBoundingClientRect().top + prev.offsetHeight / 2) { li.parentNode.insertBefore(li, prev); place(); }
    else if (next && e.clientY > next.getBoundingClientRect().top + next.offsetHeight / 2) { li.parentNode.insertBefore(next, li); place(); }
    // défilement automatique près des bords de l'écran
    if (e.clientY < 70) window.scrollBy(0, -12);
    else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12);
  });
  const endDrag = e => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag.li.classList.remove('dragging');
    drag.li.style.transform = '';
    state.reorderList = [...$('roList').children].map(li => li.dataset.name);
    drag = null;
  };
  $('calTeam').addEventListener('pointerup', endDrag);
  $('calTeam').addEventListener('pointercancel', endDrag);

  $('calCompare').addEventListener('change', e => { state.cal.compare = e.target.value; renderCalendar(); });
  $('calTeam').addEventListener('click', e => {
    const hlBtn = e.target.closest('.hl-btn');
    if (hlBtn) { state.cal.hl = state.cal.hl === hlBtn.dataset.hl ? '' : hlBtn.dataset.hl; renderCalendar(); return; }
    const id = e.target.id;
    if (id === 'ttReorder') { state.reorder = true; state.reorderList = null; state.orderMsg = ''; renderCalendar(); return; }
    if (e.target.closest('.ro-edit')) {
      const li = e.target.closest('li'), span = li.querySelector('.ro-name');
      if (!span) return;
      const input = document.createElement('input');
      input.type = 'text'; input.className = 'ro-input'; input.maxLength = 40;
      input.value = ((loadRoles() || {}).alias || {})[li.dataset.name] || li.dataset.name;
      input.setAttribute('aria-label', 'Nom affiché');
      span.replaceWith(input); e.target.closest('.ro-edit').remove(); input.focus(); input.select();
      return;
    }
    if (id === 'roDone') { saveOrder(state.reorderList.slice()); return; }
    if (id === 'roReset') { saveOrder(null); return; }
    if (id === 'roCancel') { state.reorder = false; state.reorderList = null; renderCalendar(); return; }
    const cell = e.target.closest('[data-key]');
    if (!cell) return;
    state.cal.selected = cell.dataset.key;
    renderCalendar();
    openDay(cell.dataset.key);
  });
  function scrollToSelected() {
    const row = $('calList').querySelector('.cal-row.selected') || $('calList').querySelector('.cal-row.today');
    if (row) row.scrollIntoView({ block: 'center' });
  }
  // notes : enregistrées à la frappe ; l'indicateur 📝 est mis à jour à la sortie du champ
  ['calDay', 'calList'].forEach(id => {
    $(id).addEventListener('input', e => { if (e.target.dataset.note) saveNote(e.target.dataset.note, e.target.value); });
    $(id).addEventListener('focusout', e => {
      if (!e.target.dataset.note) return;
      const k = e.target.dataset.note;
      document.querySelectorAll(`[data-key="${k}"]`).forEach(el => {
        const host = el.classList.contains('cal-row') ? el.querySelector('.cal-row-code') : el;
        const dot = host && host.querySelector('.note-dot');
        if (notes[k] && !dot && host) host.insertAdjacentHTML('beforeend', '<span class="note-dot"><svg class="ic" aria-hidden="true"><use href="#i-note"/></svg></span>');
        if (!notes[k] && dot) dot.remove();
      });
      renderNextDays();
    });
  });
  $('nextDays').addEventListener('click', e => {
    const b = e.target.closest('.next-day[data-key]');
    if (!b) return;
    const d = keyToDate(b.dataset.key);
    state.cal.y = d.y; state.cal.m = d.m; state.cal.selected = b.dataset.key;
    const me = meName();
    if (me) state.cal.agent = me;
    renderCalendar();
    if (state.cal.view === 'list') scrollToSelected();
    else openDay(b.dataset.key);
  });
  ['sumMonth', 'sumYear'].forEach(id => $(id).addEventListener('click', e => {
    state.cal.sum = e.currentTarget.dataset.scope;
    store(STORAGE_SUM_KEY, state.cal.sum);
    renderSummary(planView().agents[state.cal.agent] || {});
  }));
  $('calList').addEventListener('click', e => {
    const row = e.target.closest('.cal-row[data-key]');
    if (!row) return; // clic dans le détail déplié (note…) : on ne referme pas
    state.cal.selected = state.cal.selected === row.dataset.key ? '' : row.dataset.key;
    renderCalendar();
  });
  $('calGrid').addEventListener('click', e => {
    const cell = e.target.closest('.cal-cell[data-key]');
    if (!cell) return;
    state.cal.selected = cell.dataset.key;
    $('calGrid').querySelectorAll('.selected').forEach(x => x.classList.remove('selected'));
    cell.classList.add('selected');
    updateTodayPill();
    openDay(cell.dataset.key);
  });
  // panneau du jour : fermer (fond, ✕, Échap, glisser vers le bas)
  $('daySheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) closeDay(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && state.dayOpen) closeDay(); });
  (() => {
    const panel = $('daySheet').querySelector('.sheet-panel');
    let y0 = null;
    panel.addEventListener('touchstart', e => { y0 = panel.scrollTop <= 0 ? e.touches[0].clientY : null; }, { passive: true });
    panel.addEventListener('touchend', e => {
      if (y0 != null && e.changedTouches[0].clientY - y0 > 80) closeDay();
      y0 = null;
    }, { passive: true });
  })();
  // « Voir les N autres » permutations (détail du jour, vue Mois ou Liste)
  document.addEventListener('click', e => {
    const btn = e.target.closest('.swap-all');
    if (!btn) return;
    btn.closest('.day-swap').querySelectorAll('.swap-more').forEach(li => { li.hidden = false; });
    btn.remove();
  });
  $('calChanges').addEventListener('click', e => {
    if (e.target.id === 'calChangesExport') { goTo('export'); return; }
    if (e.target.id === 'calChangesAll') { openChanges(); return; }
    if (e.target.id !== 'calChangesOk') return;
    if (!state.plan) return;
    state.plan.changesSeen = true;
    savePlan();
    renderCalendar();
  });
  // glisser à gauche / à droite pour changer de mois
  let touchX = null, touchY = null;
  ['calGrid', 'calList'].forEach(id => {
    $(id).addEventListener('touchstart', e => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
    $(id).addEventListener('touchend', e => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
      touchX = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) moveMonth(dx < 0 ? 1 : -1);
    }, { passive: true });
  });
  $('download').addEventListener('click', download);
  $('alarm').checked = load('mh_alarm') !== '0';
  $('alarm').addEventListener('change', e => store('mh_alarm', e.target.checked ? '1' : '0'));
  $('fromToday').checked = load(STORAGE_FROM_TODAY_KEY) !== '0';
  $('fromToday').addEventListener('change', e => {
    store(STORAGE_FROM_TODAY_KEY, e.target.checked ? '1' : '0');
    renderPreview();
  });

  const SHARE_URL = 'https://planning-equipe-coa.github.io/horaires/';
  $('shareLink').addEventListener('click', async () => {
    const btn = $('shareLink');
    if (navigator.share) {
      try { await navigator.share({ title: 'Planning COA', url: SHARE_URL }); } catch (e) { /* partage annulé */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(SHARE_URL);
      btn.textContent = 'Lien copié ✓';
    } catch (e) {
      btn.textContent = SHARE_URL;
    }
    setTimeout(() => { btn.textContent = 'Envoyer le lien'; }, 2500);
  });

  $('unknown').addEventListener('click', e => {
    const code = e.target.dataset.add;
    if (!code) return;
    state.codes.push({ code, label: code, allDay: true, start: '', end: '', include: true, color: '' });
    $('codesDetails').open = true;
    codesChanged(true);
  });

  $('codes').addEventListener('change', e => {
    const tr = e.target.closest('tr[data-i]');
    const field = e.target.dataset.f;
    if (!tr || !field) return;
    const c = state.codes[+tr.dataset.i];
    c[field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value.trim();
    codesChanged(false);
  });
  $('codes').addEventListener('click', e => {
    if (!('del' in e.target.dataset)) return;
    state.codes.splice(+e.target.closest('tr').dataset.i, 1);
    codesChanged(true);
  });
  $('addCode').addEventListener('click', () => {
    state.codes.push({ code: '', label: '', allDay: true, start: '', end: '', include: true, color: '' });
    codesChanged(true);
  });
  $('resetCodes').addEventListener('click', () => {
    state.codes = cloneDefaults();
    codesChanged(true);
  });

  // hors connexion : l'appli s'ouvre même sans réseau (voir sw.js)
  // L'appli s'ouvre depuis la copie du téléphone (instantané, même sans réseau) ; sw.js vérifie en arrière-plan
  // s'il y a une nouvelle version et prévient : bandeau « Nouvelle version de l'appli · Afficher ».
  const swOK = 'serviceWorker' in navigator && location.protocol !== 'file:';
  if (swOK) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* pas de hors connexion, l'appli marche quand même */ });
    });
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'update') $('updateBar').hidden = false;
    });
  }
  $('updateGo').addEventListener('click', () => location.reload());

  $('teamJoin').addEventListener('click', () => joinTeam(false));
  $('teamCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinTeam(false); });
  $('wJoin').addEventListener('click', () => joinTeam(true));
  $('wCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinTeam(true); });
  $('wPaste').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) { $('wCode').value = text.trim(); joinTeam(true); return; }
      welcomeMsg('Le presse-papier est vide : copie d\'abord le code (depuis Safari ou le message d\'un collègue).', 'err');
    } catch (e) {
      $('wCode').focus();
      welcomeMsg('Fais un appui long dans le champ puis « Coller ».');
    }
  });
  $('copyCode').addEventListener('click', async () => {
    const btn = $('copyCode');
    try {
      await navigator.clipboard.writeText(teamCode());
      btn.textContent = '✓ Code copié : colle-le dans l\'icône à sa première ouverture';
    } catch (e) {
      btn.textContent = 'Copie impossible : le code est ' + teamCode();
    }
  });
  $('teamSetupOk').addEventListener('click', setupTeam);
  // date d'expiration de la clé déjà en place : indiquée ou corrigée sans ressaisir la clé
  $('keyInfo').addEventListener('click', e => {
    if (e.target.id !== 'keyExpChange') return;
    e.preventDefault();
    $('keyExp').value = loadKeyInfo().exp || '';
    $('keyEdit').hidden = false;
    $('keyExp').focus();
  });
  $('keyExpSave').addEventListener('click', async () => {
    const exp = $('keyExp').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exp)) { teamMsg('Choisis la date d\'expiration affichée par GitHub.', 'err'); return; }
    $('keyExpSave').disabled = true;
    teamMsg('Enregistrement de la date…');
    try {
      await T.setKeyExpiry(teamCode(), exp);
      saveKeyInfo(exp);
      $('keyEdit').hidden = true;
      teamMsg('✓ Date enregistrée pour toute l\'équipe : l\'appli préviendra deux semaines avant.', 'ok');
      renderTeam();
    } catch (err) {
      teamMsg('Pas enregistré : ' + errText(err), 'err');
    } finally {
      $('keyExpSave').disabled = false;
    }
  });
  // alertes en haut du planning : vérifier maintenant, ou aller voir la clé
  const teamWarnGo = async () => {
    if ($('teamWarn').dataset.act === 'sync') {
      $('teamWarn').innerHTML = '<p><svg class="ic" aria-hidden="true"><use href="#i-signal"/></svg> Vérification…</p>';
      lastSync = 0;
      await syncTeam(true);
      renderTeam();
      if ($('teamWarn').dataset.act === 'sync') $('teamWarn').insertAdjacentHTML('beforeend', '<p>Pas de réponse : réessaie quand tu auras du réseau.</p>');
      return;
    }
    setTab('reglages'); $('teamDetails').open = true;
    requestAnimationFrame(() => $('teamDetails').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  $('teamWarn').addEventListener('click', teamWarnGo);
  $('teamWarn').addEventListener('keydown', e => { if (e.key === 'Enter') teamWarnGo(); });
  $('teamSyncNow').addEventListener('click', () => syncTeam(true));
  $('teamLeave').addEventListener('click', () => {
    store(STORAGE_TEAM_KEY, '');
    store(STORAGE_KEY_INFO_KEY, '');
    store(STORAGE_SYNC_OK_KEY, '');
    saveContacts({}); // plus dans l'équipe : on ne garde pas les numéros des collègues
    saveUtiles({ list: [] });
    store(STORAGE_ADMIN_KEY, '');
    $('publishBox').hidden = true;
    teamMsg('Tu as quitté l\'équipe : ton calendrier reste sur ce téléphone, il ne se met plus à jour tout seul.');
    renderTeam();
  });
  // le rappel de fin de mois mène directement à l'import
  $('calRemind').addEventListener('click', () => goTo('import'));
  $('wImport').addEventListener('click', () => goTo('import'));
  $('calEmptyGo').addEventListener('click', () => goTo('import'));
  $('wName').addEventListener('change', e => {
    if (!e.target.value) return;
    store(STORAGE_NAME_KEY, e.target.value);
    store('mh_name_ok', '1');
    state.cal.agent = e.target.value;
    openOnUsefulMonth();
    renderCalendar();
  });
  $('wOk').addEventListener('click', closeWelcome);
  $('wSkip').addEventListener('click', closeWelcome);

  // ── Versions précédentes du planning d'équipe ─────────────────────────────
  async function loadHistory() {
    const box = $('historyList');
    box.innerHTML = '<p class="hint">Chargement…</p>';
    try {
      const list = await T.listVersions();
      const current = state.plan && state.plan.teamAt;
      box.innerHTML = list.length ? list.map((v, i) => {
        const d = new Date(v.date);
        return `<div class="hist-row" data-sha="${esc(v.sha)}"><span>${esc(d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }))} ` +
          `<span class="muted">${esc(d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}</span>` +
          (i === 0 ? ' <span class="badge">actuelle</span>' : '') + `</span>` +
          (i === 0 ? '' : '<button data-act="see">Voir</button>') + '<div class="hist-detail" hidden></div></div>';
      }).join('') : '<p class="hint">Aucune version publiée pour l\'instant.</p>';
      void current;
    } catch (e) {
      box.innerHTML = `<p class="hint err">${esc(errText(e))}</p>`;
    }
  }
  const versionCache = {};
  $('teamHistory').addEventListener('toggle', () => { if ($('teamHistory').open) loadHistory(); });
  $('historyList').addEventListener('click', async e => {
    const act = e.target.dataset.act;
    const row = e.target.closest('.hist-row');
    if (!act || !row) return;
    const sha = row.dataset.sha, detail = row.querySelector('.hist-detail');
    if (act === 'see') {
      detail.hidden = false;
      detail.textContent = 'Déchiffrement…';
      try {
        const data = versionCache[sha] || (versionCache[sha] = await T.decrypt(await T.readVersion(sha), teamCode()));
        // comparaison avec le planning d'équipe actuellement publié (pas l'import local éventuel)
        const latest = await T.fetchPlan();
        const current = latest ? await T.decrypt(latest.text, teamCode()) : null;
        const n = countChanges(current, { agents: data.agents || {} });
        const keys = Object.values(data.agents || {}).flatMap(o => Object.keys(o)).sort();
        const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
        detail.innerHTML = `Publiée${data.by ? ' par <strong>' + esc(data.by) + '</strong>' : ''} : ${Object.keys(data.agents || {}).length} agents` +
          (keys.length ? `, du ${esc(fmt(keys[0]))} au ${esc(fmt(keys[keys.length - 1]))}` : '') +
          `. <strong>${n} case${n > 1 ? 's' : ''}</strong> différente${n > 1 ? 's' : ''} du planning d'équipe actuel.` +
          (n ? '<br><button data-act="restore" class="primary">Restaurer cette version pour toute l\'équipe</button>' : '');
      } catch (err) {
        detail.textContent = errText(err);
      }
    }
    if (act === 'restore') {
      const data = versionCache[sha];
      if (!data) return;
      e.target.disabled = true;
      detail.insertAdjacentHTML('beforeend', '<span class="hint"> Restauration…</span>');
      try {
        const by = load(STORAGE_NAME_KEY) || '';
        const key = await T.checkCode(teamCode());
        if (key.status !== 'ok') throw new Error('cle');
        const res = await T.publishPlan(teamCode(), key.token, by,
          current => ({ plan: { agents: data.agents || {}, remarks: data.remarks || {}, roles: newestRoles(current && current.roles, loadRoles()),
            contacts: (current && current.contacts) || {}, ...keepShared(current) } }), undefined, 'Planning restauré');
        applyAgents(state.plan, planToAgents(data.agents, data.remarks),
          { at: res.at, file: 'équipe', teamAt: res.at, teamBy: by || null });
        renderCalendar();
        renderTeam();
        await loadHistory();
        teamMsg('✓ Version restaurée pour toute l\'équipe : tes collègues la recevront à l\'ouverture de l\'appli.', 'ok');
      } catch (err) {
        detail.textContent = errText(err);
      }
    }
  });

  // ── Ordre des noms dans la vue Équipe ─────────────────────────────────────
  // Par défaut : toi en premier, puis ordre alphabétique (les anciens « fin de liste » restent à la fin).
  // Ordre personnalisé : mh_roles.order (noms complets), envoyé chiffré avec le planning d'équipe ;
  // les nouveaux agents s'ajoutent à la fin, par ordre alphabétique.
  function teamOrder(names, me) {
    const roles = loadRoles() || {};
    if (Array.isArray(roles.order) && roles.order.length) {
      const known = roles.order.filter(n => names.includes(n));
      return known.concat(orderNames(names.filter(n => !known.includes(n))));
    }
    const isEnd = n => C.groupOf(n, { np: roles.np }) === 'np';
    const main = orderNames(names.filter(n => !isEnd(n))), end = orderNames(names.filter(isEnd));
    return (main.includes(me) ? [me].concat(main.filter(n => n !== me)) : main).concat(end);
  }
  function renderReorder(names, me) {
    if (!state.reorderList) state.reorderList = teamOrder(names, me);
    const list = state.reorderList;
    $('calTeam').innerHTML = '<p class="hint">Maintiens la poignée ☰ et fais glisser le nom à sa place. <svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg> change le nom affiché ' +
      '(par exemple pour distinguer deux homonymes). Puis touche « Terminé ».</p>' +
      '<ol class="reorder" id="roList">' + list.map(n =>
        `<li data-name="${esc(n)}"${n === me ? ' class="me"' : ''}>` +
        `<span class="ro-handle" role="button" aria-label="Déplacer ${esc(n)}">` +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></span>' +
        `<span class="ro-name">${nameHTML(n)}</span>` +
        `<button class="ro-edit link" type="button" aria-label="Renommer ${esc(shown(n))}"><svg class="ic" aria-hidden="true"><use href="#i-edit"/></svg></button></li>`).join('') +
      '</ol><div class="actions"><button id="roDone" class="primary" type="button">Terminé</button>' +
      '<button id="roReset" type="button">Par défaut</button><button id="roCancel" class="link" type="button">Annuler</button></div>';
  }
  // noms affichés : ceux déjà choisis + les champs ✏️ ouverts (vide ou nom du tableau = on retire)
  function aliasDraft() {
    const alias = Object.assign({}, (loadRoles() || {}).alias || {});
    const list = $('roList');
    if (list) list.querySelectorAll('li').forEach(li => {
      const input = li.querySelector('.ro-input');
      if (!input) return;
      const v = input.value.trim().replace(/\s+/g, ' '), n = li.dataset.name;
      if (!v || v === n || v === C.splitName(n).base) delete alias[n]; else alias[n] = v; // nom du tableau = pas de surnom
    });
    return alias;
  }
  async function saveOrder(order) {
    const prev = loadRoles() || {};
    const alias = aliasDraft();
    const updated = { np: order ? '' : prev.np || '', order: order || [], alias, at: new Date().toISOString() };
    saveRoles(updated);
    state.reorder = false; state.reorderList = null;
    state.orderMsg = order ? '✓ Ordre enregistré.' : '✓ Ordre par défaut rétabli.';
    renderCalendar();
    if (!teamCode()) return;
    try {
      const before = await T.fetchPlan();
      const key = await T.checkCode(teamCode());
      if (key.status !== 'ok') throw new Error('cle');
      const res = await T.publishPlan(teamCode(), key.token, load(STORAGE_NAME_KEY) || '', current => ({ plan: {
        agents: (current && current.agents) || {}, remarks: (current && current.remarks) || {}, roles: updated,
        contacts: (current && current.contacts) || {}, ...keepShared(current) } }), undefined, 'Ordre mis à jour');
      if (state.plan && before && state.plan.teamAt === before.at) { state.plan.teamAt = res.at; savePlan(); renderTeam(); }
      state.orderMsg += ' Envoyé à l\'équipe : tes collègues ont le même ordre.';
    } catch (e) {
      state.orderMsg += ' Pas envoyé à l\'équipe : ' + errText(e);
    }
    renderCalendar();
    setTimeout(() => { state.orderMsg = ''; const m = document.getElementById('orderMsg'); if (m) m.hidden = true; }, 8000);
  }

  // ── Mon numéro (carte équipe) ─────────────────────────────────────────────
  function renderMyPhone() {
    const me = load(STORAGE_NAME_KEY), c = me && loadContacts()[me];
    $('myPhoneWho').textContent = me ? shown(me) : 'choisis d\'abord ton nom';
    $('myPhone').value = c && c.tel || '';
    $('myPhoneRemove').hidden = !(c && c.tel);
    $('myPhoneSave').disabled = !me;
  }
  function phoneMsg(text, kind) {
    $('myPhoneMsg').hidden = !text;
    $('myPhoneMsg').textContent = text || '';
    $('myPhoneMsg').className = 'team-msg ' + (kind || '');
  }
  async function publishMyPhone(tel) {
    const me = load(STORAGE_NAME_KEY);
    if (!me || !teamCode()) return;
    $('myPhoneSave').disabled = $('myPhoneRemove').disabled = true;
    phoneMsg(tel ? 'Envoi à l\'équipe…' : 'Retrait…');
    try {
      const before = await T.fetchPlan();
      const key = await T.checkCode(teamCode());
      if (key.status !== 'ok') throw new Error('cle');
      let contacts = {};
      const res = await T.publishPlan(teamCode(), key.token, me, current => {
        contacts = Object.assign({}, (current && current.contacts) || {});
        if (tel) contacts[me] = { tel, at: new Date().toISOString() }; else delete contacts[me];
        return { plan: { agents: (current && current.agents) || {}, remarks: (current && current.remarks) || {},
          roles: (current && current.roles) || loadRoles(), contacts, ...keepShared(current) } };
      }, undefined, 'Coordonnées mises à jour');
      saveContacts(contacts);
      if (state.plan && before && state.plan.teamAt === before.at) { state.plan.teamAt = res.at; savePlan(); renderTeam(); }
      phoneMsg(tel ? '✓ Numéro partagé avec l\'équipe.' : '✓ Numéro retiré. Il n\'est plus visible dans l\'appli.', 'ok');
      renderMyPhone();
      renderCalendar();
    } catch (e) {
      phoneMsg('Pas envoyé : ' + errText(e), 'err');
    } finally {
      $('myPhoneSave').disabled = $('myPhoneRemove').disabled = false;
    }
  }
  $('myPhoneSave').addEventListener('click', () => {
    const tel = normalizePhone($('myPhone').value);
    if (!tel) { phoneMsg('Numéro invalide (ex. 06 12 34 56 78).', 'err'); return; }
    $('myPhone').value = tel;
    publishMyPhone(tel);
  });
  $('myPhoneRemove').addEventListener('click', () => publishMyPhone(null));
  $('teamDetails').addEventListener('toggle', () => { if ($('teamDetails').open) renderMyPhone(); });

  // ── Panneau « Numéros utiles » (icône 📞 en haut à droite) ────────────────
  const ut = { unlocked: false, draft: null, newAdmin: null };
  // Le cadenas n'est visible que sur le téléphone du responsable (après une 1re saisie réussie du code
  // responsable) ; ailleurs, un appui long de 2 s sur le titre du panneau le fait apparaître.
  const STORAGE_ADMIN_KEY = 'mh_admin';
  const isAdminDevice = () => load(STORAGE_ADMIN_KEY) === '1';
  function telHref(v) { return String(v || '').replace(/[^\d+]/g, ''); }
  function utilesMsg(text, kind) {
    $('utilesMsg').hidden = !text;
    $('utilesMsg').textContent = text || '';
    $('utilesMsg').className = 'team-msg ' + (kind || '');
  }
  function renderUtilesView() {
    const list = loadUtiles().list || [];
    $('utilesView').innerHTML = list.length ? list.map(u =>
      `<div class="u-row"><div class="u-text"><span class="u-label">${esc(u.label)}</span><span class="u-tel">${esc(u.tel)}</span></div>` +
      `<a class="u-act" href="tel:${esc(telHref(u.tel))}" aria-label="Appeler ${esc(u.label)}"><svg class="ic" aria-hidden="true"><use href="#i-phone"/></svg></a>` +
      `<a class="u-act" href="sms:${esc(telHref(u.tel))}" aria-label="SMS à ${esc(u.label)}"><svg class="ic" aria-hidden="true"><use href="#i-msg"/></svg></a></div>`).join('')
      : '<p class="hint">Aucun numéro pour l\'instant.</p>';
  }
  function openUtiles() {
    ut.unlocked = false; ut.draft = null; ut.newAdmin = null;
    $('utilesView').hidden = false; $('utilesEdit').hidden = true; $('utilesAdmin').hidden = !isAdminDevice();
    utilesMsg('');
    renderUtilesView();
    $('utilesSheet').hidden = false;
    document.body.classList.add('sheet-open');
  }
  function closeUtiles() {
    $('utilesSheet').hidden = true;
    document.body.classList.remove('sheet-open');
  }
  // étape « verrou » : définir le code responsable (1re fois) ou le saisir
  function renderUtilesLock() {
    const hasAdmin = !!loadUtiles().admin;
    $('utilesView').hidden = true; $('utilesAdmin').hidden = true; $('utilesEdit').hidden = false;
    $('utilesEdit').innerHTML = hasAdmin
      ? '<p class="hint">Réservé au responsable de la liste.</p>' +
        '<div class="w-code"><input id="uSecret" type="password" autocomplete="off" placeholder="Code responsable" aria-label="Code responsable">' +
        '<button id="uUnlock" type="button" class="primary">Déverrouiller</button></div>' +
        '<div class="actions"><button id="uBack" class="link" type="button">Retour</button></div>'
      : '<p class="hint"><strong>Première fois :</strong> choisis un code responsable (au moins 3 mots, différent des 4 mots de l\'équipe). ' +
        'Il sera demandé pour toute modification. Garde-le pour toi.</p>' +
        '<input id="uSecret" type="password" autocomplete="new-password" placeholder="Code responsable" aria-label="Code responsable" class="u-input">' +
        '<input id="uSecret2" type="password" autocomplete="new-password" placeholder="Confirme le code" aria-label="Confirmation" class="u-input">' +
        '<div class="actions"><button id="uDefine" type="button" class="primary">Définir</button><button id="uBack" class="link" type="button">Retour</button></div>';
    setTimeout(() => { const i = $('uSecret'); if (i) i.focus(); }, 50);
  }
  function renderUtilesEdit() {
    $('utilesView').hidden = true; $('utilesAdmin').hidden = true; $('utilesEdit').hidden = false;
    $('utilesEdit').innerHTML = '<p class="hint">Mode responsable : modifie, ajoute ou supprime des numéros, puis envoie à l\'équipe.</p>' +
      ut.draft.map((u, i) => `<div class="u-edit" data-i="${i}">` +
        `<input class="u-input" data-f="label" value="${esc(u.label)}" placeholder="Service (ex. PC opérations)" aria-label="Service">` +
        `<input class="u-input" data-f="tel" value="${esc(u.tel)}" placeholder="Numéro" inputmode="tel" aria-label="Numéro">` +
        `<button type="button" data-del="${i}" aria-label="Supprimer"><svg class="ic" aria-hidden="true"><use href="#i-trash"/></svg></button></div>`).join('') +
      '<div class="actions"><button id="uAdd" type="button">+ Ajouter un numéro</button></div>' +
      '<div class="actions"><button id="uSave" type="button" class="primary">Enregistrer pour l\'équipe</button>' +
      '<button id="uCancel" class="link" type="button">Annuler</button></div>';
  }
  async function saveUtilesList() {
    const list = ut.draft.map(u => ({ label: u.label.trim(), tel: u.tel.trim() })).filter(u => u.label || u.tel);
    const bad = list.find(u => !u.label || (u.tel.match(/\d/g) || []).length < 2);
    if (bad) { utilesMsg('Chaque ligne doit avoir un nom de service et un numéro.', 'err'); return; }
    $('uSave').disabled = true;
    utilesMsg('Envoi à l\'équipe…');
    try {
      const before = await T.fetchPlan();
      const key = await T.checkCode(teamCode());
      if (key.status !== 'ok') throw new Error('cle');
      const utiles = { list, at: new Date().toISOString() };
      let admin = null;
      const res = await T.publishPlan(teamCode(), key.token, load(STORAGE_NAME_KEY) || '', current => {
        admin = ut.newAdmin || (current && current.admin) || null;
        return { plan: { agents: (current && current.agents) || {}, remarks: (current && current.remarks) || {},
          roles: (current && current.roles) || loadRoles(), contacts: (current && current.contacts) || {}, utiles, admin } };
      }, undefined, 'Numéros utiles mis à jour');
      saveUtiles({ list, at: utiles.at, admin });
      if (state.plan && before && state.plan.teamAt === before.at) { state.plan.teamAt = res.at; savePlan(); renderTeam(); }
      ut.unlocked = false; ut.draft = null; ut.newAdmin = null;
      $('utilesEdit').hidden = true; $('utilesView').hidden = false; $('utilesAdmin').hidden = !isAdminDevice();
      renderUtilesView();
      utilesMsg('✓ Numéros enregistrés et envoyés à l\'équipe.', 'ok');
    } catch (e) {
      utilesMsg('Pas envoyé : ' + errText(e), 'err');
      const b = document.getElementById('uSave'); if (b) b.disabled = false;
    }
  }
  // appui court : ouvre le panneau ; appui long (2 s) sur l'icône : l'ouvre avec le cadenas
  let btnTimer = null, btnLong = false;
  function revealLock() { $('utilesAdmin').hidden = false; utilesMsg('Accès responsable affiché.', 'ok'); }
  $('utilesBtn').addEventListener('pointerdown', () => {
    btnLong = false;
    clearTimeout(btnTimer);
    btnTimer = setTimeout(() => { btnLong = true; openUtiles(); revealLock(); }, 2000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => $('utilesBtn').addEventListener(t, () => clearTimeout(btnTimer)));
  $('utilesBtn').addEventListener('contextmenu', e => e.preventDefault());
  $('utilesBtn').addEventListener('click', () => { if (btnLong) { btnLong = false; return; } openUtiles(); });
  // appui long sur le titre : fait apparaître le cadenas (nouveau téléphone du responsable)
  let lockTimer = null;
  $('utilesTitle').addEventListener('pointerdown', () => {
    clearTimeout(lockTimer);
    lockTimer = setTimeout(() => {
      if (!$('utilesView').hidden) revealLock();
    }, 2000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => $('utilesTitle').addEventListener(t, () => clearTimeout(lockTimer)));
  $('utilesTitle').addEventListener('contextmenu', e => e.preventDefault());
  $('utilesSheet').addEventListener('click', async e => {
    if (e.target.closest('[data-close]')) { closeUtiles(); return; }
    const id = e.target.id;
    if (id === 'utilesAdmin') { utilesMsg(''); renderUtilesLock(); return; }
    if (id === 'uBack' || id === 'uCancel') { openUtiles(); return; }
    if (id === 'uDefine') {
      const a = $('uSecret').value, b = $('uSecret2').value, code = T.normCode(a);
      if (code.split('-').length < 3) { utilesMsg('Le code responsable doit faire au moins 3 mots.', 'err'); return; }
      if (code === teamCode()) { utilesMsg('Choisis un code différent des 4 mots de l\'équipe.', 'err'); return; }
      if (code !== T.normCode(b)) { utilesMsg('Les deux saisies ne correspondent pas.', 'err'); return; }
      ut.newAdmin = await T.hashSecret(a);
      store(STORAGE_ADMIN_KEY, '1');
      ut.unlocked = true; ut.draft = (loadUtiles().list || []).map(u => Object.assign({}, u));
      if (!ut.draft.length) ut.draft.push({ label: '', tel: '' });
      utilesMsg('Code responsable choisi : il sera enregistré avec la liste.', 'ok');
      renderUtilesEdit();
      return;
    }
    if (id === 'uUnlock') {
      const ok = await T.checkSecret($('uSecret').value, loadUtiles().admin);
      if (!ok) { utilesMsg('Code responsable incorrect.', 'err'); return; }
      store(STORAGE_ADMIN_KEY, '1');
      ut.unlocked = true; ut.draft = (loadUtiles().list || []).map(u => Object.assign({}, u));
      if (!ut.draft.length) ut.draft.push({ label: '', tel: '' });
      utilesMsg('');
      renderUtilesEdit();
      return;
    }
    if (!ut.unlocked) return;
    if (id === 'uAdd') { ut.draft.push({ label: '', tel: '' }); renderUtilesEdit(); const ins = $('utilesEdit').querySelectorAll('.u-edit input[data-f="label"]'); ins[ins.length - 1].focus(); return; }
    if (e.target.dataset.del !== undefined) { ut.draft.splice(+e.target.dataset.del, 1); renderUtilesEdit(); return; }
    if (id === 'uSave') saveUtilesList();
  });
  $('utilesSheet').addEventListener('input', e => {
    const row = e.target.closest('.u-edit');
    if (row && ut.draft) ut.draft[+row.dataset.i][e.target.dataset.f] = e.target.value;
  });
  $('utilesSheet').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.id === 'uSecret' && document.getElementById('uUnlock')) $('uUnlock').click();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('utilesSheet').hidden) closeUtiles(); });

  $('teamRenew').addEventListener('click', e => {
    e.preventDefault();
    $('teamSetup').hidden = false;
    $('teamToken').focus();
  });
  $('publish').addEventListener('click', doPublish);
  $('publishSkip').addEventListener('click', () => {
    publishButtons(false, false, false);
    publishMsg('Pas envoyé : ce planning reste sur ton téléphone uniquement.');
  });
  $('publishUndo').addEventListener('click', undoPublish);
  // au retour sur l'appli (elle reste souvent ouverte en arrière-plan), on revérifie
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastSync > 60000) syncTeam(false);
    if (swOK && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'check' });
    // l'appli peut rester ouverte en arrière-plan d'un jour sur l'autre : « Aujourd'hui » doit suivre
    if (C.dateKey(todayDate()) !== state.lastRenderDay) renderCalendar();
  });

  // ── Onglets : Planning · Équipe · Réglages ────────────────────────────────
  // Visibilité gérée par le CSS (body[data-tab] + attributs data-tab des cartes, classes only-planning / only-equipe)
  function setTab(t) {
    if (!['planning', 'equipe', 'reglages'].includes(t)) t = 'planning';
    const changed = state.tab !== t;
    closeDay();
    state.tab = t;
    document.body.dataset.tab = t;
    document.querySelectorAll('.tab[data-tab-btn]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tabBtn === t)));
    if (t === 'reglages') {
      renderNotesCard();
      if ($('importDetails').open) ensureXLSX().catch(() => {});
    } else {
      store(STORAGE_TAB_KEY, t);
      renderCalendar();
    }
    window.scrollTo({ top: 0, behavior: changed ? 'auto' : 'smooth' }); // onglet déjà ouvert : remonte en haut
  }
  // vers l'import ou l'export (onglet Réglages), carte ouverte
  function goTo(target) {
    setTab('reglages');
    const det = target === 'export' ? $('exportDetails') : $('importDetails');
    det.open = true;
    if (target === 'import') ensureXLSX().catch(() => {});
    requestAnimationFrame(() => (target === 'import' ? $('drop') : det).scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  document.querySelector('.tabbar').addEventListener('click', e => {
    const b = e.target.closest('[data-tab-btn]');
    if (b) setTab(b.dataset.tabBtn);
  });
  $('importDetails').addEventListener('toggle', () => { if ($('importDetails').open) ensureXLSX().catch(() => {}); });

  // « Je suis » (Réglages) : le seul endroit, avec l'accueil, où l'on choisit son nom
  function renderMeCard(names) {
    $('meCard').hidden = !names.length;
    if (!names.length) return;
    const me = load(STORAGE_NAME_KEY);
    const known = names.includes(me);
    $('meName').innerHTML = (known ? '' : '<option value="">Choisis ton nom…</option>') + nameOptions(names);
    $('meName').value = known ? me : '';
  }
  $('meName').addEventListener('change', e => {
    if (!e.target.value) return;
    store(STORAGE_NAME_KEY, e.target.value);
    store('mh_name_ok', '1');
    state.cal.agent = e.target.value;
    renderCalendar();
    renderMyPhone();
  });

  // ── Notes : gardées sur ce téléphone uniquement → sauvegarde / restauration par fichier ──
  let persistAsked = false;
  function askPersist() { // demande au navigateur de ne pas effacer les données de l'appli (une fois)
    if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
    persistAsked = true;
    navigator.storage.persisted().then(p => p || navigator.storage.persist()).catch(() => {});
  }
  function notesMsg(text, kind) {
    $('notesMsg').hidden = !text;
    $('notesMsg').textContent = text || '';
    $('notesMsg').className = 'team-msg ' + (kind || '');
  }
  function renderNotesCard() {
    const n = Object.keys(notes).length;
    $('notesInfo').textContent = n
      ? `${n} note${n > 1 ? 's' : ''} sur ce téléphone, jamais envoyée${n > 1 ? 's' : ''}.`
      : 'Aucune note pour l\'instant.';
    $('notesSave').disabled = !n;
  }
  $('notesSave').addEventListener('click', async () => {
    const data = JSON.stringify({ app: 'planning-coa', type: 'notes', v: 1, at: new Date().toISOString(), notes }, null, 1);
    const fname = `notes-planning-coa-${C.dateKey(todayDate())}.json`;
    const file = new File([data], fname, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Mes notes Planning COA' });
        notesMsg('✓ Sauvegarde envoyée : garde le fichier (Fichiers, Drive, e-mail…).', 'ok');
      } catch (e) { /* partage annulé */ }
      return;
    }
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notesMsg('✓ Fichier téléchargé : ' + fname, 'ok');
  });
  $('notesRestore').addEventListener('click', () => $('notesFile').click());
  $('notesFile').addEventListener('change', e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => notesMsg('Fichier illisible.', 'err');
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); } catch (err) { data = null; }
      if (!data || data.type !== 'notes' || !data.notes || typeof data.notes !== 'object') {
        notesMsg('Ce fichier n\'est pas une sauvegarde de notes Planning COA.', 'err');
        return;
      }
      let added = 0, kept = 0;
      for (const [k, v] of Object.entries(data.notes)) {
        const text = String(v || '').trim().slice(0, 500);
        if (!/^\d{8}$/.test(k) || !text) continue;
        if (!notes[k]) { notes[k] = text; added++; } else if (notes[k] !== text) kept++;
      }
      store(STORAGE_NOTES_KEY, JSON.stringify(notes));
      askPersist();
      renderNotesCard();
      renderCalendar();
      notesMsg(`✓ ${added} note${added > 1 ? 's' : ''} restaurée${added > 1 ? 's' : ''}` +
        (kept ? ` ; ${kept} jour${kept > 1 ? 's' : ''} avai${kept > 1 ? 'ent' : 't'} déjà une autre note, gardée telle quelle.` : '.'), 'ok');
    };
    reader.readAsText(file);
  });

  // ── Proposer une permutation : message déjà rédigé (SMS si le numéro est partagé, sinon partage / copie)
  function swapMessage(o, ctx) {
    const day = key => utc(keyToDate(key)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    if (o.type === 'meme-jour') {
      return `Salut ! Je te propose un échange le ${day(ctx.k)} : je prends ton poste (${codeLabel(o.code)}) et tu prends le mien (${codeLabel(ctx.code)}). Ça te dit ?`;
    }
    return `Salut ! Je te propose un échange : tu prends mon poste du ${day(ctx.k)} (${codeLabel(ctx.code)}) ` +
      `et je prends le tien du ${day(o.back)} (${codeLabel(o.backCode)}). Ça te dit ?`;
  }
  async function askSwap(btn) {
    const ctx = state.swapCtx, o = ctx && ctx.options[+btn.dataset.swap];
    if (!o) return;
    const text = swapMessage(o, ctx);
    const c = teamCode() && loadContacts()[o.name];
    if (c && c.tel) { window.location.href = 'sms:' + c.tel.replace(/\s/g, '') + '?&body=' + encodeURIComponent(text); return; }
    if (navigator.share) { try { await navigator.share({ text }); } catch (e) { /* annulé */ } return; }
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = '✓ Message copié';
    } catch (e) {
      window.prompt('Copie ce message :', text);
    }
  }
  document.addEventListener('click', e => {
    const ask = e.target.closest('.swap-ask');
    if (ask) { askSwap(ask); return; }
    const add = e.target.closest('.note-add');
    if (add) {
      const k = add.dataset.noteAdd;
      add.insertAdjacentHTML('afterend', noteFieldHTML(k));
      const field = add.nextElementSibling.querySelector('textarea');
      add.remove();
      field.focus();
      return;
    }
    const go = e.target.closest('[data-go-tab]');
    if (go) setTab(go.dataset.goTab);
  });

  // Affichage du calendrier : « Pastilles » (par défaut) ou « Cases colorées » (mh_cal_style), au choix de chacun
  function applyCalStyle(style) {
    const tint = style === 'tint';
    document.body.classList.toggle('tint-cells', tint);
    $('styleChips').setAttribute('aria-selected', String(!tint));
    $('styleTint').setAttribute('aria-selected', String(tint));
    $('styleChips').setAttribute('aria-checked', String(!tint));
    $('styleTint').setAttribute('aria-checked', String(tint));
  }
  ['styleChips', 'styleTint'].forEach(id => $(id).addEventListener('click', e => {
    const style = e.currentTarget.dataset.calStyle;
    store('mh_cal_style', style);
    applyCalStyle(style);
  }));
  applyCalStyle(load('mh_cal_style'));

  // Thème : Auto (suit le téléphone), Clair ou Sombre (mh_theme, appliqué dès le <head> pour éviter un éclair)
  function applyTheme(t) {
    if (t !== 'light' && t !== 'dark') t = 'auto';
    if (t === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    document.querySelectorAll('[data-theme-choice]').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.themeChoice === t));
      b.setAttribute('aria-checked', String(b.dataset.themeChoice === t));
    });
  }
  document.querySelectorAll('[data-theme-choice]').forEach(b => b.addEventListener('click', () => {
    store('mh_theme', b.dataset.themeChoice);
    applyTheme(b.dataset.themeChoice);
  }));
  applyTheme(load('mh_theme'));

  renderCodes();
  document.body.dataset.tab = state.tab;
  document.querySelectorAll('.tab[data-tab-btn]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tabBtn === state.tab)));
  if (state.plan && !load(STORAGE_PLAN_KEY)) savePlan(); // reprise de l'ancien suivi des exports
  openOnUsefulMonth();
  renderCalendar();
  renderTeam();
  syncTeam(false);
})();
