// SpecOne admin app: authentication gates, quick-lock, navigation and routing.
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { render, type ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Permission } from '../../shared/constants';
import { RESOURCES } from '../../shared/resources';
import { errorMessage } from '../lib/api';
import { debounce, enableRipples, installErrorReporting, store, toast } from '../lib/ui';
import { auth, clearDeviceData, flushOutbox, get, onSyncChange, outbox, setAuthHandlers } from './api';
import { Icon, Reg } from './ui';
import { BookingsView, CalendarView, QuickBookView } from './views/bookings';
import { CustomerView, VehicleView } from './views/crm';
import { DashboardView, TodayView } from './views/dashboard';
import { FeedbackView, InboxView } from './views/inbox';
import { ReportsView } from './views/finance';
import { JobCard } from './views/job';
import { ChecklistView, LibraryView } from './views/library';
import { ResourceView } from './views/resources';
import { ConnectionsView } from './views/connections';
import { SettingsView } from './views/settings';

export interface Me { id: number; name: string; email: string; role: string; permissions: Permission[] }
interface AuthState { setupRequired: boolean; setupNeedsToken: boolean; setupTokenConfigured: boolean; user: Me | null; locked: boolean; passkeys: number; autoLockMinutes: number; businessName: string }

export const can = (me: Me, p: Permission): boolean => me.permissions.includes(p);

// ── Router ──
export function useRoute(): string[] {
  const parse = () => (location.hash.replace(/^#\/?/, '') || 'dashboard').split('?')[0]!.split('/').map(decodeURIComponent);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => {
      setRoute(parse());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path: string): void => {
  location.hash = `#/${path.replace(/^\//, '')}`;
};
export const hashQuery = (): URLSearchParams => new URLSearchParams(location.hash.split('?')[1] ?? '');

// ── Auth screens ──
function AuthFrame({ title, sub, children }: { title: string; sub: string; children: ComponentChildren }) {
  return (
    <div class="lock-screen">
      <div class="card card-glass auth-card stack" style="gap:16px">
        <div class="row"><svg class="emblem emblem-glow" viewBox="0 0 64 64" width="44" height="44" dangerouslySetInnerHTML={{ __html: '<circle cx="32" cy="32" r="30" fill="#0b0d12" stroke="#e11d48" stroke-width="2.5"/><path class="arc-live" d="M15 45A21 21 0 1 1 49 45" stroke="#ff2e55" stroke-width="4.5" stroke-linecap="round" fill="none" pathLength="200"/><g class="needle"><line x1="32" y1="32" x2="45" y2="19" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></g><circle cx="32" cy="32" r="4.6" fill="#e11d48" stroke="#fff" stroke-width="1.6"/>' }} /><div><b style="font-size:1.1rem">{title}</b><div class="muted" style="font-size:.86rem">{sub}</div></div></div>
        {children}
      </div>
    </div>
  );
}

async function passkeySignIn(): Promise<boolean> {
  const { challengeId, options } = await auth<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>('/passkeys/login/options');
  const response = await startAuthentication({ optionsJSON: options });
  await auth('/passkeys/login/verify', { challengeId, response });
  return true;
}

function Setup({ state, onDone }: { state: AuthState; onDone: () => void }) {
  const [f, setF] = useState({ token: '', name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  return (
    <AuthFrame title="Set up your admin" sub="Create the owner account for this business.">
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        setErr('');
        try {
          await auth('/setup', f);
          onDone();
        } catch (ex) {
          setErr(errorMessage(ex));
        }
      }}>
        {state.setupNeedsToken && <div class="field"><label>Setup token</label><input class="input mono" required value={f.token} onInput={(e) => setF({ ...f, token: (e.target as HTMLInputElement).value })} /><span class="hint">{state.setupTokenConfigured ? 'The SETUP_TOKEN secret you set on the Worker.' : 'Set the SETUP_TOKEN secret on the Worker first — see docs/DEPLOY.md.'}</span></div>}
        <div class="field"><label>Your name</label><input class="input" required autoComplete="name" value={f.name} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} /></div>
        <div class="field"><label>Email</label><input class="input" type="email" required autoComplete="username" value={f.email} onInput={(e) => setF({ ...f, email: (e.target as HTMLInputElement).value })} /></div>
        <div class="field"><label>Password</label><input class="input" type="password" required minLength={10} autoComplete="new-password" value={f.password} onInput={(e) => setF({ ...f, password: (e.target as HTMLInputElement).value })} /><span class="hint">At least 10 characters. You can add Face ID / fingerprint sign-in afterwards.</span></div>
        {err && <div class="alert alert-bad"><span>{err}</span></div>}
        <button class="btn btn-primary btn-lg">Create owner account</button>
      </form>
    </AuthFrame>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <AuthFrame title="Staff sign-in" sub={document.title.replace('Admin · ', '')}>
      <button class="btn btn-primary btn-lg btn-block" type="button" onClick={async () => {
        setErr('');
        try {
          if (await passkeySignIn()) onDone();
        } catch (ex) {
          setErr((ex as Error).name === 'NotAllowedError' ? 'Passkey sign-in was cancelled.' : errorMessage(ex));
        }
      }}><Icon name="key" /> Sign in with Face ID / fingerprint</button>
      <div class="row faint" style="font-size:.78rem;justify-content:center">or use your password</div>
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr('');
        try {
          await auth('/login', { email, password });
          onDone();
        } catch (ex) {
          setErr(errorMessage(ex));
        } finally {
          setBusy(false);
        }
      }}>
        <div class="field"><label>Email</label><input class="input" type="email" required autoComplete="username webauthn" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></div>
        <div class="field"><label>Password</label><input class="input" type="password" required autoComplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></div>
        {err && <div class="alert alert-bad"><span>{err}</span></div>}
        <button class="btn btn-lg" disabled={busy}>{busy ? <span class="spinner" /> : 'Sign in'}</button>
      </form>
      <a class="faint" style="font-size:.82rem;text-align:center" href="/">← Back to website</a>
    </AuthFrame>
  );
}

/** Quick-lock screen (#26): unlock with Face ID / fingerprint, or password. */
function LockScreen({ state, onUnlock }: { state: AuthState; onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const tryPasskey = async () => {
    setErr('');
    try {
      if (await passkeySignIn()) onUnlock();
    } catch (ex) {
      if ((ex as Error).name !== 'NotAllowedError') setErr(errorMessage(ex));
    }
  };
  useEffect(() => {
    if (state.passkeys > 0) void tryPasskey();
  }, []);
  return (
    <AuthFrame title="Locked" sub={`${state.user?.name ?? ''} · unlock to continue`}>
      {state.passkeys > 0 && <button class="btn btn-primary btn-lg btn-block" type="button" onClick={tryPasskey}><Icon name="key" /> Unlock with Face ID / fingerprint</button>}
      <form class="stack" onSubmit={async (e) => {
        e.preventDefault();
        try {
          await auth('/unlock', { password });
          onUnlock();
        } catch (ex) {
          setErr(errorMessage(ex));
        }
      }}>
        <div class="field"><label>Password</label><input class="input" type="password" required autoComplete="current-password" value={password} onInput={(e) => setPassword((e.target as HTMLInputElement).value)} /></div>
        {err && <div class="alert alert-bad"><span>{err}</span></div>}
        <button class="btn btn-lg">Unlock</button>
      </form>
      <button class="btn btn-ghost btn-sm" type="button" onClick={async () => { await auth('/logout'); clearDeviceData(); location.reload(); }}>Sign out instead</button>
    </AuthFrame>
  );
}

export async function registerPasskey(): Promise<void> {
  const { challengeId, options } = await auth<{ challengeId: string; options: Parameters<typeof startRegistration>[0]['optionsJSON'] }>('/passkeys/register/options');
  const response = await startRegistration({ optionsJSON: options });
  const ua = navigator.userAgent;
  const name = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'This device';
  await auth('/passkeys/register/verify', { challengeId, name, response });
}

// ── Navigation ──
interface NavItem { href: string; label: string; icon: string; perm?: Permission; count?: number }

function navGroups(me: Me, counts: { inbox: number; pending: number }): [string, NavItem[]][] {
  const r = (key: string, icon: string, label?: string): NavItem => {
    const res = RESOURCES.find((x) => x.key === key)!;
    return { href: `r/${key}`, label: label ?? res.title, icon, perm: res.read };
  };
  const groups: [string, NavItem[]][] = [
    ['Operations', [
      { href: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
      { href: 'today', label: "Today's jobs", icon: 'route', perm: 'bookings.read' },
      { href: 'bookings', label: 'Bookings', icon: 'list', perm: 'bookings.read', count: counts.pending },
      { href: 'calendar', label: 'Calendar', icon: 'calendar', perm: 'bookings.read' },
      { href: 'quick', label: 'Quick-book', icon: 'plus', perm: 'bookings.write' },
      { href: 'inbox', label: 'Inbox', icon: 'inbox', perm: 'inbox', count: counts.inbox },
    ]],
    ['Customers', [r('customers', 'users'), r('vehicles', 'car'), r('subscriptions', 'refresh', 'Subscriptions'), r('partners', 'users', 'Trade partners')]],
    ['Money & stock', [{ href: 'reports', label: 'Reports & tax', icon: 'chart', perm: 'finance.read' }, r('expenses', 'money'), r('commissions', 'money', 'Commissions'), r('inventory', 'box', 'Stock & chemicals'), r('parts_requests', 'clipboard', 'Parts orders'), r('licences', 'key', 'Licences & tokens')]],
    ['Workshop', [{ href: 'library', label: 'Tech library', icon: 'book', perm: 'tech.read' }, r('dpf_logs', 'gauge', 'DPF log'), r('battery_tests', 'gauge', 'Battery tests'), r('flash_log', 'wrench', 'Flash log'), r('freeze_frames', 'chart', 'Freeze frames'), r('checklist_templates', 'clipboard', 'Checklists')]],
    ['Website & marketing', [{ href: 'settings/site', label: 'Website studio', icon: 'palette', perm: 'settings.write' }, r('pages', 'file', 'Website pages'), r('packages', 'tag', 'Services & prices'), r('plans', 'refresh', 'Plans'), r('upsell_rules', 'sparkle', 'Smart upsells'), r('pricing_rules', 'gauge', 'Peak pricing'), r('promo_codes', 'tag', 'Promo codes'), r('flyers', 'file', 'Flyer studio'), r('banners', 'megaphone', 'Banners'), r('gallery_items', 'camera', 'Lab gallery'), r('reviews', 'sparkle', 'Reviews'), { href: 'feedback', label: 'Feedback insights', icon: 'sparkle', perm: 'content.write' }, r('faqs', 'list', 'FAQs'), r('towns', 'today', 'Town pages'), r('fleet_portals', 'users', 'Fleet portals'), r('guides', 'book', 'Guides'), r('chatbot_rules', 'inbox', 'Chat auto-replies')]],
    ['System', [{ href: 'connections', label: 'Connections', icon: 'globe', perm: 'settings.write' }, { href: 'settings', label: 'Settings', icon: 'settings' }, r('locations', 'today', 'Locations'), r('vans', 'car', 'Vans'), r('webhooks', 'external', 'Webhooks'), { href: 'settings/audit', label: 'Audit trail', icon: 'shield', perm: 'audit.read' }]],
  ];
  return groups.map(([g, items]) => [g, items.filter((i) => !i.perm || can(me, i.perm))] as [string, NavItem[]]).filter(([, items]) => items.length);
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ bookings: { id: number; ref: string; name: string; date: string }[]; customers: { id: number; name: string; phone: string }[]; vehicles: { id: number; reg: string; make: string; model: string }[] } | null>(null);
  const run = useRef(debounce(async (term: string) => {
    if (term.trim().length < 2) return setRes(null);
    try {
      setRes((await get<NonNullable<typeof res>>(`/search?q=${encodeURIComponent(term)}`)).data);
    } catch {
      setRes(null);
    }
  }, 220)).current;
  const pick = (path: string) => {
    setQ('');
    setRes(null);
    go(path);
  };
  return (
    <div class="search">
      <Icon name="search" />
      <input class="input" placeholder="Search ref, name, phone or reg…" value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); run((e.target as HTMLInputElement).value); }} onBlur={() => setTimeout(() => setRes(null), 200)} aria-label="Search" />
      {res && (res.bookings.length + res.customers.length + res.vehicles.length > 0) && (
        <div class="search-results">
          {res.bookings.map((b) => <a href={`#/bookings/${b.id}`} onClick={(e) => { e.preventDefault(); pick(`bookings/${b.id}`); }}><span><b class="mono">{b.ref}</b> · {b.name}</span><span class="faint mono">{b.date}</span></a>)}
          {res.customers.map((c) => <a href={`#/customers/${c.id}`} onClick={(e) => { e.preventDefault(); pick(`customers/${c.id}`); }}><span>{c.name}</span><span class="faint mono">{c.phone}</span></a>)}
          {res.vehicles.map((v) => <a href={`#/vehicles/${v.reg}`} onClick={(e) => { e.preventDefault(); pick(`vehicles/${v.reg}`); }}><span><Reg reg={v.reg} /> {v.make} {v.model}</span><span class="faint">History →</span></a>)}
        </div>
      )}
    </div>
  );
}

function Shell({ me, state, onLock }: { me: Me; state: AuthState; onLock: () => void }) {
  const route = useRoute();
  const [counts, setCounts] = useState({ inbox: 0, pending: 0 });
  const [menu, setMenu] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [queued, setQueued] = useState(outbox().length);

  useEffect(() => {
    const refresh = () => get<{ unreadChats: number; pending: number }>('/dashboard').then((r) => setCounts({ inbox: r.data.unreadChats, pending: r.data.pending })).catch(() => undefined);
    void refresh();
    const t = setInterval(() => document.visibilityState === 'visible' && refresh(), 60000);
    const on = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) void flushOutbox().then((n) => n && toast(`${n} offline change${n === 1 ? '' : 's'} synced`));
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    const off = onSyncChange(() => setQueued(outbox().length));
    if (navigator.onLine && outbox().length) void flushOutbox();
    // Pre-cache today's job sheets for offline use.
    void get('/offline-bundle').catch(() => undefined);
    return () => {
      clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
      off();
    };
  }, []);

  // Auto-lock after inactivity (#26).
  useEffect(() => {
    const minutes = state.autoLockMinutes;
    if (!minutes) return;
    let last = Date.now();
    const bump = () => (last = Date.now());
    const events = ['pointerdown', 'keydown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const check = () => {
      if (Date.now() - last > minutes * 60000) onLock();
    };
    const t = setInterval(check, 15000);
    const vis = () => (document.visibilityState === 'visible' ? check() : undefined);
    document.addEventListener('visibilitychange', vis);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [state.autoLockMinutes]);

  const groups = navGroups(me, counts);
  const current = route.join('/');
  const isCurrent = (href: string) => current === href || (href !== 'dashboard' && current.startsWith(`${href}/`)) || (href === 'bookings' && route[0] === 'bookings');
  const nav = (onPick?: () => void) => groups.map(([g, items]) => (
    <>
      <div class="side-group">{g}</div>
      {items.map((i) => <a href={`#/${i.href}`} aria-current={isCurrent(i.href) ? 'page' : undefined} onClick={onPick}><Icon name={i.icon} />{i.label}{i.count ? <span class="count">{i.count}</span> : null}</a>)}
    </>
  ));

  let view: ComponentChildren;
  const [a, b, c] = route;
  if (a === 'dashboard') view = <DashboardView me={me} />;
  else if (a === 'today') view = <TodayView me={me} />;
  else if (a === 'bookings' && b) view = <JobCard id={Number(b)} me={me} />;
  else if (a === 'bookings') view = <BookingsView me={me} />;
  else if (a === 'calendar') view = <CalendarView me={me} />;
  else if (a === 'quick') view = <QuickBookView me={me} />;
  else if (a === 'customers' && b) view = <CustomerView id={Number(b)} me={me} />;
  else if (a === 'vehicles' && b) view = <VehicleView reg={b} me={me} />;
  else if (a === 'inbox') view = <InboxView me={me} threadId={b ? Number(b) : null} />;
  else if (a === 'feedback') view = <FeedbackView />;
  else if (a === 'reports') view = <ReportsView me={me} />;
  else if (a === 'library') view = <LibraryView me={me} />;
  else if (a === 'checklist' && b) view = <ChecklistView runId={Number(b)} me={me} />;
  else if (a === 'r' && b) view = <ResourceView key={b} resourceKey={b} me={me} openId={c} />;
  else if (a === 'settings') view = <SettingsView me={me} section={b ?? 'business'} />;
  else if (a === 'connections') view = <ConnectionsView me={me} />;
  else view = <div class="empty">Page not found. <a href="#/dashboard">Go to dashboard</a></div>;

  const toggleTheme = () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set('s1-theme', next);
  };

  return (
    <div class="shell">
      <aside class="side" aria-label="Admin navigation">
        <a class="brand" href="#/dashboard" style="padding:4px 8px 12px;background:none"><span class="brand-word"><b>SPEC<span>ONE</span></b><small>ADMIN</small></span></a>
        {nav()}
        <div class="side-foot">
          <div class="row" style="padding:0 8px"><span class="avatar">{me.name[0]}</span><span style="min-width:0"><b style="font-size:.88rem;display:block">{me.name}</b><span class="faint" style="font-size:.76rem">{me.role}</span></span></div>
        </div>
      </aside>
      <div class="main">
        <header class="topbar">
          <GlobalSearch />
          <div class="row" style="margin-left:auto;gap:6px;flex-wrap:nowrap">
            {!online && <span class="badge badge-warn offline-pill"><span class="dot" />Offline{queued ? ` · ${queued} queued` : ''}</span>}
            {online && queued > 0 && <span class="badge badge-info">{queued} syncing</span>}
            <a class="btn btn-ghost btn-icon" href="/" target="_blank" rel="noopener" title="Open website" aria-label="Open website"><Icon name="external" /></a>
            <button class="btn btn-ghost btn-icon" type="button" onClick={toggleTheme} aria-label="Toggle theme"><Icon name="moon" /></button>
            <button class="btn btn-ghost btn-icon" type="button" onClick={onLock} aria-label="Lock" title="Lock now"><Icon name="lock" /></button>
          </div>
        </header>
        <main class="content">{view}</main>
      </div>
      <nav class="tabbar" aria-label="Quick navigation">
        <a href="#/dashboard" aria-current={a === 'dashboard' ? 'page' : undefined}><Icon name="dashboard" />Home</a>
        <a href="#/today" aria-current={a === 'today' ? 'page' : undefined}><Icon name="route" />Today</a>
        <a href="#/bookings" aria-current={a === 'bookings' ? 'page' : undefined}><Icon name="list" />Jobs{counts.pending ? <span class="count">{counts.pending}</span> : null}</a>
        <a href="#/inbox" aria-current={a === 'inbox' ? 'page' : undefined}><Icon name="inbox" />Inbox{counts.inbox ? <span class="count">{counts.inbox}</span> : null}</a>
        <button type="button" onClick={() => setMenu(true)}><Icon name="menu" />More</button>
      </nav>
      {menu && (
        <div class="sheet is-open">
          <div class="sheet-backdrop" onClick={() => setMenu(false)} />
          <div class="sheet-panel side" style="display:flex;position:absolute;height:100%">
            <div class="spread"><b>Menu</b><button class="btn btn-ghost btn-icon" type="button" onClick={() => setMenu(false)} aria-label="Close"><Icon name="x" /></button></div>
            {nav(() => setMenu(false))}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    try {
      setState(await auth<AuthState>('/state', undefined, 'GET'));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    setAuthHandlers(() => setState((s) => (s ? { ...s, locked: true } : s)), () => void load());
    void load();
  }, []);
  if (error && !state) return <div class="lock-screen"><div class="alert alert-bad"><span>{error} <button class="btn btn-sm" onClick={() => location.reload()}>Retry</button></span></div></div>;
  if (!state) return <div class="boot"><div class="skeleton" style="width:64px;height:64px;border-radius:50%" /></div>;
  if (state.setupRequired) return <Setup state={state} onDone={load} />;
  if (!state.user) return <Login onDone={load} />;
  if (state.locked) return <LockScreen state={state} onUnlock={load} />;
  const me: Me = { ...state.user, permissions: state.user.permissions as Permission[] };
  return <Shell me={me} state={state} onLock={async () => { await auth('/lock').catch(() => undefined); setState({ ...state, locked: true }); }} />;
}

installErrorReporting();
enableRipples();
document.body.classList.add('admin');
const rootEl = document.getElementById('admin-app')!;
rootEl.innerHTML = '';
render(<App />, rootEl);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
