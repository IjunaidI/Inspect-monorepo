'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Image as ImageIcon,
  Minus,
  Plus,
  Repeat,
  Smartphone,
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

interface StepDraft {
  id: string;
  zoneName: string;
  description: string;
  requiredShotCount: number;
  measurementFields: MeasurementFieldDraft[];
  allowedDefectCatalogIds: Set<string>;
  referenceImages: ReferenceImageDraft[];
}

interface BuilderState {
  presetName: string;
  description: string;
  aqlLevel: string;
  steps: StepDraft[];
  activeStepIndex: number;
  customDefectName: string;
  customDefectSeverity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  saving: boolean;
  saveError: string | null;
}

interface PresetBuilderProps {
  catalog: ApiDefectCatalog[];
  seed?: ApiLoopPresetDetail;
}

function blankStep(name = ''): StepDraft {
  return {
    id: crypto.randomUUID(),
    zoneName: name,
    description: '',
    requiredShotCount: 1,
    measurementFields: [],
    allowedDefectCatalogIds: new Set(),
    referenceImages: [],
  };
}

function initFromSeed(seed: ApiLoopPresetDetail): BuilderState {
  return {
    presetName: seed.name,
    description: seed.description ?? '',
    // Only General Level II is implemented (the API rejects anything else).
    aqlLevel: 'II',
    steps: seed.steps.map((s) => ({
      id: crypto.randomUUID(),
      zoneName: s.zoneName,
      description: s.description ?? '',
      requiredShotCount: s.requiredShotCount,
      measurementFields: s.measurementFields.map((f) => ({
        id: crypto.randomUUID(),
        label: f.label,
        unit: f.unit ?? '',
      })),
      allowedDefectCatalogIds: new Set(s.allowedDefects.map((a) => a.defectCatalog.id)),
      referenceImages: (s.referenceImageUrls ?? []).map((key) => ({
        key,
        name: key.split('/').pop() ?? key,
      })),
    })),
    activeStepIndex: 0,
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

export default function PresetBuilder({ catalog, seed }: PresetBuilderProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [extraDefects, setExtraDefects] = useState<ApiDefectCatalog[]>([]);
  const refImageInputRef = useRef<HTMLInputElement>(null);
  const [refUploading, setRefUploading] = useState(false);
  const [refError, setRefError] = useState<string | null>(null);
  const [state, setState] = useState<BuilderState>(
    seed ? initFromSeed(seed) : {
      presetName: '',
      description: '',
      aqlLevel: 'II',
      steps: [blankStep('Loop 01')],
      activeStepIndex: 0,
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

  function addStep() {
    setState((prev) => {
      const newStep = blankStep(`Loop ${String(prev.steps.length + 1).padStart(2, '0')}`);
      return { ...prev, steps: [...prev.steps, newStep], activeStepIndex: prev.steps.length };
    });
  }

  function removeStep(index: number) {
    setState((prev) => {
      const steps = prev.steps.filter((_, i) => i !== index);
      const activeStepIndex = Math.min(prev.activeStepIndex, Math.max(0, steps.length - 1));
      return { ...prev, steps, activeStepIndex };
    });
  }

  /** Swap a loop with its neighbor (INS-052) — positions derive from array order at submit. */
  function moveStep(index: number, delta: -1 | 1) {
    setState((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.steps.length) return prev;
      const steps = [...prev.steps];
      [steps[index], steps[target]] = [steps[target], steps[index]];
      let activeStepIndex = prev.activeStepIndex;
      if (prev.activeStepIndex === index) activeStepIndex = target;
      else if (prev.activeStepIndex === target) activeStepIndex = index;
      return { ...prev, steps, activeStepIndex };
    });
  }

  /**
   * Reference-image upload (INS-052): presign via the API, PUT the bytes
   * directly to storage, then attach the storage key to this loop. Failures
   * surface inline and never block saving the preset without images.
   */
  async function handleReferenceUpload(stepIndex: number, file: File) {
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
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
      });
      if (!res.ok) {
        setRefError(`Image upload failed (${res.status}). The preset can still be saved without it.`);
        return;
      }
      setState((prev) => ({
        ...prev,
        steps: prev.steps.map((s, i) =>
          i === stepIndex
            ? { ...s, referenceImages: [...s.referenceImages, { key: storageKey, name: file.name }] }
            : s,
        ),
      }));
    } catch (e) {
      setRefError(e instanceof Error ? e.message : 'Image upload failed.');
    } finally {
      setRefUploading(false);
    }
  }

  function removeReferenceImage(stepIndex: number, key: string) {
    setState((prev) => ({
      ...prev,
      steps: prev.steps.map((s, i) =>
        i === stepIndex
          ? { ...s, referenceImages: s.referenceImages.filter((r) => r.key !== key) }
          : s,
      ),
    }));
  }

  function updateStepField<K extends keyof StepDraft>(index: number, field: K, value: StepDraft[K]) {
    setState((prev) => {
      const steps = prev.steps.map((s, i) => (i === index ? { ...s, [field]: value } : s));
      return { ...prev, steps };
    });
  }

  function incrementShots(index: number) {
    setState((prev) => {
      const steps = prev.steps.map((s, i) =>
        i === index ? { ...s, requiredShotCount: s.requiredShotCount + 1 } : s,
      );
      return { ...prev, steps };
    });
  }

  function decrementShots(index: number) {
    setState((prev) => {
      const steps = prev.steps.map((s, i) =>
        i === index ? { ...s, requiredShotCount: Math.max(1, s.requiredShotCount - 1) } : s,
      );
      return { ...prev, steps };
    });
  }

  function addMeasurementField(stepIndex: number) {
    setState((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIndex) return s;
        return {
          ...s,
          measurementFields: [
            ...s.measurementFields,
            { id: crypto.randomUUID(), label: '', unit: '' },
          ],
        };
      });
      return { ...prev, steps };
    });
  }

  function updateMeasurementField(
    stepIndex: number,
    fieldId: string,
    key: 'label' | 'unit',
    value: string,
  ) {
    setState((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIndex) return s;
        return {
          ...s,
          measurementFields: s.measurementFields.map((f) =>
            f.id === fieldId ? { ...f, [key]: value } : f,
          ),
        };
      });
      return { ...prev, steps };
    });
  }

  function removeMeasurementField(stepIndex: number, fieldId: string) {
    setState((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIndex) return s;
        return {
          ...s,
          measurementFields: s.measurementFields.filter((f) => f.id !== fieldId),
        };
      });
      return { ...prev, steps };
    });
  }

  function toggleDefect(stepIndex: number, defectCatalogId: string) {
    setState((prev) => {
      const steps = prev.steps.map((s, i) => {
        if (i !== stepIndex) return s;
        const ids = new Set(s.allowedDefectCatalogIds);
        if (ids.has(defectCatalogId)) ids.delete(defectCatalogId);
        else ids.add(defectCatalogId);
        return { ...s, allowedDefectCatalogIds: ids };
      });
      return { ...prev, steps };
    });
  }

  async function handleAddCustomDefect(stepIndex: number) {
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
      toggleDefect(stepIndex, result.data.id);
    }
  }

  async function handleSave() {
    set({ saving: true, saveError: null });
    const activeStep = state.steps[state.activeStepIndex];
    const input: CreatePresetInput = {
      name: state.presetName,
      description: state.description || undefined,
      aqlLevel: state.aqlLevel || undefined,
      steps: state.steps.map((s) => ({
        zoneName: s.zoneName,
        description: s.description || undefined,
        referenceImageUrls: s.referenceImages.map((r) => r.key),
        requiredShotCount: s.requiredShotCount,
        measurementFields: s.measurementFields.map((f) => ({
          label: f.label,
          unit: f.unit || undefined,
        })),
        allowedDefectCatalogIds: Array.from(s.allowedDefectCatalogIds),
      })),
    };
    // suppress unused warning
    void activeStep;
    const result = await createPreset(input);
    if (result?.error) {
      set({ saving: false, saveError: result.error });
    }
    // On success, createPreset redirects — no client redirect needed
  }

  const activeStep = state.steps[state.activeStepIndex];

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

  const totalShots = state.steps.reduce((a, s) => a + s.requiredShotCount, 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header style={{ height: 56, borderBottom: `1px solid ${ui.line}`, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 24px', gap: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 13 }}>
          <Repeat size={15} color={ui.sub} />
          <span>Loop Presets</span>
          <ChevronRight size={14} color={ui.faint} />
          <span style={{ color: ui.ink, fontWeight: 550 }}>
            {state.presetName || 'New Preset'}
          </span>
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
            placeholder="Preset name"
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
            Editing creates a new version; historical inspections keep their snapshot.
          </div>

          <div style={{ borderTop: `1px solid ${ui.line}`, margin: '20px 0 16px' }} />

          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ ...fieldLabel, marginBottom: 0 }}>Loops · {state.steps.length}</div>
            <div style={{ marginLeft: 'auto', fontSize: 12, color: ui.faint }}>
              <Mono>{totalShots}</Mono> shots
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {state.steps.map((step, i) => {
              const active = i === state.activeStepIndex;
              return (
                <div
                  key={step.id}
                  onClick={() => set({ activeStepIndex: i })}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, borderRadius: 8, background: active ? ui.accentSoft : 'transparent', borderLeft: active ? `2px solid ${ui.accent}` : '2px solid transparent', marginLeft: active ? -2 : 0, cursor: 'pointer' }}
                >
                  {/* Working reorder controls (INS-052) — keyboard-accessible, replace the decorative drag handle. */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 0, flexShrink: 0 }}>
                    <button
                      aria-label={`Move ${step.zoneName || `Loop ${String(i + 1).padStart(2, '0')}`} up`}
                      disabled={i === 0}
                      onClick={(e) => { e.stopPropagation(); moveStep(i, -1); }}
                      style={{ ...iconBtn, width: 18, height: 14, opacity: i === 0 ? 0.3 : 1, cursor: i === 0 ? 'default' : 'pointer' }}
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      aria-label={`Move ${step.zoneName || `Loop ${String(i + 1).padStart(2, '0')}`} down`}
                      disabled={i === state.steps.length - 1}
                      onClick={(e) => { e.stopPropagation(); moveStep(i, 1); }}
                      style={{ ...iconBtn, width: 18, height: 14, opacity: i === state.steps.length - 1 ? 0.3 : 1, cursor: i === state.steps.length - 1 ? 'default' : 'pointer' }}
                    >
                      <ChevronDown size={12} />
                    </button>
                  </div>
                  <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: ui.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {step.zoneName || `Loop ${String(i + 1).padStart(2, '0')}`}
                    </div>
                    <Mono style={{ fontSize: 11, color: ui.faint, marginTop: 1 }}>
                      {step.requiredShotCount} shots · {step.allowedDefectCatalogIds.size} tags
                    </Mono>
                  </div>
                  {state.steps.length > 1 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeStep(i); }}
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
            onClick={addStep}
            style={{ marginTop: 8, height: 40, border: '1.5px dashed #C8D0DA', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, color: ui.sub, fontSize: 12.5, fontWeight: 500, background: 'transparent', cursor: 'pointer', width: '100%', fontFamily: 'inherit' }}
          >
            <Plus size={14} /> Add Loop
          </button>
        </div>

        {/* Main panel */}
        <div style={{ flex: 1, padding: '28px 32px', overflow: 'auto', minWidth: 0 }}>
          {activeStep && (
            <div style={{ maxWidth: 760 }}>
              <Mono style={{ fontSize: 12, color: ui.sub }}>
                LOOP {String(state.activeStepIndex + 1).padStart(2, '0')}
              </Mono>
              <input
                value={activeStep.zoneName}
                onChange={(e) => updateStepField(state.activeStepIndex, 'zoneName', e.target.value)}
                placeholder="Loop name"
                style={{ ...titleInput, fontSize: 22, fontWeight: 600, width: '100%', letterSpacing: -0.3, marginTop: 8, display: 'block' }}
              />
              <input
                value={activeStep.description}
                onChange={(e) => updateStepField(state.activeStepIndex, 'description', e.target.value)}
                placeholder="Description (optional)"
                style={{ ...titleInput, fontSize: 13, color: ui.sub, marginTop: 6, width: '100%', display: 'block' }}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 28, marginTop: 28 }}>
                <div>
                  <div style={fieldLabel}>Reference · {activeStep.referenceImages.length}</div>
                  {/* Real reference-image upload (INS-052): presigned PUT straight to storage. */}
                  <input
                    ref={refImageInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleReferenceUpload(state.activeStepIndex, file);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Upload a reference image"
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
                  {activeStep.referenceImages.length > 0 && (
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {activeStep.referenceImages.map((img) => (
                        <div key={img.key} style={{ display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 8px 0 10px', borderRadius: 6, border: `1px solid ${ui.line}`, background: '#fff', fontSize: 11.5, color: ui.sub }}>
                          <ImageIcon size={12} color={ui.faint} />
                          <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={img.name}>{img.name}</span>
                          <button
                            type="button"
                            aria-label={`Remove ${img.name}`}
                            onClick={() => removeReferenceImage(state.activeStepIndex, img.key)}
                            style={{ ...iconBtn, width: 20, height: 20 }}
                          >
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 28, minWidth: 0 }}>
                  {/* Shots counter */}
                  <div>
                    <div style={fieldLabel}>Required shots · {activeStep.requiredShotCount}</div>
                    <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
                      {Array.from({ length: activeStep.requiredShotCount }, (_, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: i ? `1px solid ${ui.lineSoft}` : 'none' }}>
                          <Mono style={{ fontSize: 11, color: ui.faint, minWidth: 18 }}>{String(i + 1).padStart(2, '0')}</Mono>
                          <span style={{ flex: 1, fontSize: 13, color: ui.sub }}>
                            Shot {String(i + 1).padStart(2, '0')}
                          </span>
                        </div>
                      ))}
                      <div style={{ padding: '10px 12px', borderTop: `1px solid ${ui.lineSoft}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          onClick={() => decrementShots(state.activeStepIndex)}
                          style={{ ...iconBtn, border: `1px solid ${ui.line}`, color: ui.sub }}
                        >
                          <Minus size={13} />
                        </button>
                        <span style={{ fontSize: 12.5, color: ui.sub, fontWeight: 500 }}>
                          {activeStep.requiredShotCount} shot{activeStep.requiredShotCount !== 1 ? 's' : ''}
                        </span>
                        <button
                          onClick={() => incrementShots(state.activeStepIndex)}
                          style={{ ...iconBtn, border: `1px solid ${ui.line}`, color: ui.sub }}
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Defect picker */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={fieldLabel}>Defect tags · severity-classified</div>
                      <span style={{ marginLeft: 'auto', marginBottom: 8, fontSize: 11, color: ui.faint }}>
                        {activeStep.allowedDefectCatalogIds.size} selected
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
                                const on = activeStep.allowedDefectCatalogIds.has(d.id);
                                return (
                                  <button
                                    key={d.id}
                                    onClick={() => toggleDefect(state.activeStepIndex, d.id)}
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
                          onClick={() => startTransition(() => { void handleAddCustomDefect(state.activeStepIndex); })}
                          style={{ height: 34, padding: '0 14px', background: ui.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 550, fontFamily: 'inherit', cursor: 'pointer' }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Measurement fields */}
                  <div>
                    <div style={fieldLabel}>Measurement fields · free-form</div>
                    <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 10, overflow: 'hidden' }}>
                      {activeStep.measurementFields.map((f, i) => (
                        <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderTop: i ? `1px solid ${ui.lineSoft}` : 'none' }}>
                          <input
                            value={f.label}
                            onChange={(e) => updateMeasurementField(state.activeStepIndex, f.id, 'label', e.target.value)}
                            placeholder="Field label"
                            style={rowInput}
                          />
                          <input
                            value={f.unit}
                            onChange={(e) => updateMeasurementField(state.activeStepIndex, f.id, 'unit', e.target.value)}
                            placeholder="unit"
                            style={{ width: 70, fontFamily: 'inherit', border: `1px solid ${ui.line}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, color: ui.sub, background: ui.fill, outline: 'none' }}
                          />
                          <button
                            onClick={() => removeMeasurementField(state.activeStepIndex, f.id)}
                            style={iconBtn}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => addMeasurementField(state.activeStepIndex)}
                        style={{ width: '100%', padding: '10px 12px', borderTopWidth: activeStep.measurementFields.length ? 1 : 0, borderTopStyle: 'solid', borderTopColor: ui.lineSoft, borderRightWidth: 0, borderBottomWidth: 0, borderLeftWidth: 0, display: 'flex', alignItems: 'center', gap: 8, color: ui.sub, fontSize: 12.5, fontWeight: 500, background: 'transparent', fontFamily: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                      >
                        <Plus size={14} /> Add measurement field
                      </button>
                    </div>
                    <div style={{ fontSize: 11.5, color: ui.faint, marginTop: 8, lineHeight: 1.45 }}>
                      Fields are labels only (with an optional unit). Values are entered free-form during populate — no target/tolerance in the MVP.
                    </div>
                  </div>

                  {/* Pass/fail info box */}
                  <div>
                    <div style={fieldLabel}>Pass / fail</div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: 14, background: ui.accentSoft, border: '1px solid #CFE5FD', borderRadius: 10 }}>
                      <span style={{ width: 18, height: 18, borderRadius: 999, background: ui.accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, fontFamily: 'Georgia, serif', flexShrink: 0, marginTop: 1 }}>i</span>
                      <div style={{ fontSize: 12.5, color: '#1457A3', lineHeight: 1.5 }}>
                        <b style={{ fontWeight: 600 }}>Pass / fail is decided at the inspection level.</b> The system flags the result from the AQL plan (defect counts by class vs. Accept / Reject) and a QA Manager makes the binding call. Loops only collect evidence — there are no per-loop verdicts.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
