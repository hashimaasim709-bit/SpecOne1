// Bookings list, admin calendar and the phone / walk-in quick-booker (#29).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BODIES, BODY_LABELS, BOOKING_STATUSES, SLOT_ORDER, SLOTS, STATUS_META, type Body, type BookingStatus, type Size } from '../../../shared/constants';
import { addDays, formatDate, money, normReg, todayIn, weekdayOf } from '../../../shared/format';
import { labourCharge, priceFor } from '../../../shared/pricing';
import type { BookingConfig } from '../../../shared/types';
import { classifyVehicle } from '../../../shared/vehicle';
import { api } from '../../lib/api';
import { debounce } from '../../lib/ui';
import { get, send } from '../api';
import { can, go, hashQuery, type Me } from '../main';
import { Empty, Icon, PageTitle, Reg, Stale, StatusBadge, toMinor, useAction } from '../ui';

interface Row { id: number; ref: string; status: BookingStatus; date: string; slot: string; emergency: number; source: string; postcode: string; total?: number; paid_amount?: number; payment_status?: string; customer_name: string; customer_phone: string; regs: string | null; vehicles: string | null; services: string | null }

export function BookingsView({ me }: { me: Me }) {
  const q0 = hashQuery();
  const [status, setStatus] = useState(q0.get('status') ?? 'active');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [order, setOrder] = useState<'asc' | 'desc'>(q0.get('status') === 'completed' ? 'desc' : 'asc');
  const [res, setRes] = useState<{ data: { rows: Row[]; total: number }; stale: boolean; at: number } | null>(null);
  const load = useMemo(() => debounce((st: string, term: string, p: number, ord: string) => {
    const params = new URLSearchParams({ page: String(p), order: ord });
    if (st !== 'all') params.set('status', st);
    if (term) params.set('q', term);
    if (st === 'active') params.set('from', addDays(todayIn(), -1));
    get<{ rows: Row[]; total: number }>(`/bookings?${params}`).then(setRes).catch(() => undefined);
  }, 200), []);
  useEffect(() => load(status, q, page, order), [status, q, page, order]);
  const finance = can(me, 'finance.read');
  return (
    <div>
      <PageTitle title="Bookings" sub={res ? `${res.data.total} found` : 'Loading…'}>
        {can(me, 'bookings.write') && <a class="btn btn-primary" href="#/quick"><Icon name="plus" /> Quick-book</a>}
        {finance && <a class="btn" href="/api/admin/export/bookings.csv"><Icon name="download" /> CSV</a>}
      </PageTitle>
      <div class="toolbar">
        <input class="input" placeholder="Search ref, name, phone, postcode or reg" value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setPage(1); }} />
        <select class="select" value={status} onChange={(e) => { const v = (e.target as HTMLSelectElement).value; setStatus(v); setOrder(v === 'active' || v === 'pending' || v === 'confirmed' ? 'asc' : 'desc'); setPage(1); }}>
          <option value="active">Upcoming &amp; active</option>
          <option value="all">All bookings</option>
          {BOOKING_STATUSES.map((s) => <option value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <button class="btn btn-ghost btn-sm" type="button" onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}>{order === 'asc' ? 'Soonest first' : 'Latest first'}</button>
      </div>
      {res && <Stale stale={res.stale} at={res.at} />}
      {!res ? <div class="skeleton" style="height:300px" /> : res.data.rows.length === 0 ? <Empty>No bookings match.</Empty> : (
        <div class="dtable-wrap">
          <table class="dtable">
            <thead><tr><th>When</th><th>Ref</th><th>Customer</th><th>Vehicle</th><th>Services</th><th>Status</th>{finance && <th class="num">Total</th>}</tr></thead>
            <tbody>{res.data.rows.map((r) => (
              <tr onClick={() => go(`bookings/${r.id}`)}>
                <td class="mono">{formatDate(r.date, 'day')}<br /><span class="faint">{r.emergency ? 'EMERGENCY' : SLOTS[r.slot as keyof typeof SLOTS]?.label ?? r.slot}</span></td>
                <td class="mono">{r.ref}</td>
                <td>{r.customer_name}<br /><span class="faint">{r.customer_phone}</span></td>
                <td>{(r.regs ?? '').split(',').filter(Boolean).slice(0, 2).map((g) => <Reg reg={g.trim()} />)}<br /><span class="faint">{r.vehicles}</span></td>
                <td style="max-width:260px">{r.services}</td>
                <td><StatusBadge status={r.status} />{r.payment_status === 'paid' && <><br /><span class="badge badge-good" style="margin-top:4px">Paid</span></>}</td>
                {finance && <td class="num">{money(r.total ?? 0, 'GBP')}</td>}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {res && res.data.total > 50 && <div class="pager"><button class="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {Math.ceil(res.data.total / 50)}</span><button class="btn btn-sm" disabled={page * 50 >= res.data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
    </div>
  );
}

interface CalData { month: string; bookings: { id: number; ref: string; date: string; slot: string; status: BookingStatus; emergency: number; customer_name: string; regs: string | null }[]; blocked: { date: string; reason: string }[]; availability: { date: string; closed: boolean; reason: string; slots: Record<string, number> }[] }

export function CalendarView({ me }: { me: Me }) {
  const [month, setMonth] = useState(todayIn().slice(0, 7));
  const [data, setData] = useState<CalData | null>(null);
  const [busy, act] = useAction();
  const load = () => get<CalData>(`/calendar?month=${month}`).then((r) => setData(r.data)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, [month]);
  const shift = (n: number) => {
    const d = new Date(`${month}-01T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const first = `${month}-01`;
  const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const lead = (weekdayOf(first) + 6) % 7;
  const today = todayIn();
  const toggleBlock = async (date: string, blocked: boolean) => {
    const reason = blocked ? '' : prompt('Reason for blocking this day? (e.g. holiday, training)') ?? null;
    if (reason === null) return;
    await act(() => send('/blocked-dates', { date, blocked: !blocked, reason }), blocked ? 'Day reopened' : 'Day blocked');
    void load();
  };
  return (
    <div>
      <PageTitle title="Calendar" sub="Tap a day number to block or reopen it. Blocked days disappear from online booking.">
        <button class="btn btn-icon" type="button" onClick={() => shift(-1)} aria-label="Previous month"><Icon name="back" /></button>
        <b class="mono" style="min-width:110px;text-align:center">{new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`))}</b>
        <button class="btn btn-icon" type="button" onClick={() => shift(1)} aria-label="Next month"><Icon name="arrow" /></button>
      </PageTitle>
      {!data ? <div class="skeleton" style="height:500px" /> : (
        <div class="cal-admin">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div class="cal-dow">{d}</div>)}
          {Array.from({ length: lead }, () => <div />)}
          {Array.from({ length: dim }, (_, i) => {
            const date = `${month}-${String(i + 1).padStart(2, '0')}`;
            const blocked = data.blocked.find((b) => b.date === date);
            const jobs = data.bookings.filter((b) => b.date === date);
            const avail = data.availability.find((a) => a.date === date);
            const open = avail ? Object.values(avail.slots).reduce((a, n) => a + n, 0) : 0;
            return (
              <div class={`cal-cell${blocked ? ' blocked' : ''}${date === today ? ' today' : ''}`}>
                <div class="d">
                  <button type="button" style="background:none;border:0;padding:0;font:inherit;color:inherit" disabled={busy || !can(me, 'bookings.write') || date < today} onClick={() => toggleBlock(date, !!blocked)} title={blocked ? `Blocked: ${blocked.reason}` : 'Block this day'}>{i + 1}</button>
                  {!blocked && date >= today && <span class="faint" style="font-size:.66rem">{open} open</span>}
                </div>
                {blocked && <span class="faint" style="font-size:.66rem">{blocked.reason || 'Blocked'}</span>}
                {jobs.map((j) => <a href={`#/bookings/${j.id}`} class={`st-${j.status}`} title={`${j.ref} · ${j.customer_name}`}>{j.emergency ? '🚨 ' : ''}{j.slot === 'asap' ? 'ASAP' : j.slot.slice(0, 2).toUpperCase()} · {j.customer_name.split(' ')[0]}</a>)}
              </div>
            );
          })}
        </div>
      )}
      <div class="row" style="margin-top:16px"><a class="btn btn-ghost btn-sm" href="#/settings/business"><Icon name="settings" /> Opening hours &amp; windows</a><a class="btn btn-ghost btn-sm" href="#/settings/booking"><Icon name="calendar" /> Calendar sync (Samsung / Google)</a></div>
    </div>
  );
}

interface Line { name: string; unitPrice: string; qty: string; kind: 'labour' | 'part' | 'custom' }

export function QuickBookView({ me }: { me: Me }) {
  const [cfg, setCfg] = useState<BookingConfig | null>(null);
  const [f, setF] = useState({
    source: 'phone' as 'phone' | 'walk_in', name: '', phone: '', email: '', reg: '', make: '', model: '', size: 'M' as Size, body: 'hatchback' as Body,
    packageIds: [] as number[], date: todayIn(), slot: 'morning' as string, emergency: false, address: '', postcode: '', notes: '', status: 'confirmed' as 'confirmed' | 'completed',
    payMethod: '' as '' | 'card' | 'cash' | 'bank_transfer' | 'sumup', notify: true,
  });
  const [lines, setLines] = useState<Line[]>([]);
  const [labour, setLabour] = useState({ hours: '1', rate: '' });
  const [owner, setOwner] = useState('');
  const [done, setDone] = useState<{ id: number; ref: string; total: number; invoiceUrl: string; trackUrl: string } | null>(null);
  const [busy, act] = useAction();
  useEffect(() => {
    api<BookingConfig>('/api/public/booking-config').then((c) => {
      setCfg(c);
      setLabour((l) => ({ ...l, rate: c.pricing.labourRates[0]?.key ?? '' }));
    }).catch(() => undefined);
  }, []);
  if (!cfg) return <div class="skeleton" style="height:400px" />;
  const set = (p: Partial<typeof f>) => setF((prev) => ({ ...prev, ...p }));
  const finance = can(me, 'finance.write');
  const pkgTotal = f.packageIds.reduce((s, id) => s + priceFor(cfg.packages.find((p) => p.id === id)!, f.size), 0);
  const linesTotal = lines.reduce((s, l) => s + Math.round(toMinor(l.unitPrice) * Number(l.qty || 1)), 0);
  const total = pkgTotal + linesTotal;

  async function lookup() {
    const r = await act(() => send<{ make: string; model: string; year: number | null; size: Size | null; body: Body | null; owner: { name: string; phone: string; email: string; address: string; postcode: string } | null }>('/vehicle-lookup', { reg: f.reg }));
    if (!r) return;
    const guess = classifyVehicle(`${r.make} ${r.model}`);
    set({ make: f.make || r.make, model: f.model || r.model, size: r.size ?? guess.size, body: r.body ?? guess.body, ...(r.owner && !f.name ? { name: r.owner.name, phone: r.owner.phone, email: r.owner.email, address: r.owner.address, postcode: r.owner.postcode } : {}) });
    setOwner(r.owner ? `Known vehicle — last booked by ${r.owner.name}` : 'New vehicle');
  }

  async function submit() {
    const r = await act(() => send<{ id: number; ref: string; total: number; invoiceUrl: string; trackUrl: string }>('/quick-book', {
      source: f.source, customer: { name: f.name, phone: f.phone, email: f.email, marketing: false },
      vehicle: { reg: f.reg, make: f.make, model: f.model, size: f.size, body: f.body }, packageIds: f.packageIds,
      customItems: lines.filter((l) => l.name && l.unitPrice).map((l) => ({ name: l.name, unitPrice: toMinor(l.unitPrice), qty: Number(l.qty || 1), kind: l.kind })),
      date: f.date, slot: f.emergency ? 'asap' : f.slot, emergency: f.emergency, serviceMode: f.source === 'walk_in' ? 'drop_off' : 'mobile', address: f.address, postcode: f.postcode, notes: f.notes,
      status: f.status, payment: f.status === 'completed' && f.payMethod ? { method: f.payMethod, amount: total } : null, notify: f.notify,
    }), 'Booking created');
    if (r) setDone(r);
  }

  if (done) {
    return (
      <div class="panel stack" style="max-width:560px;margin:0 auto;text-align:center;gap:14px">
        <div class="success-mark" style="margin:6px auto"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
        <h2 class="display" style="font-size:2rem">{done.ref} created</h2>
        <p class="muted" style="margin:0">Total {money(done.total, 'GBP')}</p>
        <div class="row" style="justify-content:center">
          <a class="btn btn-primary" href={done.invoiceUrl} target="_blank" rel="noopener"><Icon name="file" /> Open PDF invoice</a>
          <a class="btn" href={`#/bookings/${done.id}`}>Open job card</a>
          <button class="btn btn-ghost" type="button" onClick={() => { setDone(null); setLines([]); set({ name: '', phone: '', email: '', reg: '', make: '', model: '', packageIds: [], notes: '', address: '', postcode: '' }); setOwner(''); }}>Book another</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageTitle title="Quick-book" sub="Log a phone call or walk-in and produce an invoice in seconds." />
      <div class="cols-job">
        <div class="stack">
          <div class="panel stack">
            <div class="seg" role="group"><button type="button" aria-pressed={f.source === 'phone'} onClick={() => set({ source: 'phone' })}>Phone booking</button><button type="button" aria-pressed={f.source === 'walk_in'} onClick={() => set({ source: 'walk_in' })}>Walk-in / drop-off</button></div>
            <div class="field"><label>Registration</label><div class="input-group"><input class="input mono" style="text-transform:uppercase;font-size:1.2rem;letter-spacing:.06em" value={f.reg} onInput={(e) => set({ reg: (e.target as HTMLInputElement).value.toUpperCase() })} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="AB12 CDE" /><button class="btn" type="button" onClick={lookup} disabled={busy || normReg(f.reg).length < 2}>Look up</button></div>{owner && <span class="hint">{owner}</span>}</div>
            <div class="form-grid">
              <div class="field"><label>Make</label><input class="input" value={f.make} onInput={(e) => set({ make: (e.target as HTMLInputElement).value })} /></div>
              <div class="field"><label>Model</label><input class="input" value={f.model} onInput={(e) => { const model = (e.target as HTMLInputElement).value; set({ model, ...classifyVehicle(`${f.make} ${model}`) }); }} /></div>
            </div>
            <div class="row"><div class="seg" role="group">{(['S', 'M', 'L'] as Size[]).map((s) => <button type="button" aria-pressed={f.size === s} onClick={() => set({ size: s })}>{s === 'S' ? 'Small' : s === 'M' ? 'Medium' : 'Large'}</button>)}</div>
              <select class="select" style="width:auto;min-height:40px" value={f.body} onChange={(e) => set({ body: (e.target as HTMLSelectElement).value as Body })}>{BODIES.map((b) => <option value={b}>{BODY_LABELS[b]}</option>)}</select></div>
            <div class="form-grid">
              <div class="field"><label>Customer name</label><input class="input" value={f.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} /></div>
              <div class="field"><label>Phone</label><input class="input" type="tel" value={f.phone} onInput={(e) => set({ phone: (e.target as HTMLInputElement).value })} /></div>
            </div>
            <div class="field"><label>Email (optional)</label><input class="input" type="email" value={f.email} onInput={(e) => set({ email: (e.target as HTMLInputElement).value })} /></div>
            {f.source === 'phone' && <div class="form-grid"><div class="field"><label>Address</label><input class="input" value={f.address} onInput={(e) => set({ address: (e.target as HTMLInputElement).value })} /></div><div class="field"><label>Postcode</label><input class="input mono" value={f.postcode} onInput={(e) => set({ postcode: (e.target as HTMLInputElement).value.toUpperCase() })} /></div></div>}
          </div>
          <div class="panel stack">
            <h3>Services</h3>
            <div class="stack" style="gap:8px;max-height:340px;overflow:auto">{cfg.packages.filter((p) => p.category !== 'plan').map((p) => (
              <label class="check" style="justify-content:space-between"><span class="row" style="gap:10px;flex-wrap:nowrap"><input type="checkbox" checked={f.packageIds.includes(p.id)} onChange={() => set({ packageIds: f.packageIds.includes(p.id) ? f.packageIds.filter((x) => x !== p.id) : [...f.packageIds, p.id] })} /><span>{p.name}</span></span><span class="mono">{money(priceFor(p, f.size), 'GBP')}</span></label>
            ))}</div>
            {finance && (
              <>
                <h3 style="margin-top:8px">Labour, parts &amp; custom work</h3>
                <div class="row" style="flex-wrap:nowrap">
                  <select class="select" style="min-height:40px" value={labour.rate} onChange={(e) => setLabour({ ...labour, rate: (e.target as HTMLSelectElement).value })}>{cfg.pricing.labourRates.map((r) => <option value={r.key}>{r.label} · {money(r.rate, 'GBP')}/hr</option>)}</select>
                  <input class="input mono" style="width:80px;min-height:40px" value={labour.hours} inputMode="decimal" aria-label="Hours" onInput={(e) => setLabour({ ...labour, hours: (e.target as HTMLInputElement).value })} />
                  <button class="btn btn-sm" type="button" onClick={() => {
                    const rate = cfg.pricing.labourRates.find((r) => r.key === labour.rate);
                    if (!rate) return;
                    const amount = labourCharge(Number(labour.hours || 0), rate.rate);
                    setLines([...lines, { name: `${rate.label} — ${labour.hours} hr`, unitPrice: (amount / 100).toFixed(2), qty: '1', kind: 'labour' }]);
                  }}>Add labour</button>
                </div>
                {lines.map((l, i) => (
                  <div class="row" style="flex-wrap:nowrap">
                    <input class="input" style="min-height:40px" value={l.name} placeholder="Description" onInput={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)))} />
                    <input class="input mono" style="width:70px;min-height:40px" value={l.qty} aria-label="Qty" onInput={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: (e.target as HTMLInputElement).value } : x)))} />
                    <input class="input mono" style="width:100px;min-height:40px" value={l.unitPrice} placeholder="£" aria-label="Unit price" onInput={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unitPrice: (e.target as HTMLInputElement).value } : x)))} />
                    <button class="btn btn-icon btn-ghost" type="button" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="x" /></button>
                  </div>
                ))}
                <button class="btn btn-sm btn-ghost" style="align-self:flex-start" type="button" onClick={() => setLines([...lines, { name: '', unitPrice: '', qty: '1', kind: 'part' }])}><Icon name="plus" /> Part or custom line</button>
              </>
            )}
          </div>
        </div>
        <div class="stack summary" style="top:80px">
          <div class="panel stack">
            <h3>When</h3>
            <label class="check"><input type="checkbox" checked={f.emergency} onChange={(e) => set({ emergency: (e.target as HTMLInputElement).checked })} /><span>Emergency call-out</span></label>
            <div class="form-grid"><div class="field"><label>Date</label><input class="input" type="date" value={f.date} onInput={(e) => set({ date: (e.target as HTMLInputElement).value })} /></div>
              {!f.emergency && <div class="field"><label>Window</label><select class="select" value={f.slot} onChange={(e) => set({ slot: (e.target as HTMLSelectElement).value })}>{SLOT_ORDER.map((s) => <option value={s}>{SLOTS[s].label} · {SLOTS[s].window}</option>)}</select></div>}</div>
            <div class="field"><label>Notes</label><textarea class="textarea" value={f.notes} onInput={(e) => set({ notes: (e.target as HTMLTextAreaElement).value })} /></div>
            <div class="seg" role="group"><button type="button" aria-pressed={f.status === 'confirmed'} onClick={() => set({ status: 'confirmed' })}>Book for later</button><button type="button" aria-pressed={f.status === 'completed'} onClick={() => set({ status: 'completed' })}>Done now — invoice</button></div>
            {f.status === 'completed' && <div class="field"><label>Paid by</label><select class="select" value={f.payMethod} onChange={(e) => set({ payMethod: (e.target as HTMLSelectElement).value as typeof f.payMethod })}><option value="">Not paid yet</option><option value="card">Card</option><option value="sumup">SumUp reader</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option></select></div>}
            <label class="check"><input type="checkbox" checked={f.notify} onChange={(e) => set({ notify: (e.target as HTMLInputElement).checked })} /><span>Text / email the customer their confirmation &amp; tracker link</span></label>
            <div class="summary-total"><span class="muted">Total</span><b>{money(total, 'GBP')}</b></div>
            <button class="btn btn-primary btn-lg" type="button" disabled={busy || !f.name || !f.phone || normReg(f.reg).length < 2 || (!f.packageIds.length && !lines.length)} onClick={submit}>{f.status === 'completed' ? 'Create & invoice' : 'Create booking'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
