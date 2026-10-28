#!/usr/bin/env node
// Import one month of Google Calendar events into data.json.
//
// Usage:  node scripts/import-calendar.js 2026-12 events.json [--keep]
//   events.json may be: a raw Google Calendar list response ({events:[...]}, {items:[...]}),
//   a plain array of events, or the MCP tool output ([{type:"text", text:"{...}"}]).
//   --keep   add to the month instead of replacing its slots.
//
// Titles are matched to students/groups by name or alias (emoji ignored).
// Unknown titles become new, empty groups — add members in the "นักเรียน & กลุ่ม" tab or in data.json.
'use strict';
const fs = require('fs');
const path = require('path');
const C = require('../js/core.js');

const [ym, file, ...flags] = process.argv.slice(2);
if (!/^\d{4}-\d{2}$/.test(ym || '') || !file) {
  console.error('usage: node scripts/import-calendar.js YYYY-MM events.json [--keep]');
  process.exit(1);
}

function readEvents(p) {
  let raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (Array.isArray(raw) && raw[0] && raw[0].type === 'text') raw = JSON.parse(raw[0].text);
  if (Array.isArray(raw)) return raw;
  return raw.events || raw.items || [];
}

const dataPath = path.join(__dirname, '..', 'data.json');
const S = C.normalizeState(JSON.parse(fs.readFileSync(dataPath, 'utf8')));
const events = readEvents(file).filter((e) => e.status !== 'cancelled');
const report = C.importCalendarMonth(S, ym, events, { replace: !flags.includes('--keep') });
S.meta.rev += 1;
S.meta.updatedAt = new Date().toISOString();
fs.writeFileSync(dataPath, JSON.stringify(S, null, 2) + '\n');

console.log(`✓ ${ym}: ${report.slots} weekly slots from ${events.length} events (${report.duplicates} duplicates skipped)`);
for (const [title, hit] of Object.entries(report.matched)) {
  const who = hit.type === 'group' ? C.groupById(S, hit.id) : C.studentById(S, hit.id);
  console.log(`  ${title.padEnd(16)} → ${hit.type === 'group' ? 'กลุ่ม' : 'นักเรียน'} ${who.name}`);
}
if (report.createdGroups.length) console.log(`⚠ new empty groups (add members): ${report.createdGroups.join(', ')}`);
const bill = C.billMonth(S, ym);
if (bill.emptyGroups.length) console.log(`⚠ groups with no members are not billed: ${bill.emptyGroups.map((g) => g.name).join(', ')}`);
console.log(`💰 ${ym} total: ${bill.grandTotal.toLocaleString('en-US')} บาท from ${bill.students.length} students`);
