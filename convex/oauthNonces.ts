import { v } from "convex/values";
import { mutation, internalMutation } from "./_generated/server";
import { requireAuth } from "./adminAuth";
import { Id } from "./_generated/dataModel";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function generateNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

// Authenticated mutation. The browser calls this right before redirecting to
// /shopify/auth. Returns a single-use nonce that the OAuth route will trade
// for the trusted userId.
export const createShopifyAuthNonce = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const nonce = generateNonce();
    const now = Date.now();
    await ctx.db.insert("oauthNonces", {
      nonce,
      provider: "shopify",
      userId,
      expiresAt: now + NONCE_TTL_MS,
      createdAt: now,
    });
    return nonce;
  },
});

// Authenticated mutation for TikTok. Verifies the caller actually owns the
// brand they're trying to link, then binds both userId and brandId to the
// nonce so the callback writes to the right record.
export const createTiktokAuthNonce = mutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Brand not found or not owned by caller");
    }
    const nonce = generateNonce();
    const now = Date.now();
    await ctx.db.insert("oauthNonces", {
      nonce,
      provider: "tiktok",
      userId,
      brandId: args.brandId,
      expiresAt: now + NONCE_TTL_MS,
      createdAt: now,
    });
    return nonce;
  },
});

// Internal: consume a nonce. Enforces provider match, not expired, not reused.
// Deletes the row on success so the same nonce can never redeem twice.
export const consumeNonce = internalMutation({
  args: { nonce: v.string(), provider: v.string() },
  returns: v.union(
    v.object({
      userId: v.id("users"),
      brandId: v.optional(v.id("brands")),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("oauthNonces")
      .withIndex("by_nonce", (q) => q.eq("nonce", args.nonce))
      .unique();
    if (!row) return null;
    if (row.provider !== args.provider) return null;
    if (Date.now() > row.expiresAt) {
      await ctx.db.delete(row._id);
      return null;
    }
    const userId = row.userId as Id<"users">;
    const brandId = row.brandId;
    await ctx.db.delete(row._id);
    return { userId, brandId };
  },
});
