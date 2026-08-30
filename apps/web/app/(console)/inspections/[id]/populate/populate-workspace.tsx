'use client';

import { useRef, useState, useTransition } from 'react';
import type { DefectSeverity } from '@inspect/shared-types';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  Grid3x3,
  Lock,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Btn, Mono, RoleBadge, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';
import type {
  ApiInspection,
  ApiDefectCatalogItem,
  ApiInspectionLoopItem,
  ApiPhoto,
} from '@/lib/api';
import { presignPhoto, registerPhoto, retakePhoto, discardCycle, addDefect, addMeasurement } from './actions';
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
  const retakeInputRef = useRef<HTMLInputElement>(null);

  const items: ApiInspectionLoopItem[] = inspection.items
    ? [...inspection.items].sort((a, b) => a.position - b.position)
    : [];
  const state = inspection.cycleState;

  /** Every filled slot, keyed "<itemId>:<cycleIndex>". */
  const photoBySlot = new Map<string, ApiPhoto>();
  for (const item of items) {
    for (const photo of item.photos ?? []) photoBySlot.set(`${item.id}:${photo.cycleIndex}`, photo);
  }
  const cycleIndexes = [
    ...new Set(items.flatMap((i) => (i.photos ?? []).map((p) => p.cycleIndex))),
  ].sort((a, b) => a - b);

  const [cursor, setCursor] = useState<{ cycleIndex: number; itemId: string }>(
    state?.nextSlot ?? { cycleIndex: 0, itemId: items[0]?.id ?? '' },
  );
  const [view, setView] = useState<'guided' | 'grid'>('guided');
  const [endGate, setEndGate] = useState<{ cycleIndex: number; missing: string[] } | null>(null);
  const [customDefectSev, setCustomDefectSev] = useState<SeverityKey | null>(null);
  const [customDefectText, setCustomDefectText] = useState('');

  const cursorItemIndex = items.findIndex((i) => i.id === cursor.itemId);
  const cursorItem = items[cursorItemIndex];
  const cursorPhoto = photoBySlot.get(`${cursor.itemId}:${cursor.cycleIndex}`);
  const targetUnits = inspection.computedSampling?.sampleSize ?? null;

  /** Units to render in the strip / grid: everything shot, plus the one in progress. */
  const visibleCycles = [...new Set([...cycleIndexes, cursor.cycleIndex])].sort((a, b) => a - b);

  /** Next item in this unit; past the last item, roll to item 01 of the next unit. */
  function advance() {
    const next = cursorItemIndex + 1;
    if (next < items.length) setCursor({ ...cursor, itemId: items[next].id });
    else setCursor({ cycleIndex: cursor.cycleIndex + 1, itemId: items[0].id });
  }

  function back() {
    const prev = cursorItemIndex - 1;
    if (prev >= 0) setCursor({ ...cursor, itemId: items[prev].id });
    else if (cursor.cycleIndex > 0) {
      setCursor({ cycleIndex: cursor.cycleIndex - 1, itemId: items[items.length - 1].id });
    }
  }

  async function handlePhotoUpload(file: File) {
    startTransition(async () => {
      setPendingError(undefined);
      const presign = await presignPhoto(inspection.id);
      if (presign.error) { setPendingError(presign.error); return; }

      try {
        await uploadBytesToPresignedUrl(presign.data!.uploadUrl, file);
      } catch (e) {
        setPendingError(`Storage upload failed — the browser could not PUT to object storage (check S3_ENDPOINT reachability and the bucket's CORS policy): ${String(e)}`);
        return;
      }

      const hash = await sha256Hex(file);
      const reg = await registerPhoto(inspection.id, {
        storageKey: presign.data!.storageKey,
        contentHash: hash,
        inspectionLoopItemId: cursor.itemId,
        cycleIndex: cursor.cycleIndex,
        clientRequestId: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
      if (reg.error) { setPendingError(reg.error); return; }
      advance();
      router.refresh();
    });
  }

  /** Retake REPLACES the slot's bytes — it never advances the cursor. */
  async function handleRetake(file: File) {
    if (!cursorPhoto) return;
    const photoId = cursorPhoto.id;
    startTransition(async () => {
      setPendingError(undefined);
      const presign = await presignPhoto(inspection.id);
      if (presign.error) { setPendingError(presign.error); return; }
      try {
        await uploadBytesToPresignedUrl(presign.data!.uploadUrl, file);
      } catch (e) {
        setPendingError(`Storage upload failed — the browser could not PUT to object storage: ${String(e)}`);
        return;
      }
      const hash = await sha256Hex(file);
      const res = await retakePhoto(inspection.id, photoId, {
        storageKey: presign.data!.storageKey,
        contentHash: hash,
      });
      if (res.error) setPendingError(res.error);
      else router.refresh();
    });
  }

  function handleDiscardCycle(cycleIndex: number) {
    startTransition(async () => {
      setPendingError(undefined);
      const res = await discardCycle(inspection.id, cycleIndex);
      if (res.error) { setPendingError(res.error); return; }
      setEndGate(null);
      // Land on the first item of the discarded unit's slot so the operator can
      // simply re-shoot it if that is what they meant.
      setCursor({ cycleIndex, itemId: items[0]?.id ?? '' });
      router.refresh();
    });
  }

  async function handleDefectToggle(item: ApiDefectCatalogItem) {
    if (!cursorPhoto) return;
    startTransition(async () => {
      const r = await addDefect(inspection.id, {
        defectCatalogId: item.id,
        severity: item.defaultSeverity,
        inspectionLoopItemId: cursor.itemId,
        cycleIndex: cursor.cycleIndex,
      });
      if (r.error) setPendingError(r.error);
      else router.refresh();
    });
  }

  async function handleCustomDefect() {
    if (!customDefectText.trim() || !customDefectSev || !cursorPhoto) return;
    const text = customDefectText.trim();
    const sev = customDefectSev;
    setCustomDefectText('');
    setCustomDefectSev(null);
    startTransition(async () => {
      const r = await addDefect(inspection.id, {
        customText: text,
        severity: sev.toUpperCase() as DefectSeverity,
        inspectionLoopItemId: cursor.itemId,
        cycleIndex: cursor.cycleIndex,
      });
      if (r.error) setPendingError(r.error);
      else router.refresh();
    });
  }

  async function handleMeasurementSave(label: string, value: string, unit: string) {
    if (!label.trim()) return;
    startTransition(async () => {
      const r = await addMeasurement(inspection.id, {
        cycleIndex: cursor.cycleIndex,
        label,
        recordedValue: value,
        unit,
      });
      if (r.error) setPendingError(r.error);
      else router.refresh();
    });
  }

  function handleEndLoop() {
    const partial = state?.partialCycles?.[0];
    if (partial) {
      const missing = partial.missingItemIds.map(
        (id) => items.find((i) => i.id === id)?.itemName ?? id,
      );
      setEndGate({ cycleIndex: partial.cycleIndex, missing });
      return;
    }
    startTransition(async () => {
      const r = await submitInspection(inspection.id);
      if (r.error) setPendingError(r.error);
      else router.push(`/inspections/${inspection.id}/review`);
    });
  }

  const SEVS: SeverityKey[] = ['critical', 'major', 'minor'];
  // `defaultSeverity` is what GET /defect-catalog actually sends. Reading
  // `severity` here made every group filter to empty, so no catalog defect
  // could be tagged at all (fixed in INS-086 Phase 1).
  const catalogBySev = (sev: SeverityKey) =>
    catalog.filter((c) => c.defaultSeverity === sev.toUpperCase());

  /** Every defect recorded anywhere on the unit currently on screen. */
  const defectsOnUnit = items.flatMap((item) =>
    (item.defects ?? [])
      .filter((d) => d.cycleIndex === cursor.cycleIndex)
      .map((d) => ({ ...d, itemName: item.itemName })),
  );
  const taggedHere = new Set(
    (cursorItem?.defects ?? [])
      .filter((d) => d.cycleIndex === cursor.cycleIndex)
      .map((d) => d.defectCatalog?.id)
      .filter(Boolean),
  );

  const sheet = inspection.loopPresetSnapshot?.measurementFields ?? [];
  const valuesForUnit = new Map(
    (inspection.measurements ?? [])
      .filter((m) => m.cycleIndex === cursor.cycleIndex)
      .map((m) => [m.label, m]),
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
      <input
        ref={retakeInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleRetake(file);
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
            <Lock size={13} color={ui.faint} /> Upload requires <RoleBadge role="inspector" /> or above
          </span>
          <Btn
            kind="primary"
            icon={<Check size={15} />}
            onClick={isPending ? undefined : handleEndLoop}
            style={{ opacity: isPending ? 0.65 : 1 }}
          >
            {isPending ? 'Working…' : 'End loop & review'}
          </Btn>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Left rail: items in this unit, then the unit strip */}
        <div style={{ width: 260, background: '#fff', borderRight: `1px solid ${ui.line}`, padding: '20px 16px', overflow: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {inspection.product?.styleNumber ?? '—'}
          </div>
          <div style={{ fontSize: 12, color: ui.sub, marginTop: 3 }}>
            {inspection.clientCompany?.name ?? '—'} · {inspection.factoryCompany?.name ?? '—'}
          </div>

          <div style={{ marginTop: 16, padding: 12, background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12 }}>
              <span style={{ color: ui.sub }}>Units complete</span>
              <span>
                <Mono style={{ fontWeight: 600 }}>{state?.completedCycles ?? 0}</Mono>
                <span style={{ color: ui.faint }}> / </span>
                <Mono>{targetUnits ?? '—'}</Mono>
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: ui.line, marginTop: 8, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${targetUnits ? Math.min(100, Math.round(((state?.completedCycles ?? 0) / targetUnits) * 100)) : 0}%`,
                  height: '100%',
                  background: ui.accent,
                  borderRadius: 999,
                }}
              />
            </div>
            {/* n is a TARGET, not a gate (INS-081) — say so rather than implying a block. */}
            <div style={{ fontSize: 10.5, color: ui.faint, marginTop: 8, lineHeight: 1.4 }}>
              Sample size is a target. You may end on any complete unit.
            </div>
          </div>

          <div style={{ ...fieldLabel, margin: '18px 0 10px' }}>Items · {items.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {items.map((item, i) => {
              const isActive = item.id === cursor.itemId;
              const shot = photoBySlot.has(`${item.id}:${cursor.cycleIndex}`);
              return (
                <div
                  key={item.id}
                  onClick={() => setCursor({ ...cursor, itemId: item.id })}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 8, background: isActive ? ui.accentSoft : 'transparent', borderLeft: isActive ? `2px solid ${ui.accent}` : '2px solid transparent', marginLeft: isActive ? -2 : 0, cursor: 'pointer' }}
                >
                  <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: isActive ? 600 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.itemName}
                  </div>
                  {shot ? (
                    <span style={{ width: 18, height: 18, borderRadius: 999, background: '#1F8A4C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Check size={11} color="#fff" />
                    </span>
                  ) : (
                    <span style={{ width: 18, height: 18, borderRadius: 999, border: `1.5px solid ${ui.line}` }} />
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ ...fieldLabel, margin: '18px 0 10px' }}>Units</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {visibleCycles.map((cycleIndex) => {
              const isActive = cycleIndex === cursor.cycleIndex;
              const shotCount = items.filter((i) => photoBySlot.has(`${i.id}:${cycleIndex}`)).length;
              const partial = state?.partialCycles?.some((pc) => pc.cycleIndex === cycleIndex);
              return (
                <div
                  key={cycleIndex}
                  onClick={() => setCursor({ cycleIndex, itemId: items[0]?.id ?? '' })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: isActive ? ui.accentSoft : 'transparent', cursor: 'pointer' }}
                >
                  <Mono style={{ fontSize: 11.5, color: partial ? severity.major.fg : ui.sub, fontWeight: isActive ? 600 : 500 }}>
                    Unit {cycleIndex + 1}
                  </Mono>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                    {items.map((i) => (
                      <span
                        key={i.id}
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: 999,
                          background: photoBySlot.has(`${i.id}:${cycleIndex}`) ? ui.accent : ui.line,
                        }}
                      />
                    ))}
                  </div>
                  {partial && (
                    <button
                      aria-label={`Discard unit ${cycleIndex + 1}`}
                      onClick={(e) => { e.stopPropagation(); handleDiscardCycle(cycleIndex); }}
                      style={{ background: 'transparent', border: 'none', color: severity.major.fg, cursor: 'pointer', padding: 0, display: 'flex' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                  <Mono style={{ fontSize: 10, color: ui.faint }}>{shotCount}/{items.length}</Mono>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => setView(view === 'guided' ? 'grid' : 'guided')}
            style={{ marginTop: 14, height: 34, width: '100%', border: `1px solid ${ui.line}`, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: ui.sub, fontSize: 12.5, fontWeight: 500, background: view === 'grid' ? ui.accentSoft : 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
          >
            <Grid3x3 size={14} /> {view === 'grid' ? 'Guided view' : 'Grid'}
          </button>
        </div>

        {/* Center */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px', minWidth: 0 }}>
          {items.length === 0 ? (
            <div style={{ color: ui.sub, fontSize: 13 }}>No loop items defined on this inspection.</div>
          ) : view === 'grid' ? (
            <div>
              <div style={{ ...fieldLabel, marginBottom: 12 }}>All slots · units × items</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={{ ...fieldLabel, textAlign: 'left', padding: 8 }}>Unit</th>
                      {items.map((item) => (
                        <th key={item.id} style={{ ...fieldLabel, textAlign: 'left', padding: 8 }}>
                          {item.itemName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCycles.map((cycleIndex) => {
                      const partial = state?.partialCycles?.some((pc) => pc.cycleIndex === cycleIndex);
                      return (
                        <tr key={cycleIndex} style={{ borderTop: `1px solid ${ui.lineSoft}` }}>
                          <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                            <Mono style={{ color: partial ? severity.major.fg : ui.sub }}>
                              Unit {cycleIndex + 1}
                            </Mono>
                            {partial && (
                              <button
                                onClick={() => handleDiscardCycle(cycleIndex)}
                                style={{ marginLeft: 8, background: 'transparent', border: 'none', color: severity.major.fg, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}
                              >
                                Discard
                              </button>
                            )}
                          </td>
                          {items.map((item) => {
                            const photo = photoBySlot.get(`${item.id}:${cycleIndex}`);
                            return (
                              <td key={item.id} style={{ padding: 6 }}>
                                <div
                                  onClick={() => { setCursor({ cycleIndex, itemId: item.id }); setView('guided'); }}
                                  title={photo ? 'Open slot' : 'Empty slot'}
                                  style={{ width: 72, height: 54, borderRadius: 8, cursor: 'pointer', overflow: 'hidden', border: photo ? `1px solid ${ui.line}` : '1.5px dashed #C8D0DA', background: photo ? '#fff' : ui.fill }}
                                >
                                  {photo?.viewUrl && (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={photo.viewUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ maxWidth: 880 }}>
              <Mono style={{ fontSize: 12, color: ui.sub }}>
                UNIT {cursor.cycleIndex + 1}
                {targetUnits ? ` OF ${targetUnits}` : ''} · ITEM {cursorItemIndex + 1} OF {items.length}
              </Mono>
              <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: -0.2, marginTop: 4 }}>
                {cursorItem?.itemName ?? '—'}
              </div>
              {cursorItem?.description && (
                <div style={{ fontSize: 12.5, color: ui.sub, marginTop: 3 }}>{cursorItem.description}</div>
              )}

              {/* Reference beside capture — the operator is matching, not guessing. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 20 }}>
                <div>
                  <div style={{ ...fieldLabel, marginBottom: 8 }}>Reference</div>
                  <div style={{ height: 260, borderRadius: 12, border: `1px solid ${ui.line}`, background: ui.fill, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    {cursorItem?.referenceImageUrl ? (
                      <span style={{ fontSize: 11.5, color: ui.faint, padding: 12, textAlign: 'center' }}>
                        Reference image set on the preset
                      </span>
                    ) : (
                      <span style={{ fontSize: 11.5, color: ui.faint }}>No reference image</span>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ ...fieldLabel, marginBottom: 8 }}>This slot</div>
                  <div
                    onClick={cursorPhoto ? undefined : () => fileInputRef.current?.click()}
                    style={{ position: 'relative', height: 260, borderRadius: 12, border: cursorPhoto ? `1px solid ${ui.line}` : '1.5px dashed #C8D0DA', background: cursorPhoto ? 'linear-gradient(135deg,#BFC8D2,#7E8794)' : 'repeating-linear-gradient(135deg,#FAFBFC 0 8px,#F0F3F7 8px 16px)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: cursorPhoto ? 'default' : 'pointer', overflow: 'hidden' }}
                  >
                    {cursorPhoto?.viewUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cursorPhoto.viewUrl} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    ) : !cursorPhoto ? (
                      <div style={{ textAlign: 'center', color: ui.faint }}>
                        <Upload size={20} color={ui.faint} />
                        <div style={{ fontSize: 11.5, marginTop: 6 }}>Upload this item&rsquo;s photo</div>
                      </div>
                    ) : null}
                    {cursorPhoto && (
                      <div style={{ position: 'absolute', top: 8, left: 8 }}><CompactUnverified /></div>
                    )}
                    {cursorPhoto?.viewUrl && (
                      <a
                        href={cursorPhoto.viewUrl}
                        target="_blank"
                        rel="noreferrer"
                        title="Open full size"
                        style={{ position: 'absolute', bottom: 8, right: 8, width: 26, height: 26, borderRadius: 7, background: 'rgba(11,18,32,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Eye size={14} color="#fff" />
                      </a>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
                <Btn
                  kind="ghost"
                  icon={<ChevronLeft size={15} />}
                  onClick={cursorItemIndex === 0 && cursor.cycleIndex === 0 ? undefined : back}
                >
                  Back
                </Btn>
                {cursorPhoto ? (
                  <>
                    {/* Retake replaces the slot; it deliberately does not advance. */}
                    <Btn
                      kind="ghost"
                      icon={<RefreshCw size={15} />}
                      onClick={isPending ? undefined : () => retakeInputRef.current?.click()}
                    >
                      Retake
                    </Btn>
                    <Btn kind="primary" icon={<ChevronRight size={15} />} onClick={advance}>
                      Next item
                    </Btn>
                  </>
                ) : (
                  <Btn
                    kind="primary"
                    icon={<Upload size={15} />}
                    onClick={isPending ? undefined : () => fileInputRef.current?.click()}
                    style={{ opacity: isPending ? 0.65 : 1 }}
                  >
                    Upload photo
                  </Btn>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right rail: this unit's defects + measurement sheet */}
        <div style={{ width: 320, background: '#fff', borderLeft: `1px solid ${ui.line}`, padding: '20px 16px', overflow: 'auto', flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Unit {cursor.cycleIndex + 1}</div>

          <div style={{ ...fieldLabel, margin: '16px 0 8px' }}>Defect tags</div>
          {!cursorPhoto && (
            <div style={{ fontSize: 11.5, color: ui.faint, marginBottom: 8, lineHeight: 1.45 }}>
              Upload this item&rsquo;s photo first — a defect is recorded against the shot it was
              seen on.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: cursorPhoto ? 1 : 0.45 }}>
            {SEVS.map((sev) => {
              const s = severity[sev];
              const catalogItems = catalogBySev(sev);
              return (
                <div key={sev}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <SeverityTag sev={sev} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    {catalogItems.map((item) => {
                      const on = taggedHere.has(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={cursorPhoto && !on ? () => handleDefectToggle(item) : undefined}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, background: on ? s.bg : '#fff', color: on ? s.fg : ui.sub, border: `1px solid ${on ? s.bg : ui.line}`, cursor: cursorPhoto && !on ? 'pointer' : 'default' }}
                        >
                          {on ? <Check size={12} color={s.fg} /> : <span style={{ width: 5, height: 5, borderRadius: 999, background: s.dot }} />}
                          {item.name}
                        </div>
                      );
                    })}
                    {customDefectSev === sev ? (
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, borderRadius: 999, border: `1px solid ${ui.line}`, overflow: 'hidden' }}>
                        <input
                          autoFocus
                          value={customDefectText}
                          onChange={(e) => setCustomDefectText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleCustomDefect(); if (e.key === 'Escape') { setCustomDefectSev(null); setCustomDefectText(''); } }}
                          placeholder="Defect…"
                          style={{ height: '100%', padding: '0 8px', fontSize: 12, border: 'none', outline: 'none', background: 'transparent', minWidth: 110 }}
                        />
                        <button onClick={handleCustomDefect} style={{ height: '100%', padding: '0 8px', background: ui.accentSoft, border: 'none', borderLeft: `1px solid ${ui.line}`, color: ui.accent, fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                        <button onClick={() => { setCustomDefectSev(null); setCustomDefectText(''); }} style={{ height: '100%', padding: '0 6px', background: 'transparent', border: 'none', color: ui.faint, cursor: 'pointer' }}><X size={12} /></button>
                      </div>
                    ) : (
                      <div
                        onClick={cursorPhoto ? () => setCustomDefectSev(sev) : undefined}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12, fontWeight: 500, background: '#fff', color: ui.sub, border: `1px dashed ${ui.line}`, cursor: cursorPhoto ? 'pointer' : 'default' }}
                      >
                        <Plus size={12} /> Custom
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ ...fieldLabel, margin: '18px 0 8px' }}>On this unit · {defectsOnUnit.length}</div>
          {defectsOnUnit.length === 0 ? (
            <div style={{ fontSize: 12, color: ui.faint, fontStyle: 'italic' }}>No defects recorded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {defectsOnUnit.map((d) => {
                const sk = d.severity.toLowerCase() as SeverityKey;
                const s = severity[sk];
                return (
                  <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot, flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {d.customText ?? d.defectCatalog?.name ?? 'Defect'}
                    </span>
                    <Mono style={{ fontSize: 10.5, color: ui.faint }}>{d.itemName}</Mono>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ ...fieldLabel, margin: '18px 0 8px' }}>Measurements · this unit</div>
          {sheet.length === 0 ? (
            <div style={{ fontSize: 12, color: ui.faint, fontStyle: 'italic' }}>
              No measurement fields on this loop.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sheet.map((f) => (
                <MeasurementRow
                  key={`${cursor.cycleIndex}:${f.label}`}
                  label={f.label}
                  unit={f.unit ?? ''}
                  initialValue={valuesForUnit.get(f.label)?.recordedValue ?? ''}
                  onSave={(value) => handleMeasurementSave(f.label, value, f.unit ?? '')}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/*
        INS-081 end gate: mid-cycle there are exactly two exits — finish the unit
        or discard it. There is no third option and no dismiss-to-submit path.
      */}
      {endGate && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ width: 460, background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 24px 60px rgba(11,18,32,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              Unit {endGate.cycleIndex + 1} is incomplete
            </div>
            <div style={{ fontSize: 13, color: ui.sub, marginTop: 8, lineHeight: 1.5 }}>
              Still missing: <b style={{ color: ui.ink }}>{endGate.missing.join(', ')}</b>. A loop can
              only be ended on a complete unit — finish this one, or discard it.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <Btn
                kind="primary"
                onClick={() => {
                  const firstMissing = items.find((i) => i.itemName === endGate.missing[0]);
                  setCursor({
                    cycleIndex: endGate.cycleIndex,
                    itemId: firstMissing?.id ?? items[0]?.id ?? '',
                  });
                  setView('guided');
                  setEndGate(null);
                }}
              >
                Finish unit {endGate.cycleIndex + 1}
              </Btn>
              <Btn
                kind="ghost"
                icon={<Trash2 size={15} />}
                onClick={() => handleDiscardCycle(endGate.cycleIndex)}
              >
                Discard unit {endGate.cycleIndex + 1}
              </Btn>
              <button
                onClick={() => setEndGate(null)}
                style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: ui.faint, fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MeasurementRow({
  label,
  unit,
  initialValue,
  onSave,
}: {
  label: string;
  unit: string;
  initialValue: string;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (value.trim() !== initialValue) onSave(value.trim()); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="—"
        style={{ width: 72, height: 28, padding: '0 8px', fontSize: 12.5, fontFamily: 'var(--font-mono)', textAlign: 'right', background: ui.fill, border: `1px solid ${ui.line}`, borderRadius: 6, outline: 'none' }}
      />
      <Mono style={{ fontSize: 11, color: ui.faint, width: 26 }}>{unit || '—'}</Mono>
    </div>
  );
}
