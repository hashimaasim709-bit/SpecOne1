// Job card: everything a technician needs on site, and everything the office needs after.
import { useEffect, useRef, useState } from 'preact/hooks';
import { PAYMENT_METHODS, slotLabel, STATUS_META, type BookingStatus } from '../../../shared/constants';
import { displayPhone, formatDate, formatDateTime, money } from '../../../shared/format';
import { labourCharge } from '../../../shared/pricing';
import { compressImage } from '../../lib/api';
import { toast } from '../../lib/ui';
import { get, send, upload } from '../api';
import { can, go, hashQuery, type Me } from '../main';
import { Drawer, Empty, Icon, Modal, moneyInputValue, PageTitle, Reg, Stale, StatusBadge, toMinor, useAction } from '../ui';
import { ResourceForm } from './resources';

interface Detail {
  booking: Record<string, unknown> & { id: number; ref: string; status: BookingStatus; date: string; slot: string; emergency: number; service_mode: string; address: string; postcode: string; total: number; paid_amount: number; deposit_due: number; payment_status: string; payment_method: string; customer_notes: string; internal_notes: string; findings: string; assigned_user_id: number | null; van_id: number | null; signed_name: string; signed_at: string | null; travel_fee: number; discount: number; emergency_fee: number; currency: string; lat: number | null; lng: number | null; eta_minutes: number | null; promo_code: string };
  customer: { id: number; name: string; email: string; phone: string; address: string; notes: string; loyalty_points: number } | null;
  partner: { name: string; code: string } | null;
  vehicles: { id: number; reg: string; make: string; model: string; year: number | null; vin: string; size: string; notes: string; mot_due: string | null }[];
  items: { id: number; kind: string; name: string; qty: number; unit_price: number; vehicle_id: number | null }[];
  events: { id: number; type: string; detail: string; actor: string; public: number; created_at: string }[];
  payments: { id: number; kind: string; method: string; provider: string; amount: number; note: string; created_at: string }[];
  expenses: { id: number; description: string; category: string; amount: number; supplier: string; spent_on: string }[];
  checklists: { id: number; kind: string; status: string; score: number | null; max_score: number | null; name: string }[];
  dpf: Record<string, unknown>[]; battery: { id: number; verdict: string; soh_pct: number | null; tested_on: string }[]; flash: Record<string, unknown>[]; freeze: { id: number; title: string; dtc: string }[];
  parts: { id: number; supplier: string; status: string; items: { description: string }[]; created_at: string }[];
  users: { id: number; name: string; role: string; phone: string }[];
  vans: { id: number; name: string; reg: string }[];
  previous: { id: number; ref: string; date: string; status: BookingStatus }[];
  media: { id: number; url: string; kind: string; content_type: string; label: string }[];
  profit: { revenue: number; costs: number; commission: number; profit: number; margin: number } | null;
  commission: { amount: number; status: string; name: string } | null;
  trackUrl: string;
  whatsapp: Record<'onTheWay' | 'running' | 'arrived' | 'done' | 'review', string> | null;
  signatureUrl: string;
  canPayOnline: boolean;
  labourRates: { key: string; label: string; rate: number }[];
}

const NEXT: Partial<Record<BookingStatus, { to: BookingStatus; label: string; tone?: string }[]>> = {
  pending: [{ to: 'confirmed', label: 'Confirm booking', tone: 'btn-primary' }],
  confirmed: [{ to: 'en_route', label: 'On my way', tone: 'btn-primary' }, { to: 'arrived', label: 'Arrived' }],
  en_route: [{ to: 'arrived', label: 'Arrived', tone: 'btn-primary' }],
  arrived: [{ to: 'in_progress', label: 'Start work', tone: 'btn-primary' }],
  in_progress: [{ to: 'completed', label: 'Complete job', tone: 'btn-good' }],
  completed: [{ to: 'in_progress', label: 'Reopen job' }],
  cancelled: [{ to: 'confirmed', label: 'Reinstate' }],
  no_show: [{ to: 'confirmed', label: 'Reinstate' }],
};

export function JobCard({ id, me }: { id: number; me: Me }) {
  const [res, setRes] = useState<{ data: Detail; stale: boolean; at: number } | null>(null);
  const [tab, setTab] = useState(hashQuery().get('tab') ?? 'overview');
  const [busy, act] = useAction();
  const [drawer, setDrawer] = useState<{ key: string; initial: Record<string, unknown> } | null>(null);
  const load = () => get<Detail>(`/bookings/${id}`).then(setRes).catch(() => undefined);
  useEffect(() => {
    void load();
  }, [id]);
  if (!res) return <div class="skeleton" style="height:520px" />;
  const d = res.data;
  const b = d.booking;
  const cur = b.currency;
  const write = can(me, 'bookings.write');
  const v0 = d.vehicles[0];

  async function status(to: BookingStatus) {
    let reason = '';
    if (to === 'cancelled' || to === 'no_show') {
      const r = prompt(to === 'cancelled' ? 'Reason for cancelling?' : 'Note (optional)');
      if (r === null) return;
      reason = r;
    }
    if (to === 'completed' && b.total > b.paid_amount && !confirm(`${money(b.total - b.paid_amount, cur)} is still unpaid. Complete anyway? (You can record the payment after.)`)) return;
    const r = await act(() => send(`/bookings/${id}/status`, { status: to, reason }, 'POST', { queueable: true }), STATUS_META[to].label);
    if (r) void load();
  }

  const tabs: [string, string][] = [['overview', 'Overview'], ['sign', 'Sign-off'], ['checks', 'Checks'], ['logs', 'Tech logs'], ...(can(me, 'finance.read') || write ? [['money', 'Money'] as [string, string]] : []), ['history', 'History']];

  return (
    <div>
      <PageTitle title={b.ref} sub={<>{formatDate(b.date, 'long')} · {slotLabel(b.slot)} {b.emergency ? <span class="badge badge-bad">Emergency</span> : null} {b.service_mode === 'drop_off' ? <span class="badge">Lab drop-off</span> : null}</>}>
        <StatusBadge status={b.status} />
        <a class="btn btn-sm" href={`/docs/invoice/${id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /> Invoice</a>
        <a class="btn btn-sm" href={`/docs/report/${id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /> Report</a>
        <a class="btn btn-sm btn-ghost" href={d.trackUrl} target="_blank" rel="noopener"><Icon name="external" /> Tracker</a>
      </PageTitle>
      <Stale stale={res.stale} at={res.at} />

      {write && (
        <div class="panel spread" style="margin-bottom:16px">
          <div class="status-rail">
            {(NEXT[b.status] ?? []).map((n) => <button class={`btn ${n.tone ?? ''}`} type="button" disabled={busy} onClick={() => status(n.to)}>{n.label}</button>)}
            {['confirmed', 'en_route', 'arrived'].includes(b.status) && <button class="btn btn-ghost" type="button" disabled={busy} onClick={() => status('no_show')}>No-show</button>}
            {!['completed', 'cancelled', 'no_show'].includes(b.status) && <button class="btn btn-ghost" style="color:var(--bad)" type="button" disabled={busy} onClick={() => status('cancelled')}>Cancel</button>}
          </div>
          {d.whatsapp && (
            <div class="row">
              <span class="faint mono" style="font-size:.7rem">WHATSAPP</span>
              <a class="btn btn-sm" href={d.whatsapp.onTheWay} target="_blank" rel="noopener">On my way</a>
              <a class="btn btn-sm" href={d.whatsapp.running} target="_blank" rel="noopener">Running late</a>
              <a class="btn btn-sm" href={d.whatsapp.done} target="_blank" rel="noopener">Finished</a>
              <a class="btn btn-sm" href={d.whatsapp.review} target="_blank" rel="noopener">Ask for review</a>
            </div>
          )}
        </div>
      )}

      <div class="chip-row" style="margin-bottom:16px" role="tablist">{tabs.map(([k, l]) => <button class="chip" role="tab" type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'overview' && <Overview d={d} me={me} reload={load} />}
      {tab === 'sign' && <SignOff d={d} me={me} reload={load} />}
      {tab === 'checks' && <Checks d={d} me={me} />}
      {tab === 'logs' && (
        <div class="cols">
          <LogPanel title="DPF regeneration log" add={can(me, 'tech.write') ? () => setDrawer({ key: 'dpf_logs', initial: { reg: v0?.reg ?? '', booking_id: id } }) : undefined}>
            {d.dpf.map((x) => <div class="list-row"><span class="grow"><b>{String(x.regen_type).replace(/_/g, ' ')}</b><span>Soot {String(x.soot_pct_before ?? '—')}% → {String(x.soot_pct_after ?? '—')}% · ΔP {String(x.dp_mbar_before ?? '—')} → {String(x.dp_mbar_after ?? '—')} mbar</span></span><span class={`badge badge-${x.result === 'pass' ? 'good' : x.result === 'fail' ? 'bad' : 'warn'}`}>{String(x.result)}</span></div>)}
          </LogPanel>
          <LogPanel title="Battery & alternator" add={can(me, 'tech.write') ? () => setDrawer({ key: 'battery_tests', initial: { reg: v0?.reg ?? '', booking_id: id } }) : undefined}>
            {d.battery.map((x) => <div class="list-row"><span class="grow"><b>SOH {x.soh_pct ?? '—'}% · {x.verdict}</b><span>{formatDate(x.tested_on)}</span></span><a class="btn btn-sm" href={`/docs/battery/${x.id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /> Certificate</a></div>)}
          </LogPanel>
          <LogPanel title="Software flash / coding record" add={can(me, 'tech.write') ? () => setDrawer({ key: 'flash_log', initial: { reg: v0?.reg ?? '', booking_id: id } }) : undefined}>
            {d.flash.map((x) => <div class="list-row"><span class="grow"><b>{String(x.module)}</b><span class="mono">{String(x.version_before || '—')} → {String(x.version_after || '—')}</span></span><span class={`badge badge-${x.result === 'success' ? 'good' : 'bad'}`}>{String(x.result)}</span></div>)}
          </LogPanel>
          <LogPanel title="Freeze-frame / live data" add={can(me, 'tech.write') ? () => setDrawer({ key: 'freeze_frames', initial: { reg: v0?.reg ?? '', booking_id: id } }) : undefined}>
            {d.freeze.map((x) => <a class="list-row" href={`#/r/freeze_frames/${x.id}`}><span class="grow"><b>{x.title}</b><span class="mono">{x.dtc}</span></span><Icon name="arrow" /></a>)}
          </LogPanel>
        </div>
      )}
      {tab === 'money' && <Money d={d} me={me} reload={load} addExpense={() => setDrawer({ key: 'expenses', initial: { booking_id: id, description: '', category: 'parts' } })} />}
      {tab === 'history' && <History d={d} me={me} reload={load} />}

      {drawer && <ResourceForm resourceKey={drawer.key} initial={drawer.initial} me={me} onClose={() => setDrawer(null)} onSaved={() => { setDrawer(null); void load(); }} />}
    </div>
  );
}

function LogPanel({ title, add, children }: { title: string; add?: () => void; children: preact.ComponentChildren }) {
  const empty = !children || (Array.isArray(children) && children.length === 0);
  return <div class="panel"><div class="panel-head"><h3>{title}</h3>{add && <button class="btn btn-sm" type="button" onClick={add}><Icon name="plus" /> Add</button>}</div>{empty ? <p class="faint" style="margin:0;font-size:.88rem">Nothing logged for this job.</p> : <div class="list">{children}</div>}</div>;
}

function Overview({ d, me, reload }: { d: Detail; me: Me; reload: () => void }) {
  const b = d.booking;
  const [notes, setNotes] = useState({ findings: b.findings, internal_notes: b.internal_notes });
  const [busy, act] = useAction();
  const [listening, setListening] = useState(false);
  const recog = useRef<{ stop: () => void } | null>(null);
  const write = can(me, 'bookings.write');
  const dirty = notes.findings !== b.findings || notes.internal_notes !== b.internal_notes;

  // Voice dictation (#97) straight into the findings.
  function dictate() {
    const W = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return toast('Voice dictation is not supported in this browser — try Chrome or Safari.', { icon: 'alert' });
    if (listening) {
      recog.current?.stop();
      return;
    }
    const r = new Ctor();
    r.lang = 'en-GB';
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]!.isFinal) text += e.results[i]![0].transcript;
      if (text) setNotes((n) => ({ ...n, findings: `${n.findings}${n.findings && !n.findings.endsWith(' ') && !n.findings.endsWith('\n') ? ' ' : ''}${text.trim().replace(/^./, (c) => c.toUpperCase())}.` }));
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    recog.current = r;
    setListening(true);
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    for (const file of [...files]) {
      const blob = file.type.startsWith('video/') ? file : await compressImage(file);
      await act(() => upload(`/bookings/${b.id}/media`, blob, { label: file.name.replace(/\.[^.]+$/, '') }, file.type.startsWith('video/') ? file.name : 'photo.jpg'));
    }
    toast('Photos added');
    reload();
  }

  return (
    <div class="cols-job">
      <div class="stack">
        <div class="panel stack">
          <div class="spread"><h3>Findings &amp; work carried out</h3>{write && <button class={`btn btn-sm ${listening ? 'btn-primary' : ''}`} type="button" onClick={dictate}><span class={listening ? 'mic-on' : ''}><Icon name="mic" /></span>{listening ? 'Stop dictation' : 'Dictate'}</button>}</div>
          <textarea class="textarea" style="min-height:160px" disabled={!write} value={notes.findings} placeholder="Fault codes found, tests carried out, what was fixed, advice for the customer… This appears on the technical report." onInput={(e) => setNotes({ ...notes, findings: (e.target as HTMLTextAreaElement).value })} />
          <h3>Internal notes</h3>
          <textarea class="textarea" disabled={!write} value={notes.internal_notes} placeholder="Only visible to staff." onInput={(e) => setNotes({ ...notes, internal_notes: (e.target as HTMLTextAreaElement).value })} />
          {write && <button class="btn btn-primary" style="align-self:flex-start" type="button" disabled={busy || !dirty} onClick={async () => { if (await act(() => send(`/bookings/${b.id}`, notes, 'PATCH', { queueable: true }), 'Notes saved')) reload(); }}>Save notes</button>}
        </div>
        {b.customer_notes && <div class="panel"><h3 style="margin-bottom:8px">Customer's notes</h3><p style="margin:0;white-space:pre-wrap">{b.customer_notes}</p></div>}
        <div class="panel">
          <div class="panel-head"><h3>Photos &amp; video</h3>{write && <label class="btn btn-sm"><Icon name="camera" /> Add<input type="file" accept="image/*,video/*" capture="environment" multiple hidden onChange={(e) => addPhotos((e.target as HTMLInputElement).files)} /></label>}</div>
          {d.media.filter((m) => m.kind !== 'signature').length ? <div class="photo-grid">{d.media.filter((m) => m.kind !== 'signature').map((m) => m.content_type.startsWith('video/') ? <video src={m.url} controls style="aspect-ratio:1;width:100%;object-fit:cover;border-radius:10px" /> : <a href={m.url} target="_blank" rel="noopener" title={m.label}><img src={m.url} alt={m.label || 'Job photo'} loading="lazy" /></a>)}</div> : <p class="faint" style="margin:0;font-size:.88rem">No photos yet. Customer-uploaded warning light photos appear here too.</p>}
        </div>
      </div>
      <div class="stack">
        {d.customer && (
          <div class="panel stack" style="gap:10px">
            <div class="spread"><h3>{d.customer.name}</h3>{can(me, 'crm.read') && <a class="btn btn-sm btn-ghost" href={`#/customers/${d.customer.id}`}>Profile <Icon name="arrow" /></a>}</div>
            <div class="row"><a class="btn btn-sm" href={`tel:${d.customer.phone}`}><Icon name="phone" /> {displayPhone(d.customer.phone)}</a>{d.customer.email && <a class="btn btn-sm btn-ghost" href={`mailto:${d.customer.email}`}>Email</a>}</div>
            <div class="muted" style="font-size:.9rem">{b.address}</div>
            {b.service_mode === 'mobile' && <a class="btn btn-sm" style="align-self:flex-start" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.address)}`} target="_blank" rel="noopener"><Icon name="route" /> Navigate</a>}
            {d.customer.notes && <div class="alert alert-info"><Icon name="alert" /><span><b>Client notes:</b> {d.customer.notes}</span></div>}
            {d.partner && <span class="badge badge-info">Referred by {d.partner.name} ({d.partner.code})</span>}
            {d.previous.length > 0 && <div class="faint" style="font-size:.84rem">Previous: {d.previous.map((p, i) => <>{i ? ', ' : ''}<a href={`#/bookings/${p.id}`}>{p.ref}</a></>)}</div>}
          </div>
        )}
        <div class="panel stack" style="gap:10px">
          <h3>Vehicle{d.vehicles.length > 1 ? 's' : ''}</h3>
          {d.vehicles.map((v) => (
            <a class="list-row" href={`#/vehicles/${v.reg}`}><Reg reg={v.reg} /><span class="grow"><b>{[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}</b><span>{v.vin ? `VIN ${v.vin}` : `Size ${v.size}`}{v.mot_due ? ` · MOT ${formatDate(v.mot_due)}` : ''}</span></span><span class="faint" style="font-size:.8rem">History →</span></a>
          ))}
          {d.vehicles.some((v) => v.notes) && <div class="alert alert-info"><span>{d.vehicles.filter((v) => v.notes).map((v) => `${v.reg}: ${v.notes}`).join(' · ')}</span></div>}
        </div>
        <Dispatch d={d} me={me} reload={reload} />
        <div class="panel"><h3 style="margin-bottom:10px">Services</h3>{d.items.map((i) => <div class="summary-line"><span>{i.name}{i.qty !== 1 ? ` × ${i.qty}` : ''}</span><span>{money(Math.round(i.qty * i.unit_price), b.currency)}</span></div>)}<div class="summary-total"><span class="muted">Total</span><b style="font-size:1.3rem">{money(b.total, b.currency)}</b></div></div>
      </div>
    </div>
  );
}
interface SpeechRec { lang: string; continuous: boolean; interimResults: boolean; onresult: (e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void; onend: () => void; onerror: () => void; start: () => void; stop: () => void }

/** Assign a technician or partner and a van (#20). */
function Dispatch({ d, me, reload }: { d: Detail; me: Me; reload: () => void }) {
  const [userId, setUserId] = useState<number | null>(d.booking.assigned_user_id);
  const [vanId, setVanId] = useState<number | null>(d.booking.van_id);
  const [when, setWhen] = useState({ date: d.booking.date, slot: d.booking.slot });
  const [busy, act] = useAction();
  if (!can(me, 'bookings.write')) return null;
  const open = !['completed', 'cancelled', 'no_show'].includes(d.booking.status);
  const moved = when.date !== d.booking.date || when.slot !== d.booking.slot;
  return (
    <div class="panel stack" style="gap:10px">
      <h3>Dispatch</h3>
      <div class="form-grid">
        <select class="select" value={userId ?? ''} onChange={(e) => setUserId(Number((e.target as HTMLSelectElement).value) || null)}><option value="">Unassigned</option>{d.users.map((u) => <option value={u.id}>{u.name} ({u.role})</option>)}</select>
        <select class="select" value={vanId ?? ''} onChange={(e) => setVanId(Number((e.target as HTMLSelectElement).value) || null)}><option value="">Default van</option>{d.vans.map((v) => <option value={v.id}>{v.name}{v.reg ? ` · ${v.reg}` : ''}</option>)}</select>
      </div>
      <button class="btn btn-sm" style="align-self:flex-start" type="button" disabled={busy} onClick={async () => {
        const r = await act(() => send<{ sent: string[]; whatsapp: string }>(`/bookings/${d.booking.id}/dispatch`, { userId, vanId, notify: true }), 'Dispatched');
        if (r?.whatsapp && !r.sent.length && confirm('No SMS provider is set up. Send the job by WhatsApp instead?')) window.open(r.whatsapp, '_blank');
        reload();
      }}>Assign &amp; notify</button>
      {open && (
        <>
          <h3 style="margin-top:6px">Move booking</h3>
          <div class="form-grid">
            <input class="input" type="date" aria-label="New date" value={when.date} onInput={(e) => setWhen({ ...when, date: (e.target as HTMLInputElement).value })} />
            <select class="select" aria-label="New window" value={when.slot} onChange={(e) => setWhen({ ...when, slot: (e.target as HTMLSelectElement).value })}><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="asap">ASAP / emergency</option></select>
          </div>
          <button class="btn btn-sm" style="align-self:flex-start" type="button" disabled={busy || !moved || !when.date} onClick={async () => { if (await act(() => send(`/bookings/${d.booking.id}`, when, 'PATCH'), 'Booking moved — the tracker is updated')) reload(); }}>Move booking</button>
          <span class="hint">The customer's tracker shows the new time. Let them know with the WhatsApp buttons above.</span>
        </>
      )}
    </div>
  );
}

/** Touchscreen signature canvas (#8). */
function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b0d12';
  }, []);
  const pos = (e: PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  return (
    <div class="sigpad">
      <canvas ref={canvas}
        onPointerDown={(e) => { drawing.current = true; canvas.current!.setPointerCapture(e.pointerId); const ctx = canvas.current!.getContext('2d')!; ctx.beginPath(); ctx.moveTo(...pos(e)); }}
        onPointerMove={(e) => { if (!drawing.current) return; const ctx = canvas.current!.getContext('2d')!; ctx.lineTo(...pos(e)); ctx.stroke(); dirty.current = true; }}
        onPointerUp={() => { drawing.current = false; if (dirty.current) onChange(canvas.current!.toDataURL('image/png')); }} />
      <div class="sig-line" />
      <span class="sig-hint">Sign above the line</span>
      <button type="button" class="btn btn-sm" style="position:absolute;top:8px;right:8px;--btn-bg:#eef0f4;--btn-fg:#111;--btn-line:#d4d8e0" onClick={() => {
        const c = canvas.current!;
        c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
        dirty.current = false;
        onChange(null);
      }}>Clear</button>
    </div>
  );
}

function SignOff({ d, me, reload }: { d: Detail; me: Me; reload: () => void }) {
  const b = d.booking;
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState(d.customer?.name ?? '');
  const [notes, setNotes] = useState('');
  const [busy, act] = useAction();
  if (b.signed_at) {
    return (
      <div class="panel stack" style="max-width:640px">
        <div class="alert alert-good"><Icon name="check" /><span>Pre-inspection signed by <b>{b.signed_name}</b> on {formatDateTime(b.signed_at)}.</span></div>
        {d.signatureUrl && <img src={d.signatureUrl} alt="Customer signature" style="background:#fff;border-radius:12px;max-width:420px;border:1px solid var(--line)" />}
      </div>
    );
  }
  if (!can(me, 'bookings.write')) return <Empty icon="pen">Not signed yet.</Empty>;
  return (
    <div class="panel stack" style="max-width:720px">
      <h3>Pre-work walkaround &amp; customer sign-off</h3>
      <p class="muted" style="margin:0">Note any existing damage, warning lights and mileage, then hand the device to the customer to sign.</p>
      <textarea class="textarea" placeholder="e.g. Light scratch rear bumper NS, kerbed OSF alloy, EML on, 84,210 miles" value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} />
      <div class="field"><label>Customer name</label><input class="input" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></div>
      <SignaturePad onChange={setSig} />
      <p class="faint" style="margin:0;font-size:.82rem">By signing, the customer confirms the vehicle condition noted above and authorises the work booked.</p>
      <button class="btn btn-primary btn-lg" type="button" disabled={busy || !sig || name.trim().length < 2} onClick={async () => {
        if (await act(() => send(`/bookings/${b.id}/signature`, { dataUrl: sig, name, notes }), 'Signed')) {
          if (b.status === 'arrived') await send(`/bookings/${b.id}/status`, { status: 'in_progress' }).catch(() => undefined);
          reload();
        }
      }}>Save signature{b.status === 'arrived' ? ' & start work' : ''}</button>
    </div>
  );
}

function Checks({ d, me }: { d: Detail; me: Me }) {
  const [templates, setTemplates] = useState<{ id: number; kind: string; name: string }[]>([]);
  const [busy, act] = useAction();
  useEffect(() => {
    get<{ templates: { id: number; kind: string; name: string }[] }>('/checklists/templates').then((r) => setTemplates(r.data.templates.filter((t) => t.kind !== 'packing'))).catch(() => undefined);
  }, []);
  return (
    <div class="cols">
      <div class="panel">
        <div class="panel-head"><h3>Inspections on this job</h3></div>
        {d.checklists.length ? <div class="list">{d.checklists.map((c) => (
          <div class="list-row"><span class="grow"><b>{c.name}</b><span>{c.status === 'completed' ? `Completed · ${c.score}/${c.max_score}` : 'In progress'}</span></span>
            <a class="btn btn-sm" href={`#/checklist/${c.id}`}>{c.status === 'completed' ? 'View' : 'Continue'}</a>
            {c.status === 'completed' && <a class="btn btn-sm btn-ghost" href={`/docs/checklist/${c.id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /></a>}</div>
        ))}</div> : <p class="faint" style="margin:0">No inspections started.</p>}
      </div>
      {can(me, 'tech.write') && (
        <div class="panel stack">
          <h3>Start an inspection</h3>
          {templates.map((t) => <button class="btn" type="button" disabled={busy} style="justify-content:flex-start" onClick={async () => {
            const r = await act(() => send<{ id: number }>('/checklists/runs', { templateId: t.id, bookingId: d.booking.id }));
            if (r) go(`checklist/${r.id}`);
          }}><Icon name="clipboard" /> {t.name}</button>)}
        </div>
      )}
    </div>
  );
}

function Money({ d, me, reload, addExpense }: { d: Detail; me: Me; reload: () => void; addExpense: () => void }) {
  const b = d.booking;
  const cur = b.currency;
  const fin = can(me, 'finance.write');
  const [busy, act] = useAction();
  const [pay, setPay] = useState<{ method: string; amount: string; kind: string } | null>(null);
  const [labour, setLabour] = useState({ rate: d.labourRates[0]?.key ?? '', hours: '0.5' });
  const [edit, setEdit] = useState<{ id: number; name: string; qty: string; price: string } | null>(null);
  const balance = b.total - b.paid_amount;
  return (
    <div class="cols-job">
      <div class="stack">
        <EstimatesPanel bookingId={b.id} currency={cur} me={me} status={b.status} onChange={reload} />
        <div class="panel">
          <div class="panel-head"><h3>Invoice lines</h3><a class="btn btn-sm" href={`/docs/invoice/${b.id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /> PDF</a></div>
          <div class="list">{d.items.map((i) => (
            <div class="list-row">
              <span class="grow"><b>{i.name}</b><span>{i.kind} · {i.qty} × {money(i.unit_price, cur)}</span></span>
              <span class="mono">{money(Math.round(i.qty * i.unit_price), cur)}</span>
              {fin && <button class="btn btn-icon btn-ghost btn-sm" type="button" aria-label="Edit line" onClick={() => setEdit({ id: i.id, name: i.name, qty: String(i.qty), price: moneyInputValue(i.unit_price) })}><Icon name="pen" /></button>}
            </div>
          ))}</div>
          {b.travel_fee > 0 && <div class="summary-line"><span>Travel</span><span>{money(b.travel_fee, cur)}</span></div>}
          {b.emergency_fee > 0 && <div class="summary-line"><span>Emergency call-out</span><span>{money(b.emergency_fee, cur)}</span></div>}
          {b.discount > 0 && <div class="summary-line discount"><span>Discounts{b.promo_code ? ` (${b.promo_code})` : ''}</span><span>−{money(b.discount, cur)}</span></div>}
          <div class="summary-total"><span class="muted">Total</span><b>{money(b.total, cur)}</b></div>
          {fin && (
            <div class="stack" style="margin-top:14px;gap:8px">
              <span class="label">Labour rate calculator</span>
              <div class="row" style="flex-wrap:nowrap">
                <select class="select" style="min-height:40px" value={labour.rate} onChange={(e) => setLabour({ ...labour, rate: (e.target as HTMLSelectElement).value })}>{d.labourRates.map((r) => <option value={r.key}>{r.label} · {money(r.rate, cur)}/hr</option>)}</select>
                <input class="input mono" style="width:80px;min-height:40px" inputMode="decimal" aria-label="Hours" value={labour.hours} onInput={(e) => setLabour({ ...labour, hours: (e.target as HTMLInputElement).value })} />
                <button class="btn btn-sm" type="button" disabled={busy} onClick={async () => {
                  const rate = d.labourRates.find((r) => r.key === labour.rate);
                  if (!rate) return;
                  if (await act(() => send(`/bookings/${b.id}/items`, { kind: 'labour', name: `${rate.label} — ${labour.hours} hr`, qty: 1, unitPrice: labourCharge(Number(labour.hours || 0), rate.rate) }), 'Labour added')) reload();
                }}>Add</button>
              </div>
              <button class="btn btn-sm btn-ghost" style="align-self:flex-start" type="button" onClick={() => setEdit({ id: 0, name: '', qty: '1', price: '' })}><Icon name="plus" /> Part or custom line</button>
            </div>
          )}
        </div>
        {can(me, 'finance.read') && (
          <div class="panel">
            <div class="panel-head"><h3>Job costs</h3>{fin && <button class="btn btn-sm" type="button" onClick={addExpense}><Icon name="plus" /> Log part / chemical</button>}</div>
            {d.expenses.length ? <div class="list">{d.expenses.map((e) => <div class="list-row"><span class="grow"><b>{e.description}</b><span>{e.category} · {e.supplier || '—'} · {formatDate(e.spent_on)}</span></span><span class="mono">{money(e.amount, cur)}</span></div>)}</div> : <p class="faint" style="margin:0;font-size:.88rem">No costs logged. Log parts, fluids and chemicals to see true profit.</p>}
            {d.profit && (
              <div class="stats" style="margin-top:14px">
                <div class="stat"><small>Revenue</small><b>{money(d.profit.revenue, cur)}</b></div>
                <div class="stat"><small>Costs{d.profit.commission ? ' + commission' : ''}</small><b>{money(d.profit.costs + d.profit.commission, cur)}</b></div>
                <div class="stat accent"><small>Net profit</small><b style={{ color: d.profit.profit < 0 ? 'var(--bad)' : undefined }}>{money(d.profit.profit, cur)}</b><span>{Math.round(d.profit.margin * 100)}% margin</span></div>
              </div>
            )}
            {d.commission && <p class="faint" style="font-size:.84rem;margin:10px 0 0">Partner commission to {d.commission.name}: {money(d.commission.amount, cur)} ({d.commission.status})</p>}
          </div>
        )}
      </div>
      <div class="stack">
        <div class="panel stack" style="gap:10px">
          <div class="spread"><h3>Payment</h3><span class={`badge badge-${b.payment_status === 'paid' ? 'good' : b.payment_status === 'unpaid' ? 'warn' : 'info'}`}>{b.payment_status.replace('_', ' ')}</span></div>
          <div class="summary-line"><span>Method</span><span style="font-family:var(--font-sans)">{PAYMENT_METHODS[b.payment_method] ?? b.payment_method}</span></div>
          <div class="summary-line"><span>Paid</span><span>{money(b.paid_amount, cur)}</span></div>
          <div class="summary-line"><span><b>Balance</b></span><span><b>{money(Math.max(0, balance), cur)}</b></span></div>
          {d.payments.map((p) => <div class="summary-line faint" style="font-size:.84rem"><span>{formatDate(p.created_at.slice(0, 10))} · {p.kind} · {p.method}{p.provider === 'stripe' ? ' (Stripe)' : ''}</span><span>{p.kind === 'refund' ? '−' : ''}{money(p.amount, cur)}</span></div>)}
          {can(me, 'bookings.write') && balance > 0 && (
            <div class="row">
              <button class="btn btn-primary btn-sm" type="button" onClick={() => setPay({ method: 'card', amount: moneyInputValue(balance), kind: 'balance' })}>Record payment</button>
              {d.canPayOnline && <button class="btn btn-sm" type="button" disabled={busy} onClick={async () => { const r = await act(() => send<{ url: string }>(`/bookings/${b.id}/payment-link`, { send: true }), 'Payment link sent'); if (r?.url) void navigator.clipboard?.writeText(r.url); }}>Send pay link (Apple/Google Pay)</button>}
            </div>
          )}
          {fin && b.paid_amount > 0 && <button class="btn btn-sm btn-ghost" style="align-self:flex-start" type="button" onClick={() => setPay({ method: 'card', amount: '', kind: 'refund' })}>Record refund</button>}
        </div>
      </div>

      {pay && (
        <Modal title={pay.kind === 'refund' ? 'Record refund' : 'Record payment'} onClose={() => setPay(null)}>
          <div class="stack">
            <div class="field"><label>Amount</label><input class="input mono" inputMode="decimal" value={pay.amount} onInput={(e) => setPay({ ...pay, amount: (e.target as HTMLInputElement).value })} /></div>
            <div class="field"><label>Method</label><select class="select" value={pay.method} onChange={(e) => setPay({ ...pay, method: (e.target as HTMLSelectElement).value })}><option value="card">Card / contactless</option><option value="sumup">SumUp reader</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="account">Trade account</option><option value="other">Other</option></select></div>
            <button class="btn btn-primary" type="button" disabled={busy || !toMinor(pay.amount)} onClick={async () => {
              if (await act(() => send(`/bookings/${b.id}/payments`, { kind: pay.kind, method: pay.method, amount: toMinor(pay.amount) }), 'Payment recorded')) {
                setPay(null);
                reload();
              }
            }}>Save</button>
          </div>
        </Modal>
      )}
      {edit && (
        <Modal title={edit.id ? 'Edit line' : 'Add line'} onClose={() => setEdit(null)}>
          <div class="stack">
            <div class="field"><label>Description</label><input class="input" value={edit.name} onInput={(e) => setEdit({ ...edit, name: (e.target as HTMLInputElement).value })} /></div>
            <div class="form-grid"><div class="field"><label>Qty</label><input class="input mono" value={edit.qty} onInput={(e) => setEdit({ ...edit, qty: (e.target as HTMLInputElement).value })} /></div><div class="field"><label>Unit price</label><input class="input mono" inputMode="decimal" value={edit.price} onInput={(e) => setEdit({ ...edit, price: (e.target as HTMLInputElement).value })} /></div></div>
            <div class="row">
              <button class="btn btn-primary" type="button" disabled={busy || !edit.name} onClick={async () => {
                const body = { name: edit.name, qty: Number(edit.qty || 1), unitPrice: toMinor(edit.price), kind: 'part' };
                const ok = edit.id ? await act(() => send(`/bookings/${b.id}/items/${edit.id}`, body, 'PATCH'), 'Line updated') : await act(() => send(`/bookings/${b.id}/items`, body), 'Line added');
                if (ok) {
                  setEdit(null);
                  reload();
                }
              }}>Save</button>
              {edit.id > 0 && <button class="btn btn-ghost" style="color:var(--bad)" type="button" onClick={async () => { if (confirm('Remove this line?') && (await act(() => send(`/bookings/${b.id}/items/${edit.id}`, undefined, 'DELETE'), 'Line removed'))) { setEdit(null); reload(); } }}>Remove</button>}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function History({ d, me, reload }: { d: Detail; me: Me; reload: () => void }) {
  const [busy, act] = useAction();
  const [notifications, setNotifications] = useState<{ id: number; channel: string; recipient: string; subject: string; body: string; status: string; error: string; created_at: string }[] | null>(null);
  const [parts, setParts] = useState(false);
  useEffect(() => {
    get<{ rows: NonNullable<typeof notifications> }>(`/notifications?booking=${d.booking.id}`).then((r) => setNotifications(r.data.rows)).catch(() => undefined);
  }, []);
  return (
    <div class="cols">
      <div class="panel"><div class="panel-head"><h3>Timeline</h3></div><ul class="events">{d.events.map((e) => <li><span>{formatDateTime(e.created_at)}</span><span><b>{e.detail}</b>{e.actor ? <span class="faint"> · {e.actor}</span> : null}{!e.public ? <span class="badge" style="margin-left:6px">internal</span> : null}</span></li>)}</ul></div>
      <div class="stack">
        <div class="panel">
          <div class="panel-head"><h3>Parts orders</h3>{can(me, 'bookings.write') && <button class="btn btn-sm" type="button" disabled={busy} onClick={() => setParts(true)}><Icon name="clipboard" /> From findings</button>}</div>
          {d.parts.length ? <div class="list">{d.parts.map((p) => <div class="list-row"><span class="grow"><b>PR-{p.id} · {p.supplier || 'No supplier yet'}</b><span>{p.items.map((i) => i.description).join('; ')}</span></span><span class="badge">{p.status}</span><a class="btn btn-sm" href={`#/r/parts_requests/${p.id}`}>Edit</a><a class="btn btn-sm btn-ghost" href={`/docs/parts/${p.id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /></a></div>)}</div> : <p class="faint" style="margin:0;font-size:.88rem">Generate a supplier request list from the fault codes in the findings.</p>}
        </div>
        {can(me, 'bookings.write') && <div class="panel stack" style="gap:8px"><h3>Re-send to customer</h3><div class="row">{(['confirmation', 'invoice', 'review'] as const).map((k) => <button class="btn btn-sm" type="button" disabled={busy} onClick={async () => { await act(() => send(`/bookings/${d.booking.id}/resend`, { kind: k }), 'Sent'); }}>{k === 'review' ? 'Review request' : k[0]!.toUpperCase() + k.slice(1)}</button>)}</div></div>}
        <div class="panel"><div class="panel-head"><h3>Messages sent</h3></div>{notifications === null ? <div class="skeleton" style="height:80px" /> : notifications.length ? <div class="list">{notifications.map((n) => <div class="list-row" title={n.body}><span class={`badge badge-${n.status === 'sent' ? 'good' : n.status === 'skipped' ? 'info' : 'bad'}`}>{n.channel}</span><span class="grow"><b>{n.subject || n.body.slice(0, 60)}</b><span>{n.recipient} · {formatDateTime(n.created_at)}{n.status !== 'sent' ? ` · ${n.status}${n.error ? `: ${n.error.slice(0, 60)}` : ''}` : ''}</span></span></div>)}</div> : <p class="faint" style="margin:0">None yet.</p>}</div>
      </div>
      {parts && (
        <Drawer title="Parts request" onClose={() => setParts(false)}>
          <PartsFromFindings bookingId={d.booking.id} onDone={() => { setParts(false); reload(); }} />
        </Drawer>
      )}
    </div>
  );
}

function PartsFromFindings({ bookingId, onDone }: { bookingId: number; onDone: () => void }) {
  const [supplier, setSupplier] = useState('');
  const [contact, setContact] = useState('');
  const [busy, act] = useAction();
  return (
    <div class="stack">
      <p class="muted" style="margin:0">Fault codes in the findings (e.g. P2002) are turned into a draft parts list you can edit before sending.</p>
      <div class="field"><label>Supplier</label><input class="input" value={supplier} onInput={(e) => setSupplier((e.target as HTMLInputElement).value)} placeholder="e.g. Euro Car Parts Eastbourne" /></div>
      <div class="field"><label>Supplier email or WhatsApp number</label><input class="input" value={contact} onInput={(e) => setContact((e.target as HTMLInputElement).value)} /></div>
      <button class="btn btn-primary" type="button" disabled={busy} onClick={async () => {
        const r = await act(() => send<{ id: number; codes: string[] }>(`/bookings/${bookingId}/parts-request`, { supplier, supplierContact: contact }), 'Draft created');
        if (r) {
          toast(r.codes.length ? `Found ${r.codes.join(', ')}` : 'No fault codes found — add parts manually', { icon: 'info' });
          go(`r/parts_requests/${r.id}`);
          onDone();
        }
      }}>Create draft parts list</button>
    </div>
  );
}

interface Estimate { id: number; title: string; note: string; items: { name: string; qty: number; unitPrice: number }[]; total: number; status: string; createdBy: string; decidedName: string; decidedNote: string; decidedAt: string | null; createdAt: string }

/** Extra work found on the job, sent to the customer's tracker to approve before it is done. */
function EstimatesPanel({ bookingId, currency, me, status, onChange }: { bookingId: number; currency: string; me: Me; status: BookingStatus; onChange: () => void }) {
  const [list, setList] = useState<Estimate[] | null>(null);
  const [form, setForm] = useState<{ title: string; note: string; items: { name: string; qty: string; price: string }[] } | null>(null);
  const [busy, act] = useAction();
  const load = () => get<{ estimates: Estimate[] }>(`/bookings/${bookingId}/estimates`).then((r) => setList(r.data.estimates)).catch(() => setList([]));
  useEffect(() => {
    void load();
  }, [bookingId]);
  const write = can(me, 'bookings.write') && !['cancelled', 'no_show'].includes(status);
  const total = form ? form.items.reduce((a, i) => a + Math.round((Number(i.qty) || 0) * toMinor(i.price)), 0) : 0;
  return (
    <div class="panel">
      <div class="panel-head"><h3>Customer approvals</h3>{write && !form && <button class="btn btn-sm btn-primary" type="button" onClick={() => setForm({ title: '', note: '', items: [{ name: '', qty: '1', price: '' }] })}><Icon name="plus" /> Ask to approve extra work</button>}</div>
      {form && (
        <div class="stack" style="gap:10px;margin-bottom:12px">
          <div class="field"><label>What did you find?</label><input class="input" placeholder="e.g. Corroded battery terminal and failing glow plug" value={form.title} onInput={(e) => setForm({ ...form, title: (e.target as HTMLInputElement).value })} /></div>
          <div class="field"><label>Explanation for the customer</label><textarea class="textarea" placeholder="What it means, why it matters, what happens if left…" value={form.note} onInput={(e) => setForm({ ...form, note: (e.target as HTMLTextAreaElement).value })} /></div>
          <div class="rows-editor">
            <div class="r faint" style="grid-template-columns:3fr 1fr 1.2fr 36px;font-size:.72rem"><span>Item</span><span>Qty</span><span>Price each (£)</span><span /></div>
            {form.items.map((it, i) => (
              <div class="r" style="grid-template-columns:3fr 1fr 1.2fr 36px">
                <input class="input" value={it.name} placeholder="Part or labour" onInput={(e) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)) })} />
                <input class="input mono" inputMode="decimal" value={it.qty} onInput={(e) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, qty: (e.target as HTMLInputElement).value } : x)) })} />
                <input class="input mono" inputMode="decimal" value={it.price} placeholder="0.00" onInput={(e) => setForm({ ...form, items: form.items.map((x, j) => (j === i ? { ...x, price: (e.target as HTMLInputElement).value } : x)) })} />
                <button class="btn btn-icon btn-ghost btn-sm" type="button" aria-label="Remove item" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, j) => j !== i) })}><Icon name="x" /></button>
              </div>
            ))}
            <button class="btn btn-sm btn-ghost" style="justify-self:start" type="button" onClick={() => setForm({ ...form, items: [...form.items, { name: '', qty: '1', price: '' }] })}><Icon name="plus" /> Add item</button>
          </div>
          <div class="spread"><span class="muted">Total for approval</span><b class="mono">{money(total, currency)}</b></div>
          <div class="row">
            <button class="btn btn-primary" type="button" disabled={busy || !form.title.trim() || !form.items.some((i) => i.name.trim())} onClick={async () => {
              const items = form.items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), qty: Number(i.qty) || 1, unitPrice: toMinor(i.price) }));
              const r = await act(() => send(`/bookings/${bookingId}/estimates`, { title: form.title.trim(), note: form.note.trim(), items, notify: true }), 'Sent to the customer for approval');
              if (r) {
                setForm(null);
                void load();
                onChange();
              }
            }}>Send for approval</button>
            <button class="btn btn-ghost" type="button" onClick={() => setForm(null)}>Cancel</button>
          </div>
          <p class="faint" style="margin:0;font-size:.8rem">The customer gets a text/email with a link to approve or decline on their tracker. Approved items are added to the invoice automatically.</p>
        </div>
      )}
      {!list ? <div class="skeleton" style="height:40px" /> : list.length === 0 && !form ? <p class="faint" style="margin:0">Found extra work? Send it here for the customer to approve before you carry on.</p> : (
        <div class="list">{list.map((e) => (
          <div class="list-row">
            <span class="grow"><b>{e.title}</b><span>{e.status === 'pending' ? `Sent ${formatDateTime(e.createdAt)} by ${e.createdBy}` : e.status === 'withdrawn' ? 'Withdrawn' : `${e.status === 'approved' ? 'Approved' : 'Declined'} by ${e.decidedName || 'customer'}${e.decidedAt ? ` · ${formatDateTime(e.decidedAt)}` : ''}${e.decidedNote ? ` — "${e.decidedNote}"` : ''}`}</span></span>
            <span class="mono">{money(e.total, currency)}</span>
            <span class={`badge badge-${e.status === 'approved' ? 'good' : e.status === 'declined' ? 'bad' : e.status === 'pending' ? 'warn' : ''}`}>{e.status}</span>
            {e.status === 'pending' && write && <button class="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={async () => { if (await act(() => send(`/estimates/${e.id}/withdraw`, {}), 'Estimate withdrawn')) void load(); }}>Withdraw</button>}
          </div>
        ))}</div>
      )}
    </div>
  );
}
