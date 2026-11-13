// A failed email remains in the durable outbox. SMTP is at-least-once: a crash
// after sending but before acknowledgement can repeat it on the next attempt.
export async function emailResult(service: any, outbox: unknown, result: { ok?: boolean; skipped?: string; [key: string]: unknown }) {
  if (result.ok === false) return { body: result, status: 502 };
  if (outbox) {
    const { error } = await service.rpc("cdf_outbox_done", { p_id: Number(outbox) });
    if (error) return { body: { error: "email_ack_failed", pending: true }, status: 503 };
  }
  return { body: result, status: 200 };
}
