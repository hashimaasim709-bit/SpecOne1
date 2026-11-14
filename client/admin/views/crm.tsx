// CRM: customer profile with lifetime value (#18) and the permanent per-plate history (#21).
import { useEffect, useState } from 'preact/hooks';
import type { BookingStatus } from '../../../shared/constants';
import { displayPhone, formatDate, money } from '../../../shared/format';
import { get, send } from '../api';
import { can, go, type Me } from '../main';
import { Empty, Icon, Modal, PageTitle, Reg, Stale, StatusBadge, useAction } from '../ui';
import { ResourceForm } from './resources';

interface CustomerData {
  customer: { id: number; name: string; email: string; phone: string; address: string; postcode: string; company: string; notes: string; tags: string; loyalty_points: number; referral_code: string; marketing_opt_in: number; created_at: string };
  vehicles: { id: number; reg: string; make: string; model: string; year: number | null; mot_due: string | null; notes: string }[];
  bookings: { id: number; ref: string; date: string; status: BookingStatus; total?: number; services: string }[];
  ledger: { points: number; reason: string; created_at: string }[];
  subscriptions: { id: number; status: string; next_visit_on: string | null; plan: string }[];
  referred: { id: number; name: string; created_at: string }[];
  ltv: { spend: number; jobs: number } | null;
}

export function CustomerView({ id, me }: { id: number; me: Me }) {
  const [res, setRes] = useState<{ data: CustomerData; stale: boolean; at: number } | null>(null);
  const [edit, setEdit] = useState(false);
  const [points, setPoints] = useState<{ points: string; reason: string } | null>(null);
  const [merge, setMerge] = useState('');
  const [busy, act] = useAction();
  const load = () => get<CustomerData>(`/customers/${id}`).then(setRes).catch(() => undefined);
  useEffect(() => {
    void load();
  }, [id]);
  if (!res) return <div class="skeleton" style="height:400px" />;
  const d = res.data;
  const c = d.customer;
  return (
    <div>
      <PageTitle title={c.name} sub={`Customer since ${formatDate(c.created_at.slice(0, 10))}${c.company ? ` · ${c.company}` : ''}`}>
        <a class="btn" href={`tel:${c.phone}`}><Icon name="phone" /> {displayPhone(c.phone)}</a>
        <a class="btn" href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noopener"><Icon name="wa" /> WhatsApp</a>
        {can(me, 'crm.write') && <button class="btn" type="button" onClick={() => setEdit(true)}><Icon name="pen" /> Edit</button>}
        {can(me, 'bookings.write') && <a class="btn btn-primary" href="#/quick">New booking</a>}
      </PageTitle>
      <Stale stale={res.stale} at={res.at} />
      <div class="stats" style="margin-bottom:16px">
        {d.ltv && <div class="stat accent"><small>Lifetime value</small><b>{money(d.ltv.spend, 'GBP')}</b><span>{d.ltv.jobs} completed job{d.ltv.jobs === 1 ? '' : 's'}{d.ltv.jobs ? ` · avg ${money(Math.round(d.ltv.spend / d.ltv.jobs), 'GBP')}` : ''}</span></div>}
        <div class="stat"><small>Vehicles</small><b>{d.vehicles.length}</b></div>
        <div class="stat"><small>Loyalty points</small><b>{c.loyalty_points}</b><span>Referral code {c.referral_code}</span></div>
        <div class="stat"><small>Referred friends</small><b>{d.referred.length}</b></div>
      </div>
      <div class="cols-job">
        <div class="stack">
          {c.notes && <div class="alert alert-info"><Icon name="alert" /><span><b>Permanent client notes:</b> {c.notes}</span></div>}
          <div class="panel"><div class="panel-head"><h3>Bookings</h3></div>
            {d.bookings.length ? <div class="list">{d.bookings.map((b) => <a class="list-row" href={`#/bookings/${b.id}`}><span class="mono">{b.ref}</span><span class="grow"><b>{b.services}</b><span>{formatDate(b.date)}</span></span>{b.total != null && <span class="mono">{money(b.total, 'GBP')}</span>}<StatusBadge status={b.status} /></a>)}</div> : <Empty>No bookings.</Empty>}
          </div>
        </div>
        <div class="stack">
          <div class="panel"><div class="panel-head"><h3>Vehicles</h3></div>
            {d.vehicles.map((v) => <a class="list-row" href={`#/vehicles/${v.reg}`}><Reg reg={v.reg} /><span class="grow"><b>{[v.year, v.make, v.model].filter(Boolean).join(' ')}</b><span>{v.mot_due ? `MOT ${formatDate(v.mot_due)}` : 'Full history →'}</span></span></a>)}
          </div>
          <div class="panel stack" style="gap:8px">
            <h3>Contact</h3>
            <dl class="kv"><dt>Email</dt><dd>{c.email || '—'}</dd><dt>Address</dt><dd>{[c.address, c.postcode].filter(Boolean).join(', ') || '—'}</dd><dt>Reminders</dt><dd>{c.marketing_opt_in ? 'Opted in' : 'Not opted in'}</dd><dt>Tags</dt><dd>{c.tags || '—'}</dd></dl>
          </div>
          {d.subscriptions.length > 0 && <div class="panel"><h3 style="margin-bottom:8px">Plans</h3>{d.subscriptions.map((s) => <a class="list-row" href={`#/r/subscriptions/${s.id}`}><span class="grow"><b>{s.plan}</b><span>{s.status}{s.next_visit_on ? ` · next ${formatDate(s.next_visit_on)}` : ''}</span></span></a>)}</div>}
          <div class="panel">
            <div class="panel-head"><h3>Loyalty ledger</h3>{can(me, 'finance.write') && <button class="btn btn-sm" type="button" onClick={() => setPoints({ points: '', reason: '' })}>Adjust</button>}</div>
            {d.ledger.length ? d.ledger.slice(0, 12).map((l) => <div class="summary-line"><span>{l.reason}<br /><span class="faint" style="font-size:.74rem">{formatDate(l.created_at.slice(0, 10))}</span></span><span style={{ color: l.points > 0 ? 'var(--good)' : undefined }}>{l.points > 0 ? '+' : ''}{l.points}</span></div>) : <p class="faint" style="margin:0">No points activity.</p>}
          </div>
          {can(me, 'crm.write') && (
            <div class="panel stack" style="gap:8px">
              <h3>Merge duplicate</h3>
              <p class="faint" style="margin:0;font-size:.84rem">Moves another customer's bookings, vehicles and points into this record, then deletes the duplicate.</p>
              <div class="input-group"><input class="input mono" placeholder="Duplicate customer ID" value={merge} onInput={(e) => setMerge((e.target as HTMLInputElement).value)} /><button class="btn" type="button" disabled={busy || !Number(merge)} onClick={async () => { if (confirm(`Merge customer #${merge} into ${c.name}?`) && (await act(() => send('/customers/merge', { keepId: c.id, mergeId: Number(merge) }), 'Merged'))) { setMerge(''); void load(); } }}>Merge</button></div>
            </div>
          )}
        </div>
      </div>
      {edit && <ResourceForm resourceKey="customers" id={String(id)} me={me} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); void load(); }} />}
      {points && (
        <Modal title="Adjust loyalty points" onClose={() => setPoints(null)}>
          <div class="stack">
            <div class="field"><label>Points (negative to deduct)</label><input class="input mono" value={points.points} onInput={(e) => setPoints({ ...points, points: (e.target as HTMLInputElement).value })} /></div>
            <div class="field"><label>Reason</label><input class="input" value={points.reason} onInput={(e) => setPoints({ ...points, reason: (e.target as HTMLInputElement).value })} placeholder="Goodwill gesture" /></div>
            <button class="btn btn-primary" type="button" disabled={busy || !Number(points.points) || points.reason.length < 2} onClick={async () => { if (await act(() => send(`/customers/${id}/loyalty`, { points: Number(points.points), reason: points.reason }), 'Points updated')) { setPoints(null); void load(); } }}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface VehicleData {
  reg: string;
  vehicle: { id: number; reg: string; make: string; model: string; year: number | null; vin: string; fuel: string; colour: string; mot_due: string | null; notes: string; customer_id: number | null } | null;
  jobs: { id: number; ref: string; date: string; status: BookingStatus; findings: string; customer_name: string; services: string }[];
  dpf: Record<string, unknown>[]; battery: Record<string, unknown>[]; flash: Record<string, unknown>[];
  freeze: { id: number; title: string; dtc: string; captured_on: string; data: { pid: string; value: string; unit: string; expected: string }[]; notes: string }[];
  checklists: { id: number; kind: string; score: number | null; max_score: number | null; completed_at: string | null; name: string }[];
}

export function VehicleView({ reg, me }: { reg: string; me: Me }) {
  const [res, setRes] = useState<{ data: VehicleData; stale: boolean; at: number } | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, act] = useAction();
  useEffect(() => {
    get<VehicleData>(`/vehicles/history/${encodeURIComponent(reg)}`).then((r) => {
      setRes(r);
      setNotes(r.data.vehicle?.notes ?? '');
    }).catch(() => undefined);
  }, [reg]);
  if (!res) return <div class="skeleton" style="height:400px" />;
  const d = res.data;
  const v = d.vehicle;
  return (
    <div>
      <PageTitle title={`${v ? [v.year, v.make, v.model].filter(Boolean).join(' ') : 'Vehicle'}`} sub={<><Reg reg={d.reg} /> {v?.vin ? <span class="mono"> VIN {v.vin}</span> : null}{v?.colour ? ` · ${v.colour}` : ''}{v?.fuel ? ` · ${v.fuel}` : ''}</>}>
        {v?.customer_id && <a class="btn" href={`#/customers/${v.customer_id}`}><Icon name="users" /> Current keeper</a>}
        {v && can(me, 'crm.write') && <a class="btn btn-ghost" href={`#/r/vehicles/${v.id}`}><Icon name="pen" /> Edit</a>}
      </PageTitle>
      <Stale stale={res.stale} at={res.at} />
      {!v ? <Empty icon="car">No record for this registration yet.</Empty> : (
        <div class="cols-job">
          <div class="stack">
            <div class="panel"><div class="panel-head"><h3>Service history</h3><span class="faint mono" style="font-size:.7rem">FOLLOWS THE PLATE</span></div>
              {d.jobs.length ? <ol class="timeline">{d.jobs.map((j) => <li class={j.status === 'completed' ? 'done' : ''}><span class="node" /><span><b><a href={`#/bookings/${j.id}`}>{j.ref}</a> · {formatDate(j.date)} · {j.customer_name}</b><small>{j.services}{j.findings ? ` — ${j.findings.slice(0, 200)}` : ''}</small></span></li>)}</ol> : <p class="faint">No jobs yet.</p>}
            </div>
            {d.freeze.length > 0 && <div class="panel"><h3 style="margin-bottom:10px">Freeze-frame &amp; live data</h3>{d.freeze.map((f) => <details style="margin-bottom:10px"><summary style="cursor:pointer"><b>{f.dtc ? `${f.dtc} · ` : ''}{f.title}</b> <span class="faint">{formatDate(f.captured_on)}</span></summary><div class="dtable-wrap" style="margin-top:8px"><table class="dtable"><thead><tr><th>Parameter</th><th class="num">Value</th><th>Unit</th><th>Expected</th></tr></thead><tbody>{f.data.map((r) => <tr style="cursor:default"><td>{r.pid}</td><td class="num">{r.value}</td><td>{r.unit}</td><td>{r.expected}</td></tr>)}</tbody></table></div>{f.notes && <p class="muted" style="margin:8px 0 0">{f.notes}</p>}</details>)}</div>}
          </div>
          <div class="stack">
            <div class="panel stack" style="gap:8px">
              <h3>Permanent vehicle notes</h3>
              <textarea class="textarea" value={notes} disabled={!can(me, 'crm.write')} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} placeholder="Known issues, coding applied, quirks, parts fitted…" />
              {can(me, 'crm.write') && <button class="btn btn-sm" style="align-self:flex-start" type="button" disabled={busy || notes === v.notes} onClick={() => act(() => send(`/vehicles/${v.id}/notes`, { notes }, 'PATCH'), 'Notes saved')}>Save notes</button>}
              {v.mot_due && <span class="muted" style="font-size:.88rem">MOT due {formatDate(v.mot_due, 'long')}</span>}
            </div>
            {d.dpf.length > 0 && <div class="panel"><h3 style="margin-bottom:8px">DPF log</h3>{d.dpf.map((x) => <div class="summary-line"><span>{formatDate(String(x.logged_on))} · {String(x.regen_type).replace(/_/g, ' ')}</span><span>{String(x.soot_pct_before ?? '—')}% → {String(x.soot_pct_after ?? '—')}%</span></div>)}</div>}
            {d.battery.length > 0 && <div class="panel"><h3 style="margin-bottom:8px">Battery tests</h3>{d.battery.map((x) => <a class="list-row" href={`/docs/battery/${x.id}.pdf`} target="_blank" rel="noopener"><span class="grow"><b>{formatDate(String(x.tested_on))} · {String(x.verdict)}</b><span>SOH {String(x.soh_pct ?? '—')}%</span></span><Icon name="file" /></a>)}</div>}
            {d.flash.length > 0 && <div class="panel"><h3 style="margin-bottom:8px">Software / coding</h3>{d.flash.map((x) => <div class="summary-line"><span>{formatDate(String(x.flashed_on))} · {String(x.module)}</span><span>{String(x.version_after || '—')}</span></div>)}</div>}
            {d.checklists.length > 0 && <div class="panel"><h3 style="margin-bottom:8px">Inspections</h3>{d.checklists.map((x) => <a class="list-row" href={`#/checklist/${x.id}`}><span class="grow"><b>{x.name}</b><span>{x.score != null ? `${x.score}/${x.max_score}` : 'In progress'}</span></span></a>)}</div>}
          </div>
        </div>
      )}
      <button class="btn btn-ghost" style="margin-top:16px" type="button" onClick={() => history.length > 1 ? history.back() : go('dashboard')}><Icon name="back" /> Back</button>
    </div>
  );
}
