import { orderUpdateFor } from "./lalamove.ts";

// Do not acknowledge the provider's final status until the CDF write succeeds.
// A concurrent edit is re-read rather than silently treated as a successful write.
export async function syncDelivery(service: any, orderId: string, status: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await service.from("cdf_orders").select("*").eq("id", orderId).maybeSingle();
    if (read.error) throw new Error("cdf_sync_read_failed");
    if (!read.data) throw new Error("cdf_sync_order_missing");
    const order = read.data, patch = orderUpdateFor(status, order);
    if (!patch) return;
    const write = await service.from("cdf_orders").update(patch).eq("id", orderId)
      .eq("updated_at", order.updated_at).select("id");
    if (write.error) throw new Error("cdf_sync_write_failed");
    if (write.data?.length) return;
  }
  throw new Error("cdf_sync_conflict");
}
