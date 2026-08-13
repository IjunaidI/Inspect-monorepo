'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Image as ImageIcon,
  Plus,
  Repeat,
  Ruler,
  Smartphone,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { Mono, SeverityTag } from '@/components/inspect/shell';
import { severity, ui, type SeverityKey } from '@/components/inspect/tokens';
import type { ApiDefectCatalog, ApiLoopPresetDetail } from '@/lib/api';
import type { CreatePresetInput } from '../actions';
import { createPreset, createDefect, presignPresetImage } from '../actions';

interface MeasurementFieldDraft {
  id: string;
  label: string;
  unit: string;
}

/** An uploaded reference image: the storage key submitted with the preset + a display name. */
interface ReferenceImageDraft {
  key: string;
  name: string;
}

/**
 * INS-081: a loop item is ONE capture point taking ONE image. It carries no shot
 * count, no defect list and no measurement fields — those moved up to the loop.
 */
interface ItemDraft {
  id: string;
  itemName: string;
  description: string;
  referenceImage: ReferenceImageDraft | null;
}

/** Which editor the main panel shows — the loop's own config, or one item. */
type Selection = { kind: 'defects' } | { kind: 'measurements' } | { kind: 'item'; index: number };

interface BuilderState {
  presetName: string;
  description: string;
  aqlLevel: string;
  items: ItemDraft[];
  /** Loop-global (INS-081). */
  measurementFields: MeasurementFieldDraft[];
  allowedDefectCatalogIds: Set<string>;
  selection: Selection;
  customDefectName: string;
  customDefectSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  saving: boolean;
  saveError: string | null;
}

interface PresetBuilderProps {
  catalog: ApiDefectCatalog[];
  seed?: ApiLoopPresetDetail;
}

function blankItem(name = ''): ItemDraft {
  return { id: crypto.randomUUID(), itemName: name, description: '', referenceImage: null };
}

function initFromSeed(seed: ApiLoopPresetDetail): BuilderState {
  return {
    presetName: seed.name,
    description: seed.description ?? '',
    // Only General Level II is implemented (the API rejects anything else).
    aqlLevel: 'II',
    items: seed.items.map((i) => ({
      id: crypto.randomUUID(),
      itemName: i.itemName,
      description: i.description ?? '',
      referenceImage: i.referenceImageUrl
        ? { key: i.referenceImageUrl, name: i.referenceImageUrl.split('/').pop() ?? i.referenceImageUrl }
        : null,
    })),
    measurementFields: (seed.measurementFields ?? []).map((f) => ({
      id: crypto.randomUUID(),
      label: f.label,
      unit: f.unit ?? '',
    })),
    allowedDefectCatalogIds: new Set((seed.allowedDefects ?? []).map((a) => a.defectCatalog.id)),
    selection: { kind: 'item', index: 0 },
    customDefectName: '',
    customDefectSeverity: 'MINOR',
    saving: false,
    saveError: null,
  };
}

const fieldLabel = {
  fontSize: 11,
  fontWeight: 600,
  color: ui.sub,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
  marginBottom: 8,
};
const titleInput = {
  fontFamily: 'inherit',
  border: 'none',
  background: 'transparent',
  outline: 'none',
  color: ui.ink,
  padding: 0,
};
const rowInput = {
  flex: 1,
  fontFamily: 'inherit',
  border: 'none',
  background: 'transparent',
  outline: 'none',
  fontSize: 13,
  color: ui.ink,
};
const iconBtn = {
  width: 28,
  height: 28,
  borderRadius: 6,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: ui.faint,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
};

/** Sidebar row treatment shared by the loop-level entries and the item list. */
function sidebarRow(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    padding: 10,
    borderRadius: 8,
    background: active ? ui.accentSoft : 'transparent',
    borderLeft: active ? `2px solid ${ui.accent}` : '2px solid transparent',
    marginLeft: active ? -2 : 0,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    color: ui.ink,
    textAlign: 'left',
    borderTop: 'none',
    borderRight: 'none',
    borderBottom: 'none',
  };
}

export default function PresetBuilder({ catalog, seed }: PresetBuilderProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [extraDefects, setExtraDefects] = useState<ApiDefectCatalog[]>([]);
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [state, setState] = useState<BuilderState>(
    seed
      ? initFromSeed(seed)
      : {
          presetName: '',
          description: '',
          aqlLevel: 'II',
          items: [blankItem('Item 01')],
          measurementFields: [],
          allowedDefectCatalogIds: new Set(),
          selection: { kind: 'item', index: 0 },
          customDefectName: '',
          customDefectSeverity: 'MINOR',
          saving: false,
          saveError: null,
        },
  );

  const allCatalog = [...catalog, ...extraDefects].filter((d) => !d.isArchived);

  function set(partial: Partial<BuilderState>) {
    setState((prev) => ({ ...prev, ...partial }));
  }

  function addItem() {
    setState((prev) => {
      const next = blankItem(`Item ${String(prev.items.length + 1).padStart(2, '0')}`);
      return {
        ...prev,
        items: [...prev.items, next],
        selection: { kind: 'item', index: prev.items.length },
      };
    });
  }

  function removeItem(index: number) {
    setState((prev) => {
      const items = prev.items.filter((_, i) => i !== index);
      const activeIndex =
        prev.selection.kind === 'item'
          ? Math.min(prev.selection.index, Math.max(0, items.length - 1))
          : 0;
      return { ...prev, items, selection: { kind: 'item', index: activeIndex } };
    });
  }

  /** Swap an item with its neighbour (INS-052) — positions derive from array order at submit. */
  function moveItem(index: number, delta: -1 | 1) {
    setState((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.items.length) return prev;
      const items = [...prev.items];
      [items[index], items[target]] = [items[target], items[index]];
      let selection = prev.selection;
      if (prev.selection.kind === 'item') {
        if (prev.selection.index === index) selection = { kind: 'item', index: target };
        else if (prev.selection.index === target) selection = { kind: 'item', index };
      }
      return { ...prev, items, selection };
    });
  }

  /**
   * Reference-image upload (INS-052): presign via the API, PUT the bytes
   * directly to storage, then attach the storage key to this item. Failures
   * surface inline and never block saving the preset without an image.
   */
  async function handleReferenceUpload(itemId: string, file: File) {
    setRefError(null);
    setRefUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const presign = await presignPresetImage(ext);
      if (presign.error || !presign.data) {
        setRefError(presign.error ?? 'Could not prepare the upload.');
        return;
      }
      const { storageKey, uploadUrl } = presign.data;
      // INS-060: separate the two failure modes. fetch() only *rejects* on a
      // transport-level failure — offline, DNS/TLS, or a CORS preflight the
      // bucket refused; the request never reached storage. An HTTP error status
      // resolves normally and means storage answered and said no.
      let res: Response;
      try {
        res = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch {
        setRefError(
          'Could not reach object storage — the upload never left the browser (network or CORS). The preset can still be saved without it.',
        );
        return;
      }
      if (!res.ok) {
        setRefError(
          `Upload rejected by object storage (${res.status}). The preset can still be saved without it.`,
        );
        return;
      }
      // Attach by STABLE item id, not a positional index: the user can reorder
      // or delete items while this async upload is in flight, which would
      // otherwise land the image on the wrong item (or silently drop it).
      setState((prev) => ({
        ...prev,
        items: prev.items.map((it) =>
          it.id === itemId ? { ...it, referenceImage: { key: storageKey, name: file.name } } : it,
        ),
      }));
    } catch (e) {
      setRefError(e instanceof Error ? e.message : 'Image upload failed.');
    } finally {
      setRefUploading(false);
    }
  }

  function removeReferenceImage(itemId: string) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((it) => (it.id === itemId ? { ...it, referenceImage: null } : it)),
    }));
  }

  function updateItemField<K extends keyof ItemDraft>(index: number, field: K, value: ItemDraft[K]) {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, [field]: value } : it)),
    }));
  }

  function addMeasurementField() {
    setState((prev) => ({
      ...prev,
      measurementFields: [
        ...prev.measurementFields,
        { id: crypto.randomUUID(), label: '', unit: '' },
      ],
    }));
  }

  function updateMeasurementField(fieldId: string, key: 'label' | 'unit', value: string) {
    setState((prev) => ({
      ...prev,
      measurementFields: prev.measurementFields.map((f) =>
        f.id === fieldId ? { ...f, [key]: value } : f,
      ),
    }));
  }

  function removeMeasurementField(fieldId: string) {
    setState((prev) => ({
      ...prev,
      measurementFields: prev.measurementFields.filter((f) => f.id !== fieldId),
    }));
  }

  function toggleDefect(defectCatalogId: string) {
    setState((prev) => {
      const ids = new Set(prev.allowedDefectCatalogIds);
      if (ids.has(defectCatalogId)) ids.delete(defectCatalogId);
      else ids.add(defectCatalogId);
      return { ...prev, allowedDefectCatalogIds: ids };
    });
  }

  async function handleAddCustomDefect() {
    const { customDefectName, customDefectSeverity } = state;
    if (!customDefectName.trim()) return;
    const result = await createDefect(customDefectName.trim(), customDefectSeverity);
    if (result.error) {
      set({ saveError: result.error });
      return;
    }
    if (result.data) {
      const newEntry: ApiDefectCatalog = {
        id: result.data.id,
        name: result.data.name,
        defaultSeverity: result.data.defaultSeverity as 'CRITICAL' | 'MAJOR' | 'MINOR',
        scope: 'ORG',
        isArchived: false,
      };
      setExtraDefects((prev) => [...prev, newEntry]);
      set({ customDefectName: '' });
      toggleDefect(result.data.id);
    }
  }

  async function handleSave() {
    set({ saving: true, saveError: null });
    const input: CreatePresetInput = {
      name: state.presetName,
      description: state.description || undefined,
      aqlLevel: state.aqlLevel || undefined,
      items: state.items.map((it) => ({
        itemName: it.itemName,
        description: it.description || undefined,
        referenceImageUrl: it.referenceImage?.key,
      })),
      measurementFields: state.measurementFields.map((f) => ({
        label: f.label,
        unit: f.unit || undefined,
      })),
      allowedDefectCatalogIds: Array.from(state.allowedDefectCatalogIds),
    };
    const result = await createPreset(input);
    if (result?.error) {
      set({ saving: false, saveError: result.error });
    }
    // On success, createPreset redirects — no client redirect needed
  }

  const activeItem =
    state.selection.kind === 'item' ? state.items[state.selection.index] : undefined;

  const defectsBySev: Record<'CRITICAL' | 'MAJOR' | 'MINOR', ApiDefectCatalog[]> = {
    CRITICAL: allCatalog.filter((d) => d.defaultSeverity === 'CRITICAL'),
    MAJOR: allCatalog.filter((d) => d.defaultSeverity === 'MAJOR'),
    MINOR: allCatalog.filter((d) => d.defaultSeverity === 'MINOR'),
  };

  const sevMap: Record<'CRITICAL' | 'MAJOR' | 'MINOR', SeverityKey> = {
    CRITICAL: 'critical',
    MAJOR: 'major',
    MINOR: 'minor',
  };

  /*
   * INS-076: presets are never edited in place — the API is GET/POST/DELETE only
   * and auto-versions per trimmed name. So a seeded builder is a DUPLICATE, and
   * the two possible outcomes of Save are stated here rather than left implicit.
   */
  const isDuplicate = Boolean(seed);
  const nameChanged = isDuplicate && state.presetName.trim() !== seed!.name.trim();
  const builderTitle = isDuplicate
    ? `Duplicate of ${seed!.name} (v${seed!.version})`
    : state.presetName || 'New Loop';
  const saveRule = isDuplicate
    ? nameChanged
      ? `Name changed — Save creates a brand-new preset at v1. Keep the name “${seed!.name}” instead to save it as the next version.`
      : `Same name — Save adds the next version of “${seed!.name}” (you opened v${seed!.version}). Change the name to start a brand-new preset at v1. Existing inspections keep their snapshot either way.`
    : 'Save creates a new preset at v1 — unless the name already exists, in which case it saves as that preset’s next version. Existing inspections keep their snapshot either way.';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ height: 56, borderBottom: `1px solid ${ui.line}`, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13 }}>
          <Repeat size={15} color={ui.sub} />
          <span>Loop Presets</span>
          <ChevronRight size={14} color={ui.faint} />
          <span style={{ color: ui.ink, fontWeight: 550 }}>{builderTitle}</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ui.faint, fontWeight: 500 }}>
            <Smartphone size={14} color={ui.faint} /> Preview on phone (Phase 2)
          </div>
          <button
            onClick={() => router.push('/presets')}
            style={{ height: 34, padding: '0 14px', background: 'transparent', color: ui.sub, border: `1px solid ${ui.line}`, borderRadius: 8, fontWeight: 500, fontSize: 13, fontFamily: 'inherit', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            onClick={state.saving ? undefined : () => startTransition(() => { void handleSave(); })}
            style={{ height: 34, padding: '0 16px', background: ui.accent, color: '#fff', border: 'none', borderRadius: 8, fontWeight: 550, fontSize: 13, fontFamily: 'inherit', cursor: state.saving ? 'default' : 'pointer', opacity: state.saving ? 0.65 : 1 }}
          >
            {state.saving ? 'Saving…' : 'Save Preset'}
          </button>
        </div>
      </header>

      {/* INS-076: the versioning rule, stated right under the Save button. */}
      <div style={{ padding: '8px 24px', background: ui.fill, borderBottom: `1px solid ${ui.line}`, fontSize: 12, color: ui.sub, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <Repeat size={13} color={ui.faint} />
        <span>{saveRule}</span>
      </div>

      {state.saveError && (
        <div style={{ padding: '8px 24px', background: '#FEF2F2', borderBottom: `1px solid #FECACA`, fontSize: 12.5, color: '#DC2626' }}>
          {state.saveError}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        {/* Sidebar */}
        <div style={{ width: 320, background: '#fff', borderRight: `1px solid ${ui.line}`, padding: '24px 20px', display: 'flex', flexDirection: 'column', overflow: 'auto', flexShrink: 0 }}>
          <input
            value={state.presetName}
            onChange={(e) => set({ presetName: e.target.value })}
            placeholder="Loop name"
            style={{ ...titleInput, fontSize: 18, fontWeight: 600, marginBottom: 8, letterSpacing: -0.2, width: '100%' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11.5, color: ui.faint }}>AQL Level</span>
            {/* Only General Level II is implemented — the sampling engine and the API both enforce it. */}
            <select
              value={state.aqlLevel}
              onChange={(e) => set({ aqlLevel: e.target.value })}
              style={{ fontFamily: 'inherit', fontSize: 12, border: `1px solid ${ui.line}`, borderRadius: 6, padding: '2px 6px', color: ui.ink, background: '#fff' }}
            >
              <option value="II">II</option>
            </select>
          </div>
          <div style={{ fontSize: 11, color: ui.faint, marginBottom: 8 }}>
            ISO 2859-1 General Level II (MVP)
          </div>
          <textarea
            value={state.description}
            onChange={(e) => set({ description: e.target.value })}
            placeholder="Description (optional)"
            rows={2}
            style={{ fontFamily: 'inherit', fontSize: 12.5, color: ui.sub, border: `1px solid ${ui.line}`, borderRadius: 6, padding: '6px 8px', resize: 'none', outline: 'none', marginBottom: 4 }}
          />
          <div style={{ fontSize: 12, color: ui.sub, marginTop: 4, lineHeight: 1.5 }}>
            This name decides the version: an existing name saves as its next version, a new name
            starts at v1.
          </div>

          <div style={{ borderTop: `1px solid ${ui.line}`, margin: '20px 0 16px' }} />

          {/*
            INS-081: two groups. Defect tags and measurements belong to the LOOP,
            not to an item — putting them above the item list is what makes that
            obvious without a sentence of explanation.
          */}
          <div style={{ ...fieldLabel, marginBottom: 8 }}>Loop</div>
          <button
            onClick={() => set({ selection: { kind: 'defects' } })}
            style={sidebarRow(state.selection.kind === 'defects')}
          >
            <Tag size={14} color={ui.sub} />
            Defect tags
            <Mono style={{ marginLeft: 'auto', fontSize: 11, color: ui.faint }}>
              {state.allowedDefectCatalogIds.size}
            </Mono>
          </button>
          <button
            onClick={() => set({ selection: { kind: 'measurements' } })}
            style={sidebarRow(state.selection.kind === 'measurements')}
          >
            <Ruler size={14} color={ui.sub} />
            Measurements
            <Mono style={{ marginLeft: 'auto', fontSize: 11, color: ui.faint }}>
              {state.measurementFields.length}
            </Mono>
          </button>

          <div style={{ borderTop: `1px solid ${ui.line}`, margin: '18px 0 12px' }} />

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ ...fieldLabel, marginBottom: 0 }}>Items · {state.items.length}</div>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: ui.faint }}>one image each</div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {state.items.map((item, i) => {
              const active = state.selection.kind === 'item' && state.selection.index === i;
              const label = item.itemName || `Item ${String(i + 1).padStart(2, '0')}`;
              return (
                <div
                  key={item.id}
                  onClick={() => set({ selection: { kind: 'item', index: i } })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, background: active ? ui.accentSoft : 'transparent', borderLeft: active ? `2px solid ${ui.accent}` : '2px solid transparent', marginLeft: active ? -2 : 0, cursor: 'pointer' }}
                >
                  {/* Working reorder controls (INS-052) — keyboard-accessible. */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                    <button
                      aria-label={`Move ${label} up`}
                      disabled={i === 0}
                      onClick={(e) => { e.stopPropagation(); moveItem(i, -1); }}
                      style={{ ...iconBtn, width: 18, height: 14, opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? 'default' : 'pointer' }}
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      aria-label={`Move ${label} down`}
                      disabled={i === state.items.length - 1}
                      onClick={(e) => { e.stopPropagation(); moveItem(i, 1); }}
                      style={{ ...iconBtn, width: 18, height: 14, opacity: i === state.items.length - 1 ? 0.3 : 1, cursor: i === state.items.length - 1 ? 'default' : 'pointer' }}
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: ui.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {label}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 1 }}>
                      <ImageIcon size={10} color={item.referenceImage ? ui.accent : ui.faint} />
                      <Mono style={{ fontSize: 11, color: ui.faint }}>
                        {item.referenceImage ? 'reference set' : 'no reference'}
                      </Mono>
                    </div>
                  </div>
                  {state.items.length > 1 && (
                    <button
                      aria-label={`Remove ${label}`}
                      onClick={(e) => { e.stopPropagation(); removeItem(i); }}
                      style={{ ...iconBtn, flexShrink: 0 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <button
            onClick={addItem}
            style={{ marginTop: 8, height: 40, border: '1.5px dashed #C8D0DA', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: ui.sub, fontSize: 12.5, fontWeight: 500, background: 'transparent', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}
          >
            <Plus size={14} /> Add Loop Item
          </button>
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, padding: '28px 32px', overflow: 'auto', minWidth: 0 }}>
          {state.selection.kind === 'item' && activeItem && (
            <div style={{ maxWidth: 760 }}>
              <Mono style={{ fontSize: 12, color: ui.sub }}>
                ITEM {String(state.selection.index + 1).padStart(2, '0')}
              </Mono>
              <input
                value={activeItem.itemName}
                onChange={(e) => updateItemField(state.selection.kind === 'item' ? state.selection.index : 0, 'itemName', e.target.value)}
                placeholder="Item name (e.g. Right sleeve)"
                style={{ ...titleInput, fontSize: 22, fontWeight: 600, width: '100%', letterSpacing: -0.3, marginTop: 8, display: 'block' }}
              />
              <input
                value={activeItem.description}
                onChange={(e) => updateItemField(state.selection.kind === 'item' ? state.selection.index : 0, 'description', e.target.value)}
                placeholder="Description (optional)"
                style={{ ...titleInput, fontSize: 13, color: ui.sub, marginTop: 6, width: '100%', display: 'block' }}
              />

              <div style={{ marginTop: 28, maxWidth: 420 }}>
                <div style={fieldLabel}>Reference image</div>
                {/* One capture per item, so one reference illustration (INS-081). */}
                <input
                  ref={refImageInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleReferenceUpload(activeItem.id, file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  aria-label="Upload the reference image"
                  onClick={refUploading ? undefined : () => refImageInputRef.current?.click()}
                  style={{ width: 200, height: 200, borderRadius: 10, border: '1.5px dashed #C8D0DA', background: 'repeating-linear-gradient(135deg, #FAFBFC 0 8px, #F0F3F7 8px 16px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, color: ui.sub, cursor: refUploading ? 'default' : 'pointer', fontFamily: 'inherit', opacity: refUploading ? 0.6 : 1 }}
                >
                  <ImageIcon size={20} color={ui.sub} />
                  <div style={{ fontSize: 11, color: ui.faint }}>
                    {refUploading ? 'Uploading…' : <>Click to <span style={{ color: ui.accent }}>upload an image</span></>}
                  </div>
                </button>
                {refError && (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: '#DC2626', lineHeight: 1.4 }}>{refError}</div>
                )}
                {activeItem.referenceImage && (
                  <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px 0 10px', borderRadius: 6, border: `1px solid ${ui.line}`, background: '#fff', fontSize: 11.5, color: ui.sub }}>
                    <ImageIcon size={12} color={ui.faint} />
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={activeItem.referenceImage.name}>
                      {activeItem.referenceImage.name}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${activeItem.referenceImage.name}`}
                      onClick={() => removeReferenceImage(activeItem.id)}
                      style={{ ...iconBtn, width: 20, height: 20 }}
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 12, lineHeight: 1.45 }}>
                  This item takes exactly <Mono style={{ color: ui.sub }}>one</Mono> photo per unit
                  during populate. The reference sits beside the capture slot so the inspector is
                  matching, not guessing.
                </div>
              </div>
            </div>
          )}

          {state.selection.kind === 'defects' && (
            <div style={{ maxWidth: 760 }}>
              <Mono style={{ fontSize: 12, color: ui.sub }}>LOOP</Mono>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginTop: 8 }}>
                Defect tags
              </div>
              <div style={{ fontSize: 13, color: ui.sub, marginTop: 6 }}>
                One list for the whole loop. Every tag is available on every item during populate.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', marginTop: 24 }}>
                <div style={fieldLabel}>Severity-classified</div>
                <span style={{ marginLeft: 'auto', marginBottom: 8, fontSize: 11, color: ui.faint }}>
                  {state.allowedDefectCatalogIds.size} selected
                </span>
              </div>
              <div style={{ border: `1px solid ${ui.line}`, borderRadius: 10, background: '#fff', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {(['CRITICAL', 'MAJOR', 'MINOR'] as const).map((sev) => {
                  const items = defectsBySev[sev];
                  const sk = sevMap[sev];
                  const s = severity[sk];
                  return (
                    <div key={sev}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        <SeverityTag sev={sk} />
                        <Mono style={{ fontSize: 11, color: ui.faint }}>{items.length}</Mono>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {items.map((d) => {
                          const on = state.allowedDefectCatalogIds.has(d.id);
                          return (
                            <button
                              key={d.id}
                              onClick={() => toggleDefect(d.id)}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                height: 28,
                                padding: '0 10px',
                                borderRadius: 999,
                                fontSize: 12,
                                fontWeight: 500,
                                fontFamily: 'inherit',
                                cursor: 'pointer',
                                border: on ? 'none' : `1px solid ${ui.line}`,
                                background: on ? s.bg : ui.lineSoft,
                                color: on ? s.fg : ui.sub,
                              }}
                            >
                              {on && <span style={{ width: 6, height: 6, borderRadius: 999, background: s.dot }} />}
                              {d.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Custom defect row */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${ui.lineSoft}`, paddingTop: 12 }}>
                  <input
                    value={state.customDefectName}
                    onChange={(e) => set({ customDefectName: e.target.value })}
                    placeholder="Add custom defect tag…"
                    style={{ flex: 1, height: 34, border: `1px solid ${ui.line}`, borderRadius: 8, padding: '0 10px', fontSize: 12.5, color: ui.ink, fontFamily: 'inherit', outline: 'none' }}
                  />
                  <select
                    value={state.customDefectSeverity}
                    onChange={(e) => set({ customDefectSeverity: e.target.value as 'CRITICAL' | 'MAJOR' | 'MINOR' })}
                    style={{ height: 34, border: `1px solid ${ui.line}`, borderRadius: 8, padding: '0 8px', fontSize: 12, color: ui.sub, background: ui.fill, fontFamily: 'inherit' }}
                  >
                    <option value="CRITICAL">Critical</option>
                    <option value="MAJOR">Major</option>
                    <option value="MINOR">Minor</option>
                  </select>
                  <button
                    onClick={() => startTransition(() => { void handleAddCustomDefect(); })}
                    style={{ height: 34, padding: '0 14px', background: ui.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 550, fontFamily: 'inherit', cursor: 'pointer' }}
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Pass/fail info box */}
              <div style={{ marginTop: 28 }}>
                <div style={fieldLabel}>Pass / fail</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14, background: ui.accentSoft, border: '1px solid #CFE5FD', borderRadius: 10 }}>
                  <span style={{ width: 18, height: 18, borderRadius: 999, background: ui.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, fontFamily: 'Georgia, serif', flexShrink: 0, marginTop: 1 }}>i</span>
                  <div style={{ fontSize: 12.5, color: '#1457A3', lineHeight: 1.5 }}>
                    <b style={{ fontWeight: 600 }}>Pass / fail is decided at the inspection level.</b> The system flags the result from the AQL plan (defect counts by class vs. Accept / Reject) and a QA Manager makes the binding call. The loop only collects evidence — there are no per-item verdicts.
                  </div>
                </div>
              </div>
            </div>
          )}

          {state.selection.kind === 'measurements' && (
            <div style={{ maxWidth: 760 }}>
              <Mono style={{ fontSize: 12, color: ui.sub }}>LOOP</Mono>
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: -0.3, marginTop: 8 }}>
                Measurements
              </div>
              <div style={{ fontSize: 13, color: ui.sub, marginTop: 6 }}>
                One sheet for the whole loop, filled once per unit during populate.
              </div>

              <div style={{ marginTop: 24 }}>
                <div style={fieldLabel}>Fields · free-form</div>
                <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
                  {state.measurementFields.map((f, i) => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: i ? `1px solid ${ui.lineSoft}` : 'none' }}>
                      <input
                        value={f.label}
                        onChange={(e) => updateMeasurementField(f.id, 'label', e.target.value)}
                        placeholder="Field label"
                        style={rowInput}
                      />
                      <input
                        value={f.unit}
                        onChange={(e) => updateMeasurementField(f.id, 'unit', e.target.value)}
                        placeholder="unit"
                        style={{ width: 70, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, color: ui.sub, background: ui.fill, outline: 'none' }}
                      />
                      <button
                        aria-label={`Remove ${f.label || 'field'}`}
                        onClick={() => removeMeasurementField(f.id)}
                        style={iconBtn}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={addMeasurementField}
                    style={{ width: '100%', padding: '10px 12px', borderTopWidth: state.measurementFields.length ? 1 : 0, borderTopStyle: 'solid', borderTopColor: ui.lineSoft, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0, display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 12.5, fontWeight: 500, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                  >
                    <Plus size={14} /> Add measurement field
                  </button>
                </div>
                <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 8, lineHeight: 1.45 }}>
                  Fields are labels only (with an optional unit). Values are entered free-form once
                  per unit during populate — no target/tolerance in the MVP.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
