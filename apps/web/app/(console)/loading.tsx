import { PageSkeleton } from '@/components/inspect/loading';

/**
 * Default loading UI for every console screen. Next.js renders the nearest
 * ancestor loading.tsx the instant a navigation starts and swaps it out when the
 * segment's Server Components resolve — so this one file covers all the nested
 * routes without any client-side route interception.
 *
 * It renders INSIDE the console layout, so the sidebar and topbar stay put and
 * only the content area shows the skeleton. Individual segments can override it
 * with their own loading.tsx (see dashboard/loading.tsx).
 */
export default function ConsoleLoading() {
  return <PageSkeleton />;
}
