import { Skeleton, TopBar } from '@/components/inspect/loading';
import { ui } from '@/components/inspect/tokens';

/**
 * Dashboard-specific skeleton. The generic PageSkeleton would misrepresent this
 * screen badly: it opens with two 5-up stat-tile rows, and the tiles are the
 * slowest part (GET /dashboard/summary rolls up every inspection in the org).
 * Matching the real grid keeps the swap-in from shifting layout.
 */
function TileRowSkeleton() {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          style={{
            background: ui.panel,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: ui.line,
            borderRadius: 10,
            padding: '12px 16px',
          }}
        >
          <Skeleton width="60%" height={10} />
          <Skeleton width={54} height={20} style={{ marginTop: 8 }} />
          <Skeleton width="80%" height={10} style={{ marginTop: 6 }} />
        </div>
      ))}
    </div>
  );
}

export default function DashboardLoading() {
  return (
    <div style={{ padding: '28px 32px' }}>
      <TopBar />
      <Skeleton width={230} height={22} radius={7} />
      <Skeleton width={430} height={13} style={{ marginTop: 10 }} />

      <div style={{ display: 'grid', gap: 12, marginTop: 20 }}>
        <TileRowSkeleton />
        <TileRowSkeleton />
      </div>

      <div
        style={{
          marginTop: 20,
          background: ui.panel,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: ui.line,
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {Array.from({ length: 5 }, (_, i) => (
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
            <Skeleton width={34} height={34} radius={999} />
            <Skeleton width={`${26 + ((i * 13) % 20)}%`} height={13} />
            <Skeleton width={90} height={13} style={{ marginLeft: 'auto' }} />
          </div>
        ))}
      </div>
    </div>
  );
}
