// Statistics only for chosen admins (migration 20261112110000). This function writes with the service identity,
// which the database does not limit, so it applies the same rule as the database trigger itself.
export type Member = { role?: string | null; sees_stats?: boolean | null } | null | undefined;

/** An admin who sees Statistics (before the migration every admin does: the column is missing, so undefined). */
export const hasStats = (m: Member) => m?.role === "admin" && m.sees_stats !== false;

/** Extra fields for someone being added: an admin without Statistics adds people without them. */
export const statsOnAdd = (me: Member): { sees_stats?: false } => (hasStats(me) ? {} : { sees_stats: false });

/** An admin without Statistics cannot remove an admin who has them (that would decide who keeps them). */
export const mayRemove = (me: Member, target: Member) => hasStats(me) || !hasStats(target);
