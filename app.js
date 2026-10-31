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
  const PLAN_KEEP_DAYS = 400;
  const CODES_VERSION = 6;
  const $ = id => document.getElementById(id);

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
    cal: { y: today.y, m: today.m, agent: load(STORAGE_NAME_KEY) || '', selected: C.dateKey(today),
      view: load(STORAGE_VIEW_KEY) === 'list' ? 'list' : 'month',
      sum: load(STORAGE_SUM_KEY) === 'year' ? 'year' : 'month' } };

  function loadNotes() { try { return JSON.parse(load(STORAGE_NOTES_KEY)) || {}; } catch (e) { return {}; } }
  const notes = loadNotes();
  function saveNote(key, text) {
    const t = text.trim();
    if (t) notes[key] = t.slice(0, 500); else delete notes[key];
    store(STORAGE_NOTES_KEY, JSON.stringify(notes));
  }

  // ── Fichier ───────────────────────────────────────────────────────────────
  function showError(msg) {
    $('error').textContent = msg || '';
    $('error').hidden = !msg;
  }

  function readFile(file) {
    if (!file) return;
    showError('');
    const reader = new FileReader();
    reader.onerror = () => showError('Impossible de lire ce fichier.');
    reader.onload = () => {
      try {
        state.workbook = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellNF: true });
      } catch (e) {
        state.workbook = null;
        showError('Ce fichier n\'est pas un classeur Excel lisible.');
        return;
      }
      state.fileName = file.name;
      state.planBefore = state.plan; // le tableau remplace sa période dans ce planning
      $('saved').hidden = true;
      $('fileName').textContent = file.name;
      const names = state.workbook.SheetNames;
      $('sheet').innerHTML = names.map((n, i) => `<option value="${i}">${esc(n)}</option>`).join('');
      $('sheetRow').hidden = names.length < 2;
      $('month').value = '';
      // feuille par défaut : celle où l'on reconnaît le plus de cases
      let best = 0, bestCount = -1;
      names.forEach((n, i) => {
        const count = parseSheet(i).total;
        if (count > bestCount) { best = i; bestCount = count; }
      });
      $('sheet').value = String(best);
      refresh();
    };
    reader.readAsArrayBuffer(file);
  }

  function parseSheet(index) {
    const name = state.workbook.SheetNames[index];
    const matrix = C.sheetToMatrix(XLSX, state.workbook.Sheets[name]);
    const opts = { codes: state.codes, sheetName: name + ' ' + state.fileName };
    const ym = $('month').value.match(/^(\d{4})-(\d{2})$/);
    if (ym) { opts.year = +ym[1]; opts.month = +ym[2]; }
    return C.parseMatrix(matrix, opts);
  }

  // ── Affichage ─────────────────────────────────────────────────────────────
  function refresh() {
    if (!state.workbook) return;
    const res = state.result = parseSheet(+$('sheet').value);
    $('monthRow').hidden = !res.monthAssumed;
    if (res.monthAssumed && !$('month').value && res.ctx) {
      $('month').value = res.ctx.y + '-' + String(res.ctx.m).padStart(2, '0');
    }
    if (!res.agents.length) {
      $('agentCard').hidden = $('previewCard').hidden = true;
      showError('Aucun planning reconnu dans cette feuille. Vérifie les codes ci-dessous ou essaie une autre feuille.');
      return;
    }
    showError('');
    const previous = $('agent').value || load(STORAGE_NAME_KEY);
    $('agent').innerHTML = res.agents
      .map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
    if (res.agents.some(a => a.name === previous)) $('agent').value = previous;
    $('agentCard').hidden = res.agents.length < 2;
    savePlanFromImport(res);
    renderPreview();
  }

  // Range le tableau lu dans le planning du téléphone (recalculé à chaque réglage du fichier)
  function minKeep() {
    const min = new Date(Date.now() - PLAN_KEEP_DAYS * 864e5);
    return C.dateKey({ y: min.getFullYear(), m: min.getMonth() + 1, d: min.getDate() });
  }
  // Planning (forme stockée) → agents/entries (forme lue dans un tableau)
  function planToAgents(agents) {
    return Object.keys(agents || {}).map(name => ({ name,
      entries: Object.keys(agents[name]).sort().map(k => ({ date: keyToDate(k), code: agents[name][k] })) }));
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
    plan.teamAt = before && before.teamAt || null;
    plan.teamBy = before && before.teamBy || null;
    Object.assign(plan, meta);
    state.plan = plan;
    savePlan();
    return count;
  }

  function savePlanFromImport(res) {
    applyAgents(state.planBefore || null, res.agents, { at: new Date().toISOString(), file: state.fileName });
    state.importAgents = res.agents;

    // calendrier : on montre le mois en cours s'il est dans le tableau, sinon son premier mois
    const keys = res.agents.flatMap(a => a.entries.map(e => C.dateKey(e.date))).sort();
    const todayKey = C.dateKey(todayDate());
    if (keys.length) {
      const target = todayKey >= keys[0] && todayKey <= keys[keys.length - 1] ? todayDate() : keyToDate(keys[0]);
      state.cal.y = target.y; state.cal.m = target.m;
    }
    state.cal.agent = $('agent').value;
    if (!load(STORAGE_NAME_KEY) && state.cal.agent) store(STORAGE_NAME_KEY, state.cal.agent);
    const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    $('saved').hidden = !keys.length;
    $('saved').textContent = keys.length
      ? `✓ Planning enregistré sur ce téléphone, du ${fmt(keys[0])} au ${fmt(keys[keys.length - 1])}.` : '';
    renderCalendar();
    schedulePublish();
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
  const errText = e => ERRORS[e && e.message] || ERRORS.reseau;

  function teamMsg(text, kind) {
    $('teamMsg').hidden = !text;
    $('teamMsg').textContent = text || '';
    $('teamMsg').className = 'team-msg ' + (kind || '');
  }

  function renderTeam() {
    const joined = !!teamCode();
    $('teamOut').hidden = joined;
    $('teamIn').hidden = !joined;
    if (joined) {
      const p = state.plan;
      $('teamInfo').innerHTML = p && p.teamAt
        ? `✓ Tu es dans l'équipe. Dernier planning reçu : publié le ${esc(longDate(p.teamAt))} à ${esc(timeOf(p.teamAt))}` +
          (p.teamBy ? ` par ${esc(p.teamBy)}` : '') + '.'
        : '✓ Tu es dans l\'équipe. Aucun planning publié pour l\'instant.';
    }
    const p = state.plan;
    $('teamStatus').hidden = !(joined && p && p.teamAt);
    if (!$('teamStatus').hidden) {
      $('teamStatus').textContent = `👥 Planning d'équipe du ${longDate(p.teamAt)}` + (p.teamBy ? `, publié par ${p.teamBy}` : '');
    }
    $('importHint').textContent = joined
      ? 'Le fichier Excel reste sur ton appareil. Comme tu es dans l\'équipe, l\'appli te proposera d\'envoyer les noms et les codes à tes collègues, chiffrés avec le code d\'équipe.'
      : 'Le fichier est lu sur ton appareil et le planning reste sur ce téléphone : rien n\'est envoyé sur Internet.';
  }

  let syncing = false, lastSync = 0;
  async function syncTeam(manual) {
    const code = teamCode();
    if (!code || syncing || state.workbook) return; // pas pendant un import en cours
    syncing = true; lastSync = Date.now();
    if (manual) teamMsg('Vérification…');
    try {
      const remote = await T.fetchPlan();
      if (!remote) { if (manual) teamMsg('Aucun planning publié pour l\'instant.'); return; }
      if (state.plan && state.plan.teamAt === remote.at) { if (manual) teamMsg('✓ Ton planning est à jour.', 'ok'); return; }
      const data = await T.decrypt(remote.text, code);
      const n = applyAgents(state.plan, planToAgents(data.agents),
        { at: remote.at, file: 'équipe', teamAt: remote.at, teamBy: data.by || null });
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
  async function joinTeam() {
    const code = T.normCode($('teamCode').value);
    if (code.split('-').length < 3 || code.length < 12) {
      teamMsg('Le code d\'équipe doit faire au moins 3 mots (ex. tarmac-cerise-boussole-neige).', 'err');
      return;
    }
    $('teamJoin').disabled = true;
    teamMsg('Vérification du code…');
    try {
      const res = await T.checkCode(code);
      if (res.status === 'absent') {
        pendingCode = code;
        $('teamSetup').hidden = false;
        teamMsg('L\'équipe n\'est pas encore configurée. Si c\'est toi qui la crées, colle la clé GitHub ci-dessus ; sinon, vérifie le code.');
        return;
      }
      store(STORAGE_TEAM_KEY, code);
      $('teamCode').value = '';
      teamMsg('✓ Code accepté.', 'ok');
      renderTeam();
      await syncTeam(true);
    } catch (e) {
      teamMsg(errText(e), 'err');
    } finally {
      $('teamJoin').disabled = false;
    }
  }

  async function setupTeam() {
    const code = pendingCode || teamCode();
    const token = $('teamToken').value.trim();
    if (!code || !token) return;
    $('teamSetupOk').disabled = true;
    teamMsg('Enregistrement de la clé…');
    try {
      await T.setupKey(code, token, load(STORAGE_NAME_KEY) || '');
      store(STORAGE_TEAM_KEY, code);
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
  function publishButtons(send, skip, undo) {
    $('publish').hidden = !send;
    $('publishSkip').hidden = !skip;
    $('publishUndo').hidden = !undo;
  }
  function schedulePublish() {
    clearTimeout(publishTimer);
    previewRun++;
    if (!teamCode() || !state.importAgents || !state.importAgents.length) { $('publishBox').hidden = true; return; }
    $('publishBox').hidden = false;
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
      const n = countChanges(current, { agents: C.mergePlan(current, agents, minKeep()).agents });
      if (current && !n) { publishMsg('✓ L\'équipe a déjà ce planning : rien à envoyer.', 'ok'); return; }
      const keys = agents.flatMap(a => a.entries.map(e => C.dateKey(e.date))).sort();
      const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      const period = `du ${fmt(keys[0])} au ${fmt(keys[keys.length - 1])}`;
      publishMsg((current
        ? `Ton fichier remplace la période ${period} pour toute l'équipe : ${n} case${n > 1 ? 's changent' : ' change'} ` +
          `par rapport au planning publié le ${longDate(remote.at)}${current.by ? ' par ' + current.by : ''}.`
        : `Premier planning de l'équipe : ${agents.length} agents, ${period}.`) +
        (state.result && state.result.monthAssumed ? ' Vérifie d\'abord le mois ci-dessus : il n\'est pas écrit dans le fichier.' : ''));
      $('publish').textContent = '📤 Envoyer à l\'équipe';
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
    publishMsg('Envoi à l\'équipe…');
    const agents = state.importAgents;
    const by = $('agent').value || load(STORAGE_NAME_KEY) || '';
    let previous = null, n = 0;
    try {
      const token = await publishKey();
      const res = await T.publishPlan(teamCode(), token, by, current => {
        previous = current;
        const merged = { agents: C.mergePlan(current, agents, minKeep()).agents };
        n = countChanges(current, merged);
        if (current && !n) throw new Error('identique'); // quelqu'un l'a envoyé entre-temps
        return { plan: merged };
      });
      if (agents !== state.importAgents) return; // un autre réglage a déjà relancé l'envoi
      state.plan.teamAt = res.at;
      state.plan.teamBy = by;
      savePlan();
      renderTeam();
      publishMsg(previous
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
        () => ({ plan: { agents: info.previous ? info.previous.agents : {} } }));
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
  function renderCalendar() {
    const plan = state.plan;
    const names = plan ? Object.keys(plan.agents).sort((a, b) => a.localeCompare(b, 'fr')) : [];
    $('calCard').hidden = !names.length;
    $('importTitle').textContent = names.length ? 'Nouveau planning' : 'Le planning';
    if (!names.length) return;
    const me = load(STORAGE_NAME_KEY);
    if (!names.includes(state.cal.agent)) state.cal.agent = names.includes(me) ? me : names[0];
    const name = state.cal.agent;
    $('calAgent').innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    $('calAgent').value = name;
    $('calPartial').hidden = !!plan.at; // repris de l'ancien suivi des exports, pas encore d'import

    const { y, m } = state.cal;
    $('calTitle').textContent = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const days = plan.agents[name] || {};
    const changes = new Map(((plan.changes || {})[name] || []).map(ch => [ch.key, ch]));
    const todayKey = C.dateKey(todayDate());

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
        html += `<button class="${cls.join(' ')}" data-key="${k}" aria-label="${d.d}${code ? ' : ' + esc(codeLabel(code)) : ''}">` +
          `<span class="n">${d.d}</span>${code ? chip(code) : ''}${notes[k] ? '<span class="note-dot" aria-label="note">📝</span>' : ''}</button>`;
      }
    }
    $('calGrid').innerHTML = html;
    const listView = state.cal.view === 'list';
    $('calGrid').hidden = listView;
    $('calList').hidden = !listView;
    $('viewMonth').setAttribute('aria-selected', String(!listView));
    $('viewList').setAttribute('aria-selected', String(listView));
    if (listView) renderList(days, changes, todayKey);
    $('calEmpty').hidden = inMonth > 0;
    renderSummary(days);
    renderNextDays();
    renderRemind();

    // changements apportés par le dernier tableau importé
    const list = [...changes.values()].filter(ch => ch.key >= todayKey);
    const box = $('calChanges');
    box.hidden = plan.changesSeen || !list.length;
    if (!box.hidden) {
      const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      box.innerHTML = `<strong>🔔 ${list.length} jour${list.length > 1 ? 's ont' : ' a'} changé dans le nouveau planning :</strong><ul>` +
        list.slice(0, 8).map(ch => `<li>${esc(fmt(ch.key))} : ${esc(codeTitle(ch.before))} → <strong>${esc(codeTitle(ch.after))}</strong></li>`).join('') +
        (list.length > 8 ? `<li>… et ${list.length - 8} autre${list.length - 8 > 1 ? 's' : ''} (marqués d'un point)</li>` : '') +
        '</ul><button id="calChangesOk">J\'ai vu</button>';
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
    $('calTally').hidden = !any;
    const keys = Object.keys(days || {}).filter(k => k.slice(0, 4) === String(state.cal.y)).sort();
    $('sumNote').hidden = !year || !any;
    if (year && keys.length) {
      const fmt = k => utc(keyToDate(k)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
      $('sumNote').textContent = `D'après les plannings gardés sur ce téléphone, du ${fmt(keys[0])} au ${fmt(keys[keys.length - 1])}.`;
    }
    if (!any) { $('calTally').innerHTML = ''; return; }
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
    html += `<div class="sum-row sum-maj"><span class="sum-n">💶</span><span class="sum-title">Travaillés en majoration</span>` +
      `<span class="sum-detail">${extra.join('')}</span></div>`;
    $('calTally').innerHTML = html;
  }

  // ── Aujourd'hui / Demain (toujours pour « moi ») ─────────────────────────
  function meName() {
    const me = load(STORAGE_NAME_KEY);
    return state.plan && state.plan.agents[me] ? me : state.cal.agent;
  }
  function renderNextDays() {
    const plan = state.plan, me = meName();
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
          ? `<span class="next-mates">${mates.length ? 'avec ' + mates.slice(0, 3).map(esc).join(', ') + (mates.length > 3 ? ` +${mates.length - 3}` : '') : 'seul(e) en ' + esc(codeLabel(code))}</span>`
          : '') +
        (notes[k] ? `<span class="next-note">📝 ${esc(notes[k])}</span>` : '') + '</button>';
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
    box.textContent = `📅 Le planning de ${month} n'est pas encore là. Dès qu'il sort, importe-le ci-dessous` +
      (teamCode() ? ' : l\'appli te proposera de l\'envoyer à toute l\'équipe.' : '.');
  }

  // ── Détail d'un jour : férié, changement, équipe du jour, échanges, note perso ──
  function dayDetailHTML(k, withHead) {
    const plan = state.plan, name = state.cal.agent, d = keyToDate(k);
    const code = (plan.agents[name] || {})[k];
    let html = '';
    if (withHead) {
      const title = utc(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      html += `<div class="cal-day-head"><strong>${esc(title)}</strong>` +
        (code ? ` ${chip(code)} <span>${esc(codeLabel(code))}</span>` : ' <span class="muted">pas de planning</span>') + '</div>';
    }
    const holiday = C.holidayName(k);
    if (holiday) html += `<p class="day-holiday">🎉 Férié : ${esc(holiday)}</p>`;
    const ch = ((plan.changes || {})[name] || []).find(c => c.key === k);
    if (ch && !plan.changesSeen) html += `<p class="was">Avant le nouveau planning : ${esc(codeTitle(ch.before))}</p>`;

    const team = C.teamOfDay(plan, k, state.codes);
    if (team.length > 1 || (team.length === 1 && team[0].names.length > 1)) {
      html += '<div class="day-team"><p class="day-sub">Équipe du jour</p>' + team.map(g =>
        `<div class="team-row${g.code === code ? ' mine' : ''}"><span class="team-code">${chip(g.code)} ${esc(codeLabel(g.code))} <span class="muted">(${g.names.length})</span></span>` +
        `<span class="team-names">${g.names.map(n => n === name ? `<strong>${esc(n)}</strong>` : esc(n)).join(', ')}</span></div>`).join('') + '</div>';
    }
    if (code && C.dayKind(defOf(code)) === 'travail') {
      const free = team.filter(g => g.kind === 'repos').flatMap(g => g.names).filter(n => n !== name)
        .sort((a, b) => a.localeCompare(b, 'fr'));
      html += `<p class="day-swap">🔁 <span class="muted">Pour un échange, en repos ce jour-là :</span> ` +
        (free.length ? free.map(esc).join(', ') : '<span class="muted">personne</span>') + '</p>';
    }
    html += `<label class="day-note"><span class="day-sub">📝 Ma note <span class="muted">(gardée sur ce téléphone)</span></span>` +
      `<textarea data-note="${k}" rows="2" maxlength="500" placeholder="ex. échangé avec Paul, RDV…">${esc(notes[k] || '')}</textarea></label>`;
    return html;
  }

  // Vue liste : les jours du mois de haut en bas ; toucher un jour déplie les collègues du même service
  function renderList(days, changes, todayKey) {
    const { y, m } = state.cal, plan = state.plan;
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
      html += `<button class="${cls.join(' ')}" data-key="${k}" aria-expanded="${k === state.cal.selected}">` +
        `<span class="cal-row-date"><span class="wd">${esc(dayName)}</span><span class="n">${d.d}</span></span>` +
        `<span class="cal-row-code">${code ? chip(code) + ' ' + esc(codeLabel(code)) : '<span class="muted">—</span>'}` +
        (ch ? ` <span class="was">avant : ${esc(codeTitle(ch.before))}</span>` : '') +
        (notes[k] ? ' <span class="note-dot">📝</span>' : '') + '</span></button>';
      if (k === state.cal.selected) html += `<div class="cal-row-detail">${dayDetailHTML(k, false)}</div>`;
    }
    $('calList').innerHTML = html;
  }

  function renderDay() {
    const k = state.cal.selected, box = $('calDay');
    if (state.cal.view === 'list') { box.hidden = true; return; }
    const plan = state.plan;
    const d = k && keyToDate(k);
    if (!plan || !d || d.y !== state.cal.y || d.m !== state.cal.m) { box.hidden = true; return; }
    const html = dayDetailHTML(k, true);
    box.innerHTML = html;
    box.hidden = false;
  }

  // À l'ouverture : le mois en cours s'il a des jours, sinon le prochain mois rempli, sinon le dernier
  function openOnUsefulMonth() {
    if (!state.plan) return;
    const names = Object.keys(state.plan.agents);
    const me = load(STORAGE_NAME_KEY);
    const days = state.plan.agents[names.includes(me) ? me : names.sort((a, b) => a.localeCompare(b, 'fr'))[0]] || {};
    const keys = Object.keys(days).sort();
    if (!keys.length) return;
    const t = todayDate(), monthKey = String(t.y) + String(t.m).padStart(2, '0');
    if (keys.some(k => k.slice(0, 6) === monthKey)) return;
    const next = keys.find(k => k.slice(0, 6) > monthKey) || keys[keys.length - 1];
    const d = keyToDate(next);
    state.cal.y = d.y; state.cal.m = d.m;
  }

  function moveMonth(delta) {
    let { y, m } = state.cal;
    m += delta;
    if (m < 1) { m = 12; y--; } else if (m > 12) { m = 1; y++; }
    state.cal.y = y; state.cal.m = m;
    renderCalendar();
  }

  function renderPreview() {
    const agent = state.result.agents.find(a => a.name === $('agent').value) || state.result.agents[0];
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
    const changes = ((state.plan && state.plan.changes || {})[agent.name] || []).filter(ch => !fromToday || ch.key >= today);
    const changed = new Map(changes.map(ch => [ch.key, ch]));
    $('changes').hidden = !changes.length;
    $('changes').innerHTML = changes.length
      ? `🔔 ${changes.length} jour${changes.length > 1 ? 's ont' : ' a'} changé (marqués ci-dessous) : refais l'export pour mettre ton agenda à jour.`
      : '';

    const counts = {};
    events.forEach(e => { const t = C.eventTitle(e.def); counts[t] = (counts[t] || 0) + 1; });
    const detail = Object.keys(counts).map(k => `${counts[k]} ${esc(k)}`).join(', ');
    $('summary').innerHTML = events.length
      ? `<strong>${events.length} événement${events.length > 1 ? 's' : ''}</strong> pour ${esc(agent.name)} : ${detail}.`
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
    let html = '<tr><th>Agenda</th><th>Code</th><th>Libellé</th><th>Couleur</th><th></th></tr>';
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
    const name = $('agent').value;
    const ics = C.buildICS(state.events, { name });
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
  $('file').addEventListener('change', e => readFile(e.target.files[0]));
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => readFile(e.dataTransfer.files[0]));
  $('sheet').addEventListener('change', () => { $('month').value = ''; refresh(); });
  $('month').addEventListener('change', refresh);
  $('agent').addEventListener('change', () => {
    store(STORAGE_NAME_KEY, $('agent').value);
    state.cal.agent = $('agent').value;
    renderPreview();
    renderCalendar();
  });

  $('calPrev').addEventListener('click', () => moveMonth(-1));
  $('calNext').addEventListener('click', () => moveMonth(1));
  $('calToday').addEventListener('click', () => {
    const t = todayDate();
    state.cal.y = t.y; state.cal.m = t.m; state.cal.selected = C.dateKey(t);
    renderCalendar();
  });
  $('calAgent').addEventListener('change', e => {
    state.cal.agent = e.target.value;
    store(STORAGE_NAME_KEY, e.target.value); // l'appli rouvre sur le dernier planning consulté
    if (state.result && state.result.agents.some(a => a.name === e.target.value)) {
      $('agent').value = e.target.value;
      renderPreview();
    }
    renderCalendar();
  });
  ['viewMonth', 'viewList'].forEach(id => $(id).addEventListener('click', e => {
    state.cal.view = e.currentTarget.dataset.view;
    store(STORAGE_VIEW_KEY, state.cal.view);
    renderCalendar();
    if (state.cal.view === 'list') scrollToSelected();
  }));
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
        if (notes[k] && !dot && host) host.insertAdjacentHTML('beforeend', '<span class="note-dot">📝</span>');
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
    else $('calDay').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  ['sumMonth', 'sumYear'].forEach(id => $(id).addEventListener('click', e => {
    state.cal.sum = e.currentTarget.dataset.scope;
    store(STORAGE_SUM_KEY, state.cal.sum);
    renderSummary((state.plan.agents[state.cal.agent]) || {});
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
    renderDay();
  });
  $('calChanges').addEventListener('click', e => {
    if (e.target.id !== 'calChangesOk') return;
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
  $('fromToday').checked = load(STORAGE_FROM_TODAY_KEY) !== '0';
  $('fromToday').addEventListener('change', e => {
    store(STORAGE_FROM_TODAY_KEY, e.target.checked ? '1' : '0');
    if (state.result) renderPreview();
  });

  const SHARE_URL = 'https://planning-equipe-coa.github.io/horaires/';
  $('shareLink').addEventListener('click', async () => {
    const btn = $('shareLink');
    if (navigator.share) {
      try { await navigator.share({ title: 'Mes Horaires', url: SHARE_URL }); } catch (e) { /* partage annulé */ }
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
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* pas de hors connexion, l'appli marche quand même */ });
    });
  }

  $('teamJoin').addEventListener('click', joinTeam);
  $('teamCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinTeam(); });
  $('teamSetupOk').addEventListener('click', setupTeam);
  $('teamSyncNow').addEventListener('click', () => syncTeam(true));
  $('teamLeave').addEventListener('click', () => {
    store(STORAGE_TEAM_KEY, '');
    $('publishBox').hidden = true;
    teamMsg('Tu as quitté l\'équipe : ton calendrier reste sur ce téléphone, il ne se met plus à jour tout seul.');
    renderTeam();
  });
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
    if (document.visibilityState === 'visible' && Date.now() - lastSync > 60000) syncTeam(false);
  });

  renderCodes();
  if (state.plan && !load(STORAGE_PLAN_KEY)) savePlan(); // reprise de l'ancien suivi des exports
  openOnUsefulMonth();
  renderCalendar();
  renderTeam();
  syncTeam(false);
})();
