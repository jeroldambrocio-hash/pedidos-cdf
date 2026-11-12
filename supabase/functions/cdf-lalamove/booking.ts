// Booking a rider (audit 12/11, F01): the attempt is held in the database before Lalamove is called, so two
// phones can't book twice and an answer lost after Lalamove accepted is never forgotten nor booked again.
// Written against a few dependencies so the same code runs in the function (index.ts) and in the tests
// (tests/lalamove-booking.test.mjs, on the real SQL of migration 20261112160000).
import { LalamoveError } from "./lalamove.ts";

export type BookDeps = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
  ll: (method: string, path: string, data?: unknown) => Promise<any>;
  newKey: () => string;
  log?: (...a: unknown[]) => void;
};
export type Answer = { status: number; body: Record<string, unknown> };

// What the database said, in words for the panel
export const CLAIM_ERRORS: Record<string, [number, string]> = {
  cdf_ll_no_quote: [400, "Pide primero un precio"],
  cdf_ll_booking_busy: [409, "Ya se está reservando un rider para este pedido. Espera un momento."],
  cdf_ll_booking_uncertain: [409, "Hay una reserva sin confirmar para este pedido. Revísala antes de reservar otra."],
  cdf_ll_already_booked: [409, "Este pedido ya tiene un rider reservado"],
};
const dbError = (e: { message: string }): Answer | null => {
  const k = Object.keys(CLAIM_ERRORS).find((x) => e.message.includes(x));
  return k ? { status: CLAIM_ERRORS[k][0], body: { error: CLAIM_ERRORS[k][1] } } : null;
};
// Lalamove answered "no" for sure only with a 4xx: nothing was booked. Anything else may have been.
export const certainlyRefused = (e: unknown) => e instanceof LalamoveError && e.status >= 400 && e.status < 500;

// `request` is the body for POST /v3/orders without metadata; `who` is the caller's email.
export async function bookRider(d: BookDeps, orderId: string, orderNum: string, who: string, request: Record<string, unknown>): Promise<Answer> {
  const key = d.newKey();
  const claim = await d.rpc("cdf_ll_book_claim", { p_order: orderId, p_key: key, p_by: who });
  if (claim.error) return dbError(claim.error) || { status: 500, body: { error: "No se pudo empezar la reserva: " + claim.error.message } };

  let o: any;
  try {
    // The key travels with the booking, so Lalamove's webhook can tie a lost answer back to this attempt
    o = await d.ll("POST", "/v3/orders", { ...request, metadata: { cdfOrder: String(orderNum), cdfBooking: key } });
    if (!o?.orderId) throw new Error("Lalamove no devolvió el número de reserva");
  } catch (e) {
    const refused = certainlyRefused(e);
    const msg = e instanceof LalamoveError ? `Lalamove: ${e.message} (${e.code})` : `Sin respuesta clara de Lalamove: ${String((e as Error)?.message || e)}`;
    const marked = await d.rpc("cdf_ll_book_failed", { p_order: orderId, p_key: key, p_uncertain: !refused, p_error: msg });
    if (marked.error) d.log?.("lalamove book_failed", orderId, marked.error.message);
    // Not refused: it may exist in Lalamove. Held as uncertain; never booked again without checking.
    return refused ? { status: 400, body: { error: msg } }
      : { status: 502, body: { error: msg + ". La reserva queda pendiente de comprobar.", uncertain: true, row: marked.data } };
  }

  const done = await d.rpc("cdf_ll_book_done", { p_order: orderId, p_key: key, p_ll: o.orderId, p_status: o.status || "ASSIGNING_DRIVER",
    p_share: o.shareLink || null, p_price: o.priceBreakdown?.total != null ? +o.priceBreakdown.total : null });
  if (!done.error) return { status: 200, body: { row: done.data } };
  // Lalamove booked it but we couldn't save it: say so with its number, and hold the attempt for checking
  d.log?.("lalamove book_done", orderId, o.orderId, done.error.message);
  const msg = `Lalamove aceptó la reserva ${o.orderId} pero no se pudo guardar aquí. Enlázala con ese número.`;
  const marked = await d.rpc("cdf_ll_book_failed", { p_order: orderId, p_key: key, p_uncertain: true, p_error: msg });
  if (marked.error) d.log?.("lalamove book_failed", orderId, marked.error.message);
  return { status: 502, body: { error: msg, uncertain: true, ll_order_id: o.orderId, row: marked.data } };
}

// An admin resolves an uncertain attempt. With a Lalamove order number: Lalamove is asked for it and it must
// carry this order's number (and, when it has one, the attempt's key). Without: the admin checked in
// Lalamove that nothing was booked.
export async function resolveBooking(d: BookDeps, orderId: string, orderNum: string, who: string, row: any, llOrderId: string | null): Promise<Answer> {
  if (row?.booking_state !== "uncertain" && !(row?.booking_state === "pending" && Date.parse(row.booking_started_at) < Date.now() - 120_000))
    return { status: 409, body: { error: "No hay ninguna reserva por comprobar en este pedido" } };
  let found: any = null;
  if (llOrderId) {
    if (!/^\d{6,30}$/.test(llOrderId)) return { status: 400, body: { error: "El número de reserva de Lalamove no es válido" } };
    try { found = await d.ll("GET", `/v3/orders/${llOrderId}`); }
    catch (e) { return { status: 400, body: { error: e instanceof LalamoveError && e.status === 404 ? "Lalamove no tiene ninguna reserva con ese número" : `Lalamove: ${String((e as Error)?.message || e)}` } }; }
    const meta = found?.metadata || {};
    if (String(meta.cdfOrder ?? "") !== String(orderNum) || (meta.cdfBooking && row.booking_key && meta.cdfBooking !== row.booking_key))
      return { status: 409, body: { error: `Esa reserva de Lalamove no es del pedido #${orderNum}` } };
  }
  const r = await d.rpc("cdf_ll_book_resolve", { p_order: orderId, p_by: who, p_ll: llOrderId || null,
    p_status: found?.status || null, p_share: found?.shareLink || null, p_price: found?.priceBreakdown?.total != null ? +found.priceBreakdown.total : null });
  if (r.error) return { status: 409, body: { error: /cdf_ll_other_order/.test(r.error.message) ? "Esa reserva ya está enlazada a otro pedido" : "No se pudo resolver: " + r.error.message } };
  return { status: 200, body: { row: r.data } };
}
