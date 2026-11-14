// Settings, team, security, backups, audit trail and system logs.
import { useEffect, useState } from 'preact/hooks';
import { ROLE_LABELS, SLOT_ORDER, SLOTS, type Role } from '../../../shared/constants';
import { formatDate, formatDateTime } from '../../../shared/format';
import { compressImage } from '../../lib/api';
import { toast } from '../../lib/ui';
import { auth, del, get, send, upload } from '../api';
import { can, go, registerPasskey, type Me } from '../main';
import { Empty, Icon, Modal, moneyInputValue, PageTitle, toMinor, useAction } from '../ui';

type Obj = Record<string, unknown>;
interface SettingsData { settings: Record<string, Obj>; integrations: Record<string, { on: boolean; label: string; secrets: string }>; calendarFeed: string; logoUrl: string; googleRating: { rating: number; count: number } | null; sourceRepo: string; environment: string }

const SECTIONS: [string, string, string][] = [
  ['business', 'Business', 'settings.write'], ['booking', 'Booking rules', 'settings.write'], ['pricing', 'Pricing', 'finance.write'], ['branding', 'Branding', 'settings.write'],
  ['integrations', 'Integrations', 'settings.write'], ['tax', 'Tax', 'finance.write'], ['security', 'Security', ''], ['team', 'Team', 'users.write'], ['backups', 'Backups & data', 'settings.write'],
  ['audit', 'Audit trail', 'audit.read'], ['system', 'System logs', 'settings.write'],
];

const getPath = (o: Obj, path: string): unknown => path.split('.').reduce<unknown>((a, k) => (a as Obj | undefined)?.[k], o);
function setPath(o: Obj, path: string, v: unknown): Obj {
  const [k, ...rest] = path.split('.');
  return { ...o, [k!]: rest.length ? setPath((o[k!] as Obj) ?? {}, rest.join('.'), v) : v };
}

type F = { path: string; label: string; type?: 'text' | 'number' | 'money' | 'bool' | 'select' | 'textarea' | 'list'; options?: [string, string][]; help?: string };

function Form({ section, fields, data, onSaved }: { section: string; fields: F[]; data: Obj; onSaved: (v: Obj) => void }) {
  const [v, setV] = useState<Obj>(data);
  const [busy, act] = useAction();
  useEffect(() => setV(data), [data]);
  return (
    <div class="panel stack" style="max-width:820px">
      <div class="form-grid">
        {fields.map((f) => {
          const val = getPath(v, f.path);
          const set = (x: unknown) => setV(setPath(v, f.path, x));
          if (f.type === 'bool') return <label class="check" style="grid-column:1/-1"><input type="checkbox" checked={!!val} onChange={(e) => set((e.target as HTMLInputElement).checked)} /><span>{f.label}{f.help && <span class="hint" style="display:block">{f.help}</span>}</span></label>;
          if (f.type === 'select') return <div class="field"><label>{f.label}</label><select class="select" value={String(val)} onChange={(e) => set((e.target as HTMLSelectElement).value)}>{f.options!.map(([k, l]) => <option value={k}>{l}</option>)}</select>{f.help && <span class="hint">{f.help}</span>}</div>;
          if (f.type === 'textarea') return <div class="field" style="grid-column:1/-1"><label>{f.label}</label><textarea class="textarea" value={String(val ?? '')} onInput={(e) => set((e.target as HTMLTextAreaElement).value)} />{f.help && <span class="hint">{f.help}</span>}</div>;
          if (f.type === 'list') return <div class="field" style="grid-column:1/-1"><label>{f.label}</label><textarea class="textarea" value={((val as string[]) ?? []).join('\n')} onInput={(e) => set((e.target as HTMLTextAreaElement).value.split('\n').map((s) => s.trim()).filter(Boolean))} />{f.help && <span class="hint">{f.help}</span>}</div>;
          if (f.type === 'money') return <div class="field"><label>{f.label}</label><input class="input mono" inputMode="decimal" value={moneyInputValue(Number(val ?? 0))} onChange={(e) => set(toMinor((e.target as HTMLInputElement).value))} />{f.help && <span class="hint">{f.help}</span>}</div>;
          if (f.type === 'number') return <div class="field"><label>{f.label}</label><input class="input mono" inputMode="decimal" value={String(val ?? '')} onInput={(e) => set(Number((e.target as HTMLInputElement).value))} />{f.help && <span class="hint">{f.help}</span>}</div>;
          return <div class="field"><label>{f.label}</label><input class="input" value={String(val ?? '')} onInput={(e) => set((e.target as HTMLInputElement).value)} />{f.help && <span class="hint">{f.help}</span>}</div>;
        })}
      </div>
      <button class="btn btn-primary" style="align-self:flex-start" type="button" disabled={busy} onClick={async () => { const r = await act(() => send<{ settings: Obj }>(`/settings/${section}`, v, 'PUT'), 'Settings saved'); if (r) onSaved(r.settings); }}>Save</button>
    </div>
  );
}

export function SettingsView({ me, section }: { me: Me; section: string }) {
  const [data, setData] = useState<SettingsData | null>(null);
  const load = () => get<SettingsData>('/settings').then((r) => setData(r.data)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  const visible = SECTIONS.filter(([, , p]) => !p || can(me, p as Parameters<typeof can>[1]));
  const active = visible.find(([k]) => k === section)?.[0] ?? visible[0]?.[0] ?? 'security';
  const updated = (key: string) => (v: Obj) => setData((d) => (d ? { ...d, settings: { ...d.settings, [key]: v } } : d));
  return (
    <div>
      <PageTitle title="Settings" sub={data ? `Environment: ${data.environment}` : ''} />
      <div class="chip-row" style="margin-bottom:16px">{visible.map(([k, l]) => <a class="chip" href={`#/settings/${k}`} aria-pressed={active === k ? 'true' : 'false'}>{l}</a>)}</div>
      {!data ? <div class="skeleton" style="height:400px" /> : (
        <>
          {active === 'business' && data.settings.business && <BusinessSettings data={data.settings.business} onSaved={updated('business')} />}
          {active === 'booking' && data.settings.booking && (
            <div class="stack">
              <Form section="booking" data={data.settings.booking} onSaved={updated('booking')} fields={[
                { path: 'autoConfirm', label: 'Confirm online bookings automatically', type: 'bool', help: 'Turn off to review each request before it is confirmed.' },
                { path: 'leadHours', label: 'Minimum notice (hours)', type: 'number' }, { path: 'horizonDays', label: 'Bookable days ahead', type: 'number' },
                { path: 'maxVehicles', label: 'Max vehicles per booking', type: 'number' }, { path: 'reviewDelayMinutes', label: 'Review request delay after completion (minutes)', type: 'number' },
                { path: 'serviceReminderMonths', label: 'MOT / service reminder after (months)', type: 'number' }, { path: 'avgSpeedMph', label: 'Average speed for ETAs (mph)', type: 'number' },
              ]} />
              <CalendarFeed url={data.calendarFeed} onChange={load} />
            </div>
          )}
          {active === 'pricing' && data.settings.pricing && <PricingSettings data={data.settings.pricing} onSaved={updated('pricing')} />}
          {active === 'branding' && data.settings.branding && <BrandingSettings data={data.settings.branding} logoUrl={data.logoUrl} onSaved={() => load()} />}
          {active === 'integrations' && data.settings.integrations && (
            <div class="stack">
              <Form section="integrations" data={data.settings.integrations} onSaved={updated('integrations')} fields={[
                { path: 'ga4Id', label: 'Google Analytics 4 ID', help: 'G-XXXXXXX — loads only after visitors accept analytics cookies.' }, { path: 'metaPixelId', label: 'Meta Pixel ID' },
                { path: 'sumupLink', label: 'SumUp payment link (optional)', help: 'Shown to staff for card-reader-free payments.' },
                { path: 'chat', label: 'Show live chat on the website', type: 'bool' }, { path: 'socialProof', label: 'Show anonymised recent-booking notifications', type: 'bool' }, { path: 'seasonalBanners', label: 'Show seasonal promo banners automatically', type: 'bool' },
              ]} />
              <div class="panel" style="max-width:820px"><h3 style="margin-bottom:10px">Connected services</h3><div class="list">{Object.entries(data.integrations).map(([, i]) => <div class="list-row"><span class={`badge ${i.on ? 'badge-good' : ''}`}>{i.on ? 'On' : 'Off'}</span><span class="grow" style="white-space:normal"><b style="white-space:normal">{i.label}</b><span class="mono" style="font-size:.74rem">{i.secrets}</span></span></div>)}</div><p class="faint" style="font-size:.84rem;margin:10px 0 0">Secrets are set on the Worker with <span class="mono">npx wrangler secret put NAME</span> — see docs/DEPLOY.md. They are never shown or stored in the database.</p></div>
            </div>
          )}
          {active === 'tax' && data.settings.tax && <Form section="tax" data={data.settings.tax} onSaved={updated('tax')} fields={[
            { path: 'personalAllowance', label: 'Personal allowance', type: 'money' }, { path: 'basicRateLimit', label: 'Basic rate limit', type: 'money' }, { path: 'higherRateLimit', label: 'Higher rate limit', type: 'money' },
            { path: 'basicRate', label: 'Basic rate %', type: 'number' }, { path: 'higherRate', label: 'Higher rate %', type: 'number' }, { path: 'additionalRate', label: 'Additional rate %', type: 'number' },
            { path: 'ni4LowerLimit', label: 'Class 4 NI lower limit', type: 'money' }, { path: 'ni4UpperLimit', label: 'Class 4 NI upper limit', type: 'money' }, { path: 'ni4MainRate', label: 'Class 4 main rate %', type: 'number' }, { path: 'ni4UpperRate', label: 'Class 4 upper rate %', type: 'number' },
            { path: 'taxYearStartMonth', label: 'Tax year starts — month', type: 'number' }, { path: 'taxYearStartDay', label: 'Tax year starts — day', type: 'number' },
            { path: 'setAsideNote', label: 'Note shown with estimates', type: 'textarea' },
          ]} />}
          {active === 'security' && <SecuritySettings me={me} data={data.settings.security} />}
          {active === 'team' && <TeamSettings me={me} />}
          {active === 'backups' && <Backups sourceRepo={data.sourceRepo} />}
          {active === 'audit' && <AuditTrail />}
          {active === 'system' && <SystemLogs />}
        </>
      )}
    </div>
  );
}

function BusinessSettings({ data, onSaved }: { data: Obj; onSaved: (v: Obj) => void }) {
  const [windows, setWindows] = useState<string[][]>((data.slotsByWeekday as string[][]) ?? []);
  const [busy, act] = useAction();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return (
    <div class="stack">
      <Form section="business" data={data} onSaved={onSaved} fields={[
        { path: 'name', label: 'Business name' }, { path: 'legalName', label: 'Legal / trading name' }, { path: 'leadEngineer', label: 'Lead engineer' },
        { path: 'phone', label: 'Phone' }, { path: 'whatsapp', label: 'WhatsApp number' }, { path: 'email', label: 'Email' },
        { path: 'addressLine', label: 'Address line' }, { path: 'town', label: 'Town' }, { path: 'region', label: 'Region' }, { path: 'postcode', label: 'Postcode' },
        { path: 'currency', label: 'Currency (ISO)', help: 'GBP, EUR, USD… Used across prices and invoices.' }, { path: 'locale', label: 'Locale', help: 'en-GB, en-IE, en-US…' }, { path: 'timezone', label: 'Time zone' }, { path: 'country', label: 'Country code' },
        { path: 'credentials', label: 'Credentials & trust badges (one per line)', type: 'list' },
        { path: 'googleReviewUrl', label: 'Google review link' }, { path: 'googleMapsUrl', label: 'Google Maps link' }, { path: 'googlePlaceId', label: 'Google Place ID', help: 'With GOOGLE_PLACES_API_KEY set, reviews sync daily.' },
        { path: 'social.instagram', label: 'Instagram URL' }, { path: 'social.tiktok', label: 'TikTok URL' }, { path: 'social.facebook', label: 'Facebook URL' }, { path: 'social.youtube', label: 'YouTube URL' },
      ]} />
      <div class="panel stack" style="max-width:820px">
        <h3>Arrival windows offered each day</h3>
        {days.map((d, i) => <div class="spread"><span>{d}</span><div class="chip-row">{SLOT_ORDER.map((s) => <button type="button" class="chip" aria-pressed={(windows[i] ?? []).includes(s)} onClick={() => setWindows(windows.map((w, j) => (j === i ? (w.includes(s) ? w.filter((x) => x !== s) : [...w, s]) : w)))}>{SLOTS[s].label}</button>)}</div></div>)}
        <button class="btn btn-primary" style="align-self:flex-start" type="button" disabled={busy} onClick={async () => { const r = await act(() => send<{ settings: Obj }>('/settings/business', { ...data, slotsByWeekday: windows }, 'PUT'), 'Opening windows saved'); if (r) onSaved(r.settings); }}>Save windows</button>
        <p class="faint" style="margin:0;font-size:.84rem">Jobs per window and travel bands are set per location under <a href="#/r/locations">Locations</a>.</p>
      </div>
    </div>
  );
}

function PricingSettings({ data, onSaved }: { data: Obj; onSaved: (v: Obj) => void }) {
  const [rates, setRates] = useState<{ key: string; label: string; rate: number }[]>((data.labourRates as { key: string; label: string; rate: number }[]) ?? []);
  const [busy, act] = useAction();
  return (
    <div class="stack">
      <Form section="pricing" data={data} onSaved={onSaved} fields={[
        { path: 'bundle.two', label: 'Saving for 2 packages on one vehicle', type: 'money' }, { path: 'bundle.threePlus', label: 'Saving for 3+ packages', type: 'money' },
        { path: 'multiVehiclePct', label: 'Extra-vehicle discount %', type: 'number' }, { path: 'emergencyFee', label: 'Emergency call-out fee', type: 'money' },
        { path: 'deposit.mode', label: 'Deposits', type: 'select', options: [['off', 'Off'], ['optional', 'Optional for every booking'], ['required_over', 'Required over a threshold']] },
        { path: 'deposit.percent', label: 'Deposit %', type: 'number' }, { path: 'deposit.minimum', label: 'Minimum deposit', type: 'money' }, { path: 'deposit.threshold', label: 'Required when total is at least', type: 'money' },
        { path: 'loyalty.enabled', label: 'Loyalty points scheme', type: 'bool' }, { path: 'loyalty.pointsPerPound', label: 'Points per £1 spent', type: 'number' }, { path: 'loyalty.pointValue', label: 'Value of one point (pence)', type: 'number' },
        { path: 'loyalty.minRedeem', label: 'Minimum points to redeem', type: 'number' }, { path: 'loyalty.referrerPoints', label: 'Points for a successful referral', type: 'number' },
        { path: 'vat.registered', label: 'VAT registered (prices include VAT)', type: 'bool' }, { path: 'vat.rate', label: 'VAT rate %', type: 'number' }, { path: 'vat.number', label: 'VAT number' },
      ]} />
      <div class="panel stack" style="max-width:820px">
        <h3>Labour rates</h3>
        {rates.map((r, i) => <div class="row" style="flex-wrap:nowrap"><input class="input" value={r.label} onInput={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, label: (e.target as HTMLInputElement).value } : x)))} /><input class="input mono" style="width:120px" value={moneyInputValue(r.rate)} onChange={(e) => setRates(rates.map((x, j) => (j === i ? { ...x, rate: toMinor((e.target as HTMLInputElement).value) } : x)))} aria-label="Rate per hour" /><button class="btn btn-icon btn-ghost" type="button" onClick={() => setRates(rates.filter((_, j) => j !== i))} aria-label="Remove"><Icon name="x" /></button></div>)}
        <div class="row"><button class="btn btn-sm btn-ghost" type="button" onClick={() => setRates([...rates, { key: `rate${Date.now()}`, label: 'New rate', rate: 9500 }])}><Icon name="plus" /> Add rate</button>
          <button class="btn btn-primary btn-sm" type="button" disabled={busy} onClick={async () => { const r = await act(() => send<{ settings: Obj }>('/settings/pricing', { ...data, labourRates: rates }, 'PUT'), 'Labour rates saved'); if (r) onSaved(r.settings); }}>Save rates</button></div>
      </div>
      <p class="faint" style="font-size:.84rem">Package prices are under <a href="#/r/packages">Services &amp; prices</a>; peak-hour rules under <a href="#/r/pricing_rules">Peak pricing</a>; travel bands under <a href="#/r/locations">Locations</a>.</p>
    </div>
  );
}

/** Square-crop and scale an image to a PNG for app icons (#72). */
async function iconFrom(file: Blob, size: number): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#07080b';
  ctx.fillRect(0, 0, size, size);
  const pad = size * 0.1;
  const scale = Math.min((size - pad * 2) / bmp.width, (size - pad * 2) / bmp.height);
  const w = bmp.width * scale;
  const h = bmp.height * scale;
  ctx.drawImage(bmp, (size - w) / 2, (size - h) / 2, w, h);
  return new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
}

function BrandingSettings({ data, logoUrl, onSaved }: { data: Obj; logoUrl: string; onSaved: () => void }) {
  const [busy, act] = useAction();
  return (
    <div class="stack">
      <div class="panel stack" style="max-width:820px">
        <h3>Logo</h3>
        <div class="media-pick">{logoUrl ? <img src={logoUrl} alt="Logo" style="width:auto;max-width:220px;height:64px;object-fit:contain;background:var(--surface-2)" /> : <span class="faint">Using the built-in S1 emblem.</span>}</div>
        <div class="row">
          <label class="btn btn-primary"><Icon name="camera" /> Upload logo<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const ok = await act(async () => {
              // Keep PNG transparency for the logo; also generate square home-screen icons on the device.
              const logo = file.type === 'image/png' ? file : await compressImage(file, 1200, 0.9);
              const up = await upload('/media', logo, { kind: 'logo' }, file.type === 'image/png' ? 'logo.png' : 'logo.jpg');
              const [i192, i512] = await Promise.all([iconFrom(file, 192), iconFrom(file, 512)]);
              const [u192, u512] = await Promise.all([upload('/media', i192, { kind: 'icon' }, 'icon-192.png'), upload('/media', i512, { kind: 'icon' }, 'icon-512.png')]);
              return send('/settings/branding', { ...data, logoMediaId: up.id, icon192MediaId: u192.id, icon512MediaId: u512.id }, 'PUT');
            }, 'Logo and app icons updated');
            if (ok) onSaved();
          }} /></label>
          {logoUrl && <button class="btn btn-ghost" type="button" disabled={busy} onClick={async () => { if (await act(() => send('/settings/branding', { ...data, logoMediaId: null, icon192MediaId: null, icon512MediaId: null }, 'PUT'), 'Reverted to the S1 emblem')) onSaved(); }}>Use built-in emblem</button>}
        </div>
        <p class="faint" style="margin:0;font-size:.84rem">The logo appears in the navigation, emails and PDF invoices and certificates (PNG or JPEG). Square home-screen and favicon icons are generated from it automatically.</p>
      </div>
      <Form section="branding" data={data} onSaved={onSaved} fields={[
        { path: 'themeDefault', label: 'Default theme', type: 'select', options: [['dark', 'Dark — obsidian & crimson'], ['light', 'Light']], help: 'Visitors can still switch with the moon/sun button.' },
        { path: 'heroHeadline', label: 'Home page headline', help: 'Put a full stop between two sentences to accent the second.' }, { path: 'heroSub', label: 'Home page intro', type: 'textarea' },
      ]} />
    </div>
  );
}

function CalendarFeed({ url, onChange }: { url: string; onChange: () => void }) {
  const [busy, act] = useAction();
  return (
    <div class="panel stack" style="max-width:820px">
      <h3>Phone calendar sync</h3>
      <p class="muted" style="margin:0">Subscribe in Samsung Calendar, Google Calendar or Apple Calendar to see every job automatically. Keep the link private.</p>
      {url ? <><div class="code-block">{url}</div><div class="row"><button class="btn btn-sm" type="button" onClick={async () => { await navigator.clipboard?.writeText(url); toast('Link copied'); }}>Copy</button><a class="btn btn-sm" href={url.replace(/^https?:/, 'webcal:')}>Subscribe on this device</a><button class="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={async () => { if (confirm('Create a new link? The old one will stop working.') && (await act(() => send('/calendar-feed'), 'New link created'))) onChange(); }}>Reset link</button></div></>
        : <button class="btn btn-primary" style="align-self:flex-start" type="button" disabled={busy} onClick={async () => { if (await act(() => send('/calendar-feed'), 'Calendar link created')) onChange(); }}>Create calendar link</button>}
    </div>
  );
}

function SecuritySettings({ me, data }: { me: Me; data: Obj | undefined }) {
  const [keys, setKeys] = useState<{ id: number; name: string; created_at: string; last_used_at: string | null }[] | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [busy, act] = useAction();
  const load = () => auth<{ passkeys: NonNullable<typeof keys> }>('/passkeys', undefined, 'GET').then((r) => setKeys(r.passkeys)).catch(() => setKeys([]));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div class="stack" style="max-width:820px">
      <div class="panel stack">
        <div class="spread"><h3>Face ID / fingerprint sign-in</h3><button class="btn btn-primary btn-sm" type="button" disabled={busy} onClick={async () => { if (await act(() => registerPasskey(), 'Passkey added')) void load(); }}><Icon name="key" /> Add this device</button></div>
        <p class="muted" style="margin:0">Passkeys let you sign in and unlock the admin with your phone's biometrics. Nothing biometric ever leaves your device.</p>
        {keys === null ? <div class="skeleton" style="height:60px" /> : keys.length ? <div class="list">{keys.map((k) => <div class="list-row"><Icon name="key" /><span class="grow"><b>{k.name}</b><span>Added {formatDate(k.created_at.slice(0, 10))}{k.last_used_at ? ` · last used ${formatDateTime(k.last_used_at)}` : ''}</span></span><button class="btn btn-sm btn-ghost" type="button" onClick={async () => { if (confirm('Remove this passkey?') && (await act(() => auth(`/passkeys/${k.id}`, undefined, 'DELETE'), 'Removed'))) void load(); }}>Remove</button></div>)}</div> : <p class="faint" style="margin:0">No passkeys yet.</p>}
      </div>
      <div class="panel stack">
        <h3>Change password</h3>
        <div class="form-grid"><div class="field"><label>Current password</label><input class="input" type="password" autoComplete="current-password" value={pw.current} onInput={(e) => setPw({ ...pw, current: (e.target as HTMLInputElement).value })} /></div><div class="field"><label>New password</label><input class="input" type="password" autoComplete="new-password" value={pw.next} onInput={(e) => setPw({ ...pw, next: (e.target as HTMLInputElement).value })} /></div></div>
        <button class="btn" style="align-self:flex-start" type="button" disabled={busy || !pw.current || pw.next.length < 10} onClick={async () => { if (await act(() => auth('/password', pw), 'Password changed — other devices signed out')) setPw({ current: '', next: '' }); }}>Update password</button>
      </div>
      {data && can(me, 'settings.write') && <Form section="security" data={data} onSaved={() => undefined} fields={[{ path: 'autoLockMinutes', label: 'Auto-lock after inactivity (minutes, 0 = never)', type: 'number' }, { path: 'sessionDays', label: 'Stay signed in for (days)', type: 'number' }]} />}
    </div>
  );
}

function TeamSettings({ me }: { me: Me }) {
  const [d, setD] = useState<{ users: { id: number; name: string; email: string; phone: string; role: Role; active: number; last_login_at: string | null; passkeys: number; open_jobs: number }[] } | null>(null);
  const [form, setForm] = useState<{ id?: number; name: string; email: string; phone: string; role: Role; password: string; active?: boolean } | null>(null);
  const [busy, act] = useAction();
  const load = () => get<NonNullable<typeof d>>('/users').then((r) => setD(r.data)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  if (!d) return <div class="skeleton" style="height:300px" />;
  return (
    <div class="stack" style="max-width:900px">
      <div class="spread"><p class="muted" style="margin:0">Give assistants, partner technicians (like Ali) or a bookkeeper their own login with just the access they need.</p><button class="btn btn-primary" type="button" onClick={() => setForm({ name: '', email: '', phone: '', role: 'technician', password: '' })}><Icon name="plus" /> Add team member</button></div>
      <div class="dtable-wrap"><table class="dtable"><thead><tr><th>Name</th><th>Role</th><th class="num">Open jobs</th><th>Passkeys</th><th>Last sign-in</th></tr></thead>
        <tbody>{d.users.map((u) => <tr onClick={() => setForm({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, password: '', active: !!u.active })} style={u.active ? '' : 'opacity:.5'}><td>{u.name}{u.id === me.id ? ' (you)' : ''}<br /><span class="faint">{u.email}</span></td><td>{u.role}</td><td class="num">{u.open_jobs}</td><td>{u.passkeys}</td><td class="mono">{u.last_login_at ? formatDateTime(u.last_login_at) : 'Never'}</td></tr>)}</tbody></table></div>
      <div class="panel"><h3 style="margin-bottom:8px">What each role can do</h3>{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <div class="summary-line"><span><b>{r}</b></span><span style="font-family:var(--font-sans);text-align:right">{ROLE_LABELS[r].split('— ')[1]}</span></div>)}</div>
      {form && (
        <Modal title={form.id ? `Edit ${form.name}` : 'Add team member'} onClose={() => setForm(null)}>
          <div class="stack">
            <div class="field"><label>Name</label><input class="input" value={form.name} onInput={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })} /></div>
            {!form.id && <div class="field"><label>Email (their sign-in)</label><input class="input" type="email" value={form.email} onInput={(e) => setForm({ ...form, email: (e.target as HTMLInputElement).value })} /></div>}
            <div class="field"><label>Mobile (for job dispatch texts)</label><input class="input" type="tel" value={form.phone} onInput={(e) => setForm({ ...form, phone: (e.target as HTMLInputElement).value })} /></div>
            <div class="field"><label>Role</label><select class="select" value={form.role} onChange={(e) => setForm({ ...form, role: (e.target as HTMLSelectElement).value as Role })}>{(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
            <div class="field"><label>{form.id ? 'Reset password (leave blank to keep)' : 'Temporary password'}</label><input class="input" type="text" value={form.password} onInput={(e) => setForm({ ...form, password: (e.target as HTMLInputElement).value })} /><span class="hint">At least 10 characters. Share it privately; they can add a passkey after signing in.</span></div>
            {form.id && form.id !== me.id && <label class="check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: (e.target as HTMLInputElement).checked })} /><span>Active (untick to revoke access immediately)</span></label>}
            <button class="btn btn-primary" type="button" disabled={busy} onClick={async () => {
              const ok = form.id
                ? await act(() => send(`/users/${form.id}`, { name: form.name, phone: form.phone, role: form.role, active: form.active, ...(form.password ? { password: form.password } : {}) }, 'PATCH'), 'Saved')
                : await act(() => send('/users', { name: form.name, email: form.email, phone: form.phone, role: form.role, password: form.password }), 'Team member added');
              if (ok) { setForm(null); void load(); }
            }}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Backups({ sourceRepo }: { sourceRepo: string }) {
  const [d, setD] = useState<{ backups: { id: number; storage_key: string; size: number; tables: number; row_count: number; encrypted: number; trigger: string; created_at: string }[]; r2: boolean; encrypted: boolean } | null>(null);
  const [busy, act] = useAction();
  const load = () => get<NonNullable<typeof d>>('/backups').then((r) => setD(r.data)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  if (!d) return <div class="skeleton" style="height:300px" />;
  return (
    <div class="stack" style="max-width:900px">
      <div class="panel stack">
        <div class="spread"><h3>Cloud backups</h3><button class="btn btn-primary btn-sm" type="button" disabled={busy || !d.r2} onClick={async () => { const r = await act(() => send<{ message: string }>('/backups')); if (r) { toast(r.message); void load(); } }}>Back up now</button></div>
        {!d.r2 ? <div class="alert alert-warn"><Icon name="alert" /><span>Connect an R2 bucket to enable nightly cloud backups. Until then use the full data export below.</span></div>
          : <p class="muted" style="margin:0">A snapshot of every table is taken nightly{d.encrypted ? ', encrypted with AES-256-GCM,' : ''} and stored in R2 (last 30 kept). Cloudflare D1 Time Travel also allows point-in-time restore for 30 days.</p>}
        {d.r2 && !d.encrypted && <div class="alert alert-warn"><Icon name="lock" /><span>Set the <span class="mono">BACKUP_ENCRYPTION_KEY</span> secret to encrypt backups at rest.</span></div>}
        {d.backups.length ? <div class="list">{d.backups.map((b) => <div class="list-row"><span class={`badge ${b.encrypted ? 'badge-good' : ''}`}>{b.encrypted ? 'Encrypted' : 'Plain'}</span><span class="grow"><b>{formatDateTime(b.created_at)}</b><span>{b.trigger} · {b.tables} tables · {b.row_count} rows · {(b.size / 1024).toFixed(0)} KB</span></span><a class="btn btn-sm" href={`/api/admin/backups/${b.id}/download`}><Icon name="download" /></a></div>)}</div> : <p class="faint" style="margin:0">No backups yet.</p>}
      </div>
      <div class="panel stack">
        <h3>Your data &amp; source code</h3>
        <a class="btn" style="align-self:flex-start" href="/api/admin/export/database.json"><Icon name="download" /> Download a full data export (JSON)</a>
        <p class="muted" style="margin:0">The complete source code lives in your own Git repository{sourceRepo ? <>: <a href={sourceRepo} target="_blank" rel="noopener">{sourceRepo}</a></> : ''}. Run <span class="mono">npm run export:source</span> to produce a single zip of the whole project.</p>
      </div>
    </div>
  );
}

function AuditTrail() {
  const [f, setF] = useState({ entity: '', action: '', actor: '', q: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [d, setD] = useState<{ rows: { id: number; actor_type: string; actor_name: string; action: string; entity: string; entity_id: string; summary: string; changes: Record<string, unknown>; ip: string; created_at: string }[]; entities: string[]; actions: string[] } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page) });
    Object.entries(f).forEach(([k, v]) => v && p.set(k, v));
    get<NonNullable<typeof d>>(`/audit?${p}`).then((r) => setD(r.data)).catch(() => undefined);
  }, [f, page]);
  return (
    <div class="stack">
      <p class="muted" style="margin:0">Every change, price edit, status update, sign-in and export is recorded here. Entries cannot be edited or deleted — not even by an owner.</p>
      <div class="toolbar">
        <input class="input" placeholder="Search summary or ID" value={f.q} onInput={(e) => setF({ ...f, q: (e.target as HTMLInputElement).value })} />
        <select class="select" value={f.entity} onChange={(e) => setF({ ...f, entity: (e.target as HTMLSelectElement).value })}><option value="">All areas</option>{d?.entities.map((x) => <option>{x}</option>)}</select>
        <select class="select" value={f.action} onChange={(e) => setF({ ...f, action: (e.target as HTMLSelectElement).value })}><option value="">All actions</option>{d?.actions.map((x) => <option>{x}</option>)}</select>
        <input class="input" placeholder="Who" value={f.actor} onInput={(e) => setF({ ...f, actor: (e.target as HTMLInputElement).value })} />
        <input class="input" type="date" value={f.from} onInput={(e) => setF({ ...f, from: (e.target as HTMLInputElement).value })} aria-label="From" />
        <input class="input" type="date" value={f.to} onInput={(e) => setF({ ...f, to: (e.target as HTMLInputElement).value })} aria-label="To" />
      </div>
      {!d ? <div class="skeleton" style="height:300px" /> : d.rows.length === 0 ? <Empty icon="shield">No entries match.</Empty> : (
        <div class="dtable-wrap"><table class="dtable"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Area</th><th>Summary</th></tr></thead>
          <tbody>{d.rows.map((r) => <>
            <tr onClick={() => setOpen(open === r.id ? null : r.id)}><td class="mono">{formatDateTime(r.created_at)}</td><td>{r.actor_name}<br /><span class="faint">{r.actor_type}</span></td><td><span class="badge">{r.action}</span></td><td>{r.entity}{r.entity_id ? ` #${r.entity_id}` : ''}</td><td style="white-space:normal">{r.summary}</td></tr>
            {open === r.id && <tr style="cursor:default"><td colSpan={5}><div class="code-block">{JSON.stringify(r.changes, null, 2)}{r.ip ? `\nIP ${r.ip}` : ''}</div></td></tr>}
          </>)}</tbody></table></div>
      )}
      <div class="pager"><button class="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</button><span>Page {page}</span><button class="btn btn-sm" disabled={!d || d.rows.length < 100} onClick={() => setPage(page + 1)}>Older</button></div>
    </div>
  );
}

function SystemLogs() {
  const [tab, setTab] = useState<'errors' | 'messages' | 'webhooks'>('errors');
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  useEffect(() => {
    setRows(null);
    const path = tab === 'errors' ? '/errors' : tab === 'messages' ? '/notifications' : '/webhooks/deliveries';
    get<{ rows?: Record<string, unknown>[]; deliveries?: Record<string, unknown>[] }>(path).then((r) => setRows(r.data.rows ?? r.data.deliveries ?? [])).catch(() => setRows([]));
  }, [tab]);
  return (
    <div class="stack">
      <div class="seg" role="group" style="align-self:flex-start"><button type="button" aria-pressed={tab === 'errors'} onClick={() => setTab('errors')}>Errors</button><button type="button" aria-pressed={tab === 'messages'} onClick={() => setTab('messages')}>Messages sent</button><button type="button" aria-pressed={tab === 'webhooks'} onClick={() => setTab('webhooks')}>Webhook deliveries</button></div>
      {!rows ? <div class="skeleton" style="height:300px" /> : rows.length === 0 ? <Empty icon="check">Nothing logged.</Empty> : (
        <div class="dtable-wrap"><table class="dtable"><tbody>{rows.map((r) => (
          <tr style="cursor:default">
            <td class="mono" style="white-space:nowrap">{formatDateTime(String(r.created_at))}</td>
            {tab === 'errors' && <><td><span class="badge">{String(r.source)}</span></td><td style="white-space:normal"><b>{String(r.message)}</b><br /><span class="faint">{String(r.url)}</span></td></>}
            {tab === 'messages' && <><td><span class={`badge badge-${r.status === 'sent' ? 'good' : r.status === 'skipped' ? 'info' : 'bad'}`}>{String(r.channel)}</span></td><td style="white-space:normal">{String(r.recipient)} · {String(r.subject || String(r.body).slice(0, 80))}{r.error ? <span class="faint"> — {String(r.error).slice(0, 100)}</span> : null}</td></>}
            {tab === 'webhooks' && <><td><span class={`badge badge-${r.status === 'delivered' ? 'good' : r.status === 'failed' ? 'bad' : 'warn'}`}>{String(r.status)}</span></td><td>{String(r.name)} · {String(r.event)} · {String(r.attempts)} attempt(s){r.last_error ? ` · ${String(r.last_error)}` : ''}</td></>}
          </tr>
        ))}</tbody></table></div>
      )}
      <a class="btn btn-ghost btn-sm" style="align-self:flex-start" href="#/r/webhooks" onClick={() => go('r/webhooks')}>Manage webhooks (Zapier, Make, n8n) →</a>
      <span class="faint" style="font-size:.8rem">Delete is unavailable here by design; logs are pruned automatically after 30–180 days.</span>
    </div>
  );
}

void del;
