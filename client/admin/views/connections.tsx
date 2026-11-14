// Connections centre: set up every outside service from the admin — paste a key, test it, done.
import type { InputHTMLAttributes } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { CONNECTIONS, type ConnectionDef } from '../../../shared/connections';
import { get, send } from '../api';
import type { Me } from '../main';
import { Icon, PageTitle, useAction } from '../ui';

interface FieldStatus { name: string; set: boolean; source: string; hint: string; updatedAt: string | null; unreadable: boolean }
interface ConnStatus { key: string; on: boolean; fields: FieldStatus[] }
interface Data { connections: ConnStatus[]; canEdit: boolean; setupTokenSet: boolean }
interface Channel { topic: string; subscribeUrl: string; appUrl: string }

const PRIORITY: [ConnectionDef['priority'], string, string][] = [
  ['essential', 'Start here', 'Phone alerts and email make everything else useful.'],
  ['recommended', 'Recommended', 'Faster bookings and fewer typing mistakes for customers.'],
  ['optional', 'When you are ready', 'Payments, reviews, detailed maps and extras.'],
];

export function ConnectionsView({ me }: { me: Me }) {
  const [d, setD] = useState<Data | null>(null);
  const load = () => get<Data>('/connections').then((r) => setD(r.data)).catch(() => undefined);
  useEffect(() => {
    void load();
  }, []);
  if (!d) return <div class="skeleton" style="height:420px" />;
  const byKey = new Map(d.connections.map((c) => [c.key, c]));
  const done = d.connections.filter((c) => c.on).length;
  return (
    <div class="stack" style="gap:18px">
      <PageTitle title="Connections" sub={`${done} of ${d.connections.length} services connected`} />
      <div class="progress-bar" style="height:8px"><span style={{ width: `${Math.round((done / d.connections.length) * 100)}%` }} /></div>
      {!d.canEdit && <div class="alert alert-info"><Icon name="lock" /><span>Only the owner ({me.role === 'owner' ? 'you' : 'not you'}) can add or change keys. You can still run the tests.</span></div>}
      {d.canEdit && !d.setupTokenSet && <div class="alert alert-warn"><Icon name="alert" /><span>Keys are encrypted with your <b>SETUP_TOKEN</b> secret, which isn't set on the Worker. Add it in Cloudflare → Workers &amp; Pages → specone-auto-labs → Settings → Variables and Secrets, then come back.</span></div>}
      <p class="muted" style="margin:0;max-width:760px">Paste each key once and tap <b>Save</b>, then <b>Test</b>. Keys are encrypted and never shown again — only the last few characters. A key set directly in Cloudflare always takes priority.</p>
      {PRIORITY.map(([p, title, blurb]) => (
        <section class="stack" style="gap:12px">
          <div><span class="deck-label" style="margin:0">{title}</span><p class="faint" style="margin:2px 0 0;font-size:.86rem">{blurb}</p></div>
          <div class="conn-grid">{CONNECTIONS.filter((c) => c.priority === p).map((def) => <ConnectionCard def={def} status={byKey.get(def.key)!} canEdit={d.canEdit} onChange={(next) => setD({ ...d, connections: next ?? d.connections })} reload={load} />)}</div>
        </section>
      ))}
    </div>
  );
}

function ConnectionCard({ def, status, canEdit, onChange, reload }: { def: ConnectionDef; status: ConnStatus; canEdit: boolean; onChange: (c?: ConnStatus[]) => void; reload: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(!status.on);
  const [testInput, setTestInput] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [channel, setChannel] = useState<Channel | null>(null);
  const [busy, act] = useAction();
  const fs = new Map(status.fields.map((f) => [f.name, f]));

  async function save(name: string, value: string) {
    const r = await act(() => send<{ ok: boolean; connections: ConnStatus[] }>(`/connections/${name}`, { value }, 'PUT'), value ? 'Saved' : 'Removed');
    if (r) {
      setValues((v) => ({ ...v, [name]: '' }));
      onChange(r.connections);
    }
  }
  async function test() {
    setResult(null);
    const r = await act(() => send<{ ok: boolean; message: string }>(`/connections/test/${def.key}`, { input: testInput }));
    if (r) setResult(r);
  }
  async function makeChannel() {
    const r = await act(() => send<{ ok: boolean } & Channel>('/connections/ntfy/generate', {}), 'Private alert channel created');
    if (r) {
      setChannel(r);
      reload();
    }
  }
  async function showChannel() {
    const r = await act(() => get<Channel>('/connections/ntfy/channel').then((x) => x.data));
    if (r?.topic) setChannel(r);
  }

  return (
    <div class={`panel stack conn-card${status.on ? ' conn-on' : ''}`} style="gap:10px">
      <div class="spread" style="align-items:flex-start;flex-wrap:nowrap">
        <div><h3 style="margin:0">{def.title}</h3><span class="faint" style="font-size:.8rem">{def.cost}</span></div>
        <span class={`badge ${status.on ? 'badge-good' : ''}`}>{status.on ? 'Connected' : 'Not set up'}</span>
      </div>
      <p class="muted" style="margin:0;font-size:.9rem">{def.what}</p>
      <button class="btn btn-sm btn-ghost" style="align-self:flex-start" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide setup' : status.on ? 'Change or test' : 'Set up'} <Icon name={open ? 'up' : 'down'} /></button>
      {open && (
        <div class="stack" style="gap:12px">
          <ol class="conn-steps">{def.steps.map((s) => <li>{s}</li>)}</ol>
          <a class="btn btn-sm" style="align-self:flex-start" href={def.link.url} target="_blank" rel="noopener"><Icon name="external" /> {def.link.label}</a>

          {def.key === 'alerts' && canEdit && (
            <div class="stack" style="gap:8px">
              <div class="row">
                <button class="btn btn-primary" type="button" disabled={busy} onClick={() => { if (!fs.get('NTFY_TOPIC')?.set || confirm('Replace your current alert channel? Phones subscribed to the old one will stop getting alerts.')) void makeChannel(); }}><Icon name="bell" /> {fs.get('NTFY_TOPIC')?.set ? 'Make a new private channel' : 'Create my private alert channel'}</button>
                {fs.get('NTFY_TOPIC')?.set && !channel && <button class="btn" type="button" disabled={busy} onClick={showChannel}><Icon name="eye" /> Show channel to subscribe</button>}
              </div>
              {channel && (
                <div class="conn-channel">
                  <img src={`/api/admin/qr.svg?text=${encodeURIComponent(channel.subscribeUrl)}`} alt="QR code to subscribe" width="132" height="132" />
                  <div class="stack" style="gap:6px;min-width:0">
                    <b>On your phone:</b>
                    <a class="btn btn-sm btn-primary" href={channel.appUrl}>Open in the ntfy app</a>
                    <span class="faint" style="font-size:.82rem">Or scan the code, or add this channel in ntfy with +:</span>
                    <code class="mono conn-code">{channel.topic}</code>
                    <span class="faint" style="font-size:.78rem">Keep it private — anyone with the name could read your alerts.</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {def.fields.filter((f) => !(def.key === 'alerts' && f.name === 'NTFY_TOPIC')).map((f) => {
            const st = fs.get(f.name)!;
            return (
              <div class="field">
                <label>{f.label}</label>
                {st.set && <span class="hint" style="margin:0 0 4px">{st.source === 'cloudflare' ? 'Set in Cloudflare (takes priority)' : `Saved: ${st.hint}`}{st.unreadable ? ' — could not be read, please enter it again' : ''}</span>}
                {canEdit && st.source !== 'cloudflare' && (
                  <div class="input-group">
                    <input {...({ class: `input${f.secret ? ' mono' : ''}`, type: f.secret ? 'password' : 'text', autocomplete: 'off', spellcheck: false, placeholder: st.set ? 'Paste a new value to replace' : f.placeholder ?? 'Paste here', value: values[f.name] ?? '', onInput: (e: Event) => setValues({ ...values, [f.name]: (e.target as HTMLInputElement).value }) } as unknown as InputHTMLAttributes<HTMLInputElement>)} />
                    <button class="btn btn-primary" type="button" disabled={busy || !(values[f.name] ?? '').trim()} onClick={() => save(f.name, values[f.name] ?? '')}>Save</button>
                    {st.set && <button class="btn btn-ghost" type="button" disabled={busy} aria-label={`Remove ${f.label}`} onClick={() => { if (confirm(`Remove ${f.label}?`)) void save(f.name, ''); }}><Icon name="trash" /></button>}
                  </div>
                )}
              </div>
            );
          })}

          {def.test && (
            <div class="stack" style="gap:8px">
              <div class="input-group">
                {def.test.input && <input class="input" placeholder={def.test.input} value={testInput} onInput={(e) => setTestInput((e.target as HTMLInputElement).value)} />}
                <button class="btn" type="button" disabled={busy} onClick={test}><Icon name="check" /> {def.test.label}</button>
              </div>
              {result && <div class={`alert ${result.ok ? 'alert-good' : 'alert-bad'}`}><Icon name={result.ok ? 'check' : 'alert'} /><span>{result.message}</span></div>}
            </div>
          )}
          {def.key === 'maps' && status.on && <p class="faint" style="margin:0;font-size:.82rem">Open the <a href="/coverage" target="_blank" rel="noopener">coverage page</a> to see the new map.</p>}
        </div>
      )}
    </div>
  );
}

