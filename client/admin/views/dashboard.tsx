// Dashboard (#17) and the technician's "Today" run sheet with live GPS sharing (#1).
import { useEffect, useRef, useState } from 'preact/hooks';
import { slotLabel, type BookingStatus } from '../../../shared/constants';
import { formatDate, money } from '../../../shared/format';
import { toast } from '../../lib/ui';
import { get, send } from '../api';
import { ComboChart, HBars, type Point } from '../charts';
import { can, go, type Me } from '../main';
import { Empty, Icon, PageTitle, Stale, StatusBadge, useAction } from '../ui';

interface Job { id: number; ref: string; status: BookingStatus; slot: string; emergency: number; address: string; postcode: string; total: number; customer_name: string; customer_phone: string; vehicles: string | null }
interface Dash {
  today: string; todayJobs: Job[]; upcomingWeek: number; pending: number; unreadChats: number;
  lowStock: { id: number; name: string; stock: number; min_stock: number; unit: string }[];
  licences: { id: number; name: string; expires_on: string | null; tokens_left: number | null }[];
  kpis?: { revenueMtd: number; costsMtd: number; profitMtd: number; jobsMtd: number; avgJob: number; outstanding: number; outstandingJobs: number; newCustomers: number };
  weekly?: Point[]; monthly?: Point[];
  topServices?: { name: string; jobs: number; revenue: number }[];
  byCategory?: { category: string; revenue: number }[];
  sources?: { source: string; jobs: number }[];
}

const CUR = 'GBP';
const CAT: Record<string, string> = { diagnostics: 'Diagnostics & coding', detailing: 'Detailing', plan: 'Plans', addon: 'Add-ons', labour: 'Labour', part: 'Parts', custom: 'Custom work' };

export function DashboardView({ me }: { me: Me }) {
  const [d, setD] = useState<{ data: Dash; stale: boolean; at: number } | null>(null);
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  useEffect(() => {
    get<Dash>('/dashboard').then(setD).catch(() => undefined);
  }, []);
  if (!d) return <div class="stack"><div class="skeleton" style="height:40px;width:40%" /><div class="stats">{[1, 2, 3, 4].map(() => <div class="skeleton" style="height:96px" />)}</div><div class="skeleton" style="height:300px" /></div>;
  const x = d.data;
  const k = x.kpis;
  const hour = new Date().getHours();
  return (
    <div class="stack" style="gap:18px">
      <PageTitle title={`Good ${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}, ${me.name.split(' ')[0]}`} sub={formatDate(x.today, 'long')}>
        {can(me, 'bookings.write') && <a class="btn btn-primary" href="#/quick"><Icon name="plus" /> Quick-book</a>}
        <a class="btn" href="#/today"><Icon name="route" /> Today's run</a>
      </PageTitle>
      <Stale stale={d.stale} at={d.at} />
      <div class="stats">
        <div class="stat accent"><small>Jobs today</small><b>{x.todayJobs.length}</b><span>{x.upcomingWeek} more this week</span></div>
        <a class="stat" href="#/bookings?status=pending" style="text-decoration:none"><small>Awaiting confirmation</small><b>{x.pending}</b><span>{x.pending ? 'Tap to review' : 'All confirmed'}</span></a>
        <a class="stat" href="#/inbox" style="text-decoration:none"><small>Unread chats</small><b>{x.unreadChats}</b><span>{x.unreadChats ? 'Customers waiting' : 'Inbox clear'}</span></a>
        {k && <div class="stat"><small>Revenue this month</small><b>{money(k.revenueMtd, CUR)}</b><span>{k.jobsMtd} jobs · avg {money(k.avgJob, CUR)}</span></div>}
        {k && <div class="stat"><small>Profit this month</small><b style={{ color: k.profitMtd < 0 ? 'var(--bad)' : undefined }}>{money(k.profitMtd, CUR)}</b><span>after {money(k.costsMtd, CUR)} costs</span></div>}
        {k && <a class="stat" href="#/bookings?status=completed&unpaid=1" style="text-decoration:none"><small>Outstanding</small><b>{money(k.outstanding, CUR)}</b><span>{k.outstandingJobs} unpaid job{k.outstandingJobs === 1 ? '' : 's'}</span></a>}
      </div>

      <div class="cols">
        <div class="panel">
          <div class="panel-head"><h3>Today</h3><a class="btn btn-sm btn-ghost" href="#/calendar">Calendar <Icon name="arrow" /></a></div>
          {x.todayJobs.length ? <div class="list">{x.todayJobs.map((j) => <JobRow job={j} />)}</div> : <Empty icon="calendar">No jobs booked today.</Empty>}
        </div>
        <div class="stack">
          {(x.lowStock.length > 0 || x.licences.length > 0) && (
            <div class="panel">
              <div class="panel-head"><h3>Needs attention</h3></div>
              <div class="list">
                {x.lowStock.map((i) => <a class="list-row" href={`#/r/inventory/${i.id}`}><span class="badge badge-warn">Low stock</span><span class="grow"><b>{i.name}</b><span>{i.stock} {i.unit} left · alert below {i.min_stock}</span></span></a>)}
                {x.licences.map((l) => <a class="list-row" href={`#/r/licences/${l.id}`}><span class={`badge ${l.expires_on && l.expires_on < x.today ? 'badge-bad' : 'badge-warn'}`}>{l.expires_on && l.expires_on < x.today ? 'Expired' : 'Renew'}</span><span class="grow"><b>{l.name}</b><span>{l.expires_on ? `Expires ${formatDate(l.expires_on)}` : ''}{l.tokens_left != null ? ` · ${l.tokens_left} tokens left` : ''}</span></span></a>)}
              </div>
            </div>
          )}
          {x.byCategory && x.byCategory.length > 0 && <div class="panel"><div class="panel-head"><h3>Revenue by type</h3><span class="faint mono" style="font-size:.7rem">LAST 90 DAYS</span></div><HBars currency={CUR} rows={x.byCategory.map((c) => ({ label: CAT[c.category] ?? c.category, value: c.revenue }))} /></div>}
        </div>
      </div>

      {x.weekly && x.monthly && (
        <div class="panel">
          <div class="panel-head"><h3>Revenue &amp; profit</h3><div class="seg" role="group"><button type="button" aria-pressed={range === 'weekly'} onClick={() => setRange('weekly')}>12 weeks</button><button type="button" aria-pressed={range === 'monthly'} onClick={() => setRange('monthly')}>12 months</button></div></div>
          <ComboChart data={range === 'weekly' ? x.weekly : x.monthly} currency={CUR} title={`Revenue and profit, ${range === 'weekly' ? 'last 12 weeks' : 'last 12 months'}`} />
        </div>
      )}
      {x.topServices && (
        <div class="cols">
          <div class="panel"><div class="panel-head"><h3>Top services</h3><span class="faint mono" style="font-size:.7rem">LAST 90 DAYS</span></div><HBars currency={CUR} rows={x.topServices.map((s) => ({ label: s.name, value: s.revenue, sub: `${s.jobs} job${s.jobs === 1 ? '' : 's'}` }))} /></div>
          <div class="panel"><div class="panel-head"><h3>Where bookings come from</h3><span class="faint mono" style="font-size:.7rem">LAST 90 DAYS</span></div><HBars rows={(x.sources ?? []).map((s) => ({ label: s.source.replace('_', '-'), value: s.jobs }))} format={(v) => `${v} job${v === 1 ? '' : 's'}`} /></div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job }: { job: Job }) {
  return (
    <a class="list-row" href={`#/bookings/${job.id}`}>
      <span class={`slot-tag${job.emergency ? ' sos' : ''}`}>{job.emergency ? 'SOS' : job.slot.slice(0, 3)}</span>
      <span class="grow"><b>{job.customer_name} · {job.vehicles ?? ''}</b><span>{job.address}</span></span>
      <StatusBadge status={job.status} />
    </a>
  );
}

/** Technician run sheet: today's jobs in order with one-tap status, navigation and live GPS sharing. */
export function TodayView({ me }: { me: Me }) {
  const [d, setD] = useState<{ data: Dash; stale: boolean; at: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  const [gpsInfo, setGpsInfo] = useState('');
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const [busy, act] = useAction();
  const load = () => get<Dash>('/dashboard').then(setD).catch(() => undefined);
  useEffect(() => {
    void load();
    return () => stopSharing();
  }, []);

  function stopSharing() {
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setSharing(false);
  }
  function startSharing() {
    if (!('geolocation' in navigator)) return toast('Location is not available on this device.', { icon: 'alert' });
    setSharing(true);
    watchId.current = navigator.geolocation.watchPosition(async (pos) => {
      if (Date.now() - lastSent.current < 15000) return;
      lastSent.current = Date.now();
      try {
        const r = await send<{ tracking: number | null; eta: number | null }>('/van/position', { lat: pos.coords.latitude, lng: pos.coords.longitude, heading: pos.coords.heading, speed: pos.coords.speed != null ? pos.coords.speed * 2.237 : null });
        setGpsInfo(`Shared ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}${r.eta != null ? ` · ETA ${r.eta} min` : ''}`);
      } catch {
        setGpsInfo('Waiting for signal…');
      }
    }, (err) => {
      toast(err.code === 1 ? 'Allow location access to share live tracking.' : 'Could not get your location.', { icon: 'alert' });
      stopSharing();
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
  }

  async function setStatus(job: Job, status: BookingStatus) {
    const r = await act(() => send(`/bookings/${job.id}/status`, { status }, 'POST', { queueable: true }), `${job.ref} updated`);
    if (r) {
      if (status === 'en_route' && !sharing) startSharing();
      void load();
    }
  }

  if (!d) return <div class="skeleton" style="height:320px" />;
  const jobs = d.data.todayJobs;
  return (
    <div class="stack" style="gap:16px">
      <PageTitle title="Today's run" sub={`${formatDate(d.data.today, 'long')} · ${jobs.length} job${jobs.length === 1 ? '' : 's'}`}>
        {sharing ? <button class="btn btn-good" type="button" onClick={stopSharing}><span class="dot dot-live" /> Sharing location</button> : <button class="btn btn-primary" type="button" onClick={startSharing}><Icon name="today" /> Share live location</button>}
      </PageTitle>
      <Stale stale={d.stale} at={d.at} />
      {sharing && <div class="alert alert-good"><Icon name="today" /><span>Customers on their way-to-you tracker see the van move live. {gpsInfo}</span></div>}
      <a class="btn btn-ghost" style="align-self:flex-start" href="#/library?packing=1"><Icon name="clipboard" /> Pre-dispatch packing checklist</a>
      {jobs.length === 0 && <Empty icon="calendar">Nothing booked today. <a href="#/calendar">Open the calendar</a></Empty>}
      {jobs.map((j, i) => (
        <div class="panel stack" style="gap:12px">
          <div class="spread">
            <span class="row"><span class="mono faint">{String(i + 1).padStart(2, '0')}</span><span class={`slot-tag${j.emergency ? ' sos' : ''}`}>{j.emergency ? 'Emergency' : slotLabel(j.slot)}</span></span>
            <StatusBadge status={j.status} />
          </div>
          <a href={`#/bookings/${j.id}`} style="text-decoration:none"><b style="font-size:1.05rem">{j.customer_name}</b><div class="muted">{j.vehicles}</div><div class="muted" style="font-size:.88rem">{j.address}</div></a>
          <div class="row">
            <a class="btn btn-sm" href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(j.address)}`} target="_blank" rel="noopener"><Icon name="route" /> Navigate</a>
            <a class="btn btn-sm" href={`tel:${j.customer_phone}`}><Icon name="phone" /> Call</a>
            {j.status === 'confirmed' && <button class="btn btn-sm btn-primary" disabled={busy} onClick={() => setStatus(j, 'en_route')}>On my way</button>}
            {j.status === 'en_route' && <button class="btn btn-sm btn-primary" disabled={busy} onClick={() => setStatus(j, 'arrived')}>Arrived</button>}
            {j.status === 'arrived' && <button class="btn btn-sm btn-primary" disabled={busy} onClick={() => go(`bookings/${j.id}?tab=sign`)}>Walkaround &amp; sign</button>}
            {j.status === 'in_progress' && <button class="btn btn-sm btn-good" disabled={busy} onClick={() => go(`bookings/${j.id}`)}>Finish job</button>}
          </div>
        </div>
      ))}
      {!can(me, 'finance.read') && <p class="faint" style="font-size:.82rem">Prices are hidden for your role.</p>}
    </div>
  );
}
