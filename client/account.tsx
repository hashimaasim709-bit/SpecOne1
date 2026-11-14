// Customer portal: bookings, vehicle history, plans (#9), loyalty (#94) and referrals (#49).
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { STATUS_META, type BookingStatus } from '../shared/constants';
import { formatDate, formatReg } from '../shared/format';
import { api, errorMessage } from './lib/api';
import { enableRipples, money, toast } from './lib/ui';

const root = document.getElementById('account-app');

interface Me {
  profile: { id: number; name: string; email: string; phone: string; address: string; postcode: string; referral_code: string; loyalty_points: number; marketing_opt_in: number; created_at: string };
  vehicles: { id: number; reg: string; make: string; model: string; year: number | null; mot_due: string | null; visits: number }[];
  bookings: { id: number; ref: string; token: string; status: BookingStatus; date: string; slot: string; total: number; paid_amount: number; currency: string; services: string; regs: string }[];
  subscriptions: { id: number; status: string; price: number; next_visit_on: string | null; preferred_slot: string; plan: string; interval: string; reg: string | null }[];
  ledger: { points: number; reason: string; created_at: string }[];
  loyalty: { enabled: boolean; pointValue: number; minRedeem: number; referrerPoints: number; referrals: number };
  currency: string;
  shareUrl: string;
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [contact, setContact] = useState('');
  const [challenge, setChallenge] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div class="grid grid-2" style="align-items:center">
      <div>
        <span class="eyebrow">My garage</span>
        <h1 class="display">Your cars, reports &amp; rewards</h1>
        <p class="lead">Every booking, invoice, battery certificate and inspection report in one place — plus your loyalty points and referral code. No password needed.</p>
      </div>
      <form class="card card-glass stack" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        setBusy(true);
        try {
          if (!challenge) {
            const r = await api<{ challenge: string; message: string }>('/api/account/code', { body: { contact } });
            setChallenge(r.challenge);
            setMsg(r.message);
          } else {
            await api('/api/account/verify', { body: { challenge, code } });
            onDone();
          }
        } catch (ex) {
          setErr(errorMessage(ex));
        } finally {
          setBusy(false);
        }
      }}>
        <h3>{challenge ? 'Enter your code' : 'Sign in'}</h3>
        {!challenge ? (
          <div class="field"><label for="ac-contact">Email or mobile number used when booking</label><input class="input" id="ac-contact" required value={contact} autoComplete="email" onInput={(e) => setContact((e.target as HTMLInputElement).value)} /></div>
        ) : (
          <>
            <p class="muted" style="margin:0">{msg}</p>
            <div class="field"><label for="ac-code">6-digit code</label><input class="input mono" id="ac-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} style="font-size:1.5rem;letter-spacing:.3em;text-align:center" onInput={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))} /></div>
          </>
        )}
        {err && <div class="alert alert-bad"><span>{err}</span></div>}
        <button class="btn btn-primary btn-lg" disabled={busy}>{busy ? <span class="spinner" /> : challenge ? 'Sign in' : 'Send my code'}</button>
        {challenge && <button type="button" class="btn btn-ghost btn-sm" onClick={() => { setChallenge(''); setCode(''); }}>Use a different email or number</button>}
        <span class="hint">You can also open any booking straight from the tracker link in your confirmation text.</span>
      </form>
    </div>
  );
}

function VehicleHistory({ id, onClose, cur }: { id: number; onClose: () => void; cur: string }) {
  const [data, setData] = useState<{ vehicle: { reg: string; make: string; model: string; year: number | null; mot_due: string | null }; jobs: { ref: string; token: string; date: string; status: string; services: string; findings: string }[]; dpf: { logged_on: string; regen_type: string; soot_pct_before: number | null; soot_pct_after: number | null; result: string }[]; battery: { id: number; tested_on: string; soh_pct: number | null; verdict: string; token: string }[]; flash: { flashed_on: string; module: string; version_after: string; result: string }[] } | null>(null);
  useEffect(() => {
    api<typeof data>(`/api/account/vehicles/${id}`).then(setData).catch((e) => toast(errorMessage(e), { icon: 'alert' }));
  }, [id]);
  void cur;
  return (
    <div class="lightbox" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="card" style="max-width:720px;width:100%;max-height:88vh;overflow:auto">
        <div class="spread"><h3>{data ? `${formatReg(data.vehicle.reg)} · ${[data.vehicle.year, data.vehicle.make, data.vehicle.model].filter(Boolean).join(' ')}` : 'Loading…'}</h3><button class="btn btn-icon btn-ghost" type="button" onClick={onClose} aria-label="Close">×</button></div>
        {!data ? <div class="skeleton" style="height:200px;margin-top:16px" /> : (
          <div class="stack" style="margin-top:16px">
            {data.vehicle.mot_due && <div class="alert alert-info"><span>MOT due <b>{formatDate(data.vehicle.mot_due, 'long')}</b>. <a href="/book?package=pre-mot-health-scan">Book a pre-MOT scan</a></span></div>}
            <h4>Service history</h4>
            {data.jobs.length ? <ol class="timeline">{data.jobs.map((j) => <li class="done"><span class="node" /><span><b>{formatDate(j.date)} · {j.services}</b><small>{j.findings ? j.findings.slice(0, 180) : STATUS_META[j.status as BookingStatus]?.label} · <a href={`/track/${j.token}`}>Open</a></small></span></li>)}</ol> : <p class="muted">No completed jobs yet.</p>}
            {data.dpf.length > 0 && <><h4>DPF regenerations</h4><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Procedure</th><th>Soot before → after</th><th>Result</th></tr></thead><tbody>{data.dpf.map((d) => <tr><td class="mono">{formatDate(d.logged_on)}</td><td>{d.regen_type.replace(/_/g, ' ')}</td><td class="mono">{d.soot_pct_before ?? '—'}% → {d.soot_pct_after ?? '—'}%</td><td>{d.result}</td></tr>)}</tbody></table></div></>}
            {data.battery.length > 0 && <><h4>Battery tests</h4>{data.battery.map((b) => <a class="doc-link" href={`/track/${b.token}/battery/${b.id}.pdf`} target="_blank" rel="noopener"><span><b>{formatDate(b.tested_on)} · {b.verdict.toUpperCase()}</b><br /><span class="faint">State of health {b.soh_pct ?? '—'}% · certificate PDF</span></span></a>)}</>}
            {data.flash.length > 0 && <><h4>Software updates</h4><div class="table-wrap"><table class="table"><tbody>{data.flash.map((f) => <tr><td class="mono">{formatDate(f.flashed_on)}</td><td>{f.module}</td><td class="mono">{f.version_after}</td><td>{f.result}</td></tr>)}</tbody></table></div></>}
          </div>
        )}
      </div>
    </div>
  );
}

function Portal({ me, reload }: { me: Me; reload: () => void }) {
  const [tab, setTab] = useState<'bookings' | 'vehicles' | 'plans' | 'profile'>('bookings');
  const [vehicle, setVehicle] = useState<number | null>(null);
  const [profile, setProfile] = useState({ name: me.profile.name, phone: me.profile.phone, address: me.profile.address, postcode: me.profile.postcode, marketing: !!me.profile.marketing_opt_in });
  const cur = me.currency;
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = me.bookings.filter((b) => b.date >= today && !['completed', 'cancelled', 'no_show'].includes(b.status));
  const past = me.bookings.filter((b) => !upcoming.includes(b));
  const pointsValue = me.profile.loyalty_points * me.loyalty.pointValue;

  const bookingRow = (b: Me['bookings'][number]) => (
    <a class="card card-link card-tight stack" style="gap:8px" href={`/track/${b.token}`}>
      <div class="spread"><b class="mono">{b.ref}</b><span class={`badge badge-${STATUS_META[b.status].tone === 'good' ? 'good' : STATUS_META[b.status].tone === 'bad' ? 'bad' : STATUS_META[b.status].tone === 'warn' ? 'warn' : 'info'}`}>{STATUS_META[b.status].label}</span></div>
      <span>{b.services}</span>
      <div class="spread"><span class="muted mono" style="font-size:.82rem">{formatDate(b.date, 'day')} · {b.regs?.split(',').map((r) => formatReg(r.trim())).join(', ')}</span><span class="price" style="font-size:1rem">{money(b.total, b.currency)}</span></div>
    </a>
  );

  return (
    <div class="stack" style="gap:24px">
      <div class="spread" style="align-items:flex-end">
        <div><span class="eyebrow">My garage</span><h1 class="display" style="font-size:clamp(2.2rem,6vw,3.4rem)">Hi, {me.profile.name.split(' ')[0]}</h1></div>
        <div class="row"><a class="btn btn-primary" href="/book">Book again</a><button type="button" class="btn btn-ghost" onClick={async () => { await api('/api/account/logout', { method: 'POST' }); location.reload(); }}>Sign out</button></div>
      </div>

      <div class="grid grid-3">
        <div class="card card-glass stack" style="gap:6px"><span class="mono faint" style="font-size:.7rem;letter-spacing:.14em">LOYALTY POINTS</span><b class="mono" style="font-size:2.2rem">{me.profile.loyalty_points}</b><span class="muted" style="font-size:.88rem">Worth {money(pointsValue, cur)}{me.profile.loyalty_points < me.loyalty.minRedeem ? ` · redeem from ${me.loyalty.minRedeem} points` : ' · use them at checkout'}</span></div>
        <div class="card stack" style="gap:6px"><span class="mono faint" style="font-size:.7rem;letter-spacing:.14em">YOUR REFERRAL CODE</span><b class="mono" style="font-size:1.6rem">{me.profile.referral_code}</b><span class="muted" style="font-size:.88rem">Friends save 15%; you earn {me.loyalty.referrerPoints} points when they book. {me.loyalty.referrals ? `${me.loyalty.referrals} referred so far.` : ''}</span>
          <button type="button" class="btn btn-sm" style="align-self:flex-start" onClick={async () => {
            const text = `Use my code ${me.profile.referral_code} for 15% off your first booking: ${me.shareUrl}`;
            if (navigator.share) await navigator.share({ text }).catch(() => undefined);
            else { await navigator.clipboard?.writeText(text); toast('Link copied'); }
          }}>Share</button></div>
        <div class="card stack" style="gap:6px"><span class="mono faint" style="font-size:.7rem;letter-spacing:.14em">VEHICLES</span><b class="mono" style="font-size:2.2rem">{me.vehicles.length}</b><span class="muted" style="font-size:.88rem">{(() => { const n = me.bookings.filter((b) => b.status === 'completed').length; return `${n} completed visit${n === 1 ? '' : 's'}`; })()}</span></div>
      </div>

      <div class="chip-row" role="tablist">{(['bookings', 'vehicles', 'plans', 'profile'] as const).map((t) => <button type="button" role="tab" class="chip" aria-pressed={tab === t} onClick={() => setTab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>)}</div>

      {tab === 'bookings' && (
        <div class="stack">
          {upcoming.length > 0 && <><h3>Upcoming</h3><div class="grid grid-2">{upcoming.map(bookingRow)}</div></>}
          <h3>History</h3>
          {past.length ? <div class="grid grid-2">{past.map(bookingRow)}</div> : <p class="muted">No past bookings yet.</p>}
        </div>
      )}
      {tab === 'vehicles' && (
        <div class="grid grid-3">
          {me.vehicles.map((v) => (
            <button type="button" class="card card-link stack" style="text-align:left;gap:8px" onClick={() => setVehicle(v.id)}>
              <span class="mono" style="background:var(--plate-bg);color:#111;padding:4px 10px;border-radius:6px;font-weight:700;align-self:flex-start;font-size:1.1rem;letter-spacing:.06em">{formatReg(v.reg)}</span>
              <b>{[v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'}</b>
              <span class="muted" style="font-size:.88rem">{v.visits} visit{v.visits === 1 ? '' : 's'}{v.mot_due ? ` · MOT due ${formatDate(v.mot_due)}` : ''}</span>
              <span class="accent" style="font-size:.88rem;font-weight:600">View full history →</span>
            </button>
          ))}
          {!me.vehicles.length && <p class="muted">Vehicles appear here after your first booking.</p>}
        </div>
      )}
      {tab === 'plans' && (
        <div class="stack">
          {me.subscriptions.length ? me.subscriptions.map((sub) => (
            <div class="card spread">
              <div><b>{sub.plan}</b>{sub.reg ? <span class="muted"> · {formatReg(sub.reg)}</span> : null}<br /><span class="muted" style="font-size:.9rem">{money(sub.price, cur)} per visit · {sub.interval} · {sub.status === 'active' && sub.next_visit_on ? `next visit ${formatDate(sub.next_visit_on, 'day')}` : sub.status}</span></div>
              <div class="row">
                {sub.status === 'active' && <button type="button" class="btn btn-sm" onClick={() => planAction(sub.id, 'pause')}>Pause</button>}
                {sub.status === 'paused' && <button type="button" class="btn btn-sm btn-primary" onClick={() => planAction(sub.id, 'resume')}>Resume</button>}
                {sub.status !== 'cancelled' && <button type="button" class="btn btn-sm btn-ghost" style="color:var(--bad)" onClick={() => confirm('Cancel this plan? Already-booked visits stay booked.') && planAction(sub.id, 'cancel')}>Cancel</button>}
              </div>
            </div>
          )) : <div class="card spread"><span class="muted">No maintenance plans yet — keep your car showroom-fresh with a monthly visit.</span><a class="btn btn-primary" href="/services#plans">See plans</a></div>}
        </div>
      )}
      {tab === 'profile' && (
        <form class="card stack" style="max-width:640px" onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/api/account/me', { method: 'PATCH', body: profile });
            toast('Details saved');
            reload();
          } catch (ex) {
            toast(errorMessage(ex), { icon: 'alert' });
          }
        }}>
          <div class="form-grid">
            <div class="field"><label>Name</label><input class="input" value={profile.name} onInput={(e) => setProfile({ ...profile, name: (e.target as HTMLInputElement).value })} /></div>
            <div class="field"><label>Mobile</label><input class="input" type="tel" value={profile.phone} onInput={(e) => setProfile({ ...profile, phone: (e.target as HTMLInputElement).value })} /></div>
          </div>
          <div class="field"><label>Email</label><input class="input" value={me.profile.email} disabled /><span class="hint">To change your email, ask us in chat.</span></div>
          <div class="form-grid">
            <div class="field"><label>Address</label><input class="input" value={profile.address} onInput={(e) => setProfile({ ...profile, address: (e.target as HTMLInputElement).value })} /></div>
            <div class="field"><label>Postcode</label><input class="input mono" value={profile.postcode} onInput={(e) => setProfile({ ...profile, postcode: (e.target as HTMLInputElement).value.toUpperCase() })} /></div>
          </div>
          <label class="check"><input type="checkbox" checked={profile.marketing} onChange={(e) => setProfile({ ...profile, marketing: (e.target as HTMLInputElement).checked })} /><span>Send me MOT / service reminders and occasional offers</span></label>
          <button class="btn btn-primary" style="align-self:flex-start">Save details</button>
          {me.ledger.length > 0 && <><hr class="divider" /><h4>Points history</h4>{me.ledger.map((l) => <div class="summary-line"><span>{l.reason}<br /><span class="faint mono" style="font-size:.74rem">{formatDate(l.created_at.slice(0, 10))}</span></span><span style={{ color: l.points > 0 ? 'var(--good)' : 'var(--muted)' }}>{l.points > 0 ? '+' : ''}{l.points}</span></div>)}</>}
        </form>
      )}
      {vehicle && <VehicleHistory id={vehicle} cur={cur} onClose={() => setVehicle(null)} />}
    </div>
  );

  async function planAction(id: number, action: 'pause' | 'resume' | 'cancel') {
    try {
      await api(`/api/account/subscriptions/${id}`, { body: { action } });
      toast(`Plan ${action === 'resume' ? 'resumed' : `${action}d`}`);
      reload();
    } catch (e) {
      toast(errorMessage(e), { icon: 'alert' });
    }
  }
}

function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<'loading' | 'out' | 'in'>('loading');
  const load = async () => {
    try {
      setMe(await api<Me>('/api/account/me'));
      setState('in');
    } catch {
      setState('out');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  if (state === 'loading') return <div class="skeleton" style="height:300px" />;
  if (state === 'out' || !me) return <SignIn onDone={load} />;
  return <Portal me={me} reload={load} />;
}

if (root) {
  enableRipples();
  root.innerHTML = '';
  render(<App />, root);
}
