import { AsyncLocalStorage } from "node:async_hooks";
import type { UpdateStatus } from "@/lib/types";
const context = new AsyncLocalStorage<UpdateStatus[]>();
export function recordUpdate(status: UpdateStatus) { context.getStore()?.push(status); }
export async function withUpdateStatus<T extends object>(loader: () => Promise<T>): Promise<T & { updateStatus?: UpdateStatus }> {
  return context.run([], async () => {
    const value = await loader();
    const items = context.getStore()!;
    if (!items.length) return { ...value };
    return { ...value, updateStatus: {
      fetchedAt: new Date(Math.min(...items.map((item) => Date.parse(item.fetchedAt)))).toISOString(),
      stale: items.some((item) => item.stale),
      nextRefreshAt: new Date(Math.max(...items.map((item) => Date.parse(item.nextRefreshAt)))).toISOString(),
    } };
  });
}
