import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// Get all tone presets
export const getTonePresets = query({
  args: {
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let presets;
    
    if (args.activeOnly === true) {
      presets = await ctx.db
        .query("tonePresets")
        .withIndex("by_isActive", (q) => q.eq("isActive", true))
        .collect();
    } else {
      presets = await ctx.db.query("tonePresets").collect();
    }

    return presets.sort((a, b) => a.order - b.order);
  },
});

// Get a single tone preset by ID
export const getTonePreset = query({
  args: { presetId: v.id("tonePresets") },
  handler: async (ctx, args) => {
    const preset = await ctx.db.get(args.presetId);
    return preset;
  },
});

// Create a new tone preset (admin only)
export const createTonePreset = mutation({
  args: {
    label: v.string(),
    value: v.string(),
    order: v.number(),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to create tone presets");
    }

    const presetId = await ctx.db.insert("tonePresets", {
      label: args.label,
      value: args.value,
      order: args.order,
      isActive: args.isActive,
      createdAt: Date.now(),
    });

    return presetId;
  },
});

// Update tone preset (admin only)
export const updateTonePreset = mutation({
  args: {
    presetId: v.id("tonePresets"),
    label: v.optional(v.string()),
    value: v.optional(v.string()),
    order: v.optional(v.number()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to update tone presets");
    }

    const preset = await ctx.db.get(args.presetId);
    if (!preset) throw new Error("Preset not found");

    const updateData: any = {};
    if (args.label !== undefined) updateData.label = args.label;
    if (args.value !== undefined) updateData.value = args.value;
    if (args.order !== undefined) updateData.order = args.order;
    if (args.isActive !== undefined) updateData.isActive = args.isActive;

    await ctx.db.patch(args.presetId, updateData);
    return args.presetId;
  },
});

// Delete tone preset (admin only)
export const deleteTonePreset = mutation({
  args: { presetId: v.id("tonePresets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to delete tone presets");
    }

    const preset = await ctx.db.get(args.presetId);
    if (!preset) throw new Error("Preset not found");

    await ctx.db.delete(args.presetId);
    return args.presetId;
  },
});

// Reorder tone presets (admin only)
export const reorderTonePresets = mutation({
  args: {
    presetOrders: v.array(v.object({
      presetId: v.id("tonePresets"),
      newOrder: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to reorder tone presets");
    }

    // Update each preset's order
    for (const { presetId, newOrder } of args.presetOrders) {
      const preset = await ctx.db.get(presetId);
      if (!preset) continue; // Skip if preset doesn't exist
      
      await ctx.db.patch(presetId, { order: newOrder });
    }

    return true;
  },
});

// Toggle tone preset active status (admin only)
export const toggleTonePresetActive = mutation({
  args: { presetId: v.id("tonePresets") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to toggle tone presets");
    }

    const preset = await ctx.db.get(args.presetId);
    if (!preset) throw new Error("Preset not found");

    await ctx.db.patch(args.presetId, { 
      isActive: !preset.isActive 
    });

    return !preset.isActive;
  },
});
