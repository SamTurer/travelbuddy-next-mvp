// app/plan/page.tsx
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import PlanClient from './PlanClient';

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading your plan…</div>}>
      <PlanClient />
    </Suspense>
  );
}
