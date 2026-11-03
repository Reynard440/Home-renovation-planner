import * as F from './finance.js';
import * as S from './store.js';

// ---------- State ----------
let state = S.load() || S.emptyState();
const ui = { calcMonthly: {}, strategy: null };

function persist(msg) {
  const ok = S.save(state);
  if (!ok) toast('⚠️ Could not save — browser storage is full or blocked. Export a backup now.');
  else if (msg) toast(msg);
  stampSaved();
  render();
}

// ---------- Formatting ----------
const fmtMoney = (v, dp = 0) => {
  try {
    return new Intl.NumberFormat(state.settings.locale || 'en-ZA', { style: 'currency', currency: state.settings.currency || 'ZAR', maximumFractionDigits: dp, minimumFractionDigits: dp }).format(v || 0);
  } catch {
    return 'R ' + Math.round(v || 0).toLocaleString();
  }
};
const fmtMonth = (d) => d.toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' });
const monthDate = (m) => F.addMonths(new Date(), m);
const fmtDuration = (m) => {
  if (m == null) return 'Never';
  if (m === 0) return 'Now';
  const y = Math.floor(m / 12), mo = m % 12;
  return [y ? `${y} yr${y > 1 ? 's' : ''}` : '', mo ? `${mo} mo` : ''].filter(Boolean).join(' ');
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const $ = (sel, root = document) => root.querySelector(sel);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
function stampSaved() {
  const el = $('#savedAt');
  if (el && state.updatedAt) el.textContent = `Last saved ${new Date(state.updatedAt).toLocaleString('en-ZA')}`;
}

// ---------- Derived data ----------
const isActive = (p) => p.status !== 'Done' && p.status !== 'In progress';
const costs = (p) => F.projectCosts(p, state.settings.contingencyPct);
const rates = () => ({ interestPct: state.settings.interestPct, inflationPct: state.settings.inflationPct });

function simulate(strategy = state.settings.strategy, capacity = state.settings.monthlyCapacity) {
  const active = state.projects.filter(isActive);
  return F.simulatePortfolio({
    projects: active.map((p) => ({ id: p.id, cost: costs(p).outstanding, saved: costs(p).saved })),
    capacity,
    strategy,
    ...rates(),
  });
}

function targetCheck() {
  const active = state.projects.filter(isActive).map((p) => ({ id: p.id, targetDate: p.targetDate, cost: costs(p).outstanding, saved: costs(p).saved }));
  return F.requiredForTargets({ projects: active, ...rates() });
}

function statusBadge(p) {
  const map = { Planning: '', Saving: 'accent', Funded: 'ok', 'In progress': 'warn', Done: 'ok' };
  return `<span class="badge ${map[p.status] || ''}">${esc(p.status)}</span>`;
}

function etaBadge(p, sim) {
  if (!isActive(p)) return '';
  const c = costs(p);
  if (!p.items.length) return '<span class="badge warn">No costs yet</span>';
  if (c.outstanding > 0 && c.shortfall <= 0.005) return '<span class="badge ok">Ready to build</span>';
  const r = sim.results[p.id];
  if (!r) return '<span class="badge danger">Not fundable</span>';
  if (p.targetDate) {
    const due = F.monthsUntil(p.targetDate);
    if (r.month > due) return `<span class="badge danger">Late by ${fmtDuration(r.month - due)}</span>`;
    return '<span class="badge ok">On track</span>';
  }
  return '';
}

// ---------- Charts (hand-rolled SVG, no dependencies) ----------
function lineChart(series, { height = 240, crossAt = null, target = null } = {}) {
  const W = 640, H = height, pl = 64, pr = 12, pt = 12, pb = 28;
  const maxX = Math.max(1, series.length - 1);
  const maxY = Math.max(1, ...series.map((s) => Math.max(s.balance, s.cost))) * 1.05;
  const x = (m) => pl + (m / maxX) * (W - pl - pr);
  const y = (v) => pt + (1 - v / maxY) * (H - pt - pb);
  const path = (k) => series.map((s, i) => `${i ? 'L' : 'M'}${x(s.m).toFixed(1)},${y(s[k]).toFixed(1)}`).join('');
  const area = `${path('balance')}L${x(maxX)},${y(0)}L${x(0)},${y(0)}Z`;
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (maxY / ticks) * i;
    grid += `<line class="grid-line" x1="${pl}" x2="${W - pr}" y1="${y(v)}" y2="${y(v)}"/><text x="${pl - 8}" y="${y(v) + 4}" text-anchor="end">${esc(compact(v))}</text>`;
  }
  const xt = [0, Math.round(maxX / 3), Math.round((2 * maxX) / 3), maxX];
  for (const m of [...new Set(xt)]) grid += `<text x="${x(m)}" y="${H - 8}" text-anchor="${m === maxX ? 'end' : m === 0 ? 'start' : 'middle'}">${esc(fmtMonth(monthDate(m)))}</text>`;
  let marks = '';
  if (target != null && target <= maxX) marks += `<line x1="${x(target)}" x2="${x(target)}" y1="${pt}" y2="${H - pb}" stroke="var(--warn)" stroke-dasharray="4 4"/><text x="${x(target) + 4}" y="${pt + 10}" style="fill:var(--warn)">target</text>`;
  if (crossAt != null && crossAt <= maxX) {
    const s = series[crossAt];
    marks += `<circle cx="${x(crossAt)}" cy="${y(s.cost)}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>`;
  }
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Savings balance versus project cost over time">
    ${grid}
    <path d="${area}" fill="var(--accent)" opacity=".12"/>
    <path d="${path('cost')}" fill="none" stroke="var(--warn)" stroke-width="2.5" stroke-dasharray="6 4"/>
    <path d="${path('balance')}" fill="none" stroke="var(--accent)" stroke-width="3"/>
    ${marks}
  </svg>
  <div class="legend"><span><i style="background:var(--accent)"></i>Your savings (incl. interest)</span><span><i style="background:var(--warn)"></i>Project cost (incl. inflation)</span></div>`;
}

function compact(v) {
  if (v >= 1e6) return 'R' + (v / 1e6).toFixed(1) + 'm';
  if (v >= 1e3) return 'R' + Math.round(v / 1e3) + 'k';
  return 'R' + Math.round(v);
}

const palette = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)', 'var(--chart-7)', 'var(--chart-8)'];
const typeColor = (t) => palette[S.ITEM_TYPES.indexOf(t) % palette.length] || palette[7];

function gantt(sim, projects) {
  const rows = projects.filter(isActive);
  if (!rows.length) return '<p class="muted">No active projects.</p>';
  const end = Math.max(1, ...rows.map((p) => sim.results[p.id]?.month ?? 0)) || 1;
  const horizon = sim.unfunded.length ? Math.max(end, 24) : end;
  let html = '';
  rows.forEach((p, i) => {
    const r = sim.results[p.id];
    const color = palette[i % palette.length];
    if (!p.items.length) {
      html += `<div class="gantt-row"><div class="name" title="${esc(p.name)}">${i + 1}. ${esc(p.name)}</div><div class="gantt-track"><a class="gantt-bar" href="#/project/${p.id}" style="left:0;width:100%;color:var(--muted);justify-content:flex-start;font-weight:600">No cost items yet — add some →</a></div></div>`;
      return;
    }
    if (!r) {
      html += `<div class="gantt-row"><div class="name" title="${esc(p.name)}">${esc(p.name)}</div><div class="gantt-track"><div class="gantt-bar" style="left:0;width:100%;background:repeating-linear-gradient(45deg,var(--danger-soft),var(--danger-soft) 6px,transparent 6px,transparent 12px);color:var(--danger);justify-content:center">Not funded within 50 years</div></div></div>`;
      return;
    }
    const left = (r.start / horizon) * 100;
    const width = Math.max(1.5, ((r.month - r.start) / horizon) * 100);
    const label = r.month === 0 ? 'Funded' : fmtMonth(monthDate(r.month));
    html += `<div class="gantt-row"><div class="name" title="${esc(p.name)}">${i + 1}. ${esc(p.name)}</div><div class="gantt-track"><div class="gantt-bar" style="left:${left}%;width:${width}%;background:${color}" title="${esc(p.name)}: ready ${label}">${width > 16 ? esc(label) : ''}</div></div></div>`;
  });
  html += `<div class="gantt-row"><div></div><div class="progress-label small"><span>Today</span><span>${esc(fmtMonth(monthDate(horizon)))}</span></div></div>`;
  return html;
}

function stackBar(byType, total) {
  const entries = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length || total <= 0) return '<p class="muted small">Add items to see the breakdown.</p>';
  return `<div class="stackbar">${entries.map(([t, v]) => `<span title="${esc(t)}: ${fmtMoney(v)}" style="width:${(v / total) * 100}%;background:${typeColor(t)}"></span>`).join('')}</div>
  <div class="legend">${entries.map(([t, v]) => `<span><i style="background:${typeColor(t)}"></i>${esc(t)} · <b class="num">${fmtMoney(v)}</b> (${Math.round((v / total) * 100)}%)</span>`).join('')}</div>`;
}

// ---------- Views ----------
function viewEmpty() {
  return `<div class="card empty">
    <div class="eyebrow">Welcome</div>
    <h2>"Save R5,000 a month" isn't a plan.</h2>
    <p>Add each renovation, break it into labour, materials and everything else, and this app tells you exactly what to save each month, when each project becomes affordable, and what waiting costs you in inflation.</p>
    <div class="actions" style="justify-content:center">
      <button class="btn primary" data-action="new-project">+ Create your first project</button>
      <button class="btn" data-action="load-sample">Load example projects</button>
    </div>
  </div>`;
}

function viewDashboard() {
  if (!state.projects.length) return viewEmpty();
  const s = state.settings;
  const active = state.projects.filter(isActive);
  const sim = simulate();
  const tc = targetCheck();
  const totals = active.reduce((a, p) => {
    const c = costs(p);
    a.outstanding += c.outstanding; a.saved += c.saved; a.shortfall += c.shortfall;
    for (const [t, v] of Object.entries(c.byType)) a.byType[t] = (a.byType[t] || 0) + v;
    a.base += c.base;
    return a;
  }, { outstanding: 0, saved: 0, shortfall: 0, byType: {}, base: 0 });
  const allDone = sim.unfunded.length ? null : sim.months;
  const next = active.find((p) => costs(p).shortfall > 0.005);
  const gap = tc.total - s.monthlyCapacity;

  let insight = '';
  if (s.monthlyCapacity <= 0) insight = `<div class="callout warn"><b>You haven't set a monthly savings amount.</b> Go to <a href="#/settings">Settings</a> and enter what you can realistically put away each month.</div>`;
  else if (tc.rows.length && gap > 0.5) insight = `<div class="callout danger"><b>Your target dates don't add up.</b> Hitting every target date needs <b class="num">${fmtMoney(tc.total)}/month</b>, but you're saving <b class="num">${fmtMoney(s.monthlyCapacity)}</b>. You're short <b class="num">${fmtMoney(gap)}/month</b>. Options: push dates out, cut scope, or find the extra cash. See the <a href="#/plan">Savings plan</a>.</div>`;
  else if (tc.rows.length) insight = `<div class="callout"><b>You're on track.</b> Your target dates need <b class="num">${fmtMoney(tc.total)}/month</b> and you're saving <b class="num">${fmtMoney(s.monthlyCapacity)}</b> — <b class="num">${fmtMoney(-gap)}</b> spare each month.</div>`;
  else insight = `<div class="callout"><b>Tip:</b> give projects a target date to see whether your monthly savings can actually hit them.</div>`;

  return `
  <div class="page-head"><div><h1>Dashboard</h1><p>${active.length} active project${active.length === 1 ? '' : 's'} · ${esc(stratName(s.strategy))} strategy</p></div>
    <div class="actions"><button class="btn primary" data-action="new-project">+ New project</button></div></div>
  <div class="grid kpis">
    <div class="card kpi accent"><div class="eyebrow">Still to save</div><div class="value num">${fmtMoney(totals.shortfall)}</div><div class="sub">across active projects</div></div>
    <div class="card kpi"><div class="eyebrow">Saved so far</div><div class="value num">${fmtMoney(totals.saved)}</div><div class="sub">of ${fmtMoney(totals.outstanding)} needed</div></div>
    <div class="card kpi"><div class="eyebrow">Monthly savings</div><div class="value num">${fmtMoney(s.monthlyCapacity)}</div><div class="sub">${tc.rows.length ? `targets need ${fmtMoney(tc.total)}` : 'no target dates set'}</div></div>
    <div class="card kpi"><div class="eyebrow">Everything funded</div><div class="value">${allDone == null ? 'Never' : allDone === 0 ? 'Now' : esc(fmtMonth(monthDate(allDone)))}</div><div class="sub">${allDone == null ? 'savings can’t outrun inflation' : 'in ' + fmtDuration(allDone)}</div></div>
  </div>
  ${insight}
  <div class="grid two" style="margin-top:16px">
    <div class="card"><h2>Funding timeline</h2><p class="muted small" style="margin-top:-6px">When each project will have enough money, using your ${esc(stratName(s.strategy).toLowerCase())} strategy.</p>${gantt(sim, state.projects)}</div>
    <div class="card stack">
      <div><h2>Up next</h2>${next ? nextCard(next, sim) : '<p class="muted">Everything is funded. 🎉</p>'}</div>
      <div><h2>Where the money goes</h2>${stackBar(totals.byType, totals.base)}</div>
    </div>
  </div>`;
}

function nextCard(p, sim) {
  const c = costs(p);
  const r = sim.results[p.id];
  return `<a class="pcard card flat" href="#/project/${p.id}">
    <div class="top"><div><div class="eyebrow">${esc(p.category)}</div><h3>${esc(p.name)}</h3></div>${statusBadge(p)}</div>
    <div><div class="progress"><span style="width:${(c.progress * 100).toFixed(1)}%"></span></div>
    <div class="progress-label"><span class="num">${fmtMoney(c.saved)} saved</span><span class="num">${fmtMoney(c.outstanding)}</span></div></div>
    <div class="small">Ready <b>${r ? esc(fmtMonth(monthDate(r.month))) : 'never'}</b>${r ? ` (${fmtDuration(r.month)})` : ''}</div>
  </a>`;
}

function viewProjects() {
  if (!state.projects.length) return viewEmpty();
  const sim = simulate();
  const cards = state.projects.map((p, i) => {
    const c = costs(p);
    const r = sim.results[p.id];
    return `<div class="card pcard">
      <div class="top">
        <div style="display:flex;gap:10px;align-items:flex-start"><span class="rank" title="Priority">${i + 1}</span><div><div class="eyebrow">${esc(p.category)}</div><h3><a href="#/project/${p.id}" style="color:inherit;text-decoration:none">${esc(p.name)}</a></h3></div></div>
        <div class="actions" style="gap:4px"><button class="btn sm icon" data-action="move" data-id="${p.id}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button><button class="btn sm icon" data-action="move" data-id="${p.id}" data-dir="1" ${i === state.projects.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></div>
      </div>
      <div class="actions" style="gap:6px">${statusBadge(p)} ${etaBadge(p, sim)}</div>
      <div><div class="progress"><span style="width:${(c.progress * 100).toFixed(1)}%"></span></div>
        <div class="progress-label"><span class="num">${fmtMoney(c.saved)} saved</span><span>${Math.round(c.progress * 100)}%</span></div></div>
      <div class="meta">
        <div><span class="muted">Total cost</span><b class="num">${fmtMoney(c.total)}</b></div>
        <div><span class="muted">Still to save</span><b class="num">${fmtMoney(c.shortfall)}</b></div>
        <div><span class="muted">Ready</span><b>${!isActive(p) ? '—' : r ? (r.month === 0 ? 'Now' : esc(fmtMonth(monthDate(r.month)))) : 'Never'}</b></div>
        <div><span class="muted">Items</span><b>${p.items.length}</b></div>
      </div>
      <a class="btn sm" href="#/project/${p.id}" style="align-self:flex-start">Open →</a>
    </div>`;
  }).join('');
  return `<div class="page-head"><div><h1>Projects</h1><p>Ordered by priority. Use ↑ ↓ to change what gets funded first.</p></div>
    <div class="actions"><button class="btn primary" data-action="new-project">+ New project</button></div></div>
    <div class="grid project-list">${cards}</div>`;
}

function viewProject(id) {
  const p = state.projects.find((x) => x.id === id);
  if (!p) return `<div class="card empty"><h2>Project not found</h2><p><a href="#/projects">Back to projects</a></p></div>`;
  const c = costs(p);
  const s = state.settings;
  const cPct = p.contingencyPct ?? s.contingencyPct;
  const rank = state.projects.indexOf(p) + 1;

  // Calculator: monthly amount -> time
  const defaultMonthly = ui.calcMonthly[p.id] ?? (p.plannedMonthly || s.monthlyCapacity || 1000);
  const fwd = F.monthsToAfford({ cost: c.outstanding, saved: c.saved, monthly: defaultMonthly, ...rates() });
  // Calculator: target date -> monthly
  const dueMonths = F.monthsUntil(p.targetDate);
  const req = dueMonths != null ? F.requiredMonthly({ cost: c.outstanding, saved: c.saved, months: dueMonths, ...rates() }) : null;

  const scenarioAmounts = [500, 1000, 2000, 3000, 5000, 7500, 10000, 15000];
  const scen = scenarioAmounts.map((a) => {
    const r = F.monthsToAfford({ cost: c.outstanding, saved: c.saved, monthly: a, ...rates() });
    return `<button type="button" data-action="set-calc" data-id="${p.id}" data-amount="${a}" class="${a === defaultMonthly ? 'on' : ''}"><b class="num">${fmtMoney(a)}/mo</b><span>${r ? (r.months === 0 ? 'Ready now' : `${fmtDuration(r.months)} · ${fmtMonth(monthDate(r.months))}`) : 'Never (inflation wins)'}</span></button>`;
  }).join('');

  const horizon = Math.min(F.MAX_MONTHS, Math.max(12, (fwd?.months ?? 60) + 3, (dueMonths ?? 0) + 3));
  const series = F.projectionSeries({ cost: c.outstanding, saved: c.saved, monthly: defaultMonthly, months: horizon, ...rates() });

  const sliderMax = Math.max(20000, Math.ceil((c.shortfall / 6) / 1000) * 1000);

  let reqHtml = `<p class="muted">Set a target date on this project to see exactly how much you need to save each month to hit it.</p><button class="btn sm" data-action="edit-project" data-id="${p.id}">Set target date</button>`;
  if (req) {
    reqHtml = req.overdue
      ? `<div class="callout danger"><b>Target date has passed (or is this month).</b> You'd need <b class="num">${fmtMoney(req.monthly)}</b> right now. Move the date out.</div>`
      : `<div class="eyebrow">To be ready by ${esc(fmtMonth(new Date(p.targetDate)))} (${fmtDuration(dueMonths)})</div>
         <div class="big-answer num">${fmtMoney(req.monthly)}<span class="muted" style="font-size:16px;font-weight:600"> /month</span></div>
         <div class="small muted" style="margin-top:8px">By then it will cost about <b class="num">${fmtMoney(req.futureCost)}</b> — inflation adds <b class="num">${fmtMoney(req.costOfWaiting)}</b>. Interest earns you about <b class="num">${fmtMoney(Math.max(0, req.interestEarned))}</b>.</div>`;
  }

  const itemsRows = p.items.map((i) => `<tr class="${i.paid ? 'paid' : ''}">
      <td><b>${esc(i.name)}</b>${i.supplier ? `<div class="small muted">${esc(i.supplier)}</div>` : ''}</td>
      <td><span class="badge" style="border-left:3px solid ${typeColor(i.type)}">${esc(i.type)}</span></td>
      <td class="r num">${esc(i.qty)}${i.unit ? ' ' + esc(i.unit) : ''}</td>
      <td class="r num">${fmtMoney(i.unitCost, 2)}</td>
      <td class="r num"><b>${fmtMoney(F.itemTotal(i), 2)}</b></td>
      <td><span class="badge ${i.quoteStatus === 'Quoted' ? 'accent' : i.quoteStatus === 'Purchased' ? 'ok' : ''}">${esc(i.quoteStatus)}</span></td>
      <td><label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-action="toggle-paid" data-id="${p.id}" data-item="${i.id}" ${i.paid ? 'checked' : ''}/>Paid</label></td>
      <td class="r" style="white-space:nowrap"><button class="btn sm" data-action="edit-item" data-id="${p.id}" data-item="${i.id}">Edit</button> <button class="btn sm danger" data-action="del-item" data-id="${p.id}" data-item="${i.id}" aria-label="Delete item">✕</button></td>
    </tr>`).join('');

  const contribRows = [...p.contributions].sort((a, b) => b.date.localeCompare(a.date)).map((x) => `<tr>
      <td class="num">${esc(x.date)}</td><td>${esc(x.note)}</td><td class="r num ${x.amount < 0 ? '' : ''}" style="color:${x.amount < 0 ? 'var(--danger)' : 'var(--ok)'}">${x.amount < 0 ? '−' : '+'}${fmtMoney(Math.abs(x.amount), 2)}</td>
      <td class="r"><button class="btn sm danger" data-action="del-contrib" data-id="${p.id}" data-c="${x.id}" aria-label="Delete deposit">✕</button></td></tr>`).join('');

  return `
  <div class="page-head">
    <div><a href="#/projects" class="small">← All projects</a><h1>${esc(p.name)}</h1>
      <p><span class="rank" style="vertical-align:1px">#${rank}</span> ${esc(p.category)} · ${statusBadge(p)} ${etaBadge(p, simulate())}</p></div>
    <div class="actions"><button class="btn" data-action="edit-project" data-id="${p.id}">Edit project</button><button class="btn danger" data-action="del-project" data-id="${p.id}">Delete</button></div>
  </div>
  <div class="grid kpis">
    <div class="card kpi"><div class="eyebrow">Total cost</div><div class="value num">${fmtMoney(c.total)}</div><div class="sub">${fmtMoney(c.base)} + ${cPct}% contingency</div></div>
    <div class="card kpi"><div class="eyebrow">Already paid</div><div class="value num">${fmtMoney(c.paid)}</div><div class="sub">items marked paid</div></div>
    <div class="card kpi"><div class="eyebrow">Saved for it</div><div class="value num">${fmtMoney(c.saved)}</div><div class="sub">${Math.round(c.progress * 100)}% of ${fmtMoney(c.outstanding)}</div></div>
    <div class="card kpi accent"><div class="eyebrow">Still to save</div><div class="value num">${fmtMoney(c.shortfall)}</div><div class="sub">today's prices</div></div>
  </div>

  <div class="grid half">
    <div class="card stack">
      <div><h2>How long will it take?</h2>
        <label class="field">If I save each month
          <div class="input-prefix"><span>R</span><input type="number" min="0" step="100" inputmode="decimal" value="${defaultMonthly}" data-action="calc-input" data-id="${p.id}"/></div>
        </label>
        <input type="range" min="0" max="${sliderMax}" step="100" value="${Math.min(defaultMonthly, sliderMax)}" data-action="calc-range" data-id="${p.id}" aria-label="Monthly amount" style="margin-top:10px"/>
      </div>
      <div>${fwd
        ? fwd.months === 0
          ? `<div class="big-answer">Ready now 🎉</div>`
          : `<div class="eyebrow">Ready in</div><div class="big-answer">${fmtDuration(fwd.months)}</div><div class="muted">${esc(fmtMonth(monthDate(fwd.months)))} · cost by then ≈ <b class="num">${fmtMoney(fwd.finalCost)}</b></div>`
        : `<div class="callout danger"><b>Never.</b> At ${fmtMoney(defaultMonthly)}/month your savings can't outrun ${s.inflationPct}% cost inflation on this project. Save more or cut scope.</div>`}
      </div>
      <div><div class="eyebrow" style="margin-bottom:6px">Quick scenarios</div><div class="scenario">${scen}</div></div>
      ${defaultMonthly !== p.plannedMonthly ? `<button class="btn sm" data-action="save-planned" data-id="${p.id}" data-amount="${defaultMonthly}">Save ${fmtMoney(defaultMonthly)}/month as this project's plan</button>` : `<span class="small muted">✓ This is your planned monthly amount for this project.</span>`}
    </div>
    <div class="card stack">
      <div><h2>What must I save to hit my date?</h2>${reqHtml}</div>
      <div><h3>Savings vs. cost</h3>${lineChart(series, { crossAt: fwd?.months ?? null, target: dueMonths })}</div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Cost items</h2><button class="btn primary sm" data-action="new-item" data-id="${p.id}">+ Add item</button></div>
    ${p.items.length ? `<div class="table-wrap"><table>
      <thead><tr><th>Item</th><th>Type</th><th class="r">Qty</th><th class="r">Unit cost</th><th class="r">Total</th><th>Price</th><th></th><th></th></tr></thead>
      <tbody>${itemsRows}</tbody>
      <tfoot>
        <tr><td colspan="4">Subtotal</td><td class="r num">${fmtMoney(c.base, 2)}</td><td colspan="3"></td></tr>
        <tr><td colspan="4" class="muted">Contingency (${cPct}%)</td><td class="r num muted">${fmtMoney(c.contingency, 2)}</td><td colspan="3"></td></tr>
        <tr><td colspan="4">Total budget</td><td class="r num">${fmtMoney(c.total, 2)}</td><td colspan="3"></td></tr>
      </tfoot></table></div>
      <div style="margin-top:16px">${stackBar(c.byType, c.base)}</div>`
      : `<p class="muted">No items yet. Break the project down: materials, labour, equipment hire, delivery, rubble removal, permits/CoCs, professional fees…</p>`}
  </div>

  <div class="grid half" style="margin-top:16px">
    <div class="card">
      <div class="page-head" style="margin-bottom:8px"><h2 style="margin:0">Savings deposits</h2><button class="btn primary sm" data-action="new-contrib" data-id="${p.id}">+ Log deposit</button></div>
      ${p.contributions.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Note</th><th class="r">Amount</th><th></th></tr></thead><tbody>${contribRows}</tbody>
        <tfoot><tr><td colspan="2">Total saved</td><td class="r num">${fmtMoney(c.saved, 2)}</td><td></td></tr></tfoot></table></div>`
        : '<p class="muted">Log money as you set it aside for this project. Use a negative amount for a withdrawal.</p>'}
    </div>
    <div class="card"><h2>Notes</h2>${p.notes ? `<p style="white-space:pre-wrap;margin:0">${esc(p.notes)}</p>` : '<p class="muted">No notes. Add quotes received, contractor names, decisions…</p>'}</div>
  </div>`;
}

const STRATS = {
  priority: { name: 'Priority first', desc: 'All savings go to your #1 project until it is fully funded, then to #2, and so on. Gets your most important project done soonest.' },
  snowball: { name: 'Quick wins', desc: 'Smallest remaining amount first. Gets the most projects done early — good for momentum.' },
  proportional: { name: 'All at once', desc: 'Every project gets a share each month. Feels fair, but everything finishes late and inflation eats more.' },
};
const stratName = (k) => STRATS[k]?.name || k;

function viewPlan() {
  if (!state.projects.length) return viewEmpty();
  const s = state.settings;
  const strategy = ui.strategy || s.strategy;
  const active = state.projects.filter(isActive);
  const sims = Object.fromEntries(Object.keys(STRATS).map((k) => [k, simulate(k)]));
  const sim = sims[strategy];
  const tc = targetCheck();

  const compareRows = Object.entries(STRATS).map(([k, v]) => {
    const sm = sims[k];
    const months = active.map((p) => sm.results[p.id]?.month).filter((m) => m != null);
    const first = active.length ? Math.min(...active.map((p) => { const r = sm.results[p.id]; return r && r.month > 0 ? r.month : Infinity; })) : null;
    const all = sm.unfunded.length ? null : Math.max(0, ...months);
    const avg = months.length ? months.reduce((a, b) => a + b, 0) / months.length : null;
    const infl = active.reduce((a, p) => { const r = sm.results[p.id]; return a + (r ? r.cost - costs(p).outstanding : 0); }, 0);
    return `<tr class="${k === strategy ? 'sel' : ''}"><td><b>${v.name}</b>${k === s.strategy ? ' <span class="badge accent">current</span>' : ''}</td>
      <td class="r">${first === Infinity || first == null ? '—' : fmtDuration(first)}</td>
      <td class="r">${avg == null ? '—' : fmtDuration(Math.round(avg))}</td>
      <td class="r">${all == null ? 'Never' : fmtDuration(all)}</td>
      <td class="r num">${fmtMoney(infl)}</td>
      <td class="r">${k === s.strategy ? '' : `<button class="btn sm" data-action="use-strategy" data-s="${k}">Use</button>`}</td></tr>`;
  }).join('');

  const targetRows = active.map((p) => {
    const row = tc.rows.find((r) => r.id === p.id);
    const r = sim.results[p.id];
    const c = costs(p);
    const due = F.monthsUntil(p.targetDate);
    let verdict = '<span class="muted small">No target</span>';
    if (row) verdict = !r ? '<span class="badge danger">Never</span>' : r.month <= due ? '<span class="badge ok">On track</span>' : `<span class="badge danger">${fmtDuration(r.month - due)} late</span>`;
    return `<tr><td><a href="#/project/${p.id}"><b>${esc(p.name)}</b></a></td><td class="r num">${fmtMoney(c.shortfall)}</td>
      <td>${p.targetDate ? esc(fmtMonth(new Date(p.targetDate))) : '—'}</td>
      <td class="r num">${row ? (row.overdue ? '<span class="badge danger">overdue</span>' : fmtMoney(row.monthly)) : '—'}</td>
      <td>${r ? (r.month === 0 ? 'Now' : esc(fmtMonth(monthDate(r.month)))) : 'Never'}</td><td>${verdict}</td></tr>`;
  }).join('');

  const gap = tc.total - s.monthlyCapacity;

  return `
  <div class="page-head"><div><h1>Savings plan</h1><p>One monthly budget, many projects. Decide how to split it.</p></div></div>
  <div class="grid half">
    <div class="card stack">
      <label class="field">How much can you save for renovations every month?
        <div class="input-prefix"><span>R</span><input type="number" min="0" step="100" value="${s.monthlyCapacity}" data-action="capacity"/></div>
        <small>Be honest. Use what's left after bills, debt, emergency fund and retirement — not what you hope to have.</small>
      </label>
      <div><div class="eyebrow" style="margin-bottom:6px">Strategy</div>
        <div class="seg">${Object.entries(STRATS).map(([k, v]) => `<button data-action="pick-strategy" data-s="${k}" class="${k === strategy ? 'on' : ''}">${v.name}</button>`).join('')}</div>
        <p class="small muted">${STRATS[strategy].desc}</p>
        ${strategy !== s.strategy ? `<button class="btn primary sm" data-action="use-strategy" data-s="${strategy}">Make "${STRATS[strategy].name}" my strategy</button>` : ''}
      </div>
    </div>
    <div class="card">
      <h2>Do my target dates fit my budget?</h2>
      ${tc.rows.length
        ? `<div class="big-answer num">${fmtMoney(tc.total)}<span class="muted" style="font-size:16px;font-weight:600"> /month needed</span></div>
           <p>${gap > 0.5 ? `<span class="badge danger">Short ${fmtMoney(gap)}/month</span> Your dates are not realistic with ${fmtMoney(s.monthlyCapacity)}/month.` : `<span class="badge ok">${fmtMoney(-gap)}/month spare</span> Your dates fit, assuming the money is split to match.`}</p>
           <p class="small muted">This is the sum of what each project needs on its own to hit its date. A waterfall strategy can still miss a later project's date — check the table below.</p>`
        : '<p class="muted">None of your projects have a target date. Add one to test it against your budget.</p>'}
    </div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Timeline · ${STRATS[strategy].name}</h2>${gantt(sim, state.projects)}</div>
  <div class="card" style="margin-top:16px"><h2>Compare strategies</h2>
    <div class="table-wrap"><table><thead><tr><th>Strategy</th><th class="r">First project ready</th><th class="r">Average wait</th><th class="r">All ready</th><th class="r">Lost to inflation</th><th></th></tr></thead><tbody>${compareRows}</tbody></table></div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Target date check · ${STRATS[strategy].name}</h2>
    <div class="table-wrap"><table><thead><tr><th>Project</th><th class="r">Still to save</th><th>Target</th><th class="r">Needs alone</th><th>Ready (plan)</th><th></th></tr></thead><tbody>${targetRows || '<tr><td colspan="6" class="muted">No active projects.</td></tr>'}</tbody></table></div>
  </div>`;
}

function viewSettings() {
  const s = state.settings;
  return `
  <div class="page-head"><div><h1>Settings</h1><p>Your assumptions drive every number in the app. Garbage in, garbage out.</p></div></div>
  <div class="grid half">
    <form class="card stack" id="settingsForm">
      <h2>Assumptions</h2>
      <label class="field">Monthly savings for renovations (R)<input name="monthlyCapacity" type="number" min="0" step="100" value="${s.monthlyCapacity}"/></label>
      <label class="field">Interest on savings (% per year)<input name="interestPct" type="number" step="0.1" value="${s.interestPct}"/>
        <small>What your savings account / money-market fund actually pays. Use the after-tax rate if you exceed your interest exemption. Use 0 if the money sits in a cheque account.</small></label>
      <label class="field">Renovation cost inflation (% per year)<input name="inflationPct" type="number" step="0.1" value="${s.inflationPct}"/>
        <small>Building materials and labour tend to rise faster than headline CPI. Check the latest StatsSA / BER building cost figures and err on the high side.</small></label>
      <label class="field">Default contingency (%)<input name="contingencyPct" type="number" min="0" step="1" value="${s.contingencyPct}"/>
        <small>Buffer for surprises (rot behind tiles, wiring not to code…). 10% for simple cosmetic jobs, 15–20% for anything structural, wet-area or in an older house. Can be overridden per project.</small></label>
      <div class="actions"><button class="btn primary" type="submit">Save settings</button></div>
    </form>
    <div class="card stack">
      <h2>Your data</h2>
      <p class="small muted" style="margin:0">Everything is stored in this browser's local storage — nothing is sent to a server. That means: <b>clear your browser data and it's gone</b>, and your phone won't see what's on your laptop. Export a backup after every session.</p>
      <div class="actions">
        <button class="btn primary" data-action="export">Export backup (.json)</button>
        <label class="btn">Import backup<input type="file" accept="application/json,.json" data-action="import" hidden/></label>
        <button class="btn" data-action="export-csv">Export items (.csv)</button>
      </div>
      <hr style="border:0;border-top:1px solid var(--border);width:100%"/>
      <div class="actions">
        <button class="btn" data-action="load-sample">Load example projects</button>
        <button class="btn danger" data-action="reset">Delete all data</button>
      </div>
      <h3 style="margin-top:8px">How the maths works</h3>
      <ul class="small muted" style="margin:0;padding-left:18px">
        <li>Annual rates are converted to monthly compound rates.</li>
        <li>Deposits are assumed at the end of each month.</li>
        <li>Items marked <b>paid</b> are treated as spent and no longer need saving for.</li>
        <li>"Still to save" = (unpaid items + contingency) − money saved for that project.</li>
        <li>Projects that are <b>In progress</b> or <b>Done</b> are excluded from the savings plan.</li>
      </ul>
    </div>
  </div>`;
}

// ---------- Modals ----------
function openModal(html, onSubmit) {
  const dlg = $('#modal');
  const form = $('#modalForm');
  form.innerHTML = html;
  form.onsubmit = (e) => {
    const submitter = e.submitter;
    if (submitter && submitter.value === 'cancel') return;
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    if (onSubmit(data, form) !== false) dlg.close();
  };
  dlg.showModal();
  const first = form.querySelector('input,select,textarea');
  if (first) first.focus();
}
const opts = (list, sel) => list.map((o) => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');
const modalActions = (label) => `<div class="actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn primary" value="ok">${label}</button></div>`;

function projectModal(p) {
  const isNew = !p;
  p = p || { name: '', category: 'Other', status: 'Planning', targetDate: '', contingencyPct: null, notes: '' };
  openModal(`<h2>${isNew ? 'New project' : 'Edit project'}</h2>
    <div class="stack">
      <label class="field">Project name<input name="name" required maxlength="120" value="${esc(p.name)}" placeholder="e.g. Main bathroom refresh"/></label>
      <div class="form-grid">
        <label class="field">Area<select name="category">${opts(S.CATEGORIES, p.category)}</select></label>
        <label class="field">Status<select name="status">${opts(S.PROJECT_STATUS, p.status)}</select></label>
        <label class="field">Target date <small>(optional)</small><input type="date" name="targetDate" value="${esc(p.targetDate)}"/></label>
        <label class="field">Contingency % <small>(blank = default ${state.settings.contingencyPct}%)</small><input type="number" min="0" step="1" name="contingencyPct" value="${p.contingencyPct ?? ''}"/></label>
      </div>
      <label class="field">Notes<textarea name="notes" placeholder="Scope, quotes received, contractor details…">${esc(p.notes)}</textarea></label>
    </div>${modalActions(isNew ? 'Create project' : 'Save')}`, (d) => {
    const patch = { name: d.name.trim() || 'Untitled project', category: d.category, status: d.status, targetDate: d.targetDate, contingencyPct: d.contingencyPct === '' ? null : Math.max(0, Number(d.contingencyPct)), notes: d.notes };
    if (isNew) {
      const np = { id: S.uid(), plannedMonthly: 0, createdAt: new Date().toISOString(), items: [], contributions: [], ...patch };
      state.projects.push(np);
      S.save(state);
      location.hash = `#/project/${np.id}`;
      toast('Project created — now add its cost items');
    } else {
      Object.assign(p, patch);
      persist('Project saved');
    }
  });
}

function itemModal(p, item) {
  const isNew = !item;
  item = item || { name: '', type: 'Materials', qty: 1, unit: '', unitCost: '', supplier: '', quoteStatus: 'Estimate', paid: false };
  openModal(`<h2>${isNew ? 'Add cost item' : 'Edit cost item'}</h2>
    <div class="stack">
      <label class="field">What is it?<input name="name" required value="${esc(item.name)}" placeholder="e.g. Floor tiles, Tiler labour, Skip hire"/></label>
      <div class="form-grid">
        <label class="field">Type<select name="type">${opts(S.ITEM_TYPES, item.type)}</select></label>
        <label class="field">Price is<select name="quoteStatus">${opts(S.QUOTE_STATUS, item.quoteStatus)}</select></label>
        <label class="field">Quantity<input name="qty" type="number" min="0" step="any" required value="${esc(item.qty)}"/></label>
        <label class="field">Unit <small>(m², days, each…)</small><input name="unit" value="${esc(item.unit)}"/></label>
        <label class="field">Unit cost (R)<input name="unitCost" type="number" min="0" step="0.01" required value="${esc(item.unitCost)}"/></label>
        <label class="field">Supplier / contractor<input name="supplier" value="${esc(item.supplier)}"/></label>
      </div>
      <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="paid" ${item.paid ? 'checked' : ''}/> Already paid for</label>
    </div>${modalActions(isNew ? 'Add item' : 'Save')}`, (d) => {
    const patch = { name: d.name.trim() || 'Item', type: d.type, quoteStatus: d.quoteStatus, qty: Math.max(0, Number(d.qty) || 0), unit: d.unit, unitCost: Math.max(0, Number(d.unitCost) || 0), supplier: d.supplier, paid: d.paid === 'on' };
    if (isNew) p.items.push({ id: S.uid(), ...patch });
    else Object.assign(item, patch);
    persist(isNew ? 'Item added' : 'Item saved');
  });
}

function contribModal(p) {
  const c = costs(p);
  openModal(`<h2>Log a deposit</h2><p class="muted small">Money you've actually set aside for <b>${esc(p.name)}</b>. Still to save: <b class="num">${fmtMoney(c.shortfall)}</b>.</p>
    <div class="form-grid">
      <label class="field">Date<input type="date" name="date" required value="${new Date().toISOString().slice(0, 10)}"/></label>
      <label class="field">Amount (R) <small>negative = withdrawal</small><input type="number" step="0.01" name="amount" required value="${p.plannedMonthly || ''}"/></label>
    </div>
    <label class="field" style="margin-top:12px">Note<input name="note" placeholder="e.g. November savings"/></label>
    ${modalActions('Log deposit')}`, (d) => {
    const amount = Number(d.amount);
    if (!amount) { toast('Enter an amount'); return false; }
    p.contributions.push({ id: S.uid(), date: d.date, amount, note: d.note });
    if (p.status === 'Planning') p.status = 'Saving';
    persist('Deposit logged');
  });
}

function confirmModal(title, body, label, fn) {
  openModal(`<h2>${esc(title)}</h2><p>${body}</p><div class="actions"><button class="btn" value="cancel">Cancel</button><button class="btn primary" value="ok" style="background:var(--danger);border-color:var(--danger)">${esc(label)}</button></div>`, () => { fn(); });
}

// ---------- Events ----------
const findP = (id) => state.projects.find((p) => p.id === id);

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { action, id } = el.dataset;
  const p = id ? findP(id) : null;
  switch (action) {
    case 'new-project': return projectModal();
    case 'edit-project': return projectModal(p);
    case 'del-project':
      return confirmModal('Delete project?', `This permanently removes <b>${esc(p.name)}</b>, its ${p.items.length} items and ${p.contributions.length} deposits.`, 'Delete', () => {
        state.projects = state.projects.filter((x) => x !== p);
        S.save(state);
        location.hash = '#/projects';
        toast('Project deleted');
      });
    case 'move': {
      const i = state.projects.indexOf(p), j = i + Number(el.dataset.dir);
      if (j < 0 || j >= state.projects.length) return;
      [state.projects[i], state.projects[j]] = [state.projects[j], state.projects[i]];
      return persist();
    }
    case 'new-item': return itemModal(p);
    case 'edit-item': return itemModal(p, p.items.find((i) => i.id === el.dataset.item));
    case 'del-item': {
      const it = p.items.find((i) => i.id === el.dataset.item);
      return confirmModal('Delete item?', `Remove <b>${esc(it.name)}</b> (${fmtMoney(F.itemTotal(it))})?`, 'Delete', () => { p.items = p.items.filter((i) => i !== it); persist('Item deleted'); });
    }
    case 'new-contrib': return contribModal(p);
    case 'del-contrib': return confirmModal('Delete deposit?', 'This removes the deposit from your savings record.', 'Delete', () => { p.contributions = p.contributions.filter((c) => c.id !== el.dataset.c); persist('Deposit deleted'); });
    case 'set-calc': ui.calcMonthly[id] = Number(el.dataset.amount); return render();
    case 'save-planned': p.plannedMonthly = Number(el.dataset.amount); return persist('Monthly plan saved');
    case 'pick-strategy': ui.strategy = el.dataset.s; return render();
    case 'use-strategy': state.settings.strategy = el.dataset.s; ui.strategy = null; return persist(`Strategy set to ${stratName(el.dataset.s)}`);
    case 'load-sample':
      if (state.projects.length) return confirmModal('Replace your data?', 'Loading the examples replaces all your current projects. Export a backup first if you want to keep them.', 'Replace', () => { state = S.sampleState(); persist('Example projects loaded'); location.hash = '#/dashboard'; });
      state = S.sampleState(); persist('Example projects loaded'); location.hash = '#/dashboard'; return;
    case 'reset': return confirmModal('Delete ALL data?', 'Every project, item and deposit will be erased from this browser. This cannot be undone.', 'Delete everything', () => { state = S.emptyState(); persist('All data deleted'); });
    case 'export': S.downloadJSON(state); return toast('Backup downloaded');
    case 'export-csv': S.downloadCSV(state); return toast('CSV downloaded');
  }
});

let calcTimer;
document.addEventListener('input', (e) => {
  const el = e.target;
  const { action, id } = el.dataset || {};
  if (action === 'calc-input' || action === 'calc-range') {
    ui.calcMonthly[id] = Math.max(0, Number(el.value) || 0);
    clearTimeout(calcTimer);
    // range: re-render live; typed input: debounce so the caret isn't lost on every keystroke
    calcTimer = setTimeout(() => {
      const keepFocus = action === 'calc-input';
      render();
      if (keepFocus) { const n = $(`[data-action="calc-input"][data-id="${id}"]`); if (n) { n.focus(); const v = n.value; n.value = ''; n.value = v; } }
      else { const r = $(`[data-action="calc-range"][data-id="${id}"]`); if (r) r.focus(); }
    }, action === 'calc-range' ? 0 : 450);
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  const { action, id } = el.dataset || {};
  if (action === 'toggle-paid') {
    const it = findP(id).items.find((i) => i.id === el.dataset.item);
    it.paid = el.checked;
    if (it.paid) it.quoteStatus = 'Purchased';
    persist(it.paid ? 'Marked as paid' : 'Marked as unpaid');
  } else if (action === 'capacity') {
    state.settings.monthlyCapacity = Math.max(0, Number(el.value) || 0);
    persist('Monthly savings updated');
  } else if (action === 'import') {
    const file = el.files[0];
    if (!file) return;
    file.text().then((txt) => {
      const next = S.normalise(JSON.parse(txt));
      confirmModal('Import backup?', `This replaces your current data with <b>${next.projects.length} project(s)</b> from the file.`, 'Import', () => { state = next; persist('Backup imported'); });
    }).catch((err) => toast('Import failed: ' + err.message));
    el.value = '';
  }
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'settingsForm') return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target).entries());
  const n = (v, min = -50, max = 100) => Math.min(max, Math.max(min, Number(v) || 0));
  Object.assign(state.settings, { monthlyCapacity: Math.max(0, Number(d.monthlyCapacity) || 0), interestPct: n(d.interestPct), inflationPct: n(d.inflationPct), contingencyPct: n(d.contingencyPct, 0, 200) });
  persist('Settings saved');
});

// ---------- Router ----------
function render() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [route, arg] = hash.split('/');
  const views = { dashboard: viewDashboard, projects: viewProjects, project: () => viewProject(arg), plan: viewPlan, settings: viewSettings };
  const view = views[route] || viewDashboard;
  const app = $('#app');
  const y = window.scrollY;
  app.innerHTML = view();
  window.scrollTo(0, y);
  const navRoute = route === 'project' ? 'projects' : route;
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.route === navRoute));
}

let lastRoute = location.hash;
window.addEventListener('hashchange', () => {
  const changedPage = location.hash.split('/')[1] !== lastRoute.split('/')[1] || location.hash !== lastRoute;
  lastRoute = location.hash;
  render();
  if (changedPage) window.scrollTo(0, 0);
});
window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith('bhr.')) { state = S.load() || S.emptyState(); render(); } });

stampSaved();
render();
