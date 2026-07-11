import { apiGet, loadOrFallback, type ApiBuyer, type ApiLoopPreset, type ApiSupplier } from '@/lib/api';
import { PageHead } from '@/components/inspect/shell';
import { DirectoryClient } from './directory-client';

export const dynamic = 'force-dynamic';

const DEMO_BUYERS: ApiBuyer[] = [
  { id: 'demo-b1', name: 'Nordvik Retail Group', primaryColor: '#1457A3' },
  { id: 'demo-b2', name: 'Maison Adèle', primaryColor: '#0B7D6B' },
  { id: 'demo-b3', name: 'Beaumont Living', primaryColor: '#C2410C' },
  { id: 'demo-b4', name: 'Kestrel & Thorne', primaryColor: '#7C3AED' },
  { id: 'demo-b5', name: 'Hudson & Field', primaryColor: '#B5791A' },
  { id: 'demo-b6', name: 'Sundsvall Home', primaryColor: '#0B1220' },
];
const DEMO_SUPPLIERS: ApiSupplier[] = [
  { id: 'demo-s1', name: 'Tirupur Knits Unit-3', address: 'Tirupur, India', gps: { lat: 11.1085, lng: 77.3411 } },
  { id: 'demo-s2', name: 'Dhaka Weave Ltd.', address: 'Dhaka, Bangladesh', gps: { lat: 23.8103, lng: 90.4125 } },
  { id: 'demo-s3', name: 'Karachi Home Mills', address: 'Karachi, Pakistan', gps: null },
  { id: 'demo-s4', name: 'Hanoi Apparel Co.', address: 'Hanoi, Vietnam', gps: { lat: 21.0285, lng: 105.8542 } },
];

export default async function DashboardPage() {
  const buyersRes = await loadOrFallback<ApiBuyer[]>('/buyers', DEMO_BUYERS);
  const suppliersRes = await loadOrFallback<ApiSupplier[]>('/suppliers', DEMO_SUPPLIERS);
  const presets = await apiGet<ApiLoopPreset[]>('/loop-presets').catch(() => [] as ApiLoopPreset[]);

  return (
    <div style={{ padding: '28px 32px' }}>
      <PageHead
        title="Buyers & Suppliers"
        sub="Buyers receive branded reports. Suppliers are the factories you inspect. Linked by POs and products."
      />
      <DirectoryClient
        buyers={buyersRes.data}
        suppliers={suppliersRes.data}
        presets={presets}
        live={buyersRes.live}
      />
    </div>
  );
}
