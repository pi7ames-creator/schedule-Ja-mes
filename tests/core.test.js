// Tests for js/core.js — run with: node --test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

// ---------- fixtures ----------
function baseState() {
  return C.normalizeState({
    version: 3,
    settings: { defaultRate: 300 },
    students: [
      { id: 'a', name: 'อุ๋งอิ๋ง', aliases: ['Auning'], rate: null },
      { id: 'g1', name: 'กัส', aliases: [] },
      { id: 'g2', name: 'อิงอิง', aliases: [] },
      { id: 'g3', name: 'พาวเวอร์', aliases: [], rate: 250 },
      { id: 'n', name: 'เนเน่', aliases: ['Nene', 'Nene M.6'], rate: 400 },
    ],
    groups: [
      { id: 'smte', name: 'SMTE', aliases: ['SMTE'], subject: 'คณิต SMTE', rate: null, memberIds: ['g1', 'g2', 'g3'] },
      { id: 'pai', name: 'PAI', aliases: ['PAI'], subject: '', rate: 500, memberIds: [] },
    ],
    months: {},
  });
}

// ---------- time / date helpers ----------
test('parseTimeRange accepts en dash, hyphen and spaces', () => {
  assert.deepEqual(C.parseTimeRange('16:30–18:00'), { start: '16:30', end: '18:00' });
  assert.deepEqual(C.parseTimeRange(' 9:00 - 10:30 '), { start: '09:00', end: '10:30' });
  assert.equal(C.parseTimeRange('abc'), null);
});

test('datesInMonth returns every date of a weekday (0=Sun)', () => {
  assert.deepEqual(C.datesInMonth('2026-11', 1), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']);
  assert.deepEqual(C.datesInMonth('2026-11', 0), ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29']);
  assert.equal(C.datesInMonth('2026-02', 3).length, 4);
});

test('shiftYM moves across year boundaries', () => {
  assert.equal(C.shiftYM('2026-12', 1), '2027-01');
  assert.equal(C.shiftYM('2026-01', -1), '2025-12');
});

// ---------- rates & participants ----------
test('participants of a group slot are the live group members', () => {
  const S = baseState();
  const slot = C.addSlot(S, '2026-11', { dow: 2, start: '18:15', end: '19:45', groupId: 'smte' });
  assert.deepEqual(C.participantsOf(S, slot), ['g1', 'g2', 'g3']);
  S.groups[0].memberIds.push('a');
  assert.deepEqual(C.participantsOf(S, slot), ['g1', 'g2', 'g3', 'a']);
});

test('rate priority: slot.price > group.rate > student.rate > default', () => {
  const S = baseState();
  const smte = C.addSlot(S, '2026-11', { dow: 2, start: '18:15', end: '19:45', groupId: 'smte' });
  assert.equal(C.rateFor(S, smte, 'g1'), 300); // default
  assert.equal(C.rateFor(S, smte, 'g3'), 250); // student rate
  const pai = C.addSlot(S, '2026-11', { dow: 4, start: '16:30', end: '18:00', groupId: 'pai' });
  assert.equal(C.rateFor(S, pai, 'g3'), 500); // group rate beats student rate
  smte.price = 350;
  assert.equal(C.rateFor(S, smte, 'g3'), 350); // slot override beats all
});

// ---------- months are independent ----------
test('editing one month does not touch another month', () => {
  const S = baseState();
  C.addSlot(S, '2026-10', { dow: 1, start: '20:00', end: '21:30', studentIds: ['a'] });
  C.addSlot(S, '2026-11', { dow: 2, start: '20:00', end: '21:30', studentIds: ['n'] });
  assert.equal(C.getMonth(S, '2026-10').slots.length, 1);
  assert.equal(C.getMonth(S, '2026-11').slots.length, 1);
  assert.equal(C.getMonth(S, '2026-10').slots[0].dow, 1);
});

test('copyMonth clones slots with new ids and clears skip dates', () => {
  const S = baseState();
  const s = C.addSlot(S, '2026-10', { dow: 1, start: '20:00', end: '21:30', studentIds: ['a'], skip: ['2026-10-05'] });
  C.getMonth(S, '2026-10').closedDays = ['fri'];
  C.copyMonth(S, '2026-10', '2026-11');
  const nov = C.getMonth(S, '2026-11');
  assert.equal(nov.slots.length, 1);
  assert.notEqual(nov.slots[0].id, s.id);
  assert.deepEqual(nov.slots[0].skip, []);
  assert.deepEqual(nov.closedDays, ['fri']);
  nov.slots[0].studentIds.push('n');
  assert.deepEqual(s.studentIds, ['a']); // deep copy
});

test('slotsByDay sorts by start time', () => {
  const S = baseState();
  C.addSlot(S, '2026-11', { dow: 6, start: '14:30', end: '16:00' });
  C.addSlot(S, '2026-11', { dow: 6, start: '09:30', end: '11:00' });
  assert.deepEqual(C.slotsByDay(S, '2026-11', 6).map(s => s.start), ['09:30', '14:30']);
});

// ---------- sessions & billing ----------
test('sessions respect skip dates, blocked days, closed days and absences', () => {
  const S = baseState();
  const slot = C.addSlot(S, '2026-11', { dow: 2, start: '18:15', end: '19:45', groupId: 'smte', skip: ['2026-11-03'] });
  S.blocked.push({ date: '2026-11-10' });
  S.absences.push({ studentId: 'g1', date: '2026-11-17' });
  const ses = C.sessionsOfSlot(S, '2026-11', slot);
  assert.deepEqual(ses.map(x => [x.date, x.held]), [
    ['2026-11-03', false], ['2026-11-10', false], ['2026-11-17', true], ['2026-11-24', true],
  ]);
  const d17 = ses.find(x => x.date === '2026-11-17');
  assert.deepEqual(d17.present, ['g2', 'g3']);
  assert.deepEqual(d17.absent, ['g1']);

  C.getMonth(S, '2026-11').closedDays = ['tue'];
  assert.ok(C.sessionsOfSlot(S, '2026-11', slot).every(x => !x.held));
});

test('group class is billed per individual at each person\'s rate', () => {
  const S = baseState();
  C.addSlot(S, '2026-11', { dow: 2, start: '18:15', end: '19:45', groupId: 'smte' }); // 4 Tuesdays
  C.addSlot(S, '2026-11', { dow: 1, start: '20:00', end: '21:30', studentIds: ['a'], skip: ['2026-11-30'] }); // 4 Mondays
  S.absences.push({ studentId: 'g1', date: '2026-11-17' });
  const bill = C.billMonth(S, '2026-11');
  const by = Object.fromEntries(bill.students.map(b => [b.studentId, b]));
  assert.equal(by.g1.total, 3 * 300);
  assert.equal(by.g2.total, 4 * 300);
  assert.equal(by.g3.total, 4 * 250);
  assert.equal(by.a.total, 4 * 300);
  assert.equal(by.g1.lines[0].groupName, 'SMTE');
  assert.deepEqual(by.g1.lines[0].days, [10, 24, 3].sort((x, y) => x - y));
  assert.equal(bill.grandTotal, 900 + 1200 + 1000 + 1200);
  assert.equal(by.n, undefined); // no classes -> not billed
});

test('group with no members is reported, not silently billed', () => {
  const S = baseState();
  C.addSlot(S, '2026-11', { dow: 4, start: '16:30', end: '18:00', groupId: 'pai' });
  const bill = C.billMonth(S, '2026-11');
  assert.equal(bill.students.length, 0);
  assert.deepEqual(bill.emptyGroups.map(g => g.id), ['pai']);
});

test('weekStats counts booked slots, weekday target and weekly revenue (flex excluded)', () => {
  const S = baseState();
  for (const st of ['16:30', '18:15', '20:00']) C.addSlot(S, '2026-11', { dow: 1, start: st, end: '22:00', studentIds: ['a'] });
  C.addSlot(S, '2026-11', { dow: 2, start: '18:15', end: '19:45', groupId: 'smte' });
  C.addSlot(S, '2026-11', { dow: 2, start: '21:30', end: '22:30', studentIds: ['n'], flex: true });
  C.addSlot(S, '2026-11', { dow: 3, start: '21:30', end: '22:30' }); // empty
  const w = C.weekStats(S, '2026-11');
  assert.equal(w.booked, 5);
  assert.equal(w.weekdayTargetMet, 1);
  assert.equal(w.revenue, 3 * 300 + (300 + 300 + 250));
});

// ---------- per-student monthly card ----------
test('studentMonthSchedule lists class/absent dates, marks teacher leave (blocked day), hides skipped dates', () => {
  const S = baseState();
  C.addSlot(S, '2026-11', { dow: 4, start: '18:15', end: '19:45', groupId: 'smte', skip: ['2026-11-05'] });
  C.addSlot(S, '2026-11', { dow: 2, start: '18:15', end: '19:45', groupId: 'smte' });
  C.addSlot(S, '2026-11', { dow: 1, start: '20:00', end: '21:30', studentIds: ['a'] }); // not g1's
  S.blocked.push({ date: '2026-11-10' });
  S.absences.push({ studentId: 'g1', date: '2026-11-17' });
  const card = C.studentMonthSchedule(S, '2026-11', 'g1');
  // ordered Mon..Sun, so Tue before Thu
  assert.deepEqual(card.items.map(i => i.dow), [2, 4]);
  assert.equal(card.items[0].groupName, 'SMTE');
  assert.equal(card.items[0].subject, 'คณิต SMTE');
  assert.deepEqual(card.items[0].dates, [
    { date: '2026-11-03', status: 'class' },
    { date: '2026-11-10', status: 'teacher-off' },
    { date: '2026-11-17', status: 'absent' },
    { date: '2026-11-24', status: 'class' },
  ]);
  assert.deepEqual(card.items[1].dates.map(d => d.date), ['2026-11-12', '2026-11-19', '2026-11-26']);
  assert.deepEqual(card.byDate['2026-11-17'], [{ item: 0, status: 'absent' }]);
  assert.equal(card.classCount, 5); // held sessions only: 3,24 + 12,19,26
  assert.equal(card.total, C.billMonth(S, '2026-11').students.find(b => b.studentId === 'g1').total);
  assert.equal(card.items[0].rate, 300);
  assert.deepEqual(card.teacherOff, ['2026-11-10']);
  assert.deepEqual(card.byDate['2026-11-10'], [{ item: 0, status: 'teacher-off' }]);
});

test('teacher leave for one class only (slot.off) is not billed and is shown only to that class', () => {
  const S = baseState();
  const tue = C.addSlot(S, '2026-11', { dow: 2, start: '18:15', end: '19:45', groupId: 'smte', off: ['2026-11-17'] });
  C.addSlot(S, '2026-11', { dow: 2, start: '20:00', end: '21:30', studentIds: ['a'] });
  const ses = C.sessionsOfSlot(S, '2026-11', tue).find(x => x.date === '2026-11-17');
  assert.equal(ses.cancelled, true);
  assert.equal(ses.teacherOff, true);
  // group member sees the leave, the other student (same day, other class) does not
  const g1 = C.studentMonthSchedule(S, '2026-11', 'g1');
  assert.deepEqual(g1.teacherOff, ['2026-11-17']);
  assert.equal(g1.classCount, 3);
  const a = C.studentMonthSchedule(S, '2026-11', 'a');
  assert.deepEqual(a.teacherOff, []);
  assert.equal(a.classCount, 4);
  // billing lines expose the leave days for the parent message
  const line = C.billMonth(S, '2026-11').students.find(b => b.studentId === 'g1').lines[0];
  assert.deepEqual(line.days, [3, 10, 24]);
  assert.deepEqual(line.offDays, [17]);
});

test('skip (not scheduled) is never shown as teacher leave; closed weekday neither', () => {
  const S = baseState();
  C.addSlot(S, '2026-11', { dow: 1, start: '20:00', end: '21:30', studentIds: ['a'], skip: ['2026-11-30'] });
  const card = C.studentMonthSchedule(S, '2026-11', 'a');
  assert.deepEqual(card.teacherOff, []);
  assert.equal(card.items[0].dates.length, 4);
  C.getMonth(S, '2026-11').closedDays = ['mon'];
  assert.deepEqual(C.studentMonthSchedule(S, '2026-11', 'a').items, []);
});

test('copyMonth clears per-slot teacher leave dates', () => {
  const S = baseState();
  C.addSlot(S, '2026-10', { dow: 1, start: '20:00', end: '21:30', studentIds: ['a'], off: ['2026-10-05'] });
  C.copyMonth(S, '2026-10', '2026-11');
  assert.deepEqual(C.getMonth(S, '2026-11').slots[0].off, []);
});

test('studentMonthSchedule returns empty items for a student with no classes', () => {
  const S = baseState();
  const card = C.studentMonthSchedule(S, '2026-11', 'n');
  assert.deepEqual(card.items, []);
  assert.equal(card.classCount, 0);
  assert.equal(card.total, 0);
});

// ---------- calendar import ----------
test('cleanTitle strips emoji and extra whitespace', () => {
  assert.equal(C.cleanTitle('🧬🧑‍🔬 SMTE'), 'SMTE');
  assert.equal(C.cleanTitle('⚽️🏂 Jai M.3 '), 'Jai M.3');
  assert.equal(C.cleanTitle('🐰 m.1 KKW'), 'm.1 KKW');
});

test('matchTitle finds students/groups by alias (case-insensitive, prefix word)', () => {
  const S = baseState();
  assert.deepEqual(C.matchTitle(S, '🇯🇵 Nene M.6'), { type: 'student', id: 'n' });
  assert.deepEqual(C.matchTitle(S, 'nene'), { type: 'student', id: 'n' });
  assert.deepEqual(C.matchTitle(S, '🧬 SMTE extra'), { type: 'group', id: 'smte' });
  assert.deepEqual(C.matchTitle(S, 'อุ๋งอิ๋ง'), { type: 'student', id: 'a' }); // by name
  assert.equal(C.matchTitle(S, 'Unknown kid'), null);
});

test('importCalendarMonth builds weekly slots with skip dates, dedupes and creates unknown groups', () => {
  const S = baseState();
  const ev = (date, s, e, title) => ({ summary: title, start: `${date}T${s}:00+07:00`, end: `${date}T${e}:00+07:00` });
  const events = [
    // Auning every Monday except 30th
    ev('2026-11-02', '20:00', '21:30', '🧪 Auning'), ev('2026-11-09', '20:00', '21:30', '🧪 Auning'),
    ev('2026-11-16', '20:00', '21:30', '🧪 Auning'), ev('2026-11-23', '20:00', '21:30', '🧪 Auning'),
    // duplicate event
    ev('2026-11-02', '20:00', '21:30', '🧪 Auning'),
    // unknown title on Saturdays 7 & 14 only
    ev('2026-11-07', '09:30', '11:00', '😼 Gang Diamond'), ev('2026-11-14', '09:30', '11:00', '😼 Gang Diamond'),
    // group
    ev('2026-11-03', '18:15', '19:45', '🧬 SMTE'),
  ];
  const report = C.importCalendarMonth(S, '2026-11', events, { replace: true });
  const m = C.getMonth(S, '2026-11');
  assert.equal(m.slots.length, 3);
  const auning = m.slots.find(s => s.studentIds.includes('a'));
  assert.equal(auning.dow, 1);
  assert.deepEqual(auning.skip, ['2026-11-30']);
  const gang = m.slots.find(s => s.dow === 6);
  const gGroup = S.groups.find(g => g.id === gang.groupId);
  assert.equal(gGroup.name, 'Gang Diamond');
  assert.deepEqual(gang.skip, ['2026-11-21', '2026-11-28']);
  assert.deepEqual(report.createdGroups, ['Gang Diamond']);
  assert.equal(report.duplicates, 1);
  const smte = m.slots.find(s => s.groupId === 'smte');
  assert.deepEqual(smte.skip, ['2026-11-10', '2026-11-17', '2026-11-24']);
});

test('importCalendarMonth ignores events outside the month and all-day events', () => {
  const S = baseState();
  C.importCalendarMonth(S, '2026-11', [
    { summary: 'Auning', start: '2026-10-26T20:00:00+07:00', end: '2026-10-26T21:30:00+07:00' },
    { summary: 'Auning', start: '2026-11-05', end: '2026-11-06' },
  ], { replace: true });
  assert.equal(C.getMonth(S, '2026-11').slots.length, 0);
});

// ---------- migration from the old (v2) format ----------
function v2Fixture() {
  return {
    settings: { defaultRate: 300 },
    students: [
      { id: 's1', name: 'จ๋าจ้า', parentTitle: 'คุณแม่' },
      { id: 's2', name: 'กัส', parentTitle: 'คุณแม่' },
      { id: 's3', name: 'อิงอิง', parentTitle: 'คุณพ่อ' },
    ],
    weeklySlots: {
      weekday: [{ t: '16:30–18:00' }, { t: '18:15–19:45' }, { t: '21:30–22:30', flex: true, d: 'คาบสำรอง' }],
      weekend: [{ t: '09:00–10:30' }],
    },
    bookings: {
      'weekday-mon-0': { status: 'booked', subject: 'ฟิสิกส์ ม.5', names: ['จ๋าจ้า'], headcount: 1, customPrice: null },
      'weekday-tue-1': { status: 'booked', subject: 'คณิต SMTE', names: ['กัส', 'อิงอิง'], headcount: 2, customPrice: 350 },
      'weekday-thu-1': { status: 'booked', subject: 'คณิต SMTE', names: ['อิงอิง', 'กัส'], headcount: 2, customPrice: null },
      'weekend-sat-0': { status: 'booked', subject: 'ใหม่', names: ['คนใหม่'], headcount: 1, customPrice: null },
    },
    timeOverrides: { 'weekday-mon-0': '16:00–17:30' },
    closedDays: ['fri'],
    schedules: [
      { id: 'x1', studentId: 's1', yearMonth: '2026-08', day: 1, time: '16:30–18:00', price: 300 },
      { id: 'x2', studentId: 's2', yearMonth: '2026-08', day: 2, time: '18:15–19:45', price: 300 },
      { id: 'x3', studentId: 's3', yearMonth: '2026-08', day: 2, time: '18:15–19:45', price: 300 },
    ],
    blocked: [{ date: '2026-08-12' }],
    absences: [{ id: 1, studentId: 's1', date: '2026-08-03' }],
  };
}

test('migrateV2 turns the global weekly template into the given month', () => {
  const S = C.migrateV2(v2Fixture(), { templateMonths: ['2026-10'] });
  assert.equal(S.version, 3);
  const oct = C.getMonth(S, '2026-10');
  assert.deepEqual(oct.closedDays, ['fri']);
  const mon = C.slotsByDay(S, '2026-10', 1);
  assert.equal(mon[0].start, '16:00'); // time override applied
  assert.deepEqual(mon[0].studentIds, ['s1']);
  assert.equal(mon[0].subject, 'ฟิสิกส์ ม.5');
  // empty template slots survive as open slots (closed days keep their slots for when they reopen)
  assert.equal(mon.length, 3);
  assert.equal(C.slotsByDay(S, '2026-10', 5).length, 3);
  // unknown name becomes a new student
  assert.ok(S.students.find(s => s.name === 'คนใหม่'));
  // multi-person bookings with the same members become one group
  assert.equal(S.groups.length, 1);
  const tue = C.slotsByDay(S, '2026-10', 2).find(s => s.start === '18:15');
  const thu = C.slotsByDay(S, '2026-10', 4).find(s => s.start === '18:15');
  assert.equal(tue.groupId, S.groups[0].id);
  assert.equal(thu.groupId, S.groups[0].id);
  assert.equal(tue.price, 350);
  assert.equal(S.groups[0].name, 'คณิต SMTE');
});

test('migrateV2 converts per-student schedules and merges same-time students', () => {
  const S = C.migrateV2(v2Fixture(), { templateMonths: [] });
  const aug = C.getMonth(S, '2026-08');
  assert.equal(aug.slots.length, 2);
  const tue = aug.slots.find(s => s.dow === 2);
  assert.deepEqual(tue.studentIds.sort(), ['s2', 's3']);
  assert.deepEqual(S.blocked, [{ date: '2026-08-12' }]);
  assert.deepEqual(S.absences, [{ studentId: 's1', date: '2026-08-03' }]);
  const bill = C.billMonth(S, '2026-08');
  const s1 = bill.students.find(b => b.studentId === 's1');
  assert.equal(s1.count, 5 - 1); // Mondays in Aug 2026: 3,10,17,24,31 = 5, minus absence on 3rd
});

test('normalizeState accepts v2 data and fills defaults for v3', () => {
  const S = C.normalizeState(v2Fixture(), { templateMonths: ['2026-10'] });
  assert.equal(S.version, 3);
  assert.ok(S.meta && typeof S.meta.rev === 'number');
  const empty = C.normalizeState({});
  assert.deepEqual(empty.students, []);
  assert.equal(empty.settings.defaultRate, 300);
});
