// Persistence: browser localStorage with schema versioning + JSON backup/restore.
const KEY = 'bhr.state.v1';
export const SCHEMA_VERSION = 1;

export const ITEM_TYPES = ['Materials', 'Labour', 'Equipment hire', 'Professional fees', 'Permits & compliance', 'Delivery & removal', 'Fixtures & appliances', 'Other'];
export const QUOTE_STATUS = ['Estimate', 'Quoted', 'Purchased'];
export const PROJECT_STATUS = ['Planning', 'Saving', 'Funded', 'In progress', 'Done'];
export const CATEGORIES = ['Kitchen', 'Bathroom', 'Bedroom', 'Living areas', 'Exterior & garden', 'Roof & structure', 'Energy & solar', 'Security', 'Plumbing & electrical', 'Other'];

export const defaultSettings = () => ({
  monthlyCapacity: 5000,
  interestPct: 7,
  inflationPct: 6,
  contingencyPct: 15,
  strategy: 'priority',
  currency: 'ZAR',
  locale: 'en-ZA',
});

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

export function emptyState() {
  return { version: SCHEMA_VERSION, settings: defaultSettings(), projects: [], updatedAt: new Date().toISOString() };
}

/** Validates & normalises anything that claims to be app state. Throws on garbage. */
export function normalise(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.projects)) throw new Error('Not a Budget Home Renovations backup file.');
  const s = { ...defaultSettings(), ...(raw.settings || {}) };
  const projects = raw.projects.map((p) => ({
    id: String(p.id || uid()),
    name: String(p.name || 'Untitled project').slice(0, 120),
    category: CATEGORIES.includes(p.category) ? p.category : 'Other',
    status: PROJECT_STATUS.includes(p.status) ? p.status : 'Planning',
    targetDate: typeof p.targetDate === 'string' ? p.targetDate : '',
    plannedMonthly: Number(p.plannedMonthly) || 0,
    contingencyPct: p.contingencyPct === '' || p.contingencyPct == null ? null : Number(p.contingencyPct),
    notes: String(p.notes || ''),
    createdAt: p.createdAt || new Date().toISOString(),
    items: (Array.isArray(p.items) ? p.items : []).map((i) => ({
      id: String(i.id || uid()),
      name: String(i.name || 'Item'),
      type: ITEM_TYPES.includes(i.type) ? i.type : 'Other',
      qty: Number(i.qty) || 0,
      unit: String(i.unit || ''),
      unitCost: Number(i.unitCost) || 0,
      supplier: String(i.supplier || ''),
      quoteStatus: QUOTE_STATUS.includes(i.quoteStatus) ? i.quoteStatus : 'Estimate',
      paid: !!i.paid,
    })),
    contributions: (Array.isArray(p.contributions) ? p.contributions : []).map((c) => ({
      id: String(c.id || uid()),
      date: String(c.date || new Date().toISOString().slice(0, 10)),
      amount: Number(c.amount) || 0,
      note: String(c.note || ''),
    })),
  }));
  return { version: SCHEMA_VERSION, settings: s, projects, updatedAt: raw.updatedAt || new Date().toISOString() };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalise(JSON.parse(raw));
  } catch (e) {
    console.error('Failed to load state', e);
    return null;
  }
}

export function save(state) {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error('Failed to save state', e);
    return false;
  }
}

export function sampleState() {
  const st = emptyState();
  const today = new Date();
  const iso = (monthsAhead) => {
    const d = new Date(today.getFullYear(), today.getMonth() + monthsAhead, 1);
    return d.toISOString().slice(0, 10);
  };
  const item = (name, type, qty, unit, unitCost, extra = {}) => ({ id: uid(), name, type, qty, unit, unitCost, supplier: '', quoteStatus: 'Estimate', paid: false, ...extra });
  st.projects = [
    {
      id: uid(), name: 'Main bathroom refresh', category: 'Bathroom', status: 'Saving', targetDate: iso(10), plannedMonthly: 3000, contingencyPct: null, notes: 'Retile floor + shower, new vanity. Keep plumbing in the same place to save cost.', createdAt: today.toISOString(),
      items: [
        item('Porcelain floor & wall tiles', 'Materials', 22, 'm²', 320, { supplier: 'Tile supplier', quoteStatus: 'Quoted' }),
        item('Tile adhesive, grout, waterproofing', 'Materials', 1, 'lot', 3800),
        item('Vanity with basin & mixer', 'Fixtures & appliances', 1, 'unit', 8500),
        item('Shower glass panel', 'Fixtures & appliances', 1, 'unit', 6500),
        item('Tiler labour', 'Labour', 6, 'days', 1400, { quoteStatus: 'Quoted' }),
        item('Plumber (strip & refit)', 'Labour', 1, 'job', 7500),
        item('Rubble skip', 'Delivery & removal', 1, 'skip', 1800),
      ],
      contributions: [{ id: uid(), date: iso(-2), amount: 4000, note: 'Started saving' }, { id: uid(), date: iso(-1), amount: 3000, note: '' }],
    },
    {
      id: uid(), name: 'Backup power (inverter + battery)', category: 'Energy & solar', status: 'Planning', targetDate: iso(8), plannedMonthly: 0, contingencyPct: 10, notes: 'Must get a Certificate of Compliance (CoC) from a registered electrician.', createdAt: today.toISOString(),
      items: [
        item('5kW hybrid inverter', 'Fixtures & appliances', 1, 'unit', 18000),
        item('5kWh lithium battery', 'Fixtures & appliances', 1, 'unit', 22000),
        item('Cabling, DB changes, isolators', 'Materials', 1, 'lot', 6000),
        item('Installation', 'Labour', 1, 'job', 8000),
        item('Electrical CoC', 'Permits & compliance', 1, 'cert', 1500),
      ],
      contributions: [],
    },
    {
      id: uid(), name: 'Kitchen cupboards & countertops', category: 'Kitchen', status: 'Planning', targetDate: '', plannedMonthly: 0, contingencyPct: 20, notes: 'Get at least 3 quotes. Quotes usually expire after 30 days — re-quote when funded.', createdAt: today.toISOString(),
      items: [
        item('Carcasses & doors (melamine)', 'Materials', 1, 'lot', 45000),
        item('Quartz countertop', 'Materials', 6, 'm', 4200),
        item('Installation', 'Labour', 1, 'job', 12000),
        item('Electrician (new plug points)', 'Labour', 1, 'job', 3500),
        item('Removal of old units', 'Delivery & removal', 1, 'job', 2000),
      ],
      contributions: [],
    },
  ];
  return st;
}

export function downloadJSON(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `budget-home-renovations-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function downloadCSV(state) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Project', 'Category', 'Status', 'Item', 'Type', 'Qty', 'Unit', 'Unit cost', 'Line total', 'Supplier', 'Quote status', 'Paid']];
  for (const p of state.projects) {
    for (const i of p.items) rows.push([p.name, p.category, p.status, i.name, i.type, i.qty, i.unit, i.unitCost, (i.qty * i.unitCost).toFixed(2), i.supplier, i.quoteStatus, i.paid ? 'Yes' : 'No']);
  }
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `budget-home-renovations-items-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
