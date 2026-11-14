// Live job tracker (#1): the van on a map with ETA, job stages, documents, payment and feedback.
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { TRACK_STAGES } from '../shared/constants';
import { formatDate, formatDateTime } from '../shared/format';
import type { TrackPayload } from '../shared/types';
import { api, errorMessage } from './lib/api';
import { enableRipples, money, toast } from './lib/ui';

const root = document.getElementById('track-app');
const token = root?.dataset.token ?? '';

const Svg = ({ d, size = 18 }: { d: string; size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
const P = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  card: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h3"/>',
  wa: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  van: '<path d="M3 16V7.5A1.5 1.5 0 0 1 4.5 6H14v10M14 9h3.5l3.5 4v3h-1.5"/><circle cx="7" cy="17" r="1.9"/><circle cx="17" cy="17" r="1.9"/><path d="M9 17h6"/>',
};

function MapView({ data }: { data: TrackPayload }) {
  const el = useRef<HTMLDivElement>(null);
  const state = useRef<{ map?: import('leaflet').Map; van?: import('leaflet').Marker; dest?: import('leaflet').Marker; line?: import('leaflet').Polyline; lib?: typeof import('./lib/map') }>({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lib = (state.current.lib ??= await import('./lib/map'));
      if (cancelled || !el.current) return;
      const { L } = lib;
      const dest = data.destination;
      const van = data.van;
      if (!state.current.map) {
        const center: [number, number] = dest ? [dest.lat, dest.lng] : van ? [van.lat, van.lng] : [50.768, 0.2905];
        state.current.map = lib.createMap(el.current, center, 12);
      }
      const map = state.current.map;
      if (dest && !state.current.dest) state.current.dest = L.marker([dest.lat, dest.lng], { icon: lib.pinIcon('home') }).addTo(map).bindTooltip('You', { permanent: true, direction: 'top', offset: [0, -12] });
      if (van) {
        if (!state.current.van) state.current.van = L.marker([van.lat, van.lng], { icon: lib.vanIcon(van.heading), zIndexOffset: 1000 }).addTo(map).bindTooltip('Mobile lab', { direction: 'top', offset: [0, -24] });
        else {
          state.current.van.setLatLng([van.lat, van.lng]);
          state.current.van.setIcon(lib.vanIcon(van.heading));
        }
        if (dest) {
          const pts: [number, number][] = [[van.lat, van.lng], [dest.lat, dest.lng]];
          if (!state.current.line) state.current.line = L.polyline(pts, { color: '#ff2e55', weight: 3, dashArray: '6 8', opacity: 0.85 }).addTo(map);
          else state.current.line.setLatLngs(pts);
          map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 15, animate: true });
        } else map.panTo([van.lat, van.lng]);
      } else {
        state.current.van?.remove();
        state.current.van = undefined;
        state.current.line?.remove();
        state.current.line = undefined;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data.van?.lat, data.van?.lng, data.destination?.lat]);
  return <div ref={el} class="map track-map" role="img" aria-label="Live map" />;
}

function Feedback({ data }: { data: TrackPayload }) {
  const [rating, setRating] = useState(0);
  const [body, setBody] = useState('');
  const [sent, setSent] = useState<{ reviewUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (sent) {
    return (
      <div class="card stack" id="feedback">
        <h3>Thank you!</h3>
        {sent.reviewUrl ? <><p class="muted" style="margin:0">Glad it went well. Would you share that on Google? It takes a minute and really helps a small local business.</p><a class="btn btn-primary" href={sent.reviewUrl} target="_blank" rel="noopener">Leave a Google review</a></> : <p class="muted" style="margin:0">Your feedback has gone straight to the technician. If anything needs putting right, we'll be in touch.</p>}
      </div>
    );
  }
  return (
    <form class="card stack" id="feedback" onSubmit={async (e) => {
      e.preventDefault();
      if (!rating) return toast('Tap a star rating first.', { icon: 'info' });
      setBusy(true);
      try {
        setSent(await api<{ reviewUrl: string }>(`/api/track/${token}/feedback`, { body: { rating, body } }));
      } catch (err) {
        toast(errorMessage(err), { icon: 'alert' });
      } finally {
        setBusy(false);
      }
    }}>
      <h3>How did we do?</h3>
      <div class="stars-input" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button type="button" class={n <= rating ? 'on' : ''} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-checked={rating === n} role="radio" onClick={() => setRating(n)}>★</button>)}</div>
      <textarea class="textarea" maxLength={2000} placeholder="Anything we could do better — or anything you loved?" value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
      <button class="btn btn-primary" disabled={busy}>Send feedback</button>
      <span class="hint">{data.business.name} reads every response.</span>
    </form>
  );
}

/** Extra work found on the job, waiting for the customer's OK (or already decided). */
function Estimates({ data, onDecided }: { data: TrackPayload; onDecided: () => void }) {
  const [busy, setBusy] = useState(0);
  const [note, setNote] = useState<Record<number, string>>({});
  if (!data.estimates?.length) return null;
  const cur = data.currency;
  const decide = async (id: number, decision: 'approve' | 'decline') => {
    if (decision === 'decline' && !confirm('Decline this work? The technician will carry on with the original job only.')) return;
    setBusy(id);
    try {
      await api(`/api/track/${token}/estimates/${id}`, { body: { decision, note: note[id] ?? '' } });
      toast(decision === 'approve' ? 'Approved — the technician has been told and will carry on.' : 'Declined — the technician has been told.', { title: decision === 'approve' ? 'Approved' : 'Declined' });
      onDecided();
    } catch (e) {
      toast(errorMessage(e), { icon: 'alert' });
    } finally {
      setBusy(0);
    }
  };
  return (
    <div class="stack" id={data.estimates.some((e) => e.status === 'pending') ? 'estimates' : undefined} style="gap:12px">
      {data.estimates.map((e) => (
        <div class={`card stack estimate estimate-${e.status}`} style="gap:10px">
          <div class="spread"><span class="eyebrow" style="margin:0">{e.status === 'pending' ? 'Your approval needed' : 'Estimate'}</span><span class={`badge badge-${e.status === 'approved' ? 'good' : e.status === 'declined' ? 'bad' : 'accent'}`}>{e.status}</span></div>
          <h3 style="margin:0">{e.title}</h3>
          {e.note && <p class="muted" style="margin:0;white-space:pre-line">{e.note}</p>}
          {e.items.map((it) => <div class="summary-line"><span>{it.qty !== 1 ? `${it.name} × ${it.qty}` : it.name}</span><span>{money(Math.round(it.qty * it.unitPrice), cur)}</span></div>)}
          <div class="summary-total"><span class="muted">Estimate</span><b style="font-size:1.3rem">{money(e.total, cur)}</b></div>
          {e.status === 'pending' ? (
            <>
              <input class="input" placeholder="Add a note for the technician (optional)" maxLength={500} value={note[e.id] ?? ''} onInput={(ev) => setNote({ ...note, [e.id]: (ev.target as HTMLInputElement).value })} />
              <div class="row" style="flex-wrap:nowrap">
                <button type="button" class="btn btn-primary" style="flex:1" disabled={busy === e.id} onClick={() => decide(e.id, 'approve')}>Approve {money(e.total, cur)}</button>
                <button type="button" class="btn" disabled={busy === e.id} onClick={() => decide(e.id, 'decline')}>Decline</button>
              </div>
              <p class="faint" style="margin:0;font-size:.8rem">Approving adds this work to your invoice. Questions first? Call {data.business.phone}.</p>
            </>
          ) : e.decidedAt && <p class="faint" style="margin:0;font-size:.82rem">{e.status === 'approved' ? 'Approved' : 'Declined'} {formatDateTime(e.decidedAt)}</p>}
        </div>
      ))}
    </div>
  );
}

function App() {
  const [data, setData] = useState<TrackPayload | null>(null);
  const [error, setError] = useState('');
  const [paying, setPaying] = useState(false);

  async function load() {
    try {
      setData(await api<TrackPayload>(`/api/track/${token}`));
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  useEffect(() => {
    void load();
    const q = new URLSearchParams(location.search);
    if (q.get('paid') === '1') toast('Payment received — thank you!', { title: 'Paid' });
    if (q.get('paid') === '0') toast('Payment was cancelled. You can pay on completion instead.', { icon: 'info' });
  }, []);
  useEffect(() => {
    if (!data) return;
    const live = data.status === 'en_route' || data.status === 'arrived' || data.status === 'in_progress';
    const t = setInterval(() => document.visibilityState === 'visible' && load(), live ? 15000 : 60000);
    return () => clearInterval(t);
  }, [data?.status]);

  if (error && !data) return <div class="alert alert-bad"><span>{error}</span></div>;
  if (!data) return <div class="skeleton" style="height:420px" />;

  const cur = data.currency;
  const stageIndex = data.status === 'cancelled' || data.status === 'no_show' ? -1 : data.status === 'pending' ? 0 : TRACK_STAGES.findIndex((st) => st.status === data.status);
  const eventAt = (status: string) => data.events.filter((e) => e.type === status || (status === 'confirmed' && e.type === 'created')).at(-1)?.at;
  const tone = data.status === 'completed' ? 'good' : data.status === 'cancelled' || data.status === 'no_show' ? 'bad' : data.status === 'en_route' ? 'accent' : 'info';
  const wa = `https://wa.me/${data.business.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi, about my booking ${data.ref}: `)}`;
  const canCancel = (data.status === 'pending' || data.status === 'confirmed') && data.date > new Date().toISOString().slice(0, 10);

  return (
    <div class="stack" style="gap:22px">
      <div class="spread" style="align-items:flex-end">
        <div>
          <span class="eyebrow">Live tracker · {data.ref}</span>
          <h1 class="display" style="font-size:clamp(2.2rem,6vw,3.6rem)">{data.status === 'en_route' ? 'On the way' : data.status === 'arrived' ? 'Technician arrived' : data.status === 'in_progress' ? 'Work in progress' : data.status === 'completed' ? 'All done' : data.status === 'cancelled' ? 'Cancelled' : "You're booked in"}</h1>
          <p class="lead" style="margin:8px 0 0">{data.statusText}</p>
        </div>
        <span class={`badge badge-${tone}`} style="height:30px;font-size:.75rem"><span class={`dot${data.status === 'en_route' ? ' dot-live' : ''}`} />{data.status.replace('_', ' ')}</span>
      </div>

      <div class="track-layout">
        <div class="stack">
          {data.estimates?.some((e) => e.status === 'pending') && <Estimates data={{ ...data, estimates: data.estimates.filter((e) => e.status === 'pending') }} onDecided={() => void load()} />}
          {data.status === 'en_route' && (
            <div class="card card-glass eta">
              <span style="color:var(--accent-hi)"><Svg d={P.van} size={42} /></span>
              <span><small>Estimated arrival</small><br /><b>{data.etaMinutes != null ? `${data.etaMinutes} min` : 'Soon'}</b></span>
              {data.van && <span class="faint mono" style="margin-left:auto;font-size:.74rem">Updated {formatDateTime(data.van.updatedAt)}</span>}
            </div>
          )}
          {(data.destination || data.van) ? <MapView data={data} /> : (
            <div class="card stack" style="min-height:200px;justify-content:center;text-align:center">
              <span style="color:var(--accent-hi);margin:0 auto"><Svg d={P.pin} size={36} /></span>
              <p class="muted" style="margin:0">{data.serviceMode === 'drop_off' ? `Drop-off at our lab on ${formatDate(data.date, 'long')}.` : 'The live map appears here when your technician sets off.'}</p>
            </div>
          )}
          <div class="card">
            <h3 style="margin-bottom:16px">Progress</h3>
            {stageIndex < 0 ? <div class="alert alert-bad"><span>This booking was {data.status === 'no_show' ? 'marked as missed' : 'cancelled'}. Questions? Call <a href={`tel:${data.business.phone}`}>{data.business.phone}</a>.</span></div> : (
              <ol class="timeline">
                {TRACK_STAGES.map((st, i) => (
                  <li class={i < stageIndex || data.status === 'completed' ? 'done' : i === stageIndex ? 'current' : ''}>
                    <span class="node" />
                    <span><b>{st.label}</b><small>{eventAt(st.status) ? formatDateTime(eventAt(st.status)!) : i === 0 && data.status === 'pending' ? 'Awaiting confirmation' : ''}</small></span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          {data.estimates?.some((e) => e.status !== 'pending') && <Estimates data={{ ...data, estimates: data.estimates.filter((e) => e.status !== 'pending') }} onDecided={() => void load()} />}
          {data.status === 'completed' && <Feedback data={data} />}
        </div>

        <aside class="stack">
          <div class="card stack" style="gap:10px">
            <div class="summary-line"><span class="muted">When</span><span>{formatDate(data.date, 'day')}</span></div>
            <div class="summary-line"><span class="muted">Window</span><span>{data.slot}</span></div>
            <div class="summary-line"><span class="muted">Technician</span><span>{data.technician}</span></div>
            <div class="summary-line" style="align-items:flex-start"><span class="muted">Where</span><span style="text-align:right;font-family:var(--font-sans);font-size:.88rem">{data.address}</span></div>
            {data.vehicles.map((v) => <div class="summary-line"><span class="plate-mini mono" style="background:var(--plate-bg);color:#111;padding:1px 7px;border-radius:5px;font-weight:700">{v.reg}</span><span style="font-family:var(--font-sans)">{v.label}</span></div>)}
            <hr class="divider" style="margin:6px 0" />
            {data.items.map((it) => <div class="summary-line"><span>{it.name}</span><span>{money(it.price, cur)}</span></div>)}
            <div class="summary-total"><span class="muted">Total</span><b style="font-size:1.4rem">{money(data.total, cur)}</b></div>
            {data.paid > 0 && <div class="summary-line discount"><span>Paid</span><span>−{money(data.paid, cur)}</span></div>}
            {data.paid > 0 && <div class="summary-line"><span><b>Balance</b></span><span><b>{money(data.balance, cur)}</b></span></div>}
            {data.canPayOnline && (
              <button type="button" class="btn btn-primary btn-block" disabled={paying} onClick={async () => {
                setPaying(true);
                try {
                  const { url } = await api<{ url: string }>(`/api/track/${token}/pay`, { body: { kind: 'balance' } });
                  location.href = url;
                } catch (e) {
                  toast(errorMessage(e), { icon: 'alert' });
                  setPaying(false);
                }
              }}><Svg d={P.card} /> Pay {money(data.balance, cur)} — Apple Pay, Google Pay or card</button>
            )}
          </div>
          {data.documents.length > 0 && (
            <div class="card stack" style="gap:10px">
              <h3>Documents</h3>
              {data.documents.map((d) => <a class="doc-link" href={d.href} target="_blank" rel="noopener"><Svg d={P.file} size={22} /><span><b>{d.label}</b><br /><span class="faint" style="font-size:.8rem">PDF · {data.ref}</span></span></a>)}
            </div>
          )}
          <div class="card stack" style="gap:10px">
            <a class="btn btn-block" href={`tel:${data.business.phone}`}><Svg d={P.phone} /> Call {data.business.phone}</a>
            <a class="btn btn-block" href={wa} target="_blank" rel="noopener"><Svg d={P.wa} /> WhatsApp</a>
            <a class="btn btn-block btn-ghost" href={`/track/${token}/calendar.ics`}><Svg d={P.cal} /> Add to calendar</a>
            {canCancel && <button type="button" class="btn btn-block btn-ghost" style="color:var(--bad)" onClick={async () => {
              const reason = prompt('Sorry to see you go — would you tell us why? (optional)');
              if (reason === null) return;
              try {
                await api(`/api/track/${token}/cancel`, { body: { reason } });
                toast('Your booking has been cancelled.');
                void load();
              } catch (e) {
                toast(errorMessage(e), { icon: 'alert' });
              }
            }}>Cancel booking</button>}
          </div>
        </aside>
      </div>
    </div>
  );
}

if (root && token) {
  enableRipples();
  root.innerHTML = '';
  render(<App />, root);
}
