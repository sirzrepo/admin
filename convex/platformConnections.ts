import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// Get platform connections for a brand
export const getPlatformConnections = query({
  args: {
    brandId: v.id("brands"),
    platform: v.optional(v.string()),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let connections;
    
    if (args.platform) {
      connections = await ctx.db
        .query("platformConnections")
        .withIndex("by_brandId_platform", (q) => 
          q.eq("brandId", args.brandId).eq("platform", args.platform!)
        )
        .collect();
    } else {
      connections = await ctx.db
        .query("platformConnections")
        .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
        .collect();
    }

    if (args.activeOnly) {
      connections = connections.filter(conn => conn.isActive);
    }

    return connections.sort((a, b) => b.connectedAt - a.connectedAt);
  },
});

// Get a single platform connection by ID
export const getPlatformConnection = query({
  args: { connectionId: v.id("platformConnections") },
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    return connection;
  },
});

// Create a new platform connection
export const createPlatformConnection = mutation({
  args: {
    brandId: v.id("brands"),
    platform: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accountId: v.string(),
    accountName: v.string(),
    accountAvatarUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to connect platforms for this brand");
    }

    // Check if connection already exists for this platform and brand
    const existingConnections = await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) => 
        q.eq("brandId", args.brandId).eq("platform", args.platform)
      )
      .collect();

    if (existingConnections.length > 0) {
      throw new Error(`Platform ${args.platform} is already connected to this brand`);
    }

    const connectionId = await ctx.db.insert("platformConnections", {
      brandId: args.brandId,
      platform: args.platform,
      accessToken: args.accessToken,
      refreshToken: args.refreshToken,
      accountId: args.accountId,
      accountName: args.accountName,
      accountAvatarUrl: args.accountAvatarUrl,
      expiresAt: args.expiresAt,
      isActive: args.isActive,
      connectedAt: Date.now(),
    });

    return connectionId;
  },
});

// Update platform connection
export const updatePlatformConnection = mutation({
  args: {
    connectionId: v.id("platformConnections"),
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    accountName: v.optional(v.string()),
    accountAvatarUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const connection = await ctx.db.get(args.connectionId);
    if (!connection) throw new Error("Connection not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(connection.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to update this connection");
    }

    const updateData: any = {};
    if (args.accessToken !== undefined) updateData.accessToken = args.accessToken;
    if (args.refreshToken !== undefined) updateData.refreshToken = args.refreshToken;
    if (args.accountName !== undefined) updateData.accountName = args.accountName;
    if (args.accountAvatarUrl !== undefined) updateData.accountAvatarUrl = args.accountAvatarUrl;
    if (args.expiresAt !== undefined) updateData.expiresAt = args.expiresAt;
    if (args.isActive !== undefined) updateData.isActive = args.isActive;

    await ctx.db.patch(args.connectionId, updateData);
    return args.connectionId;
  },
});

// Delete platform connection
export const deletePlatformConnection = mutation({
  args: { connectionId: v.id("platformConnections") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const connection = await ctx.db.get(args.connectionId);
    if (!connection) throw new Error("Connection not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(connection.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to delete this connection");
    }

    await ctx.db.delete(args.connectionId);
    return args.connectionId;
  },
});

// Refresh platform connection token
export const refreshPlatformConnection = mutation({
  args: { connectionId: v.id("platformConnections") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const connection = await ctx.db.get(args.connectionId);
    if (!connection) throw new Error("Connection not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(connection.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to refresh this connection");
    }

    if (!connection.refreshToken) {
      throw new Error("No refresh token available for this connection");
    }

    // This would typically involve calling the platform's OAuth API
    // For now, we'll just update the connection to mark it as needing refresh
    await ctx.db.patch(args.connectionId, { 
      isActive: false 
    });

    return args.connectionId;
  },
});
