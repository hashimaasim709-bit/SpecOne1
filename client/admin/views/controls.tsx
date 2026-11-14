// One-tap control deck (the old site's macro buttons, done properly) and trade applications.
import { useEffect, useState } from 'preact/hooks';
import { formatDate } from '../../../shared/format';
import { toast } from '../../lib/ui';
import { get, send } from '../api';
import { can, type Me } from '../main';
import { Icon, useAction } from '../ui';

type Perm = Parameters<typeof can>[1];
interface Tile { action?: string; href?: string; run?: () => Promise<void>; icon: string; label: string; sub: string; perm?: Perm; confirm?: string; tone?: 'accent' | 'good' | 'warn' | 'bad'; external?: boolean }

async function runSheet(): Promise<void> {
  const res = await fetch('/api/admin/run-sheet', { credentials: 'same-origin' });
  if (!res.ok) throw new Error('Could not build the run sheet.');
  const text = await res.text();
  try {
    if (navigator.share) {
      await navigator.share({ title: "Today's run sheet", text });
      return;
    }
  } catch {
    /* share sheet closed: fall through to copying */
  }
  await navigator.clipboard.writeText(text);
  toast('Run sheet copied — paste it into Samsung Notes, WhatsApp or a message.', { title: 'Copied' });
}

const copyLink = (path: string, label: string) => async () => {
  const url = `${location.origin}${path}`;
  try {
    if (navigator.share) await navigator.share({ title: label, url });
    else {
      await navigator.clipboard.writeText(url);
      toast(`${label} link copied`);
    }
  } catch {
    /* closed */
  }
};

export function ControlDeck({ me, paused, onDone }: { me: Me; paused: boolean | null; onDone: () => void }) {
  const [busy, act] = useAction();
  const [open, setOpen] = useState(() => localStorage.getItem('s1-deck') !== 'closed');
  const groups: [string, Tile[]][] = [
    ['Phone & day', [
      { action: 'test-alert', icon: 'bell', label: 'Test phone alert', sub: 'Ping your phone now' },
      { run: runSheet, icon: 'clipboard', label: "Today's run sheet", sub: 'Share or copy as text', perm: 'bookings.read' },
      { href: '#/settings/booking', icon: 'calendar', label: 'Phone calendar sync', sub: 'Subscribe on your phone', perm: 'settings.write' },
    ]],
    ['Diary', [
      { action: 'block-today', icon: 'ban', label: 'Block today', sub: 'No new bookings today', perm: 'bookings.write', confirm: 'Close today to new online bookings?', tone: 'bad' },
      { action: 'block-tomorrow', icon: 'ban', label: 'Block tomorrow', sub: 'Day off tomorrow', perm: 'bookings.write', confirm: 'Close tomorrow to new online bookings?', tone: 'bad' },
      { action: 'block-sunday', icon: 'ban', label: 'Block next Sunday', sub: 'Take Sunday off', perm: 'bookings.write', confirm: 'Close next Sunday to new online bookings?', tone: 'bad' },
      { action: 'unblock-upcoming', icon: 'unlock', label: 'Reopen all days', sub: 'Clear upcoming blocks', perm: 'bookings.write', confirm: 'Reopen every upcoming blocked day?', tone: 'good' },
      ...(paused === null ? [] : [paused
        ? { action: 'resume-booking', icon: 'check', label: 'Resume online booking', sub: 'Booking is paused', perm: 'settings.write' as Perm, tone: 'good' as const }
        : { action: 'pause-booking', icon: 'lock', label: 'Pause online booking', sub: 'Phone & WhatsApp only', perm: 'settings.write' as Perm, confirm: 'Pause online booking? Customers will be asked to call or WhatsApp.', tone: 'warn' as const }]),
    ]],
    ['Bookings', [
      { action: 'confirm-pending', icon: 'check', label: 'Confirm all pending', sub: 'And notify customers', perm: 'bookings.write', confirm: 'Confirm every pending upcoming booking and notify the customers?', tone: 'good' },
      { action: 'send-reminders', icon: 'megaphone', label: "Send tomorrow's reminders", sub: 'Text & email now', perm: 'bookings.write', confirm: "Send reminders to tomorrow's customers now?" },
      { href: '#/quick', icon: 'plus', label: 'Quick-book', sub: 'Phone or walk-in', perm: 'bookings.write' },
    ]],
    ['Sales', [
      { action: 'flash-promo-on', icon: 'bolt', label: '48-hour flash sale', sub: '10% off · code FLASH10', perm: 'content.write', confirm: 'Start a 48-hour 10% flash sale with a banner across the site?', tone: 'accent' },
      { action: 'flash-promo-off', icon: 'x', label: 'End flash sale', sub: 'Remove code & banner', perm: 'content.write' },
      { action: 'bundles-boost', icon: 'gift', label: 'Boost bundles', sub: '£25 / £50 off combos', perm: 'finance.write', confirm: 'Raise bundle savings to £25 for two packages and £50 for three or more?' },
      { action: 'bundles-standard', icon: 'refresh', label: 'Standard bundles', sub: '£15 / £35 off combos', perm: 'finance.write' },
    ]],
    ['Share & print', [
      { run: copyLink('/rate-card', 'Price list'), icon: 'share', label: 'Share price list', sub: 'Interactive rate card' },
      { href: '/rate-card.pdf', icon: 'download', label: 'Price list PDF', sub: 'Print or attach', external: true },
      { run: copyLink('/trade', 'Trade portal'), icon: 'handshake', label: 'Share trade portal', sub: 'Trade rates & sign-up' },
      { href: '#/r/flyers', icon: 'file', label: 'Flyer studio', sub: 'Design a flyer with QR', perm: 'content.write' },
    ]],
    ['Data', [
      { action: 'backup-now', icon: 'cloud', label: 'Back up now', sub: 'Encrypted snapshot', perm: 'settings.write' },
      { href: '/api/admin/export/bookings.csv', icon: 'download', label: 'Export bookings', sub: 'CSV for accounts', perm: 'finance.read', external: true },
      { action: 'archive-chats', icon: 'archive', label: 'Archive old chats', sub: 'Older than 30 days', perm: 'inbox', confirm: 'Archive every open conversation older than 30 days?' },
      { href: '#/settings/site', icon: 'palette', label: 'Website studio', sub: 'Colours, sections, switches', perm: 'settings.write' },
    ]],
  ];
  const visible = groups.map(([g, tiles]) => [g, tiles.filter((t) => !t.perm || can(me, t.perm))] as [string, Tile[]]).filter(([, t]) => t.length);

  async function press(t: Tile) {
    if (t.confirm && !confirm(t.confirm)) return;
    if (t.run) {
      try {
        await t.run();
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Something went wrong.', { icon: 'alert' });
      }
      return;
    }
    const r = await act(() => send<{ ok: boolean; message: string }>(`/quick/${t.action}`, {}));
    if (r) {
      toast(r.message, { title: t.label });
      onDone();
    }
  }

  return (
    <div class="panel deck">
      <div class="panel-head">
        <h3><Icon name="bolt" /> One-tap controls</h3>
        <button class="btn btn-sm btn-ghost" type="button" aria-expanded={open} onClick={() => { const n = !open; setOpen(n); localStorage.setItem('s1-deck', n ? 'open' : 'closed'); }}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && visible.map(([g, tiles]) => (
        <div class="deck-group">
          <span class="deck-label">{g}</span>
          <div class="deck-grid">
            {tiles.map((t) => {
              const inner = <><span class={`deck-icon${t.tone ? ` tone-${t.tone}` : ''}`}><Icon name={t.icon} /></span><span class="deck-text"><b>{t.label}</b><small>{t.sub}</small></span></>;
              return t.href
                ? <a class="deck-tile" href={t.href} {...(t.external ? { target: '_blank', rel: 'noopener' } : {})}>{inner}</a>
                : <button class="deck-tile" type="button" disabled={busy} onClick={() => press(t)}>{inner}</button>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

interface Application { id: number; name: string; kind: string; contact_name: string; phone: string; email: string; code: string; customer_discount_pct: number; trade_details: string; created_at: string }

/** Trade account applications from the public trade portal, approved with one tap. */
export function TradeApplications({ me }: { me: Me }) {
  const [rows, setRows] = useState<Application[]>([]);
  const [busy, act] = useAction();
  const load = () => get<{ rows: Application[] }>('/trade/applications').then((r) => setRows(r.data.rows)).catch(() => undefined);
  useEffect(() => {
    if (can(me, 'crm.read')) void load();
  }, []);
  if (!rows.length) return null;
  const decide = async (a: Application, decision: 'approve' | 'decline') => {
    if (decision === 'decline' && !confirm(`Decline the trade application from ${a.name}?`)) return;
    const r = await act(() => send<{ ok: boolean; message: string }>(`/trade/${a.id}/${decision}`, {}));
    if (r) {
      toast(r.message);
      void load();
    }
  };
  return (
    <div class="panel">
      <div class="panel-head"><h3><Icon name="handshake" /> Trade applications</h3><a class="btn btn-sm btn-ghost" href="#/r/partners">All partners <Icon name="arrow" /></a></div>
      <div class="list">{rows.map((a) => (
        <div class="list-row" style="flex-wrap:wrap">
          <span class="grow"><b>{a.name}</b><span>{a.contact_name} · {a.phone} · {a.email} · applied {formatDate(a.created_at.slice(0, 10))}</span><span style="white-space:pre-line">{a.trade_details}</span></span>
          {can(me, 'crm.write') && <span class="row" style="flex-wrap:nowrap">
            <button class="btn btn-sm btn-primary" type="button" disabled={busy} onClick={() => decide(a, 'approve')}>Approve · {a.customer_discount_pct}%</button>
            <button class="btn btn-sm btn-ghost" type="button" disabled={busy} onClick={() => decide(a, 'decline')}>Decline</button>
          </span>}
        </div>
      ))}</div>
    </div>
  );
}
