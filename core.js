// Mes Horaires — logique pure (lecture de la grille, génération .ics)
// Module UMD : utilisé par le navigateur (window.PlanningCore) et par les tests node.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanningCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_CODES = [
    { code: 'M', label: 'Matin', allDay: false, start: '06:00', end: '14:00', include: true, color: 'marron' },
    { code: 'S', label: 'Soir', allDay: false, start: '14:00', end: '22:00', include: true, color: 'jaune' },
    { code: 'N', label: 'Nuit', allDay: false, start: '22:00', end: '06:00', include: true, color: 'bleu' },
    { code: 'J', label: 'Journée', allDay: false, start: '07:30', end: '16:30', include: true, color: '' },
    { code: 'JS', label: 'JS', allDay: true, start: '', end: '', include: true, color: '' },
    { code: 'R', label: 'Repos', allDay: true, start: '', end: '', include: true, color: 'blanc' },
    { code: 'Tn', label: 'Tombée de nuit', allDay: true, start: '', end: '', include: true, color: 'blanc' },
    { code: 'RF', label: 'RF', allDay: true, start: '', end: '', include: true, color: 'blanc' },
    { code: 'RC', label: 'RC', allDay: true, start: '', end: '', include: true, color: 'blanc' },
    { code: 'RCN', label: 'Repos', allDay: true, start: '', end: '', include: true, color: 'blanc' },
    { code: 'RECUP', label: 'Récupération', allDay: true, start: '', end: '', include: true, color: 'blanc' },
    // « RECU » se lisait « reçu » : affiché « Recup » (abbr = texte de la pastille du calendrier)
    { code: 'RECU', label: 'Recup', abbr: 'Recup', allDay: true, start: '', end: '', include: true, color: 'blanc' },
    { code: 'CA', label: 'Congé', allDay: true, start: '', end: '', include: true, color: 'vert' },
    { code: 'C', label: 'Congé', allDay: true, start: '', end: '', include: true, color: 'vert' },
    { code: 'EM', label: 'Enfant malade', allDay: true, start: '', end: '', include: true, color: '' },
    { code: 'X', label: 'Absence', allDay: true, start: '', end: '', include: true, color: '' },
    { code: 'ATT', label: 'Repos', allDay: true, start: '', end: '', include: true, color: 'blanc' },
  ];

  // Les agendas Apple et Google ignorent la couleur d'un événement importé : la couleur est
  // donc portée par une pastille emoji en tête du titre (+ COLOR pour les agendas qui la lisent).
  const COLORS = {
    marron: { emoji: '🟤', css: 'saddlebrown' },
    jaune: { emoji: '🟡', css: 'gold' },
    bleu: { emoji: '🔵', css: 'royalblue' },
    blanc: { emoji: '⚪', css: 'white' },
    vert: { emoji: '🟢', css: 'green' },
    orange: { emoji: '🟠', css: 'orange' },
    rouge: { emoji: '🔴', css: 'red' },
    violet: { emoji: '🟣', css: 'purple' },
  };

  function eventTitle(def) {
    const col = COLORS[def.color];
    return (col ? col.emoji + ' ' : '') + (def.label || def.code);
  }

  const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout',
    'septembre', 'octobre', 'novembre', 'decembre'];
  const MONTH_RE = new RegExp('\\b(' + MONTHS.join('|') + ')\\b(?:\\s+(\\d{4}))?');
  const MAX_ROWS = 2000;
  const MAX_COLS = 400;

  function normCode(v) {
    if (v == null || typeof v === 'object') return '';
    return String(v).trim().toUpperCase();
  }

  function stripAccents(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function isDateObj(v) {
    return v && typeof v === 'object' && typeof v.m === 'number' && typeof v.d === 'number';
  }

  // Date complète : cellule date Excel, ou texte "jj/mm[/aaaa]"
  function asDate(v) {
    if (isDateObj(v)) return v;
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
    if (!m) return null;
    const d = +m[1], mo = +m[2];
    if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
    let y = m[3] ? +m[3] : null;
    if (y != null && y < 100) y += 2000;
    return { y, m: mo, d };
  }

  // Numéro de jour seul : 1..31, ou texte "jeu 1", "L 01"
  function asDayNum(v) {
    if (typeof v === 'number') return Number.isInteger(v) && v >= 1 && v <= 31 ? v : null;
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^(?:[a-zéû]{1,8}\.?\s*)?(\d{1,2})$/i);
    if (!m) return null;
    const n = +m[1];
    return n >= 1 && n <= 31 ? n : null;
  }

  function monthFromText(s) {
    const m = stripAccents(s).match(MONTH_RE);
    if (!m) return null;
    return { m: MONTHS.indexOf(m[1]) + 1, y: m[2] ? +m[2] : null };
  }

  // Une ligne est un en-tête de dates si elle contient ≥ 5 dates, ou ≥ 5 numéros de jour consécutifs
  function headerInfo(row) {
    const dates = [], days = [];
    for (let c = 0; c < row.length; c++) {
      const d = asDate(row[c]);
      if (d) { dates.push({ c, date: d }); continue; }
      const n = asDayNum(row[c]);
      if (n) days.push({ c, day: n });
    }
    if (dates.length >= 5) return { kind: 'date', cols: dates };
    if (days.length >= 5) {
      let ok = 0;
      for (let i = 1; i < days.length; i++) {
        if (days[i].day === days[i - 1].day + 1 || days[i].day === 1) ok++;
      }
      if (ok / (days.length - 1) >= 0.7) return { kind: 'day', cols: days };
    }
    return null;
  }

  // Mois/année d'un bloc : cherché au-dessus de l'en-tête, puis dans le nom de la feuille
  function findContext(matrix, r, sheetName, opts) {
    let y = null, m = null;
    for (let i = r; i >= Math.max(0, r - 8) && (m == null || y == null); i--) {
      const row = matrix[i] || [];
      for (let c = 0; c < row.length; c++) {
        const v = row[c];
        let found = null;
        if (isDateObj(v) && i !== r) found = { m: v.m, y: v.y };
        else if (typeof v === 'string') found = monthFromText(v);
        if (!found) continue;
        if (m == null) m = found.m;
        if (y == null && found.y != null) y = found.y;
      }
    }
    if ((m == null || y == null) && sheetName) {
      const found = monthFromText(sheetName);
      if (found) {
        if (m == null) m = found.m;
        if (y == null && found.y != null) y = found.y;
      }
      const ym = String(sheetName).match(/\b(20\d{2})\b/);
      if (y == null && ym) y = +ym[1];
    }
    const assumed = m == null || y == null;
    if (m == null) m = opts.month;
    if (y == null) y = opts.year;
    return { y, m, assumed };
  }

  function resolveHeader(matrix, r, info, sheetName, opts) {
    const ctx = findContext(matrix, r, sheetName, opts);
    let assumed = false;
    const cols = [];
    if (info.kind === 'date') {
      for (const h of info.cols) {
        let y = h.date.y;
        if (y == null) { y = ctx.y; assumed = assumed || ctx.assumed; }
        cols.push({ c: h.c, date: { y, m: h.date.m, d: h.date.d } });
      }
    } else {
      assumed = ctx.assumed;
      let y = ctx.y, m = ctx.m, prev = 0;
      for (const h of info.cols) {
        if (h.day < prev) { m++; if (m > 12) { m = 1; y++; } }
        prev = h.day;
        cols.push({ c: h.c, date: { y, m, d: h.day } });
      }
    }
    return { cols, assumed, ctx };
  }

  function rowName(row, firstCol, r) {
    const parts = [];
    for (let c = 0; c < firstCol && parts.length < 3; c++) {
      const v = row[c];
      if (typeof v === 'string' && v.trim() && !/^\d+$/.test(v.trim())) parts.push(v.trim());
    }
    return parts.length ? parts.join(' ') : 'Ligne ' + (r + 1);
  }

  function parseOriented(matrix, sheetName, opts) {
    const known = new Set(opts.codes.map(c => normCode(c.code)));
    const agents = new Map();
    let header = null, assumed = false, ctx = null, total = 0;
    for (let r = 0; r < matrix.length; r++) {
      const row = matrix[r] || [];
      const info = headerInfo(row);
      if (info) {
        header = resolveHeader(matrix, r, info, sheetName, opts);
        assumed = assumed || header.assumed;
        if (!ctx) ctx = header.ctx;
        continue;
      }
      if (!header) continue;
      const cells = [];
      let matched = 0;
      for (const h of header.cols) {
        const code = normCode(row[h.c]);
        if (!code) continue;
        cells.push({ date: h.date, code });
        if (known.has(code)) matched++;
      }
      // ligne d'agent : au moins 3 codes connus et 60 % des cases reconnues
      // (écarte la ligne des jours « L M M J V S D »)
      if (matched < 3 || matched / cells.length < 0.6) continue;
      // même nom sur un autre bloc : fusion si ce sont d'autres dates (mois suivant),
      // sinon c'est un homonyme → « NOM (2) »
      const base = rowName(row, header.cols[0].c, r);
      const keys = new Set(cells.map(x => dateKey(x.date)));
      let name = base, n = 1;
      while (agents.has(name) && agents.get(name).entries.some(x => keys.has(dateKey(x.date)))) {
        name = base + ' (' + (++n) + ')';
      }
      if (!agents.has(name)) agents.set(name, { name, entries: [] });
      agents.get(name).entries.push(...cells);
      total += cells.length;
    }
    return { agents: [...agents.values()], monthAssumed: assumed, ctx, total };
  }

  function transpose(matrix) {
    const w = matrix.reduce((n, r) => Math.max(n, r ? r.length : 0), 0);
    const out = [];
    for (let c = 0; c < w; c++) {
      const row = [];
      for (let r = 0; r < matrix.length; r++) row.push(matrix[r] ? matrix[r][c] : null);
      out.push(row);
    }
    return out;
  }

  // matrix : tableau de lignes ; cellule = texte, nombre, null, ou {y,m,d} pour une date Excel
  function parseMatrix(matrix, options) {
    const now = new Date();
    const opts = Object.assign({
      codes: DEFAULT_CODES, sheetName: '', year: now.getFullYear(), month: now.getMonth() + 1,
    }, options);
    const a = parseOriented(matrix, opts.sheetName, opts);
    const b = parseOriented(transpose(matrix), opts.sheetName, opts);
    const best = b.total > a.total ? b : a;
    for (const ag of best.agents) {
      ag.entries.sort((x, y) => dateKey(x.date).localeCompare(dateKey(y.date)));
    }
    return best;
  }

  // Convertit une feuille SheetJS en matrice (dates Excel → {y,m,d}, sans fuseau horaire)
  function sheetToMatrix(XLSX, ws) {
    if (!ws || !ws['!ref']) return [];
    const range = XLSX.utils.decode_range(ws['!ref']);
    const lastR = Math.min(range.e.r, range.s.r + MAX_ROWS);
    const lastC = Math.min(range.e.c, range.s.c + MAX_COLS);
    const m = [];
    for (let r = range.s.r; r <= lastR; r++) {
      const row = [];
      for (let c = range.s.c; c <= lastC; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        let v = null;
        if (cell && cell.v != null) {
          if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
            const p = XLSX.SSF.parse_date_code(cell.v);
            v = p ? { y: p.y, m: p.m, d: p.d } : cell.v;
          } else if (cell.v instanceof Date) {
            v = { y: cell.v.getFullYear(), m: cell.v.getMonth() + 1, d: cell.v.getDate() };
          } else {
            v = cell.v;
          }
        }
        row.push(v);
      }
      m.push(row);
    }
    return m;
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function dateKey(d) { return d.y + pad(d.m) + pad(d.d); }
  function nextDay(d) {
    const t = new Date(Date.UTC(d.y, d.m - 1, d.d + 1));
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
  }
  function isValidDate(d) {
    const t = new Date(Date.UTC(d.y, d.m - 1, d.d));
    return t.getUTCMonth() === d.m - 1 && t.getUTCDate() === d.d;
  }

  // Sépare les cases d'un agent en événements à exporter, cases ignorées et codes inconnus.
  // Sans withHours, tout est exporté en journée entière (« Matin », « Nuit »… sans créneau horaire).
  function buildEvents(entries, codes, options) {
    const withHours = !!(options && options.withHours);
    const map = new Map(codes.map(c => [normCode(c.code), c]));
    const events = [], unknown = {};
    let skipped = 0;
    for (const e of entries) {
      const def = map.get(e.code);
      if (!def) { unknown[e.code] = (unknown[e.code] || 0) + 1; continue; }
      if (!def.include || !isValidDate(e.date)) { skipped++; continue; }
      const timed = withHours && !def.allDay;
      if (timed && !(/^\d{2}:\d{2}$/.test(def.start) && /^\d{2}:\d{2}$/.test(def.end))) {
        skipped++; continue;
      }
      events.push({ date: e.date, code: def.code, def, timed });
    }
    return { events, unknown, skipped };
  }

  // Instantané du planning d'un agent, gardé sur le téléphone : { 'AAAAMMJJ': 'CODE' }
  function snapshotOf(entries) {
    const days = {};
    for (const e of entries) days[dateKey(e.date)] = e.code;
    return days;
  }

  function keyRange(days) {
    const keys = Object.keys(days).sort();
    return keys.length ? [keys[0], keys[keys.length - 1]] : null;
  }

  // Jours qui ont changé entre l'instantané précédent et le nouveau planning. Seule la période
  // couverte par les deux compte : un nouveau mois n'est pas un « changement ».
  // Une case vidée ou nouvellement remplie apparaît avec '' d'un côté.
  function diffSnapshot(prev, entries) {
    const now = snapshotOf(entries);
    const a = keyRange(prev || {}), b = keyRange(now);
    if (!a || !b) return { changes: [], overlap: false };
    const first = a[0] > b[0] ? a[0] : b[0], last = a[1] < b[1] ? a[1] : b[1];
    if (first > last) return { changes: [], overlap: false };
    const keys = new Set(Object.keys(prev).concat(Object.keys(now)));
    const changes = [];
    for (const k of keys) {
      if (k < first || k > last) continue;
      const before = prev[k] || '', after = now[k] || '';
      if (before !== after) changes.push({ key: k, before, after });
    }
    changes.sort((x, y) => x.key.localeCompare(y.key));
    return { changes, overlap: true };
  }

  // Met à jour l'instantané avec le planning exporté ; oublie les jours antérieurs à minKey
  function mergeSnapshot(prev, entries, minKey) {
    const now = snapshotOf(entries);
    const range = keyRange(now);
    const out = {};
    for (const k of Object.keys(prev || {})) {
      if (range && k >= range[0] && k <= range[1]) continue; // remplacé par le nouveau planning
      if (!minKey || k >= minKey) out[k] = prev[k];
    }
    for (const k of Object.keys(now)) if (!minKey || k >= minKey) out[k] = now[k];
    return out;
  }

  // ── Planning gardé sur le téléphone (vue calendrier) ─────────────────────
  // plan = { agents: { NOM: { 'AAAAMMJJ': 'CODE' } } }
  // Un nouveau tableau remplace toute la période qu'il couvre (pour tous les agents : un agent
  // absent du nouveau tableau n'a plus de case sur cette période) ; le reste est conservé.
  // Les jours antérieurs à minKey sont oubliés.
  function mergePlan(prev, agents, minKey) {
    let first = null, last = null;
    for (const ag of agents) {
      for (const e of ag.entries) {
        const k = dateKey(e.date);
        if (first == null || k < first) first = k;
        if (last == null || k > last) last = k;
      }
    }
    const out = { agents: {} };
    const keep = k => (!minKey || k >= minKey) && (first == null || k < first || k > last);
    const prevAgents = (prev && prev.agents) || {};
    for (const name of Object.keys(prevAgents)) {
      const days = {};
      for (const k of Object.keys(prevAgents[name])) if (keep(k)) days[k] = prevAgents[name][k];
      if (Object.keys(days).length) out.agents[name] = days;
    }
    for (const ag of agents) {
      const days = out.agents[ag.name] || (out.agents[ag.name] = {});
      for (const e of ag.entries) {
        const k = dateKey(e.date);
        if (isValidDate(e.date) && (!minKey || k >= minKey)) days[k] = e.code;
      }
      if (!Object.keys(days).length) delete out.agents[ag.name];
    }
    return out;
  }

  // Semaines du mois, du lundi au dimanche : tableau de 7 cases {y,m,d} ou null
  function monthGrid(y, m) {
    const first = new Date(Date.UTC(y, m - 1, 1));
    const offset = (first.getUTCDay() + 6) % 7; // lundi = 0
    const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [];
    for (let i = 0; i < offset; i++) cells.push(null);
    for (let d = 1; d <= count; d++) cells.push({ y, m, d });
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    return weeks;
  }

  // Collègues ayant le même code ce jour-là (hors l'agent lui-même), triés par nom
  function sameShift(plan, key, code, self) {
    const out = [];
    const agents = (plan && plan.agents) || {};
    for (const name of Object.keys(agents)) {
      if (name !== self && agents[name][key] === code) out.push(name);
    }
    return out.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }
  function slug(s) {
    return stripAccents(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
  }

  const VTIMEZONE = [
    'BEGIN:VTIMEZONE', 'TZID:Europe/Paris',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST',
    'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET',
    'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];

  // Un UID stable par jour et par agent : réimporter un planning modifié met à jour
  // les événements au lieu de les dupliquer.
  function buildICS(events, options) {
    const opts = Object.assign({ name: '', now: new Date() }, options);
    const stamp = opts.now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const id = slug(opts.name);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mes Horaires//FR', 'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH', 'X-WR-CALNAME:Horaires', 'X-WR-TIMEZONE:Europe/Paris', ...VTIMEZONE];
    for (const ev of events) {
      const d = ev.date, def = ev.def;
      lines.push('BEGIN:VEVENT', 'UID:' + dateKey(d) + '-' + id + '@mes-horaires', 'DTSTAMP:' + stamp);
      if (!ev.timed) {
        lines.push('DTSTART;VALUE=DATE:' + dateKey(d), 'DTEND;VALUE=DATE:' + dateKey(nextDay(d)),
          'TRANSP:TRANSPARENT');
      } else {
        const start = def.start.replace(':', ''), end = def.end.replace(':', '');
        const endDate = end <= start ? nextDay(d) : d;
        lines.push('DTSTART;TZID=Europe/Paris:' + dateKey(d) + 'T' + start + '00',
          'DTEND;TZID=Europe/Paris:' + dateKey(endDate) + 'T' + end + '00');
      }
      lines.push('SUMMARY:' + icsEscape(eventTitle(def)));
      if (COLORS[def.color]) lines.push('COLOR:' + COLORS[def.color].css);
      lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  return { DEFAULT_CODES, COLORS, eventTitle, snapshotOf, diffSnapshot, mergeSnapshot, mergePlan, monthGrid, sameShift, parseMatrix, sheetToMatrix, buildEvents, buildICS, normCode, dateKey, slug };
});
