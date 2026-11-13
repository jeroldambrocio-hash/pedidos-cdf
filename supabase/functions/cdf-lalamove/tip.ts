// Priority fee (Lalamove's name for a tip) on a booking that is still looking for a rider: riders see what a
// job pays, so a little extra gets it taken sooner. Asked for by the owner on 12/11/2026 (+20, +50, +100 or a
// typed amount). Lalamove takes the new TOTAL fee, not what is added, and only while no rider has accepted;
// the total is worked out here from what Lalamove says the fee is now, never from what a phone remembers.
// So pressing twice by mistake, or two people at once, cannot charge more than was asked: the second call
// asks for the same total and Lalamove refuses it. Charged to the Lalamove Wallet in production.
// Written against `ll` alone so the same code runs in the function (index.ts) and in tests/lalamove-tip.test.mjs.
import { LalamoveError } from "./lalamove.ts";

export const TIP_MAX_ADD = 1000;   // pesos per press: a typed "2000" instead of "200" stops here
export type TipAnswer = { status: number; body: Record<string, unknown>; order?: any };

const ERRORS: Record<string, string> = {
  ERR_INSUFFICIENT_CREDIT: "No hay saldo suficiente en el Wallet de Lalamove para esta propina",
  // The docs call it ERR_EXCEED_MIN_TIPS; the live API answers ERR_BELOW_MIN_TIPS (seen 13/11/2026 on a +amount)
  ERR_EXCEED_MIN_TIPS: "Lalamove pide una propina mayor: prueba con un importe más alto (por ejemplo +₱50 o +₱100). No se ha añadido nada.",
  ERR_BELOW_MIN_TIPS: "Lalamove pide una propina mayor: prueba con un importe más alto (por ejemplo +₱50 o +₱100). No se ha añadido nada.",
  ERR_EXCEED_MAX_TIPS: "Lalamove no admite una propina tan alta",
  ERR_INVALID_TIPS: "Lalamove no ha aceptado ese importe (puede que alguien acabe de añadir la misma propina). Actualiza y mira el precio.",
  ERR_INVALID_ORDER_STATUS: "Ya no se puede añadir propina: el rider ya está asignado o el envío ha terminado",
};

// `base` is the fee the person saw when pressing. If Lalamove's fee is no longer that, nothing is charged and the
// real fee comes back: an earlier press whose answer was lost may already have been applied, and pressing again
// must not add the same amount twice (13/11/2026). With no `base`, only the current fee is returned (need_base).
export async function addPriorityFee(ll: (method: string, path: string, data?: unknown) => Promise<any>, llOrderId: string, add: unknown, base?: unknown): Promise<TipAnswer> {
  const n = typeof add === "number" ? add : typeof add === "string" && /^\d{1,5}$/.test(add.trim()) ? +add : NaN;
  if (!Number.isInteger(n) || n < 1) return { status: 400, body: { error: "Importe de propina no válido (pesos enteros)" } };
  if (n > TIP_MAX_ADD) return { status: 400, body: { error: `Como mucho ₱${TIP_MAX_ADD} de una vez` } };
  const from = base === undefined || base === null ? null : typeof base === "number" && Number.isInteger(base) && base >= 0 ? base : NaN;
  if (Number.isNaN(from)) return { status: 400, body: { error: "Propina actual no válida" } };
  let now: any;
  try { now = await ll("GET", `/v3/orders/${llOrderId}`); }
  catch (e) { return { status: 502, body: { error: "No se pudo consultar el envío en Lalamove. No se ha añadido nada: " + ((e as Error)?.message || e) } }; }
  if (now?.status !== "ASSIGNING_DRIVER") return { status: 409, body: { error: ERRORS.ERR_INVALID_ORDER_STATUS }, order: now };
  const had = Math.max(0, Math.round(+now.priceBreakdown?.priorityFee || 0)), total = had + n;
  if (from === null) return { status: 409, body: { need_base: true, priority_fee: had, error: "Actualiza la app y vuelve a intentarlo. No se ha añadido nada." }, order: now };
  if (had !== from) return { status: 409, body: { changed: true, priority_fee: had, error: `La propina ya es ₱${had} (puede que la anterior sí se aplicara). No se ha añadido nada: mira el precio y pulsa otra vez si quieres más.` }, order: now };
  try {
    const o = await ll("POST", `/v3/orders/${llOrderId}/priority-fee`, { priorityFee: String(total) });
    return { status: 200, body: { priority_fee: Math.round(+o?.priceBreakdown?.priorityFee || total), added: n }, order: o };
  } catch (e) {
    if (e instanceof LalamoveError && e.status >= 400 && e.status < 500)
      return { status: e.code === "ERR_INSUFFICIENT_CREDIT" ? 402 : 409, body: { error: ERRORS[e.code] || `Lalamove: ${e.message} (${e.code})` } };
    // No clear answer: Lalamove may or may not have taken it. Asking again for the same total is safe.
    return { status: 502, body: { error: "Sin respuesta clara de Lalamove. Pulsa Actualizar y mira el precio antes de añadir más." } };
  }
}
