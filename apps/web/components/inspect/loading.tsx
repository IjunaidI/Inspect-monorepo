'use client';

import type { CSSProperties } from 'react';
import { ui } from './tokens';

/**
 * Shared loading affordances for the console.
 *
 * Three distinct moments, three different indicators:
 *   - Spinner   — a CTA is busy (server action in flight). Sits inside the button.
 *   - TopBar    — a route is being rendered on the server. Pinned to the top of
 *                 the screen so it reads as "the page is coming", not "this
 *                 control is stuck".
 *   - Skeleton  — the shape of content that has not arrived yet (loading.tsx).
 *
 * All three are indeterminate on purpose: a Server Component render gives us no
 * progress signal, and a fake percentage that stalls at 90% is worse than an
 * honest sweep. Keyframes live in globals.css (inline styles cannot express
 * them) and are disabled under prefers-reduced-motion.
 */

export function Spinner({
  size = 14,
  color,
  style,
}: {
  size?: number;
  /** Defaults to currentColor so it inherits the button's text colour. */
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className="inspect-spin"
      role="status"
      aria-label="Loading"
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        borderRadius: '50%',
        borderWidth: Math.max(1.5, size / 9),
        borderStyle: 'solid',
        borderColor: 'currentColor',
        // The transparent quadrant is what makes the rotation legible.
        borderTopColor: 'transparent',
        color: color ?? 'currentColor',
        opacity: 0.9,
        animation: 'inspect-spin 0.6s linear infinite',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/**
 * Indeterminate top progress bar. Rendered by route-level loading.tsx, so it
 * appears the moment a navigation starts and disappears when the segment's
 * Server Components resolve — no client-side route interception needed.
 */
export function TopBar() {
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label="Loading page"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 2,
        background: 'transparent',
        overflow: 'hidden',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    >
      <div
        className="inspect-indeterminate"
        style={{
          width: '100%',
          height: '100%',
          background: `linear-gradient(90deg, transparent, ${ui.accent}, transparent)`,
          animation: 'inspect-indeterminate 1.1s ease-in-out infinite',
        }}
      />
    </div>
  );
}

/** A single grey block standing in for content that has not loaded yet. */
export function Skeleton({
  width = '100%',
  height = 14,
  radius = 6,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="inspect-pulse"
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: radius,
        background: ui.lineSoft,
        animation: 'inspect-pulse 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  );
}

/**
 * The default skeleton for a console screen: page heading + a card of rows.
 * Mirrors the real layout closely enough that the swap-in is not a jolt.
 */
export function PageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div style={{ padding: '28px 32px' }}>
      <TopBar />
      <Skeleton width={220} height={22} radius={7} />
      <Skeleton width={340} height={13} style={{ marginTop: 10 }} />
      <div
        style={{
          marginTop: 24,
          background: ui.panel,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: ui.line,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '15px 20px',
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopStyle: 'solid',
              borderTopColor: ui.lineSoft,
            }}
          >
            <Skeleton width={30} height={30} radius={999} />
            <Skeleton width={`${28 + ((i * 11) % 22)}%`} height={13} />
            <Skeleton width={`${16 + ((i * 7) % 14)}%`} height={13} />
            <Skeleton width={70} height={13} style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
