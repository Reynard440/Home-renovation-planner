import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../js/finance.js';

const close = (a, b, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} !~ ${b}`);

test('monthlyRate compounds back to the annual rate', () => {
  close(Math.pow(1 + F.monthlyRate(7), 12) - 1, 0.07, 1e-12);
  assert.equal(F.monthlyRate(0), 0);
});

test('R50k in 10 months, no interest/inflation = R5k/month', () => {
  const r = F.requiredMonthly({ cost: 50000, months: 10 });
  close(r.monthly, 5000);
});

test('existing savings reduce the requirement', () => {
  close(F.requiredMonthly({ cost: 50000, saved: 20000, months: 10 }).monthly, 3000);
});

test('already funded = 0/month', () => {
  assert.equal(F.requiredMonthly({ cost: 1000, saved: 2000, months: 5 }).monthly, 0);
});

test('target date in the past flags overdue and asks for full shortfall now', () => {
  const r = F.requiredMonthly({ cost: 1000, saved: 400, months: 0 });
  assert.equal(r.overdue, true);
  close(r.monthly, 600);
});

test('requiredMonthly and monthsToAfford agree (round trip with interest + inflation)', () => {
  const args = { cost: 50000, saved: 5000, interestPct: 7, inflationPct: 6 };
  const req = F.requiredMonthly({ ...args, months: 24 });
  const back = F.monthsToAfford({ ...args, monthly: req.monthly + 0.01 });
  assert.equal(back.months, 24);
});

test('inflation makes it take longer; interest makes it faster', () => {
  const base = F.monthsToAfford({ cost: 50000, monthly: 2000 }).months;
  const infl = F.monthsToAfford({ cost: 50000, monthly: 2000, inflationPct: 8 }).months;
  const intr = F.monthsToAfford({ cost: 50000, monthly: 2000, interestPct: 8 }).months;
  assert.equal(base, 25);
  assert.ok(infl > base);
  assert.ok(intr < base);
});

test('contributions that cannot outrun inflation return null', () => {
  assert.equal(F.monthsToAfford({ cost: 1_000_000, monthly: 10, inflationPct: 10 }), null);
});

test('projectCosts: contingency, paid items, saved, shortfall', () => {
  const p = {
    items: [
      { qty: 2, unitCost: 1000, type: 'Materials' },
      { qty: 1, unitCost: 3000, type: 'Labour', paid: true },
    ],
    contributions: [{ amount: 500 }],
  };
  const c = F.projectCosts(p, 10);
  assert.equal(c.base, 5000);
  assert.equal(c.paid, 3000);
  close(c.total, 5500);
  close(c.outstanding, 2200);
  close(c.shortfall, 1700);
  assert.deepEqual(c.byType, { Materials: 2000, Labour: 3000 });
});

test('projectCosts survives garbage input', () => {
  const c = F.projectCosts({ items: [{ qty: 'abc', unitCost: -5 }, {}] }, undefined);
  assert.equal(c.base, 0);
  assert.equal(c.progress, 1);
});

test('portfolio priority waterfall funds #1 first, then #2', () => {
  const sim = F.simulatePortfolio({
    projects: [{ id: 'a', cost: 10000, saved: 0 }, { id: 'b', cost: 10000, saved: 0 }],
    capacity: 1000,
  });
  assert.equal(sim.results.a.month, 10);
  assert.equal(sim.results.b.month, 20);
});

test('proportional finishes everything at about the same time (later first win)', () => {
  const sim = F.simulatePortfolio({
    projects: [{ id: 'a', cost: 10000, saved: 0 }, { id: 'b', cost: 10000, saved: 0 }],
    capacity: 1000, strategy: 'proportional',
  });
  assert.equal(sim.results.a.month, 20);
  assert.equal(sim.results.b.month, 20);
});

test('snowball does the smallest first regardless of list order', () => {
  const sim = F.simulatePortfolio({
    projects: [{ id: 'big', cost: 30000, saved: 0 }, { id: 'small', cost: 5000, saved: 0 }],
    capacity: 1000, strategy: 'snowball',
  });
  assert.equal(sim.results.small.month, 5);
  assert.equal(sim.results.big.month, 35);
});

test('portfolio with zero capacity reports unfunded instead of looping forever', () => {
  const sim = F.simulatePortfolio({ projects: [{ id: 'a', cost: 100, saved: 0 }], capacity: 0, max: 24 });
  assert.deepEqual(sim.unfunded, ['a']);
});

test('monthsUntil is calendar-based and never negative', () => {
  const now = new Date(2026, 10, 3);
  assert.equal(F.monthsUntil('2027-11-01', now), 12);
  assert.equal(F.monthsUntil('2020-01-01', now), 0);
  assert.equal(F.monthsUntil('', now), null);
});

test('portfolio records when each project starts receiving money', () => {
  const sim = F.simulatePortfolio({
    projects: [{ id: 'a', cost: 3000, saved: 0 }, { id: 'b', cost: 3000, saved: 0 }],
    capacity: 1000,
  });
  assert.equal(sim.results.a.start, 0);
  assert.equal(sim.results.b.start, 3);
  assert.equal(sim.results.b.month, 6);
});
