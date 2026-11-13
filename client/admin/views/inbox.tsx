// Inbox for live chat and enquiries (#53), with AI-assisted sentiment (#99).
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatDateTime } from '../../../shared/format';
import { toast } from '../../lib/ui';
import { get, send } from '../api';
import { go, type Me } from '../main';
import { Empty, Icon, PageTitle, useAction } from '../ui';

interface Thread { id: number; visitor_name: string; contact: string; status: string; unread: number; sentiment: string; sentiment_score: number | null; updated_at: string; last_message: string | null }
interface Msg { id: number; sender: string; author: string; body: string; created_at: string }

const tone = (score: number | null | undefined) => (score == null ? '' : score > 0.2 ? 'badge-good' : score < -0.2 ? 'badge-bad' : 'badge-info');

export function InboxView({ me, threadId }: { me: Me; threadId: number | null }) {
  const [status, setStatus] = useState<'open' | 'closed'>('open');
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const load = () => get<{ threads: Thread[] }>(`/inbox?status=${status}`).then((r) => setThreads(r.data.threads)).catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 15000);
    return () => clearInterval(t);
  }, [status]);
  void me;
  return (
    <div>
      <PageTitle title="Inbox" sub="Website chat and enquiries. While you're here, the auto-assistant stays quiet and customers see your replies live.">
        <div class="seg" role="group"><button type="button" aria-pressed={status === 'open'} onClick={() => setStatus('open')}>Open</button><button type="button" aria-pressed={status === 'closed'} onClick={() => setStatus('closed')}>Closed</button></div>
      </PageTitle>
      <div class="cols-job" style="grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr)">
        <div class="panel" style="padding:8px">
          {!threads ? <div class="skeleton" style="height:300px" /> : threads.length === 0 ? <Empty icon="inbox">No {status} conversations.</Empty> : (
            <div class="list">{threads.map((t) => (
              <a class="list-row" href={`#/inbox/${t.id}`} style={t.id === threadId ? 'background:var(--surface-2);border-radius:10px' : ''}>
                <span class="avatar">{(t.visitor_name[0] ?? '?').toUpperCase()}</span>
                <span class="grow"><b>{t.visitor_name}{t.unread ? <span class="badge badge-accent" style="margin-left:6px">{t.unread} new</span> : null}</b><span>{t.last_message}</span></span>
                <span class="faint mono" style="font-size:.7rem;white-space:nowrap">{formatDateTime(t.updated_at)}</span>
              </a>
            ))}</div>
          )}
        </div>
        {threadId ? <Conversation id={threadId} onChange={load} /> : <div class="panel"><Empty icon="inbox">Choose a conversation.</Empty></div>}
      </div>
    </div>
  );
}

function Conversation({ id, onChange }: { id: number; onChange: () => void }) {
  const [data, setData] = useState<{ thread: Thread; messages: Msg[] } | null>(null);
  const [reply, setReply] = useState('');
  const [sms, setSms] = useState(false);
  const [busy, act] = useAction();
  const log = useRef<HTMLDivElement>(null);
  const load = () => get<{ thread: Thread; messages: Msg[] }>(`/inbox/${id}`).then((r) => setData(r.data)).catch(() => undefined);
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === 'visible' && load(), 8000);
    return () => clearInterval(t);
  }, [id]);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [data?.messages.length]);
  if (!data) return <div class="skeleton" style="height:400px" />;
  const t = data.thread;
  const phone = t.contact.split('·').map((s) => s.trim()).find((s) => /\d{6,}/.test(s));
  return (
    <div class="panel stack" style="gap:12px">
      <div class="spread">
        <div><h3>{t.visitor_name}</h3><span class="muted" style="font-size:.86rem">{t.contact || 'No contact details given'}</span></div>
        <div class="row">
          {phone && <a class="btn btn-sm" href={`tel:${phone}`}><Icon name="phone" /></a>}
          {phone && <a class="btn btn-sm" href={`https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '44')}`} target="_blank" rel="noopener"><Icon name="wa" /></a>}
          <button class="btn btn-sm" type="button" disabled={busy} onClick={async () => { const r = await act(() => send<{ sentiment: { label: string; summary: string; followUp: string; engine: string } }>(`/inbox/${id}/analyse`)); if (r) { toast(`${r.sentiment.summary}${r.sentiment.followUp ? ` Suggested: ${r.sentiment.followUp}` : ''}`, { title: `${r.sentiment.label} · ${r.sentiment.engine}`, icon: 'info', timeout: 9000 }); void load(); } }}><Icon name="sparkle" /> Sentiment</button>
          <button class="btn btn-sm" type="button" onClick={async () => { await act(() => send(`/inbox/${id}/status`, { status: t.status === 'open' ? 'closed' : 'open' }), t.status === 'open' ? 'Closed' : 'Reopened'); onChange(); go('inbox'); }}>{t.status === 'open' ? 'Close' : 'Reopen'}</button>
        </div>
      </div>
      {t.sentiment && <span class={`badge ${tone(t.sentiment_score)}`} style="align-self:flex-start;height:auto;padding:4px 10px;white-space:normal;text-transform:none;letter-spacing:0;font-family:var(--font-sans)">{t.sentiment}</span>}
      <div class="chat-log" ref={log} style="max-height:52vh;border-radius:14px">
        {data.messages.map((m) => <div class={`bubble ${m.sender === 'visitor' ? 'bot' : 'visitor'}`} style={m.sender === 'bot' ? 'opacity:.75' : ''}><span class="who" style={m.sender !== 'visitor' ? 'color:rgba(255,255,255,.75)' : ''}>{m.sender === 'bot' ? 'Auto-reply' : m.author} · {formatDateTime(m.created_at)}</span>{m.body}</div>)}
      </div>
      <form class="stack" style="gap:8px" onSubmit={async (e) => {
        e.preventDefault();
        if (!reply.trim()) return;
        if (await act(() => send(`/inbox/${id}/reply`, { body: reply, sms }))) {
          setReply('');
          void load();
          onChange();
        }
      }}>
        <textarea class="textarea" placeholder="Type a reply…" value={reply} onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) (e.currentTarget.form as HTMLFormElement).requestSubmit(); }} />
        <div class="spread">{phone ? <label class="check"><input type="checkbox" checked={sms} onChange={(e) => setSms((e.target as HTMLInputElement).checked)} /><span>Also send by SMS (they may have closed the website)</span></label> : <span />}<button class="btn btn-primary" disabled={busy}>Send</button></div>
      </form>
    </div>
  );
}

/** Feedback insights across reviews and chats (#99). */
export function FeedbackView() {
  const [d, setD] = useState<{ reviewMix: { sentiment: string; n: number; avg_rating: number }[]; chatMix: { sentiment: string; n: number }[]; attention: { type: string; id: number; who: string; rating?: number; body?: string; summary: string; at: string }[]; rating: { avg: number | null; n: number } | null; engine: string } | null>(null);
  useEffect(() => {
    get<NonNullable<typeof d>>('/feedback').then((r) => setD(r.data)).catch(() => undefined);
  }, []);
  if (!d) return <div class="skeleton" style="height:300px" />;
  const mix = (rows: { sentiment: string; n: number }[]) => {
    const total = rows.reduce((s, r) => s + r.n, 0) || 1;
    const get_ = (k: string) => rows.find((r) => r.sentiment === k)?.n ?? 0;
    return (['positive', 'neutral', 'negative'] as const).map((k) => ({ k, n: get_(k), pct: Math.round((get_(k) / total) * 100) }));
  };
  return (
    <div class="stack" style="gap:16px">
      <PageTitle title="Feedback insights" sub={`Sentiment is scored ${d.engine === 'claude' ? 'by Claude (AI-assisted)' : 'by the built-in analyser — add an ANTHROPIC_API_KEY secret for AI-assisted summaries'}.`}><a class="btn" href="#/r/reviews">All reviews</a></PageTitle>
      <div class="stats">
        <div class="stat accent"><small>Average rating</small><b>{d.rating?.avg ? d.rating.avg.toFixed(1) : '—'}</b><span>{d.rating?.n ?? 0} reviews</span></div>
        {mix(d.reviewMix).map((m) => <div class="stat"><small>{m.k} reviews</small><b>{m.n}</b><span>{m.pct}%</span></div>)}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Needs a follow-up</h3></div>
        {d.attention.length === 0 ? <Empty icon="check">Nothing negative to follow up. Nice work.</Empty> : <div class="list">{d.attention.map((a) => <a class="list-row" href={a.type === 'review' ? `#/r/reviews/${a.id}` : `#/inbox/${a.id}`}><span class={`badge ${a.type === 'review' ? 'badge-warn' : 'badge-info'}`}>{a.type}{a.rating ? ` ${a.rating}★` : ''}</span><span class="grow"><b>{a.who}</b><span>{a.summary || a.body}</span></span></a>)}</div>}
      </div>
      <div class="panel"><div class="panel-head"><h3>Chat sentiment</h3></div><div class="stats">{mix(d.chatMix).map((m) => <div class="stat"><small>{m.k}</small><b>{m.n}</b><span>{m.pct}%</span></div>)}</div></div>
    </div>
  );
}
