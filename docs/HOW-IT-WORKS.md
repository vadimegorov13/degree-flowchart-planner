# How it works

## One file, three roles

Every HTML file contains the same application. Small JSON blocks inside the file decide what it is:

| Block | Purpose |
|---|---|
| `<script id="dp-data" type="application/json">` | Program data: names, rules, courses, catalog years, chart images, box positions |
| `<script id="dp-mode" type="application/json">` | `{"editor": true}` turns on the editor tabs |
| `<script id="dp-plan" type="application/json">` | Present only in a saved plan: that student's plan |
| `<script id="dp-app">` | The application (`src/app.js`) |

- **Template:** data and app, with no plan.
- **Saved plan:** a template plus `dp-plan`. Opening it loads that plan.
- **Editor:** data and app with `editor: true`. It can export new templates and editors.

To save, the app rebuilds the page from those blocks plus its own source text, then downloads the result. A browser can't write over an open file, so every save is a new file.

## Rules engine

`compute()` in `src/app.js` runs on every change.

1. **Entries:** every course in the grid gets a term code (`F24`, `S25`, `R25` for summer) from the first Fall year. The status is `done` (X), `ip` (IP) or `planned`. A course flagged Fall-only or Spring-only, but placed in the other term, gets status `err` (shown black).
2. **Normalization:** `CE 432`, `ce432` and `CE A432` all become `CE A432`. Old course numbers are mapped to their current equivalent.
3. **Duplicates:** if a course appears more than once, only the latest occurrence counts, and a warning is shown.
4. **Course boxes:** each box has a list of alternatives, and each alternative is a list of courses that must all be present (one strip each). The alternative with the most matched courses wins.
5. **Pick-N groups:** for each group, the earliest matched course counts. A second course in the same group goes to the elective pool. If more than N groups are covered, the latest-scheduled group goes to the pool. Those boxes get an elective tag.
6. **Elective slots:** the pool is made of overflow from step 5, courses on the elective list, placeholder codes `TE1` and `TE2`, and unlisted upper-level courses from the configured departments (with a warning). It is sorted by term and fills slot 1, then slot 2, and so on. Anything left over is listed as extra.
7. **Not on chart:** remaining courses are listed in the summary.

## Data format

`data/<program>/program.json`:

```jsonc
{
  "schema": 1,
  "toolVersion": "7.0",
  "updated": "2026-11-04",
  "program": {
    "university": "UNIVERSITY OF ALASKA ANCHORAGE",
    "college": "College of Engineering",
    "formTitle": "Civil Engineering - Degree Plan Form",
    "degree": "Bachelor of Science in Civil Engineering",
    "short": "BSCE"
  },
  "rules": {
    "groupLabel": "Disciplines", "groupItem": "discipline", "groupPick": 4,
    "electiveLabel": "Technical electives", "electiveShort": "TE",
    "electiveDepts": ["CE", "ES", "ESM", "AE", "ENGR"], "electiveMinLevel": 3
  },
  "defaultCatalog": "2627",
  "equivalents": [["CE A410", "CE A422"]],          // first = number on the chart
  "courses": {
    "CE A432": { "name": "Steel Design", "credits": 3, "offered": "F", "te": false },
    "CE A454": { "name": "Timber Design", "credits": 3, "offered": "", "te": true }
  },
  "catalogs": {
    "2627": {
      "label": "2026–2027",
      "startYear": 2026,                              // default first Fall
      "image": "charts/2627.png",                    // or a data: URL
      "width": 795, "height": 1030,                  // image size in pixels
      "disciplines": [ { "name": "Structural", "codes": ["CE A432", "CE A433"] } ],
      "boxes": [
        { "x": 450, "y": 240, "w": 56, "h": 40, "req": [["CE A150"]] },
        { "x": 300, "y": 250, "w": 70, "h": 50, "req": [["CHEM A105", "CHEM A105L"]] },
        { "x": 120, "y": 560, "w": 85, "h": 55, "req": [["HU1"], ["HU2"]] },
        { "x": 230, "y": 840, "w": 80, "h": 55, "te": 1 }
      ]
    }
  },
  "directions": "<p>Optional custom help HTML…</p>"
}
```

- `req` is a list of alternatives, and each alternative is a list of courses that all belong in the box.
- A box with `te: n` is elective slot *n*.
- `x`, `y`, `w` and `h` are pixels in the chart image. Covers are drawn as percentages, so they scale at any zoom.

## Plan format

A saved plan's `dp-plan` block (and the older `.json` plan files) look like this:

```json
{
  "kind": "bsce-degree-plan", "schema": 1, "savedWith": "7.0", "savedAt": "2026-11-04T21:30:00Z",
  "plan": {
    "name": "Ben Example", "id": "30000002", "advisor": "S. Hamel", "date": "2026-11-04",
    "catalog": "2425", "startYear": 2024, "showCovers": true,
    "years": [
      { "hasSummer": false,
        "fall":   [ { "code": "MATH A251", "done": "X" } ],
        "spring": [ { "code": "MATH A252", "done": "IP" } ],
        "summer": [] }
    ]
  }
}
```

**Open plan** accepts a saved `.html` plan or a `.json` file. It takes the plan out and uses the current file's course data, which is how an older plan moves onto a newer template.
