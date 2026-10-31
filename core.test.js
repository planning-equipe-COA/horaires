const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const C = require('./core.js');

const OPTS = { year: 2026, month: 1 };

test('grille avec numéros de jour et titre de mois', () => {
  const m = [
    ['Planning Octobre 2026'],
    [null, 'J', 'V', 'S', 'D', 'L', 'M', 'M'],
    ['Nom', 1, 2, 3, 4, 5, 6, 7],
    ['DUPONT', 'M', 'M', 'S', 'N', 'Tn', 'R', 'CA'],
    ['MARTIN', 'R', 'R', 'M', 'M', 'S', 'S', 'N'],
  ];
  const res = C.parseMatrix(m, OPTS);
  assert.strictEqual(res.monthAssumed, false);
  assert.deepStrictEqual(res.agents.map(a => a.name), ['DUPONT', 'MARTIN']);
  assert.deepStrictEqual(res.agents[0].entries[0], { date: { y: 2026, m: 10, d: 1 }, code: 'M' });
  assert.strictEqual(res.agents[0].entries[4].code, 'TN');
});

test('la ligne des jours de semaine sous les dates n\'est pas prise pour un agent', () => {
  const m = [
    ['Mars 2026', 1, 2, 3, 4, 5, 6, 7],
    [null, 'D', 'L', 'M', 'M', 'J', 'V', 'S'],
    ['DUPONT', 'M', 'M', 'S', 'N', 'Tn', 'R', 'R'],
  ];
  const res = C.parseMatrix(m, OPTS);
  assert.deepStrictEqual(res.agents.map(a => a.name), ['DUPONT']);
});

test('homonymes sur deux blocs aux mêmes dates : agents distincts', () => {
  const m = [
    ['Octobre 2026', 1, 2, 3, 4, 5],
    ['SANCHEZ', 'M', 'M', 'S', 'S', 'N'],
    [],
    [null, 1, 2, 3, 4, 5],
    ['SANCHEZ', 'R', 'R', 'M', 'M', 'S'],
  ];
  const res = C.parseMatrix(m, OPTS);
  assert.deepStrictEqual(res.agents.map(a => a.name), ['SANCHEZ', 'SANCHEZ (2)']);
  assert.strictEqual(res.agents[1].entries[0].code, 'R');
});

test('dates Excel complètes, passage de mois', () => {
  const dates = [29, 30, 31, 1, 2].map((d, i) => ({ y: 2026, m: i < 3 ? 10 : 11, d }));
  const m = [['Agent', ...dates], ['DUPONT', 'N', 'N', 'Tn', 'R', 'M']];
  const res = C.parseMatrix(m, OPTS);
  assert.deepStrictEqual(res.agents[0].entries[3].date, { y: 2026, m: 11, d: 1 });
});

test('numéros de jour sans mois : mois supposé, changement de mois au retour à 1', () => {
  const m = [[null, 29, 30, 31, 1, 2], ['DUPONT', 'M', 'M', 'S', 'S', 'N']];
  const res = C.parseMatrix(m, { year: 2026, month: 12 });
  assert.strictEqual(res.monthAssumed, true);
  assert.deepStrictEqual(res.agents[0].entries[3].date, { y: 2027, m: 1, d: 1 });
});

test('planning en colonne (une ligne par jour)', () => {
  const m = [['Date', 'Poste']];
  ['M', 'M', 'S', 'N', 'Tn', 'R'].forEach((c, i) => m.push([{ y: 2026, m: 10, d: i + 1 }, c]));
  const res = C.parseMatrix(m, OPTS);
  assert.strictEqual(res.agents.length, 1);
  assert.strictEqual(res.agents[0].entries.length, 6);
  assert.deepStrictEqual(res.agents[0].entries[3], { date: { y: 2026, m: 10, d: 4 }, code: 'N' });
});

test('événements : tous les codes inclus par défaut, codes décochés ignorés, codes inconnus signalés', () => {
  const entries = ['M', 'R', 'CA', 'X', 'FORM'].map((code, i) => ({ date: { y: 2026, m: 10, d: i + 1 }, code }));
  const codes = C.DEFAULT_CODES.map(c => Object.assign({}, c, c.code === 'X' ? { include: false } : {}));
  assert.ok(C.DEFAULT_CODES.every(c => c.include));
  const { events, unknown, skipped } = C.buildEvents(entries, codes);
  assert.deepStrictEqual(events.map(e => e.code), ['M', 'R', 'CA']);
  assert.deepStrictEqual(unknown, { FORM: 1 });
  assert.strictEqual(skipped, 1);
});

test('ics : la nuit finit le lendemain, y compris en fin de mois', () => {
  const entries = [
    { date: { y: 2026, m: 10, d: 31 }, code: 'N' },
    { date: { y: 2026, m: 10, d: 5 }, code: 'M' },
    { date: { y: 2026, m: 12, d: 31 }, code: 'CA' },
  ];
  const { events } = C.buildEvents(entries, C.DEFAULT_CODES, { withHours: true });
  const ics = C.buildICS(events, { name: 'Dupont Élise', now: new Date(Date.UTC(2026, 9, 13, 18, 0, 0)) });
  assert.ok(ics.includes('DTSTART;TZID=Europe/Paris:20261031T220000\r\nDTEND;TZID=Europe/Paris:20261101T060000'));
  assert.ok(ics.includes('DTSTART;TZID=Europe/Paris:20261005T060000\r\nDTEND;TZID=Europe/Paris:20261005T140000'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101'));
  assert.ok(ics.includes('UID:20261031-dupont-elise@mes-horaires'));
  assert.ok(ics.includes('DTSTAMP:20261013T180000Z'));
  assert.strictEqual((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
});

test('ics par défaut : journées entières sans horaires', () => {
  const entries = [{ date: { y: 2026, m: 10, d: 31 }, code: 'N' }, { date: { y: 2026, m: 11, d: 1 }, code: 'RF' }];
  const { events } = C.buildEvents(entries, C.DEFAULT_CODES);
  const ics = C.buildICS(events, { name: 'X' });
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261031\r\nDTEND;VALUE=DATE:20261101'));
  assert.ok(ics.includes('SUMMARY:🔵 Nuit') && ics.includes('SUMMARY:⚪ RF'));
  assert.ok(!ics.includes('TZID=Europe/Paris:2026'));
});

test('couleurs : pastille dans le titre et propriété COLOR', () => {
  const entries = ['M', 'S', 'N', 'R', 'CA', 'X'].map((code, i) => ({ date: { y: 2026, m: 10, d: i + 1 }, code }));
  const { events } = C.buildEvents(entries, C.DEFAULT_CODES);
  const ics = C.buildICS(events, { name: 'X' });
  for (const t of ['🟤 Matin', '🟡 Soir', '🔵 Nuit', '⚪ Repos', '🟢 Congé']) assert.ok(ics.includes('SUMMARY:' + t), t);
  assert.ok(ics.includes('SUMMARY:Absence\r\nEND:VEVENT'));
  assert.ok(ics.includes('COLOR:saddlebrown'));
});

test('changements depuis le dernier export', () => {
  const day = (d, code, m = 11) => ({ date: { y: 2026, m, d }, code });
  const prev = C.snapshotOf([day(1, 'M'), day(2, 'S'), day(3, 'N'), day(4, 'R')]);
  // le 2 change, le 3 est vidé, le 5 (hors période précédente) n'est pas un changement
  const res = C.diffSnapshot(prev, [day(1, 'M'), day(2, 'R'), day(4, 'R'), day(5, 'M')]);
  assert.strictEqual(res.overlap, true);
  assert.deepStrictEqual(res.changes, [
    { key: '20261102', before: 'S', after: 'R' },
    { key: '20261103', before: 'N', after: '' },
  ]);
  // planning du mois suivant uniquement : aucune période commune
  assert.deepStrictEqual(C.diffSnapshot(prev, [day(1, 'M', 12)]), { changes: [], overlap: false });
  assert.deepStrictEqual(C.diffSnapshot({}, [day(1, 'M')]), { changes: [], overlap: false });
});

test('instantané : le nouveau planning remplace sa période, les vieux jours sont oubliés', () => {
  const day = (d, code, m = 11) => ({ date: { y: 2026, m, d }, code });
  const prev = C.snapshotOf([day(30, 'M', 9), day(1, 'M'), day(2, 'S'), day(3, 'N')]);
  const merged = C.mergeSnapshot(prev, [day(2, 'R'), day(4, 'S')], '20261001');
  assert.deepStrictEqual(merged, { '20261101': 'M', '20261102': 'R', '20261104': 'S' });
});

test('aller-retour par un vrai fichier .xls', { skip: !fs.existsSync(path.join(__dirname, 'xlsx.full.min.js')) }, () => {
  const XLSX = require('./xlsx.full.min.js');
  const aoa = [['Agent'], ['DUPONT', 'M', 'S', 'N', 'Tn', 'R', 'CA']];
  for (let d = 1; d <= 6; d++) aoa[0].push(new Date(2026, 9, d, 12));
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: false });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Planning');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' });
  const back = XLSX.read(buf, { type: 'buffer', cellNF: true });
  const matrix = C.sheetToMatrix(XLSX, back.Sheets[back.SheetNames[0]]);
  const res = C.parseMatrix(matrix, OPTS);
  assert.strictEqual(res.agents[0].name, 'DUPONT');
  assert.deepStrictEqual(res.agents[0].entries[2], { date: { y: 2026, m: 10, d: 3 }, code: 'N' });
});

test('JS (journée de solidarité) : journée entière, même avec les horaires', () => {
  const entries = [{ date: { y: 2026, m: 11, d: 2 }, code: 'JS' }, { date: { y: 2026, m: 11, d: 3 }, code: 'J' }];
  const { events, unknown } = C.buildEvents(entries, C.DEFAULT_CODES, { withHours: true });
  assert.deepStrictEqual(unknown, {});
  assert.strictEqual(events[0].code, 'JS');
  assert.strictEqual(events[0].def.label, 'JS');
  assert.strictEqual(events[0].timed, false);
  assert.strictEqual(events[1].timed, true);
});

test('mergePlan : un nouveau tableau remplace sa période, garde le reste, oublie le passé', () => {
  const d = (m, day) => ({ y: 2026, m, d: day });
  const oct = [{ name: 'DUPONT', entries: [{ date: d(10, 30), code: 'M' }, { date: d(10, 31), code: 'S' }] },
    { name: 'MARTIN', entries: [{ date: d(10, 30), code: 'N' }, { date: d(10, 31), code: 'N' }] }];
  let plan = C.mergePlan(null, oct);
  assert.deepStrictEqual(plan.agents.DUPONT, { 20261030: 'M', 20261031: 'S' });
  // nouveau tableau du 31/10 au 01/11 : MARTIN n'y figure plus → sa case du 31 disparaît
  const nov = [{ name: 'DUPONT', entries: [{ date: d(10, 31), code: 'R' }, { date: d(11, 1), code: 'M' }] }];
  plan = C.mergePlan(plan, nov);
  assert.deepStrictEqual(plan.agents.DUPONT, { 20261030: 'M', 20261031: 'R', 20261101: 'M' });
  assert.deepStrictEqual(plan.agents.MARTIN, { 20261030: 'N' });
  // les jours avant minKey sont oubliés, un agent sans jour disparaît
  plan = C.mergePlan(plan, [], '20261031');
  assert.deepStrictEqual(plan.agents, { DUPONT: { 20261031: 'R', 20261101: 'M' } });
});

test('monthGrid : semaines du lundi au dimanche', () => {
  const weeks = C.monthGrid(2026, 11); // 1er novembre 2026 = dimanche
  assert.strictEqual(weeks[0].length, 7);
  assert.deepStrictEqual(weeks[0].slice(0, 6), [null, null, null, null, null, null]);
  assert.deepStrictEqual(weeks[0][6], { y: 2026, m: 11, d: 1 });
  assert.deepStrictEqual(weeks[weeks.length - 1].filter(Boolean).pop(), { y: 2026, m: 11, d: 30 });
  assert.strictEqual(C.monthGrid(2026, 2).flat().filter(Boolean).length, 28);
});

test('sameShift : collègues du même service, sans soi-même', () => {
  const plan = { agents: { DUPONT: { 20261101: 'M' }, MARTIN: { 20261101: 'M' }, ABEL: { 20261101: 'M' }, ZOE: { 20261101: 'S' } } };
  assert.deepStrictEqual(C.sameShift(plan, '20261101', 'M', 'DUPONT'), ['ABEL', 'MARTIN']);
  assert.deepStrictEqual(C.sameShift(plan, '20261102', 'M', 'DUPONT'), []);
});

test('RECU : libellé « Recup », blanc comme les repos', () => {
  const def = C.DEFAULT_CODES.find(c => c.code === 'RECU');
  assert.strictEqual(def.label, 'Recup');
  assert.strictEqual(def.abbr, 'Recup');
  assert.strictEqual(def.color, C.DEFAULT_CODES.find(c => c.code === 'R').color);
  const { events, unknown } = C.buildEvents([{ date: { y: 2026, m: 11, d: 2 }, code: 'RECU' }], C.DEFAULT_CODES);
  assert.deepStrictEqual(unknown, {});
  assert.strictEqual(C.eventTitle(events[0].def), '⚪ Recup');
});
