// @ts-check
/**
 * Tutor schedule — pure business logic (no DOM).
 * Loaded by index.html as a classic script (window.TutorCore) and by Node tests (module.exports).
 *
 * Data model (version 3) — see CLAUDE.md for the full schema:
 *   students[]  {id, name, aliases[], parentTitle, subject, rate|null}
 *   groups[]    {id, name, aliases[], subject, rate|null, memberIds[]}
 *   months{YYYY-MM: {closedDays[], slots[]}}
 *     slot      {id, dow(0=Sun), start, end, subject, groupId|null, studentIds[], price|null, note, flex,
 *                skip[YYYY-MM-DD]  not scheduled that date (silent),
 *                off[YYYY-MM-DD]}  teacher on leave for this class that date (shown to its students)
 *   blocked[]   {date}            teacher on leave the whole day (all classes off, shown to students)
 *   absences[]  {studentId, date} one person absent from that day's classes
 *
 * Rate per person per session:
 *   group class (groupId, or 2+ students): slot.price > group.rate > settings.groupRate (300)
 *   private class (1 student):            slot.price > student.rate > settings.privateRate (350)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TutorCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DOW_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];

  // ---------- small helpers ----------
  const pad = (n) => String(n).padStart(2, '0');
  const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const isNum = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /** "9:00 - 10:30" / "16:30–18:00" -> {start:"09:00", end:"10:30"} */
  function parseTimeRange(str) {
    const m = String(str || '').match(/(\d{1,2})[:.](\d{2})\s*[–—\-~ถึง]+\s*(\d{1,2})[:.](\d{2})/);
    if (!m) return null;
    return { start: `${pad(m[1])}:${m[2]}`, end: `${pad(m[3])}:${m[4]}` };
  }
  const timeLabel = (slot) => `${slot.start}–${slot.end}`;

  function ymParts(ym) {
    const [y, m] = ym.split('-').map(Number);
    return { y, m };
  }
  function shiftYM(ym, delta) {
    const { y, m } = ymParts(ym);
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  }
  function daysInMonth(ym) {
    const { y, m } = ymParts(ym);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function dowOf(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  }
  /** All YYYY-MM-DD dates in month ym falling on weekday dow (0=Sun). */
  function datesInMonth(ym, dow) {
    const out = [];
    const n = daysInMonth(ym);
    for (let d = 1; d <= n; d++) {
      const ds = `${ym}-${pad(d)}`;
      if (dowOf(ds) === dow) out.push(ds);
    }
    return out;
  }

  // ---------- state ----------
  function emptyState() {
    return {
      version: 3,
      meta: { rev: 0, updatedAt: null },
      settings: { groupRate: 300, privateRate: 350 },
      students: [],
      groups: [],
      months: {},
      blocked: [],
      absences: [],
    };
  }

  function normSlot(s) {
    return {
      id: s.id || uid('sl'),
      dow: Number(s.dow) || 0,
      start: s.start || '00:00',
      end: s.end || '00:00',
      subject: s.subject || '',
      groupId: s.groupId || null,
      studentIds: Array.isArray(s.studentIds) ? [...s.studentIds] : [],
      price: isNum(s.price) ? Number(s.price) : null,
      note: s.note || '',
      flex: !!s.flex,
      skip: Array.isArray(s.skip) ? [...s.skip].sort() : [],
      off: Array.isArray(s.off) ? [...s.off].sort() : [],
    };
  }

  /** Accepts v2 (old single-template format), v3 or partial objects; returns a complete v3 state. */
  function normalizeState(raw, opts) {
    raw = raw || {};
    if (raw.version !== 3 && (raw.weeklySlots || raw.bookings || raw.schedules)) {
      return migrateV2(raw, opts);
    }
    const S = Object.assign(emptyState(), clone(raw));
    S.version = 3;
    S.meta = Object.assign({ rev: 0, updatedAt: null }, S.meta || {});
    const legacy = S.settings || {};
    S.settings = Object.assign({}, legacy, {
      groupRate: isNum(legacy.groupRate) ? Number(legacy.groupRate) : 300,
      // older files had one defaultRate for everything: keep it for private classes
      privateRate: isNum(legacy.privateRate) ? Number(legacy.privateRate) : isNum(legacy.defaultRate) ? Number(legacy.defaultRate) : 350,
    });
    delete S.settings.defaultRate;
    S.students = (S.students || []).map((s) => ({
      id: s.id || uid('st'), name: s.name || '', aliases: s.aliases || [],
      parentTitle: s.parentTitle || 'คุณแม่', subject: s.subject || '',
      rate: isNum(s.rate) ? Number(s.rate) : null,
    }));
    S.groups = (S.groups || []).map((g) => ({
      id: g.id || uid('gr'), name: g.name || '', aliases: g.aliases || [], subject: g.subject || '',
      rate: isNum(g.rate) ? Number(g.rate) : null, memberIds: g.memberIds || [],
    }));
    const months = {};
    for (const [ym, m] of Object.entries(S.months || {})) {
      months[ym] = { closedDays: (m && m.closedDays) || [], slots: ((m && m.slots) || []).map(normSlot) };
    }
    S.months = months;
    S.blocked = (S.blocked || []).map((b) => ({ date: b.date }));
    S.absences = (S.absences || []).map((a) => ({ studentId: a.studentId, date: a.date }));
    return S;
  }

  function getMonth(S, ym) {
    if (!S.months[ym]) S.months[ym] = { closedDays: [], slots: [] };
    return S.months[ym];
  }
  function hasMonth(S, ym) {
    return !!(S.months[ym] && (S.months[ym].slots.length || S.months[ym].closedDays.length));
  }
  function addSlot(S, ym, data) {
    const slot = normSlot(data || {});
    getMonth(S, ym).slots.push(slot);
    return slot;
  }
  function findSlot(S, ym, id) {
    return getMonth(S, ym).slots.find((s) => s.id === id) || null;
  }
  function removeSlot(S, ym, id) {
    const m = getMonth(S, ym);
    m.slots = m.slots.filter((s) => s.id !== id);
  }
  function slotsByDay(S, ym, dow) {
    return getMonth(S, ym).slots.filter((s) => s.dow === dow).sort((a, b) => a.start.localeCompare(b.start));
  }
  function isDayClosed(S, ym, dow) {
    return getMonth(S, ym).closedDays.includes(DOW_KEYS[dow]);
  }
  /** Copy the weekly plan of fromYm into toYm (replacing it). Skip dates are month-specific, so they are cleared. */
  function copyMonth(S, fromYm, toYm) {
    const src = getMonth(S, fromYm);
    S.months[toYm] = {
      closedDays: [...src.closedDays],
      slots: src.slots.map((s) => normSlot(Object.assign(clone(s), { id: undefined, skip: [], off: [] }))),
    };
    return S.months[toYm];
  }

  const studentById = (S, id) => S.students.find((s) => s.id === id) || null;
  const groupById = (S, id) => S.groups.find((g) => g.id === id) || null;

  /** Student ids taking part in a slot. Group slots follow the group's *current* members. */
  function participantsOf(S, slot) {
    if (slot.groupId) {
      const g = groupById(S, slot.groupId);
      const ids = g ? [...g.memberIds] : [];
      for (const id of slot.studentIds || []) if (!ids.includes(id)) ids.push(id);
      return ids;
    }
    return [...(slot.studentIds || [])];
  }
  function isBooked(S, slot) {
    return !!slot.groupId || participantsOf(S, slot).length > 0;
  }
  function slotTitle(S, slot) {
    const g = slot.groupId ? groupById(S, slot.groupId) : null;
    if (g) return g.name;
    return participantsOf(S, slot).map((id) => (studentById(S, id) || { name: '?' }).name).join(', ');
  }
  function slotSubject(S, slot) {
    if (slot.subject) return slot.subject;
    const g = slot.groupId ? groupById(S, slot.groupId) : null;
    if (g && g.subject) return g.subject;
    const ids = participantsOf(S, slot);
    if (ids.length === 1) return (studentById(S, ids[0]) || {}).subject || '';
    return '';
  }

  /** Group class = has a group, or more than one student booked together. */
  function isGroupClass(S, slot) {
    return !!slot.groupId || (slot.studentIds || []).length > 1;
  }
  function rateFor(S, slot, studentId) {
    if (isNum(slot.price)) return Number(slot.price);
    if (isGroupClass(S, slot)) {
      const g = slot.groupId ? groupById(S, slot.groupId) : null;
      if (g && isNum(g.rate)) return Number(g.rate);
      return Number(S.settings.groupRate) || 0;
    }
    const st = studentById(S, studentId);
    if (st && isNum(st.rate)) return Number(st.rate);
    return Number(S.settings.privateRate) || 0;
  }

  const isBlocked = (S, ds) => S.blocked.some((b) => b.date === ds);
  const isAbsent = (S, sid, ds) => S.absences.some((a) => a.studentId === sid && a.date === ds);

  /** Every date of the month this slot would run, with whether it was held and who was present. */
  function sessionsOfSlot(S, ym, slot) {
    const closed = isDayClosed(S, ym, slot.dow);
    const people = participantsOf(S, slot);
    return datesInMonth(ym, slot.dow).map((date) => {
      // teacherOff: the class was planned but the teacher is on leave -> students should be told
      const teacherOff = !closed && !slot.skip.includes(date) && (isBlocked(S, date) || slot.off.includes(date));
      const cancelled = closed || teacherOff || slot.skip.includes(date);
      const present = cancelled ? [] : people.filter((id) => !isAbsent(S, id, date));
      const absent = cancelled ? [] : people.filter((id) => isAbsent(S, id, date));
      return { date, cancelled, teacherOff, held: !cancelled && (present.length > 0 || people.length === 0), present, absent };
    });
  }

  /** Per-person bill for month ym. Group classes are split so each member pays their own rate. */
  function billMonth(S, ym) {
    const per = new Map();
    const emptyGroups = [];
    for (const slot of getMonth(S, ym).slots) {
      const g = slot.groupId ? groupById(S, slot.groupId) : null;
      if (g && participantsOf(S, slot).length === 0) {
        if (!emptyGroups.find((x) => x.id === g.id)) emptyGroups.push({ id: g.id, name: g.name });
        continue;
      }
      const sessions = sessionsOfSlot(S, ym, slot);
      for (const sid of participantsOf(S, slot)) {
        const dates = sessions.filter((x) => x.present.includes(sid)).map((x) => x.date);
        const offDays = sessions.filter((x) => x.teacherOff).map((x) => Number(x.date.slice(8)));
        if (!dates.length) continue;
        const rate = rateFor(S, slot, sid);
        if (!per.has(sid)) per.set(sid, { studentId: sid, lines: [], total: 0, count: 0 });
        const b = per.get(sid);
        b.lines.push({
          slotId: slot.id, dow: slot.dow, time: timeLabel(slot), subject: slotSubject(S, slot),
          groupName: g ? g.name : '', days: dates.map((d) => Number(d.slice(8))), offDays, rate,
          subtotal: rate * dates.length,
        });
        b.total += rate * dates.length;
        b.count += dates.length;
      }
    }
    const order = S.students.map((s) => s.id);
    const students = [...per.values()].sort((a, b) => order.indexOf(a.studentId) - order.indexOf(b.studentId));
    students.forEach((b) => b.lines.sort((x, y) => ((x.dow + 6) % 7) - ((y.dow + 6) % 7) || x.time.localeCompare(y.time)));
    return { students, emptyGroups, grandTotal: students.reduce((t, b) => t + b.total, 0) };
  }

  /**
   * One student's month for the shareable schedule card.
   * items: their weekly slots (Mon→Sun, then time) with each non-cancelled date marked 'class' or 'absent'.
   * byDate: date -> [{item index, status}] for drawing calendar dots.
   * classCount / total: held sessions and money (same numbers as billMonth).
   */
  function studentMonthSchedule(S, ym, studentId) {
    const items = [];
    for (const slot of getMonth(S, ym).slots) {
      if (!participantsOf(S, slot).includes(studentId)) continue;
      const g = slot.groupId ? groupById(S, slot.groupId) : null;
      const dates = sessionsOfSlot(S, ym, slot)
        .filter((x) => !x.cancelled || x.teacherOff)
        .map((x) => ({ date: x.date, status: x.teacherOff ? 'teacher-off' : x.present.includes(studentId) ? 'class' : 'absent' }));
      if (!dates.length) continue;
      items.push({
        slotId: slot.id, dow: slot.dow, start: slot.start, end: slot.end, time: timeLabel(slot),
        subject: slotSubject(S, slot), groupName: g ? g.name : '', rate: rateFor(S, slot, studentId), dates,
      });
    }
    items.sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7) || a.start.localeCompare(b.start));
    const byDate = {};
    let classCount = 0, total = 0;
    items.forEach((it, idx) => it.dates.forEach((d) => {
      (byDate[d.date] = byDate[d.date] || []).push({ item: idx, status: d.status });
      if (d.status === 'class') { classCount++; total += it.rate; }
    }));
    const teacherOff = Object.keys(byDate).filter((d) => byDate[d].some((m) => m.status === 'teacher-off')).sort();
    return { studentId, ym, items, byDate, classCount, total, teacherOff };
  }

  /** Stats for a "typical week" of the month's plan. */
  function weekStats(S, ym) {
    let booked = 0, revenue = 0, weekdayTargetMet = 0;
    for (let dow = 0; dow < 7; dow++) {
      if (isDayClosed(S, ym, dow)) continue;
      let dayCount = 0;
      for (const slot of slotsByDay(S, ym, dow)) {
        if (!isBooked(S, slot)) continue;
        booked++; dayCount++;
        if (!slot.flex) revenue += participantsOf(S, slot).reduce((t, id) => t + rateFor(S, slot, id), 0);
      }
      if (WEEKDAY_KEYS.includes(DOW_KEYS[dow]) && dayCount >= 3) weekdayTargetMet++;
    }
    return { booked, revenue, weekdayTargetMet };
  }

  // ---------- Google Calendar import ----------
  /** Remove emoji / pictographs / joiners, collapse spaces. */
  function cleanTitle(t) {
    return String(t || '')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  const norm = (t) => cleanTitle(t).toLowerCase();

  /** Find a student or group whose name/alias matches the event title (exact, or as the first word(s)). */
  function matchTitle(S, title) {
    const t = norm(title);
    if (!t) return null;
    const cands = [];
    for (const g of S.groups) for (const a of [g.name, ...g.aliases]) if (a) cands.push({ type: 'group', id: g.id, a: norm(a) });
    for (const s of S.students) for (const a of [s.name, ...s.aliases]) if (a) cands.push({ type: 'student', id: s.id, a: norm(a) });
    const exact = cands.find((c) => c.a === t);
    if (exact) return { type: exact.type, id: exact.id };
    const prefix = cands.filter((c) => t.startsWith(c.a + ' ')).sort((x, y) => y.a.length - x.a.length)[0];
    return prefix ? { type: prefix.type, id: prefix.id } : null;
  }

  /**
   * Turn one month of calendar events into weekly slots for that month.
   * events: [{summary, start:"2026-11-02T20:00:00+07:00", end:"..."}] (Google Calendar dateTime strings).
   * Unknown titles become new empty groups so they still show up; members can be added later.
   * opts.replace (default true) clears the month's slots first.
   */
  function importCalendarMonth(S, ym, events, opts) {
    opts = Object.assign({ replace: true }, opts || {});
    const report = { slots: 0, duplicates: 0, createdGroups: [], matched: {} };
    const seen = new Set();
    const buckets = new Map();
    for (const e of events || []) {
      const st = typeof e.start === 'object' ? e.start.dateTime : e.start;
      const en = typeof e.end === 'object' ? e.end.dateTime : e.end;
      if (!st || st.length < 16 || !en) continue; // all-day events have no time
      const date = st.slice(0, 10);
      if (date.slice(0, 7) !== ym) continue;
      const start = st.slice(11, 16), end = en.slice(11, 16);
      const title = cleanTitle(e.summary);
      const dupKey = `${date}|${start}|${end}|${title.toLowerCase()}`;
      if (seen.has(dupKey)) { report.duplicates++; continue; }
      seen.add(dupKey);
      let hit = matchTitle(S, title);
      if (!hit) {
        const g = { id: uid('gr'), name: title, aliases: [title], subject: '', rate: null, memberIds: [] };
        S.groups.push(g);
        report.createdGroups.push(title);
        hit = { type: 'group', id: g.id };
      }
      report.matched[title] = hit;
      const key = `${dowOf(date)}|${start}|${end}|${hit.type}:${hit.id}`;
      if (!buckets.has(key)) buckets.set(key, { dow: dowOf(date), start, end, hit, dates: new Set() });
      buckets.get(key).dates.add(date);
    }
    const month = getMonth(S, ym);
    if (opts.replace) month.slots = [];
    for (const b of buckets.values()) {
      const skip = datesInMonth(ym, b.dow).filter((d) => !b.dates.has(d));
      addSlot(S, ym, {
        dow: b.dow, start: b.start, end: b.end, skip,
        groupId: b.hit.type === 'group' ? b.hit.id : null,
        studentIds: b.hit.type === 'student' ? [b.hit.id] : [],
      });
      report.slots++;
    }
    return report;
  }

  // ---------- migration from v2 (single global weekly template) ----------
  function migrateV2(old, opts) {
    opts = Object.assign({ templateMonths: [] }, opts || {});
    const S = emptyState();
    const oldRate = Number((old.settings || {}).defaultRate) || 300; // v2 had one price for everything
    S.settings = { groupRate: oldRate, privateRate: oldRate };
    S.students = (old.students || []).map((s) => ({
      id: s.id, name: s.name, aliases: [], parentTitle: s.parentTitle || 'คุณแม่', subject: '', rate: null,
    }));
    const byName = (name) => {
      let st = S.students.find((s) => s.name === name);
      if (!st) {
        st = { id: uid('st'), name, aliases: [], parentTitle: 'คุณแม่', subject: '', rate: null };
        S.students.push(st);
      }
      return st;
    };

    // 1) old global weekly template -> the given months
    const ws = old.weeklySlots || { weekday: [], weekend: [] };
    const bookings = old.bookings || {};
    const overrides = old.timeOverrides || {};
    const sections = { weekday: ['mon', 'tue', 'wed', 'thu', 'fri'], weekend: ['sat', 'sun'] };
    const templateSlots = [];
    for (const [section, days] of Object.entries(sections)) {
      for (const dayKey of days) {
        (ws[section] || []).forEach((tpl, idx) => {
          const key = `${section}-${dayKey}-${idx}`;
          const t = parseTimeRange(overrides[key] || tpl.t) || { start: '00:00', end: '00:00' };
          const b = bookings[key];
          const slot = {
            dow: DOW_KEYS.indexOf(dayKey), start: t.start, end: t.end, flex: !!tpl.flex, note: tpl.d || '',
            subject: '', groupId: null, studentIds: [], price: null,
          };
          if (b && b.status === 'booked') {
            slot.subject = b.subject || '';
            slot.price = isNum(b.customPrice) ? Number(b.customPrice) : null;
            const ids = (b.names || []).map((n) => byName(n).id);
            if (ids.length > 1) {
              const sig = [...ids].sort().join('|');
              let g = S.groups.find((x) => [...x.memberIds].sort().join('|') === sig);
              if (!g) {
                g = { id: uid('gr'), name: b.subject || `กลุ่ม ${S.groups.length + 1}`, aliases: [], subject: b.subject || '', rate: null, memberIds: ids };
                S.groups.push(g);
              }
              slot.groupId = g.id;
            } else {
              slot.studentIds = ids;
              const st = studentById(S, ids[0]);
              if (st && !st.subject && b.subject) st.subject = b.subject;
            }
          }
          templateSlots.push(slot);
        });
      }
    }
    for (const ym of opts.templateMonths) {
      S.months[ym] = { closedDays: [...(old.closedDays || [])], slots: templateSlots.map((s) => normSlot(clone(s))) };
    }

    // 2) old per-student monthly schedules -> month slots (same day+time+price merged)
    for (const sc of old.schedules || []) {
      const t = parseTimeRange(sc.time);
      if (!t) continue;
      const m = getMonth(S, sc.yearMonth);
      const price = isNum(sc.price) ? Number(sc.price) : null;
      let slot = m.slots.find((s) => s.dow === sc.day && s.start === t.start && s.end === t.end && s.price === price && !s.groupId);
      if (!slot) slot = addSlot(S, sc.yearMonth, { dow: sc.day, start: t.start, end: t.end, price });
      if (!slot.studentIds.includes(sc.studentId)) slot.studentIds.push(sc.studentId);
    }

    S.blocked = (old.blocked || []).map((b) => ({ date: b.date }));
    S.absences = (old.absences || []).map((a) => ({ studentId: a.studentId, date: a.date }));
    return S;
  }

  return {
    DOW_KEYS, parseTimeRange, timeLabel, shiftYM, daysInMonth, dowOf, datesInMonth, uid,
    emptyState, normalizeState, migrateV2, getMonth, hasMonth, addSlot, findSlot, removeSlot, slotsByDay,
    isDayClosed, copyMonth, studentById, groupById, participantsOf, isBooked, slotTitle, slotSubject,
    isGroupClass, rateFor, isBlocked, isAbsent, sessionsOfSlot, billMonth, studentMonthSchedule, weekStats, cleanTitle, matchTitle,
    importCalendarMonth,
  };
});
