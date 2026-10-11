import type { DashboardData, RenderCallbacks } from './types';

/** Reuse the ordinary dashboard with a memory-only encrypted persistence layer. */
export interface ProtectedDashboardBridge {
  data(): DashboardData;
  path?(): string;
  save(data: DashboardData): Promise<void>;
  callbacks(callbacks: RenderCallbacks): RenderCallbacks;
  decorate(root: HTMLElement): void;
}
