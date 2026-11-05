(function () {
'use strict';

/* ---------- Embedded content ---------- */
const DATA = JSON.parse(document.getElementById('dp-data').textContent);
const MODE = JSON.parse(document.getElementById('dp-mode').textContent || '{}');
const CSS_TEXT = document.getElementById('dp-css').textContent;
const APP_TEXT = document.getElementById('dp-app').textContent;
const EDITOR = !!MODE.editor;
// A saved plan file is a copy of the tool with the plan inside it; a template has none.
const EMBED = (() => { const n = document.getElementById('dp-plan'); if (!n) return null; try { return JSON.parse(n.textContent); } catch (e) { return null; } })();
const SC = '<' + '/script>', ST = '<' + '/style>';
const TERMS = ['fall', 'spring', 'summer'];
const TERM_NAME = { fall: 'Fall', spring: 'Spring', summer: 'Summer' };
const TERM_LETTER = { fall: 'F', spring: 'S', summer: 'R' };
const ROWS = 6, YEARS = 6;
const STORE_KEY = 'bsce-degree-plan-autosave-v1';
// Program names and rule settings. Defaults are UAA's BSCE; the editor's Program tab changes them.
DATA.program = Object.assign({ university: 'UNIVERSITY OF ALASKA ANCHORAGE', college: 'College of Engineering', formTitle: 'Civil Engineering - Degree Plan Form',
  degree: 'Bachelor of Science in Civil Engineering', short: 'BSCE' }, DATA.program || {});
DATA.rules = Object.assign({ groupLabel: 'Disciplines', groupItem: 'discipline', groupPick: 4, electiveLabel: 'Technical electives', electiveShort: 'TE',
  electiveDepts: ['CE', 'ES', 'ESM', 'AE', 'ENGR'], electiveMinLevel: 3 }, DATA.rules || {});
const PG = () => DATA.program, RU = () => DATA.rules;
const pickN = () => Math.max(0, Number(RU().groupPick) || 0);
const electiveOne = () => String(RU().electiveLabel || 'elective').replace(/s$/i, '').toLowerCase();
const shortName = () => String(PG().short || 'Degree').replace(/[^A-Za-z0-9_-]+/g, '') || 'Degree';
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];

let editorDirty = false;

/* ---------- Small helpers ---------- */
const $ = (sel, root) => (root || document).querySelector(sel);
const el = (tag, attrs, ...kids) => {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return n;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function store(get, val) {
  try {
    if (get) return localStorage.getItem(STORE_KEY);
    if (val === null) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, val);
  } catch (e) { return null; }
}
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function banner(msg, isError) {
  const b = $('#banner'); if (!b) return;
  b.textContent = msg; b.className = 'banner show' + (isError ? ' error' : '');
  clearTimeout(banner.t); banner.t = setTimeout(() => { b.className = 'banner'; }, 7000);
}
function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'application/octet-stream' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- Course codes ---------- */
// "ce454", "CE 454", "CE A454", "CE A454" -> "CE A454". Codes like SS1, TE2, FA stay as typed (upper case).
function normCode(s) {
  if (!s) return '';
  let t = String(s).replace(/[ \s]+/g, ' ').trim().toUpperCase();
  const m = t.match(/^([A-Z]{2,4})\s*A?\s*(\d{3}[A-Z]?|\dXX)$/);
  if (m) t = m[1] + ' A' + m[2];
  return t;
}
let CANON = {};
function rebuildCanon() {
  CANON = {};
  for (const g of DATA.equivalents || []) {
    const list = g.map(normCode).filter(Boolean);
    for (const c of list) CANON[c] = list[0];
  }
}
const canon = c => CANON[c] || c;
function course(code) {
  return DATA.courses[code] || DATA.courses[canon(code)] || null;
}
function isTEApproved(code) {
  if (code === 'TE1' || code === 'TE2' || code === 'TE') return true;
  const c = DATA.courses[code] || DATA.courses[canon(code)];
  if (c && c.te) return true;
  for (const k in DATA.courses) if (DATA.courses[k].te && canon(k) === canon(code)) return true;
  return false;
}
function looksLikeTE(code) {
  const m = code.match(/^([A-Z]{2,4}) A(\d)(\d\d)/);
  return !!(m && (RU().electiveDepts || []).includes(m[1]) && Number(m[2]) >= (Number(RU().electiveMinLevel) || 3));
}
function reqText(req) { return req.map(a => a.join(' + ')).join(' | '); }
function parseReq(text) {
  return String(text || '').split('|').map(a => a.split('+').map(normCode).filter(Boolean)).filter(a => a.length);
}

/* ---------- Plan state ---------- */
function emptyPlan(catalogKey) {
  const key = catalogKey || DATA.defaultCatalog;
  const cat = DATA.catalogs[key] || Object.values(DATA.catalogs)[0];
  const years = [];
  for (let i = 0; i < YEARS; i++) {
    const y = {};
    for (const t of TERMS) y[t] = Array.from({ length: ROWS }, () => ({ code: '', done: '' }));
    years.push(y);
  }
  return { name: '', id: '', advisor: '', date: today(), catalog: key, startYear: cat ? cat.startYear : new Date().getFullYear(), years, showCovers: true };
}
let plan = emptyPlan();

function termCode(yi, t) {
  const y = Number(plan.startYear) + yi + (t === 'fall' ? 0 : 1);
  return TERM_LETTER[t] + String(y % 100).padStart(2, '0');
}
function statusOf(done) {
  const d = String(done || '').trim().toUpperCase();
  return d === 'X' ? 'done' : d === 'IP' ? 'ip' : 'planned';
}

/* ---------- Rules engine ---------- */
function compute() {
  const cat = DATA.catalogs[plan.catalog];
  const warnings = [];
  const entries = [];
  plan.years.forEach((y, yi) => TERMS.forEach((t, ti) => y[t].forEach((r, ri) => {
    const code = normCode(r.code);
    if (!code) return;
    const c = course(code);
    const tc = termCode(yi, t);
    const offered = c && c.offered ? c.offered : '';
    const wrong = !!offered && offered !== TERM_LETTER[t];
    entries.push({ code, canon: canon(code), course: c, status: wrong ? 'err' : statusOf(r.done), wrong,
      term: tc, order: (yi * 3 + ti) * 100 + ri, yi, t, ri, credits: c ? Number(c.credits) || 0 : 0 });
    if (!c) warnings.push({ kind: 'warn', text: `${code} (${tc}) is not in the course list, so it has no name or credits.` });
    if (wrong) warnings.push({ kind: 'warn', text: `${code} is scheduled in ${tc}, but it is offered ${offered === 'F' ? 'Fall' : 'Spring'} only.` });
  })));
  entries.sort((a, b) => a.order - b.order);

  // Duplicates: the latest occurrence counts (a retake), others are flagged.
  const byCanon = {};
  for (const e of entries) (byCanon[e.canon] = byCanon[e.canon] || []).push(e);
  const dupSkip = new Set();
  for (const k in byCanon) {
    const list = byCanon[k];
    if (list.length > 1 && !/^TE\d?$/.test(k)) {
      list.slice(0, -1).forEach(e => dupSkip.add(e));
      warnings.push({ kind: 'warn', text: `${list[0].code} is entered ${list.length} times (${list.map(e => e.term).join(', ')}). Only the latest one, ${list[list.length - 1].term}, counts.` });
    }
  }
  const used = new Set();
  const boxes = cat ? cat.boxes : [];
  const result = boxes.map(() => null);

  // 1. Course boxes: pick the alternative with the most matched courses.
  boxes.forEach((b, bi) => {
    if (b.te || !b.req) return;
    let best = null;
    for (const alt of b.req) {
      const segs = alt.map(code => {
        const want = canon(normCode(code));
        const hits = entries.filter(e => e.canon === want && !used.has(e) && !dupSkip.has(e));
        return { code, entry: hits.length ? hits[hits.length - 1] : null };
      });
      const n = segs.filter(s => s.entry).length;
      if (n && (!best || n > best.n)) best = { n, segs };
    }
    if (best) {
      best.segs.forEach(s => s.entry && used.add(s.entry));
      result[bi] = { segs: best.segs };
    }
  });

  // 2. Disciplines (4 of 5), with overflow to the technical elective pool.
  const discOf = {};
  for (const d of (cat && cat.disciplines) || []) for (const c of d.codes) discOf[canon(normCode(c))] = d.name;
  const discHits = [];
  result.forEach((r, bi) => r && r.segs.forEach(s => {
    if (s.entry && discOf[s.entry.canon]) discHits.push({ disc: discOf[s.entry.canon], entry: s.entry, bi });
  }));
  discHits.sort((a, b) => a.entry.order - b.entry.order);
  const counted = {}, pool = [];
  for (const h of discHits) {
    if (!counted[h.disc]) counted[h.disc] = h;
    else { pool.push({ entry: h.entry, why: `second ${h.disc} course` }); result[h.bi].asTE = true; }
  }
  let countedList = Object.values(counted).sort((a, b) => a.entry.order - b.entry.order);
  while (countedList.length > pickN()) {
    const last = countedList.pop();
    delete counted[last.disc];
    pool.push({ entry: last.entry, why: `${ORD[pickN()] || (pickN() + 1) + 'th'} ${RU().groupItem || 'group'} (${last.disc})` });
    result[last.bi].asTE = true;
  }

  // 3. Technical electives: approved courses, TE1/TE2 codes, and overflow, in term order.
  const notOnChart = [];
  for (const e of entries) {
    if (used.has(e) || dupSkip.has(e)) continue;
    if (isTEApproved(e.code) || isTEApproved(e.canon)) pool.push({ entry: e, why: '' });
    else if (looksLikeTE(e.code)) {
      pool.push({ entry: e, why: '', unapproved: true });
      warnings.push({ kind: 'warn', text: `${e.code} (${e.term}) is not on the approved ${electiveOne()} list. Check with your advisor.` });
    } else notOnChart.push(e);
  }
  pool.sort((a, b) => a.entry.order - b.entry.order);
  const teBoxes = boxes.map((b, bi) => ({ b, bi })).filter(x => x.b.te).sort((a, b) => a.b.te - b.b.te);
  const assigned = [];
  pool.forEach((p, i) => {
    if (i < teBoxes.length) {
      result[teBoxes[i].bi] = { segs: [{ code: p.entry.code, entry: p.entry }], te: true, why: p.why };
      assigned.push(p);
    }
  });
  const extra = pool.slice(teBoxes.length);
  if (extra.length) warnings.push({ kind: 'warn', text: `More ${String(RU().electiveLabel).toLowerCase()} than ${RU().electiveShort} boxes. ${extra.map(p => `${p.entry.code} (${p.entry.term})`).join(', ')} ${extra.length > 1 ? 'do' : 'does'} not cover a box.` });
  if (notOnChart.length) warnings.push({ kind: 'info', text: `Not on this flow chart: ${notOnChart.map(e => `${e.code} (${e.term})`).join(', ')}.` });

  const discNames = ((cat && cat.disciplines) || []).map(d => d.name);
  return { cat, entries, result, counted, discNames, teAssigned: assigned, teSlots: teBoxes.length, extra, warnings,
    credits: entries.filter(e => !dupSkip.has(e)).reduce((s, e) => s + e.credits, 0) };
}

/* ---------- Layout ---------- */
const topbar = el('header', { class: 'topbar' });
const app = el('div', { class: 'app' });
const printView = el('div', { id: 'print-view', 'aria-hidden': 'true' });
document.body.append(topbar, app, printView);
const bannerEl = el('div', { id: 'banner', class: 'banner', role: 'status' });
document.body.append(bannerEl);

const sheets = {};
const tabsBar = el('nav', { class: 'tabs', 'aria-label': 'Sheets' });
function addSheet(key, label) {
  const s = el('section', { class: 'sheet', id: 'sheet-' + key });
  sheets[key] = s; app.append(s);
  tabsBar.append(el('button', { 'data-sheet': key, onclick: () => showSheet(key) }, label));
  return s;
}
function showSheet(key) {
  for (const k in sheets) sheets[k].classList.toggle('active', k === key);
  tabsBar.querySelectorAll('button[data-sheet]').forEach(b => b.classList.toggle('active', b.dataset.sheet === key));
  topbar.classList.toggle('ed-mode', EDITOR && key !== 'plan');
  document.body.classList.toggle('plan-active', key === 'plan');
  if (key === 'plan') requestAnimationFrame(() => fitHeight());
  window.scrollTo(0, 0);
  if (key === 'flowcharts') renderEditorStage();
}

/* ---------- Dialogs (in-page, no browser pop-ups) ---------- */
function dialog(opts) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const back = el('div', { class: 'modal-back' });
    const box = el('div', { class: 'modal' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' });
    const close = v => { back.remove(); document.removeEventListener('keydown', onKey, true); if (prev && prev.focus) prev.focus(); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(null); } };
    if (opts.icon) box.append(el('div', { class: 'modal-icon ' + opts.icon }, opts.icon === 'warn' ? '!' : 'i'));
    box.append(el('h2', { id: 'dlg-title' }, opts.title));
    if (opts.body) box.append(typeof opts.body === 'string' ? el('div', { class: 'modal-body', html: opts.body }) : el('div', { class: 'modal-body' }, opts.body));
    const actions = el('div', { class: 'actions' });
    let focusBtn = null;
    for (const b of opts.buttons || [{ label: 'OK', value: true, primary: true }]) {
      const btn = el('button', { class: (b.primary ? 'primary' : '') + (b.danger ? ' danger' : ''), onclick: () => close(b.value) }, b.label);
      if (b.primary || b.focus) focusBtn = focusBtn || btn;
      actions.append(btn);
    }
    box.append(actions);
    back.append(box);
    back.addEventListener('mousedown', e => { if (e.target === back) close(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(back);
    (opts.focus || focusBtn || actions.lastChild).focus();
  });
}

const DIRECTIONS = `
<p>Fill in the light grey boxes. Everything else updates on its own.</p>
<ol>
<li><b>Name, ID, Advisor, Date.</b> These print on your plan and are saved in your plan file only.</li>
<li><b>Catalog Year</b>, for example <code>2425</code> for 2024–25. The matching flow chart appears on the left. Charts for 2020–21 through 2026–27 are included.</li>
<li><b>First Fall year</b>, in the top Fall Semester heading. It fills in from the catalog year; change it if you started a different year. The other years follow.</li>
<li><b>Class:</b> type the course number for each term, for example <code>ES A331</code> or <code>CE A432</code>. <code>CE 432</code> and <code>ce432</code> also work. The name and credits fill in.</li>
<li><b>Completed:</b> <b>X</b> = completed (green on the chart), <b>IP</b> = in progress (yellow), blank = planned (red).</li>
</ol>
<h3>On the flow chart</h3>
<ul>
<li>Each course you schedule covers its box and shows the term, for example <b>F24</b>.</li>
<li><b>Black</b> means the course is in a term it isn't offered, such as a Spring-only class in the Fall.</li>
<li>Untick <b>Colored boxes</b> to read the course numbers while you fill in, then tick it to check that every box is covered.</li>
<li><b>Zoom the chart:</b> hold Ctrl (⌘ on a Mac) and scroll over it, or use the <b>−</b> / <b>+</b> buttons. Drag to move around. <b>Fit height</b> shows the whole chart again, and <b>Full screen</b> opens it large.</li>
<li>The chart and your plan scroll separately. Drag the handle between them to make the chart wider.</li>
</ul>
<h3>Electives and codes</h3>
<ul>
<li><b>FA, HU1, HU2, SS1, SS2</b> fill the Fine Arts, Humanities and Social Science boxes; <b>BS</b> is Basic Science; <b>AKNS</b> is Alaska Native Studies.</li>
<li><b>Technical electives:</b> type the real course number (for example <code>CE A454</code>). <b>TE1</b> and <b>TE2</b> still work as placeholders. Electives fill the TE boxes in term order, and each box shows its course.</li>
<li><b>Disciplines:</b> one course in four of the five (Environmental, Transportation, Geotechnical, Structural, Water Resources). If you take all five, the latest one counts as a technical elective. If you take both CE 432 and CE 433, the later one does. Those boxes show a <b>TE</b> tag.</li>
<li>Enter separately-enrolled labs (Chemistry, Physics) on their own row. Labs that come with the lecture (CE 334, GEO 155, older ES 341) don't need a row.</li>
</ul>
<h3>Rows, years and summer</h3>
<ul>
<li>Under each year: <b>+ row</b> and <b>− row</b> add or remove a row, and <b>Remove year</b> deletes that year. <b>+ year</b> at the bottom adds one.</li>
<li>Need a summer term? Click <b>+ Summer</b> under that year. <b>− Summer</b> removes it again (you're asked first if it has courses).</li>
</ul>
<h3>Saving and printing</h3>
<ul>
<li><b>Save plan</b> (or <b>Ctrl+S</b>, <b>⌘S</b> on a Mac) saves a copy of this file with your plan inside, named like <code>Smith_2425_DegreePlan_2026-11-04_1430.html</code>. Double-click it to open your plan again.</li>
<li>Every save makes a new file, so your earlier versions are kept. Email the newest one to your advisor.</li>
<li><b>Open plan</b> loads a plan from another saved file into this one, for example an older plan into a newer version of the tool.</li>
<li>While you work in the blank template, this browser keeps a backup of your plan, on this computer only.</li>
<li><b>Print</b> gives two pages: the flow chart on one page, then your semester plan and requirement summary.</li>
<li>Nothing is sent over the internet.</li>
</ul>`;
function showDirections() {
  return dialog({ title: 'Directions', wide: true, body: DATA.directions || DIRECTIONS, buttons: [{ label: 'Close', value: true, primary: true }] });
}

/* ---------- Unsaved changes ---------- */
let planDirty = false;
function setPlanDirty(v) {
  planDirty = !!v;
  const n = $('#save-state');
  if (n) {
    n.textContent = planDirty && hasData() ? 'Unsaved changes' : (hasData() ? 'Saved' : '');
    n.className = 'save-state' + (planDirty && hasData() ? ' unsaved' : '');
  }
}
function changed() { setPlanDirty(true); update(); }
function hasData() {
  if ((plan.name || '').trim() || (plan.id || '').trim() || (plan.advisor || '').trim()) return true;
  return plan.years.some(y => TERMS.some(t => y[t].some(r => (r.code || '').trim() || (r.done || '').trim())));
}
async function guardUnsaved(action) {
  if (!planDirty || !hasData()) return true;
  const v = await dialog({ icon: 'warn', title: 'You have unsaved changes',
    body: `Save your plan to a file before you ${action}? If you don't, the changes will be lost.`,
    buttons: [{ label: 'Cancel', value: null }, { label: "Don't save", value: 'discard', danger: true }, { label: 'Save plan', value: 'save', primary: true }] });
  if (v === 'save') return await savePlanFile();
  return v === 'discard';
}
window.addEventListener('beforeunload', e => {
  if (!EDITOR && planDirty && hasData()) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------- Top bar ---------- */
const fileInput = el('input', { type: 'file', accept: '.html,.htm,.json,text/html,application/json', style: { display: 'none' }, onchange: openPlanFile });
const chkCovers = el('input', { type: 'checkbox', checked: true, onchange: () => { plan.showCovers = chkCovers.checked; applyToggles(); saveAuto(); } });
const studentBar = el('div', { class: 'bar student-bar' });
const edBar = el('div', { class: 'bar ed-bar' });
topbar.append(studentBar, edBar);
studentBar.append(
  el('div', { class: 'brand' }, el('b', { id: 'brand-name' }, `${PG().short} Degree Plan`), el('span', { id: 'file-kind' }, 'v' + DATA.toolVersion + (EMBED ? ' · saved plan' : EDITOR ? '' : ' · template'))),
  el('button', { onclick: showDirections }, 'Directions'),
  el('span', { class: 'sep' }),
  el('div', { class: 'plan-actions' },
    el('button', { onclick: newPlan }, 'New plan'),
    el('button', { onclick: async () => { if (await guardUnsaved('open another plan')) fileInput.click(); } }, 'Open plan'), fileInput,
    el('button', { class: 'primary', onclick: savePlanFile }, 'Save plan'),
    el('button', { onclick: printPlan }, 'Print'),
    el('span', { class: 'sep' }),
    el('span', { id: 'save-state', class: 'save-state' }, ''))
);

/* ---------- Plan sheet ---------- */
const planSheet = addSheet('plan', 'Plan');
const planPage = el('div', { class: 'plan-page' });
const formHead = el('div', { class: 'form-head' });
// Split view: the chart pane on the left and the plan pane on the right each scroll on their own.
const layout = el('div', { class: 'plan-split' });
const chartWrap = el('section', { class: 'chart-pane', 'aria-label': 'Flow chart' });
const gridWrap = el('div', { class: 'plan-grid' });
const rightCol = el('div', { class: 'plan-right' });
const divider = el('div', { class: 'divider', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize the chart pane', tabindex: '0', title: 'Drag to resize. Double-click to reset.' });
const rightPane = el('div', { class: 'grid-pane' }, rightCol);
layout.append(chartWrap, divider, rightPane);
planPage.append(layout);
planSheet.append(planPage);

const CHART_W = 640;
const COLS = [['c-code', 96], ['c-name', 190], ['c-cr', 52], ['c-done', 76], ['c-yr', 50]];
const TERM_W = COLS.reduce((s, c) => s + c[1], 0), GAP_W = 10;
function termsOf(y) { return y.hasSummer ? TERMS : ['fall', 'spring']; }
const termWidth = n => n * TERM_W + (n - 1) * GAP_W;

function hfield(label, key, opts) {
  let input;
  if (opts && opts.select) {
    input = el('select', { onchange: () => onHeader(key, input.value) });
    for (const [v, t] of opts.select) input.append(el('option', { value: v }, t));
    input.value = plan[key];
  } else input = el('input', { type: 'text', value: plan[key] == null ? '' : plan[key], oninput: () => onHeader(key, input.value), autocomplete: 'off' });
  input.id = 'f-' + key;
  return [el('label', { for: 'f-' + key, class: 'hl' }, label), input];
}
function catalogOptions() {
  return Object.keys(DATA.catalogs).sort().map(k => [k, `${k}  (${DATA.catalogs[k].label})`]);
}
function renderHeader() {
  formHead.innerHTML = '';
  const [nl, ni] = hfield('Name:', 'name'), [al, ai] = hfield('Advisor:', 'advisor'), [il, ii] = hfield('ID:', 'id');
  const [cl, ci] = hfield('Catalog Year:', 'catalog', { select: catalogOptions() }), [dl, di] = hfield('Date:', 'date');
  formHead.append(
    el('div', { class: 'form-title' },
      el('div', { class: 'uaa' }, PG().university),
      el('div', { class: 'coe' }, PG().college),
      el('div', null, PG().formTitle),
      el('div', { class: 'ver' }, 'Version ' + DATA.toolVersion)),
    el('div', { class: 'hdr-grid' },
      nl, ni, el('span'), al, ai,
      il, ii, el('span'), cl, ci),
    el('div', { class: 'hdr-date' }, dl, di));
}
function onHeader(key, val) {
  plan[key] = key === 'startYear' ? (Number(val) || plan.startYear) : val;
  if (key === 'catalog') {
    const cat = DATA.catalogs[val];
    if (cat) { plan.startYear = cat.startYear; const sy = $('#f-startYear'); if (sy) sy.value = plan.startYear; }
    renderChart();
  }
  if (key === 'catalog' || key === 'startYear') refreshTermCodes();
  changed();
}

const datalist = el('datalist', { id: 'dl-courses' });
const dlDone = el('datalist', { id: 'dl-done' }, el('option', { value: 'X' }, 'Completed'), el('option', { value: 'IP' }, 'In progress'));
document.body.append(datalist, dlDone);
function fillDatalist() {
  datalist.innerHTML = '';
  for (const k of Object.keys(DATA.courses).sort()) datalist.append(el('option', { value: k }, DATA.courses[k].name || ''));
}
const blankRow = () => ({ code: '', done: '' });
function yearHasData(y) { return TERMS.some(t => y[t].some(r => (r.code || '').trim() || (r.done || '').trim())); }
async function removeRow(y, yi) {
  const n = Math.max(...TERMS.map(t => y[t].length));
  if (n <= 1) return;
  const last = TERMS.map(t => y[t][n - 1]).filter(Boolean);
  if (last.some(r => (r.code || '').trim())) {
    const ok = await dialog({ icon: 'warn', title: 'Remove this row?', body: `The last row of year ${yi + 1} has courses in it: ${last.filter(r => r.code).map(r => esc(normCode(r.code))).join(', ')}.`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Remove row', value: true, danger: true, focus: true }] });
    if (!ok) return;
  }
  TERMS.forEach(t => { if (y[t].length >= n) y[t].length = n - 1; });
  renderGrid(); changed();
}
async function removeYear(yi) {
  if (plan.years.length <= 1) return;
  const y = plan.years[yi];
  if (yearHasData(y)) {
    const ok = await dialog({ icon: 'warn', title: `Remove year ${yi + 1}?`,
      body: `Fall ${Number(plan.startYear) + yi} through Summer ${Number(plan.startYear) + yi + 1} will be deleted, and the later years move up one year.`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Remove year', value: true, danger: true, focus: true }] });
    if (!ok) return;
  }
  plan.years.splice(yi, 1); renderGrid(); changed();
}
async function removeSummer(y, yi) {
  const used = y.summer.filter(r => (r.code || '').trim());
  if (used.length) {
    const ok = await dialog({ icon: 'warn', title: `Remove Summer ${Number(plan.startYear) + yi + 1}?`,
      body: `These courses in the summer term will be removed too: <b>${used.map(r => esc(normCode(r.code))).join(', ')}</b>.`,
      buttons: [{ label: 'Cancel', value: false }, { label: 'Remove summer', value: true, danger: true, focus: true }] });
    if (!ok) return;
  }
  y.summer = y.summer.map(blankRow);
  y.hasSummer = false; renderGrid(); changed();
}

function renderGrid() {
  gridWrap.innerHTML = '';
  gridWrap.style.width = Math.max(...plan.years.map(y => termWidth(termsOf(y).length))) + 'px';
  // Header and summary keep the Fall + Spring width; summer columns extend past them.
  rightCol.style.width = (2 * TERM_W + GAP_W) + 'px';
  plan.years.forEach((y, yi) => {
    const terms = termsOf(y);
    const tbl = el('table', { class: 'year', style: { width: termWidth(terms.length) + 'px' } });
    const cg = el('colgroup');
    terms.forEach((t, ti) => { if (ti) cg.append(el('col', { style: { width: GAP_W + 'px' } })); COLS.forEach(([, w]) => cg.append(el('col', { style: { width: w + 'px' } }))); });
    tbl.append(cg);
    const hr = el('tr', { class: 'term-h' }), ch = el('tr', { class: 'col-h' });
    terms.forEach((t, ti) => {
      if (ti) { hr.append(el('th', { class: 'gap' })); ch.append(el('th', { class: 'gap' })); }
      const th = el('th', { colspan: 5 }, el('span', null, `${TERM_NAME[t]} Semester:`));
      if (yi === 0 && t === 'fall') th.append(el('input', { id: 'f-startYear', class: 'yr-in', type: 'number', value: plan.startYear, 'aria-label': 'First Fall year', title: 'First Fall year: the other years follow', oninput: e => onHeader('startYear', e.target.value) }));
      else th.append(el('span', { class: 'yr-lbl', id: `th-${yi}-${t}` }, ''));
      hr.append(th);
      ch.append(el('th', null, 'Class'), el('th', null, ''), el('th', null, 'Credits'), el('th', null, 'Completed'), el('th', null, 'Year'));
    });
    tbl.append(hr, ch);
    const nRows = Math.max(1, ...TERMS.map(t => y[t].length));
    TERMS.forEach(t => { while (y[t].length < nRows) y[t].push(blankRow()); });
    for (let ri = 0; ri < nRows; ri++) {
      const tr = el('tr');
      terms.forEach((t, ti) => {
        if (ti) tr.append(el('td', { class: 'gap' }));
        const r = y[t][ri];
        const code = el('input', { value: r.code, list: 'dl-courses', 'aria-label': `${TERM_NAME[t]} year ${yi + 1} row ${ri + 1} course`, spellcheck: 'false', autocomplete: 'off',
          oninput: () => { r.code = code.value; changed(); }, onblur: () => { const n = normCode(code.value); if (n && n !== code.value) { code.value = n; r.code = n; update(); } } });
        const done = el('input', { value: r.done, list: 'dl-done', maxlength: 2, autocomplete: 'off', 'aria-label': `${TERM_NAME[t]} year ${yi + 1} row ${ri + 1} completed`,
          oninput: () => { r.done = done.value.toUpperCase(); changed(); } });
        code.dataset.ord = yi * 100000 + ti * 1000 + ri * 2;
        done.dataset.ord = yi * 100000 + ti * 1000 + ri * 2 + 1;
        tr.append(el('td', { class: 'c-code' }, code), el('td', { class: 'c-name', id: `nm-${yi}-${t}-${ri}` }),
          el('td', { class: 'c-cr', id: `cr-${yi}-${t}-${ri}` }), el('td', { class: 'c-done', id: `dn-${yi}-${t}-${ri}` }, done),
          el('td', { class: 'c-yr', id: `yr-${yi}-${t}-${ri}` }));
      });
      tbl.append(tr);
    }
    const tot = el('tr', { class: 'tot' });
    terms.forEach((t, ti) => {
      if (ti) tot.append(el('td', { class: 'gap' }));
      tot.append(el('td', { class: 'lbl', colspan: 2 }, 'TOT. CR.:'), el('td', { class: 'c-cr', id: `tot-${yi}-${t}` }), el('td', { colspan: 2 }));
    });
    tbl.append(tot);
    gridWrap.append(tbl);
    gridWrap.append(el('div', { class: 'year-tools' },
      el('button', { onclick: () => { TERMS.forEach(t => y[t].push(blankRow())); renderGrid(); changed(); } }, '+ row'),
      el('button', { onclick: () => removeRow(y, yi), disabled: nRows <= 1 }, '− row'),
      y.hasSummer ? el('button', { onclick: () => removeSummer(y, yi) }, '− Summer')
        : el('button', { onclick: () => { y.hasSummer = true; renderGrid(); changed(); } }, '+ Summer'),
      el('button', { class: 'quiet', onclick: () => removeYear(yi), disabled: plan.years.length <= 1 }, 'Remove year')));
  });
  gridWrap.append(el('div', { class: 'year-tools' }, el('button', { onclick: () => {
    const ny = {}; TERMS.forEach(t => ny[t] = Array.from({ length: ROWS }, blankRow)); plan.years.push(ny); renderGrid(); changed();
  } }, '+ year')));
  refreshTermCodes();
}
// Tab moves down a term's rows (course, then Completed), then to the next term, then the next year.
gridWrap.addEventListener('keydown', e => {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey || !e.target.dataset || e.target.dataset.ord == null) return;
  const list = [...gridWrap.querySelectorAll('input[data-ord]')].sort((a, b) => a.dataset.ord - b.dataset.ord);
  const i = list.indexOf(e.target) + (e.shiftKey ? -1 : 1);
  if (i < 0 || i >= list.length) return;
  e.preventDefault();
  list[i].focus(); list[i].select();
});
function refreshTermCodes() {
  plan.years.forEach((y, yi) => TERMS.forEach(t => {
    const th = document.getElementById(`th-${yi}-${t}`);
    if (th) th.textContent = Number(plan.startYear) + yi + (t === 'fall' ? 0 : 1);
  }));
}

/* ---------- Chart ---------- */
const stage = el('div', { class: 'chart-stage chart-canvas' });
const chartImg = el('img', { alt: 'Flow chart for the selected catalog year', draggable: 'false' });
const coverLayer = el('div');
stage.append(chartImg, coverLayer);
const viewport = el('div', { class: 'viewport', tabindex: '0', 'aria-label': 'Flow chart. Ctrl or Command plus scroll to zoom, drag to move.' }, stage);
const legendHTML = () => el('div', { class: 'legend' },
  el('span', null, el('i', { class: 'lg planned' }, 'F22'), 'Scheduled'),
  el('span', null, el('i', { class: 'lg ip' }, 'S23'), 'In progress (IP)'),
  el('span', null, el('i', { class: 'lg done' }, 'F22'), 'Completed (X)'),
  el('span', null, el('i', { class: 'lg err' }, 'S23'), 'Wrong semester'),
  el('span', null, el('i', { class: 'lg te' }, RU().electiveShort), 'Counts as ' + electiveOne()));
const summary = el('div', { class: 'summary' });
const chartTitle = el('span', { class: 'chart-title' }, '');
const zoomPct = el('span', { class: 'zoom-pct' }, '100%');
const TIP_KEY = 'bsce-degree-plan-chart-tip-hidden';
const tip = el('div', { class: 'chart-tip' },
  el('div', null, el('b', null, 'Tip: '), 'hold ', el('b', null, 'Ctrl'), ' (', el('b', null, '⌘'), ' on a Mac) and scroll over the chart to zoom it. Drag to move around, double-click to zoom in. Drag the handle on the right edge to make the chart wider.'),
  el('button', { class: 'small', 'aria-label': 'Hide tip', onclick: () => { tip.hidden = true; try { localStorage.setItem(TIP_KEY, '1'); } catch (e) { /* ignore */ } fitHeight(); } }, '×'));
try { if (localStorage.getItem(TIP_KEY)) tip.hidden = true; } catch (e) { /* ignore */ }
chartWrap.append(
  el('div', { class: 'pane-head' }, chartTitle,
    el('label', { class: 'cov-toggle', title: 'Turn off to read the course numbers under the colored boxes' }, chkCovers, 'Colored boxes'),
    el('span', { class: 'sep' }),
    el('button', { class: 'small', 'aria-label': 'Zoom out', onclick: () => setZoom(zoom / 1.2) }, '−'), zoomPct,
    el('button', { class: 'small', 'aria-label': 'Zoom in', onclick: () => setZoom(zoom * 1.2) }, '+'),
    el('button', { class: 'small', onclick: () => fitHeight() }, 'Fit height'),
    el('button', { class: 'small', onclick: () => fitWidth() }, 'Fit width'),
    el('button', { class: 'small', onclick: () => showFullChart(plan.catalog, false) }, 'Full screen')),
  tip, viewport, legendHTML());
rightCol.append(formHead, summary, gridWrap);

/* Chart zoom and pan, inside its own pane. zoom = screen pixels per chart pixel. */
let zoom = 1, paneResized = false;
const PAD = 12;
function setZoom(z, ax, ay) {
  const cat = DATA.catalogs[plan.catalog]; if (!cat) return;
  z = Math.min(3, Math.max(0.2, z));
  ax = ax == null ? viewport.clientWidth / 2 : ax; ay = ay == null ? viewport.clientHeight / 2 : ay;
  const cx = (viewport.scrollLeft + ax - PAD) / zoom, cy = (viewport.scrollTop + ay - PAD) / zoom;
  zoom = z;
  stage.style.width = Math.floor(cat.width * z) + 'px';
  stage.style.setProperty('--u', z + 'px');
  zoomPct.textContent = Math.round(z * 100) + '%';
  viewport.scrollLeft = cx * z + PAD - ax;
  viewport.scrollTop = cy * z + PAD - ay;
}
// Fit height. Unless the person has dragged the divider, the pane is sized to the chart, so there is no sideways scrolling.
function fitHeight() {
  const cat = DATA.catalogs[plan.catalog]; if (!cat || !viewport.clientHeight) return;
  for (let i = 0; i < 3; i++) {
    const z = (viewport.clientHeight - 2 * PAD - 1) / cat.height;
    if (!paneResized) {
      const want = Math.ceil(cat.width * z) + 2 * PAD + (chartWrap.offsetWidth - viewport.clientWidth);
      chartWrap.style.width = Math.max(320, Math.min(want, layout.clientWidth - 360)) + 'px';
    }
    setZoom(z, 0, 0);
  }
  viewport.scrollLeft = 0; viewport.scrollTop = 0;
}
function fitWidth() {
  const cat = DATA.catalogs[plan.catalog]; if (!cat) return;
  setZoom((viewport.clientWidth - 2 * PAD - 1) / cat.width, 0, 0);
  viewport.scrollLeft = 0; viewport.scrollTop = 0;
}
viewport.addEventListener('wheel', e => {
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  const r = viewport.getBoundingClientRect();
  setZoom(zoom * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
viewport.addEventListener('dblclick', e => { const r = viewport.getBoundingClientRect(); setZoom(zoom * 1.5, e.clientX - r.left, e.clientY - r.top); });
viewport.addEventListener('keydown', e => {
  if (e.key === '+' || e.key === '=') { setZoom(zoom * 1.2); e.preventDefault(); }
  else if (e.key === '-') { setZoom(zoom / 1.2); e.preventDefault(); }
  else if (e.key === '0') { fitHeight(); e.preventDefault(); }
});
let panDrag = null;
viewport.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  panDrag = { x: e.clientX, y: e.clientY, l: viewport.scrollLeft, t: viewport.scrollTop };
  viewport.setPointerCapture(e.pointerId); viewport.classList.add('dragging');
});
viewport.addEventListener('pointermove', e => { if (!panDrag) return; viewport.scrollLeft = panDrag.l - (e.clientX - panDrag.x); viewport.scrollTop = panDrag.t - (e.clientY - panDrag.y); });
const endPan = () => { panDrag = null; viewport.classList.remove('dragging'); };
viewport.addEventListener('pointerup', endPan); viewport.addEventListener('pointercancel', endPan);

let splitDrag = null;
divider.addEventListener('pointerdown', e => { splitDrag = { x: e.clientX, w: chartWrap.offsetWidth }; divider.setPointerCapture(e.pointerId); divider.classList.add('dragging'); });
divider.addEventListener('pointermove', e => {
  if (!splitDrag) return;
  paneResized = true;
  chartWrap.style.width = Math.max(320, Math.min(layout.clientWidth - 360, splitDrag.w + e.clientX - splitDrag.x)) + 'px';
});
const endSplit = () => { if (splitDrag) { splitDrag = null; divider.classList.remove('dragging'); } };
divider.addEventListener('pointerup', endSplit); divider.addEventListener('pointercancel', endSplit);
divider.addEventListener('dblclick', () => { paneResized = false; fitHeight(); });
divider.addEventListener('keydown', e => {
  const d = e.key === 'ArrowLeft' ? -40 : e.key === 'ArrowRight' ? 40 : 0; if (!d) return;
  e.preventDefault(); paneResized = true;
  chartWrap.style.width = Math.max(320, Math.min(layout.clientWidth - 360, chartWrap.offsetWidth + d)) + 'px';
});

function renderChart() {
  const cat = DATA.catalogs[plan.catalog];
  if (!cat) { chartImg.removeAttribute('src'); return; }
  chartTitle.textContent = `Flow chart · ${cat.label}`;
  if (chartImg.getAttribute('src') !== cat.image) { chartImg.src = cat.image; }
  requestAnimationFrame(fitHeight);
}
function sizeChart() { fitHeight(); }
let resizeT;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (sheets.plan.classList.contains('active')) fitHeight(); }, 120); });

function shortLabel(code, segCount) {
  if (segCount < 2) return code;
  return /L$/.test(code) ? 'Lab' : code.replace(/^[A-Z]+ A/, '');
}
function coversFor(res, layer) {
  layer.innerHTML = '';
  const cat = res.cat; if (!cat) return;
  cat.boxes.forEach((b, bi) => {
    const r = res.result[bi];
    if (!r) return;
    const cv = el('div', { class: 'cover', style: { left: (b.x / cat.width * 100) + '%', top: (b.y / cat.height * 100) + '%', width: (b.w / cat.width * 100) + '%', height: (b.h / cat.height * 100) + '%' } });
    const tips = [];
    for (const s of r.segs) {
      if (!s.entry) { cv.append(el('div', { class: 'seg empty' })); tips.push(`${s.code}: not scheduled`); continue; }
      const e = s.entry;
      const seg = el('div', { class: 'seg ' + e.status }, el('span', { class: 't' }, e.term));
      if (r.te || r.segs.length > 1 || e.code !== normCode(s.code)) seg.append(el('span', { class: 'c' }, r.te ? e.code : shortLabel(e.code, r.segs.length)));
      cv.append(seg);
      tips.push(`${e.code}${e.course ? ' ' + e.course.name : ''}: ${e.term}, ${e.wrong ? 'wrong semester' : e.status === 'done' ? 'completed' : e.status === 'ip' ? 'in progress' : 'planned'}`);
    }
    if (r.asTE) { cv.append(el('span', { class: 'tag' }, RU().electiveShort)); tips.push('Counts as ' + electiveOne()); }
    if (r.te && r.why) tips.push(RU().electiveLabel + ': ' + r.why);
    cv.title = tips.join('\n');
    layer.append(cv);
  });
}
function renderSummary(res, target) {
  target.innerHTML = '';
  const nDisc = Object.keys(res.counted).length;
  const discChips = res.discNames.map(n => el('span', { class: 'chip' + (res.counted[n] ? ' on' : '') }, n + (res.counted[n] ? ` · ${res.counted[n].entry.code.replace(/ A(\d)/, ' $1')}` : '')));
  const teChips = [];
  for (let i = 0; i < res.teSlots; i++) {
    const p = res.teAssigned[i];
    teChips.push(el('span', { class: 'chip' + (p ? ' te' : '') }, `${RU().electiveShort}${i + 1}: ` + (p ? `${p.entry.code} (${p.entry.term})${p.why ? ', ' + p.why : ''}` : 'open')));
  }
  const need = Math.min(pickN(), res.discNames.length);
  target.append(el('h3', null, 'Requirement summary'),
    res.discNames.length ? el('div', { class: 'sum-row' }, el('b', null, `${RU().groupLabel} (${need} of ${res.discNames.length})`), el('span', { class: 'cnt ' + (nDisc >= need ? 'ok' : 'bad') }, `${nDisc} of ${need}`), el('span', null, discChips)) : null,
    res.teSlots ? el('div', { class: 'sum-row' }, el('b', null, RU().electiveLabel), el('span', { class: 'cnt ' + (res.teAssigned.length >= res.teSlots ? 'ok' : 'bad') }, `${res.teAssigned.length} of ${res.teSlots}`), el('span', null, teChips)) : null,
    el('div', { class: 'sum-row' }, el('b', null, 'Total credits planned'), el('span', { class: 'cnt' }, String(res.credits))));
  if (res.warnings.length) target.append(el('ul', { class: 'warnings' }, res.warnings.map(w => el('li', { class: w.kind }, w.text))));
}

/* ---------- Update cycle ---------- */
let lastRes = null;
function update() {
  const res = compute();
  lastRes = res;
  const byPos = {};
  for (const e of res.entries) byPos[`${e.yi}-${e.t}-${e.ri}`] = e;
  plan.years.forEach((y, yi) => TERMS.forEach(t => {
    let sum = 0;
    y[t].forEach((r, ri) => {
      const code = normCode(r.code);
      const c = code ? course(code) : null;
      if (c) sum += Number(c.credits) || 0;
      const k = `${yi}-${t}-${ri}`, e = byPos[k];
      const nm = document.getElementById('nm-' + k);
      if (!nm) return;
      const cr = document.getElementById('cr-' + k), yr = document.getElementById('yr-' + k), dn = document.getElementById('dn-' + k);
      nm.textContent = code ? (c ? c.name : 'Not in course list') : '';
      nm.classList.toggle('unknown', !!code && !c);
      nm.title = nm.textContent;
      cr.textContent = c ? c.credits : '';
      yr.textContent = termCode(yi, t);
      yr.className = 'c-yr' + (e ? ' ' + e.status : '');
      yr.title = e && e.wrong ? 'Not offered this semester' : '';
      dn.classList.toggle('x', statusOf(r.done) === 'done' && !!code);
    });
    const tot = document.getElementById(`tot-${yi}-${t}`);
    if (tot) tot.textContent = sum;
  }));
  coversFor(res, coverLayer);
  renderSummary(res, summary);
  saveAuto();
  setPlanDirty(planDirty);
  return res;
}
function applyToggles() {
  chkCovers.checked = plan.showCovers !== false;
  stage.classList.toggle('covers-off', plan.showCovers === false);
}

/* ---------- Full-size chart viewer ---------- */
function showFullChart(catKey, outlines) {
  const cat = DATA.catalogs[catKey]; if (!cat) return;
  const prev = document.activeElement;
  const back = el('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Full flow chart' });
  const vstage = el('div', { class: 'chart-stage viewer-stage' + (!outlines && plan.showCovers === false ? ' covers-off' : '') });
  const layer = el('div');
  vstage.append(el('img', { src: cat.image, alt: 'Flow chart ' + cat.label }), layer);
  if (outlines) cat.boxes.forEach(b => layer.append(el('div', { class: 'ebox static' + (b.te ? ' te' : ''), style: { left: (b.x / cat.width * 100) + '%', top: (b.y / cat.height * 100) + '%', width: (b.w / cat.width * 100) + '%', height: (b.h / cat.height * 100) + '%' } })));
  else if (catKey === plan.catalog) coversFor(lastRes || compute(), layer);
  const scroller = el('div', { class: 'viewer-body' }, vstage);
  let mode = 'fit', zoom = 1;
  const pctLbl = el('span', { class: 'viewer-zoom' });
  function layout() {
    const availW = scroller.clientWidth - 32, availH = scroller.clientHeight - 32;
    const w = mode === 'fit' ? Math.min(availW, availH * cat.width / cat.height) : cat.width * zoom;
    vstage.style.width = Math.round(w) + 'px';
    vstage.style.setProperty('--u', (w / cat.width) + 'px');
    pctLbl.textContent = Math.round(w / cat.width * 100) + '%';
  }
  const setZoom = z => { mode = 'zoom'; zoom = Math.min(4, Math.max(0.4, z)); layout(); };
  const cur = () => vstage.clientWidth / cat.width;
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', layout); if (prev && prev.focus) prev.focus(); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === '+' || e.key === '=') setZoom(cur() * 1.25); else if (e.key === '-') setZoom(cur() / 1.25); };
  const covChk = el('input', { type: 'checkbox', checked: !vstage.classList.contains('covers-off'), onchange: () => vstage.classList.toggle('covers-off', !covChk.checked) });
  const closeBtn = el('button', { class: 'primary', onclick: close }, 'Close');
  back.append(el('div', { class: 'viewer-bar' },
    el('b', null, `Flow chart · ${cat.label}`),
    el('span', { class: 'spacer' }),
    outlines ? null : el('label', null, covChk, 'Colored boxes'),
    el('button', { onclick: () => setZoom(cur() / 1.25), 'aria-label': 'Zoom out' }, '−'), pctLbl,
    el('button', { onclick: () => setZoom(cur() * 1.25), 'aria-label': 'Zoom in' }, '+'),
    el('button', { onclick: () => { mode = 'fit'; layout(); } }, 'Fit to screen'),
    el('button', { onclick: () => setZoom(1) }, 'Actual size'),
    closeBtn), scroller);
  document.body.append(back);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', layout);
  layout(); closeBtn.focus();
}

/* ---------- Print ---------- */
function buildPrintView() {
  const res = lastRes || compute();
  const cat = res.cat;
  printView.innerHTML = '';
  const info = el('div', { class: 'pv-info' },
    el('span', null, el('b', null, 'Name: '), plan.name || ''), el('span', null, el('b', null, 'ID: '), plan.id || ''),
    el('span', null, el('b', null, 'Advisor: '), plan.advisor || ''), el('span', null, el('b', null, 'Catalog: '), `${plan.catalog}${cat ? ' (' + cat.label + ')' : ''}`),
    el('span', null, el('b', null, 'Date: '), plan.date || ''));
  // Page 1: the whole flow chart.
  if (cat) {
    const st = el('div', { class: 'pv-stage' + (plan.showCovers === false ? ' covers-off' : '') });
    st.style.setProperty('--u', (7.1 * 96 / cat.width) + 'px');
    const layer = el('div');
    st.append(el('img', { src: cat.image, alt: '' }), layer);
    coversFor(res, layer);
    printView.append(el('section', { class: 'pv-chart' }, info.cloneNode(true), st, legendHTML()));
  }
  // Page 2: the semester plan, only the rows and years in use.
  const summerHas = y => y.summer.some(r => (r.code || '').trim());
  const usedSummer = plan.years.some(summerHas);
  let lastYear = -1;
  plan.years.forEach((y, yi) => { if (yearHasData(y)) lastYear = yi; });
  const grid = el('section', { class: 'pv-grid' + (usedSummer ? ' land' : '') });
  grid.append(el('div', { class: 'pv-title' }, el('b', null, `${PG().university} · ${PG().college}`), el('div', null, PG().formTitle)), info);
  const byPos = {};
  for (const e of res.entries) byPos[`${e.yi}-${e.t}-${e.ri}`] = e;
  for (let yi = 0; yi <= Math.max(lastYear, 0); yi++) {
    const y = plan.years[yi];
    const terms = summerHas(y) ? TERMS : ['fall', 'spring'];
    let rows = 0;
    terms.forEach(t => y[t].forEach((r, ri) => { if ((r.code || '').trim()) rows = Math.max(rows, ri + 1); }));
    rows = Math.max(rows, 1);
    const tbl = el('table', { class: 'pv-year' });
    const pcg = el('colgroup');
    const nmW = usedSummer ? 1.2 : 1.65;
    terms.forEach((t, ti) => { if (ti) pcg.append(el('col', { style: { width: '.12in' } })); [.8, nmW, .35, .45, .45].forEach(w => pcg.append(el('col', { style: { width: w + 'in' } }))); });
    tbl.append(pcg);
    const termIn = .8 + nmW + .35 + .45 + .45;
    tbl.style.width = (terms.length * termIn + (terms.length - 1) * .12).toFixed(2) + 'in';
    const hr = el('tr'), ch = el('tr', { class: 'pv-ch' });
    terms.forEach((t, ti) => {
      if (ti) { hr.append(el('th', { class: 'gap' })); ch.append(el('th', { class: 'gap' })); }
      hr.append(el('th', { colspan: 5, class: 'pv-term' }, `${TERM_NAME[t]} Semester: ${Number(plan.startYear) + yi + (t === 'fall' ? 0 : 1)}`));
      ch.append(el('th', null, 'Class'), el('th', null, 'Course'), el('th', null, 'Cr'), el('th', null, 'Done'), el('th', null, 'Term'));
    });
    tbl.append(hr, ch);
    for (let ri = 0; ri < rows; ri++) {
      const tr = el('tr');
      terms.forEach((t, ti) => {
        if (ti) tr.append(el('td', { class: 'gap' }));
        const r = y[t][ri] || blankRow(), code = normCode(r.code), c = code ? course(code) : null, e = byPos[`${yi}-${t}-${ri}`];
        tr.append(el('td', null, code), el('td', { class: 'nm' }, code ? (c ? c.name : 'Not in course list') : ''), el('td', { class: 'n' }, c ? c.credits : ''),
          el('td', { class: 'n' }, code ? String(r.done || '').toUpperCase() : ''), el('td', { class: 'n ' + (e ? e.status : '') }, code ? termCode(yi, t) : ''));
      });
      tbl.append(tr);
    }
    const tot = el('tr', { class: 'pv-tot' });
    terms.forEach((t, ti) => {
      if (ti) tot.append(el('td', { class: 'gap' }));
      const s = y[t].reduce((a, r) => { const c = normCode(r.code) && course(normCode(r.code)); return a + (c ? Number(c.credits) || 0 : 0); }, 0);
      tot.append(el('td', { colspan: 2, class: 'r' }, 'Total credits'), el('td', { class: 'n' }, s), el('td', { colspan: 2 }));
    });
    tbl.append(tot);
    grid.append(tbl);
  }
  const sum = el('div', { class: 'summary pv-summary' });
  renderSummary(res, sum);
  grid.append(sum);
  printView.append(grid);
}
function printPlan() { buildPrintView(); window.print(); }
window.addEventListener('beforeprint', buildPrintView);

/* ---------- Saving ---------- */
// Saving makes a new copy of this tool with the plan built in. Each save is a new file, so earlier versions are kept.
function planPayload() {
  return { kind: 'bsce-degree-plan', schema: 1, savedWith: DATA.toolVersion, savedAt: new Date().toISOString(), plan };
}
function saveAuto() {
  if (EDITOR || EMBED) return;
  store(false, JSON.stringify({ kind: 'bsce-degree-plan', schema: 1, plan, dirty: planDirty }));
}
function defaultFileName() {
  const who = (plan.name || 'Student').trim().split(/\s+/).pop().replace(/[^A-Za-z0-9_-]/g, '') || 'Student';
  const d = new Date(), hm = String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  return `${who}_${plan.catalog}_DegreePlan_${today()}_${hm}`;
}
async function savePlanFile() {
  const nameIn = el('input', { type: 'text', value: defaultFileName(), class: 'dlg-input', 'aria-label': 'File name' });
  const v = await dialog({ icon: 'warn', title: 'Save plan', focus: nameIn,
    body: [el('p', null, 'This saves a copy of the degree plan with your plan inside. Double-click the file to open it again. Each save makes a new file, so earlier versions are kept.'),
      el('p', { class: 'note-warn' }, 'The file includes your name and student ID. Only share it with your advisor.'),
      el('label', { class: 'dlg-label' }, 'File name'), el('div', { class: 'dlg-file' }, nameIn, el('span', null, '.html'))],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Save', value: true, primary: true }] });
  if (!v) return false;
  const fname = (nameIn.value.trim() || defaultFileName()).replace(/[\\/:*?"<>|]+/g, '-').replace(/\.html?$/i, '') + '.html';
  download(fname, buildFile(false, planPayload()), 'text/html');
  setPlanDirty(false);
  if (!EDITOR && !EMBED) store(false, null); // the plan now lives in its own file; the blank template stays blank
  banner('Saved ' + fname + ' to your Downloads folder.');
  return true;
}
// Read a plan from a saved plan file (.html) or an older plan file (.json).
function readPlanText(text) {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const n = doc.getElementById('dp-plan');
  if (n) return JSON.parse(n.textContent);
  if (doc.getElementById('dp-data')) throw new Error('That file is a blank template, not a saved plan.');
  throw new Error('This is not a degree plan file.');
}
function loadPlanObject(obj, quiet, dirty) {
  const p = obj && obj.plan;
  if (!p || obj.kind !== 'bsce-degree-plan' || !Array.isArray(p.years)) throw new Error('This is not a degree plan file.');
  const base = emptyPlan(p.catalog);
  plan = Object.assign(base, p);
  plan.years = p.years.map(y => { const o = {}; TERMS.forEach(t => { o[t] = (y[t] || []).map(r => ({ code: r.code || '', done: r.done || '' })); }); const n = Math.max(1, ...TERMS.map(t => o[t].length)); TERMS.forEach(t => { while (o[t].length < n) o[t].push(blankRow()); }); return o; });
  if (!plan.years.length) plan.years = emptyPlan().years;
  // Summer is per year: on when the year says so, or when it already has summer courses (older plan files).
  plan.years.forEach((y, i) => { const src = p.years[i] || {}; y.hasSummer = !!src.hasSummer || y.summer.some(r => (r.code || '').trim()); });
  delete plan.showSummer;
  if (!DATA.catalogs[plan.catalog] && !quiet) banner(`This plan uses catalog ${plan.catalog}, which this file doesn't include. Showing it without a flow chart.`, true);
  planDirty = !!dirty;
  renderAll();
}
function openPlanFile() {
  const f = fileInput.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const obj = readPlanText(rd.result);
      loadPlanObject(obj); setPlanDirty(true);
      banner(`Opened ${f.name}` + (obj.savedWith && obj.savedWith !== DATA.toolVersion ? ` (saved with version ${obj.savedWith}; it now uses version ${DATA.toolVersion}).` : '.') + ' Save to keep it in this version.');
    }
    catch (e) { dialog({ icon: 'warn', title: "Couldn't open that file", body: esc(e.message), buttons: [{ label: 'OK', value: true, primary: true }] }); }
    fileInput.value = '';
  };
  rd.readAsText(f);
}
async function newPlan() {
  if (hasData()) {
    if (planDirty) { if (!await guardUnsaved('start a new plan')) return; }
    else {
      const ok = await dialog({ icon: 'warn', title: 'Start a new plan?', body: 'This clears every course and the name, ID and advisor fields. Your saved plan file is not affected.',
        buttons: [{ label: 'Cancel', value: false }, { label: 'Start new plan', value: true, danger: true, focus: true }] });
      if (!ok) return;
    }
  }
  plan = emptyPlan(plan.catalog); planDirty = false; renderAll(); banner('Started a new plan.');
}
function renderAll() {
  renderHeader(); renderGrid(); renderChart(); applyToggles(); update();
}

/* ---------- Editor (only in the editor file) ---------- */
let edCat = null, edSel = -1, edAdding = false;
const edStage = el('div', { class: 'ed-stage' });
const edImg = el('img', { alt: 'Flow chart being edited' });
const edLayer = el('div');
edStage.append(edImg, edLayer);
const boxPanel = el('div', { class: 'panel ed-boxpanel' });
const yearCard = el('div', { class: 'step-body' });
// Box search: highlights matching boxes; clicking any box or the chart clears it.
const boxSearchCount = el('span', { class: 'note box-search-count' });
const boxSearch = el('input', { type: 'search', class: 'box-search', placeholder: 'Find a box, e.g. CE 461, CHEM, SS, TE', 'aria-label': 'Find a box on the chart', autocomplete: 'off',
  oninput: () => applyBoxSearch(true), onkeydown: e => { if (e.key === 'Escape') { clearBoxSearch(); e.preventDefault(); } } });
function applyBoxSearch(scroll) {
  const q = boxSearch.value.trim().toUpperCase();
  const boxes = [...edLayer.querySelectorAll('.ebox')];
  boxes.forEach(n => n.classList.remove('hit'));
  edStage.classList.toggle('searching', !!q);
  if (!q) { boxSearchCount.textContent = ''; return; }
  const tries = [...new Set([q, normCode(q)])].map(t => t.replace(/\s+/g, ''));
  const hits = boxes.filter(n => { const lab = (n.title || '').toUpperCase().replace(/\s+/g, ''); return tries.some(t => lab.includes(t)); });
  hits.forEach(n => n.classList.add('hit'));
  boxSearchCount.textContent = hits.length ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}` : 'No matching boxes';
  if (scroll && hits[0]) hits[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}
function clearBoxSearch() { if (boxSearch.value) { boxSearch.value = ''; applyBoxSearch(false); } }
const discCard = el('div', { class: 'step-body' });

function markDirty() {
  editorDirty = true;
  document.querySelectorAll('.dirty-note').forEach(d => { d.textContent = 'Unsaved changes'; d.classList.add('unsaved'); });
}
// editor = the editor copy; planObj = a student's plan to build in (a saved plan file). Neither = the blank template.
function buildFile(editor, planObj) {
  const data = planObj ? DATA : Object.assign({}, DATA, { updated: today() });
  const json = JSON.stringify(data).replace(/<\//g, '<\\/');
  const sn = String(PG().short).replace(/[<>&]/g, '');
  const title = editor ? `${sn} Degree Plan Editor` : planObj ? `${String(planObj.plan.name || 'Student').replace(/[<>&]/g, '')} · ${sn} Degree Plan` : `${sn} Degree Plan Template`;
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${title}</title><style id="dp-css">${CSS_TEXT}${ST}</head><body>` +
    `<script type="application/json" id="dp-mode">${JSON.stringify({ editor: !!editor })}${SC}` +
    `<script type="application/json" id="dp-data">${json}${SC}` +
    (planObj ? `<script type="application/json" id="dp-plan">${JSON.stringify(planObj).replace(/<\//g, '<\\/')}${SC}` : '') +
    `<script id="dp-app">${APP_TEXT}${SC}</body></html>`;
}
function exportFiles(which) {
  const stamp = today().replace(/-/g, '.');
  if (which !== 'editor') download(`${shortName()}_DegreePlan_TEMPLATE_v${DATA.toolVersion}_${stamp}.html`, buildFile(false), 'text/html');
  if (which !== 'advisor') download(`${shortName()}_DegreePlan_EDITOR_v${DATA.toolVersion}_${stamp}.html`, buildFile(true), 'text/html');
  if (which === 'advisor') { banner('Template downloaded. Also download the editor file so your changes are there next time.'); return; }
  editorDirty = false;
  document.querySelectorAll('.dirty-note').forEach(d => { d.textContent = 'All changes downloaded'; d.classList.remove('unsaved'); });
}
function step(n, title, sub) {
  return el('div', { class: 'step-head' }, el('span', { class: 'step-n' }, String(n)), el('div', null, el('h2', null, title), sub ? el('p', null, sub) : null));
}

/* Rich-text editing for the student Directions */
function sanitizeHTML(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button').forEach(n => n.remove());
  t.content.querySelectorAll('*').forEach(n => {
    [...n.attributes].forEach(a => {
      const v = a.value.trim().toLowerCase();
      if (/^on/i.test(a.name) || a.name === 'style' || a.name === 'class' || a.name === 'id' || ((a.name === 'href' || a.name === 'src') && v.startsWith('javascript:'))) n.removeAttribute(a.name);
    });
    if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener'); }
  });
  return t.innerHTML;
}

const MANUAL = `
<h1>Editor manual</h1>
<p class="lead">This editor keeps the degree plan tool up to date: catalog years, flow chart boxes, the course list, the elective rules, and the Directions students see. Nothing is uploaded anywhere. Your changes are saved by downloading new files.</p>
<nav class="toc"><b>Contents</b>
<a href="#m-files">1. The files</a><a href="#m-tabs">2. The editor tabs</a><a href="#m-year">3. Add a new catalog year</a>
<a href="#m-boxes">4. Place and edit boxes</a><a href="#m-rules">5. What a box accepts</a><a href="#m-disc">6. Disciplines and technical electives</a>
<a href="#m-courses">7. Courses, offerings and old numbers</a><a href="#m-dirs">8. Edit the Directions</a><a href="#m-publish">9. Save and send out</a>
<a href="#m-logic">10. How the colors are decided</a><a href="#m-trouble">11. Troubleshooting</a></nav>

<h2 id="m-files">1. The files</h2>
<table class="mt"><tr><th>File</th><th>Who uses it</th><th>What it has</th></tr>
<tr><td><b>BSCE_DegreePlan_EDITOR_v…html</b> (editor)</td><td>You</td><td>The plan, plus the Flowcharts, Courses, Directions and Manual tabs.</td></tr>
<tr><td><b>BSCE_DegreePlan_TEMPLATE_v…html</b> (template)</td><td>Students and advisors</td><td>A blank plan. No editing tabs, so nobody can change the course data by accident.</td></tr>
<tr><td><b>Smith_2425_DegreePlan_…html</b> (saved plan)</td><td>A student and their advisor</td><td>A copy of the template with one student's plan inside. Double-click to open it.</td></tr></table>
<p>The flow: you download the <b>template</b> from the editor and send it out. A student fills it in and clicks <b>Save plan</b>, which makes their own plan file. They email that to their advisor, who opens it, makes changes, and saves again. Every save is a new file with the date and time in its name, so earlier versions are kept.</p>
<p>A web page can't save over itself, so your edits live in the open browser tab until you download them. After an editing session, download <b>both</b> the editor file (to keep) and the template (to send out). The top bar shows <b>Unsaved changes</b> until you download the editor file, and the browser warns you if you try to close the tab before that.</p>

<h2 id="m-tabs">2. The editor tabs</h2>
<ul>
<li><b>Flowcharts</b>: catalog years, disciplines, and the colored boxes for each chart. Work top to bottom.</li>
<li><b>Courses</b>: the course list (names, credits, Fall/Spring), the technical elective list, and old/new course numbers.</li>
<li><b>Directions</b>: the help text students see when they click Directions.</li>
<li><b>Manual</b>: this page.</li>
<li><b>Plan (student view)</b>: exactly what students see. Use it to test your changes with a sample plan before you send the file out.</li>
</ul>

<h2 id="m-year">3. Add a new catalog year</h2>
<ol>
<li>Export the new flow chart as a PNG or JPG. A larger image (1600 px wide or more) prints more sharply.</li>
<li>On <b>Flowcharts</b>, step 1, click <b>Add catalog year</b>.</li>
<li>Enter the 4-digit catalog code (for example <code>2728</code> for 2027–28), a label, and choose the image.</li>
<li>Choose <b>Copy boxes from</b> the most similar earlier year. The boxes are scaled to the new image, so most will already be close.</li>
<li>Check the <b>First Fall year</b>. It is the year students start in when they pick this catalog; they can still change it on their plan.</li>
<li>Check step 2, <b>Disciplines</b>, for this year.</li>
<li>In step 3, move any boxes that shifted, add boxes for new courses, and delete boxes for courses that were removed (see section 4).</li>
<li>Test it on the <b>Plan (student view)</b> tab, then download both files (section 9).</li>
</ol>
<p>To fix a chart image without redoing the boxes, use <b>Replace image</b> in step 1. Boxes are scaled to the new image size; check they still line up.</p>

<h2 id="m-boxes">4. Place and edit boxes</h2>
<ul>
<li><b>Find</b> a box by typing in the search field above the chart (for example <code>CE 461</code>, <code>CHEM</code> or <code>TE</code>). Matching boxes are highlighted; clicking any box clears the search.</li>
<li><b>Select</b> a box by clicking it. Its settings appear in the panel to the right of the chart.</li>
<li><b>Move</b>: drag the box. <b>Resize</b>: drag the orange square at its bottom-right corner.</li>
<li><b>Nudge</b>: arrow keys move the selected box 1 pixel; hold Shift for 10.</li>
<li><b>Add</b>: click <b>Draw new box</b>, then drag a rectangle on the chart. Fill in what the box accepts.</li>
<li><b>Duplicate</b> makes a copy next to the selected box. Handy for a row of similar boxes.</li>
<li><b>Delete box</b>, or press Delete, removes it.</li>
<li>Click <b>View full chart</b> to check the result at a large size.</li>
</ul>
<p>Make each box cover the course box on the chart, including its border. Blue outlines are course boxes; purple ones are technical elective slots.</p>

<h2 id="m-rules">5. What a box accepts</h2>
<p>Each course box has a line of course numbers that cover it. Two symbols control it:</p>
<table class="mt"><tr><th>You type</th><th>Meaning</th><th>On the chart</th></tr>
<tr><td><code>ES A331</code></td><td>One course</td><td>Whole box colors when it is scheduled</td></tr>
<tr><td><code>CHEM A105 + CHEM A105L</code></td><td><b>+</b> = both belong in this box</td><td>The box splits into two strips, one per course</td></tr>
<tr><td><code>HU1 | HU2</code></td><td><b>|</b> = any one of these</td><td>Colors with whichever one is scheduled</td></tr>
<tr><td><code>PHYS A212 + PHYS A212L | PHYS A214 + PHYS A214L</code></td><td>Either pair</td><td>Two strips for whichever pair matches best</td></tr>
<tr><td><code>FA | ART A160</code></td><td>A code or a real course</td><td>Either one colors the Fine Arts box</td></tr></table>
<p>Codes you can use: <b>FA, HU1, HU2, SS1, SS2, BS, AKNS, TE1, TE2</b>. Course numbers are written like <code>CE A432</code>; the tool also accepts <code>CE 432</code>.</p>
<p>A <b>Technical elective slot</b> is a different kind of box: it doesn't name a course. Slots fill in order (slot 1 first) with the student's technical electives, in the order they are scheduled.</p>

<h2 id="m-disc">6. Disciplines and technical electives</h2>
<p>In step 2 of Flowcharts, each discipline has a name and the course numbers in it (Structural has two: <code>CE A432, CE A433</code>). The rules students see:</p>
<ul>
<li>One course in each of <b>4 of the 5</b> disciplines.</li>
<li>If a student takes all five, the <b>latest-scheduled</b> discipline counts as a technical elective instead.</li>
<li>If a student takes two courses in one discipline (CE 432 and CE 433), the <b>later</b> one counts as a technical elective.</li>
<li>Boxes that count as technical electives get a small <b>TE</b> tag.</li>
</ul>
<p>The technical elective slots are then filled, in term order, from: courses ticked <b>TE approved</b> on the Courses tab, the TE1/TE2 codes, and the overflow above. A 300-level or higher CE, ES, ESM, AE or ENGR course that isn't on the list still fills a slot, with a "check with your advisor" warning. More electives than slots are listed as extra in the summary.</p>

<h2 id="m-courses">7. Courses, offerings and old numbers</h2>
<ul>
<li><b>Add course</b>: type the number and click Add course, then fill in the name and credits.</li>
<li><b>Offered</b>: set Fall only or Spring only to turn a box <b>black</b> when a student puts it in the wrong term. Leave Fall &amp; Spring when it doesn't matter.</li>
<li><b>TE approved</b>: tick to put a course on the technical elective list.</li>
<li><b>Equivalent course numbers</b>: one group per line, like <code>CE A410 = CE A422</code>. The first number is the one used on the chart; the others count for the same box. Use this when a course is renumbered.</li>
<li>The course list is shared by every catalog year.</li>
</ul>

<h2 id="m-dirs">8. Edit the Directions</h2>
<p>The <b>Directions</b> tab is a small word processor. Use the buttons for headings, bold, lists and links. <b>Preview</b> shows the pop-up exactly as students see it. <b>Reset to default</b> brings back the original text.</p>

<h2 id="m-publish">9. Save and send out</h2>
<ol>
<li>Set the <b>Tool version</b> in the top bar (for example 7.1). It appears on the plan and in the file names.</li>
<li>Click <b>Download editor file</b> (or press <b>Ctrl+S</b> / <b>⌘S</b> on any editor tab) and keep it. This is your copy for next time.</li>
<li>Click <b>Download template</b>. Send it to students and advisors, or replace the copy on the department drive or website.</li>
<li>Delete or archive older versions so nobody uses an outdated chart.</li>
</ol>
<p>A saved plan file keeps the course data and charts of the template it was made from. To move an older plan onto a newer version, open the new template, click <b>Open plan</b>, pick the old plan file (.html, or an older .json), and save. A plan for a catalog year the newer template doesn't include opens without a chart.</p>
<p>The files, including each saved plan, are about 2–3 MB because the chart images are inside them. If an email system blocks .html attachments, zip the file or share it from a drive.</p>

<h2 id="m-logic">10. How the colors are decided</h2>
<ol>
<li>Each course a student enters gets a term code (F24, S25, R25 for summer) from the First Fall year.</li>
<li>Each box takes the matching courses. If the same course is entered twice, only the latest one counts, and the student sees a warning.</li>
<li>Color: <b>green</b> X (completed), <b>yellow</b> IP (in progress), <b>red</b> planned, <b>black</b> scheduled in a term it isn't offered.</li>
<li>Then the discipline and technical elective rules from section 6 run.</li>
<li>Courses that don't belong to any box are listed under the requirement summary as "Not on this flow chart".</li>
</ol>

<h2 id="m-trouble">11. Troubleshooting</h2>
<table class="mt"><tr><th>Problem</th><th>Fix</th></tr>
<tr><td>A course doesn't color its box</td><td>Check the box accepts that exact number (section 5), or add the old number as an equivalent (section 7).</td></tr>
<tr><td>"Not in course list"</td><td>Add the course on the Courses tab.</td></tr>
<tr><td>A box is black for no reason</td><td>Check the course's Offered setting on the Courses tab.</td></tr>
<tr><td>The colored cover is offset</td><td>Select the box in step 3 and drag or nudge it.</td></tr>
<tr><td>My changes are gone</td><td>They were not downloaded. Always download the editor file before closing.</td></tr>
<tr><td>Students can't open the file from email</td><td>Zip it, or share it from a drive or website.</td></tr></table>`;

function refreshStep2() {
  const s2 = sheets.flowcharts && sheets.flowcharts._step2; if (!s2) return;
  const h = s2.querySelector('.step-head h2'), p = s2.querySelector('.step-head p');
  h.textContent = RU().groupLabel;
  p.textContent = `Students take one course in ${pickN()} of these groups. An extra ${RU().groupItem}, or a second course in the same ${RU().groupItem}, counts as ${electiveOne()}. Remove all rows if your program has no such rule.`;
}
async function importCourses(after) {
  const ta = el('textarea', { class: 'dlg-input', rows: 10, placeholder: 'CE A101, Intro to Civil Engineering, 3, F\nCE A454, Timber Design, 3, , yes' });
  const ok = await dialog({ title: 'Import courses', wide: true, focus: ta,
    body: [el('p', null, 'Paste one course per line: number, name, credits, offered (F, S or blank), on elective list (yes or blank). Commas or tabs both work, so you can paste straight from a spreadsheet. Existing courses with the same number are updated.'), ta],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Import', value: true, primary: true }] });
  if (!ok) return;
  let n = 0;
  for (const line of ta.value.split(/\r?\n/)) {
    const parts = line.split(line.includes('\t') ? '\t' : ',').map(x => x.trim());
    const code = normCode(parts[0]); if (!code) continue;
    const c = DATA.courses[code] || (DATA.courses[code] = {});
    c.name = parts[1] || c.name || ''; c.credits = Number(parts[2]) || c.credits || 0;
    const off = (parts[3] || '').toUpperCase(); c.offered = off === 'F' || off === 'S' ? off : '';
    if (/^(y|yes|x|true|1)$/i.test(parts[4] || '')) c.te = true;
    n++;
  }
  markDirty(); fillDatalist(); after(); update();
  banner(`Imported ${n} course${n === 1 ? '' : 's'}.`);
}
function setupEditor() {
  window.addEventListener('beforeunload', e => { if (editorDirty) { e.preventDefault(); e.returnValue = ''; } });

  /* Editor top bar (shown on every tab except the student Plan view) */
  edBar.append(
    el('div', { class: 'brand' }, el('b', null, `${PG().short} Degree Plan`), el('span', null, 'Editor')),
    el('span', { class: 'sep' }),
    el('button', { class: 'primary', onclick: () => exportFiles('advisor'), title: 'The blank template you send to students and advisors' }, 'Download template'),
    el('button', { onclick: () => exportFiles('editor'), title: 'Your copy of the editor, with these changes, for next time' }, 'Download editor file'),
    el('span', { class: 'sep' }),
    el('label', null, 'Tool version', el('input', { type: 'text', value: DATA.toolVersion, size: 5, class: 'ver-input', oninput: e => { DATA.toolVersion = e.target.value; markDirty(); } })),
    el('span', { class: 'save-state dirty-note' }, 'No changes yet'),
    el('span', { class: 'spacer' }),
    el('button', { onclick: () => showSheet('manual') }, 'Manual'));

  /* Flowcharts sheet: 1 catalog year, 2 disciplines, 3 boxes */
  const fs = addSheet('flowcharts', 'Flowcharts');
  const addBtn = el('button', { class: 'draw-btn', onclick: () => { edAdding = !edAdding; addBtn.classList.toggle('primary', edAdding); edStage.classList.toggle('adding', edAdding); } }, 'Draw new box');
  fs._addBtn = addBtn;
  fs.append(el('div', { class: 'ed-page' },
    el('section', { class: 'step' }, step(1, 'Catalog year', 'Pick the year to work on, or add a new one. Everything below applies to this year.'), yearCard),
    fs._step2 = el('section', { class: 'step' }, step(2, RU().groupLabel, ' '), discCard),
    el('section', { class: 'step' }, step(3, 'Boxes on the flow chart', 'Each box is where a colored cover appears. Click a box to edit it; drag to move; drag the orange corner to resize; arrow keys nudge (Shift = 10 px).'),
      el('div', { class: 'toolbar' }, boxSearch, boxSearchCount, el('span', { class: 'sep' }), addBtn, el('button', { onclick: () => showFullChart(edCat, true) }, 'View full chart'),
        el('span', { class: 'note' }, el('i', { class: 'key-swatch blue' }), 'course box', el('i', { class: 'key-swatch purple' }), electiveOne() + ' slot')),
      el('div', { class: 'ed-layout' }, el('div', { class: 'ed-stage-wrap' }, edStage), boxPanel))));

  refreshStep2();

  /* Program sheet: names shown on the form, and the rule settings */
  const ps = addSheet('program', 'Program');
  const pf = (label, get, set, hint, type) => {
    const inp = el('input', { type: type || 'text', value: get(), oninput: e => { set(e.target.value); markDirty(); renderHeader(); refreshStep2(); update(); } });
    return el('label', { class: 'pf' }, el('span', null, label), inp, hint ? el('small', null, hint) : null);
  };
  ps.append(el('div', { class: 'ed-page' },
    el('section', { class: 'step' }, step('P', 'Program names', 'Shown at the top of every plan, on printouts, in the top bar and in file names.'),
      el('div', { class: 'pf-grid' },
        pf('University', () => PG().university, v => PG().university = v, 'First line of the form header'),
        pf('College', () => PG().college, v => PG().college = v, 'Second line'),
        pf('Form title', () => PG().formTitle, v => PG().formTitle = v, 'Third line, e.g. Civil Engineering - Degree Plan Form'),
        pf('Degree', () => PG().degree, v => PG().degree = v, 'Full degree name'),
        pf('Short name', () => PG().short, v => PG().short = v, 'Used in the top bar and file names, e.g. BSCE'))),
    el('section', { class: 'step' }, step('R', 'Requirement rules', 'Names and numbers for the two built-in rules. Leave the groups empty (Flowcharts, step 2) or add no elective slots if your program doesn\'t use one.'),
      el('div', { class: 'pf-grid' },
        pf('Group rule name', () => RU().groupLabel, v => RU().groupLabel = v, 'e.g. Disciplines, Tracks, Concentrations'),
        pf('One group is called a', () => RU().groupItem, v => RU().groupItem = v, 'e.g. discipline, track'),
        pf('Students must pick', () => RU().groupPick, v => RU().groupPick = Number(v) || 0, 'How many groups count; extras become electives', 'number'),
        pf('Elective pool name', () => RU().electiveLabel, v => RU().electiveLabel = v, 'e.g. Technical electives, Free electives'),
        pf('Elective code', () => RU().electiveShort, v => RU().electiveShort = v, 'Short label on boxes and slots, e.g. TE'),
        pf('Departments for unlisted electives', () => (RU().electiveDepts || []).join(', '), v => RU().electiveDepts = v.split(',').map(x => x.trim().toUpperCase()).filter(Boolean), 'Upper-level courses from these departments still fill a slot, with a warning'),
        pf('Lowest level for unlisted electives', () => RU().electiveMinLevel, v => RU().electiveMinLevel = Number(v) || 3, '3 = 300-level and up', 'number')))));

  /* Courses sheet */
  const cs = addSheet('courses', 'Courses');
  const filter = el('input', { type: 'search', placeholder: 'Filter courses…', oninput: () => renderCourses() });
  const newCode = el('input', { type: 'text', placeholder: 'New course number, e.g. CE A455' });
  const tbody = el('tbody');
  const eqArea = el('textarea', { rows: 8, oninput: () => { DATA.equivalents = eqArea.value.split('\n').map(l => l.split('=').map(normCode).filter(Boolean)).filter(g => g.length > 1); rebuildCanon(); markDirty(); update(); } });
  cs.append(el('div', { class: 'ed-page' },
    el('section', { class: 'step' }, step('A', 'Course list', `Shared by every catalog year. Offered sets the black wrong-semester check; "On elective list" puts a course on the ${electiveOne()} list.`),
      el('div', { class: 'toolbar' }, filter, newCode, el('button', { onclick: () => {
        const c = normCode(newCode.value); if (!c) return;
        if (DATA.courses[c]) { banner(c + ' is already in the list.', true); return; }
        DATA.courses[c] = { name: '', offered: '', credits: 3 }; newCode.value = ''; markDirty(); fillDatalist(); filter.value = c; renderCourses();
      } }, 'Add course'), el('span', { class: 'sep' }),
      el('button', { onclick: () => importCourses(renderCourses) }, 'Import courses…'),
      el('button', { class: 'quiet', onclick: async () => {
        const ok = await dialog({ icon: 'warn', title: 'Remove every course?', body: `All ${Object.keys(DATA.courses).length} courses will be removed. Use this when starting a different program, then import your own list.`, buttons: [{ label: 'Cancel', value: false }, { label: 'Remove all', value: true, danger: true, focus: true }] });
        if (ok) { DATA.courses = {}; markDirty(); fillDatalist(); renderCourses(); update(); }
      } }, 'Remove all')),
      el('table', { class: 'courses' }, el('thead', null, el('tr', null, el('th', null, 'Course'), el('th', null, 'Name'), el('th', null, 'Offered'), el('th', null, 'Credits'), el('th', null, 'On elective list'), el('th', null, ''))), tbody)),
    el('section', { class: 'step' }, step('B', 'Equivalent course numbers', 'One group per line, separated by "=". The first number is the one the flow chart uses; older numbers count for the same box. Example: CE A410 = CE A422'), eqArea)));
  eqArea.value = (DATA.equivalents || []).map(g => g.join(' = ')).join('\n');
  function renderCourses() {
    tbody.innerHTML = '';
    const q = filter.value.trim().toUpperCase();
    for (const k of Object.keys(DATA.courses).sort()) {
      const c = DATA.courses[k];
      if (q && !k.includes(q) && !(c.name || '').toUpperCase().includes(q)) continue;
      const off = el('select', { onchange: () => { c.offered = off.value; markDirty(); update(); } }, el('option', { value: '' }, 'Fall & Spring'), el('option', { value: 'F' }, 'Fall only'), el('option', { value: 'S' }, 'Spring only'));
      off.value = c.offered || '';
      tbody.append(el('tr', null,
        el('td', null, k),
        el('td', null, el('input', { type: 'text', value: c.name || '', oninput: e => { c.name = e.target.value; markDirty(); update(); } })),
        el('td', null, off),
        el('td', null, el('input', { type: 'number', value: c.credits, min: 0, step: 1, style: { width: '60px' }, oninput: e => { c.credits = Number(e.target.value) || 0; markDirty(); update(); } })),
        el('td', { class: 'chk' }, el('input', { type: 'checkbox', checked: !!c.te, onchange: e => { if (e.target.checked) c.te = true; else delete c.te; markDirty(); update(); } })),
        el('td', null, el('button', { onclick: async () => {
          const ok = await dialog({ icon: 'warn', title: `Delete ${k}?`, body: 'Students who enter this course will see "Not in course list".', buttons: [{ label: 'Cancel', value: false }, { label: 'Delete', value: true, danger: true, focus: true }] });
          if (ok) { delete DATA.courses[k]; markDirty(); fillDatalist(); renderCourses(); update(); }
        } }, 'Delete'))));
    }
  }
  renderCourses();

  /* Directions sheet */
  const ds = addSheet('directions', 'Directions');
  const ed = el('div', { class: 'rte', contenteditable: 'true', spellcheck: 'true', 'aria-label': 'Directions text' });
  ed.innerHTML = DATA.directions || DIRECTIONS;
  const saveDirs = () => { DATA.directions = sanitizeHTML(ed.innerHTML); markDirty(); };
  ed.addEventListener('input', saveDirs);
  ed.addEventListener('paste', e => { e.preventDefault(); const txt = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, txt); });
  const cmd = (c, v) => () => { ed.focus(); document.execCommand(c, false, v || null); saveDirs(); };
  const tb = (label, title, fn) => el('button', { title, onmousedown: e => e.preventDefault(), onclick: fn }, label);
  ds.append(el('div', { class: 'ed-page' }, el('section', { class: 'step' },
    step('D', 'Student directions', 'This is the pop-up students see when they click Directions. Edit it like a document; changes go into the next advisor file you download.'),
    el('div', { class: 'rte-bar' },
      tb('Heading', 'Section heading', cmd('formatBlock', 'h3')), tb('Text', 'Normal paragraph', cmd('formatBlock', 'p')),
      el('span', { class: 'sep' }),
      tb('B', 'Bold', cmd('bold')), tb('I', 'Italic', cmd('italic')),
      tb('• List', 'Bulleted list', cmd('insertUnorderedList')), tb('1. List', 'Numbered list', cmd('insertOrderedList')),
      tb('Link', 'Add a link to the selected text', async () => {
        const sel = window.getSelection(); const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const inp = el('input', { type: 'text', class: 'dlg-input', placeholder: 'https://' });
        const ok = await dialog({ title: 'Add a link', body: [el('p', null, 'Select some text first, then paste the web address.'), inp], focus: inp, buttons: [{ label: 'Cancel', value: false }, { label: 'Add link', value: true, primary: true }] });
        if (ok && range && /^https?:\/\//i.test(inp.value.trim())) { ed.focus(); sel.removeAllRanges(); sel.addRange(range); document.execCommand('createLink', false, inp.value.trim()); saveDirs(); }
      }),
      tb('Clear formatting', 'Remove bold, italic and links from the selection', cmd('removeFormat')),
      el('span', { class: 'sep' }),
      tb('Undo', 'Undo', cmd('undo')), tb('Redo', 'Redo', cmd('redo')),
      el('span', { class: 'spacer' }),
      el('button', { onclick: showDirections }, 'Preview'),
      el('button', { class: 'quiet', onclick: async () => {
        const ok = await dialog({ icon: 'warn', title: 'Reset the directions?', body: 'This replaces your edited text with the original directions.', buttons: [{ label: 'Cancel', value: false }, { label: 'Reset', value: true, danger: true, focus: true }] });
        if (ok) { ed.innerHTML = DIRECTIONS; delete DATA.directions; markDirty(); }
      } }, 'Reset to default')),
    ed)));

  /* Manual sheet */
  const ms = addSheet('manual', 'Manual');
  const man = el('article', { class: 'manual', html: MANUAL });
  man.addEventListener('click', e => { const a = e.target.closest('a[href^="#"]'); if (a) { e.preventDefault(); const t = man.querySelector(a.getAttribute('href')); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + window.scrollY - 64, behavior: 'smooth' }); } });
  ms.append(el('div', { class: 'ed-page' }, man));

  // Tab order: editing tabs first, the student view last.
  tabsBar.prepend(tabsBar.querySelector('button[data-sheet="program"]'));
  const planTab = tabsBar.querySelector('button[data-sheet="plan"]');
  planTab.textContent = 'Plan (student view)';
  tabsBar.append(planTab);

  edStage.addEventListener('pointerdown', onStageDown);
  document.addEventListener('keydown', onEdKey);
  if (window.ResizeObserver) new ResizeObserver(sizeEd).observe(edStage);
}
function sizeEd() {
  const cat = DATA.catalogs[edCat];
  if (cat && edStage.clientWidth) edStage.style.setProperty('--u', (edStage.clientWidth / cat.width) + 'px');
}
function renderEditorStage() {
  if (!EDITOR) return;
  const keys = Object.keys(DATA.catalogs).sort();
  if (!edCat || !DATA.catalogs[edCat]) edCat = DATA.catalogs[plan.catalog] ? plan.catalog : keys[keys.length - 1];
  const cat = DATA.catalogs[edCat];
  if (edImg.getAttribute('src') !== cat.image) edImg.src = cat.image;
  edLayer.innerHTML = '';
  cat.boxes.forEach((b, i) => {
    const lab = b.te ? `${RU().electiveShort} slot ${b.te}` : reqText(b.req || []) || '(empty)';
    const d = el('div', { class: 'ebox' + (b.te ? ' te' : '') + (i === edSel ? ' sel' : ''), 'data-i': i, title: lab,
      style: { left: (b.x / cat.width * 100) + '%', top: (b.y / cat.height * 100) + '%', width: (b.w / cat.width * 100) + '%', height: (b.h / cat.height * 100) + '%' } },
      el('span', { class: 'lbl' }, lab), el('span', { class: 'h', 'data-h': '1' }));
    edLayer.append(d);
  });
  sizeEd();
  applyBoxSearch(false);
  renderBoxPanel(); renderDiscPanel(); renderYearPanel();
}
function stagePoint(ev) {
  const cat = DATA.catalogs[edCat], r = edStage.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width * cat.width, y: (ev.clientY - r.top) / r.height * cat.height };
}
function onStageDown(ev) {
  const cat = DATA.catalogs[edCat]; if (!cat) return;
  const p0 = stagePoint(ev);
  const boxEl = ev.target.closest('.ebox');
  clearBoxSearch();
  if (edAdding) {
    const rect = el('div', { class: 'draw-rect' }); edStage.append(rect);
    const move = e => { const p = stagePoint(e); const x = Math.min(p.x, p0.x), y = Math.min(p.y, p0.y), w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
      Object.assign(rect.style, { left: x / cat.width * 100 + '%', top: y / cat.height * 100 + '%', width: w / cat.width * 100 + '%', height: h / cat.height * 100 + '%' }); };
    const up = e => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); rect.remove();
      const p = stagePoint(e); const w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
      if (w > 8 && h > 8) { cat.boxes.push({ x: Math.round(Math.min(p.x, p0.x)), y: Math.round(Math.min(p.y, p0.y)), w: Math.round(w), h: Math.round(h), req: [] }); edSel = cat.boxes.length - 1; markDirty(); }
      edAdding = false; edStage.classList.remove('adding'); sheets.flowcharts._addBtn.classList.remove('primary');
      renderEditorStage(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
    ev.preventDefault(); return;
  }
  if (!boxEl) { edSel = -1; renderEditorStage(); return; }
  const i = Number(boxEl.dataset.i), b = cat.boxes[i], resize = !!ev.target.dataset.h;
  edSel = i;
  const start = { x: b.x, y: b.y, w: b.w, h: b.h };
  let moved = false;
  edLayer.querySelectorAll('.ebox').forEach(n => n.classList.toggle('sel', Number(n.dataset.i) === i));
  const move = e => {
    const p = stagePoint(e), dx = p.x - p0.x, dy = p.y - p0.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) moved = true;
    if (resize) { b.w = Math.max(10, Math.round(start.w + dx)); b.h = Math.max(10, Math.round(start.h + dy)); }
    else { b.x = Math.round(start.x + dx); b.y = Math.round(start.y + dy); }
    Object.assign(boxEl.style, { left: b.x / cat.width * 100 + '%', top: b.y / cat.height * 100 + '%', width: b.w / cat.width * 100 + '%', height: b.h / cat.height * 100 + '%' });
  };
  const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); if (moved) { markDirty(); if (edCat === plan.catalog) update(); } renderEditorStage(); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  ev.preventDefault();
}
function onEdKey(e) {
  if (!sheets.flowcharts || !sheets.flowcharts.classList.contains('active') || edSel < 0) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  const b = DATA.catalogs[edCat].boxes[edSel]; if (!b) return;
  const s = e.shiftKey ? 10 : 1, k = e.key;
  if (k === 'ArrowLeft') b.x -= s; else if (k === 'ArrowRight') b.x += s; else if (k === 'ArrowUp') b.y -= s; else if (k === 'ArrowDown') b.y += s;
  else if (k === 'Delete' || k === 'Backspace') { DATA.catalogs[edCat].boxes.splice(edSel, 1); edSel = -1; }
  else return;
  e.preventDefault(); markDirty(); renderEditorStage(); if (edCat === plan.catalog) update();
}
function renderBoxPanel() {
  boxPanel.innerHTML = '';
  const cat = DATA.catalogs[edCat], b = cat && cat.boxes[edSel];
  if (!b) {
    boxPanel.append(el('h3', null, 'Box settings'), el('p', { class: 'hint' }, 'Click a box on the chart to edit it, or click "Draw new box" and drag a rectangle.'),
      el('p', { class: 'hint' }, `${cat ? cat.boxes.length : 0} boxes on the ${cat ? cat.label : ''} chart.`));
    return;
  }
  const kind = el('select', { onchange: () => { if (kind.value === 'te') { b.te = Number(slot.value) || 1; delete b.req; } else { delete b.te; b.req = b.req || []; } markDirty(); renderEditorStage(); update(); } },
    el('option', { value: 'course' }, 'Course box'), el('option', { value: 'te' }, 'Elective slot (' + RU().electiveLabel + ')'));
  kind.value = b.te ? 'te' : 'course';
  const slot = el('input', { type: 'number', min: 1, max: 9, value: b.te || 1, oninput: () => { b.te = Number(slot.value) || 1; markDirty(); update(); renderEditorStage(); } });
  const req = el('input', { type: 'text', value: reqText(b.req || []), oninput: () => { b.req = parseReq(req.value); markDirty(); update(); }, onchange: () => renderEditorStage() });
  const names = (b.req || []).flat().map(c => { const k = course(normCode(c)); return `${c}${k ? ': ' + k.name : ' (not in course list)'}`; });
  boxPanel.append(el('h3', null, 'Box settings'), el('label', null, 'Type'), kind);
  if (b.te) boxPanel.append(el('label', null, 'Slot number'), slot, el('p', { class: 'hint' }, `Slot 1 gets the first ${electiveOne()} in term order, slot 2 the next.`));
  else boxPanel.append(el('label', null, 'Courses that cover this box'), req,
    el('p', { class: 'hint' }, '+ = all of these (one strip each), | = any one. Example: CHEM A105 + CHEM A105L, or HU1 | HU2.'),
    names.length ? el('ul', { class: 'box-names' }, names.map(n => el('li', null, n))) : null);
  boxPanel.append(el('p', { class: 'hint' }, `Position x ${b.x}, y ${b.y} · size ${b.w} × ${b.h} px`),
    el('div', { class: 'row' },
      el('button', { onclick: () => { cat.boxes.push(Object.assign(JSON.parse(JSON.stringify(b)), { x: b.x + 12, y: b.y + 12 })); edSel = cat.boxes.length - 1; markDirty(); renderEditorStage(); } }, 'Duplicate'),
      el('button', { class: 'quiet', onclick: () => { cat.boxes.splice(edSel, 1); edSel = -1; markDirty(); renderEditorStage(); update(); } }, 'Delete box')));
}
function renderDiscPanel() {
  discCard.innerHTML = '';
  const cat = DATA.catalogs[edCat]; if (!cat) return;
  cat.disciplines = cat.disciplines || [];
  const tbl = el('table', { class: 'disc-table' }, el('tr', null, el('th', null, 'Discipline'), el('th', null, 'Course numbers (comma separated)'), el('th', null, '')));
  cat.disciplines.forEach((d, i) => {
    tbl.append(el('tr', null,
      el('td', null, el('input', { type: 'text', value: d.name, oninput: e => { d.name = e.target.value; markDirty(); update(); } })),
      el('td', null, el('input', { type: 'text', value: d.codes.join(', '), oninput: e => { d.codes = e.target.value.split(',').map(normCode).filter(Boolean); markDirty(); update(); } })),
      el('td', null, el('button', { class: 'quiet', title: 'Remove this discipline', onclick: () => { cat.disciplines.splice(i, 1); markDirty(); renderDiscPanel(); update(); } }, 'Remove'))));
  });
  discCard.append(tbl, el('div', { class: 'row' }, el('button', { onclick: () => { cat.disciplines.push({ name: 'New discipline', codes: [] }); markDirty(); renderDiscPanel(); } }, '+ Add discipline'),
    el('span', { class: 'note' }, `For the ${cat.label} catalog.`)));
}
function readImage(file, cb) {
  const rd = new FileReader();
  rd.onload = () => { const im = new Image(); im.onload = () => cb(rd.result, im.naturalWidth, im.naturalHeight); im.src = rd.result; };
  rd.readAsDataURL(file);
}
async function addYearDialog() {
  const key = el('input', { type: 'text', class: 'dlg-input', placeholder: 'e.g. 2728', maxlength: 4 });
  const label = el('input', { type: 'text', class: 'dlg-input', placeholder: 'e.g. 2027–2028' });
  const from = el('select', { class: 'dlg-input' }, el('option', { value: '' }, "Don't copy (start with no boxes)"));
  Object.keys(DATA.catalogs).sort().forEach(k => from.append(el('option', { value: k }, `${k} (${DATA.catalogs[k].label})`)));
  from.value = Object.keys(DATA.catalogs).sort().pop();
  const img = el('input', { type: 'file', accept: 'image/*' });
  const ok = await dialog({ title: 'Add a catalog year', focus: key, body: [
    el('label', { class: 'dlg-label' }, 'Catalog code (4 digits)'), key,
    el('label', { class: 'dlg-label' }, 'Label shown to students'), label,
    el('label', { class: 'dlg-label' }, 'Flow chart image (PNG or JPG)'), img,
    el('label', { class: 'dlg-label' }, 'Copy boxes from'), from,
    el('p', { class: 'hint' }, 'Copied boxes are scaled to the new image. Move any that shifted in step 3.')],
    buttons: [{ label: 'Cancel', value: false }, { label: 'Add year', value: true, primary: true }] });
  if (!ok) return;
  const k = key.value.trim();
  if (!/^\d{4}$/.test(k)) { banner('Use a 4-digit catalog code like 2728.', true); return; }
  if (DATA.catalogs[k]) { banner('That catalog year already exists.', true); return; }
  if (!img.files[0]) { banner('Choose the flow chart image.', true); return; }
  readImage(img.files[0], (src, w, h) => {
    const src0 = DATA.catalogs[from.value];
    const boxes = src0 ? JSON.parse(JSON.stringify(src0.boxes)).map(b => { const sx = w / src0.width, sy = h / src0.height; return Object.assign(b, { x: Math.round(b.x * sx), y: Math.round(b.y * sy), w: Math.round(b.w * sx), h: Math.round(b.h * sy) }); }) : [];
    DATA.catalogs[k] = { label: label.value.trim() || k, startYear: 2000 + Number(k.slice(0, 2)), image: src, width: w, height: h, boxes,
      disciplines: JSON.parse(JSON.stringify((src0 || DATA.catalogs[edCat]).disciplines || [])) };
    edCat = k; edSel = -1; markDirty(); renderHeader(); renderEditorStage();
    banner(`Added catalog ${k}. Check the disciplines and move the boxes to match the new chart.`);
  });
}
function renderYearPanel() {
  yearCard.innerHTML = '';
  const cat = DATA.catalogs[edCat]; if (!cat) return;
  const keys = Object.keys(DATA.catalogs).sort();
  const sel = el('select', { class: 'year-select', onchange: () => { edCat = sel.value; edSel = -1; renderEditorStage(); } });
  keys.forEach(k => sel.append(el('option', { value: k }, `${k} (${DATA.catalogs[k].label})`)));
  sel.value = edCat;
  const replace = el('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onchange: () => {
    const f = replace.files[0]; if (!f) return;
    readImage(f, (src, w, h) => {
      const sx = w / cat.width, sy = h / cat.height;
      cat.boxes.forEach(b => { b.x = Math.round(b.x * sx); b.y = Math.round(b.y * sy); b.w = Math.round(b.w * sx); b.h = Math.round(b.h * sy); });
      Object.assign(cat, { image: src, width: w, height: h }); markDirty(); renderEditorStage(); renderChart(); update();
      banner('Image replaced. Boxes were scaled to the new size; check that they still line up.');
    });
  } });
  yearCard.append(el('div', { class: 'year-row' },
    el('label', null, el('span', null, 'Catalog year'), sel),
    el('label', null, el('span', null, 'Label shown to students'), el('input', { type: 'text', value: cat.label, oninput: e => { cat.label = e.target.value; markDirty(); renderHeader(); } })),
    el('label', null, el('span', null, 'First Fall year'), el('input', { type: 'number', value: cat.startYear, style: { width: '90px' }, oninput: e => { cat.startYear = Number(e.target.value) || cat.startYear; markDirty(); } })),
    el('div', { class: 'year-actions' },
      el('button', { onclick: () => replace.click() }, 'Replace image'), replace,
      el('button', { class: 'quiet', onclick: async () => {
        if (keys.length < 2) { banner('Keep at least one catalog year.', true); return; }
        const ok = await dialog({ icon: 'warn', title: `Delete catalog ${edCat}?`, body: `The ${esc(cat.label)} chart and its ${cat.boxes.length} boxes will be removed from the next files you download.`, buttons: [{ label: 'Cancel', value: false }, { label: 'Delete year', value: true, danger: true, focus: true }] });
        if (ok) { delete DATA.catalogs[edCat]; edCat = null; markDirty(); renderHeader(); renderEditorStage(); }
      } }, 'Delete year'),
      el('button', { class: 'primary', onclick: addYearDialog }, '+ Add catalog year'))),
    el('p', { class: 'note' }, `${keys.length} catalog years in this file. Image ${cat.width} × ${cat.height} px, ${cat.boxes.length} boxes.`));
}

/* ---------- Ctrl+S / Cmd+S ---------- */
// Instead of the browser saving the raw web page: save the plan, or (on the editor tabs) download new versions.
async function editorSavePrompt() {
  const v = await dialog({ title: 'Save your changes', icon: 'info',
    body: editorDirty ? 'Download a new version of the editor with your changes. Also download the template if you are ready to send this version out.'
      : 'There are no unsaved changes, but you can still download fresh copies.',
    buttons: [{ label: 'Cancel', value: null }, { label: 'Editor + template', value: 'both' }, { label: 'Download editor file', value: 'editor', primary: true }] });
  if (v) exportFiles(v === 'both' ? 'both' : 'editor');
}
document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return;
  e.preventDefault();
  if (document.querySelector('.modal-back')) return;
  if (EDITOR && !sheets.plan.classList.contains('active')) editorSavePrompt();
  else savePlanFile();
}, true);

/* ---------- Start ---------- */
rebuildCanon();
fillDatalist();
if (EDITOR) {
  setupEditor();
  document.body.append(tabsBar);
  document.body.classList.add('has-tabs');
  tabsBar.append(el('span', { class: 'spacer' }), el('span', { class: 'mode' }, 'Editor copy · not for students'));
}
let restored = false;
if (EMBED) {
  try { loadPlanObject(EMBED, false, false); restored = true; document.title = `${plan.name || 'Student'} · ${PG().short} Degree Plan`; } catch (e) { banner('This plan file is damaged: ' + e.message, true); }
} else if (!EDITOR) {
  const saved = store(true);
  if (saved) { try { const s = JSON.parse(saved); loadPlanObject(s, true, s.dirty); restored = true; } catch (e) { /* ignore a bad autosave */ } }
}
if (!restored) renderAll();
showSheet(EDITOR ? 'flowcharts' : 'plan');
if (restored && !EMBED && hasData()) banner('Restored your unsaved plan from this browser.');

// Hooks for automated checks.
window.__degreePlan = { readPlanText, planPayload, compute, get plan() { return plan; }, loadPlanObject, normCode, buildFile, DATA, hasData, get dirty() { return planDirty; } };
})();
