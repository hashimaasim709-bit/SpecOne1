// Generic list + form for every admin-managed table (driven by shared/resources.ts).
import type { ComponentChildren, InputHTMLAttributes } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { SLOT_ORDER, SLOTS } from '../../../shared/constants';
import { formatDate, money } from '../../../shared/format';
import { optionLabel, optionValue, RESOURCE_MAP, type Field, type Resource } from '../../../shared/resources';
import { compressImage } from '../../lib/api';
import { debounce, toast } from '../../lib/ui';
import { del, get, send, upload } from '../api';
import { can, go, hashQuery, type Me } from '../main';
import { Drawer, Empty, Icon, Modal, moneyInputValue, PageTitle, Stale, toMinor, useAction } from '../ui';

type Row = Record<string, unknown>;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function cell(f: Field, v: unknown): string {
  if (v == null || v === '') return '—';
  switch (f.type) {
    case 'money': return money(Number(v), 'GBP');
    case 'percent': return `${v}%`;
    case 'bool': return v ? 'Yes' : 'No';
    case 'date': return formatDate(String(v));
    case 'select': return optionLabel((f.options ?? []).find((o) => optionValue(o) === v) ?? String(v));
    case 'weekdays': return (v as number[]).length ? (v as number[]).map((d) => DAYS[d]).join(', ') : 'Every day';
    case 'months': return (v as number[]).length ? (v as number[]).map((m) => MONTHS[m - 1]).join(', ') : 'All year';
    case 'slotset': return (v as string[]).length ? (v as string[]).map((s) => SLOTS[s as keyof typeof SLOTS]?.label ?? s).join(', ') : 'All windows';
    case 'list': case 'multiselect': return (v as string[]).join(', ');
    case 'rows': case 'sections': return `${(v as unknown[]).length} item${(v as unknown[]).length === 1 ? '' : 's'}`;
    default: return String(v);
  }
}

export function ResourceView({ resourceKey, me, openId }: { resourceKey: string; me: Me; openId?: string }) {
  const res = RESOURCE_MAP[resourceKey];
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState(hashQuery().get('filter') ?? '');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ data: { rows: Row[]; total: number }; stale: boolean; at: number } | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; initial?: Row } | null>(openId ? { id: openId } : null);
  const [importing, setImporting] = useState(false);
  const load = useMemo(() => debounce((term: string, flt: string, p: number) => {
    const params = new URLSearchParams({ page: String(p), size: '50' });
    if (term) params.set('q', term);
    if (flt) params.set('filter', flt);
    get<{ rows: Row[]; total: number }>(`/r/${resourceKey}?${params}`).then(setData).catch(() => undefined);
  }, 180), [resourceKey]);
  useEffect(() => load(q, filter, page), [q, filter, page]);
  useEffect(() => setEditing(openId ? { id: openId } : null), [openId]);
  if (!res) return <Empty>Unknown section.</Empty>;
  const cols = res.fields.filter((f) => f.list && !(res.financeFields ?? []).includes(f.key) || (f.list && can(me, 'finance.read')));
  const filterField = res.filter ? res.fields.find((f) => f.key === res.filter) : undefined;
  const writable = can(me, res.write);
  const close = () => {
    setEditing(null);
    if (openId) go(`r/${resourceKey}`);
  };
  return (
    <div>
      <PageTitle title={res.title} sub={res.blurb}>
        {writable && <button class="btn btn-primary" type="button" onClick={() => setEditing({ id: null })}><Icon name="plus" /> Add {res.singular}</button>}
        {resourceKey === 'customers' && <a class="btn" href="/api/admin/export/customers.csv"><Icon name="download" /> CSV</a>}
        {resourceKey === 'dtc_codes' && writable && <button class="btn" type="button" onClick={() => setImporting(true)}><Icon name="download" /> Import list</button>}
        {resourceKey === 'expenses' && can(me, 'finance.read') && <a class="btn" href="/api/admin/export/expenses.csv"><Icon name="download" /> CSV</a>}
      </PageTitle>
      <div class="toolbar">
        {res.search.length > 0 && <input class="input" placeholder={`Search ${res.title.toLowerCase()}`} value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setPage(1); }} />}
        {filterField && (
          filterField.options ? <select class="select" value={filter} onChange={(e) => { setFilter((e.target as HTMLSelectElement).value); setPage(1); }}><option value="">Any {filterField.label.toLowerCase()}</option>{filterField.options.map((o) => <option value={optionValue(o)}>{optionLabel(o)}</option>)}</select>
            : <input class="input" placeholder={`Filter by ${filterField.label.toLowerCase()}`} value={filter} onInput={(e) => setFilter((e.target as HTMLInputElement).value)} />
        )}
      </div>
      {data && <Stale stale={data.stale} at={data.at} />}
      {!data ? <div class="skeleton" style="height:300px" /> : data.data.rows.length === 0 ? <Empty>Nothing here yet.{writable ? ' Use “Add” to create the first one.' : ''}</Empty> : (
        <div class="dtable-wrap">
          <table class="dtable">
            <thead><tr>{cols.map((c) => <th class={c.type === 'money' || c.type === 'int' || c.type === 'number' || c.type === 'percent' ? 'num' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>{data.data.rows.map((r) => (
              <tr onClick={() => (resourceKey === 'customers' ? go(`customers/${r.id}`) : resourceKey === 'vehicles' ? go(`vehicles/${r.reg}`) : setEditing({ id: String(r[res.pk]) }))}>
                {cols.map((c) => <td class={c.type === 'money' || c.type === 'int' || c.type === 'number' || c.type === 'percent' ? 'num' : ''}>{c.type === 'bool' ? <span class={`badge ${r[c.key] ? 'badge-good' : ''}`}>{r[c.key] ? 'Yes' : 'No'}</span> : cell(c, r[c.key])}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {data && data.data.total > 50 && <div class="pager"><button class="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><span>{data.data.total} total · page {page}</span><button class="btn btn-sm" disabled={page * 50 >= data.data.total} onClick={() => setPage(page + 1)}>Next</button></div>}
      {importing && <DtcImport onClose={() => setImporting(false)} onDone={() => { setImporting(false); load(q, filter, page); }} />}
      {editing && <ResourceForm resourceKey={resourceKey} id={editing.id} initial={editing.initial} me={me} onClose={close} onSaved={() => { close(); load(q, filter, page); }} />}
    </div>
  );
}

function blank(res: Resource, initial: Row = {}): Row {
  const out: Row = {};
  for (const f of res.fields) {
    const def = f.def === 'today' ? new Date().toISOString().slice(0, 10) : f.def;
    out[f.key] = initial[f.key] ?? (['list', 'rows', 'sections', 'weekdays', 'slotset', 'months', 'multiselect'].includes(f.type) ? (f.type === 'multiselect' && def ? [def] : []) : def ?? (f.type === 'bool' ? false : ''));
  }
  return out;
}

/** Convert form state to API values (money in pence). */
function toApi(res: Resource, form: Row): Row {
  const out: Row = {};
  for (const f of res.fields) {
    let v = form[f.key];
    if (f.type === 'money') v = v === '' || v == null ? null : toMinor(String(v));
    if (f.type === 'rows') v = (v as Row[]).map((r) => Object.fromEntries((f.columns ?? []).map((c) => [c.key, c.type === 'money' ? (r[c.key] === '' || r[c.key] == null ? null : toMinor(String(r[c.key]))) : r[c.key]])));
    out[f.key] = v;
  }
  return out;
}
function fromApi(res: Resource, row: Row): Row {
  const out: Row = { ...row };
  for (const f of res.fields) {
    if (f.type === 'money') out[f.key] = row[f.key] == null ? '' : moneyInputValue(Number(row[f.key]));
    if (f.type === 'rows') out[f.key] = ((row[f.key] as Row[]) ?? []).map((r) => Object.fromEntries((f.columns ?? []).map((c) => [c.key, c.type === 'money' ? (r[c.key] == null ? '' : moneyInputValue(Number(r[c.key]))) : r[c.key] ?? ''])));
    if (f.type === 'bool') out[f.key] = !!row[f.key];
  }
  return out;
}

export function ResourceForm({ resourceKey, id, initial, me, onClose, onSaved }: { resourceKey: string; id?: string | null; initial?: Row; me: Me; onClose: () => void; onSaved: () => void }) {
  const res = RESOURCE_MAP[resourceKey]!;
  const [form, setForm] = useState<Row | null>(id ? null : blank(res, initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, act] = useAction();
  const writable = can(me, res.write);
  const hidden = can(me, 'finance.read') ? [] : res.financeFields ?? [];
  useEffect(() => {
    if (id) get<{ row: Row }>(`/r/${resourceKey}/${encodeURIComponent(id)}`).then((r) => setForm(fromApi(res, r.data.row))).catch(() => onClose());
  }, [id]);
  const set = (key: string, v: unknown) => setForm((f) => ({ ...f!, [key]: v }));

  async function save() {
    setErrors({});
    try {
      const body = toApi(res, form!);
      if (id) await send(`/r/${resourceKey}/${encodeURIComponent(id)}`, body, 'PATCH');
      else await send(`/r/${resourceKey}`, body);
      toast(`${res.singular[0]!.toUpperCase()}${res.singular.slice(1)} saved`);
      onSaved();
    } catch (e) {
      const fields = (e as { fields?: Record<string, string> }).fields ?? {};
      setErrors(fields);
      toast((e as Error).message, { icon: 'alert', title: 'Not saved' });
    }
  }

  const extra = id && form ? <ExtraActions resourceKey={resourceKey} id={id} row={form} /> : null;
  return (
    <Drawer title={`${id ? 'Edit' : 'New'} ${res.singular}`} onClose={onClose} footer={writable && form ? (
      <>
        {id && <button class="btn btn-ghost" style="color:var(--bad);margin-right:auto" type="button" disabled={busy} onClick={async () => { if (confirm(`Delete this ${res.singular}? This cannot be undone.`) && (await act(() => del(`/r/${resourceKey}/${encodeURIComponent(id)}`), 'Deleted'))) onSaved(); }}><Icon name="trash" /> Delete</button>}
        <button class="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
        <button class="btn btn-primary" type="button" disabled={busy} onClick={save}>Save</button>
      </>
    ) : undefined}>
      {!form ? <div class="skeleton" style="height:300px" /> : (
        <>
          {extra}
          {res.fields.filter((f) => !hidden.includes(f.key)).map((f) => (
            <FieldInput f={f} value={form[f.key]} onChange={(v) => set(f.key, v)} disabled={!writable || (!!id && !!f.lockOnEdit)} error={errors[f.key]} resourceKey={resourceKey} />
          ))}
        </>
      )}
    </Drawer>
  );
}

function ExtraActions({ resourceKey, id, row }: { resourceKey: string; id: string; row: Row }) {
  const [busy, act] = useAction();
  if (resourceKey === 'battery_tests') return <a class="btn" href={`/docs/battery/${id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /> Battery health certificate PDF</a>;
  if (resourceKey === 'parts_requests') {
    return (
      <div class="row">
        <a class="btn" href={`/docs/parts/${id}.pdf`} target="_blank" rel="noopener"><Icon name="file" /> PDF</a>
        <button class="btn btn-primary" type="button" disabled={busy} onClick={async () => {
          const r = await act(() => send<{ sentBy: string; whatsapp: string; text: string }>(`/parts-requests/${id}/send`));
          if (!r) return;
          if (r.sentBy) toast(`Emailed to ${String(row.supplier_contact)}`);
          else if (r.whatsapp) window.open(r.whatsapp, '_blank');
          else {
            await navigator.clipboard?.writeText(r.text);
            toast('Request copied — paste it to your supplier', { icon: 'info' });
          }
        }}>Send to supplier</button>
      </div>
    );
  }
  if (resourceKey === 'webhooks') return <button class="btn" type="button" disabled={busy} onClick={async () => { const r = await act(() => send<{ ok: boolean; status: number }>(`/webhooks/${id}/test`)); if (r) toast(r.ok ? `Delivered (HTTP ${r.status})` : `Failed (HTTP ${r.status || 'no response'})`, { icon: r.ok ? 'check' : 'alert' }); }}>Send test event</button>;
  if (resourceKey === 'reviews') return <button class="btn" type="button" disabled={busy} onClick={async () => { const r = await act(() => send<{ sentiment: { label: string; summary: string; followUp: string } }>(`/reviews/${id}/analyse`)); if (r) toast(`${r.sentiment.label}: ${r.sentiment.summary}${r.sentiment.followUp ? ` — ${r.sentiment.followUp}` : ''}`, { timeout: 9000, icon: 'info' }); }}><Icon name="sparkle" /> Analyse sentiment</button>;
  if (resourceKey === 'fleet_portals') return <a class="btn" href={`/fleet/${id}`} target="_blank" rel="noopener"><Icon name="external" /> Open portal</a>;
  if (resourceKey === 'towns') return <a class="btn" href={`/${id}`} target="_blank" rel="noopener"><Icon name="external" /> View page</a>;
  if (resourceKey === 'guides') return <a class="btn" href={`/guides/${id}`} target="_blank" rel="noopener"><Icon name="external" /> View guide</a>;
  if (resourceKey === 'pages') return <a class="btn" href={`/${id}`} target="_blank" rel="noopener"><Icon name="external" /> View page</a>;
  if (resourceKey === 'packages' && row.slug) return <a class="btn" href={`/services/${row.slug}`} target="_blank" rel="noopener"><Icon name="external" /> View service page</a>;
  if (resourceKey === 'flyers') {
    const url = `${location.origin}/flyer/${id}`;
    return (
      <div class="row">
        <a class="btn btn-primary" href={`/flyer/${id}`} target="_blank" rel="noopener"><Icon name="eye" /> Open flyer</a>
        <a class="btn" href={`/flyer/${id}/pdf`} target="_blank" rel="noopener"><Icon name="download" /> Print PDF</a>
        <button class="btn" type="button" onClick={async () => { try { if (navigator.share) await navigator.share({ title: String(row.title ?? 'Flyer'), url }); else { await navigator.clipboard.writeText(url); toast('Flyer link copied'); } } catch { /* closed */ } }}><Icon name="share" /> Share link</button>
      </div>
    );
  }
  if (resourceKey === 'partners') {
    const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toISOString().slice(0, 7); });
    return (
      <div class="stack" style="gap:8px">
        <span class="label">Monthly statement</span>
        <div class="chip-row">{months.map((m) => <a class="chip" href={`/api/admin/partners/${id}/statement.pdf?month=${m}`} target="_blank" rel="noopener"><Icon name="file" /> {new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</a>)}</div>
        {row.trade_status === 'applied' && <span class="hint">This is a trade application — approve it from the dashboard to send the trade code.</span>}
      </div>
    );
  }
  return null;
}

function FieldInput({ f, value, onChange, disabled, error, resourceKey }: { f: Field; value: unknown; onChange: (v: unknown) => void; disabled: boolean; error?: string; resourceKey: string }) {
  const id = `f-${f.key}`;
  const label = <label for={id}>{f.label}{f.required ? ' *' : ''}</label>;
  const foot = <>{f.help && <span class="hint">{f.help}</span>}{error && <span class="error">{error}</span>}</>;
  const str = value == null ? '' : String(value);
  const input = (type: 'text' | 'date' | 'url' | 'email' | 'tel', extra: Record<string, unknown> = {}) => {
    const props = { class: `input${f.type === 'money' || f.type === 'number' || f.type === 'int' ? ' mono' : ''}`, id, type, value: str, disabled, placeholder: f.placeholder, 'aria-invalid': !!error, onInput: (e: Event) => onChange(f.upper ? (e.target as HTMLInputElement).value.toUpperCase() : (e.target as HTMLInputElement).value), ...extra } as unknown as InputHTMLAttributes<HTMLInputElement>;
    return <input {...props} />;
  };

  switch (f.type) {
    case 'bool':
      return <label class="check"><input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} /><span>{f.label}{f.help && <span class="hint" style="display:block">{f.help}</span>}</span></label>;
    case 'textarea':
      return <div class="field">{label}<textarea class="textarea" id={id} value={str} disabled={disabled} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} />{foot}</div>;
    case 'markdown':
      return <div class="field">{label}<textarea class="textarea" id={id} style="min-height:240px;font-family:var(--font-mono);font-size:.86rem" value={str} disabled={disabled} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value)} />{foot}</div>;
    case 'int': case 'number': case 'percent':
      return <div class="field">{label}{input('text', { inputMode: f.type === 'int' || f.type === 'percent' ? 'numeric' : 'decimal' })}{foot}</div>;
    case 'money':
      return <div class="field">{label}<div class="input-group"><span class="btn btn-ghost" style="pointer-events:none;padding:0 10px">£</span>{input('text', { inputMode: 'decimal' })}</div>{foot}</div>;
    case 'date':
      return <div class="field">{label}{input('date')}{foot}</div>;
    case 'color':
      return <div class="field">{label}<div class="row" style="flex-wrap:nowrap"><input type="color" value={str || '#e11d48'} disabled={disabled} onInput={(e) => onChange((e.target as HTMLInputElement).value)} style="width:52px;height:44px;border:0;background:none" />{input('text')}</div>{foot}</div>;
    case 'url': return <div class="field">{label}{input('url')}{foot}</div>;
    case 'email': return <div class="field">{label}{input('email')}{foot}</div>;
    case 'tel': return <div class="field">{label}{input('tel')}{foot}</div>;
    case 'select':
      return <div class="field">{label}<select class="select" id={id} value={str} disabled={disabled} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>{!f.required && <option value="">—</option>}{(f.options ?? []).map((o) => <option value={optionValue(o)}>{optionLabel(o)}</option>)}</select>{foot}</div>;
    case 'list':
      return <div class="field">{label}<textarea class="textarea" id={id} value={((value as string[]) ?? []).join('\n')} disabled={disabled} onInput={(e) => onChange((e.target as HTMLTextAreaElement).value.split('\n'))} />{foot}</div>;
    case 'multiselect': case 'weekdays': case 'months': case 'slotset': {
      if (f.optionsFrom) return <LiveMultiselect f={f} value={(value as string[]) ?? []} onChange={onChange} disabled={disabled} foot={foot} />;
      const opts: [string | number, string][] = f.type === 'weekdays' ? DAYS.map((d, i) => [i, d]) : f.type === 'months' ? MONTHS.map((m, i) => [i + 1, m]) : f.type === 'slotset' ? SLOT_ORDER.map((s) => [s, SLOTS[s].label]) : (f.options ?? []).map((o) => [optionValue(o), optionLabel(o)]);
      const cur = (value as (string | number)[]) ?? [];
      return <div class="field"><span class="label">{f.label}</span><div class="chip-row">{opts.map(([v, l]) => <button type="button" class="chip" disabled={disabled} aria-pressed={cur.includes(v)} onClick={() => onChange(cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v])}>{l}</button>)}</div>{foot}</div>;
    }
    case 'rows': {
      const rows = (value as Row[]) ?? [];
      const cols = f.columns ?? [];
      const tmpl = cols.map((c) => `${c.width ?? 1}fr`).join(' ') + ' 36px';
      return (
        <div class="field"><span class="label">{f.label}</span>
          <div class="rows-editor">
            <div class="r faint" style={{ gridTemplateColumns: tmpl, fontSize: '.72rem' }}>{cols.map((c) => <span>{c.label}</span>)}<span /></div>
            {rows.map((r, i) => (
              <div class="r" style={{ gridTemplateColumns: tmpl }}>
                {cols.map((c) => <input class={`input${c.type ? ' mono' : ''}`} value={String(r[c.key] ?? '')} disabled={disabled} inputMode={c.type ? 'decimal' : undefined} onInput={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, [c.key]: (e.target as HTMLInputElement).value } : x)))} />)}
                <button class="btn btn-icon btn-ghost btn-sm" type="button" disabled={disabled} aria-label="Remove row" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="x" /></button>
              </div>
            ))}
            {!disabled && <button class="btn btn-sm btn-ghost" style="justify-self:start" type="button" onClick={() => onChange([...rows, Object.fromEntries(cols.map((c) => [c.key, '']))])}><Icon name="plus" /> Add row</button>}
          </div>{foot}</div>
      );
    }
    case 'sections': {
      const sections = (value as { title: string; items: string[] }[]) ?? [];
      const text = sections.map((s) => `# ${s.title}\n${s.items.join('\n')}`).join('\n\n');
      return <div class="field">{label}<textarea class="textarea" id={id} style="min-height:280px;font-family:var(--font-mono);font-size:.84rem" value={text} disabled={disabled}
        onChange={(e) => {
          const out: { title: string; items: string[] }[] = [];
          for (const line of (e.target as HTMLTextAreaElement).value.split('\n')) {
            const t = line.trim();
            if (!t) continue;
            if (t.startsWith('#')) out.push({ title: t.replace(/^#+\s*/, ''), items: [] });
            else (out.at(-1) ?? (out.push({ title: 'Checks', items: [] }), out.at(-1)!)).items.push(t.replace(/^[-*]\s*/, ''));
          }
          onChange(out);
        }} />{foot}</div>;
    }
    case 'media':
      return <MediaField f={f} value={value as number | null} onChange={onChange} disabled={disabled} resourceKey={resourceKey} />;
    default:
      return <div class="field">{label}{input('text')}{foot}</div>;
  }
}

const liveOptions = new Map<string, Promise<[string, string][]>>();
/** Chips whose options come from another resource (e.g. packages for a flyer), in display order. */
function LiveMultiselect({ f, value, onChange, disabled, foot }: { f: Field; value: string[]; onChange: (v: unknown) => void; disabled: boolean; foot: ComponentChildren }) {
  const [opts, setOpts] = useState<[string, string][] | null>(null);
  useEffect(() => {
    const key = f.optionsFrom!;
    if (!liveOptions.has(key)) liveOptions.set(key, get<{ rows: Row[] }>(`/r/${key}?size=200`).then((r) => r.data.rows.map((x) => [String(x.slug), String(x.name)] as [string, string])).catch(() => []));
    void liveOptions.get(key)!.then(setOpts);
  }, [f.optionsFrom]);
  return (
    <div class="field"><span class="label">{f.label}</span>
      {!opts ? <div class="skeleton" style="height:36px" /> : <div class="chip-row">{opts.map(([v, l]) => <button type="button" class="chip" disabled={disabled} aria-pressed={value.includes(v)} onClick={() => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])}>{l}</button>)}</div>}
      {foot}
    </div>
  );
}

function MediaField({ f, value, onChange, disabled, resourceKey }: { f: Field; value: number | null; onChange: (v: unknown) => void; disabled: boolean; resourceKey: string }) {
  const [preview, setPreview] = useState<{ url: string; contentType: string } | null>(null);
  const [busy, act] = useAction();
  useEffect(() => {
    if (value) get<{ url: string; contentType: string }>(`/media/${value}`).then((r) => setPreview(r.data)).catch(() => setPreview(null));
    else setPreview(null);
  }, [value]);
  const kind = resourceKey === 'wiring_refs' ? 'wiring' : resourceKey === 'fleet_portals' ? 'portal' : 'gallery';
  return (
    <div class="field"><span class="label">{f.label}</span>
      <div class="media-pick">
        {preview && (preview.contentType.startsWith('video/') ? <video src={preview.url} muted /> : <img src={preview.url} alt="" />)}
        {!disabled && <label class="btn btn-sm"><Icon name="camera" /> {value ? 'Replace' : 'Upload'}<input type="file" accept={f.accept ?? 'image/*'} hidden onChange={async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          if (!file) return;
          const isVideo = file.type.startsWith('video/');
          const blob = isVideo ? file : await compressImage(file, 2400, 0.85);
          const r = await act(() => upload('/media', blob, { kind }, isVideo ? file.name : 'image.jpg'));
          if (r) onChange(r.id);
        }} /></label>}
        {busy && <span class="spinner" />}
        {value && !disabled && <button class="btn btn-sm btn-ghost" type="button" onClick={() => onChange(null)}>Remove</button>}
      </div>
      {f.help && <span class="hint">{f.help}</span>}
    </div>
  );
}

/** Paste fault codes from a spreadsheet: code, title, system, causes, how we fix it, severity. */
function DtcImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [busy, act] = useAction();
  const [result, setResult] = useState<{ added: number; updated: number; skipped: string[]; skippedCount: number } | null>(null);
  return (
    <Modal title="Import fault codes" onClose={onClose} wide>
      <div class="stack" style="gap:10px">
        <p class="muted" style="margin:0">Paste rows from Excel, Google Sheets or a CSV file — one code per line, in this column order:</p>
        <code class="mono" style="display:block;padding:8px 10px;border-radius:8px;background:var(--surface-2);font-size:.8rem">code, title, system, likely causes, how we pinpoint it, severity (info / amber / red)</code>
        <p class="faint" style="margin:0;font-size:.82rem">Only code and title are required. Existing codes are updated; blank columns keep what is already there.</p>
        <textarea class="textarea mono" style="min-height:220px;font-size:.82rem" placeholder={'P0128, Coolant thermostat below regulating temperature, Cooling, Thermostat stuck open, Graph warm-up time, amber'} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
        {result && <div class="alert alert-good"><Icon name="check" /><span>{result.added} added, {result.updated} updated{result.skippedCount ? `, ${result.skippedCount} skipped (not a valid code or missing a title${result.skipped.length ? `: ${result.skipped.slice(0, 3).join(' · ')}` : ''})` : ''}.</span></div>}
        <div class="row">
          <button class="btn btn-primary" type="button" disabled={busy || !text.trim()} onClick={async () => { const r = await act(() => send<{ added: number; updated: number; skipped: string[]; skippedCount: number }>('/dtc/import', { text })); if (r) { setResult(r); if (!r.skippedCount) setTimeout(onDone, 900); } }}>Import</button>
          <button class="btn btn-ghost" type="button" onClick={result ? onDone : onClose}>{result ? 'Done' : 'Cancel'}</button>
        </div>
      </div>
    </Modal>
  );
}
