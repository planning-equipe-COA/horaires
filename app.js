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
  const CODES_VERSION = 7;
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
      sum: load(STORAGE_SUM_KEY) === 'year' ? 'year' : 'month', compare: '' } };
  state.cal.view = ['month', 'list', 'team'].includes(load(STORAGE_VIEW_KEY)) ? load(STORAGE_VIEW_KEY) : 'month';

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
    const nRemarks = res.agents.reduce((n, a) => n + a.entries.filter(e => e.note).length, 0);
    const mine = (res.agents.find(a => a.name === state.cal.agent) || { entries: [] }).entries.filter(e => e.note).length;
    $('saved').hidden = !keys.length;
    $('saved').innerHTML = keys.length
      ? `✓ Planning enregistré sur ce téléphone, du ${esc(fmt(keys[0]))} au ${esc(fmt(keys[keys.length - 1]))}.` +
        (nRemarks ? `<br><span class="saved-remarks">💬 ${nRemarks} commentaire${nRemarks > 1 ? 's' : ''} de case${nRemarks > 1 ? 's' : ''} lu${nRemarks > 1 ? 's' : ''} dans le fichier` +
          (mine ? ` (dont ${mine} sur ton planning)` : '') + ' : repère le 💬 dans le calendrier.</span>' : '') : '';
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
      const n = applyAgents(state.plan, planToAgents(data.agents, data.remarks),
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
        const full = C.mergePlan(current, agents, minKeep());
        const merged = { agents: full.agents, remarks: full.remarks };
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
        () => ({ plan: { agents: info.previous ? info.previous.agents : {}, remarks: info.previous && info.previous.remarks || {} } }));
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
    const plan = planView();
    const names = Object.keys(plan.agents).sort((a, b) => a.localeCompare(b, 'fr'));
    const empty = !names.length;
    $('calCard').hidden = false;
    $('importTitle').textContent = empty ? 'Le planning' : 'Nouveau planning';
    const me = load(STORAGE_NAME_KEY);
    if (!empty && !names.includes(state.cal.agent)) state.cal.agent = names.includes(me) ? me : names[0];
    const name = empty ? '' : state.cal.agent;
    $('calAgent').hidden = empty;
    $('calAgent').innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    if (!empty) $('calAgent').value = name;
    $('calPartial').hidden = empty || !!plan.at; // repris de l'ancien suivi des exports, pas encore d'import
    $('calEmpty').textContent = empty
      ? (teamCode() ? 'Pas encore de planning sur ce téléphone : il arrivera dès qu\'un collègue l\'aura envoyé à l\'équipe, ou importe le tableau de service ci-dessous.'
        : 'Pas encore de planning sur ce téléphone : importe le tableau de service ci-dessous pour remplir le calendrier.')
      : 'Pas de planning pour ce mois : importe le tableau de service ci-dessous.';

    const { y, m } = state.cal;
    $('calTitle').textContent = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const days = plan.agents[name] || {};
    const changes = new Map(((plan.changes || {})[name] || []).map(ch => [ch.key, ch]));
    const todayKey = C.dateKey(todayDate());
    const remarks = (plan.remarks || {})[name] || {};

    // comparaison avec un collègue (préparer un échange de poste)
    if (state.cal.compare === name || !plan.agents[state.cal.compare]) state.cal.compare = '';
    $('calCompare').innerHTML = '<option value="">Comparer avec un collègue…</option>' +
      names.filter(n => n !== name).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    $('calCompare').value = state.cal.compare;
    $('compareRow').hidden = empty || names.length < 2 || state.cal.view === 'team';
    const cmp = state.cal.compare ? plan.agents[state.cal.compare] : null;
    $('compareLegend').hidden = !cmp || state.cal.view === 'team';
    if (cmp) $('compareLegend').innerHTML = `En haut <strong>${esc(name)}</strong>, en bas <strong>${esc(state.cal.compare)}</strong>. ` +
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
          `${notes[k] ? '<span class="note-dot" aria-label="note">📝</span>' : ''}</button>`;
      }
    }
    $('calGrid').innerHTML = html;
    if (state.cal.view === 'team' && names.length < 2) state.cal.view = 'month';
    const view = state.cal.view;
    $('calGrid').hidden = view !== 'month';
    $('calList').hidden = view !== 'list';
    $('calTeam').hidden = view !== 'team';
    $('calGrid').classList.toggle('comparing', !!cmp);
    $('viewMonth').setAttribute('aria-selected', String(view === 'month'));
    $('viewList').setAttribute('aria-selected', String(view === 'list'));
    $('viewTeam').setAttribute('aria-selected', String(view === 'team'));
    $('viewTeam').hidden = names.length < 2;
    if (view === 'list') renderList(days, changes, todayKey, cmp, swapDay, remarks);
    if (view === 'team') renderTeamTable(plan, names, name, todayKey);
    $('calEmpty').hidden = inMonth > 0;
    renderWelcome(names);
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
    html += `<div class="sum-row sum-maj"><span class="sum-n">💶</span><span class="sum-title">Travaillés en majoration</span>` +
      `<span class="sum-detail">${extra.join('')}</span></div>`;
    const hours = C.monthHours(days, state.codes, state.cal.y, year ? null : state.cal.m);
    const fmtH = min => { const h = Math.floor(min / 60), r = min % 60; return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : ''); };
    html += `<div class="sum-row sum-hours"><span class="sum-n">⏱</span><span class="sum-title">${fmtH(hours.minutes)} <span class="muted">théoriques${year ? ' sur l\'année' : ' ce mois'}</span></span>` +
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
      $('wName').innerHTML = '<option value="">Choisis ton nom…</option>' +
        names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
      $('wName').value = known ? me : '';
    }
    $('wNameDone').textContent = known ? me : '';
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
          ? `<span class="next-mates">${mates.length ? 'avec ' + mates.slice(0, 3).map(esc).join(', ') + (mates.length > 3 ? ` +${mates.length - 3}` : '') : 'seul(e) en ' + esc(codeLabel(code))}</span>`
          : '') +
        (((plan.remarks || {})[me] || {})[k] ? `<span class="next-note next-remark">💬 ${esc(plan.remarks[me][k])}</span>` : '') +
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
    const plan = planView(), name = state.cal.agent, d = keyToDate(k);
    const code = (plan.agents[name] || {})[k];
    let html = '';
    if (withHead) {
      const title = utc(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
      html += `<div class="cal-day-head"><strong>${esc(title)}</strong>` +
        (code ? ` ${chip(code)} <span>${esc(codeLabel(code))}</span>` : ' <span class="muted">pas de planning</span>') + '</div>';
    }
    const holiday = C.holidayName(k);
    if (holiday) html += `<p class="day-holiday">🎉 Férié : ${esc(holiday)}</p>`;
    const remark = ((plan.remarks || {})[name] || {})[k];
    if (remark) html += `<p class="day-remark">💬 <span class="muted">Commentaire sur le planning :</span> ${esc(remark)}</p>`;
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

  // Vue « Équipe » : tous les agents en lignes, les jours du mois en colonnes (comme le tableau Excel)
  function renderTeamTable(plan, names, me, todayKey) {
    const { y, m } = state.cal;
    const dates = C.monthGrid(y, m).flat().filter(Boolean);
    const order = [me].concat(names.filter(n => n !== me));
    let html = '<table class="team-table"><thead><tr><th class="tt-name"></th>';
    for (const d of dates) {
      const k = C.dateKey(d), wd = utc(d).getUTCDay();
      const cls = [wd === 0 || wd === 6 ? 'we' : '', k === todayKey ? 'today' : '', k === state.cal.selected ? 'sel' : '', C.holidayName(k) ? 'hol' : ''].filter(Boolean).join(' ');
      html += `<th class="${cls}" data-key="${k}"><span>${WEEKDAYS[(wd + 6) % 7].slice(0, 1).toUpperCase()}</span>${d.d}</th>`;
    }
    html += '</tr></thead><tbody>';
    for (const n of order) {
      const days = plan.agents[n] || {};
      html += `<tr${n === me ? ' class="me"' : ''}><th class="tt-name" scope="row">${esc(n)}</th>`;
      for (const d of dates) {
        const k = C.dateKey(d), wd = utc(d).getUTCDay();
        const cls = [wd === 0 || wd === 6 ? 'we' : '', k === todayKey ? 'today' : '', k === state.cal.selected ? 'sel' : ''].filter(Boolean).join(' ');
        const rk = ((plan.remarks || {})[n] || {})[k];
        html += `<td class="${cls}${rk ? ' remark' : ''}" data-key="${k}"${rk ? ` title="${esc(rk)}"` : ''}>${days[k] ? chip(days[k]) : ''}${rk ? '<span class="tt-remark">💬</span>' : ''}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    $('calTeam').innerHTML = `<div class="tt-wrap">${html}</div><p class="hint">Touche un jour pour voir le détail. Fais glisser le tableau pour voir tout le mois.</p>`;
    const wrap = $('calTeam').querySelector('.tt-wrap');
    const target = wrap.querySelector('th.sel, th.today');
    if (target) wrap.scrollLeft = Math.max(0, target.offsetLeft - 140);
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
        (notes[k] ? ' <span class="note-dot">📝</span>' : '') +
        (cmp ? `<span class="cmp-inline">⇄ ${cmp[k] ? chip(cmp[k]) + ' ' + esc(codeLabel(cmp[k])) : '<span class="muted">—</span>'}</span>` : '') +
        '</span>' +
        (remarks[k] ? `<span class="row-remark">💬 ${esc(remarks[k])}</span>` : '') + '</button>';
      if (k === state.cal.selected) html += `<div class="cal-row-detail">${dayDetailHTML(k, false)}</div>`;
    }
    $('calList').innerHTML = html;
  }

  function renderDay() {
    const k = state.cal.selected, box = $('calDay');
    if (state.cal.view === 'list') { box.hidden = true; return; }
    const d = k && keyToDate(k);
    if (!d || d.y !== state.cal.y || d.m !== state.cal.m) { box.hidden = true; return; }
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
    store('mh_name_ok', '1');
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
  ['viewMonth', 'viewList', 'viewTeam'].forEach(id => $(id).addEventListener('click', e => {
    state.cal.view = e.currentTarget.dataset.view;
    store(STORAGE_VIEW_KEY, state.cal.view);
    renderCalendar();
    if (state.cal.view === 'list') scrollToSelected();
  }));
  $('calCompare').addEventListener('change', e => { state.cal.compare = e.target.value; renderCalendar(); });
  $('calTeam').addEventListener('click', e => {
    const cell = e.target.closest('[data-key]');
    if (!cell) return;
    state.cal.selected = cell.dataset.key;
    renderCalendar();
    $('calDay').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
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
    renderDay();
  });
  $('calChanges').addEventListener('click', e => {
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
    if (state.result) renderPreview();
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
  $('wJoin').addEventListener('click', () => {
    $('teamDetails').open = true;
    $('teamDetails').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => $('teamCode').focus(), 400);
  });
  $('wImport').addEventListener('click', () => {
    $('drop').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
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
          () => ({ plan: { agents: data.agents || {}, remarks: data.remarks || {} } }), undefined, 'Planning restauré');
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
