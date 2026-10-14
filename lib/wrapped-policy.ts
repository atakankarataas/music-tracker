import "server-only";
import { sql } from "@/lib/db";

// Spotify publishes primary > secondary/featured, but no numerical weights.
// 0.35 is our estimate, matching the supplied 2023–2025 top-five rankings.
// Catalogue order is a role proxy, not verified primary/featured billing.
export const WRAPPED_SECONDARY_WEIGHT = 0.35;

export function wrappedEligibility() {
  return sql`AND (ms_played IS NULL OR ms_played > 30000) AND incognito_mode IS NOT TRUE`;
}

export function wrappedCreditWeight() {
  return sql`music_read.artist_credit_weight(c.position::smallint)`;
}
