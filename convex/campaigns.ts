import { mutation, query, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api, internal } from "./_generated/api";
import { getCurrentTeamMember } from "./helpers";

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["generating"],
  generating: ["ready", "partial", "failed", "draft"],
  partial: ["generating", "ready", "draft"], // user retries failed tasks; transitionCampaignToReady promotes
  failed: ["generating", "draft"], // allow retry or edit
  ready: ["scheduled", "generating"], // generating allowed for retry of failed tasks
  scheduled: ["active", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: [],
  cancelled: [],
};

function validateStatusTransition(current: string, next: string): boolean {
  return VALID_STATUS_TRANSITIONS[current]?.includes(next) ?? false;
}

function campaignProductFromProduct(product: any) {
  return {
    name: product.title,
    shopifyProductId: product._id,
    imageUrl: product.imageUrl,
    price: formatProductPrice(product.priceRange),
    targetAudience: undefined,
    keyBenefit: undefined,
    problemSolved: undefined,
  };
}

function formatProductPrice(priceRange?: { minPrice: string; maxPrice: string; currencyCode: string }) {
  if (!priceRange?.minPrice) return undefined;
  const symbol =
    priceRange.currencyCode === "USD" ? "$" :
    priceRange.currencyCode === "EUR" ? "€" :
    priceRange.currencyCode === "GBP" ? "£" :
                                        `${priceRange.currencyCode} `;
  return `${symbol}${priceRange.minPrice}`;
}

function getActiveCampaignAngles(campaign: any) {
  const selectedTypes = new Set(campaign.selectedTypes ?? []);
  return (campaign.selectedAngles ?? []).filter((angle: any) =>
    !angle.format || selectedTypes.size === 0 || selectedTypes.has(angle.format),
  );
}

async function computeCampaignGenerationProgress(ctx: any, campaign: any, tasks: any[]) {
  const activeAngles = getActiveCampaignAngles(campaign);
  const isRunning = (task: any) => task.status === "pending" || task.status === "running";
  const mediaTasksFor = (angleId: string) => tasks.filter((task: any) =>
    task.angleId === angleId &&
    (task.agentType === "video_generator" || task.agentType === "image_generator" || task.agentType === "attached_video"),
  );
  const completedScriptHasCaption = (angleId: string) => tasks.some((task: any) =>
    task.agentType === "script_generator" &&
    task.status === "completed" &&
    Array.isArray(task.output?.scripts) &&
    task.output.scripts.some((script: any) =>
      script.angleId === angleId &&
      typeof script.socialCaption === "string" &&
      script.socialCaption.trim(),
    ),
  );
  const anyScriptRunning = tasks.some((task: any) => task.agentType === "script_generator" && isRunning(task));
  const anyScriptFailed = tasks.some((task: any) => task.agentType === "script_generator" && task.status === "failed");

  const media = { total: 0, completed: 0, failed: 0, running: 0 };
  const captions = { total: activeAngles.length, completed: 0, failed: 0, running: 0 };

  for (const angle of activeAngles as any[]) {
    media.total += 1;
    const angleMedia = mediaTasksFor(angle.id);
    const finalCompleted = angleMedia.some((task: any) =>
      (task.agentType === "video_generator" || task.agentType === "attached_video") &&
      task.status === "completed" &&
      (task.output?.videoUrl || task.output?.imageUrl),
    );
    if (finalCompleted) {
      media.completed += 1;
    } else if (angle.attachedAssetTaskId) {
      const source = await ctx.db.get(angle.attachedAssetTaskId);
      if (source?.output?.videoUrl || source?.output?.imageUrl) media.completed += 1;
      else if (campaign.status === "generating") media.running += 1;
      else media.failed += 1;
    } else if (angleMedia.some(isRunning)) {
      media.running += 1;
    } else if (angleMedia.some((task: any) => task.status === "failed")) {
      media.failed += 1;
    } else if (campaign.status === "generating") {
      media.running += 1;
    } else {
      media.failed += 1;
    }

    const captionTasks = tasks.filter((task: any) => task.angleId === angle.id && task.agentType === "caption_generator");
    const captionDone = completedScriptHasCaption(angle.id) || captionTasks.some((task: any) => task.status === "completed");
    if (captionDone) captions.completed += 1;
    else if (captionTasks.some(isRunning) || anyScriptRunning) captions.running += 1;
    else if (captionTasks.some((task: any) => task.status === "failed") || anyScriptFailed) captions.failed += 1;
    else if (campaign.status === "generating") captions.running += 1;
    else captions.failed += 1;
  }

  const overall = {
    total: media.total + captions.total,
    completed: media.completed + captions.completed,
    failed: media.failed + captions.failed,
    running: media.running + captions.running,
  };
  const progress = overall.total > 0 ? Math.round((overall.completed / overall.total) * 100) : 0;

  return {
    total: overall.total,
    completed: overall.completed,
    failed: overall.failed,
    running: overall.running,
    progress,
    media,
    captions,
  };
}

function deriveGenerationStatus(progress: { total: number; completed: number; failed: number; running: number }) {
  if (progress.total === 0) return null;
  if (progress.running > 0) return "generating";
  if (progress.completed === progress.total && progress.failed === 0) return "ready";
  if (progress.failed === progress.total) return "failed";
  return "partial";
}

export const createCampaign = mutation({
  args: {
    brandId: v.id("brands"),
    name: v.string(),
    description: v.optional(v.string()),
    campaignType: v.optional(v.string()),
    templateId: v.optional(v.string()),
    brandTemplateId: v.optional(v.id("brandCampaignTemplates")),
    shareAsTemplate: v.optional(v.boolean()),
    products: v.optional(v.array(v.object({
      name: v.string(),
      shopifyProductId: v.optional(v.id("products")),
      imageUrl: v.optional(v.string()),
      price: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      keyBenefit: v.optional(v.string()),
      problemSolved: v.optional(v.string()),
    }))),
    goal: v.optional(v.string()),
    ambassadorId: v.optional(v.id("ambassadors")),
    selectedTypes: v.optional(v.array(v.string())),
    selectedAngles: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      hook: v.string(),
      scriptOutline: v.string(),
      format: v.union(v.literal("Product Ads"), v.literal("AI UGC Ads")),
      attachedAssetTaskId: v.optional(v.id("agentTasks")),
    }))),
    targetPlatforms: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("brand not found or not authorized");
    }

    const now = Date.now();
    const campaignId = await ctx.db.insert("campaigns", {
      brandId: args.brandId,
      name: args.name,
      description: args.description,
      campaignType: args.campaignType || "from_scratch",
      templateId: args.templateId,
      brandTemplateId: args.brandTemplateId,
      shareAsTemplate: args.shareAsTemplate,
      products: args.products || [],
      goal: args.goal,
      ambassadorId: args.ambassadorId,
      selectedTypes: args.selectedTypes || [],
      selectedAngles: args.selectedAngles || [],
      targetPlatforms: args.targetPlatforms,
      status: "draft",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Increment template usage if created from a template
    if (args.templateId) {
      try {
        const templateIdObj = args.templateId as unknown as any;
        await ctx.runMutation(api.campaignTemplates.incrementUsage, { templateId: templateIdObj });
      } catch (e) {
        console.error("Failed to increment template usage:", e);
      }
    }

    return campaignId;
  },
});

// Clone an existing campaign as a fresh draft. Copies brand, products,
// selected types/angles, template reference, goal, and target platforms.
// Strips runtime state (tasks, posts, scheduled times, launchedAt) and
// resets status to "draft" so the user lands back in the wizard to
// review/tweak before launching. Angle attachedAssetTaskId is cleared
// because those task rows belong to the source campaign.
export const duplicateCampaign = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const source = await ctx.db.get(args.campaignId);
    if (!source) throw new Error("campaign not found");

    const brand = await ctx.db.get(source.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("not authorized");
    }

    const now = Date.now();
    const newId = await ctx.db.insert("campaigns", {
      brandId: source.brandId,
      name: `${source.name} (Copy)`,
      description: source.description,
      campaignType: source.campaignType,
      templateId: source.templateId,
      brandTemplateId: source.brandTemplateId,
      shareAsTemplate: source.shareAsTemplate,
      products: source.products ?? [],
      goal: source.goal,
      ambassadorId: source.ambassadorId,
      selectedTypes: source.selectedTypes ?? [],
      selectedAngles: (source.selectedAngles ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        hook: a.hook,
        scriptOutline: a.scriptOutline,
        format: a.format,
        // Drop attachedAssetTaskId - those tasks belong to the source campaign.
      })),
      targetPlatforms: source.targetPlatforms,
      status: "draft",
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });

    return newId;
  },
});

// Internal query used by copilot tools - bypasses auth since the agent already validated brand ownership
export const getCampaignStatusInternal = internalQuery({
  args: { campaignId: v.string() },
  handler: async (ctx, args) => {
    try {
      const campaign = await ctx.db.get(args.campaignId as any);
      if (!campaign) return null;

      const tasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId as any))
        .collect();

      const posts = await ctx.db
        .query("scheduledPosts")
        .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId as any))
        .collect();

      return { campaign, tasks, posts };
    } catch {
      return null;
    }
  },
});

// Internal query - list all recent campaigns for a brand with post enrichment
export const listBrandCampaignsInternal = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("campaigns")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();
  },
});

export const getCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) return null;

    return campaign;
  },
});

export const listCampaigns = query({
  args: {
    brandId: v.id("brands"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    let q = ctx.db
      .query("campaigns")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId));

    if (args.status) {
      q = q.filter((q) => q.eq(q.field("status"), args.status));
    }

    const campaigns = await q.collect();
    return campaigns.sort((a, b) => b.createdAt - a.createdAt);
  },
});

export const updateCampaign = mutation({
  args: {
    campaignId: v.id("campaigns"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    campaignType: v.optional(v.string()),
    templateId: v.optional(v.string()),
    products: v.optional(v.array(v.object({
      name: v.string(),
      shopifyProductId: v.optional(v.id("products")),
      imageUrl: v.optional(v.string()),
      price: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      keyBenefit: v.optional(v.string()),
      problemSolved: v.optional(v.string()),
    }))),
    goal: v.optional(v.string()),
    ambassadorId: v.optional(v.id("ambassadors")),
    selectedTypes: v.optional(v.array(v.string())),
    selectedAngles: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      hook: v.string(),
      scriptOutline: v.string(),
      format: v.union(v.literal("Product Ads"), v.literal("AI UGC Ads")),
      attachedAssetTaskId: v.optional(v.id("agentTasks")),
    }))),
    targetPlatforms: v.optional(v.array(v.string())),
    progress: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const { campaignId, ...updates } = args;
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) throw new Error("campaign not found");

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("not authorized");
    }

    // Edit rules by status:
    //  - draft/failed: any field is editable (wizard owns the data)
    //  - all other statuses: cosmetic edits only (name + description)
    // This lets users rename/relabel a scheduled or active campaign
    // without exposing destructive edits to live data.
    const COSMETIC_FIELDS = new Set(["name", "description"]);
    const fullyEditable = campaign.status === "draft" || campaign.status === "failed";
    if (!fullyEditable) {
      const requested = Object.entries(updates).filter(([, v]) => v !== undefined).map(([k]) => k);
      const disallowed = requested.filter((k) => !COSMETIC_FIELDS.has(k));
      if (disallowed.length > 0) {
        throw new Error(
          `Cannot edit ${disallowed.join(", ")} on a "${campaign.status}" campaign. Only name and description are editable after launch.`,
        );
      }
    }

    const patch = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(campaignId, {
      ...patch,
      updatedAt: Date.now(),
    });

    return campaignId;
  },
});

export const applyProductToDraft = mutation({
  args: {
    campaignId: v.id("campaigns"),
    productId: v.id("products"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");

    const product = await ctx.db.get(args.productId);
    if (!product) throw new Error("product not found");
    if (product.brandId !== campaign.brandId) throw new Error("product does not belong to this campaign's brand");

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    if (campaign.status !== "draft" && campaign.status !== "ready") {
      throw new Error(`Cannot change product on a "${campaign.status}" campaign.`);
    }

    await ctx.db.patch(args.campaignId, {
      products: [campaignProductFromProduct(product)],
      updatedAt: Date.now(),
    });

    return args.campaignId;
  },
});

export const updateCampaignStatus = mutation({
  args: {
    campaignId: v.id("campaigns"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("not authorized");
    }

    if (!validateStatusTransition(campaign.status, args.status)) {
      throw new Error(`invalid status transition from ${campaign.status} to ${args.status}`);
    }

    const now = Date.now();
    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: now,
    };

    if (args.status === "active" && !campaign.launchedAt) {
      updates.launchedAt = now;
    }

    if (args.status === "completed" && !campaign.completedAt) {
      updates.completedAt = now;
    }

    await ctx.db.patch(args.campaignId, updates);

    // Handle scheduled posts based on status change
    if (args.status === "paused") {
      const scheduledPosts = await ctx.db
        .query("scheduledPosts")
        .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
        .filter((q) => q.eq(q.field("status"), "scheduled"))
        .collect();
      
      for (const post of scheduledPosts) {
        await ctx.db.patch(post._id, { status: "paused" });
      }
    } else if (args.status === "active" && campaign.status === "paused") {
      const pausedPosts = await ctx.db
        .query("scheduledPosts")
        .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
        .filter((q) => q.eq(q.field("status"), "paused"))
        .collect();
      
      for (const post of pausedPosts) {
        await ctx.db.patch(post._id, { status: "scheduled" });
        if (post.scheduledAt > now) {
          await ctx.scheduler.runAt(post.scheduledAt, internal.scheduledPosts.publishScheduledPost, { postId: post._id });
        }
      }
    } else if (args.status === "cancelled") {
      const scheduledPosts = await ctx.db
        .query("scheduledPosts")
        .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
        .filter((q) => q.eq(q.field("status"), "scheduled"))
        .collect();
      
      for (const post of scheduledPosts) {
        await ctx.db.patch(post._id, { status: "cancelled" });
      }
    }

    return args.campaignId;
  },
});

// Attach an existing agent task (e.g. a Studio output or upload) to a
// specific angle so its video is used instead of being generated. Only
// allowed on drafts; the campaign's asset list is frozen post-launch.
export const attachAssetToAngle = mutation({
  args: {
    campaignId: v.id("campaigns"),
    angleId: v.string(),
    taskId: v.id("agentTasks"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    if (campaign.status !== "draft") {
      throw new Error("Can only attach assets to draft campaigns");
    }

    const source = await ctx.db.get(args.taskId);
    if (!source) throw new Error("source asset not found");

    const angles = campaign.selectedAngles ?? [];
    const idx = angles.findIndex((a: any) => a.id === args.angleId);
    if (idx < 0) throw new Error("angle not found in campaign");

    const next = [...angles];
    next[idx] = { ...next[idx], attachedAssetTaskId: args.taskId };
    await ctx.db.patch(args.campaignId, {
      selectedAngles: next,
      updatedAt: Date.now(),
    });
    return { angleId: args.angleId, taskId: args.taskId };
  },
});

export const detachAssetFromAngle = mutation({
  args: {
    campaignId: v.id("campaigns"),
    angleId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    if (campaign.status !== "draft") {
      throw new Error("Can only modify draft campaigns");
    }

    const angles = campaign.selectedAngles ?? [];
    const idx = angles.findIndex((a: any) => a.id === args.angleId);
    if (idx < 0) throw new Error("angle not found in campaign");

    const next = [...angles];
    const { attachedAssetTaskId: _, ...rest } = next[idx] as any;
    next[idx] = rest;
    await ctx.db.patch(args.campaignId, {
      selectedAngles: next,
      updatedAt: Date.now(),
    });

    // If the campaign was already generated, clean up any pointer tasks
    // for this angle so Preview reflects the detach.
    const pointers = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .filter((q) => q.eq(q.field("agentType"), "attached_video"))
      .collect();
    for (const p of pointers) {
      if (p.angleId === args.angleId) {
        await ctx.db.delete(p._id);
      }
    }
    return { angleId: args.angleId };
  },
});

// List the current user's draft campaigns, used by the "Use this asset"
// picker on Studio results. Light projection - only fields the UI needs.
export const listDraftCampaignsForPicker = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brands = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    const brandIds = brands.map((b) => b._id);
    if (brandIds.length === 0) return [];

    const drafts: any[] = [];
    for (const bid of brandIds) {
      const rows = await ctx.db
        .query("campaigns")
        .withIndex("by_brandId_status", (q) => q.eq("brandId", bid).eq("status", "draft"))
        .collect();
      for (const c of rows) drafts.push(c);
    }
    drafts.sort((a, b) => (b.updatedAt ?? b._creationTime) - (a.updatedAt ?? a._creationTime));
    return drafts.map((c) => ({
      _id: c._id,
      name: c.name,
      angleCount: (c.selectedAngles ?? []).length,
      updatedAt: c.updatedAt ?? c._creationTime,
      productImageUrl: c.products?.[0]?.imageUrl,
    }));
  },
});

export const deleteCampaign = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("not authorized");
    }

    if (!["draft", "generating", "failed", "partial", "ready"].includes(campaign.status)) {
      throw new Error("can only delete draft, generating, failed, partial, or ready campaigns");
    }

    // Decrement template usage count since campaign never completed
    if (campaign.templateId) {
      try {
        const template = await ctx.db.get(campaign.templateId as any);
        if (template && typeof (template as any).usageCount === "number" && (template as any).usageCount > 0) {
          await ctx.db.patch(template._id, { usageCount: (template as any).usageCount - 1 });
        }
      } catch {
        // Template may have been deleted - safe to ignore
      }
    }

    await ctx.db.delete(args.campaignId);
    return args.campaignId;
  },
});

export const getCampaignProgress = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;

    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) return null;

    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    const breakdown = await computeCampaignGenerationProgress(ctx, campaign, tasks);

    return {
      // Existing fields preserved for callers that read total/completed/failed.
      total: breakdown.total,
      completed: breakdown.completed,
      failed: breakdown.failed,
      progress: breakdown.progress,
      // Per-kind breakdown so UI can say "2 media + 1 caption failed" instead
      // of bundling them under one ambiguous count.
      media: breakdown.media,
      captions: breakdown.captions,
    };
  },
});

export const reconcileGenerationStatus = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("campaign not found");
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    const eligible = ["generating", "partial", "failed"];
    if (!eligible.includes(campaign.status)) {
      return { status: campaign.status, changed: false };
    }

    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const progress = await computeCampaignGenerationProgress(ctx, campaign, tasks);
    const nextStatus = deriveGenerationStatus(progress);
    if (!nextStatus || nextStatus === campaign.status) {
      return { status: campaign.status, changed: false };
    }

    await ctx.db.patch(args.campaignId, {
      status: nextStatus,
      updatedAt: Date.now(),
    });
    return { status: nextStatus, changed: true };
  },
});

// ─── transitionCampaignToReady (internal) ────────────────────────────────────
// Called by agentTasks.completeTask/failTask when all tasks for a campaign are
// resolved.
//
// Status semantics:
//   "generating" -> any task still pending/running
//   "ready"      -> every task completed successfully (shippable)
//   "partial"    -> all tasks terminal but some failed (needs attention)
//   "failed"     -> every task failed (catastrophic)
//
// "ready" is reserved for fully successful runs so the UI can trust it. When
// the user retries failed tasks, recompute and auto-promote partial -> ready
// once the last failure clears.

export const transitionCampaignToReady = internalMutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return;
    // Allow transitioning OUT of "generating" / "partial" / "failed". Once a
    // campaign reaches "scheduled"/"live"/etc the downstream lifecycle owns
    // the status field.
    const eligible = ["generating", "partial", "failed"];
    if (!eligible.includes(campaign.status)) return;

    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    const progress = await computeCampaignGenerationProgress(ctx, campaign, tasks);
    const nextStatus = deriveGenerationStatus(progress);
    if (!nextStatus || nextStatus === "generating") return;

    if (nextStatus !== campaign.status) {
      await ctx.db.patch(args.campaignId, {
        status: nextStatus,
        updatedAt: Date.now(),
      });
    }
  },
});

// ─── getCampaignInternal ─────────────────────────────────────────────────────

export const getCampaignInternal = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.campaignId);
  },
});

// ─── listCompletedOptInCampaigns (internal) ───────────────────────────────────
// Used by the cron to extract trending templates from opt-in completed campaigns.

export const listCompletedOptInCampaigns = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("campaigns")
      .withIndex("by_brandId_status", (q) =>
        q.eq("brandId", args.brandId).eq("status", "completed")
      )
      .collect();
  },
});


// admin schema
export const getAllCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    // Get all campaigns with brand information
    const campaigns = await ctx.db
      .query("campaigns")
      .collect();

    // Enrich campaigns with brand information
    const enrichedCampaigns = await Promise.all(
      campaigns.map(async (campaign) => {
        const brand = await ctx.db.get(campaign.brandId);
        return {
          ...campaign,
          brand: brand ? {
            id: brand._id,
            name: brand.name,
            logoUrl: brand.logoUrl,
          } : null,
        };
      })
    );

    return enrichedCampaigns.sort((a, b) => b.createdAt - a.createdAt);
  },
});
