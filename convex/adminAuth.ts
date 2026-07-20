/**
 * Shared admin authorization helpers.
 *
 * Usage in any query or mutation:
 *
 *   import { requireAdmin } from "./adminAuth";
 *
 *   export const myAdminOnlyMutation = mutation({
 *     handler: async (ctx) => {
 *       await requireAdmin(ctx);
 *       // ...admin-only logic
 *     },
 *   });
 *
 * Convention for admin developers building on this platform:
 *   - Use `admin*` prefix for all admin-scoped public functions (e.g. `adminListUsers`)
 *   - Call `requireAdmin(ctx)` at the top of the handler
 *   - Use `requireAdminSilent(ctx)` when you need to branch logic without throwing (returns boolean)
 */

import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";

const INTERNAL_ADMIN_EMAIL_ALLOWLIST = [
  "legendmulan0@gmail.com",
];

export function allowedAdminEmails() {
  const configured = (process.env.INTERNAL_ADMIN_EMAIL_ALLOWLIST ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  return new Set([
    ...INTERNAL_ADMIN_EMAIL_ALLOWLIST.map((email) => email.toLowerCase()),
    ...configured,
  ]);
}

export function isInternalAdminEmail(email: unknown) {
  const normalized = typeof email === "string" ? email.trim().toLowerCase() : "";
  return !!normalized && allowedAdminEmails().has(normalized);
}

function hasAdminAccess(user: any) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return isInternalAdminEmail(user.email);
}

/**
 * Require admin access. Access is granted by either:
 * - users.role === "admin"
 * - user email exists in the internal admin allowlist
 *
 * The allowlist lets trusted operators use their normal user account for
 * diagnostics without changing their product-facing role.
 * Returns the authenticated admin user's ID.
 */
export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const user = await ctx.db.get(userId);
  if (!hasAdminAccess(user)) {
    throw new Error("Admin access required");
  }
  return userId;
}

/**
 * Check if the current user is an admin without throwing.
 * Useful for branching logic (e.g., show more data to admins).
 */
export async function isAdmin(ctx: QueryCtx | MutationCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return false;
  const user = await ctx.db.get(userId);
  return hasAdminAccess(user);
}

/**
 * Require that the current user is authenticated (any role). Throws if not.
 * Returns the user ID. This is just a thin wrapper around getAuthUserId for
 * consistency with requireAdmin.
 */
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}
