import type { ComponentType } from 'react';

/**
 * The plan's section of the PDF report, built by the growth package (round 3). Null until it exists; then
 * replace it with `export { PlanPrintSection } from '@/components/plan/PlanPrintSection'` (see REQUESTS).
 */
export const PlanPrintSection: ComponentType<{ xrayId: string }> | null = null;
