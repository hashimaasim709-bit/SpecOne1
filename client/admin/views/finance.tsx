// Reports: revenue & profit (#17), tax-year ledger & estimate (#93), customer LTV (#18),
// partner commissions (#24) and data exports (#100).
import { useEffect, useState } from 'preact/hooks';
import { formatDate, money } from '../../../shared/format';
import { get, send } from '../api';
import { ComboChart, HBars, type Point } from '../charts';
import { can, go, type Me } from '../main';
import { Empty, Icon, PageTitle, useAction } from '../ui';

interface Tax {
  year: { start: string; end: string; label: string };
  turnover: number; jobs: number; expenses: number; commission: number; profit: number;
  expenseCategories: { category: string; total: number; vat: number; n: number }[];
  months: Point[];
  estimate: { incomeTax: number; nationalInsurance: number; total: number; effectiveRate: number };
  projectedProfit: number;
  projectedEstimate: { incomeTax: number; nationalInsurance: number; total: number };
  vatThresholdNote: string;
  note: string;
}

export function ReportsView({ me }: { me: Me }) {
  const [tab, setTab] = useState<'tax' | 'customers' | 'partners' | 'exports'>('tax');
  return (
    <div>
      <PageTitle title="Reports" sub="Revenue is counted when a job is completed; costs when they are incurred." />
      <div class="chip-row" style="margin-bottom:16px">{([['tax', 'Profit & tax'], ['customers', 'Customer value'], ['partners', 'Partner commissions'], ['exports', 'Exports & data']] as const).map(([k, l]) => <button class="chip" type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'tax' && <TaxReport />}
      {tab === 'customers' && <LtvReport />}
      {tab === 'partners' && <PartnersReport me={me} />}
      {tab === 'exports' && <Exports me={me} />}
    </div>
  );
}

function TaxReport() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [t, setT] = useState<Tax | null>(null);
  useEffect(() => {
    get<Tax>(`/reports/tax?date=${date}`).then((r) => setT(r.data)).catch(() => undefined);
  }, [date]);
  if (!t) return <div class="skeleton" style="height:400px" />;
  const shift = (years: number) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    setDate(`${y + years}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
  };
  return (
    <div class="stack" style="gap:16px">
      <div class="row"><button class="btn btn-icon btn-sm" type="button" onClick={() => shift(-1)} aria-label="Previous tax year"><Icon name="back" /></button><b class="mono">Tax year {t.year.label}</b><span class="faint">{formatDate(t.year.start)} – {formatDate(t.year.end)}</span><button class="btn btn-icon btn-sm" type="button" onClick={() => shift(1)} aria-label="Next tax year"><Icon name="arrow" /></button></div>
      <div class="stats">
        <div class="stat"><small>Turnover</small><b>{money(t.turnover, 'GBP')}</b><span>{t.jobs} completed jobs</span></div>
        <div class="stat"><small>Expenses</small><b>{money(t.expenses, 'GBP')}</b><span>incl. {money(t.commission, 'GBP')} commission</span></div>
        <div class="stat accent"><small>Profit</small><b>{money(t.profit, 'GBP')}</b><span>Projected year-end {money(t.projectedProfit, 'GBP')}</span></div>
        <div class="stat"><small>Set aside (estimate)</small><b>{money(t.estimate.total, 'GBP')}</b><span>{Math.round(t.estimate.effectiveRate * 100)}% effective · projected {money(t.projectedEstimate.total, 'GBP')}</span></div>
      </div>
      {t.vatThresholdNote && <div class="alert alert-warn"><Icon name="alert" /><span>{t.vatThresholdNote}</span></div>}
      <div class="panel"><div class="panel-head"><h3>Month by month</h3></div><ComboChart data={t.months} currency="GBP" title={`Revenue and profit by month, tax year ${t.year.label}`} /></div>
      <div class="cols">
        <div class="panel"><div class="panel-head"><h3>Expenses by category</h3><a class="btn btn-sm btn-ghost" href="#/r/expenses">All expenses <Icon name="arrow" /></a></div><HBars currency="GBP" rows={t.expenseCategories.map((c) => ({ label: c.category, value: c.total, sub: `${c.n} item${c.n === 1 ? '' : 's'}${c.vat ? ` · VAT ${money(c.vat, 'GBP')}` : ''}` }))} /></div>
        <div class="panel stack" style="gap:8px">
          <h3>Tax estimate on profit so far</h3>
          <div class="summary-line"><span>Income tax</span><span>{money(t.estimate.incomeTax, 'GBP')}</span></div>
          <div class="summary-line"><span>Class 4 National Insurance</span><span>{money(t.estimate.nationalInsurance, 'GBP')}</span></div>
          <div class="summary-total"><span class="muted">Total</span><b style="font-size:1.4rem">{money(t.estimate.total, 'GBP')}</b></div>
          <p class="faint" style="font-size:.82rem;margin:4px 0 0">{t.note} Rates and bands are editable under Settings → Tax.</p>
        </div>
      </div>
    </div>
  );
}

function LtvReport() {
  const [d, setD] = useState<{ customers: { id: number; name: string; phone: string; jobs: number; spend: number; first_job: string | null; last_job: string | null; vehicles: number; loyalty_points: number }[]; summary: { payingCustomers: number; repeatRate: number; averageLtv: number } } | null>(null);
  useEffect(() => {
    get<NonNullable<typeof d>>('/reports/ltv?limit=200').then((r) => setD(r.data)).catch(() => undefined);
  }, []);
  if (!d) return <div class="skeleton" style="height:300px" />;
  return (
    <div class="stack" style="gap:16px">
      <div class="stats">
        <div class="stat"><small>Paying customers</small><b>{d.summary.payingCustomers}</b></div>
        <div class="stat accent"><small>Average lifetime value</small><b>{money(d.summary.averageLtv, 'GBP')}</b></div>
        <div class="stat"><small>Repeat rate</small><b>{Math.round(d.summary.repeatRate * 100)}%</b><span>booked more than once</span></div>
      </div>
      <div class="dtable-wrap"><table class="dtable"><thead><tr><th>Customer</th><th class="num">Jobs</th><th class="num">Vehicles</th><th class="num">Lifetime spend</th><th>First</th><th>Last</th><th class="num">Points</th></tr></thead>
        <tbody>{d.customers.map((c) => <tr onClick={() => go(`customers/${c.id}`)}><td>{c.name}<br /><span class="faint">{c.phone}</span></td><td class="num">{c.jobs}</td><td class="num">{c.vehicles}</td><td class="num">{money(c.spend, 'GBP')}</td><td class="mono">{c.first_job ? formatDate(c.first_job) : '—'}</td><td class="mono">{c.last_job ? formatDate(c.last_job) : '—'}</td><td class="num">{c.loyalty_points}</td></tr>)}</tbody></table></div>
    </div>
  );
}

function PartnersReport({ me }: { me: Me }) {
  const [rows, setRows] = useState<{ id: number; name: string; code: string; kind: string; commission_pct: number; referrals: number; revenue: number; owed: number; paid: number }[] | null>(null);
  const [busy, act] = useAction();
  const load = () => get<{ partners: NonNullable<typeof rows> }>('/reports/partners').then((r) => setRows(r.data.partners)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  if (!rows) return <div class="skeleton" style="height:300px" />;
  if (!rows.length) return <Empty>No trade partners yet. <a href="#/r/partners">Add one</a></Empty>;
  return (
    <div class="dtable-wrap"><table class="dtable"><thead><tr><th>Partner</th><th>Code</th><th class="num">Rate</th><th class="num">Referrals</th><th class="num">Revenue</th><th class="num">Owed</th><th class="num">Paid</th><th /></tr></thead>
      <tbody>{rows.map((p) => <tr style="cursor:default"><td><a href={`#/r/partners/${p.id}`}>{p.name}</a><br /><span class="faint">{p.kind}</span></td><td class="mono">{p.code}</td><td class="num">{p.commission_pct}%</td><td class="num">{p.referrals}</td><td class="num">{money(p.revenue, 'GBP')}</td><td class="num" style={{ color: p.owed ? 'var(--warn)' : undefined }}>{money(p.owed, 'GBP')}</td><td class="num">{money(p.paid, 'GBP')}</td>
        <td>{p.owed > 0 && can(me, 'finance.write') && <button class="btn btn-sm" type="button" disabled={busy} onClick={async () => { if (confirm(`Mark ${money(p.owed, 'GBP')} as paid to ${p.name}?`) && (await act(() => send('/commissions/pay', { partnerId: p.id }), 'Marked as paid'))) void load(); }}>Mark paid</button>}</td></tr>)}</tbody></table></div>
  );
}

function Exports({ me }: { me: Me }) {
  return (
    <div class="cols">
      <div class="panel stack" style="gap:10px">
        <h3>Spreadsheets</h3>
        {can(me, 'finance.read') && <a class="btn" href="/api/admin/export/bookings.csv"><Icon name="download" /> Bookings &amp; revenue (CSV)</a>}
        {can(me, 'finance.read') && <a class="btn" href="/api/admin/export/expenses.csv"><Icon name="download" /> Expenses (CSV)</a>}
        {can(me, 'crm.read') && <a class="btn" href="/api/admin/export/customers.csv"><Icon name="download" /> Customers (CSV)</a>}
        <p class="faint" style="margin:0;font-size:.84rem">Opens in Excel, Numbers or Google Sheets — ready for your accountant.</p>
      </div>
      {can(me, 'settings.write') && (
        <div class="panel stack" style="gap:10px">
          <h3>Everything</h3>
          <a class="btn" href="/api/admin/export/database.json"><Icon name="download" /> Full data export (JSON)</a>
          <a class="btn btn-ghost" href="#/settings/backups">Cloud backups &amp; source code →</a>
          <p class="faint" style="margin:0;font-size:.84rem">You own all of your data and the complete source code.</p>
        </div>
      )}
    </div>
  );
}
