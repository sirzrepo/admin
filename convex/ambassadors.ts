import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Create a new ambassador
export const createAmbassador = mutation({
  args: {
    brandId: v.id("brands"),
    name: v.string(),
    category: v.string(),
    niche: v.string(),
    personality: v.string(),
    type: v.string(),
    imageUrl: v.optional(v.string()),
    sampleHook: v.optional(v.string()),
    isActive: v.boolean(),
    generationTaskId: v.optional(v.id("agentTasks")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("unauthorized: you don't own this brand");
    }

    const ambassadorId = await ctx.db.insert("ambassadors", {
      ...args,
      createdAt: Date.now(),
    });

    return ambassadorId;
  },
});

// Get all ambassadors for a brand
export const getAmbassadors = query({
  args: {
    brandId: v.id("brands"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      return [];
    }

    return await ctx.db
      .query("ambassadors")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();
  },
});

// Get a single ambassador by ID
export const getAmbassador = query({
  args: {
    ambassadorId: v.id("ambassadors"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const ambassador = await ctx.db.get(args.ambassadorId);
    if (!ambassador) return null;

    // Verify user owns the brand
    const brand = await ctx.db.get(ambassador.brandId);
    if (!brand || brand.userId !== userId) {
      return null;
    }

    return ambassador;
  },
});

// Update an ambassador
export const updateAmbassador = mutation({
  args: {
    ambassadorId: v.id("ambassadors"),
    name: v.optional(v.string()),
    category: v.optional(v.string()),
    niche: v.optional(v.string()),
    personality: v.optional(v.string()),
    type: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    sampleHook: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const ambassador = await ctx.db.get(args.ambassadorId);
    if (!ambassador) throw new Error("ambassador not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(ambassador.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("unauthorized: you don't own this brand");
    }

    // Remove ambassadorId from args before updating
    const { ambassadorId: _, ...updateData } = args;

    await ctx.db.patch(args.ambassadorId, updateData);
    return args.ambassadorId;
  },
});

// Delete an ambassador
export const deleteAmbassador = mutation({
  args: {
    ambassadorId: v.id("ambassadors"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const ambassador = await ctx.db.get(args.ambassadorId);
    if (!ambassador) throw new Error("ambassador not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(ambassador.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("unauthorized: you don't own this brand");
    }

    await ctx.db.delete(args.ambassadorId);
    return args.ambassadorId;
  },
});

// Get all ambassadors for the current user's brands
export const getAllAmbassadors = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get user's brands
    const brands = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Get ambassadors for all user's brands
    const ambassadors = [];
    for (const brand of brands) {
      const brandAmbassadors = await ctx.db
        .query("ambassadors")
        .withIndex("by_brandId", (q) => q.eq("brandId", brand._id))
        .collect();
      ambassadors.push(...brandAmbassadors);
    }

    return ambassadors.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get ambassadors by generation task ID
export const getAmbassadorsByTaskId = query({
  args: {
    generationTaskId: v.id("agentTasks"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("ambassadors")
      .withIndex("by_generationTaskId", (q) => q.eq("generationTaskId", args.generationTaskId))
      .collect();
  },
});
