import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listPresetAmbassadors = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    return await ctx.db
      .query("ambassadors")
      .withIndex("by_type", (q) => q.eq("type", "preset"))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const listBrandAmbassadors = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    return await ctx.db
      .query("ambassadors")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const getAmbassador = query({
  args: { ambassadorId: v.id("ambassadors") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const ambassador = await ctx.db.get(args.ambassadorId);
    if (!ambassador) return null;

    if (ambassador.type === "preset") {
      return ambassador;
    }

    if (ambassador.brandId) {
      const brand = await ctx.db.get(ambassador.brandId);
      if (!brand || brand.userId !== userId) return null;
    }

    return ambassador;
  },
});

export const createAmbassador = mutation({
  args: {
    name: v.string(),
    imageUrl: v.string(),
    personality: v.string(),
    niche: v.string(),
    category: v.string(),
    sampleHook: v.string(),
    type: v.union(v.literal("preset"), v.literal("custom")),
    brandId: v.optional(v.id("brands")),
    generationTaskId: v.optional(v.id("agentTasks")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    if (args.type === "preset") {
      const user = await ctx.db.get(userId);
      if (user?.role !== "admin") {
        throw new Error("only admins can create preset ambassadors");
      }
    }

    if (args.brandId) {
      const brand = await ctx.db.get(args.brandId);
      if (!brand || brand.userId !== userId) {
        throw new Error("brand not found or not authorized");
      }
    }

    // Idempotency: when generationTaskId is supplied, an ambassador for the
    // same (brandId, generationTaskId) pair may already exist - written
    // server-side by the fal-webhook upsert when the character_designer task
    // completed. Return the existing id rather than inserting a duplicate.
    if (args.brandId && args.generationTaskId) {
      const existing = await ctx.db
        .query("ambassadors")
        .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
        .filter((q) => q.eq(q.field("generationTaskId"), args.generationTaskId))
        .first();
      if (existing) {
        return existing._id;
      }
    }

    const ambassadorId = await ctx.db.insert("ambassadors", {
      ...args,
      isActive: true,
      createdAt: Date.now(),
    });

    return ambassadorId;
  },
});

export const updateAmbassador = mutation({
  args: {
    ambassadorId: v.id("ambassadors"),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    personality: v.optional(v.string()),
    niche: v.optional(v.string()),
    category: v.optional(v.string()),
    sampleHook: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const { ambassadorId, ...updates } = args;
    const ambassador = await ctx.db.get(ambassadorId);
    if (!ambassador) throw new Error("ambassador not found");

    if (ambassador.type === "preset") {
      const user = await ctx.db.get(userId);
      if (user?.role !== "admin") {
        throw new Error("only admins can update preset ambassadors");
      }
    } else if (ambassador.brandId) {
      const brand = await ctx.db.get(ambassador.brandId);
      if (!brand || brand.userId !== userId) {
        throw new Error("not authorized");
      }
    }

    const patch = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(ambassadorId, patch);
    return ambassadorId;
  },
});

// Server-side upsert called by the fal-webhook when a character_designer task
// completes. Idempotent on (brandId, generationTaskId): if an ambassador for
// this task already exists, just patches the imageUrl. Otherwise reuses the
// existing custom ambassador for the brand if there is one, or inserts a new
// row. Also points the brand's preferredAmbassadorId at the result so the
// custom card surfaces in the Settings grid without further client work.
export const upsertCustomAmbassadorForTask = internalMutation({
  args: {
    brandId: v.id("brands"),
    generationTaskId: v.id("agentTasks"),
    imageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const brand = await ctx.db.get(args.brandId);
    if (!brand) {
      throw new Error(`upsertCustomAmbassadorForTask: brand ${args.brandId} not found`);
    }

    // 1. If we already created an ambassador for this exact task, keep its id
    //    and just refresh the imageUrl. Prevents duplicates if the webhook
    //    fires more than once or a client effect also writes.
    const allBrandAmbassadors = await ctx.db
      .query("ambassadors")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    const byTask = allBrandAmbassadors.find(
      (a) => a.generationTaskId === args.generationTaskId,
    );
    if (byTask) {
      if (byTask.imageUrl !== args.imageUrl) {
        await ctx.db.patch(byTask._id, { imageUrl: args.imageUrl });
      }
      // Also re-point preferred in case it drifted.
      if (brand.preferredAmbassadorId !== byTask._id) {
        await ctx.db.patch(args.brandId, { preferredAmbassadorId: byTask._id });
      }
      return byTask._id;
    }

    // 2. Otherwise, reuse the brand's existing custom ambassador if any -
    //    Settings flows refresh the same custom slot rather than spawning
    //    duplicates.
    const existingCustom = allBrandAmbassadors.find(
      (a) => a.type === "custom" && a.isActive,
    );
    const personality = brand.brandTone || "Professional & Approachable";
    const niche = brand.industry
      ? brand.industry.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "General";

    if (existingCustom) {
      await ctx.db.patch(existingCustom._id, {
        imageUrl: args.imageUrl,
        personality,
        niche,
        generationTaskId: args.generationTaskId,
      });
      if (brand.preferredAmbassadorId !== existingCustom._id) {
        await ctx.db.patch(args.brandId, { preferredAmbassadorId: existingCustom._id });
      }
      return existingCustom._id;
    }

    // 3. First custom ambassador for this brand - insert a fresh row and set
    //    it as the brand's preferred ambassador.
    const ambassadorId = await ctx.db.insert("ambassadors", {
      name: `${brand.name} Ambassador`,
      imageUrl: args.imageUrl,
      personality,
      niche,
      category: "custom",
      sampleHook: "",
      type: "custom",
      brandId: args.brandId,
      generationTaskId: args.generationTaskId,
      isActive: true,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.brandId, {
      preferredAmbassadorId: ambassadorId,
      setupDetails: {
        ...((brand.setupDetails as any) ?? {}),
        characterImageUrl: args.imageUrl,
      },
    });

    return ambassadorId;
  },
});

// Manually-added ambassador. Inserts as `type: "manual"`, brand-scoped, with
// name + imageUrl required. Personality falls back to the brand's tone and
// niche derives from the brand industry if the caller didn't supply them.
export const createManualAmbassador = mutation({
  args: {
    brandId: v.id("brands"),
    name: v.string(),
    imageUrl: v.string(),
    niche: v.optional(v.string()),
    personality: v.optional(v.string()),
    category: v.optional(v.string()),
    sampleHook: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("brand not found or not authorized");
    }

    const name = args.name.trim();
    if (!name) throw new Error("name is required");
    const imageUrl = args.imageUrl.trim();
    if (!imageUrl) throw new Error("imageUrl is required");

    const personality = args.personality?.trim() || brand.brandTone || "Professional & Approachable";
    const niche = args.niche?.trim() ||
      (brand.industry
        ? brand.industry.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
        : "General");

    const ambassadorId = await ctx.db.insert("ambassadors", {
      brandId: args.brandId,
      type: "manual",
      name,
      imageUrl,
      personality,
      niche,
      category: args.category?.trim() || "custom",
      sampleHook: args.sampleHook?.trim() || "",
      isActive: true,
      createdAt: Date.now(),
    });

    return ambassadorId;
  },
});

// Hard delete a manual or AI-generated ambassador. Preset rows refuse here
// (admins use a separate flow). If the deleted row is the brand's preferred
// ambassador, the preference is cleared so we don't leave a dangling ref.
export const deleteAmbassador = mutation({
  args: { ambassadorId: v.id("ambassadors") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const ambassador = await ctx.db.get(args.ambassadorId);
    if (!ambassador) throw new Error("ambassador not found");
    if (ambassador.type === "preset") {
      throw new Error("preset ambassadors cannot be deleted");
    }
    if (!ambassador.brandId) throw new Error("ambassador is not brand-scoped");

    const brand = await ctx.db.get(ambassador.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    if (brand.preferredAmbassadorId === ambassador._id) {
      await ctx.db.patch(brand._id, { preferredAmbassadorId: undefined });
    }

    await ctx.db.delete(args.ambassadorId);
  },
});

export const deactivateAmbassador = mutation({
  args: { ambassadorId: v.id("ambassadors") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const ambassador = await ctx.db.get(args.ambassadorId);
    if (!ambassador) throw new Error("ambassador not found");

    if (ambassador.type === "preset") {
      const user = await ctx.db.get(userId);
      if (user?.role !== "admin") {
        throw new Error("only admins can deactivate preset ambassadors");
      }
    } else if (ambassador.brandId) {
      const brand = await ctx.db.get(ambassador.brandId);
      if (!brand || brand.userId !== userId) {
        throw new Error("not authorized");
      }
    }

    await ctx.db.patch(args.ambassadorId, { isActive: false });
    return args.ambassadorId;
  },
});


// admin schema
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

export const getAdminAmbassadors = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const ambassadors = await ctx.db
      .query("ambassadors")
      .collect();

    return ambassadors.sort((a, b) => b.createdAt - a.createdAt);
  },
});