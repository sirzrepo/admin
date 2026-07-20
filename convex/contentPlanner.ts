import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { checkPublishStatus, uploadPhotoToTikTok, uploadVideoToTikTok, validateTikTokDisclosureSettings } from "./services/tiktok";

const TIKTOK = "tiktok";
const tiktokSettingsValidator = v.object({
  privacyLevel: v.optional(v.union(
    v.literal("PUBLIC_TO_EVERYONE"),
    v.literal("MUTUAL_FOLLOW_FRIENDS"),
    v.literal("FOLLOWER_OF_CREATOR"),
    v.literal("SELF_ONLY"),
  )),
  disableComment: v.optional(v.boolean()),
  disableDuet: v.optional(v.boolean()),
  disableStitch: v.optional(v.boolean()),
  contentDisclosureEnabled: v.optional(v.boolean()),
  brandOrganicToggle: v.optional(v.boolean()),
  brandContentToggle: v.optional(v.boolean()),
  coverTimestampMs: v.optional(v.number()),
});

export const listPlannerItems = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    const plannerItems = await ctx.db
      .query("contentItems")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    const scheduledPosts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    const campaignNames = new Map<string, string>();
    for (const post of scheduledPosts) {
      const key = String(post.campaignId);
      if (!campaignNames.has(key)) {
        const campaign = await ctx.db.get(post.campaignId);
        campaignNames.set(key, campaign?.name || "Campaign post");
      }
    }

    return [
      ...plannerItems.map((item) => ({
        id: String(item._id),
        source: "planner",
        title: item.title,
        caption: item.caption,
        status: item.status,
        platforms: item.platforms,
        scheduledAt: item.scheduledAt ?? dateStringToMs(item.date),
        postedAt: item.postedAt,
        mediaUrl: item.mediaUrl,
        mediaType: item.mediaType,
        assetTaskId: item.assetTaskId ? String(item.assetTaskId) : undefined,
        assetName: item.assetName,
        tiktokSettings: item.tiktokSettings,
        error: item.error,
        canEdit: item.status !== "posted" && item.status !== "publishing",
        canDelete: item.status !== "posted" && item.status !== "publishing",
      })),
      ...scheduledPosts.map((post) => ({
        id: String(post._id),
        source: "campaign",
        title: campaignNames.get(String(post.campaignId)) || "Campaign post",
        caption: post.caption,
        status: post.status,
        platforms: [post.platform],
        scheduledAt: post.scheduledAt,
        postedAt: post.postedAt,
        mediaUrl: post.assetUrl,
        mediaType: post.mediaType,
        error: post.error,
        campaignId: String(post.campaignId),
        canEdit: false,
        canDelete: false,
      })),
    ].sort((a, b) => (a.scheduledAt ?? 0) - (b.scheduledAt ?? 0));
  },
});

export const createPlannerItem = mutation({
  args: {
    brandId: v.id("brands"),
    title: v.string(),
    caption: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    status: v.union(v.literal("draft"), v.literal("scheduled")),
    platforms: v.optional(v.array(v.string())),
    mediaUrl: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    assetTaskId: v.optional(v.id("agentTasks")),
    assetName: v.optional(v.string()),
    tiktokSettings: v.optional(tiktokSettingsValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    const platforms = normalizePlannerPlatforms(args.platforms);

    if (args.status === "scheduled") {
      if (!args.scheduledAt) throw new Error("Choose a date and time before scheduling.");
      if (!args.mediaUrl) throw new Error("Add media before scheduling to TikTok.");
      if (!platforms.includes(TIKTOK)) throw new Error("Select TikTok before scheduling.");
      const policyError = validateTikTokDisclosureSettings(args.tiktokSettings);
      if (policyError) throw new Error(policyError);
      await assertTikTokConnected(ctx, args.brandId);
    }

    const now = Date.now();
    const itemId = await ctx.db.insert("contentItems", {
      brandId: args.brandId,
      title: args.title.trim(),
      caption: args.caption?.trim() || undefined,
      date: dateString(args.scheduledAt ?? now),
      platforms,
      status: args.status,
      type: "post",
      mediaUrl: args.mediaUrl,
      mediaType: args.mediaType,
      assetTaskId: args.assetTaskId,
      assetName: args.assetName,
      tiktokSettings: args.tiktokSettings,
      scheduledAt: args.scheduledAt,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });

    if (args.status === "scheduled" && args.scheduledAt) {
      await schedulePlannerPublish(ctx, itemId, args.scheduledAt);
    }

    return itemId;
  },
});

export const updatePlannerItem = mutation({
  args: {
    itemId: v.id("contentItems"),
    title: v.optional(v.string()),
    caption: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    status: v.optional(v.union(v.literal("draft"), v.literal("scheduled"))),
    platforms: v.optional(v.array(v.string())),
    mediaUrl: v.optional(v.string()),
    mediaType: v.optional(v.string()),
    assetTaskId: v.optional(v.id("agentTasks")),
    assetName: v.optional(v.string()),
    tiktokSettings: v.optional(tiktokSettingsValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("post not found");
    const brand = await ctx.db.get(item.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    if (item.status === "posted" || item.status === "publishing") {
      throw new Error("Cannot edit a post after publishing has started.");
    }

    const nextStatus = args.status ?? item.status;
    const nextPlatforms = args.platforms ? normalizePlannerPlatforms(args.platforms) : item.platforms;
    const nextScheduledAt = args.scheduledAt ?? item.scheduledAt;
    const nextMediaUrl = args.mediaUrl ?? item.mediaUrl;
    if (nextStatus === "scheduled") {
      if (!nextScheduledAt) throw new Error("Choose a date and time before scheduling.");
      if (!nextMediaUrl) throw new Error("Add media before scheduling to TikTok.");
      if (!nextPlatforms.includes(TIKTOK)) throw new Error("Select TikTok before scheduling.");
      const policyError = validateTikTokDisclosureSettings(args.tiktokSettings ?? item.tiktokSettings);
      if (policyError) throw new Error(policyError);
      await assertTikTokConnected(ctx, item.brandId);
    }

    await ctx.db.patch(args.itemId, {
      ...(args.title !== undefined ? { title: args.title.trim() } : {}),
      ...(args.caption !== undefined ? { caption: args.caption.trim() || undefined } : {}),
      ...(args.scheduledAt !== undefined ? { scheduledAt: args.scheduledAt, date: dateString(args.scheduledAt) } : {}),
      ...(args.status !== undefined ? { status: args.status, error: undefined } : {}),
      ...(args.platforms !== undefined ? { platforms: nextPlatforms } : {}),
      ...(args.mediaUrl !== undefined ? { mediaUrl: args.mediaUrl } : {}),
      ...(args.mediaType !== undefined ? { mediaType: args.mediaType } : {}),
      ...(args.assetTaskId !== undefined ? { assetTaskId: args.assetTaskId } : {}),
      ...(args.assetName !== undefined ? { assetName: args.assetName.trim() || undefined } : {}),
      ...(args.tiktokSettings !== undefined ? { tiktokSettings: args.tiktokSettings } : {}),
      updatedAt: Date.now(),
    });

    if (nextStatus === "scheduled" && nextScheduledAt) {
      await schedulePlannerPublish(ctx, args.itemId, nextScheduledAt);
    }

    return args.itemId;
  },
});

export const deletePlannerItem = mutation({
  args: { itemId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const item = await ctx.db.get(args.itemId);
    if (!item) return;
    const brand = await ctx.db.get(item.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    if (item.status === "posted" || item.status === "publishing") {
      throw new Error("Cannot delete a post after publishing has started.");
    }
    await ctx.db.delete(args.itemId);
  },
});

export const retryPlannerItem = mutation({
  args: { itemId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const item = await ctx.db.get(args.itemId);
    if (!item) throw new Error("post not found");
    const brand = await ctx.db.get(item.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    if (item.status !== "failed") throw new Error("Only failed posts can be retried.");
    if (!item.platforms.includes(TIKTOK)) throw new Error("Select TikTok before retrying.");
    if (!item.mediaUrl) throw new Error("Add media before retrying.");
    await assertTikTokConnected(ctx, item.brandId);

    await ctx.db.patch(args.itemId, {
      status: "scheduled",
      error: undefined,
      platformPostId: undefined,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.contentPlanner.publishPlannerItem, {
      itemId: args.itemId,
    });
    return args.itemId;
  },
});

export const generateWeeklyPlan = action({
  args: {
    brandId: v.id("brands"),
    businessGoal: v.string(),
    postingFrequency: v.string(),
    contentStyle: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.contentPlanner.assertBrandOwner, {
      brandId: args.brandId,
    });
    const requestedPostCount = Math.max(1, Math.min(7, Number.parseInt(args.postingFrequency, 10) || 3));
    const skuConfig = await ctx.runQuery(internal.billing.getSkuConfigurationInternal, {
      skuKey: "text.content_planner_weekly_plan",
    });
    const configuredBatchSize = skuConfig.metadata?.batchSize;
    const batchSize = typeof configuredBatchSize === "number" && configuredBatchSize > 0
      ? configuredBatchSize
      : 3;
    const units = Math.ceil(requestedPostCount / batchSize);

    const billing = process.env.OPENROUTER_API_KEY
      ? await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
        userId,
        brandId: args.brandId,
        featureKey: "helper_ai",
        skuKey: "text.content_planner_weekly_plan",
        units,
        metadata: { source: "content_planner_weekly_plan", requestedPostCount, batchSize },
      })
      : null;

    try {
      const result = await generateWeeklyDrafts(args.businessGoal, args.postingFrequency, args.contentStyle);
      await ctx.runMutation(internal.contentPlanner.insertGeneratedDrafts, {
        brandId: args.brandId,
        drafts: result.drafts,
      });
      if (billing && result.usedAi) {
        await ctx.runMutation(internal.billing.chargeReservationInternal, {
          reservationId: billing.reservationId,
          userId,
          skuKey: "text.content_planner_weekly_plan",
          reason: "Charged for weekly content plan",
        });
      } else if (billing) {
        await ctx.runMutation(internal.billing.releaseReservationInternal, {
          reservationId: billing.reservationId,
          userId,
          skuKey: "text.content_planner_weekly_plan",
          reason: "Released because planner used deterministic fallback",
        });
      }
      return { created: result.drafts.length };
    } catch (error) {
      if (billing) {
        await ctx.runMutation(internal.billing.releaseReservationInternal, {
          reservationId: billing.reservationId,
          userId,
          skuKey: "text.content_planner_weekly_plan",
          reason: error instanceof Error ? error.message : "Weekly content plan failed",
        });
      }
      throw error;
    }
  },
});

export const generateCaption = action({
  args: {
    brandId: v.id("brands"),
    title: v.string(),
    currentCaption: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await ctx.runQuery(internal.contentPlanner.assertBrandOwner, {
      brandId: args.brandId,
    });
    const billing = process.env.OPENROUTER_API_KEY
      ? await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
        userId,
        brandId: args.brandId,
        featureKey: "helper_ai",
        skuKey: "text.planner_caption",
        units: 1,
        metadata: { source: "content_planner_caption" },
      })
      : null;
    try {
      const result = await generateCaptionText(args.title, args.currentCaption);
      if (billing && result.usedAi) {
        await ctx.runMutation(internal.billing.chargeReservationInternal, {
          reservationId: billing.reservationId,
          userId,
          skuKey: "text.planner_caption",
          reason: "Charged for planner caption",
        });
      } else if (billing) {
        await ctx.runMutation(internal.billing.releaseReservationInternal, {
          reservationId: billing.reservationId,
          userId,
          skuKey: "text.planner_caption",
          reason: "Released because caption used deterministic fallback",
        });
      }
      return { caption: result.caption };
    } catch (error) {
      if (billing) {
        await ctx.runMutation(internal.billing.releaseReservationInternal, {
          reservationId: billing.reservationId,
          userId,
          skuKey: "text.planner_caption",
          reason: error instanceof Error ? error.message : "Planner caption generation failed",
        });
      }
      throw error;
    }
  },
});

export const assertBrandOwner = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");
    return String(userId);
  },
});

export const insertGeneratedDrafts = internalMutation({
  args: {
    brandId: v.id("brands"),
    drafts: v.array(v.object({
      title: v.string(),
      caption: v.string(),
      scheduledAt: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const draft of args.drafts) {
      await ctx.db.insert("contentItems", {
        brandId: args.brandId,
        title: draft.title,
        caption: draft.caption,
        date: dateString(draft.scheduledAt),
        platforms: [TIKTOK],
        status: "draft",
        type: "post",
        scheduledAt: draft.scheduledAt,
        source: "ai_weekly_plan",
        createdAt: now,
        updatedAt: now,
      });
    }
  },
});

export const getPlannerItemForPublishing = internalQuery({
  args: { itemId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) return null;
    const connection = await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId_platform", (q) => q.eq("brandId", item.brandId).eq("platform", TIKTOK))
      .filter((q) => q.eq(q.field("isActive"), true))
      .first();
    return { item, connection };
  },
});

export const patchPlannerItemPublishState = internalMutation({
  args: {
    itemId: v.id("contentItems"),
    status: v.string(),
    platformPostId: v.optional(v.string()),
    postedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    mediaUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      status: args.status,
      ...(args.platformPostId !== undefined ? { platformPostId: args.platformPostId } : {}),
      ...(args.postedAt !== undefined ? { postedAt: args.postedAt } : {}),
      ...(args.error !== undefined ? { error: args.error } : {}),
      ...(args.mediaUrl !== undefined ? { mediaUrl: args.mediaUrl } : {}),
      updatedAt: Date.now(),
    });
  },
});

export const publishPlannerItem = internalAction({
  args: { itemId: v.id("contentItems") },
  handler: async (ctx, args) => {
    const data = await ctx.runQuery(internal.contentPlanner.getPlannerItemForPublishing, args);
    if (!data?.item) return;
    const { item, connection } = data;
    if (item.status !== "scheduled") return;

    if (!connection?.accessToken) {
      await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
        itemId: args.itemId,
        status: "failed",
        error: "No active TikTok connection found.",
      });
      return;
    }
    if (!item.mediaUrl) {
      await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
        itemId: args.itemId,
        status: "failed",
        error: "No media attached.",
      });
      return;
    }

    // Mirror the scheduled-post publish path: if the planner item still
    // points at a short-lived fal.ai URL and we know the source task, force
    // R2 persistence first so we don't push a dead URL to TikTok. Retries
    // before this used to fail repeatedly with the same expired URL.
    let resolvedMediaUrl = item.mediaUrl;
    if (item.assetTaskId && !resolvedMediaUrl.includes("r2.dev")) {
      console.log(`[publishPlannerItem] Media URL not on R2 for item ${args.itemId}, forcing persistence`);
      await ctx.runAction(internal.agentTasks.persistAssetToR2, { taskId: item.assetTaskId });
      const refreshed = await ctx.runQuery(internal.agentTasks.getTaskInternal, { taskId: item.assetTaskId });
      const refreshedUrl = refreshed?.output?.videoUrl ?? refreshed?.output?.imageUrl;
      if (refreshedUrl && refreshedUrl.includes("r2.dev")) {
        resolvedMediaUrl = refreshedUrl;
        await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
          itemId: args.itemId,
          status: "publishing",
          mediaUrl: refreshedUrl,
        });
      } else {
        await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
          itemId: args.itemId,
          status: "failed",
          error: "Asset is no longer available (fal.ai URL expired and R2 persistence failed). Re-generate the asset and reschedule.",
        });
        return;
      }
    }

    const mediaType = item.mediaType || (looksLikeImageUrl(resolvedMediaUrl) ? "image" : "video");
    const tiktokSettings = item.tiktokSettings || { privacyLevel: "PUBLIC_TO_EVERYONE" as const };

    if (mediaType === "image") {
      try {
        const rendition = await ctx.runAction(internal.mediaRenditions.prepareImageForDestination, {
          brandId: item.brandId,
          sourceUrl: resolvedMediaUrl,
          destination: "tiktok-photo",
        });
        resolvedMediaUrl = rendition.url;
      } catch (error) {
        await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
          itemId: args.itemId,
          status: "failed",
          error: error instanceof Error
            ? error.message
            : "We could not prepare this image for TikTok.",
        });
        return;
      }
    }

    const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
      brandId: item.brandId,
    });
    if ("error" in tokenResult) {
      await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
        itemId: args.itemId,
        status: "failed",
        error: tokenResult.error === "refresh_token_invalid" || tokenResult.error === "no_refresh_token"
          ? "TikTok connection expired - please reconnect TikTok and try again."
          : `TikTok token refresh failed: ${tokenResult.error}`,
      });
      return;
    }
    const accessToken = tokenResult.accessToken;

    const result = mediaType === "image"
      ? await uploadPhotoToTikTok({
          accessToken,
          imageUrl: resolvedMediaUrl,
          caption: item.caption || item.title,
          settings: tiktokSettings,
        })
      : await uploadVideoToTikTok({
          accessToken,
          videoUrl: resolvedMediaUrl,
          caption: item.caption || item.title,
          settings: tiktokSettings,
        });

    if (!result.success || !result.publishId) {
      await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
        itemId: args.itemId,
        status: "failed",
        error: result.error || "TikTok publish failed.",
      });
      return;
    }

    await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
      itemId: args.itemId,
      status: "publishing",
      platformPostId: result.publishId,
    });
    await ctx.scheduler.runAfter(60 * 1000, internal.contentPlanner.checkPlannerPublishCompletion, {
      itemId: args.itemId,
      attempt: 0,
    });
  },
});

export const checkPlannerPublishCompletion = internalAction({
  args: { itemId: v.id("contentItems"), attempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const attempt = args.attempt ?? 0;
    const data = await ctx.runQuery(internal.contentPlanner.getPlannerItemForPublishing, { itemId: args.itemId });
    if (!data?.item || data.item.status !== "publishing" || !data.item.platformPostId) return;
    if (!data.connection?.accessToken) return;

    const tokenResult = await ctx.runAction(internal.platformConnections.ensureFreshTikTokAccessToken, {
      brandId: data.item.brandId,
    });
    if ("error" in tokenResult) {
      console.warn(`[ContentPlanner] Status check skipped - token refresh failed: ${tokenResult.error}`);
      return;
    }

    const result = await checkPublishStatus(tokenResult.accessToken, data.item.platformPostId);
    if (result.status === "PUBLISH_COMPLETE") {
      await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
        itemId: args.itemId,
        status: "posted",
        postedAt: Date.now(),
      });
      return;
    }
    if (result.status === "FAILED" || result.status === "PUBLISH_FAILED") {
      await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
        itemId: args.itemId,
        status: "failed",
        error: result.error || `TikTok publish failed (${result.status})`,
      });
      return;
    }
    if (attempt < 12) {
      await ctx.scheduler.runAfter(60 * 1000, internal.contentPlanner.checkPlannerPublishCompletion, {
        itemId: args.itemId,
        attempt: attempt + 1,
      });
    } else {
      await ctx.runMutation(internal.contentPlanner.patchPlannerItemPublishState, {
        itemId: args.itemId,
        status: "failed",
        error: `TikTok did not confirm publish completion. Last status: ${result.status}.`,
      });
    }
  },
});

async function assertTikTokConnected(ctx: any, brandId: any) {
  const connection = await ctx.db
    .query("platformConnections")
    .withIndex("by_brandId_platform", (q: any) => q.eq("brandId", brandId).eq("platform", TIKTOK))
    .filter((q: any) => q.eq(q.field("isActive"), true))
    .first();
  if (!connection) throw new Error("Connect TikTok in Settings before scheduling.");
}

async function schedulePlannerPublish(ctx: any, itemId: any, scheduledAt: number) {
  if (scheduledAt <= Date.now()) {
    await ctx.scheduler.runAfter(0, internal.contentPlanner.publishPlannerItem, { itemId });
  } else {
    await ctx.scheduler.runAt(scheduledAt, internal.contentPlanner.publishPlannerItem, { itemId });
  }
}

function normalizePlannerPlatforms(platforms?: string[]) {
  return Array.from(new Set((platforms ?? [TIKTOK]).filter((platform) => platform === TIKTOK)));
}

function dateString(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function dateStringToMs(value: string) {
  const ms = Date.parse(`${value}T12:00:00`);
  return Number.isFinite(ms) ? ms : Date.now();
}

function looksLikeImageUrl(url: string) {
  try {
    return /\.(png|jpe?g|webp|gif|avif|heic|heif)$/i.test(new URL(url).pathname);
  } catch {
    return /\.(png|jpe?g|webp|gif|avif|heic|heif)(\?|#|$)/i.test(url);
  }
}

function fallbackWeeklyDrafts(goal: string, frequency: string, style: string) {
  const count = Math.max(1, Math.min(7, Number.parseInt(frequency, 10) || 3));
  const titles = ["Launch angle", "Product proof", "Customer story", "Offer reminder", "Behind the scenes", "FAQ answer", "Weekend push"];
  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(18, 0, 0, 0);
  return Array.from({ length: count }).map((_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i * 2);
    return {
      title: titles[i % titles.length],
      caption: `${goal.trim() || "Grow awareness"} - ${style.trim() || "clear, useful TikTok content"}.`,
      scheduledAt: d.getTime(),
    };
  });
}

async function generateWeeklyDrafts(goal: string, frequency: string, style: string) {
  const count = Math.max(1, Math.min(7, Number.parseInt(frequency, 10) || 3));
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) return { drafts: fallbackWeeklyDrafts(goal, frequency, style), usedAi: false };

  try {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    const { generateObject } = await import("ai");
    const { z } = await import("zod");
    const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });

    const start = new Date();
    start.setDate(start.getDate() + 1);
    start.setHours(18, 0, 0, 0);

    const result = await generateObject({
      model: openrouter("openai/gpt-4o-mini"),
      schema: z.object({
        posts: z.array(z.object({
          title: z.string(),
          caption: z.string(),
          dayOffset: z.number(),
          hour: z.number(),
          minute: z.number(),
        })),
      }),
      system: "You are a senior TikTok content strategist. Create concise, practical post drafts that a merchant can edit before scheduling. Return only structured data.",
      prompt: `Create ${count} TikTok post drafts for the next 7 days.

Business goal: ${goal || "Grow awareness and sales"}
Posting frequency: ${frequency || `${count} posts`}
Content style: ${style || "clear, helpful, product-led"}

Rules:
- Each title should be under 50 characters.
- Each caption should be ready for TikTok and under 220 characters.
- dayOffset must be 1-7.
- hour should be between 9 and 21.
- Space posts naturally across the week.`,
    });

    const posts = result.object.posts.slice(0, count);
    if (posts.length !== count) return { drafts: fallbackWeeklyDrafts(goal, frequency, style), usedAi: false };

    const drafts = posts.map((post, index) => {
      const d = new Date(start);
      d.setDate(start.getDate() + Math.max(1, Math.min(7, Math.round(post.dayOffset))) - 1);
      d.setHours(
        Math.max(9, Math.min(21, Math.round(post.hour))),
        Math.max(0, Math.min(59, Math.round(post.minute || 0))),
        0,
        0,
      );
      return {
        title: post.title.trim() || `TikTok Draft ${index + 1}`,
        caption: post.caption.trim(),
        scheduledAt: d.getTime(),
      };
    });
    return { drafts, usedAi: true };
  } catch (error) {
    console.error("[ContentPlanner] Weekly plan AI failed:", error);
    return { drafts: fallbackWeeklyDrafts(goal, frequency, style), usedAi: false };
  }
}

async function generateCaptionText(title: string, currentCaption?: string) {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  const cleanTitle = title.trim() || "TikTok post";
  const cleanCaption = currentCaption?.trim();
  if (!OPENROUTER_API_KEY) return { caption: fallbackCaption(cleanTitle, cleanCaption), usedAi: false };

  try {
    const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
    const { generateObject } = await import("ai");
    const { z } = await import("zod");
    const openrouter = createOpenRouter({ apiKey: OPENROUTER_API_KEY });

    const result = await generateObject({
      model: openrouter("openai/gpt-4o-mini"),
      schema: z.object({ caption: z.string() }),
      system: "You write concise TikTok captions for ecommerce brands. Keep captions natural, specific, and under 220 characters.",
      prompt: cleanCaption
        ? `Regenerate this TikTok caption while keeping the intent.\n\nPost title: ${cleanTitle}\nCurrent caption: ${cleanCaption}`
        : `Generate one TikTok caption for this post title: ${cleanTitle}`,
    });

    return {
      caption: result.object.caption.trim() || fallbackCaption(cleanTitle, cleanCaption),
      usedAi: !!result.object.caption.trim(),
    };
  } catch (error) {
    console.error("[ContentPlanner] Caption AI failed:", error);
    return { caption: fallbackCaption(cleanTitle, cleanCaption), usedAi: false };
  }
}

function fallbackCaption(title: string, currentCaption?: string) {
  if (currentCaption) return `${currentCaption} Save this for later and check it out when you're ready.`;
  return `${title} - a quick look at what makes this worth trying.`;
}

// ─── R2 migration for planner mediaUrls ────────────────────────────────────
// Mirrors agentTasks.migrateExistingAssetsToR2 but for the contentItems table.
// When a planner item still points at a short-lived fal.ai URL, we:
//   1. If we know the source agentTask (assetTaskId), persist that task to R2
//      and copy the resulting r2.dev URL onto the planner item.
//   2. Otherwise (orphan URL pasted in directly), copy the URL to R2 under a
//      planner-scoped key and patch the planner item.
// Run from the Convex dashboard: `npx convex run contentPlanner:migratePlannerItemsToR2`

export const patchPlannerItemMediaUrlInternal = internalMutation({
  args: {
    itemId: v.id("contentItems"),
    mediaUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.itemId, {
      mediaUrl: args.mediaUrl,
      updatedAt: Date.now(),
    });
  },
});

export const listPlannerItemsForMigration = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("contentItems").collect();
    const startIdx = args.cursor ? all.findIndex(i => i._id === args.cursor) + 1 : 0;
    const page = all.slice(startIdx, startIdx + args.limit);
    const hasMore = startIdx + args.limit < all.length;
    const nextCursor = page.length > 0 ? page[page.length - 1]._id : null;
    return { items: page, hasMore, cursor: nextCursor };
  },
});

export const migratePlannerItemsToR2 = internalAction({
  args: {},
  handler: async (ctx) => {
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    let cursor: string | null = null;
    const PAGE_SIZE = 100;

    while (true) {
      const result: any = await ctx.runQuery(internal.contentPlanner.listPlannerItemsForMigration, {
        cursor: cursor ?? undefined,
        limit: PAGE_SIZE,
      });

      for (const item of result.items) {
        if (!item.mediaUrl) { skipped++; continue; }
        if (item.mediaUrl.includes("r2.dev")) { skipped++; continue; }

        try {
          let newUrl: string | undefined;

          if (item.assetTaskId) {
            // Source task path: persist the underlying task (idempotent),
            // then copy the resulting r2.dev URL onto the planner item.
            await ctx.runAction(internal.agentTasks.persistAssetToR2, { taskId: item.assetTaskId });
            const refreshed = await ctx.runQuery(internal.agentTasks.getTaskInternal, { taskId: item.assetTaskId });
            newUrl = refreshed?.output?.videoUrl ?? refreshed?.output?.imageUrl;
            if (!newUrl || !newUrl.includes("r2.dev")) {
              console.warn(`[plannerMigrate] item ${item._id}: task ${item.assetTaskId} did not yield an r2.dev URL`);
              failed++;
              continue;
            }
          } else {
            // Orphan path: copy the URL directly to R2 under a planner key.
            // This only works if the fal.ai URL is still alive.
            const ext = item.mediaType === "image"
              ? (item.mediaUrl.match(/\.(webp|png|jpe?g|gif)(\?|$)/i)?.[1]?.toLowerCase() || "webp")
              : (item.mediaUrl.match(/\.(mp4|webm|mov)(\?|$)/i)?.[1]?.toLowerCase() || "mp4");
            const folder = item.mediaType === "image" ? "images" : "videos";
            const key = `brands/${item.brandId}/planner-orphans/${folder}/${item._id}.${ext}`;
            const copy: any = await ctx.runAction(internal.agentTasks.copyUrlToR2, {
              sourceUrl: item.mediaUrl,
              key,
            });
            if (!copy?.r2Url || !copy.r2Url.includes("r2.dev")) {
              console.warn(`[plannerMigrate] item ${item._id}: orphan copy failed (${copy?.error ?? "unknown"})`);
              failed++;
              continue;
            }
            newUrl = copy.r2Url;
          }

          await ctx.runMutation(internal.contentPlanner.patchPlannerItemMediaUrlInternal, {
            itemId: item._id,
            mediaUrl: newUrl ?? "",
          });
          migrated++;
        } catch (err) {
          console.error(`[plannerMigrate] item ${item._id} threw:`, err);
          failed++;
        }

        // Gentle pacing - 250ms between items so a large backfill doesn't
        // hammer fal.ai or R2 in a single burst.
        await new Promise(r => setTimeout(r, 250));
      }

      if (!result.hasMore) break;
      cursor = result.cursor;
    }

    console.log(`[plannerMigrate] migrated=${migrated} skipped=${skipped} failed=${failed}`);
    return { migrated, skipped, failed };
  },
});
