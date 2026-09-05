'use client';

import { useActionState, useEffect, useRef, useState, useTransition } from 'react';
import { Image as ImageIcon, Upload } from 'lucide-react';
import { Btn } from '@/components/inspect/shell';
import { ErrorBanner } from '@/components/inspect/error-banner';
import { Field, Input, Select, Textarea } from '@/components/inspect/field';
import { mono, ui } from '@/components/inspect/tokens';
import type { ApiCompany, ApiLoopPreset } from '@/lib/api';
import { archiveCompany, presignCompanyLogo, updateCompany } from '../../dashboard/actions';

/**
 * INS-055 — ONE company form, merging the old buyer form (logo, brand colour,
 * default preset) and the old supplier form (address, GPS).
 *
 * The two field groups are labelled by the ROLE they matter in, not by what the
 * company "is": branding is used when this company is the client on an
 * inspection, location when it is the factory. A company can be both, on
 * different POs, so both groups are always editable.
 */

// Form primitives live in components/inspect/field.tsx (INS-092).
const row = { marginBottom: 16 };
const sectionHead = { fontSize: 11, fontWeight: 700, color: ui.faint, textTransform: 'uppercase' as const, letterSpacing: 0.6, margin: '4px 0 12px' };

/** The one shape the API accepts for primaryColor (INS-077) — mirrored for a live hint only. */
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isAbsoluteUrl = (v: string) => /^https?:\/\//i.test(v);

export function EditCompanyForm({ company, presets }: { company: ApiCompany; presets: ApiLoopPreset[] }) {
  const [state, action, pending] = useActionState(updateCompany, {});
  const [archivePending, startArchive] = useTransition();
  // A failed archive used to be silently discarded — the button just stopped
  // spinning. Surface the server action's {error} like every other mutation.
  const [archiveError, setArchiveError] = useState<string | null>(null);

  // ── Logo (INS-072) ────────────────────────────────────────────
  // `logoKey` is the DURABLE value submitted with the form: an object key from
  // POST /companies/presign, or a legacy absolute URL carried through untouched.
  // The ~900s presigned URL is display-only and must never reach the API — it
  // freezes into the Ed25519-signed report brandingSnapshot, where it would rot
  // forever.
  const initialKey = company.logoUrl ?? '';
  const initialView = company.logoViewUrl ?? (isAbsoluteUrl(initialKey) ? initialKey : null);
  const [logoKey, setLogoKey] = useState(initialKey);
  const [freshPreview, setFreshPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = logoKey === '' ? null : freshPreview ?? (logoKey === initialKey ? initialView : null);

  // The just-uploaded preview is a blob: URL owned by this document. This cleanup
  // is the ONE place it is released — it runs both when the value is replaced and
  // on unmount, so the setters stay side-effect free.
  useEffect(() => {
    if (!freshPreview) return;
    return () => URL.revokeObjectURL(freshPreview);
  }, [freshPreview]);

  async function handleLogoUpload(file: File) {
    setLogoError(null);
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase();
      const presign = await presignCompanyLogo(ext);
      if (presign.error || !presign.data) {
        setLogoError(presign.error ?? 'Could not prepare the upload.');
        return;
      }
      const { storageKey, uploadUrl } = presign.data;
      // Two distinct failure modes: fetch() only *rejects* on a transport-level
      // failure — offline, DNS/TLS, or a CORS preflight the bucket refused, so the
      // bytes never left the browser. An HTTP error status resolves normally and
      // means storage answered and said no.
      let res: Response;
      try {
        res = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
      } catch {
        setLogoError('Could not reach object storage — the upload never left the browser (network or CORS). The company can still be saved without a new logo.');
        return;
      }
      if (!res.ok) {
        setLogoError(`Upload rejected by object storage (${res.status}). The company can still be saved without a new logo.`);
        return;
      }
      setFreshPreview(URL.createObjectURL(file));
      setLogoKey(storageKey);
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : 'Logo upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function removeLogo() {
    setFreshPreview(null);
    setLogoKey('');
    setLogoError(null);
  }

  // ── Brand colour (INS-077) ────────────────────────────────────
  // The text field is the submitted source of truth so an invalid value actually
  // reaches the API and its 400 surfaces above; the picker is a synced companion
  // (it can only ever produce #rrggbb) and is deliberately unnamed.
  const [hex, setHex] = useState(company.primaryColor ?? ui.accent);
  const [swatch, setSwatch] = useState(HEX_RE.test(company.primaryColor ?? '') ? (company.primaryColor as string).toLowerCase() : ui.accent);
  const hexInvalid = hex.trim() !== '' && !HEX_RE.test(hex.trim());
  function setHexFromText(v: string) {
    setHex(v);
    if (HEX_RE.test(v.trim())) setSwatch(v.trim().toLowerCase());
  }
  function setHexFromPicker(v: string) {
    setHex(v);
    setSwatch(v);
  }

  return (
    <div style={{ marginTop: 24, maxWidth: 560 }}>
      <div style={{ background: '#fff', border: `1px solid ${ui.line}`, borderRadius: 12, padding: '24px 28px' }}>
        <form action={action}>
          <input type="hidden" name="id" value={company.id} />
          {/* The durable key — never the presigned preview URL. */}
          <input type="hidden" name="logoUrl" value={logoKey} />
          {state.error && <ErrorBanner style={{ marginBottom: 14 }}>{state.error}</ErrorBanner>}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
            <Field label="Name *" htmlFor="company-name">
              <Input id="company-name" name="name" defaultValue={company.name} required />
            </Field>
            <Field label="Ownership" htmlFor="company-kind">
              <Select id="company-kind" name="kind" defaultValue={company.kind}>
                <option value="THIRD_PARTY">Third-party</option>
                <option value="INTERNAL">Internal (our own site)</option>
              </Select>
            </Field>
          </div>

          <div style={sectionHead}>As a client — report branding</div>

          <Field label="Logo" error={logoError} style={row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 56, height: 56, borderRadius: 8, border: `1px solid ${ui.line}`, background: ui.fill, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
                {preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={preview} alt={`${company.name} logo`} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                ) : (
                  <ImageIcon size={18} color={ui.faint} />
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleLogoUpload(file);
                  e.target.value = '';
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', color: ui.accent, fontSize: 12.5, fontWeight: 550, fontFamily: 'inherit', cursor: uploading ? 'default' : 'pointer', opacity: uploading ? 0.6 : 1 }}
                  >
                    <Upload size={14} /> {uploading ? 'Uploading…' : preview ? 'Replace' : 'Upload logo'}
                  </button>
                  {logoKey !== '' && !uploading && (
                    <button
                      type="button"
                      onClick={removeLogo}
                      style={{ height: 32, padding: '0 12px', border: `1px solid ${ui.line}`, borderRadius: 8, background: '#fff', color: ui.sub, fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer' }}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <span style={{ ...mono, fontSize: 11, color: ui.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 320 }} title={logoKey || undefined}>
                  {logoKey === '' ? 'No logo' : isAbsoluteUrl(logoKey) ? logoKey : logoKey.split('/').pop()}
                </span>
              </div>
            </div>
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            <Field label="Brand Color" error={hexInvalid ? 'Expected #RRGGBB.' : undefined}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="color"
                  aria-label="Pick brand color"
                  value={swatch}
                  onChange={(e) => setHexFromPicker(e.target.value)}
                  style={{ width: 44, height: 36, padding: '2px 4px', border: `1px solid ${ui.line}`, borderRadius: 8, cursor: 'pointer', flexShrink: 0 }}
                />
                <Input
                  name="primaryColor"
                  aria-label="Brand color hex value"
                  value={hex}
                  onChange={(e) => setHexFromText(e.target.value)}
                  placeholder="#1457A3"
                  spellCheck={false}
                  invalid={hexInvalid}
                  style={mono}
                />
              </div>
            </Field>
            <Field label="Default Preset" htmlFor="company-preset">
              <Select id="company-preset" name="defaultLoopPresetId" defaultValue={company.defaultLoopPresetId ?? ''}>
                <option value="">None</option>
                {presets.map((p) => <option key={p.id} value={p.id}>{p.name} (v{p.version})</option>)}
              </Select>
            </Field>
          </div>

          <div style={sectionHead}>As a factory — location</div>

          <Field label="Address" htmlFor="company-address" style={row}>
            <Textarea id="company-address" name="address" rows={2} defaultValue={company.address ?? ''} placeholder="City, Country" style={{ resize: 'none' }} />
          </Field>

          {/*
            INS-071: a structured numeric pair. The old single JSON field's
            JSON.parse sat in an EMPTY catch, so a mistyped brace saved the row
            with no coordinates and no error. Range checks stay on the API.
          */}
          <Field label="GPS coordinates" hint="Decimal degrees — leave both blank for no pin." style={{ marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Input name="lat" type="number" step="any" min={-90} max={90} inputMode="decimal" aria-label="Latitude"
                defaultValue={company.gps ? String(company.gps.lat) : ''} placeholder="Latitude (−90…90)" style={mono} />
              <Input name="lng" type="number" step="any" min={-180} max={180} inputMode="decimal" aria-label="Longitude"
                defaultValue={company.gps ? String(company.gps.lng) : ''} placeholder="Longitude (−180…180)" style={mono} />
            </div>
          </Field>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Btn kind="ghost" href="/dashboard">Cancel</Btn>
            <Btn kind="primary" type="submit" loading={pending}>
              {pending ? 'Saving…' : 'Save changes'}
            </Btn>
          </div>
        </form>
      </div>

      <div style={{ marginTop: 24, padding: '18px 20px', background: '#FFF8F8', border: '1px solid #FECACA', borderRadius: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: ui.danger }}>Archive company</div>
        <div style={{ fontSize: 12.5, color: ui.sub, marginBottom: 12 }}>Archiving removes this company from the active list. Historical purchase orders, inspections and reports are preserved.</div>
        {archiveError ? (
          <div style={{ fontSize: 12.5, color: ui.danger, marginBottom: 10 }}>{archiveError}</div>
        ) : null}
        <button
          onClick={() =>
            startArchive(async () => {
              setArchiveError(null);
              const result = await archiveCompany(company.id);
              // A successful archive redirects and never returns; a return
              // value is always the failure shape.
              if (result?.error) setArchiveError(result.error);
            })
          }
          disabled={archivePending}
          style={{ height: 34, padding: '0 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, fontFamily: 'inherit', border: '1px solid #FECACA', background: '#FEF2F2', color: ui.danger, cursor: archivePending ? 'default' : 'pointer', opacity: archivePending ? 0.6 : 1 }}
        >
          {archivePending ? 'Archiving…' : 'Archive company'}
        </button>
      </div>
    </div>
  );
}
