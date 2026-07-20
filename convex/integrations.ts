import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { getCurrentTeamMember } from "./helpers";

// Refresh tokens 5 minutes before they actually expire to avoid mid-request expiry.
const REFRESH_LEEWAY_MS = 5 * 60 * 1000;

export const saveShopifyIntegration = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
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
        refreshToken: args.refreshToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        domain: args.domain,
        storeData: args.storeData,
      });
    } else {
      await ctx.db.insert("integrations", {
        userId: args.userId,
        provider: "shopify",
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        accessTokenExpiresAt: args.accessTokenExpiresAt,
        domain: args.domain,
        storeData: args.storeData,
      });
    }
  },
});

// Internal: persist refreshed tokens after a successful refresh exchange.
export const updateTokens = internalMutation({
  args: {
    integrationId: v.id("integrations"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accessTokenExpiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.integrationId, {
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      accessTokenExpiresAt: args.accessTokenExpiresAt,
    });
  },
});

// Internal: GDPR shop-redact handler. Called from the compliance webhook when
// Shopify notifies us a merchant has uninstalled and the 48h grace window has
// elapsed. We must delete all data associated with the shop. SIRz only stores
// products + integration metadata for Shopify shops (no customer or order
// data), so this deletes:
//   - Every product synced from this shop's Shopify catalog
//   - The integration row itself (access + refresh tokens, store metadata)
//   - The shopifyConnected flag on the owning brand (so the merchant's brand
//     record stays for their own SIRz account but no longer references the shop)
//
// Idempotent - running twice for the same shop is a no-op after the first run.
export const purgeShopifyDataForShop = internalMutation({
  args: { domain: v.string() },
  handler: async (ctx, args) => {
    const integration = await ctx.db
      .query("integrations")
      .filter((q) =>
        q.and(
          q.eq(q.field("provider"), "shopify"),
          q.eq(q.field("domain"), args.domain),
        ),
      )
      .first();

    if (!integration) {
      console.log(`[purgeShopifyDataForShop] No integration for ${args.domain} - already purged or never installed.`);
      return { deletedProducts: 0, deletedIntegration: false };
    }

    // Find the brand owned by the same user, clear its shopifyConnected flag,
    // and delete every Shopify-sourced product attached to it.
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", integration.userId))
      .first();

    let deletedProducts = 0;
    if (brand) {
      const products = await ctx.db
        .query("products")
        .withIndex("by_brandId", (q) => q.eq("brandId", brand._id))
        .collect();
      for (const p of products) {
        if (p.source === "shopify" || p.shopifyProductId) {
          await ctx.db.delete(p._id);
          deletedProducts++;
        }
      }
      await ctx.db.patch(brand._id, { shopifyConnected: false });
    }

    await ctx.db.delete(integration._id);

    console.log(
      `[purgeShopifyDataForShop] ${args.domain}: deleted integration + ${deletedProducts} products`,
    );
    return { deletedProducts, deletedIntegration: true };
  },
});

// Internal: read the integration directly by ID (used by the refresh action).
export const getIntegrationById = internalQuery({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.integrationId);
  },
});

// Returns a valid Shopify access token for the integration, refreshing if it's
// near or past expiry. Legacy non-expiring tokens (no refreshToken / no
// accessTokenExpiresAt) are returned as-is - those grants pre-date April 2026.
export const getValidShopifyAccessToken = internalAction({
  args: { integrationId: v.id("integrations") },
  handler: async (ctx, args): Promise<{ accessToken: string; domain: string }> => {
    const integration = await ctx.runQuery(internal.integrations.getIntegrationById, {
      integrationId: args.integrationId,
    });
    if (!integration) {
      throw new Error(`Integration ${args.integrationId} not found`);
    }
    if (integration.provider !== "shopify") {
      throw new Error(`Integration ${args.integrationId} is not a Shopify integration`);
    }

    const domain = integration.domain;
    if (!domain) {
      throw new Error(`Integration ${args.integrationId} has no domain`);
    }

    // No expiry recorded => legacy non-expiring token. Return as-is.
    if (!integration.accessTokenExpiresAt || !integration.refreshToken) {
      return { accessToken: integration.accessToken, domain };
    }

    // Still valid (with leeway) => return existing.
    if (integration.accessTokenExpiresAt - Date.now() > REFRESH_LEEWAY_MS) {
      return { accessToken: integration.accessToken, domain };
    }

    // Need to refresh.
    const clientId = process.env.SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET in env");
    }

    console.log(`[Shopify Refresh] Refreshing access token for ${domain}`);
    const refreshResponse = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: integration.refreshToken,
      }),
    });

    if (!refreshResponse.ok) {
      const errorText = await refreshResponse.text();
      console.error(`[Shopify Refresh] Refresh failed for ${domain}: ${refreshResponse.status} ${errorText}`);
      throw new Error(`Shopify token refresh failed: ${refreshResponse.status} ${errorText}`);
    }

    const refreshData = await refreshResponse.json();
    const newAccessToken: string | undefined = refreshData.access_token;
    const newRefreshToken: string | undefined = refreshData.refresh_token;
    const expiresIn: number | undefined = refreshData.expires_in;

    if (!newAccessToken) {
      throw new Error("Shopify refresh response missing access_token");
    }

    const newExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;

    await ctx.runMutation(internal.integrations.updateTokens, {
      integrationId: args.integrationId,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresAt: newExpiresAt,
    });

    console.log(`[Shopify Refresh] Refreshed token for ${domain} (expires in ${expiresIn}s)`);
    return { accessToken: newAccessToken, domain };
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

    if (!integration) return null;

    // Strip secrets before returning to the client. Access/refresh tokens are
    // resolved server-side via getValidShopifyAccessToken whenever an action
    // needs to call Shopify; the client never has a legitimate use for them.
    const { accessToken, refreshToken, accessTokenExpiresAt, ...safe } = integration;
    return safe;
  },
});

export const disconnectShopifyIntegration = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("provider"), "shopify"))
      .first();

    if (!integration) return false;

    await ctx.db.delete(integration._id);
    return true;
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


// admin schema
export const getAllIntegrations = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    return await ctx.db.query("integrations").collect();
  },
});
