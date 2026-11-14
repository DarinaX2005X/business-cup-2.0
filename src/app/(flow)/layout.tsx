import type { ReactNode } from 'react';

/** The /start flow: its own trimmed header lives in the flow (it follows the step), no app navigation. */
export default function FlowLayout({ children }: { children: ReactNode }) {
  return children;
}
