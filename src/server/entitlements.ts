/**
 * The ONLY place plan limits live. Payments are not built; `users.plan` is set
 * manually for now. Changing pricing never touches the rest of the codebase.
 */
export type Plan = "free" | "pro";

export type Entitlements = { maxDocuments: number | null; emailReminders: boolean };

const PLANS: Record<Plan, Entitlements> = {
  free: { maxDocuments: 50, emailReminders: true },
  pro: { maxDocuments: null, emailReminders: true },
};

export function entitlementsFor(plan: string | null | undefined): Entitlements {
  return PLANS[(plan as Plan) in PLANS ? (plan as Plan) : "free"];
}
