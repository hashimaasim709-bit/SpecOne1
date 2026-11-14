// Booking wizard (#1–#15): vehicles → services → when & where → details.
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fitsDay, scarcityLabel } from '../shared/availability';
import { BODIES, BODY_LABELS, SIZES, SLOT_ORDER, SLOTS, SYMPTOM_CHIPS, type Body, type BookingSlot, type Size, type SlotKey } from '../shared/constants';
import { addDays, formatDate, isUkPostcode, isValidEmail, isValidPhone, normPostcode, normReg, regYear, todayIn, weekdayOf } from '../shared/format';
import { computeQuote, priceFor } from '../shared/pricing';
import type { BookingConfig, CreateBookingResponse, DayAvailability, PackageLite, PromoInfo, Quote } from '../shared/types';
import { classifyVehicle } from '../shared/vehicle';
import { api, ApiError, compressImage, errorMessage, readConfig, uploadFile } from './lib/api';
import { enableRipples, money, store } from './lib/ui';

const root = document.getElementById('book-app');

interface Vehicle { reg: string; make: string; model: string; year: number | null; fuel: string; colour: string; size: Size; body: Body; packageIds: number[]; sizeTouched: boolean; lookup: 'idle' | 'busy' | 'done' }
interface Geo { postcode: string; miles: number; fee: number; zone: string; outOfArea: boolean; town: string; addresses: string[] }
interface State {
  step: number;
  vehicles: Vehicle[];
  active: number;
  category: string;
  symptoms: string[];
  notes: string;
  photos: { id: number; url: string }[];
  serviceMode: 'mobile' | 'drop_off';
  postcode: string;
  geo: Geo | null;
  address: string;
  emergency: boolean;
  date: string | null;
  slot: BookingSlot | null;
  name: string;
  email: string;
  phone: string;
  marketing: boolean;
  promoInput: string;
  promo: PromoInfo | null;
  partnerPct: number;
  promoNote: string;
  usePoints: boolean;
  payDeposit: boolean;
  paymentMethod: 'on_completion' | 'cash' | 'bank_transfer';
  utilities: boolean;
  agree: boolean;
}

const newVehicle = (): Vehicle => ({ reg: '', make: '', model: '', year: null, fuel: '', colour: '', size: 'M', body: 'hatchback', packageIds: [], sizeTouched: false, lookup: 'idle' });
const STEPS = ['Your vehicle', 'Choose services', 'When & where', 'Your details'];
const CATS: [string, string][] = [['diagnostics', 'Diagnostics & coding'], ['detailing', 'Detailing'], ['plan', 'Plans'], ['addon', 'Add-ons']];
const DRAFT = 's1-book-draft';
const OUTBOX = 's1-book-outbox';

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d }} />;
}
const I = {
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  camera: '<path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.5-2h6l1.5 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/>',
  spark: '<path d="M12 3.5l1.8 5 5 1.8-5 1.8-1.8 5-1.8-5-5-1.8 5-1.8z"/>',
  alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.2h.01"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 1 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  wa: '<path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z"/>',
};

function loadInitial(): State {
  const base: State = {
    step: 0, vehicles: [newVehicle()], active: 0, category: 'diagnostics', symptoms: [], notes: '', photos: [], serviceMode: 'mobile', postcode: store.get('s1-postcode') ?? '',
    geo: null, address: '', emergency: false, date: null, slot: null, name: '', email: '', phone: '', marketing: false, promoInput: '', promo: null, partnerPct: 0, promoNote: '',
    usePoints: false, payDeposit: false, paymentMethod: 'on_completion', utilities: false, agree: false,
  };
  try {
    const draft = JSON.parse(sessionStorage.getItem(DRAFT) ?? 'null') as Partial<State> | null;
    if (draft && Array.isArray(draft.vehicles)) Object.assign(base, draft, { step: Math.min(draft.step ?? 0, 2), photos: [] });
  } catch {
    /* ignore */
  }
  return base;
}

function Plate({ value, onInput, onLookup, busy }: { value: string; onInput: (v: string) => void; onLookup: () => void; busy: boolean }) {
  return (
    <div class="plate">
      <div class="plate-band">UK</div>
      <input value={value} maxLength={8} placeholder="AB12 CDE" aria-label="Registration number" autoCapitalize="characters" autoComplete="off" spellcheck={false}
        onInput={(e) => onInput((e.target as HTMLInputElement).value.toUpperCase())} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onLookup())} />
      <button type="button" onClick={onLookup} disabled={busy || normReg(value).length < 2}>{busy ? <span class="spinner" /> : 'Look up'}</button>
    </div>
  );
}

function Calendar({ month, setMonth, days, selected, onSelect, span, today }: { month: string; setMonth: (m: string) => void; days: Map<string, DayAvailability>; selected: string | null; onSelect: (d: string) => void; span: number; today: string }) {
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7;
  const dim = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: dim }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const shift = (n: number) => {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  return (
    <div class="cal">
      <div class="cal-head">
        <button class="btn btn-ghost btn-icon" type="button" onClick={() => shift(-1)} disabled={month <= today.slice(0, 7)} aria-label="Previous month"><Icon d={I.back} /></button>
        <b>{new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${first}T12:00:00Z`))}</b>
        <button class="btn btn-ghost btn-icon" type="button" onClick={() => shift(1)} aria-label="Next month"><Icon d={I.arrow} /></button>
      </div>
      <div class="cal-grid" role="grid">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <div class="cal-dow">{d}</div>)}
        {cells.map((date) => {
          if (!date) return <div />;
          const day = days.get(date);
          const open = !!day && SLOT_ORDER.some((s) => fitsDay(day, s, span));
          const remaining = day ? Object.values(day.slots).reduce<number>((a, n) => a + (n ?? 0), 0) : 0;
          return (
            <button type="button" class={`cal-day${date === today ? ' is-today' : ''}`} disabled={!open} aria-pressed={selected === date} onClick={() => onSelect(date)}
              title={day?.closed ? day.reason : open ? `${remaining} window${remaining === 1 ? '' : 's'} open` : 'Not available for this job length'}>
              {Number(date.slice(8))}
              {open && <span class={`avail${remaining <= 1 ? ' low' : ''}`} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Where this visitor came from (?src=flyer:slug, trade, qr…), remembered for the session. */
function bookingChannel(): string {
  try {
    const src = new URLSearchParams(location.search).get('src');
    if (src) sessionStorage.setItem('s1-channel', src.slice(0, 60));
    return sessionStorage.getItem('s1-channel') ?? '';
  } catch {
    return '';
  }
}

function App({ cfg, fleetSlug }: { cfg: BookingConfig; fleetSlug: string }) {
  const [s, setS] = useState<State>(loadInitial);
  const set = (patch: Partial<State> | ((prev: State) => Partial<State>)) => setS((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));
  const today = todayIn(cfg.business.timezone);
  const [month, setMonth] = useState((s.date ?? today).slice(0, 7));
  const [avail, setAvail] = useState<Map<string, DayAvailability>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<CreateBookingResponse | null>(null);
  const [queued, setQueued] = useState(false);
  const [pcBusy, setPcBusy] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileId = useRef<string | null>(null);
  const cur = cfg.business.currency;
  const pkgById = useMemo(() => new Map(cfg.packages.map((p) => [p.id, p])), [cfg]);
  const pkgBySlug = useMemo(() => new Map(cfg.packages.map((p) => [p.slug, p])), [cfg]);
  const v = s.vehicles[s.active] ?? s.vehicles[0]!;

  // Deep links: ?package=slug&promo=CODE&postcode=…&symptom=P2002&emergency=1
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const slug = q.get('package');
    const pkg = slug ? pkgBySlug.get(slug) : undefined;
    set((prev) => {
      const vehicles = prev.vehicles.map((x, i) => (i === 0 && pkg && !x.packageIds.includes(pkg.id) ? { ...x, packageIds: [...x.packageIds, pkg.id] } : x));
      return {
        vehicles,
        category: pkg ? pkg.category : prev.category,
        emergency: q.get('emergency') === '1' || root?.dataset.emergency === '1' || prev.emergency,
        postcode: q.get('postcode') ? normPostcode(q.get('postcode')!) : prev.postcode,
        promoInput: q.get('promo') ? q.get('promo')!.toUpperCase() : prev.promoInput,
        notes: q.get('symptom') && !prev.notes.includes(q.get('symptom')!) ? `${q.get('symptom')} ${prev.notes}`.trim() : prev.notes,
        name: prev.name || cfg.customer?.name || '',
        email: prev.email || cfg.customer?.email || '',
        phone: prev.phone || cfg.customer?.phone || '',
      };
    });
    if (q.get('promo')) void applyPromo(q.get('promo')!.toUpperCase());
    if (q.get('postcode') || s.postcode) void lookupPostcode(q.get('postcode') ?? s.postcode, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the draft so a refresh doesn't lose progress.
  useEffect(() => {
    try {
      const { photos: _p, ...rest } = s;
      sessionStorage.setItem(DRAFT, JSON.stringify(rest));
    } catch {
      /* ignore */
    }
  }, [s]);

  // Live availability for the visible month.
  useEffect(() => {
    const from = `${month}-01` < today ? today : `${month}-01`;
    let cancelled = false;
    api<{ days: DayAvailability[] }>(`/api/public/availability?from=${from}&days=42`).then(({ days }) => {
      if (cancelled) return;
      setAvail((prev) => {
        const next = new Map(prev);
        days.forEach((d) => next.set(d.date, d));
        return next;
      });
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [month]);

  // Retry a booking queued while offline.
  useEffect(() => {
    const flush = async () => {
      const pending = store.get(OUTBOX);
      if (!pending || !navigator.onLine) return;
      try {
        const res = await api<CreateBookingResponse>('/api/public/bookings', { body: JSON.parse(pending) });
        store.remove(OUTBOX);
        setQueued(false);
        setDone(res);
      } catch (e) {
        if (e instanceof ApiError && e.status !== 0) {
          store.remove(OUTBOX);
          setQueued(false);
          setError(e.message);
        }
      }
    };
    window.addEventListener('online', flush);
    void flush();
    return () => window.removeEventListener('online', flush);
  }, []);

  const tradePct = Math.max(cfg.fleet?.discountPct ?? 0, s.partnerPct);
  const loyaltyPoints = s.usePoints && cfg.customer ? cfg.customer.loyaltyPoints : 0;
  const quote: Quote = computeQuote(
    { vehicles: s.vehicles.map((x) => ({ size: x.size, packageIds: x.packageIds })), date: s.date, slot: s.slot, emergency: s.emergency, serviceMode: s.serviceMode, distanceMiles: s.serviceMode === 'mobile' ? s.geo?.miles ?? null : null, promo: s.promo, tradeDiscountPct: tradePct, loyaltyPoints },
    cfg,
  );
  const span = quote.slotSpan;

  const updateVehicle = (patch: Partial<Vehicle>, index = s.active) => set((prev) => ({ vehicles: prev.vehicles.map((x, i) => (i === index ? { ...x, ...patch } : x)) }));

  async function lookupVehicle(index = s.active) {
    const reg = normReg(s.vehicles[index]!.reg);
    if (reg.length < 2) return;
    updateVehicle({ lookup: 'busy' }, index);
    try {
      const r = await api<{ found: boolean; make: string; model: string; year: number | null; fuel: string; colour: string; size: Size | null; body: Body | null }>('/api/public/vehicle', { body: { reg } });
      set((prev) => ({
        vehicles: prev.vehicles.map((x, i) => {
          if (i !== index) return x;
          const make = x.make || r.make;
          const model = x.model || r.model;
          const guess = classifyVehicle(`${make} ${model}`);
          return { ...x, make, model, year: r.year ?? x.year, fuel: r.fuel || x.fuel, colour: r.colour || x.colour, size: x.sizeTouched ? x.size : r.size ?? guess.size, body: x.sizeTouched ? x.body : r.body ?? guess.body, lookup: 'done' };
        }),
      }));
    } catch {
      updateVehicle({ lookup: 'done', year: regYear(reg) }, index);
    }
  }

  function onModel(field: 'make' | 'model', value: string) {
    set((prev) => ({
      vehicles: prev.vehicles.map((x, i) => {
        if (i !== prev.active) return x;
        const next = { ...x, [field]: value };
        if (!x.sizeTouched) Object.assign(next, classifyVehicle(`${next.make} ${next.model}`));
        return next;
      }),
    }));
  }

  const togglePackage = (id: number) => updateVehicle({ packageIds: v.packageIds.includes(id) ? v.packageIds.filter((x) => x !== id) : [...v.packageIds, id] });

  async function lookupPostcode(raw: string, showErrors = true) {
    const pc = normPostcode(raw);
    if (!isUkPostcode(pc)) {
      if (showErrors) setFieldErrors({ postcode: 'Enter a full UK postcode, e.g. BN21 4AB.' });
      return;
    }
    setPcBusy(true);
    setFieldErrors({});
    try {
      const r = await api<Geo>(`/api/public/postcode?pc=${encodeURIComponent(pc)}&addresses=${cfg.features.addressLookup ? '1' : '0'}`);
      set({ geo: r, postcode: r.postcode });
      store.set('s1-postcode', r.postcode);
    } catch (e) {
      set({ geo: null });
      if (showErrors) setFieldErrors({ postcode: errorMessage(e) });
    } finally {
      setPcBusy(false);
    }
  }

  async function applyPromo(code = s.promoInput) {
    const c = code.trim().toUpperCase();
    if (!c) return set({ promo: null, partnerPct: 0, promoNote: '' });
    try {
      const r = await api<{ ok: true; kind: 'promo'; promo: PromoInfo } | { ok: true; kind: 'partner'; tradeDiscountPct: number; description: string }>('/api/public/promo', { body: { code: c } });
      if (r.kind === 'partner') set({ promo: null, partnerPct: r.tradeDiscountPct, promoNote: `${r.description}${r.tradeDiscountPct ? ` — ${r.tradeDiscountPct}% off` : ''}`, promoInput: c });
      else set({ promo: r.promo, partnerPct: 0, promoNote: r.promo.description || 'Code applied', promoInput: c });
    } catch (e) {
      set({ promo: null, partnerPct: 0, promoNote: '' });
      setFieldErrors({ promoCode: errorMessage(e) });
    }
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    for (const file of [...files].slice(0, 6 - s.photos.length)) {
      try {
        const blob = await compressImage(file, 1800);
        const r = await uploadFile('/api/public/upload', blob, {}, 'photo.jpg');
        set((prev) => ({ photos: [...prev.photos, { id: r.id, url: URL.createObjectURL(blob) }] }));
      } catch (e) {
        setError(errorMessage(e));
      }
    }
  }

  // Turnstile on the final step, when configured.
  useEffect(() => {
    if (s.step !== 3 || !cfg.features.turnstileSiteKey || !turnstileRef.current || turnstileId.current) return;
    const w = window as unknown as { turnstile?: { render: (el: Element, o: Record<string, unknown>) => string } };
    const renderWidget = () => {
      if (w.turnstile && turnstileRef.current) turnstileId.current = w.turnstile.render(turnstileRef.current, { sitekey: cfg.features.turnstileSiteKey, theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' });
    };
    if (w.turnstile) renderWidget();
    else {
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.onload = renderWidget;
      document.head.append(sc);
    }
  }, [s.step]);

  function validate(step: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (step === 0) s.vehicles.forEach((x, i) => normReg(x.reg).length < 2 && (e[`reg${i}`] = 'Enter the registration.'));
    if (step === 1) s.vehicles.forEach((x, i) => !x.packageIds.length && (e[`pkg${i}`] = `Choose at least one service${s.vehicles.length > 1 ? ` for ${normReg(x.reg) || `vehicle ${i + 1}`}` : ''}.`));
    if (step === 2) {
      if (s.serviceMode === 'mobile') {
        if (!s.geo) e.postcode = 'Enter and check your postcode.';
        else if (s.geo.outOfArea) e.postcode = `That address is outside our standard area — please call ${cfg.business.phone}.`;
        if (s.address.trim().length < 5) e.address = 'Enter the address for the visit.';
        if (quote.needsUtilities && !s.utilities) e.utilities = 'Please confirm water and power access, or choose lab drop-off.';
      }
      if (!s.emergency && (!s.date || !s.slot)) e.slot = 'Choose a date and arrival window.';
    }
    if (step === 3) {
      if (s.name.trim().length < 2) e.name = 'Enter your name.';
      if (!isValidPhone(s.phone)) e.phone = 'Enter a valid mobile number.';
      if (!isValidEmail(s.email)) e.email = 'Enter a valid email address.';
      if (!s.agree) e.agree = 'Please accept the terms.';
    }
    return e;
  }

  function go(step: number) {
    if (step > s.step) {
      for (let i = s.step; i < step; i++) {
        const errs = validate(i);
        if (Object.keys(errs).length) {
          setFieldErrors(errs);
          setError(Object.values(errs)[0]!);
          set({ step: i });
          return;
        }
      }
    }
    setError('');
    setFieldErrors({});
    set({ step });
    window.scrollTo({ top: Math.max(0, (root?.getBoundingClientRect().top ?? 0) + scrollY - 90), behavior: 'smooth' });
  }

  async function submit() {
    const errs = validate(3);
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      setError(Object.values(errs)[0]!);
      return;
    }
    const w = window as unknown as { turnstile?: { getResponse: (id: string) => string } };
    const body = {
      vehicles: s.vehicles.map((x) => ({ reg: x.reg, make: x.make, model: x.model, year: x.year, fuel: x.fuel, colour: x.colour, size: x.size, body: x.body, packageIds: x.packageIds })),
      date: s.emergency ? today : s.date!, slot: s.emergency ? 'asap' : s.slot!, emergency: s.emergency, serviceMode: s.serviceMode, address: s.address, postcode: s.geo?.postcode ?? s.postcode,
      customer: { name: s.name, email: s.email, phone: s.phone, marketing: s.marketing }, notes: s.notes, symptoms: s.symptoms, photoIds: s.photos.map((p) => p.id),
      promoCode: s.promoInput, loyaltyPoints, paymentMethod: s.paymentMethod, payDeposit: s.payDeposit, utilitiesConfirmed: s.utilities, fleetSlug, channel: bookingChannel(),
      turnstileToken: turnstileId.current && w.turnstile ? w.turnstile.getResponse(turnstileId.current) ?? '' : '', website: (document.getElementById('bk-website') as HTMLInputElement | null)?.value ?? '',
    };
    setBusy(true);
    setError('');
    try {
      const res = await api<CreateBookingResponse>('/api/public/bookings', { body });
      sessionStorage.removeItem(DRAFT);
      setDone(res);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (res.checkoutUrl && s.payDeposit) setTimeout(() => (location.href = res.checkoutUrl!), 1600);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        store.set(OUTBOX, JSON.stringify(body));
        setQueued(true);
      } else {
        setError(errorMessage(e));
        if (e instanceof ApiError) {
          setFieldErrors(e.fields);
          if (e.fields.slot) set({ step: 2, slot: null });
        }
      }
    } finally {
      setBusy(false);
    }
  }

  if (done) return <Success res={done} cfg={cfg} s={s} />;

  const pkgs = cfg.packages.filter((p) => p.category === s.category);
  const selected = v.packageIds.map((id) => pkgById.get(id)).filter(Boolean) as PackageLite[];
  const upsells = cfg.upsells
    .filter((u) => (u.triggerSlug && selected.some((p) => p.slug === u.triggerSlug)) || (u.triggerCategory && !u.triggerSlug && selected.some((p) => p.category === u.triggerCategory)))
    .map((u) => ({ ...u, pkg: pkgBySlug.get(u.suggestSlug) }))
    .filter((u) => u.pkg && !v.packageIds.includes(u.pkg.id))
    .filter((u, i, arr) => arr.findIndex((x) => x.suggestSlug === u.suggestSlug) === i)
    .slice(0, 2);
  const day = s.date ? avail.get(s.date) : undefined;

  return (
    <div class="wizard">
      <div>
        <div class="progress" aria-hidden="true">{STEPS.map((_, i) => <span class={i < s.step ? 'done' : i === s.step ? 'current' : ''} />)}</div>
        {cfg.fleet && <div class="alert alert-good" style="margin-bottom:18px"><Icon d={I.check} /><span>Booking for <b>{cfg.fleet.companyName}</b>{cfg.fleet.discountPct ? ` — your agreed ${cfg.fleet.discountPct}% rate is applied.` : '.'}</span></div>}
        <span class="step-label">Step {s.step + 1} of 4</span>
        <h1 class="step-title">{STEPS[s.step]}</h1>

        {s.step === 0 && (
          <div class="step-panel stack" style="gap:20px">
            {s.vehicles.length > 1 && <VehicleTabs s={s} set={set} />}
            <div class="field">
              <label>Registration</label>
              <Plate value={v.reg} busy={v.lookup === 'busy'} onInput={(reg) => updateVehicle({ reg, lookup: 'idle' })} onLookup={() => lookupVehicle()} />
              {fieldErrors[`reg${s.active}`] && <span class="error">{fieldErrors[`reg${s.active}`]}</span>}
              {v.lookup === 'done' && <span class="hint">{v.make ? `Found: ${[v.year, v.make, v.model, v.colour].filter(Boolean).join(' ')}` : v.year ? `Registered around ${v.year}. Add the make and model below.` : 'Add the make and model below.'}</span>}
            </div>
            <div class="form-grid">
              <div class="field"><label for="bk-make">Make</label><input class="input" id="bk-make" value={v.make} onInput={(e) => onModel('make', (e.target as HTMLInputElement).value)} placeholder="Ford, BMW, Land Rover…" maxLength={60} /></div>
              <div class="field"><label for="bk-model">Model</label><input class="input" id="bk-model" value={v.model} onInput={(e) => onModel('model', (e.target as HTMLInputElement).value)} placeholder="Puma, 330d, Range Rover Sport…" maxLength={80} /></div>
            </div>
            <div class="field">
              <span class="label">Size (detailing prices depend on this)</span>
              <div class="option-grid">{(Object.keys(SIZES) as Size[]).map((sz) => (
                <button type="button" class="option" aria-pressed={v.size === sz} onClick={() => updateVehicle({ size: sz, sizeTouched: true })}><span class="tick" /><b>{SIZES[sz].label}</b><small>{SIZES[sz].examples}</small></button>
              ))}</div>
            </div>
            <div class="field">
              <span class="label">Body style</span>
              <div class="chip-row">{BODIES.map((b) => <button type="button" class="chip" aria-pressed={v.body === b} onClick={() => updateVehicle({ body: b, sizeTouched: true })}>{BODY_LABELS[b]}</button>)}</div>
            </div>
            {s.vehicles.length < cfg.maxVehicles && (
              <button type="button" class="btn btn-ghost" style="align-self:flex-start" onClick={() => set((prev) => ({ vehicles: [...prev.vehicles, newVehicle()], active: prev.vehicles.length }))}>
                <Icon d={I.plus} /> Add another vehicle {s.vehicles.length >= 1 && cfg.pricing.multiVehiclePct ? <span class="badge badge-good">−{cfg.pricing.multiVehiclePct}% each</span> : null}
              </button>
            )}
          </div>
        )}

        {s.step === 1 && (
          <div class="step-panel stack" style="gap:18px">
            {s.vehicles.length > 1 && <VehicleTabs s={s} set={set} />}
            <div class="chip-row" role="tablist">{CATS.filter(([c]) => cfg.packages.some((p) => p.category === c)).map(([c, label]) => <button type="button" role="tab" class="chip" aria-pressed={s.category === c} onClick={() => set({ category: c })}>{label}</button>)}</div>
            <div class="stack" style="gap:10px">
              {pkgs.map((p) => (
                <button type="button" class="svc" aria-pressed={v.packageIds.includes(p.id)} onClick={() => togglePackage(p.id)}>
                  <h4>{p.name}</h4>
                  <span class="svc-price price" style="font-size:1.15rem">{money(priceFor(p, v.size), cur)}</span>
                  <p>{p.summary}</p>
                  <span class="svc-foot">
                    <span class="row" style="gap:8px">{p.badge && <span class="badge badge-accent">{p.badge}</span>}<span class="meta"><Icon d={I.clock} size={14} />{p.duration_min >= 60 ? `${Math.round(p.duration_min / 6) / 10} hr` : `${p.duration_min} min`}</span>{p.needs_utilities ? <span class="badge badge-warn">Tap &amp; 240V</span> : null}</span>
                    <span class="add">{v.packageIds.includes(p.id) ? <><Icon d={I.check} size={16} /> Added</> : <><Icon d={I.plus} size={16} /> Add</>}</span>
                  </span>
                </button>
              ))}
            </div>
            {fieldErrors[`pkg${s.active}`] && <div class="alert alert-bad"><Icon d={I.alert} /><span>{fieldErrors[`pkg${s.active}`]}</span></div>}
            {upsells.map((u) => (
              <div class="upsell">
                <span class="icon"><Icon d={I.spark} /></span>
                <span style="flex:1"><b>{u.pkg!.name}</b> · <span class="mono">{money(priceFor(u.pkg!, v.size), cur)}</span><br /><span class="muted" style="font-size:.88rem">{u.message}</span></span>
                <button type="button" class="btn btn-sm btn-primary" onClick={() => togglePackage(u.pkg!.id)}><Icon d={I.plus} /> Add</button>
              </div>
            ))}
            <div class="field">
              <span class="label">What's going on? (optional)</span>
              <div class="chip-row">{SYMPTOM_CHIPS.map((sym) => <button type="button" class="chip" aria-pressed={s.symptoms.includes(sym)} onClick={() => set((p) => ({ symptoms: p.symptoms.includes(sym) ? p.symptoms.filter((x) => x !== sym) : [...p.symptoms, sym] }))}>{sym}</button>)}</div>
              <textarea class="textarea" value={s.notes} maxLength={2000} placeholder="Fault codes, warning lights, when it happens, coding requests…" onInput={(e) => set({ notes: (e.target as HTMLTextAreaElement).value })} />
            </div>
            <div class="field">
              <span class="label">Photo of the warning light or problem (optional)</span>
              <label class="dropzone">
                <Icon d={I.camera} size={28} />
                <b>Take or upload photos</b>
                <span class="hint">Dashboard lights, fault messages or the area to be detailed — up to 6</span>
                <input type="file" accept="image/*" multiple hidden onChange={(e) => addPhotos((e.target as HTMLInputElement).files)} />
              </label>
              {s.photos.length > 0 && <div class="photo-thumbs">{s.photos.map((p) => <img src={p.url} alt="Uploaded photo" />)}</div>}
            </div>
          </div>
        )}

        {s.step === 2 && (
          <div class="step-panel stack" style="gap:20px">
            <div class="option-grid">
              <button type="button" class="option" aria-pressed={s.serviceMode === 'mobile'} onClick={() => set({ serviceMode: 'mobile' })}><span class="tick" /><b>We come to you</b><small>Home, work or roadside</small></button>
              <button type="button" class="option" aria-pressed={s.serviceMode === 'drop_off'} onClick={() => set({ serviceMode: 'drop_off', emergency: false })}><span class="tick" /><b>Lab drop-off</b><small>Bring it to {cfg.base.name}</small></button>
            </div>
            {s.serviceMode === 'mobile' && (
              <div class="stack">
                <div class="field">
                  <label for="bk-pc">Postcode</label>
                  <div class="input-group">
                    <input class="input mono" id="bk-pc" value={s.postcode} maxLength={9} autoComplete="postal-code" style="text-transform:uppercase" placeholder="BN21 4AB" aria-invalid={!!fieldErrors.postcode}
                      onInput={(e) => set({ postcode: (e.target as HTMLInputElement).value.toUpperCase(), geo: null })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookupPostcode(s.postcode))} />
                    <button type="button" class="btn" onClick={() => lookupPostcode(s.postcode)} disabled={pcBusy}>{pcBusy ? <span class="spinner" /> : 'Check'}</button>
                  </div>
                  {fieldErrors.postcode && <span class="error">{fieldErrors.postcode}</span>}
                </div>
                {s.geo && (
                  <div class={`alert ${s.geo.outOfArea ? 'alert-warn' : 'alert-good'}`}><Icon d={I.pin} />
                    <span>{s.geo.outOfArea ? <>{s.geo.postcode} is {s.geo.miles} miles away — outside our standard area. Please <a href={`tel:${cfg.business.phone}`}>call {cfg.business.phone}</a>.</> : <><b>{s.geo.postcode}{s.geo.town ? ` · ${s.geo.town}` : ''}</b> — {s.geo.miles} miles from base · {s.geo.fee ? <>travel <b>{money(s.geo.fee, cur)}</b></> : <b>free call-out</b>}</>}</span>
                  </div>
                )}
                {s.geo && !s.geo.outOfArea && (
                  <div class="field">
                    <label for="bk-addr">Address</label>
                    {s.geo.addresses.length > 0 && (
                      <select class="select" onChange={(e) => set({ address: (e.target as HTMLSelectElement).value })} value={s.geo.addresses.includes(s.address) ? s.address : ''}>
                        <option value="">Select your address…</option>
                        {s.geo.addresses.map((a) => <option value={a}>{a}</option>)}
                      </select>
                    )}
                    <input class="input" id="bk-addr" value={s.address} maxLength={200} autoComplete="street-address" placeholder="House number and street" aria-invalid={!!fieldErrors.address} onInput={(e) => set({ address: (e.target as HTMLInputElement).value })} />
                    {fieldErrors.address && <span class="error">{fieldErrors.address}</span>}
                  </div>
                )}
                {quote.needsUtilities && (
                  <label class="check"><input type="checkbox" checked={s.utilities} onChange={(e) => set({ utilities: (e.target as HTMLInputElement).checked })} /><span>There is an outside tap and a 240V socket within about 25 m of where the car will be. {fieldErrors.utilities && <span class="error" style="display:block">{fieldErrors.utilities}</span>}</span></label>
                )}
              </div>
            )}

            {s.serviceMode === 'mobile' && (
              <button type="button" class="slot slot-sos" aria-pressed={s.emergency} onClick={() => set((p) => ({ emergency: !p.emergency, date: !p.emergency ? today : p.date, slot: !p.emergency ? 'asap' : null }))}>
                <b><Icon d={I.alert} size={16} /> Emergency call-out — as soon as possible</b>
                <span class="mono">Priority dispatch today · +{money(cfg.pricing.emergencyFee, cur)}</span>
              </button>
            )}

            {!s.emergency && (
              <div class="stack">
                <Calendar month={month} setMonth={setMonth} days={avail} selected={s.date} today={today} span={span} onSelect={(date) => set({ date, slot: null })} />
                {span > 1 && <div class="alert alert-info"><Icon d={I.info} /><span>Your selection takes about {Math.round(quote.durationMin / 60)} hours, so it needs {span} consecutive windows. Only start times with enough room are shown.</span></div>}
                {s.date && day && (
                  <div>
                    <span class="label">Arrival window · {formatDate(s.date, 'long')}</span>
                    <div class="slots">
                      {SLOT_ORDER.map((slot) => {
                        const offered = day.slots[slot] !== undefined;
                        if (!offered) return null;
                        const ok = fitsDay(day, slot, span);
                        const scarce = scarcityLabel(day.slots[slot] ?? 0, slot);
                        const peak = cfg.peakRules.filter((r) => (r.weekdays.length === 0 || r.weekdays.includes(weekdayOf(s.date!))) && (r.slots.length === 0 || r.slots.includes(slot)));
                        return (
                          <button type="button" class="slot" disabled={!ok} aria-pressed={s.slot === slot} onClick={() => set({ slot })}>
                            <b>{SLOTS[slot].label}</b>
                            <span class="mono">{SLOTS[slot].window}</span>
                            {peak.length > 0 && <span class="badge badge-warn" style="margin-top:6px">{peak.map((r) => `${r.name} ${r.adjust_type === 'percent' ? `${r.value > 0 ? '+' : ''}${r.value}%` : `${r.value > 0 ? '+' : '−'}${money(Math.abs(r.value), cur)}`}`).join(' · ')}</span>}
                            {ok && scarce && <span class="scarce">{scarce}</span>}
                            {!ok && <span class="faint" style="font-size:.78rem;margin-top:4px">{(day.slots[slot] ?? 0) <= 0 ? 'Fully booked' : 'Not enough time for this job'}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                {fieldErrors.slot && <span class="error">{fieldErrors.slot}</span>}
              </div>
            )}
          </div>
        )}

        {s.step === 3 && (
          <div class="step-panel stack" style="gap:18px">
            {cfg.customer && <div class="alert alert-good"><Icon d={I.check} /><span>Signed in as <b>{cfg.customer.name}</b>.</span></div>}
            <div class="form-grid">
              <div class="field"><label for="bk-name">Full name</label><input class="input" id="bk-name" autoComplete="name" value={s.name} maxLength={80} aria-invalid={!!fieldErrors.name} onInput={(e) => set({ name: (e.target as HTMLInputElement).value })} />{fieldErrors.name && <span class="error">{fieldErrors.name}</span>}</div>
              <div class="field"><label for="bk-phone">Mobile</label><input class="input" id="bk-phone" type="tel" autoComplete="tel" value={s.phone} maxLength={24} aria-invalid={!!fieldErrors.phone} onInput={(e) => set({ phone: (e.target as HTMLInputElement).value })} /><span class="hint">For your confirmation text and live tracker link.</span>{fieldErrors.phone && <span class="error">{fieldErrors.phone}</span>}</div>
            </div>
            <div class="field"><label for="bk-email">Email</label><input class="input" id="bk-email" type="email" autoComplete="email" value={s.email} maxLength={120} aria-invalid={!!fieldErrors.email} onInput={(e) => set({ email: (e.target as HTMLInputElement).value })} />{fieldErrors.email && <span class="error">{fieldErrors.email}</span>}</div>
            <div class="field">
              <label for="bk-promo">Promo, referral or partner code</label>
              <div class="input-group"><input class="input mono" id="bk-promo" value={s.promoInput} maxLength={40} style="text-transform:uppercase" onInput={(e) => set({ promoInput: (e.target as HTMLInputElement).value.toUpperCase() })} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), applyPromo())} /><button type="button" class="btn" onClick={() => applyPromo()}>Apply</button></div>
              {s.promoNote && <span class="hint" style="color:var(--good)">✓ {s.promoNote}</span>}
              {fieldErrors.promoCode && <span class="error">{fieldErrors.promoCode}</span>}
              {tradePct > 0 && s.promo && <span class="hint">Trade rates and promo codes don't combine — your trade rate is applied.</span>}
            </div>
            {cfg.customer && cfg.pricing.loyalty.enabled && cfg.customer.loyaltyPoints >= cfg.pricing.loyalty.minRedeem && (
              <label class="check"><input type="checkbox" checked={s.usePoints} onChange={(e) => set({ usePoints: (e.target as HTMLInputElement).checked })} /><span>Use my {cfg.customer.loyaltyPoints} loyalty points (worth {money(cfg.customer.loyaltyPoints * cfg.pricing.loyalty.pointValue, cur)})</span></label>
            )}
            <div class="field">
              <span class="label">How would you like to pay?</span>
              <div class="option-grid">
                <button type="button" class="option" aria-pressed={s.paymentMethod === 'on_completion'} onClick={() => set({ paymentMethod: 'on_completion' })}><span class="tick" /><b>Card on completion</b><small>Apple Pay · Google Pay · contactless</small></button>
                <button type="button" class="option" aria-pressed={s.paymentMethod === 'cash'} onClick={() => set({ paymentMethod: 'cash' })}><span class="tick" /><b>Cash</b><small>On completion</small></button>
                <button type="button" class="option" aria-pressed={s.paymentMethod === 'bank_transfer'} onClick={() => set({ paymentMethod: 'bank_transfer' })}><span class="tick" /><b>Bank transfer</b><small>Invoice on completion</small></button>
              </div>
            </div>
            {cfg.features.onlinePayments && quote.depositDue > 0 && (
              <label class="check"><input type="checkbox" checked={s.payDeposit || quote.depositRequired} disabled={quote.depositRequired} onChange={(e) => set({ payDeposit: (e.target as HTMLInputElement).checked })} />
                <span>{quote.depositRequired ? 'A' : 'Secure the slot with a'} <b>{money(quote.depositDue, cur)}</b> deposit now by card, Apple Pay or Google Pay{quote.depositRequired ? ' — required for bookings of this size.' : ' (optional). The rest is paid on completion.'}</span></label>
            )}
            <label class="check"><input type="checkbox" checked={s.marketing} onChange={(e) => set({ marketing: (e.target as HTMLInputElement).checked })} /><span>Remind me when my MOT or service is due, and send occasional offers. Unsubscribe any time.</span></label>
            <label class="check"><input type="checkbox" checked={s.agree} onChange={(e) => set({ agree: (e.target as HTMLInputElement).checked })} /><span>I agree to the <a href="/terms" target="_blank">terms</a> and <a href="/privacy" target="_blank">privacy notice</a>.{fieldErrors.agree && <span class="error" style="display:block">{fieldErrors.agree}</span>}</span></label>
            <div class="hp" aria-hidden="true"><label>Website<input id="bk-website" tabIndex={-1} autoComplete="off" /></label></div>
            <div ref={turnstileRef} />
          </div>
        )}

        {queued && <div class="alert alert-warn" style="margin-top:18px"><Icon d={I.info} /><span>You're offline — your booking is saved on this device and will be sent automatically as soon as you're back online.</span></div>}
        {error && !queued && <div class="alert alert-bad" style="margin-top:18px" role="alert"><Icon d={I.alert} /><span>{error}</span></div>}

        <div class="wizard-nav">
          {s.step > 0 ? <button type="button" class="btn btn-ghost" onClick={() => go(s.step - 1)}><Icon d={I.back} /> Back</button> : <span />}
          {s.step < 3
            ? <button type="button" class="btn btn-primary btn-lg" onClick={() => go(s.step + 1)}>Continue <Icon d={I.arrow} /></button>
            : <button type="button" class={`btn btn-primary btn-lg${busy ? ' is-loading' : ''}`} onClick={submit} disabled={busy}>{busy ? <span class="spinner" /> : null} Confirm booking · {money(quote.total, cur)}</button>}
        </div>
      </div>

      <Summary cfg={cfg} s={s} quote={quote} pkgById={pkgById} />
      <div class="mobile-total"><span><small class="faint mono" style="display:block;font-size:.66rem;letter-spacing:.1em">TOTAL{quote.discountTotal ? ` · SAVING ${money(quote.discountTotal, cur)}` : ''}</small><b>{money(quote.total, cur)}</b></span>
        {s.step < 3 ? <button type="button" class="btn btn-primary" onClick={() => go(s.step + 1)}>Continue <Icon d={I.arrow} /></button> : <button type="button" class="btn btn-primary" onClick={submit} disabled={busy}>Confirm</button>}
      </div>
    </div>
  );
}

function VehicleTabs({ s, set }: { s: State; set: (p: Partial<State> | ((prev: State) => Partial<State>)) => void }) {
  return (
    <div class="vehicle-tabs" role="tablist">
      {s.vehicles.map((x, i) => (
        <button type="button" role="tab" class="vehicle-tab" aria-selected={s.active === i} onClick={() => set({ active: i })}>
          <span class="plate-mini">{normReg(x.reg) || `CAR ${i + 1}`}</span>
          {x.packageIds.length > 0 && <span class="badge badge-good">{x.packageIds.length}</span>}
          {s.vehicles.length > 1 && <span role="button" aria-label="Remove vehicle" style="opacity:.6" onClick={(e) => { e.stopPropagation(); set((p) => ({ vehicles: p.vehicles.filter((_, j) => j !== i), active: 0 })); }}>×</span>}
        </button>
      ))}
    </div>
  );
}

function Summary({ cfg, s, quote, pkgById }: { cfg: BookingConfig; s: State; quote: Quote; pkgById: Map<number, PackageLite> }) {
  const cur = cfg.business.currency;
  void pkgById;
  return (
    <aside class="summary">
      <div class="card card-glass">
        <div class="spread"><b class="mono" style="font-size:.74rem;letter-spacing:.14em;color:var(--muted)">YOUR QUOTE</b><span class="badge badge-good">Pay on completion</span></div>
        {s.vehicles.map((v, vi) => {
          const lines = quote.lines.filter((l) => l.vehicleIndex === vi);
          return (
            <div>
              <div class="summary-vehicle">{normReg(v.reg) || `Vehicle ${vi + 1}`}{v.make ? ` · ${v.make} ${v.model}` : ''}</div>
              {lines.length ? lines.map((l) => <div class="summary-line"><span>{l.name}</span><span>{money(l.price, cur)}</span></div>) : <div class="summary-line faint"><span>No services yet</span><span>—</span></div>}
            </div>
          );
        })}
        {quote.bundleDiscount > 0 && <div class="summary-line discount"><span>Bundle saving</span><span>−{money(quote.bundleDiscount, cur)}</span></div>}
        {quote.multiVehicleDiscount > 0 && <div class="summary-line discount"><span>Multi-vehicle saving</span><span>−{money(quote.multiVehicleDiscount, cur)}</span></div>}
        {quote.tradeDiscount > 0 && <div class="summary-line discount"><span>Trade rate</span><span>−{money(quote.tradeDiscount, cur)}</span></div>}
        {quote.promoDiscount > 0 && <div class="summary-line discount"><span>Code {s.promo?.code}</span><span>−{money(quote.promoDiscount, cur)}</span></div>}
        {quote.peakAdjustment !== 0 && <div class="summary-line"><span>{quote.peakLabel}</span><span>{quote.peakAdjustment > 0 ? '+' : '−'}{money(Math.abs(quote.peakAdjustment), cur)}</span></div>}
        {s.serviceMode === 'mobile' && s.geo && !s.geo.outOfArea && <div class="summary-line"><span>Travel · {s.geo.miles} mi</span><span>{quote.travelFee ? money(quote.travelFee, cur) : 'Free'}</span></div>}
        {quote.emergencyFee > 0 && <div class="summary-line"><span>Emergency dispatch</span><span>{money(quote.emergencyFee, cur)}</span></div>}
        {quote.loyaltyDiscount > 0 && <div class="summary-line discount"><span>Loyalty points</span><span>−{money(quote.loyaltyDiscount, cur)}</span></div>}
        <div class="summary-total"><span class="muted">Total</span><b>{money(quote.total, cur)}</b></div>
        {quote.durationMin > 0 && <div class="summary-line faint" style="font-size:.82rem"><span>Time on site</span><span>≈ {quote.durationMin >= 60 ? `${Math.round(quote.durationMin / 6) / 10} hrs` : `${quote.durationMin} min`}</span></div>}
        {(s.date || s.emergency) && <div class="summary-line faint" style="font-size:.82rem"><span>When</span><span>{s.emergency ? 'ASAP today' : `${formatDate(s.date!, 'day')}${s.slot && s.slot !== 'asap' ? ` · ${SLOTS[s.slot as SlotKey].label}` : ''}`}</span></div>}
        {quote.pointsEarned > 0 && cfg.pricing.loyalty.enabled && <div class="summary-line faint" style="font-size:.82rem"><span>Loyalty points earned</span><span>+{quote.pointsEarned}</span></div>}
      </div>
      {cfg.pricing.bundle.two > 0 && quote.lines.length === 1 && <div class="alert alert-info"><Icon d={I.spark} /><span>Add one more service to this vehicle and save <b>{money(cfg.pricing.bundle.two, cur)}</b>.</span></div>}
      <div class="card card-tight stack" style="gap:8px;font-size:.88rem">
        <span class="row" style="gap:8px"><Icon d={I.check} size={16} /> Fixed price — no surprises</span>
        <span class="row" style="gap:8px"><Icon d={I.check} size={16} /> Live tracking link by text</span>
        <span class="row" style="gap:8px"><Icon d={I.check} size={16} /> Free cancellation up to the day before</span>
        <a class="row" style="gap:8px;color:var(--accent-hi);text-decoration:none" href={`tel:${cfg.business.phone}`}><Icon d={I.phone} size={16} /> Questions? {cfg.business.phone}</a>
      </div>
    </aside>
  );
}

function Success({ res, cfg, s }: { res: CreateBookingResponse; cfg: BookingConfig; s: State }) {
  const track = `${location.origin}${res.trackUrl}`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`My ${cfg.business.name} booking ${res.ref} — live tracker: ${track}`)}`;
  return (
    <div class="success step-panel">
      <div class="success-mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
      <span class="eyebrow" style="justify-content:center">{res.status === 'pending' ? 'Request received' : 'Booking confirmed'}</span>
      <h1 class="display" style="font-size:clamp(2.2rem,6vw,3.6rem)">{res.status === 'pending' ? "We've got it" : "You're booked in"}{s.name ? `, ${s.name.split(' ')[0]}` : ''}</h1>
      <p class="lead" style="margin:14px auto 22px">{s.emergency ? 'Your emergency request has gone straight to the technician, who will call you shortly.' : `${formatDate(s.date!, 'long')}${s.slot && s.slot !== 'asap' ? `, ${SLOTS[s.slot as SlotKey].label.toLowerCase()} (${SLOTS[s.slot as SlotKey].window})` : ''}.`} A confirmation with your live tracker link is on its way.</p>
      <div class="ref">{res.ref}</div>
      {res.checkoutUrl && <div style="margin-top:22px"><a class="btn btn-primary btn-lg" href={res.checkoutUrl}>Pay {money(res.depositDue, cfg.business.currency)} deposit securely</a><p class="hint" style="margin-top:8px">Card, Apple Pay or Google Pay via Stripe.</p></div>}
      <div class="row" style="justify-content:center;margin-top:26px">
        <a class="btn btn-primary" href={res.trackUrl}><Icon d={I.pin} /> Open live tracker</a>
        <a class="btn" href={`${res.trackUrl}/calendar.ics`}><Icon d={I.calendar} /> Add to calendar</a>
        <a class="btn" href={wa} target="_blank" rel="noopener">Send link to my WhatsApp</a>
      </div>
      {res.referralCode && (
        <div class="card" style="max-width:520px;margin:30px auto 0;text-align:left">
          <span class="eyebrow">Refer a friend</span>
          <p style="margin:0 0 12px">Share your code <b class="mono">{res.referralCode}</b> — friends save 15% on their first booking and you earn {cfg.pricing.loyalty.referrerPoints} loyalty points.</p>
          <button type="button" class="btn btn-sm" onClick={async () => {
            const text = `Use my code ${res.referralCode} for 15% off at ${cfg.business.name}: ${location.origin}/book?promo=${res.referralCode}`;
            if (navigator.share) await navigator.share({ text }).catch(() => undefined);
            else await navigator.clipboard?.writeText(text);
          }}>Share my code</button>
        </div>
      )}
    </div>
  );
}

async function boot() {
  if (!root) return;
  enableRipples();
  const fleetSlug = root.dataset.fleet ?? '';
  try {
    const cfg = await api<BookingConfig>(`/api/public/booking-config${fleetSlug ? `?fleet=${encodeURIComponent(fleetSlug)}` : ''}`);
    root.innerHTML = '';
    render(<App cfg={cfg} fleetSlug={fleetSlug} />, root);
  } catch (e) {
    const site = readConfig<{ phone: string }>();
    root.innerHTML = `<div class="alert alert-bad"><span>${errorMessage(e)} You can also book by phone on <a href="tel:${site.phone}">${site.phone}</a>.</span></div>`;
  }
}
void boot();
void addDays;
