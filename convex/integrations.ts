import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const saveShopifyIntegration = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    domain: v.string(),
    storeData: v.any(),
  },
  handler: async (ctx, args) => {
    // Check if an integration already exists for this user and provider
    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("provider"), "shopify"))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        domain: args.domain,
        storeData: args.storeData,
      });
    } else {
      await ctx.db.insert("integrations", {
        userId: args.userId,
        provider: "shopify",
        accessToken: args.accessToken,
        domain: args.domain,
        storeData: args.storeData,
      });
    }
  },
});

export const getShopifyIntegration = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("provider"), "shopify"))
      .first();
      
    return integration;
  },
});

// Internal: fetch the integration right after saving, so we can read its _id
export const getShopifyIntegrationInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("integrations")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("provider"), "shopify"))
      .first();
  },
});

// Internal: look up integration by shop domain (used by webhook receiver)
export const getIntegrationByDomain = internalQuery({
  args: { domain: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("integrations")
      .filter((q) =>
        q.and(
          q.eq(q.field("provider"), "shopify"),
          q.eq(q.field("domain"), args.domain)
        )
      )
      .first();
  },
});
