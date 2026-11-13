// Technical library (#31, #34, #36, #37, #43–#45) and the checklist runner (#35, #40, #41).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatReg } from '../../../shared/format';
import { compressImage } from '../../lib/api';
import { debounce, esc, toast } from '../../lib/ui';
import { get, send, upload } from '../api';
import { can, go, hashQuery, type Me } from '../main';
import { Empty, Icon, Modal, PageTitle, Stale, useAction } from '../ui';

/** Tiny safe markdown renderer for procedure bodies (escape first, then format). */
export function md(src: string): string {
  return src.replace(/\r/g, '').split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').filter((l) => l.trim());
    const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (lines.every((l) => /^\d+[.)]\s/.test(l.trim()))) return `<ol>${lines.map((l) => `<li>${inline(l.trim().replace(/^\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`;
    if (lines.every((l) => /^[-*]\s/.test(l.trim()))) return `<ul>${lines.map((l) => `<li>${inline(l.trim().slice(2))}</li>`).join('')}</ul>`;
    return lines.map((l) => (/^#{2,3}\s/.test(l) ? `<h3>${inline(l.replace(/^#+\s+/, ''))}</h3>` : /^\d+[.)]\s/.test(l.trim()) ? `<ol><li>${inline(l.trim().replace(/^\d+[.)]\s+/, ''))}</li></ol>` : /^[-*]\s/.test(l.trim()) ? `<ul><li>${inline(l.trim().slice(2))}</li></ul>` : `<p>${inline(l)}</p>`)).join('');
  }).join('');
}

interface Results {
  dtc: { code: string; title: string; system: string; severity: string; causes: string; fixes: string }[];
  coding: { id: number; make_group: string; platform: string; feature: string; module: string; parameter: string; tool: string; notes: string }[];
  torque: { id: number; make_model: string; wheel_nm: string; caliper_nm: string; sump_nm: string; notes: string }[];
  wiring: { id: number; make_model: string; title: string; detail: string; url: string }[];
  guides: { id: number; title: string; category: string; applies_to: string }[];
}

export function LibraryView({ me }: { me: Me }) {
  const [q, setQ] = useState('');
  const [r, setR] = useState<Results | null>(null);
  const [guides, setGuides] = useState<{ id: number; title: string; category: string; applies_to: string; body: string }[]>([]);
  const [open, setOpen] = useState<{ title: string; body: string } | null>(null);
  const [busy, act] = useAction();
  const search = useMemo(() => debounce((term: string) => {
    if (term.trim().length < 2) return setR(null);
    get<Results>(`/library/search?q=${encodeURIComponent(term)}`).then((x) => setR(x.data)).catch(() => undefined);
  }, 200), []);
  useEffect(() => {
    get<{ rows: { id: number; title: string; category: string; applies_to: string; body: string }[] }>('/r/tech_guides?size=100').then((x) => setGuides(x.data.rows)).catch(() => undefined);
    if (hashQuery().get('packing') === '1') void startPacking();
  }, []);
  async function startPacking() {
    const t = await get<{ templates: { id: number; kind: string }[] }>('/checklists/templates').catch(() => null);
    const packing = t?.data.templates.find((x) => x.kind === 'packing');
    if (!packing) return toast('No packing checklist template found.', { icon: 'alert' });
    const run = await act(() => send<{ id: number }>('/checklists/runs', { templateId: packing.id }));
    if (run) go(`checklist/${run.id}`);
  }
  const sev = (s: string) => (s === 'red' ? 'badge-bad' : s === 'amber' ? 'badge-warn' : 'badge-info');
  return (
    <div class="stack" style="gap:16px">
      <PageTitle title="Tech library" sub="Fault codes, coding parameters, torque settings, pinouts and procedures — searchable on the driveway.">
        {can(me, 'tech.write') && <button class="btn" type="button" disabled={busy} onClick={startPacking}><Icon name="clipboard" /> Packing checklist</button>}
      </PageTitle>
      <div class="dtc-search"><Icon name="search" /><input class="input" placeholder="Search P0299, CarPlay, Transit torque, gateway, EPB…" value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); search((e.target as HTMLInputElement).value); }} autoFocus /></div>
      {r && (
        <div class="stack" style="gap:14px">
          {r.dtc.length > 0 && <div class="panel"><h3 style="margin-bottom:10px">Fault codes</h3>{r.dtc.map((d) => <details style="padding:8px 0;border-bottom:1px solid var(--line)"><summary style="cursor:pointer;display:flex;gap:10px;align-items:center"><span class="dtc-code mono">{d.code}</span><span style="flex:1">{d.title}</span><span class={`badge ${sev(d.severity)}`}>{d.system}</span></summary><p style="margin:10px 0 4px"><b>Causes:</b> {d.causes}</p><p style="margin:0"><b>Route:</b> {d.fixes}</p></details>)}</div>}
          {r.coding.length > 0 && <div class="panel"><h3 style="margin-bottom:10px">Coding</h3><div class="dtable-wrap"><table class="dtable"><thead><tr><th>Make</th><th>Feature</th><th>Module</th><th>Parameter</th><th>Tool</th></tr></thead><tbody>{r.coding.map((c) => <tr onClick={() => go(`r/coding_matrix/${c.id}`)}><td>{c.make_group}<br /><span class="faint">{c.platform}</span></td><td>{c.feature}</td><td>{c.module}</td><td class="mono">{c.parameter || '—'}</td><td>{c.tool}</td></tr>)}</tbody></table></div></div>}
          {r.torque.length > 0 && <div class="panel"><h3 style="margin-bottom:10px">Torque</h3><div class="dtable-wrap"><table class="dtable"><thead><tr><th>Vehicle</th><th class="num">Wheels</th><th class="num">Caliper</th><th class="num">Sump</th></tr></thead><tbody>{r.torque.map((t) => <tr onClick={() => go(`r/torque_specs/${t.id}`)}><td>{t.make_model}</td><td class="num">{t.wheel_nm}</td><td class="num">{t.caliper_nm}</td><td class="num">{t.sump_nm}</td></tr>)}</tbody></table></div><p class="faint" style="font-size:.8rem;margin:8px 0 0">Always confirm against OEM data for the exact model year and wheel type.</p></div>}
          {r.wiring.length > 0 && <div class="panel"><h3 style="margin-bottom:10px">Wiring &amp; pinouts</h3>{r.wiring.map((w) => <div class="list-row"><span class="grow" style="white-space:normal"><b>{w.make_model} · {w.title}</b><span style="white-space:normal">{w.detail}</span></span>{w.url && <a class="btn btn-sm" href={w.url} target="_blank" rel="noopener"><Icon name="external" /></a>}</div>)}</div>}
          {r.guides.length > 0 && <div class="panel"><h3 style="margin-bottom:10px">Procedures</h3>{r.guides.map((g) => <button class="list-row" type="button" style="width:100%;background:none;border:0;text-align:left;border-bottom:1px solid var(--line)" onClick={() => { const full = guides.find((x) => x.id === g.id); if (full) setOpen({ title: full.title, body: full.body }); }}><span class="grow"><b>{g.title}</b><span>{g.applies_to}</span></span><Icon name="arrow" /></button>)}</div>}
          {!r.dtc.length && !r.coding.length && !r.torque.length && !r.wiring.length && !r.guides.length && <Empty icon="search">No matches for “{q}”.</Empty>}
        </div>
      )}
      {!r && (
        <>
          <div class="grid grid-3">{guides.map((g) => <button type="button" class="card card-link stack" style="text-align:left;gap:6px" onClick={() => setOpen({ title: g.title, body: g.body })}><span class="badge badge-accent" style="align-self:flex-start">{g.category.replace('_', ' ')}</span><b>{g.title}</b><span class="muted" style="font-size:.86rem">{g.applies_to}</span></button>)}</div>
          <div class="chip-row">{[['dtc_codes', 'Fault codes'], ['coding_matrix', 'Coding matrix'], ['torque_specs', 'Torque specs'], ['wiring_refs', 'Wiring & pinouts'], ['tech_guides', 'Procedures'], ['licences', 'Licences & tokens'], ['checklist_templates', 'Checklist templates']].map(([k, l]) => <a class="chip" href={`#/r/${k}`}>{l}</a>)}</div>
        </>
      )}
      {open && <Modal wide title={open.title} onClose={() => setOpen(null)}><div class="prose" dangerouslySetInnerHTML={{ __html: md(open.body) }} /></Modal>}
    </div>
  );
}

interface RunData {
  run: { id: number; kind: string; booking_id: number | null; reg: string; results: Record<string, { status: string; note: string }>; summary: string; status: string; score: number | null; max_score: number | null };
  template: { name: string; kind: string; sections: { title: string; items: string[] }[] };
  photos: { id: number; url: string; label: string }[];
}

export function ChecklistView({ runId, me }: { runId: number; me: Me }) {
  const [res, setRes] = useState<{ data: RunData; stale: boolean; at: number } | null>(null);
  const [results, setResults] = useState<Record<string, { status: string; note: string }>>({});
  const [summary, setSummary] = useState('');
  const [photos, setPhotos] = useState<RunData['photos']>([]);
  const [busy, act] = useAction();
  useEffect(() => {
    get<RunData>(`/checklists/runs/${runId}`).then((r) => {
      setRes(r);
      setResults(r.data.run.results ?? {});
      setSummary(r.data.run.summary ?? '');
      setPhotos(r.data.photos);
    }).catch(() => undefined);
  }, [runId]);
  if (!res) return <div class="skeleton" style="height:400px" />;
  const { run, template } = res.data;
  const total = template.sections.reduce((s, sec) => s + sec.items.length, 0);
  const answered = Object.values(results).filter((r) => r.status).length;
  const editable = can(me, 'tech.write') && run.status !== 'completed';
  const isPacking = template.kind === 'packing';
  const options: [string, string][] = isPacking ? [['pass', 'Packed'], ['na', 'N/A']] : [['pass', 'Pass'], ['advisory', 'Advise'], ['fail', 'Fail'], ['na', 'N/A']];
  const set = (key: string, patch: Partial<{ status: string; note: string }>) => setResults((r) => ({ ...r, [key]: { ...{ status: '', note: '' }, ...r[key], ...patch } }));
  const save = (complete: boolean) => act(() => send(`/checklists/runs/${runId}`, { results, summary, complete }, 'PUT', { queueable: !complete }), complete ? 'Checklist completed' : 'Progress saved');
  return (
    <div class="stack" style="gap:16px">
      <PageTitle title={template.name} sub={<>{run.reg ? <span class="mono">{formatReg(run.reg)}</span> : null} {run.booking_id ? <a href={`#/bookings/${run.booking_id}`}>· back to job</a> : null}</>}>
        {run.status === 'completed' && !isPacking && <a class="btn" href={`/docs/checklist/${runId}.pdf`} target="_blank" rel="noopener"><Icon name="file" /> PDF report</a>}
      </PageTitle>
      <Stale stale={res.stale} at={res.at} />
      <div class="panel"><div class="spread" style="margin-bottom:8px"><span class="mono">{answered}/{total} checked</span>{run.status === 'completed' && <span class="badge badge-good">Completed · {run.score}/{run.max_score}</span>}</div><div class="progress-bar"><span style={{ width: `${(answered / Math.max(1, total)) * 100}%` }} /></div></div>
      {template.sections.map((sec, si) => (
        <div class="panel">
          <h3 style="margin-bottom:4px">{sec.title}</h3>
          {sec.items.map((item, ii) => {
            const key = `${si}.${ii}`;
            const r = results[key] ?? { status: '', note: '' };
            const itemPhotos = photos.filter((p) => p.label === `checklist:${runId}:${key}`);
            return (
              <div class="check-item">
                <span>{item}</span>
                <span class="tri">{options.map(([v, l]) => <button type="button" class={v} aria-pressed={r.status === v} disabled={!editable} onClick={() => set(key, { status: r.status === v ? '' : v })}>{l}</button>)}</span>
                {!isPacking && (r.status === 'advisory' || r.status === 'fail' || r.note || itemPhotos.length > 0) && (
                  <div class="note row" style="flex-wrap:nowrap">
                    <input class="input" style="min-height:38px;font-size:.88rem" placeholder="Note (shown on the report)" value={r.note} disabled={!editable} onInput={(e) => set(key, { note: (e.target as HTMLInputElement).value })} />
                    {editable && <label class="btn btn-sm btn-icon" title="Add photo"><Icon name="camera" /><input type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (!file) return;
                      const blob = await compressImage(file);
                      const up = await act(() => upload(`/checklists/runs/${runId}/photo`, blob, { item: key }));
                      if (up) setPhotos((p) => [...p, { id: up.id, url: up.url, label: `checklist:${runId}:${key}` }]);
                    }} /></label>}
                    {itemPhotos.map((p) => <a href={p.url} target="_blank" rel="noopener"><img src={p.url} alt="" style="width:38px;height:38px;object-fit:cover;border-radius:8px" /></a>)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      {!isPacking && <div class="panel stack"><h3>Summary for the report</h3><textarea class="textarea" disabled={!editable} value={summary} onInput={(e) => setSummary((e.target as HTMLTextAreaElement).value)} placeholder="Overall verdict and key advice for the customer or buyer." /></div>}
      {editable && <div class="row"><button class="btn" type="button" disabled={busy} onClick={() => save(false)}>Save progress</button><button class="btn btn-primary" type="button" disabled={busy || answered === 0} onClick={async () => { if (await save(true)) location.reload(); }}>Complete{isPacking ? ' — ready to go' : ' & create report'}</button></div>}
    </div>
  );
}
