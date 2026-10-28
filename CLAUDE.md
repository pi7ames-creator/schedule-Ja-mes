# schedule-Ja-mes — notes for Claude

A tutor's teaching schedule and billing web app served by GitHub Pages
(https://pi7ames-creator.github.io/schedule-Ja-mes/). It's a static site with no build step.

- `index.html`: the UI (5 tabs: weekly, monthly calendar, students & groups, billing, save/sync).
- `js/core.js`: all business logic (pure functions, no DOM). The browser uses it as `window.TutorCore`. Tests use it as a CommonJS module.
- `data.json`: **the data**. When asked to change the schedule, students, prices or groups, edit this file and push. The page loads it on every open.
- `scripts/import-calendar.js`: imports one month of Google Calendar events into `data.json`.
- `tests/core.test.js`: run `npm test` (Node ≥ 20, no dependencies). Write a test before changing core logic.

## data.json schema (version 3)

```jsonc
{
  "version": 3,
  "meta": { "rev": 3, "updatedAt": "ISO" },   // bump rev by 1 on every edit; the app uses it to detect newer data
  "settings": { "defaultRate": 300 },           // baht per person per session
  "students": [{ "id": "st_…", "name": "เนเน่", "aliases": ["Nene"], "parentTitle": "คุณแม่", "subject": "คณิต ม.6", "rate": null }],
  "groups":   [{ "id": "gr_…", "name": "SMTE", "aliases": ["SMTE"], "subject": "คณิต SMTE", "rate": null, "memberIds": ["st_…"] }],
  "months": {
    "2026-11": {
      "closedDays": ["fri"],                     // sun…sat keys; no classes that weekday this month
      "slots": [{
        "id": "sl_…", "dow": 2,                  // 0 = Sunday … 6 = Saturday
        "start": "18:15", "end": "19:45",
        "subject": "", "groupId": "gr_…",        // group slot: participants = the group's memberIds (always current)
        "studentIds": [],                        // individual slot: these students
        "price": null,                           // per-person override for this slot only
        "note": "", "flex": false,               // flex = backup slot, excluded from weekly revenue
        "skip": ["2026-11-03"]                   // dates this weekly slot does NOT run in this month
      }]
    }
  },
  "blocked":  [{ "date": "2026-11-12" }],          // whole day off
  "absences": [{ "studentId": "st_…", "date": "2026-11-17" }]
}
```

Each month has its own weekly plan. A slot repeats every matching weekday in that month except `skip` dates.
Price per person per session is resolved in this order: `slot.price` → `group.rate` → `student.rate` → `settings.defaultRate`.
A group slot bills **each member separately** at that member's resolved rate. Groups with no members are not billed. They show up as warnings.

## Common tasks

**Load a month from Google Calendar** (calendar "Class", timezone Asia/Bangkok):
1. List the month's events with the Google Calendar tool and save the raw JSON result to a file, e.g. `/tmp/events.json`.
2. Run `node scripts/import-calendar.js 2026-12 /tmp/events.json`. This replaces that month's slots. Pass `--keep` to merge instead.
3. Read the report. Unknown titles become new empty groups. Add them as aliases of the right student or group, or ask the user who is in them, then re-run.
4. Run `npm test`, then commit and push. The site updates within about a minute.

**Change a price / group members / names**: edit `data.json` directly (bump `meta.rev`), and keep ids stable.

Never put tokens or secrets in the repo. The in-app GitHub token stays in the user's browser localStorage only.
