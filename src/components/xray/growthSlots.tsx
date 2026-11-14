'use client';

import type { ComponentType } from 'react';

/**
 * Views another package builds for the map's Plan and Skills tabs and the PDF report (round 3, growth).
 * While a view does not exist yet its slot is null and the tab shows its empty state instead of breaking
 * the build. When `@/components/plan/PlanView`, `@/components/skills/SkillsView` or `PlanPrintSection`
 * land, replace the matching null with an import (see REQUESTS, round 3, 02.3).
 */
export const PlanView: ComponentType<{ xrayId: string }> | null = null;
export const SkillsView: ComponentType<{ xrayId: string }> | null = null;
