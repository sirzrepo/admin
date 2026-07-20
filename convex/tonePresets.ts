import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireAdmin } from "./adminAuth";

// ─── Queries ──────────────────────────────────────────────────────────────────

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("tonePresets")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect()
      .then((rows) => rows.sort((a, b) => a.order - b.order));
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.db
      .query("tonePresets")
      .collect()
      .then((rows) => rows.sort((a, b) => a.order - b.order));
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    label: v.string(),
    value: v.string(),
    order: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.insert("tonePresets", {
      ...args,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tonePresets"),
    label: v.optional(v.string()),
    value: v.optional(v.string()),
    order: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...fields }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(id, fields);
  },
});

export const toggleActive = mutation({
  args: { id: v.id("tonePresets") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    const preset = await ctx.db.get(id);
    if (!preset) throw new Error("Preset not found");
    await ctx.db.patch(id, { isActive: !preset.isActive });
  },
});

export const remove = mutation({
  args: { id: v.id("tonePresets") },
  handler: async (ctx, { id }) => {
    await requireAdmin(ctx);
    await ctx.db.delete(id);
  },
});
