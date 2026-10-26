(function () {
  'use strict';
  const C = window.PlanningCore;
  const STORAGE_CODES_KEY = 'mh_codes';
  const STORAGE_NAME_KEY = 'mh_name';
  const STORAGE_CODES_VERSION_KEY = 'mh_codes_v';
  const CODES_VERSION = 4;
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

  const state = { workbook: null, fileName: '', result: null, codes: loadCodes(), events: [] };

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
    renderPreview();
  }

  function renderPreview() {
    const agent = state.result.agents.find(a => a.name === $('agent').value) || state.result.agents[0];
    const { events, unknown } = C.buildEvents(agent.entries, state.codes);
    state.events = events;
    $('previewCard').hidden = false;

    const counts = {};
    events.forEach(e => { counts[e.def.label || e.code] = (counts[e.def.label || e.code] || 0) + 1; });
    const detail = Object.keys(counts).map(k => `${counts[k]} ${esc(k)}`).join(', ');
    $('summary').innerHTML = events.length
      ? `<strong>${events.length} événement${events.length > 1 ? 's' : ''}</strong> pour ${esc(agent.name)} : ${detail}.`
      : 'Aucun événement à exporter avec les codes cochés.';
    $('download').disabled = !events.length;

    const unknownCodes = Object.keys(unknown);
    $('unknown').hidden = !unknownCodes.length;
    $('unknown').innerHTML = unknownCodes.length
      ? 'Codes non reconnus, ignorés pour l\'instant :<br>' + unknownCodes.map(code =>
        `<button data-add="${esc(code)}">+ ${esc(code.slice(0, 20))} (${unknown[code]})</button>`).join('')
      : '';

    const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
    const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    let html = '', lastMonth = '';
    for (const e of events) {
      const date = new Date(Date.UTC(e.date.y, e.date.m - 1, e.date.d));
      const month = monthFmt.format(date);
      if (month !== lastMonth) { html += `<tr class="month"><td colspan="2">${esc(month)}</td></tr>`; lastMonth = month; }
      html += `<tr><td>${esc(dayFmt.format(date))}</td><td>${esc(e.def.label || e.code)}</td></tr>`;
    }
    $('preview').innerHTML = html;
  }

  function renderCodes() {
    let html = '<tr><th>Agenda</th><th>Code</th><th>Libellé</th><th></th></tr>';
    state.codes.forEach((c, i) => {
      html += `<tr data-i="${i}">` +
        `<td><input type="checkbox" data-f="include" ${c.include ? 'checked' : ''}></td>` +
        `<td><input type="text" class="code" data-f="code" value="${esc(c.code)}"></td>` +
        `<td><input type="text" class="label" data-f="label" value="${esc(c.label)}"></td>` +
        `<td><button data-del title="Supprimer">✕</button></td></tr>`;
    });
    $('codes').innerHTML = html;
  }

  function codesChanged(rerender) {
    store(STORAGE_CODES_KEY, JSON.stringify(state.codes));
    store(STORAGE_CODES_VERSION_KEY, String(CODES_VERSION));
    if (rerender) renderCodes();
    refresh();
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
  $('agent').addEventListener('change', () => { store(STORAGE_NAME_KEY, $('agent').value); renderPreview(); });
  $('download').addEventListener('click', download);

  $('unknown').addEventListener('click', e => {
    const code = e.target.dataset.add;
    if (!code) return;
    state.codes.push({ code, label: code, allDay: true, start: '', end: '', include: true });
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
    state.codes.push({ code: '', label: '', allDay: true, start: '', end: '', include: true });
    codesChanged(true);
  });
  $('resetCodes').addEventListener('click', () => {
    state.codes = cloneDefaults();
    codesChanged(true);
  });

  renderCodes();
})();
