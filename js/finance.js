// Pure finance engine — no DOM, no storage. Fully unit-tested (see tests/).
// Conventions:
//  * Annual rates are given as percentages (7 = 7%) and converted to an
//    equivalent *effective* monthly rate: (1 + a)^(1/12) - 1.
//  * Savings contributions are made at the END of each month (ordinary annuity).
//  * Cost inflation compounds monthly at the effective monthly rate.

export const MAX_MONTHS = 600; // 50 years — anything beyond is "never".
const EPS = 0.005; // half a cent tolerance

export function monthlyRate(annualPct) {
  const a = Number(annualPct) || 0;
  if (a <= -100) return -1;
  return Math.pow(1 + a / 100, 1 / 12) - 1;
}

export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function itemTotal(item) {
  return Math.max(0, num(item.qty)) * Math.max(0, num(item.unitCost));
}

/** Cost breakdown for a project. Paid items are sunk — they no longer need saving for. */
export function projectCosts(project, contingencyPct) {
  const items = project.items || [];
  const cPct = project.contingencyPct ?? contingencyPct ?? 0;
  const base = items.reduce((s, i) => s + itemTotal(i), 0);
  const paid = items.filter((i) => i.paid).reduce((s, i) => s + itemTotal(i), 0);
  const contingency = base * (num(cPct) / 100);
  const total = base + contingency;
  const outstanding = (base - paid) * (1 + num(cPct) / 100);
  const saved = (project.contributions || []).reduce((s, c) => s + num(c.amount), 0);
  const shortfall = Math.max(0, outstanding - saved);
  const byType = {};
  for (const i of items) {
    const t = i.type || 'Other';
    byType[t] = (byType[t] || 0) + itemTotal(i);
  }
  const progress = outstanding <= 0 ? 1 : Math.min(1, saved / outstanding);
  return { base, paid, contingency, total, outstanding, saved, shortfall, byType, progress };
}

/** Cost at month m given today's cost and annual inflation %. */
export function inflatedCost(cost, inflationPct, months) {
  return cost * Math.pow(1 + monthlyRate(inflationPct), months);
}

/**
 * Required monthly contribution to have enough by `months` from now.
 * Returns { monthly, futureCost, futureSaved, interestEarned, costOfWaiting, overdue }.
 */
export function requiredMonthly({ cost, saved = 0, months, interestPct = 0, inflationPct = 0 }) {
  const n = Math.max(0, Math.floor(num(months)));
  const r = monthlyRate(interestPct);
  const futureCost = inflatedCost(cost, inflationPct, n);
  const futureSaved = saved * Math.pow(1 + r, n);
  const need = futureCost - futureSaved;
  const costOfWaiting = futureCost - cost;
  if (need <= EPS) {
    return { monthly: 0, futureCost, futureSaved, interestEarned: futureSaved - saved, costOfWaiting, overdue: false };
  }
  if (n === 0) {
    return { monthly: need, futureCost, futureSaved, interestEarned: 0, costOfWaiting: 0, overdue: true };
  }
  const monthly = Math.abs(r) < 1e-12 ? need / n : (need * r) / (Math.pow(1 + r, n) - 1);
  const contributed = monthly * n;
  const interestEarned = futureCost - saved - contributed;
  return { monthly, futureCost, futureSaved, interestEarned, costOfWaiting, overdue: false };
}

/**
 * How many months until the savings balance covers the (inflating) cost,
 * contributing `monthly` per month. Returns null if it never gets there
 * within MAX_MONTHS (e.g. contributions can't outrun inflation).
 */
export function monthsToAfford({ cost, saved = 0, monthly, interestPct = 0, inflationPct = 0, max = MAX_MONTHS }) {
  const r = monthlyRate(interestPct);
  const g = monthlyRate(inflationPct);
  let bal = num(saved);
  let target = num(cost);
  for (let m = 0; m <= max; m++) {
    if (bal + EPS >= target) return { months: m, finalCost: target, finalBalance: bal };
    bal = bal * (1 + r) + num(monthly);
    target = target * (1 + g);
  }
  return null;
}

/** Balance vs. inflating cost, month by month — for charts. */
export function projectionSeries({ cost, saved = 0, monthly, interestPct = 0, inflationPct = 0, months }) {
  const r = monthlyRate(interestPct);
  const g = monthlyRate(inflationPct);
  const out = [];
  let bal = num(saved);
  let target = num(cost);
  for (let m = 0; m <= months; m++) {
    out.push({ m, balance: bal, cost: target });
    bal = bal * (1 + r) + num(monthly);
    target = target * (1 + g);
  }
  return out;
}

export function addMonths(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), 1);
  d.setMonth(d.getMonth() + n);
  return d;
}

/** Whole calendar months from `from` until `to` (never negative). */
export function monthsUntil(to, from = new Date()) {
  if (!to) return null;
  const t = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(t.getTime())) return null;
  const diff = (t.getFullYear() - from.getFullYear()) * 12 + (t.getMonth() - from.getMonth());
  return Math.max(0, diff);
}

/**
 * Portfolio simulation: one monthly savings budget shared across projects.
 * strategies:
 *  - 'priority'     : waterfall — everything goes to the top-priority project until funded.
 *  - 'snowball'     : waterfall, smallest shortfall first (quick wins).
 *  - 'proportional' : split every month across all unfunded projects by remaining need.
 * projects: [{ id, cost (outstanding today), saved }] in priority order.
 * Returns { results: {id: {month, cost}}, series: [{m, total}], months, unfunded: [ids] }
 */
export function simulatePortfolio({ projects, capacity, interestPct = 0, inflationPct = 0, strategy = 'priority', max = MAX_MONTHS }) {
  const r = monthlyRate(interestPct);
  const g = monthlyRate(inflationPct);
  const ps = projects.map((p, idx) => ({ id: p.id, idx, base: num(p.cost), bal: num(p.saved), funded: null, start: num(p.saved) > 0 ? 0 : null }));
  let order = ps.slice();
  if (strategy === 'snowball') order.sort((a, b) => (a.base - a.bal) - (b.base - b.bal) || a.idx - b.idx);

  const series = [];
  const costAt = (p, m) => p.base * Math.pow(1 + g, m);
  const mark = (m) => {
    for (const p of ps) if (p.funded === null && p.bal + EPS >= costAt(p, m)) p.funded = { month: m, cost: costAt(p, m) };
  };
  mark(0);
  series.push({ m: 0, total: ps.reduce((s, p) => s + p.bal, 0) });

  let m = 0;
  while (ps.some((p) => p.funded === null) && m < max) {
    m++;
    for (const p of ps) if (p.funded === null) p.bal *= 1 + r;
    let pool = Math.max(0, num(capacity));
    const open = order.filter((p) => p.funded === null);
    if (strategy === 'proportional') {
      // Iteratively split so nobody gets more than they need; leftovers re-split.
      let active = open.slice();
      for (let pass = 0; pass < 5 && pool > EPS && active.length; pass++) {
        const needs = active.map((p) => Math.max(0, costAt(p, m) - p.bal));
        const totalNeed = needs.reduce((s, n) => s + n, 0);
        if (totalNeed <= EPS) break;
        let given = 0;
        active.forEach((p, i) => {
          const give = Math.min(needs[i], (pool * needs[i]) / totalNeed);
          if (give > EPS && p.start === null) p.start = m - 1;
          p.bal += give;
          given += give;
        });
        pool -= given;
        active = active.filter((p) => costAt(p, m) - p.bal > EPS);
      }
    } else {
      for (const p of open) {
        if (pool <= EPS) break;
        const need = Math.max(0, costAt(p, m) - p.bal);
        const give = Math.min(need, pool);
        if (give > EPS && p.start === null) p.start = m - 1;
        p.bal += give;
        pool -= give;
      }
    }
    mark(m);
    series.push({ m, total: ps.reduce((s, p) => s + (p.funded ? 0 : p.bal), 0) });
  }

  const results = {};
  for (const p of ps) results[p.id] = p.funded ? { ...p.funded, start: p.start ?? 0 } : null;
  return { results, series, months: m, unfunded: ps.filter((p) => !p.funded).map((p) => p.id) };
}

/** Sum of monthly contributions required to hit every project's target date. */
export function requiredForTargets({ projects, interestPct, inflationPct, now = new Date() }) {
  let total = 0;
  const rows = [];
  for (const p of projects) {
    if (!p.targetDate) continue;
    const months = monthsUntil(p.targetDate, now);
    const req = requiredMonthly({ cost: p.cost, saved: p.saved, months, interestPct, inflationPct });
    total += req.monthly;
    rows.push({ id: p.id, months, ...req });
  }
  return { total, rows };
}
