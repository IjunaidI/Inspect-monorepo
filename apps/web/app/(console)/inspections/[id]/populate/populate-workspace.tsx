'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import { Check, ChevronRight, ClipboardList, Eye, Lock, MoreVertical, Plus, Upload, X } from 'lucide-react';
import { Btn, Mono, RoleBadge, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';
import type { ApiInspection, ApiDefectCatalogItem, ApiInspectionLoop } from '@/lib/api';
import { presignPhoto, registerPhoto, addDefect, addMeasurement } from './actions';
import { submitInspection } from '../../actions';

const fieldLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: ui.sub,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

function CompactUnverified() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 20, padding: '0 7px', borderRadius: 5, fontSize: 10, fontWeight: 600, background: severity.major.bg, color: severity.major.fg }}>
      <Upload size={10} /> Unverified
    </span>
  );
}

async function uploadBytesToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface MeasurementRow {
  id?: string;
  label: string;
  recordedValue: string;
  unit: string;
  isNew?: boolean;
}

export function PopulateWorkspace({
  inspection,
  catalog,
}: {
  inspection: ApiInspection;
  catalog: ApiDefectCatalogItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingError, setPendingError] = useState<string>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loops: ApiInspectionLoop[] = inspection.loops
    ? [...inspection.loops].sort((a, b) => a.orderIndex - b.orderIndex)
    : [];

  const [activeLoopId, setActiveLoopId] = useState<string>(loops[0]?.id ?? '');
  const [customDefectSev, setCustomDefectSev] = useState<SeverityKey | null>(null);
  const [customDefectText, setCustomDefectText] = useState('');
  const [extraMeasurements, setExtraMeasurements] = useState<MeasurementRow[]>([]);

  const activeLoop = loops.find((l) => l.id === activeLoopId) ?? loops[0];

  const totalRequired = loops.reduce((s, l) => s + (l.requiredPhotoCount ?? 0), 0);
  const totalFilled = loops.reduce((s, l) => s + (l.photos?.length ?? 0), 0);
  const progressPct = totalRequired > 0 ? Math.round((totalFilled / totalRequired) * 100) : 0;

  function handleLoopSelect(id: string) {
    setActiveLoopId(id);
    setPendingError(undefined);
  }

  async function handlePhotoUpload(file: File) {
    startTransition(async () => {
      setPendingError(undefined);
      const presign = await presignPhoto(inspection.id);
      if (presign.error) { setPendingError(presign.error); return; }

      try {
        await uploadBytesToPresignedUrl(presign.data!.uploadUrl, file);
      } catch (e) {
        setPendingError(`Storage upload failed (MinIO not running — INS-023): ${String(e)}`);
      }

      const hash = await sha256Hex(file);
      const reg = await registerPhoto(inspection.id, {
        storageKey: presign.data!.storageKey,
        contentHash: hash,
        inspectionLoopId: activeLoopId || undefined,
        clientRequestId: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      if (reg.error) { setPendingError((prev) => [prev, reg.error].filter(Boolean).join(' | ')); return; }
      router.refresh();
    });
  }

  async function handleDefectToggle(item: ApiDefectCatalogItem, currentlyOn: boolean) {
    if (currentlyOn) return;
    startTransition(async () => {
      const r = await addDefect(inspection.id, {
        defectCatalogId: item.id,
        severity: item.severity,
        inspectionLoopId: activeLoopId || undefined,
      });
      if (r.error) setPendingError(r.error);
      else router.refresh();
    });
  }

  async function handleCustomDefect() {
    if (!customDefectText.trim() || !customDefectSev) return;
    const text = customDefectText.trim();
    const sev = customDefectSev;
    setCustomDefectText('');
    setCustomDefectSev(null);
    startTransition(async () => {
      const r = await addDefect(inspection.id, {
        customText: text,
        severity: sev.toUpperCase() as 'CRITICAL' | 'MAJOR' | 'MINOR',
        inspectionLoopId: activeLoopId || undefined,
      });
      if (r.error) setPendingError(r.error);
      else router.refresh();
    });
  }

  async function handleMeasurementSave(label: string, value: string, unit: string, loopId: string) {
    if (!label.trim() || !value.trim()) return;
    startTransition(async () => {
      const r = await addMeasurement(inspection.id, {
        inspectionLoopId: loopId,
        label,
        recordedValue: value,
        unit,
      });
      if (r.error) setPendingError(r.error);
      else {
        setExtraMeasurements((prev) => prev.filter((m) => !(m.isNew && m.label === label)));
        router.refresh();
      }
    });
  }

  async function handleSubmit() {
    startTransition(async () => {
      const r = await submitInspection(inspection.id);
      if (r.error) setPendingError(r.error);
      else router.push(`/inspections/${inspection.id}/review`);
    });
  }

  const SEVS: SeverityKey[] = ['critical', 'major', 'minor'];

  const catalogBySev = (sev: SeverityKey) =>
    catalog.filter((c) => c.severity === sev.toUpperCase());

  const activeDefectIds = new Set(
    (activeLoop?.defects ?? []).map((d) => d.defectCatalog?.id).filter(Boolean),
  );

  const poLabel = inspection.purchaseOrder?.poNumber ?? inspection.id.slice(0, 8);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handlePhotoUpload(file);
          e.target.value = '';
        }}
      />

      <header style={{ height: 56, borderBottom: `1px solid ${ui.line}`, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13 }}>
          <ClipboardList size={15} color={ui.sub} />
          <span>Inspections</span>
          <ChevronRight size={14} color={ui.faint} />
          <Mono style={{ color: ui.ink, fontWeight: 600 }}>{poLabel}</Mono>
          <ChevronRight size={14} color={ui.faint} />
          <span style={{ color: ui.ink, fontWeight: 550 }}>Populate</span>
        </div>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 24, padding: '0 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 600, background: ui.accentSoft, color: ui.accent }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: ui.accent }} /> {inspection.status}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {pendingError && (
            <span style={{ fontSize: 11.5, color: severity.critical.fg, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pendingError}>
              {pendingError}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: ui.faint }}>
            <Lock size={13} color={ui.faint} /> Upload limited to <RoleBadge role="platform" />
          </span>
          <Btn
            kind="primary"
            icon={<Check size={15} />}
            onClick={isPending ? undefined : handleSubmit}
            style={{ opacity: isPending ? 0.65 : 1 }}
          >
            {isPending ? 'Working…' : 'Submit for review'}
          </Btn>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Loop sidebar */}
        <div style={{ width: 300, background: '#fff', borderRight: `1px solid ${ui.line}`, padding: '20px 16px', overflow: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {inspection.product?.styleNumber ?? '—'}
          </div>
          <div style={{ fontSize: 12, color: ui.sub, marginTop: 3 }}>
            {inspection.buyer?.name ?? '—'} · {inspection.supplier?.name ?? '—'}
          </div>

          <div style={{ marginTop: 16, padding: 12, background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: ui.sub }}>Photos uploaded</span>
              <span>
                <Mono style={{ fontWeight: 600 }}>{totalFilled}</Mono>
                <span style={{ color: ui.faint }}> / </span>
                <Mono>{totalRequired}</Mono>
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: ui.line, marginTop: 8, overflow: 'hidden' }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: ui.accent, borderRadius: 999 }} />
            </div>
          </div>

          <div style={{ ...fieldLabel, margin: '18px 0 10px' }}>Loops · {loops.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {loops.map((l, i) => {
              const isActive = l.id === activeLoopId;
              const filled = l.photos?.length ?? 0;
              const req = l.requiredPhotoCount ?? 0;
              const done = req > 0 && filled >= req;
              return (
                <div
                  key={l.id}
                  onClick={() => handleLoopSelect(l.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: isActive ? ui.accentSoft : 'transparent', borderLeft: isActive ? `2px solid ${ui.accent}` : '2px solid transparent', marginLeft: isActive ? -2 : 0, cursor: 'pointer' }}
                >
                  <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: isActive ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                    <div style={{ fontSize: 11, color: ui.faint, marginTop: 1 }}>
                      <Mono>{filled}/{req}</Mono> photos
                    </div>
                  </div>
                  {done ? (
                    <span style={{ width: 18, height: 18, borderRadius: 999, background: '#1F8A4C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Check size={11} color="#fff" />
                    </span>
                  ) : (
                    <span style={{ width: 18, height: 18, borderRadius: 999, border: `1.5px solid ${ui.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: ui.faint }}>
                      {filled || ''}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Main content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px', minWidth: 0 }}>
          {!activeLoop ? (
            <div style={{ color: ui.sub, fontSize: 13 }}>No loops defined on this inspection.</div>
          ) : (
            <div style={{ maxWidth: 880 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start' }}>
                <div>
                  <Mono style={{ fontSize: 12, color: ui.sub }}>
                    LOOP {String((loops.findIndex((l) => l.id === activeLoop.id) + 1)).padStart(2, '0')}
                  </Mono>
                  <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.2, marginTop: 4 }}>{activeLoop.name}</div>
                  <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 3 }}>
                    <Mono>{activeLoop.photos?.length ?? 0}</Mono> of <Mono>{activeLoop.requiredPhotoCount ?? 0}</Mono> required shots uploaded
                  </div>
                </div>
                <Btn
                  kind="primary"
                  icon={<Upload size={15} />}
                  style={{ marginLeft: 'auto', opacity: isPending ? 0.65 : 1 }}
                  onClick={isPending ? undefined : () => fileInputRef.current?.click()}
                >
                  Upload photos
                </Btn>
              </div>

              {/* Photo slots */}
              <div style={{ ...fieldLabel, margin: '22px 0 12px' }}>Photos uploaded</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                {(activeLoop.photos ?? []).map((photo, i) => (
                  <div key={photo.id} style={{ border: `1px solid ${ui.line}`, borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
                    <div style={{ position: 'relative', height: 150, background: 'linear-gradient(135deg,#BFC8D2,#7E8794)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ position: 'absolute', top: 8, left: 8 }}><CompactUnverified /></div>
                      <div style={{ position: 'absolute', bottom: 8, right: 8, width: 26, height: 26, borderRadius: 7, background: 'rgba(11,18,32,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Eye size={14} color="#fff" />
                      </div>
                    </div>
                    <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Mono style={{ fontSize: 11, color: ui.faint }}>{String(i + 1).padStart(2, '0')}</Mono>
                      <span style={{ fontSize: 11, color: ui.faint, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{photo.storageKey}</span>
                    </div>
                  </div>
                ))}
                {/* Empty drop slot */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  style={{ border: '1.5px dashed #C8D0DA', borderRadius: 12, background: 'repeating-linear-gradient(135deg,#FAFBFC 0 8px,#F0F3F7 8px 16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', height: 195, cursor: 'pointer' }}
                >
                  <div style={{ textAlign: 'center', color: ui.faint }}>
                    <Upload size={20} color={ui.faint} />
                    <div style={{ fontSize: 11.5, marginTop: 6 }}>Drop photo</div>
                  </div>
                </div>
              </div>

              {/* Defect tagging */}
              <div style={{ ...fieldLabel, margin: '26px 0 12px' }}>Tag defects for this loop</div>
              <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {SEVS.map((sev) => {
                  const s = severity[sev];
                  const items = catalogBySev(sev);
                  const activeInstances = (activeLoop.defects ?? []).filter(
                    (d) => d.severity === sev.toUpperCase(),
                  );
                  return (
                    <div key={sev}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <SeverityTag sev={sev} />
                        <Mono style={{ fontSize: 11, color: ui.faint }}>{activeInstances.length} tagged</Mono>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {items.length === 0 && activeInstances.length === 0 && (
                          <span style={{ fontSize: 12, color: ui.faint, fontStyle: 'italic' }}>None available for this loop</span>
                        )}
                        {/* Custom (free-text) defects already on this loop */}
                        {activeInstances.filter((d) => d.customText).map((d) => (
                          <div key={d.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, background: s.bg, color: s.fg, border: `1px solid ${s.bg}` }}>
                            <Check size={13} color={s.fg} />{d.customText}
                          </div>
                        ))}
                        {/* Catalog defects */}
                        {items.map((item) => {
                          const on = activeDefectIds.has(item.id);
                          return (
                            <div
                              key={item.id}
                              onClick={() => handleDefectToggle(item, on)}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, background: on ? s.bg : '#fff', color: on ? s.fg : ui.sub, border: `1px solid ${on ? s.bg : ui.line}`, cursor: on ? 'default' : 'pointer' }}
                            >
                              {on ? <Check size={13} color={s.fg} /> : <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />}
                              {item.name}
                            </div>
                          );
                        })}
                        {/* +Custom toggle */}
                        {customDefectSev === sev ? (
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, borderRadius: 999, border: `1px solid ${ui.line}`, overflow: 'hidden' }}>
                            <input
                              autoFocus
                              value={customDefectText}
                              onChange={(e) => setCustomDefectText(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') handleCustomDefect(); if (e.key === 'Escape') { setCustomDefectSev(null); setCustomDefectText(''); } }}
                              placeholder="Defect description…"
                              style={{ height: '100%', padding: '0 10px', fontSize: 12.5, border: 'none', outline: 'none', background: 'transparent', minWidth: 180 }}
                            />
                            <button onClick={handleCustomDefect} style={{ height: '100%', padding: '0 10px', background: ui.accentSoft, border: 'none', borderLeft: `1px solid ${ui.line}`, color: ui.accent, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                            <button onClick={() => { setCustomDefectSev(null); setCustomDefectText(''); }} style={{ height: '100%', padding: '0 8px', background: 'transparent', border: 'none', color: ui.faint, cursor: 'pointer' }}><X size={13} /></button>
                          </div>
                        ) : (
                          <div
                            onClick={() => setCustomDefectSev(sev)}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 30, padding: '0 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 500, background: '#fff', color: ui.sub, border: `1px dashed ${ui.line}`, cursor: 'pointer' }}
                          >
                            <Plus size={13} /> Custom
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Measurements */}
              <div style={{ ...fieldLabel, margin: '26px 0 12px' }}>Measurements · free-form entry</div>
              <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px', padding: '10px 16px', fontSize: 11, color: ui.sub, textTransform: 'uppercase', letterSpacing: 0.4, background: ui.fill, borderBottom: `1px solid ${ui.line}` }}>
                  <span>Point</span><span style={{ textAlign: 'right' }}>Measured</span><span style={{ textAlign: 'right' }}>Unit</span>
                </div>
                {/* Persisted measurements */}
                {(activeLoop.measurements ?? []).map((m, i) => (
                  <div key={m.id} style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px', alignItems: 'center', padding: '11px 16px', borderTop: i > 0 ? `1px solid ${ui.lineSoft}` : 'none' }}>
                    <span style={{ fontSize: 13 }}>{m.label}</span>
                    <Mono style={{ textAlign: 'right', fontWeight: 600, fontSize: 12.5 }}>{m.recordedValue ?? '—'}</Mono>
                    <Mono style={{ textAlign: 'right', fontSize: 12.5, color: ui.sub }}>{m.unit ?? '—'}</Mono>
                  </div>
                ))}
                {/* Unsaved new rows */}
                {extraMeasurements.filter((m) => m.isNew).map((m, i) => (
                  <NewMeasurementRow
                    key={`new-${i}`}
                    onSave={(label, value, unit) => handleMeasurementSave(label, value, unit, activeLoopId)}
                    onCancel={() => setExtraMeasurements((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
                <div
                  onClick={() => setExtraMeasurements((prev) => [...prev, { label: '', recordedValue: '', unit: '', isNew: true }])}
                  style={{ padding: '10px 16px', borderTop: `1px solid ${ui.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}
                >
                  <Plus size={14} /> Add measurement point
                </div>
              </div>
              <div style={{ fontSize: 11.5, color: ui.faint, lineHeight: 1.45 }}>
                Measurements are free-form (label · value · unit) in the MVP — no spec/tolerance or pass-fail per point.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NewMeasurementRow({
  onSave,
  onCancel,
}: {
  onSave: (label: string, value: string, unit: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState('');
  const inputStyle: CSSProperties = { height: 28, padding: '0 8px', fontSize: 12.5, fontFamily: 'var(--font-mono)', background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 6, outline: 'none' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 90px', alignItems: 'center', padding: '8px 16px', borderTop: `1px solid ${ui.lineSoft}`, gap: 8 }}>
      <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Measurement point…" style={{ ...inputStyle, width: '100%' }} />
      <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Value" style={{ ...inputStyle, textAlign: 'right', width: 110, justifySelf: 'end' }} onBlur={() => { if (label.trim() && value.trim()) onSave(label, value, unit); }} />
      <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" style={{ ...inputStyle, textAlign: 'right', width: 70, justifySelf: 'end' }} onBlur={() => { if (label.trim() && value.trim()) onSave(label, value, unit); }} />
    </div>
  );
}
