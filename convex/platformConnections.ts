import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { getCurrentTeamMember } from "./helpers";

export const listConnections = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const getConnection = query({
  args: { brandId: v.id("brands"), platform: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) => 
        q.eq("brandId", args.brandId).eq("platform", args.platform)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
  },
});

export const getConnectionInternal = internalQuery({
  args: { brandId: v.id("brands"), platform: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) => 
        q.eq("brandId", args.brandId).eq("platform", args.platform)
      )
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
  },
});

export const saveConnection = internalMutation({
  args: {
    brandId: v.id("brands"),
    platform: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accountId: v.string(),
    accountName: v.string(),
    accountAvatarUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    grantedScopes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) =>
        q.eq("brandId", args.brandId).eq("platform", args.platform)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        accountId: args.accountId,
        accountName: args.accountName,
        accountAvatarUrl: args.accountAvatarUrl,
        expiresAt: args.expiresAt,
        grantedScopes: args.grantedScopes,
        isActive: true,
      });
      return existing._id;
    } else {
      return await ctx.db.insert("platformConnections", {
        brandId: args.brandId,
        platform: args.platform,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        accountId: args.accountId,
        accountName: args.accountName,
        accountAvatarUrl: args.accountAvatarUrl,
        expiresAt: args.expiresAt,
        grantedScopes: args.grantedScopes,
        isActive: true,
        connectedAt: Date.now(),
      });
    }
  },
});

export const disconnectPlatform = mutation({
  args: { brandId: v.id("brands"), platform: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const connection = await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) => 
        q.eq("brandId", args.brandId).eq("platform", args.platform)
      )
      .first();

    if (connection) {
      await ctx.db.delete(connection._id);
    }
  },
});

// Patches only the avatar URL. Used by the background R2-copy flow so we can
// swap the short-lived TikTok CDN URL for a permanent R2 URL after connect.
export const patchAccountAvatar = internalMutation({
  args: {
    connectionId: v.id("platformConnections"),
    accountAvatarUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, { accountAvatarUrl: args.accountAvatarUrl });
  },
});

// Copies a TikTok avatar from its short-lived signed CDN URL to R2 and
// updates the connection record. Scheduled by the /tiktok/callback handler so
// it runs in the background - callback returns fast, avatar is permanent.
export const syncTiktokAvatarToR2 = internalAction({
  args: {
    connectionId: v.id("platformConnections"),
    sourceUrl: v.string(),
    brandId: v.id("brands"),
    accountId: v.string(),
  },
  handler: async (ctx, args) => {
    // Key in R2 is keyed by brand + tiktok openId so the same connection
    // always writes to the same object (overwrites on re-sync).
    const key = `brands/${args.brandId}/tiktok/avatar-${args.accountId}.jpeg`;
    const result = await ctx.runAction(internal.agentTasks.copyUrlToR2, {
      sourceUrl: args.sourceUrl,
      key,
    });
    if (!result.r2Url) {
      console.warn(`[syncTiktokAvatarToR2] copy failed for ${args.connectionId}: ${result.error ?? 'unknown'}`);
      return;
    }
    await ctx.runMutation(internal.platformConnections.patchAccountAvatar, {
      connectionId: args.connectionId,
      accountAvatarUrl: result.r2Url,
    });
  },
});

// TikTok access tokens live ~24h; refresh tokens live ~365d. We refresh
// when there is <10 min of headroom so a publish that starts in time still
// completes against a fresh token.
const TIKTOK_REFRESH_MARGIN_MS = 10 * 60 * 1000;

export const updateTikTokTokens = internalMutation({
  args: {
    connectionId: v.id("platformConnections"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, {
      accessToken: args.accessToken,
      ...(args.refreshToken ? { refreshToken: args.refreshToken } : {}),
      expiresAt: args.expiresAt,
      isActive: true,
    });
  },
});

export const deactivateConnection = internalMutation({
  args: { connectionId: v.id("platformConnections") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, { isActive: false });
  },
});

/**
 * Returns a valid TikTok access token for the brand, refreshing it against
 * TikTok's OAuth endpoint when the stored token is within the refresh margin
 * (or already expired). Rotates the refresh_token TikTok hands back, since
 * TikTok issues a new one on every refresh and the old one is invalidated.
 *
 * On a hard refresh failure (refresh_token expired or revoked) the connection
 * is marked inactive so the UI can prompt the merchant to reconnect.
 */
export const ensureFreshTikTokAccessToken = internalAction({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args): Promise<{ accessToken: string } | { error: string }> => {
    const connection = await ctx.runQuery(internal.platformConnections.getConnectionInternal, {
      brandId: args.brandId,
      platform: "tiktok",
    });
    if (!connection) return { error: "no_connection" };

    const hasRoom = connection.expiresAt && connection.expiresAt > Date.now() + TIKTOK_REFRESH_MARGIN_MS;
    if (hasRoom) return { accessToken: connection.accessToken };

    if (!connection.refreshToken) {
      await ctx.runMutation(internal.platformConnections.deactivateConnection, {
        connectionId: connection._id,
      });
      return { error: "no_refresh_token" };
    }

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) {
      console.error("[TikTok] Missing TIKTOK_CLIENT_KEY or TIKTOK_CLIENT_SECRET");
      return { error: "server_config" };
    }

    try {
      const response = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_key: clientKey,
          client_secret: clientSecret,
          grant_type: "refresh_token",
          refresh_token: connection.refreshToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TikTok] Refresh failed (${response.status}):`, errorText);
        // 400 from TikTok means the refresh_token itself is bad - deactivate so
        // the merchant gets prompted to reconnect rather than silently retrying.
        if (response.status === 400 || response.status === 401) {
          await ctx.runMutation(internal.platformConnections.deactivateConnection, {
            connectionId: connection._id,
          });
          return { error: "refresh_token_invalid" };
        }
        return { error: `refresh_failed_${response.status}` };
      }

      const data = await response.json();
      const accessToken: string | undefined = data.access_token;
      const newRefreshToken: string | undefined = data.refresh_token;
      const expiresIn: number | undefined = data.expires_in;

      if (!accessToken || !expiresIn) {
        console.error("[TikTok] Refresh response missing fields:", data);
        return { error: "refresh_malformed_response" };
      }

      await ctx.runMutation(internal.platformConnections.updateTikTokTokens, {
        connectionId: connection._id,
        accessToken,
        refreshToken: newRefreshToken,
        expiresAt: Date.now() + expiresIn * 1000,
      });

      console.log(`[TikTok] Refreshed access token for brand ${args.brandId} (expires in ${expiresIn}s)`);
      return { accessToken };
    } catch (error) {
      console.error("[TikTok] Refresh threw:", error);
      return { error: error instanceof Error ? error.message : "refresh_threw" };
    }
  },
});


// admin schema
export const getAllPlatformConnections = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
        if (!teamMember) {
      throw new Error("unauthenticated");
    }
    return await ctx.db.query("platformConnections").collect();
  },
});