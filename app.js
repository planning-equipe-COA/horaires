(function () {
  'use strict';
  const C = window.PlanningCore;
  const STORAGE_CODES_KEY = 'mh_codes';
  const STORAGE_NAME_KEY = 'mh_name';
  const STORAGE_CODES_VERSION_KEY = 'mh_codes_v';
  const STORAGE_FROM_TODAY_KEY = 'mh_from_today';
  const STORAGE_SNAPSHOTS_KEY = 'mh_snap'; // ancien suivi des exports, repris une fois dans mh_plan
  const STORAGE_PLAN_KEY = 'mh_plan';
  const PLAN_KEEP_DAYS = 400;
  const CODES_VERSION = 5;
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
    const text = def ? def.code : code;
    return `<span class="chip${text.length > 3 ? ' long' : ''}" data-color="${esc(def && def.color || '')}">${esc(text)}</span>`;
  }

  const today = todayDate();
  const state = { workbook: null, fileName: '', result: null, codes: loadCodes(), events: [],
    plan: loadPlan(), planBefore: undefined,
    cal: { y: today.y, m: today.m, agent: load(STORAGE_NAME_KEY) || '', selected: C.dateKey(today) } };

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
  function savePlanFromImport(res) {
    const before = state.planBefore || null;
    const min = new Date(Date.now() - PLAN_KEEP_DAYS * 864e5);
    const minKey = C.dateKey({ y: min.getFullYear(), m: min.getMonth() + 1, d: min.getDate() });
    const plan = C.mergePlan(before, res.agents, minKey);
    plan.changes = {};
    for (const ag of res.agents) {
      const prev = before && before.agents[ag.name];
      if (!prev) continue;
      const diff = C.diffSnapshot(prev, ag.entries);
      if (diff.changes.length) plan.changes[ag.name] = diff.changes;
    }
    plan.changesSince = before && before.at || null;
    plan.changesSeen = false;
    plan.at = new Date().toISOString();
    plan.file = state.fileName;
    state.plan = plan;
    savePlan();

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

    const { y, m } = state.cal;
    $('calTitle').textContent = new Date(Date.UTC(y, m - 1, 1))
      .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const days = plan.agents[name] || {};
    const changes = new Map(((plan.changes || {})[name] || []).map(ch => [ch.key, ch]));
    const todayKey = C.dateKey(todayDate());

    let html = WEEKDAYS.map(w => `<div class="cal-wd">${w}</div>`).join('');
    let inMonth = 0;
    const counts = {};
    for (const week of C.monthGrid(y, m)) {
      for (const d of week) {
        if (!d) { html += '<div class="cal-cell blank"></div>'; continue; }
        const k = C.dateKey(d), code = days[k];
        if (code) { inMonth++; const l = codeLabel(code); counts[l] = (counts[l] || 0) + 1; }
        const cls = ['cal-cell'];
        if (k === todayKey) cls.push('today');
        if (k === state.cal.selected) cls.push('selected');
        if (changes.has(k) && !plan.changesSeen) cls.push('changed');
        html += `<button class="${cls.join(' ')}" data-key="${k}" aria-label="${d.d}${code ? ' : ' + esc(codeLabel(code)) : ''}">` +
          `<span class="n">${d.d}</span>${code ? chip(code) : ''}</button>`;
      }
    }
    $('calGrid').innerHTML = html;
    $('calEmpty').hidden = inMonth > 0;
    $('calTally').innerHTML = Object.keys(counts).map(l => `<span>${counts[l]} ${esc(l)}</span>`).join('');

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

  function renderDay() {
    const k = state.cal.selected, box = $('calDay');
    const plan = state.plan, name = state.cal.agent;
    const d = k && keyToDate(k);
    if (!plan || !d || d.y !== state.cal.y || d.m !== state.cal.m) { box.hidden = true; return; }
    const code = (plan.agents[name] || {})[k];
    const title = utc(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    let html = `<div class="cal-day-head"><strong>${esc(title)}</strong>` +
      (code ? ` ${chip(code)} <span>${esc(codeLabel(code))}</span>` : ' <span class="muted">pas de planning</span>') + '</div>';
    const ch = ((plan.changes || {})[name] || []).find(c => c.key === k);
    if (ch && !plan.changesSeen) html += `<p class="was">Avant le nouveau planning : ${esc(codeTitle(ch.before))}</p>`;
    if (code) {
      const others = C.sameShift(plan, k, code, name);
      html += others.length
        ? `<p class="mates"><span class="muted">Aussi ${esc(codeLabel(code))} (${others.length}) :</span> ${others.map(esc).join(', ')}</p>`
        : `<p class="mates muted">Personne d'autre en ${esc(codeLabel(code))} ce jour-là.</p>`;
    }
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
  $('calGrid').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; }, { passive: true });
  $('calGrid').addEventListener('touchend', e => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX, dy = e.changedTouches[0].clientY - touchY;
    touchX = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 1.5 * Math.abs(dy)) moveMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
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

  renderCodes();
  if (state.plan && !load(STORAGE_PLAN_KEY)) savePlan(); // reprise de l'ancien suivi des exports
  openOnUsefulMonth();
  renderCalendar();
})();
