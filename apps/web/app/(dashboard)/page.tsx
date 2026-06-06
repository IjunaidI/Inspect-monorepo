import { redirect } from 'next/navigation';

// The Inspect console lives under the (console) route group; land on its dashboard.
export default function RootPage() {
  redirect('/dashboard');
}
