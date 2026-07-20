import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { api, internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { runCharacterDesigner, buildCharacterPrompt } from "./specializedAgents/characterDesigner";
import { runImageGenerator, buildImagePrompt } from "./specializedAgents/imageGenerator";
import { runVideoGenerator, buildVideoPrompt as buildVideoPromptFn } from "./specializedAgents/videoGenerator";
import { runScriptGenerator } from "./specializedAgents/scriptGenerator";
import { runBrandGuideAnalyzer, type BrandGuideAnalyzerInput } from "./specializedAgents/brandGuideAnalyzer";
import { classifyError } from "./lib/errorKind";
import type { CharacterDesignerInput, ImageGeneratorInput, VideoDuration, VideoGeneratorInput, ScriptGeneratorInput } from "./specializedAgents/types";
import { AGENT_REGISTRY } from "./specializedAgents/types";
import { getCurrentTeamMember } from "./helpers";
import {
  finalizeTaskBilling,
  recordTaskSubmittedUsage,
  releaseTaskBilling,
  reserveForAgentTask,
} from "./billing";

// SITE_URL starts with "http://" on localhost dev, "https://" on production.
// Cap campaign video generation to 5s in dev to avoid burning fal.ai credits.
const IS_DEV = (process.env.SITE_URL ?? "http://localhost").startsWith("http://");
function devDuration(d: string): VideoDuration {
  const parsed = Number.parseInt(d, 10);
  const valid = Number.isInteger(parsed) && parsed >= 3 && parsed <= 15
    ? String(parsed) as VideoDuration
    : "5";
  return IS_DEV ? "3" : valid;
}

async function prepareTaskBilling(ctx: any, args: {
  taskId?: any;
  userId: string;
  brandId: any;
  campaignId?: any;
  agentType: string;
  input: any;
  initiatedFrom: string;
}) {
  const billing = await reserveForAgentTask(ctx, {
    userId: args.userId,
    brandId: args.brandId,
    campaignId: args.campaignId,
    agentType: args.agentType,
    input: args.input,
    initiatedFrom: args.initiatedFrom,
  });

  if (args.taskId && billing.reservationId) {
    await ctx.db.patch(billing.reservationId, {
      taskId: args.taskId,
      updatedAt: Date.now(),
    });
  }

  if (args.taskId) {
    await recordTaskSubmittedUsage(ctx, {
      taskId: args.taskId,
      userId: args.userId,
      brandId: args.brandId,
      campaignId: args.campaignId,
      estimate: billing,
    });
  }

  return {
    billing,
    taskFields: {
      reservationId: billing.reservationId,
      skuKey: billing.primarySkuKey,
      creditSource: billing.creditSource,
      creditsPriced: billing.creditsPriced,
      creditsChargedToCustomer: billing.creditsChargedToCustomer,
    },
  };
}

// ─── submitTask ───────────────────────────────────────────────────────────────
// Called by frontend tabs (Creative Studio, Campaigns, etc.) OR by the brand agent tool.
// Inserts a task row and immediately schedules the background fal.ai runner.
// Returns the taskId to the caller so they can start polling status.

export const submitTask = mutation({
  args: {
    brandId: v.id("brands"),
    agentType: v.string(),
    label: v.string(),
    input: v.any(),
    initiatedFrom: v.string(),
    threadId: v.optional(v.string()),
    campaignId: v.optional(v.id("campaigns")),
    angleId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Validate agentType is in the registry
    if (!(args.agentType in AGENT_REGISTRY)) {
      throw new Error(`Unknown agent type: ${args.agentType}`);
    }

    const { billing, taskFields } = await prepareTaskBilling(ctx, {
      userId: String(userId),
      brandId: args.brandId,
      campaignId: args.campaignId,
      agentType: args.agentType,
      input: args.input,
      initiatedFrom: args.initiatedFrom,
    });

    const now = Date.now();
    const taskId = await ctx.db.insert("agentTasks", {
      brandId: args.brandId,
      userId: userId as string,
      agentType: args.agentType,
      label: args.label,
      status: "pending",
      input: args.input,
      output: undefined,
      error: undefined,
      initiatedFrom: args.initiatedFrom,
      falRequestId: undefined,
      threadId: args.threadId,
      campaignId: args.campaignId,
      angleId: args.angleId,
      ...taskFields,
      createdAt: now,
      updatedAt: now,
    });

    if (billing.reservationId) {
      await ctx.db.patch(billing.reservationId, {
        taskId,
        updatedAt: Date.now(),
      });
    }
    await recordTaskSubmittedUsage(ctx, {
      taskId,
      userId: String(userId),
      brandId: args.brandId,
      campaignId: args.campaignId,
      estimate: billing,
    });

    // Schedule the background action immediately (0ms delay)
    await ctx.scheduler.runAfter(0, internal.agentTasks.runSpecializedAgent, {
      taskId,
    });

    return taskId;
  },
});

// ─── recordManualUpload ──────────────────────────────────────────────────────
// Called by the Creative Studio's Asset Reference Picker when a user opts to
// save their manually uploaded reference image into the library so they can
// reuse it later. Image has already been uploaded to R2; we just record a
// completed "manual_upload" task row so it shows up in the Library + Other
// Assets tab. No fal.ai work, no scheduling.

export const recordManualUpload = mutation({
  args: {
    brandId: v.id("brands"),
    imageUrl: v.string(),
    label: v.string(),
    referenceType: v.union(v.literal("character"), v.literal("product")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Ownership check - prevent writing manual uploads into a brand the caller
    // doesn't own.
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Brand not found or not owned by caller");
    }

    const now = Date.now();
    return await ctx.db.insert("agentTasks", {
      brandId: args.brandId,
      userId: userId as string,
      agentType: "manual_upload",
      label: args.label.slice(0, 120),
      status: "completed",
      input: { referenceType: args.referenceType, sourceUrl: args.imageUrl },
      output: { imageUrl: args.imageUrl },
      error: undefined,
      initiatedFrom: "creative_studio",
      falRequestId: undefined,
      threadId: undefined,
      campaignId: undefined,
      angleId: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recordPlannerMediaUpload = mutation({
  args: {
    brandId: v.id("brands"),
    mediaUrl: v.string(),
    mediaType: v.union(v.literal("image"), v.literal("video")),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Brand not found or not owned by caller");
    }

    const now = Date.now();
    return await ctx.db.insert("agentTasks", {
      brandId: args.brandId,
      userId: userId as string,
      agentType: "manual_upload",
      label: args.label.slice(0, 120),
      status: "completed",
      input: { mediaType: args.mediaType, sourceUrl: args.mediaUrl },
      output: args.mediaType === "image"
        ? { imageUrl: args.mediaUrl }
        : { videoUrl: args.mediaUrl },
      error: undefined,
      initiatedFrom: "content_planner",
      falRequestId: undefined,
      threadId: undefined,
      campaignId: undefined,
      angleId: undefined,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ─── getTaskStatus ────────────────────────────────────────────────────────────
// Polled by the frontend every few seconds while a task is in-flight.
// Also used by the Brand Agent checkTaskStatus tool.

export const getTaskStatus = query({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db.get(args.taskId);
  },
});

// ─── listRecentTasks ─────────────────────────────────────────────────────────
// Returns recent tasks for a brand. Used by Brand Agent to report cross-context task awareness
// and by the Creative Studio tab to show task history.

export const listRecentTasks = query({
  args: {
    brandId: v.id("brands"),
    agentType: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    let tasks: any[];

    if (args.agentType) {
      tasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_brandId_agentType", (q) =>
          q.eq("brandId", args.brandId).eq("agentType", args.agentType!)
        )
        .order("desc")
        .take(args.limit ?? 10);
    } else {
      tasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
        .order("desc")
        .take(args.limit ?? 10);
    }

    // Optional status filter in-memory (keep indexes simple)
    if (args.status) {
      tasks = tasks.filter((t) => t.status === args.status);
    }

    return tasks;
  },
});

// ─── listTasksByCampaign ─────────────────────────────────────────────────────
// Returns all tasks linked to a specific campaign via the by_campaignId index.
// Used by CreatorCampaign Step 5 to display real generated assets.

export const listTasksByCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    return await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .order("asc")
      .collect();
  },
});

export const listTasksByCampaignInternal = internalQuery({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .order("asc")
      .collect();
  },
});

// ─── listRecentTasksPaginated ─────────────────────────────────────────────────
// Paginated version of listRecentTasks for the Library page UI.
// Returns tasks with pagination support.

export const listRecentTasksPaginated = query({
  args: {
    brandId: v.id("brands"),
    agentType: v.optional(v.string()),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { page: [], continueCursor: null, isDone: true };
    }

    let query = ctx.db
      .query("agentTasks")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .order("desc");

    const allTasks = await query.collect();
    const filteredTasks = allTasks
      .filter((t) => !args.agentType || t.agentType === args.agentType)
      .filter(isLibraryVisibleTask);

    const start = args.paginationOpts.cursor ? parseInt(args.paginationOpts.cursor, 10) : 0;
    const end = start + args.paginationOpts.numItems;
    const page = filteredTasks.slice(start, end);
    const isDone = end >= filteredTasks.length;

    return {
      page,
      continueCursor: isDone ? null : String(end),
      isDone,
    };
  },
});

// Count of agent tasks for a brand (optionally filtered by agentType).
// Used by the Library UI to show "Showing X-Y of N" alongside cursor-
// paginated results. O(N) over the brand's tasks; fine for typical
// brand sizes. Swap to a counter table if a brand's task count grows
// past a few thousand.
export const countTasksForBrand = query({
  args: {
    brandId: v.id("brands"),
    agentType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return 0;

    let q = ctx.db.query("agentTasks").withIndex("by_brandId", (idx) => idx.eq("brandId", args.brandId));
    const all = await q.collect();
    const filtered = all.filter(isLibraryVisibleTask);
    if (args.agentType) {
      return filtered.filter((t) => t.agentType === args.agentType).length;
    }
    return filtered.length;
  },
});

function isLibraryVisibleTask(t: any) {
  if (t.agentType === "attached_video") return false;
  if (t.agentType === "script_generator" || t.agentType === "caption_generator") return false;
  if (t.status === "completed") return !!(t.output?.imageUrl || t.output?.videoUrl);
  if (t.status === "pending" || t.status === "running") return true;
  if (t.status === "failed") return !!(t.output?.imageUrl || t.output?.videoUrl);
  return false;
}

// ─── listCompletedGenerations ──────────────────────────────────────────────────
// Used by the Library page. Returns completed agent tasks with output image/video URLs.
// Filterable by agentType ("character_designer" | "image_generator" | "video_generator" | undefined for all).

export const listCompletedGenerations = query({
  args: {
    brandId: v.id("brands"),
    agentType: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    let tasks: any[];
    if (args.agentType) {
      tasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_brandId_agentType", (q) =>
          q.eq("brandId", args.brandId).eq("agentType", args.agentType!)
        )
        .order("desc")
        .take(args.limit ?? 50);
    } else {
      tasks = await ctx.db
        .query("agentTasks")
        .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
        .order("desc")
        .take(args.limit ?? 50);
    }

    // Only return completed tasks that have an image/video URL
    return tasks.filter(
      (t) => t.status === "completed" && (t.output?.imageUrl || t.output?.videoUrl)
    );
  },
});

// ─── runSpecializedAgent (internalAction) ──────────────────────────────────────
// Scheduled by submitTask. Calls the pure agent function.
// Uses webhook mode (primary) - fal.ai posts result back to /api/fal-webhook.
// Falls back to polling mode if FAL_WEBHOOK_URL is not configured.

export const runSpecializedAgent = internalAction({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const task = await ctx.runQuery(internal.agentTasks.getTaskInternal, {
      taskId: args.taskId,
    });
    if (!task) {
      console.error(`[runSpecializedAgent] Task not found: ${args.taskId}`);
      return;
    }

    // Mark as running
    await ctx.runMutation(internal.agentTasks.patchTask, {
      taskId: args.taskId,
      status: "running",
    });

    const falApiKey = process.env.FAL_API_KEY;
    if (!falApiKey) {
      await ctx.runMutation(internal.agentTasks.patchTask, {
        taskId: args.taskId,
        status: "failed",
        error: "FAL_API_KEY is not configured. Add it in the Convex dashboard → Settings → Environment Variables.",
      });
      return;
    }

    // Webhook URL: fal.ai will POST the result here when done
    const siteUrl = process.env.CONVEX_SITE_URL;
    const webhookUrl = siteUrl
      ? `${siteUrl}/api/fal-webhook?taskId=${args.taskId}`
      : undefined;

    try {
      if (task.agentType === "character_designer") {
        const typedInput = task.input as CharacterDesignerInput;

        // Build and save the prompt now so the webhook handler can recover it later
        const builtPrompt = buildCharacterPrompt(typedInput);
        await ctx.runMutation(internal.agentTasks.patchTask, {
          taskId: args.taskId,
          input: { ...typedInput, builtPrompt },
        });

        console.log(`[runSpecializedAgent] Dispatching task ${args.taskId} with webhook_url: ${webhookUrl}`);

        const result = await runCharacterDesigner(
          { ...typedInput, builtPrompt },
          falApiKey,
          webhookUrl,
        );

        if ("requestId" in result) {
          // Webhook mode - store the fal.ai requestId and wait for webhook
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            falRequestId: result.requestId,
          });
          console.log(`[runSpecializedAgent] fal.ai job queued. requestId: ${result.requestId}`);
        } else {
          // Polling mode - result is already here
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            status: "completed",
            output: result,
          });
          console.log(`[runSpecializedAgent] Task completed (polling mode): ${args.taskId}`);
        }
      } else if (task.agentType === "image_generator") {
        const typedInput = task.input as ImageGeneratorInput;

        // Build and save the prompt + resolved model/imageUrls so the webhook handler can recover them
        const { prompt: builtPrompt, model: resolvedModel, imageUrls: resolvedImageUrls } = buildImagePrompt(typedInput);
        await ctx.runMutation(internal.agentTasks.patchTask, {
          taskId: args.taskId,
          input: { ...typedInput, builtPrompt, resolvedModel, resolvedImageUrls },
        });

        console.log(`[runSpecializedAgent] Dispatching image_generator task ${args.taskId} via ${resolvedModel}`);

        const result = await runImageGenerator(
          { ...typedInput, builtPrompt, resolvedModel, resolvedImageUrls },
          falApiKey,
          webhookUrl,
        );

        if ("requestId" in result) {
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            falRequestId: result.requestId,
          });
          console.log(`[runSpecializedAgent] image_generator fal.ai job queued. requestId: ${result.requestId}`);
        } else {
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            status: "completed",
            output: result,
          });
          console.log(`[runSpecializedAgent] image_generator completed (polling mode): ${args.taskId}`);
        }
      } else if (task.agentType === "video_generator") {
        const typedInput = task.input as VideoGeneratorInput;

        // Build prompt + resolve model/elements before dispatch so webhook handler can recover them
        const built = buildVideoPromptFn(typedInput);
        const resolvedInput = {
          ...typedInput,
          builtPrompt: built.prompt,
          resolvedModel: built.model,
          resolvedStartImageUrl: built.startImageUrl ?? undefined,
          resolvedElements: built.elements,
        };
        await ctx.runMutation(internal.agentTasks.patchTask, {
          taskId: args.taskId,
          input: resolvedInput,
        });

        console.log(`[runSpecializedAgent] Dispatching video_generator task ${args.taskId} via ${built.model}`);

        const result = await runVideoGenerator(resolvedInput, falApiKey, webhookUrl);

        if ("requestId" in result) {
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            falRequestId: result.requestId,
          });
          console.log(`[runSpecializedAgent] video_generator fal.ai job queued. requestId: ${result.requestId}`);
        } else {
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            status: "completed",
            output: result,
          });
          console.log(`[runSpecializedAgent] video_generator completed (polling mode): ${args.taskId}`);
        }
      } else if (task.agentType === "script_generator") {
        // Script generation uses OpenRouter/Gemini directly - no fal.ai, no webhook
        const typedInput = task.input as ScriptGeneratorInput;
        console.log(`[runSpecializedAgent] Running script_generator for ${typedInput.angles.length} angles`);
        const result = await runScriptGenerator(typedInput);
        await ctx.runMutation(internal.agentTasks.patchTask, {
          taskId: args.taskId,
          status: "completed",
          output: result,
        });
        console.log(`[runSpecializedAgent] script_generator completed: ${result.scripts.length} scripts generated`);
      } else if (task.agentType === "brand_guide_analyzer") {
        // Reads an uploaded document from R2 and extracts structured brand
        // info via Gemini. Synchronous (no fal.ai, no webhook).
        const typedInput = task.input as BrandGuideAnalyzerInput;
        console.log(`[runSpecializedAgent] Running brand_guide_analyzer for ${typedInput.fileName}`);
        const result = await runBrandGuideAnalyzer(typedInput);
        await ctx.runMutation(internal.agentTasks.patchTask, {
          taskId: args.taskId,
          status: "completed",
          output: result,
        });
        console.log(`[runSpecializedAgent] brand_guide_analyzer completed. Fields extracted: ${Object.keys(result.extracted).filter(k => result.extracted[k as keyof typeof result.extracted] !== undefined).length}`);
      } else {
        await ctx.runMutation(internal.agentTasks.patchTask, {
          taskId: args.taskId,
          status: "failed",
          error: `Agent type "${task.agentType}" is not yet implemented.`,
        });
      }
    } catch (error: any) {
      console.error(`[runSpecializedAgent] Error:`, error);
      const status = (error && (error.status ?? error.statusCode)) as number | undefined;
      const errorKind = classifyError({ status, message: error?.message });
      await ctx.runMutation(internal.agentTasks.patchTask, {
        taskId: args.taskId,
        status: "failed",
        error: error?.message || "Unknown error",
        errorKind,
      });
    }
  },
});

// ─── submitTaskInternal (for backend chaining - no auth check) ───────────────

export const submitTaskInternal = internalMutation({
  args: {
    brandId: v.id("brands"),
    userId: v.string(),
    agentType: v.string(),
    label: v.string(),
    input: v.any(),
    initiatedFrom: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    angleId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { billing, taskFields } = await prepareTaskBilling(ctx, {
      userId: args.userId,
      brandId: args.brandId,
      campaignId: args.campaignId,
      agentType: args.agentType,
      input: args.input,
      initiatedFrom: args.initiatedFrom,
    });

    const now = Date.now();
    const taskId = await ctx.db.insert("agentTasks", {
      brandId: args.brandId,
      userId: args.userId,
      agentType: args.agentType,
      label: args.label,
      status: "pending",
      input: args.input,
      output: undefined,
      error: undefined,
      initiatedFrom: args.initiatedFrom,
      falRequestId: undefined,
      threadId: undefined,
      campaignId: args.campaignId,
      angleId: args.angleId,
      ...taskFields,
      createdAt: now,
      updatedAt: now,
    });
    if (billing.reservationId) {
      await ctx.db.patch(billing.reservationId, {
        taskId,
        updatedAt: Date.now(),
      });
    }
    await recordTaskSubmittedUsage(ctx, {
      taskId,
      userId: args.userId,
      brandId: args.brandId,
      campaignId: args.campaignId,
      estimate: billing,
    });
    await ctx.scheduler.runAfter(0, internal.agentTasks.runSpecializedAgent, { taskId });
    return taskId;
  },
});

// Creates a synthetic "attached_video" task row that points at a user-
// supplied existing asset (from Library / a prior Studio output). Marks
// it completed immediately with the source URLs copied by VALUE so the
// campaign survives later deletion of the source. Does NOT schedule
// runSpecializedAgent because there's nothing to actually generate.
export const createAttachedVideoPointer = internalMutation({
  args: {
    brandId: v.id("brands"),
    userId: v.string(),
    campaignId: v.id("campaigns"),
    angleId: v.string(),
    label: v.string(),
    sourceTaskId: v.id("agentTasks"),
    videoUrl: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    thumbnailUrl: v.optional(v.string()),
    aspectRatio: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .filter((q) => q.eq(q.field("agentType"), "attached_video"))
      .collect();
    const existingForAngle = existing.find((task: any) => task.angleId === args.angleId);
    if (existingForAngle) {
      await ctx.db.patch(existingForAngle._id, {
        label: args.label,
        status: "completed",
        input: { angleId: args.angleId, sourceTaskId: args.sourceTaskId },
        output: {
          videoUrl: args.videoUrl,
          imageUrl: args.imageUrl,
          thumbnailUrl: args.thumbnailUrl,
          aspectRatio: args.aspectRatio,
          sourceTaskId: args.sourceTaskId,
        },
        error: undefined,
        updatedAt: now,
      });
      await maybeMarkCampaignReady(ctx, args.campaignId);
      return existingForAngle._id;
    }

    const pointerId = await ctx.db.insert("agentTasks", {
      brandId: args.brandId,
      userId: args.userId,
      agentType: "attached_video",
      label: args.label,
      status: "completed",
      input: { angleId: args.angleId, sourceTaskId: args.sourceTaskId },
      output: {
        videoUrl: args.videoUrl,
        imageUrl: args.imageUrl,
        thumbnailUrl: args.thumbnailUrl,
        aspectRatio: args.aspectRatio,
        sourceTaskId: args.sourceTaskId,
      },
      error: undefined,
      initiatedFrom: "campaign_wizard_attached",
      falRequestId: undefined,
      threadId: undefined,
      campaignId: args.campaignId,
      angleId: args.angleId,
      createdAt: now,
      updatedAt: now,
    });

    await maybeMarkCampaignReady(ctx, args.campaignId);
    return pointerId;
  },
});

// Per-angle terminal check, extended to include captions. A campaign is no
// longer "ready" until every angle has both its media AND its caption
// completed; if any task failed, the campaign moves to "partial" so the UI
// can prompt for retry. Captions previously didn't gate readiness, which let
// missing captions silently slip through.
async function maybeMarkCampaignReady(ctx: any, campaignId: any) {
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) return;
  const eligible = ["generating", "partial", "failed"];
  if (!eligible.includes(campaign.status)) return;

  const tasks = await ctx.db
    .query("agentTasks")
    .withIndex("by_campaignId", (q: any) => q.eq("campaignId", campaignId))
    .collect();

  const selectedTypes = new Set(campaign.selectedTypes ?? []);
  const selectedAngles = (campaign.selectedAngles ?? []).filter((angle: any) =>
    !angle.format || selectedTypes.size === 0 || selectedTypes.has(angle.format),
  );
  if (selectedAngles.length === 0) return;

  const MEDIA_TYPES = ["video_generator", "image_generator", "attached_video"];

  const stillRunning = tasks.some((task: any) =>
    (MEDIA_TYPES.includes(task.agentType) || task.agentType === "caption_generator" || task.agentType === "script_generator") &&
    (task.status === "pending" || task.status === "running"),
  );
  if (stillRunning) return;

  // For each angle: did media succeed AND did caption succeed (if a caption
  // task exists for that angle)?
  let allMediaOk = true;
  let allCaptionsOk = true;
  let anyMediaFailed = false;
  let anyCaptionFailed = false;
  let anyMediaSucceeded = false;
  let anyCaptionSucceeded = false;

  for (const angle of selectedAngles) {
    const mediaTasks = tasks.filter((t: any) =>
      t.angleId === angle.id && MEDIA_TYPES.includes(t.agentType),
    );
    const captionTasks = tasks.filter((t: any) =>
      t.angleId === angle.id && t.agentType === "caption_generator",
    );
    const completedScriptWithCaption = tasks.some((t: any) =>
      t.agentType === "script_generator" &&
      t.status === "completed" &&
      Array.isArray(t.output?.scripts) &&
      t.output.scripts.some((s: any) => s.angleId === angle.id && typeof s.socialCaption === "string" && s.socialCaption.trim()),
    );
    const scriptFailedWithoutCaption = tasks.some((t: any) =>
      t.agentType === "script_generator" &&
      t.status === "failed",
    ) && !completedScriptWithCaption;

    let attachedSourceOk = false;
    if (angle.attachedAssetTaskId) {
      const source = await ctx.db.get(angle.attachedAssetTaskId);
      attachedSourceOk = !!(source?.output?.videoUrl || source?.output?.imageUrl);
    }

    const mediaOk = (mediaTasks.length > 0 && mediaTasks.some(
      (t: any) => t.status === "completed" && (t.output?.videoUrl || t.output?.imageUrl),
    )) || attachedSourceOk;
    const mediaFailed = mediaTasks.length > 0 && mediaTasks.every(
      (t: any) => t.status === "failed",
    );

    const captionOk = completedScriptWithCaption ||
      captionTasks.some((t: any) => t.status === "completed");
    const captionFailed = (
      captionTasks.length > 0 && captionTasks.every((t: any) => t.status === "failed")
    ) || scriptFailedWithoutCaption;

    if (mediaOk) anyMediaSucceeded = true;
    if (completedScriptWithCaption || captionTasks.some((t: any) => t.status === "completed")) {
      anyCaptionSucceeded = true;
    }
    if (!mediaOk) allMediaOk = false;
    if (mediaFailed) anyMediaFailed = true;
    if (!captionOk) allCaptionsOk = false;
    if (captionFailed) anyCaptionFailed = true;
  }

  const fullySuccessful = allMediaOk && allCaptionsOk;
  // Completed copy remains usable output even if every media task fails.
  // Reserve `failed` for runs where neither copy nor media succeeded.
  const totallyFailed = !fullySuccessful && !anyMediaSucceeded && !anyCaptionSucceeded;

  const nextStatus = fullySuccessful
    ? "ready"
    : totallyFailed
      ? "failed"
      : (anyMediaFailed || anyCaptionFailed || !allMediaOk || !allCaptionsOk)
        ? "partial"
        : campaign.status;

  if (nextStatus !== campaign.status) {
    await ctx.db.patch(campaignId, {
      status: nextStatus,
      updatedAt: Date.now(),
    });
  }
}

// ─── spawnVideoTasksFromScript (auto-chain from script_generator) ────────────

export const spawnVideoTasksFromScript = internalAction({
  args: {
    scriptTaskId: v.id("agentTasks"),
    campaignId: v.id("campaigns"),
  },
  handler: async (ctx, args) => {
    const scriptTask = await ctx.runQuery(internal.agentTasks.getTaskInternal, { taskId: args.scriptTaskId });
    if (!scriptTask || scriptTask.status !== "completed" || !scriptTask.output?.scripts) {
      console.error(`[spawnVideoTasksFromScript] Script task not ready: ${args.scriptTaskId}`);
      return;
    }

    const campaign = await ctx.runQuery(internal.campaigns.getCampaignInternal, { campaignId: args.campaignId });
    if (!campaign) {
      console.error(`[spawnVideoTasksFromScript] Campaign not found: ${args.campaignId}`);
      return;
    }

    // Resolve ambassador and product images from campaign data
    const ambassadorId = campaign.ambassadorId;
    let ambassadorImageUrl: string | undefined;
    let ambassadorName: string | undefined;
    let ambassadorPersonality: string | undefined;
    if (ambassadorId) {
      const ambassador = await ctx.runQuery(internal.agentTasks.getAmbassadorInternal, { ambassadorId });
      if (ambassador) {
        ambassadorImageUrl = ambassador.imageUrl;
        ambassadorName = ambassador.name;
        ambassadorPersonality = ambassador.personality;
      }
    }
    const productImageUrl = campaign.products?.[0]?.imageUrl;
    const productName = campaign.products?.[0]?.name || "";

    const scripts = scriptTask.output.scripts as Array<{
      angleId: string;
      socialCaption: string;
      suggestedDuration: string;
      productionBrief: string;
    }>;

    // Find matching angle format from campaign's selectedAngles
    const campaignAngles = (campaign.selectedAngles || []) as Array<{
      id: string;
      format: string;
      name?: string;
      attachedAssetTaskId?: string;
    }>;
    const existingTasks = await ctx.runQuery(internal.agentTasks.listTasksByCampaignInternal, {
      campaignId: args.campaignId,
    });

    for (const script of scripts) {
      const angle = campaignAngles.find(a => a.id === script.angleId);
      const isUgc = angle?.format === "AI UGC Ads";
      const angleName = campaignAngles.find(a => a.id === script.angleId)?.name || script.angleId;
      const finalMediaAlreadySatisfied = existingTasks.some((t: any) =>
        t.angleId === script.angleId &&
        (t.agentType === "video_generator" || t.agentType === "attached_video") &&
        (t.status === "pending" || t.status === "running" || t.status === "completed") &&
        (t.status !== "completed" || t.output?.videoUrl || t.output?.imageUrl),
      );
      const heroImageInFlight = !isUgc && existingTasks.some((t: any) =>
        t.angleId === script.angleId &&
        t.agentType === "image_generator" &&
        (t.status === "pending" || t.status === "running"),
      );
      const completedHeroImage = !isUgc ? existingTasks.find((t: any) =>
        t.angleId === script.angleId &&
        t.agentType === "image_generator" &&
        t.status === "completed" &&
        t.output?.imageUrl,
      ) : null;

      if (finalMediaAlreadySatisfied || heroImageInFlight) {
        console.log(`[spawnVideoTasksFromScript] Media already exists/runs for angle "${script.angleId}" - skipping`);
        continue;
      }

      // If this angle has a user-attached asset, skip video generation
      // entirely and synthesize a pointer task that Preview / Schedule
      // can treat like any other completed video task.
      //
      // CRITICAL: ensure the source is persisted to R2 BEFORE copying its
      // URLs. fal.ai returns temporary URLs that expire; persistAssetToR2
      // downloads them and updates the source's `videoUrl`/`imageUrl`
      // fields in-place with permanent R2 URLs. If we copy before
      // persistence runs, the pointer freezes the expiring fal.ai URL and
      // TikTok publishing fails later when the URL is dead.
      if (angle?.attachedAssetTaskId) {
        await ctx.runAction(internal.agentTasks.persistAssetToR2, {
          taskId: angle.attachedAssetTaskId as any,
        });
        // Re-fetch after persistence so we read the R2 URLs, not stale snapshot.
        const source = await ctx.runQuery(internal.agentTasks.getTaskInternal, {
          taskId: angle.attachedAssetTaskId as any,
        });
        const sourceUrl = source?.output?.videoUrl ?? source?.output?.imageUrl;
        if (!sourceUrl) {
          console.warn(`[spawnVideoTasksFromScript] Attached asset for angle "${angle.id}" has no usable URL; falling back to generation`);
        } else {
          await ctx.runMutation(internal.agentTasks.createAttachedVideoPointer, {
            brandId: campaign.brandId,
            userId: scriptTask.userId,
            campaignId: args.campaignId,
            angleId: angle.id,
            label: angleName,
            sourceTaskId: angle.attachedAssetTaskId as any,
            videoUrl: source?.output?.videoUrl,
            imageUrl: source?.output?.imageUrl,
            thumbnailUrl: source?.output?.thumbnailUrl,
            aspectRatio: source?.input?.aspectRatio ?? source?.output?.aspectRatio,
          });
          console.log(`[spawnVideoTasksFromScript] Attached existing asset for angle "${angle.id}" (source ${angle.attachedAssetTaskId}, persisted)`);
          continue;
        }
      }

      if (isUgc) {
        // UGC Ads - direct to video_generator with voice_control
        const assetReferences: Array<{ type: "character" | "product"; id: string; name: string; imageUrl?: string }> = [];
        if (ambassadorImageUrl) {
          assetReferences.push({ type: "character", id: ambassadorId as string, name: ambassadorName || "Ambassador", imageUrl: ambassadorImageUrl });
        }
        if (productImageUrl) {
          assetReferences.push({ type: "product", id: "product", name: productName, imageUrl: productImageUrl });
        }

        let finalPrompt = script.productionBrief;
        // Prepend ambassador name so buildVideoPrompt's name-regex can replace it
        // with @Element1, making the identity lock deterministic at the Kling layer.
        if (ambassadorName) {
          finalPrompt = `${ambassadorName} is the sole on-camera presenter. ${finalPrompt}`;
        }
        if (ambassadorPersonality) {
          const shortPersonality = ambassadorPersonality.length > 60
            ? ambassadorPersonality.slice(0, 60).replace(/[,.\s]+$/, '')
            : ambassadorPersonality;
          finalPrompt = `Presenter style: ${shortPersonality}. ${finalPrompt}`;
        }

        await ctx.runMutation(internal.agentTasks.submitTaskInternal, {
          brandId: campaign.brandId,
          userId: scriptTask.userId,
          agentType: "video_generator",
          label: `${angleName} - ${productName}`,
          input: {
            prompt: finalPrompt,
            brandName: campaign.name,
            videoStyle: "UGC Ad",
            duration: devDuration(script.suggestedDuration || "10"),
            aspectRatio: "9:16",
            generateAudio: true,
            ...(assetReferences.length > 0 ? { assetReferences } : {}),
          } satisfies Partial<VideoGeneratorInput>,
          initiatedFrom: "campaigns",
          campaignId: args.campaignId,
          angleId: script.angleId,
        });
      } else if (completedHeroImage?.output?.imageUrl) {
        await ctx.runMutation(internal.agentTasks.submitTaskInternal, {
          brandId: campaign.brandId,
          userId: scriptTask.userId,
          agentType: "video_generator",
          label: `${angleName} - ${productName}`,
          input: {
            prompt: `Smooth cinematic camera movement around the product. Subtle motion - slow orbit, gentle zoom, or light particles. The product stays centered and sharp. ${script.productionBrief || ''}`,
            brandName: "",
            videoStyle: "Product Showcase",
            duration: devDuration(script.suggestedDuration || "10"),
            aspectRatio: "9:16",
            generateAudio: false,
            assetReferences: [{ type: "product", id: "product", name: "product", imageUrl: completedHeroImage.output.imageUrl }],
          },
          initiatedFrom: "campaigns",
          campaignId: args.campaignId,
          angleId: script.angleId,
        });
      } else {
        // Product Ads - Step 1: generate hero image, Step 2: animate with Kling
        // First create a styled hero shot using the image generator
        await ctx.runMutation(internal.agentTasks.submitTaskInternal, {
          brandId: campaign.brandId,
          userId: scriptTask.userId,
          agentType: "image_generator",
          label: `Hero image: ${angleName} - ${productName}`,
          input: {
            prompt: `${script.productionBrief} Product photography style. Vertical 9:16. No text, no logos, no watermarks.`,
            brandName: campaign.name,
            primaryColor: undefined,
            brandTone: undefined,
            style: "Product Shot",
            aspectRatio: "9:16" as const,
            ...(productImageUrl ? {
              assetReferences: [{ type: "product" as const, id: "product", name: productName, imageUrl: productImageUrl }],
            } : {}),
            // Metadata for the chain - video_generator reads this after image completes
            _chainToVideo: true,
            _videoPrompt: script.productionBrief,
            _videoDuration: devDuration(script.suggestedDuration || "10"),
          },
          initiatedFrom: "campaigns",
          campaignId: args.campaignId,
          angleId: script.angleId,
        });
      }

      console.log(`[spawnVideoTasksFromScript] Spawned ${isUgc ? 'video' : 'hero image'} task for angle "${script.angleId}" (${isUgc ? 'UGC Ad' : 'Product Ad'}, ${script.suggestedDuration}s)`);
    }

    console.log(`[spawnVideoTasksFromScript] Spawned tasks for ${scripts.length} angles in campaign ${args.campaignId}`);
  },
});

// ─── getAmbassadorInternal ───────────────────────────────────────────────────

export const getAmbassadorInternal = internalQuery({
  args: { ambassadorId: v.id("ambassadors") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.ambassadorId);
  },
});

// ─── getTaskInternal (internalQuery) ──────────────────────────────────────────

export const getTaskInternal = internalQuery({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.taskId);
  },
});

// ─── getTaskByFalRequestId (internalQuery) ────────────────────────────────────
// Used by the fal.ai webhook handler to find the task row matching an incoming callback.

export const getTaskByFalRequestId = internalQuery({
  args: { falRequestId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_falRequestId", (q) => q.eq("falRequestId", args.falRequestId))
      .first();
  },
});

// ─── patchTask (internalMutation) ─────────────────────────────────────────────
// Generic patch used by runSpecializedAgent, completeTask, and failTask.

export const patchTask = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    status: v.optional(v.string()),
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    errorKind: v.optional(v.string()),
    falRequestId: v.optional(v.string()),
    input: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, any> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.output !== undefined) patch.output = args.output;
    if (args.error !== undefined) patch.error = args.error;
    if (args.errorKind !== undefined) patch.errorKind = args.errorKind;
    if (args.falRequestId !== undefined) patch.falRequestId = args.falRequestId;
    if (args.input !== undefined) patch.input = args.input;
    // Clear errorKind on transitions out of "failed" so a retried task that
    // succeeds doesn't keep its old failure label.
    if (args.status === "completed" || args.status === "running" || args.status === "pending") {
      patch.errorKind = undefined;
      patch.error = undefined;
    }
    await ctx.db.patch(args.taskId, patch);

    if (args.status === "completed" || args.status === "failed") {
      const billedTask = await ctx.db.get(args.taskId);
      if (args.status === "completed") {
        await finalizeTaskBilling(ctx, billedTask);
      } else {
        await releaseTaskBilling(ctx, billedTask, args.error ?? "Generation failed");
      }
    }

    // Auto-chain: when script_generator completes, spawn video/image tasks
    // When image_generator with _chainToVideo completes, spawn video_generator
    // Idempotency: check if chained tasks already exist before spawning
    if (args.status === "completed") {
      const task = await ctx.db.get(args.taskId);

      if (task?.agentType === "script_generator" && task.campaignId) {
        await ctx.scheduler.runAfter(0, internal.agentTasks.spawnVideoTasksFromScript, {
          scriptTaskId: args.taskId,
          campaignId: task.campaignId,
        });
      }

      // Product Ad chain: hero image completed → spawn video_generator
      if (task?.agentType === "image_generator" && task.input?._chainToVideo && task.campaignId && task.output?.imageUrl) {
        // Guard: only spawn if no video task exists for this angle yet
        const existingVideo = await ctx.db.query("agentTasks")
          .withIndex("by_campaignId", (q) => q.eq("campaignId", task.campaignId!))
          .collect();
        const hasVideoForAngle = existingVideo.some(t =>
          t.agentType === "video_generator" &&
          t.angleId === task.angleId &&
          (t.status === "pending" || t.status === "running" || t.status === "completed")
        );
        if (hasVideoForAngle) {
          console.log(`[patchTask] Video task already exists for angle "${task.angleId}" - skipping chain`);
        } else {
        await ctx.runMutation(internal.agentTasks.submitTaskInternal, {
          brandId: task.brandId,
          userId: task.userId,
          agentType: "video_generator",
          label: task.label?.replace("Hero image: ", "") || "Product Ad",
          input: {
            prompt: `Smooth cinematic camera movement around the product. Subtle motion - slow orbit, gentle zoom, or light particles. The product stays centered and sharp. ${task.input._videoPrompt || ''}`,
            brandName: "",
            videoStyle: "Product Showcase",
            duration: devDuration(task.input._videoDuration || "10"),
            aspectRatio: "9:16",
            generateAudio: false, // Product ads don't need speech
            assetReferences: [{ type: "product", id: "product", name: "product", imageUrl: task.output.imageUrl }],
          },
          initiatedFrom: "campaigns",
          campaignId: task.campaignId,
          angleId: task.angleId || undefined,
        });
        console.log(`[patchTask] Chained hero image → video_generator for angle "${task.angleId}"`);
        }
      }
    }

    // Auto-update campaign status when all VIDEO tasks reach a terminal state.
    // Also covers the case where script_generator is re-run on an already-complete
    // campaign (caption regeneration): if all video/attached tasks are already done,
    // flip straight back to ready so the campaign never gets stuck in "generating".
    if (args.status === "completed" || args.status === "failed") {
      const task = await ctx.db.get(args.taskId);
      const countsForCompletion =
        task?.campaignId &&
        (task.agentType === "video_generator" ||
          task.agentType === "image_generator" ||
          task.agentType === "attached_video" ||
          task.agentType === "script_generator");

      if (countsForCompletion) {
        await maybeMarkCampaignReady(ctx, task.campaignId);
      }
    }

    // Schedule R2 persistence for completed tasks with media URLs.
    // Mirrors completeTask (webhook path). Without this, fal.ai polling-mode
    // completions land a temporary fal.ai URL on the task and never migrate
    // it to R2, so the URL expires before scheduledPosts try to publish it.
    if (args.status === "completed" && (args.output?.videoUrl || args.output?.imageUrl)) {
      await ctx.scheduler.runAfter(0, internal.agentTasks.persistAssetToR2, {
        taskId: args.taskId,
      });
    }
  },
});

// ─── retryTask - retry a single failed task ─────────────────────────────────

export const retryTask = mutation({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.userId !== String(userId)) throw new Error("Unauthorized");
    if (task.status !== "failed") throw new Error("Can only retry failed tasks");

    const { taskFields } = await prepareTaskBilling(ctx, {
      taskId: args.taskId,
      userId: task.userId,
      brandId: task.brandId,
      campaignId: task.campaignId,
      agentType: task.agentType,
      input: task.input,
      initiatedFrom: task.initiatedFrom,
    });

    // Reset task to pending and clear error
    await ctx.db.patch(args.taskId, {
      status: "pending",
      error: undefined,
      errorKind: undefined,
      output: undefined,
      falRequestId: undefined,
      ...taskFields,
      updatedAt: Date.now(),
    });

    // Re-dispatch
    await ctx.scheduler.runAfter(0, internal.agentTasks.runSpecializedAgent, {
      taskId: args.taskId,
    });

    // If campaign was in a terminal state, flip back to generating so the
    // upcoming completion can recompute ready/partial/failed correctly.
    if (task.campaignId) {
      const campaign = await ctx.db.get(task.campaignId);
      if (campaign && ["failed", "partial", "ready"].includes(campaign.status)) {
        await ctx.db.patch(task.campaignId, { status: "generating", updatedAt: Date.now() });
      }
    }

    return args.taskId;
  },
});

// Bulk-retry every failed task on a campaign. Returns the count of tasks
// rescheduled. Resets the campaign to "generating" once so the recompute
// after each task completes correctly promotes to ready/partial/failed.
export const retryAllFailedForCampaign = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("Campaign not found");
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) throw new Error("Unauthorized");

    const allCampaignTasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const failed = allCampaignTasks.filter((task: any) => {
      if (task.status !== "failed") return false;
      if (task.agentType === "attached_video") return false;
      if (task.agentType === "script_generator") {
        return !allCampaignTasks.some((candidate: any) =>
          candidate.agentType === "script_generator" &&
          candidate.status === "completed" &&
          Array.isArray(candidate.output?.scripts) &&
          candidate.output.scripts.some((s: any) => typeof s.socialCaption === "string" && s.socialCaption.trim()),
        );
      }
      if (task.agentType === "image_generator" || task.agentType === "video_generator") {
        const sameAngle = allCampaignTasks.filter((candidate: any) => candidate.angleId === task.angleId);
        const hasCompletedFinal = sameAngle.some((candidate: any) =>
          (candidate.agentType === "video_generator" || candidate.agentType === "attached_video") &&
          candidate.status === "completed" &&
          (candidate.output?.videoUrl || candidate.output?.imageUrl),
        );
        if (hasCompletedFinal) return false;
        if (task.agentType === "image_generator") {
          return !sameAngle.some((candidate: any) =>
            candidate.agentType === "image_generator" &&
            candidate.status === "completed" &&
            candidate.output?.imageUrl,
          );
        }
      }
      return true;
    });

    for (const task of failed) {
      const { taskFields } = await prepareTaskBilling(ctx, {
        taskId: task._id,
        userId: task.userId,
        brandId: task.brandId,
        campaignId: task.campaignId,
        agentType: task.agentType,
        input: task.input,
        initiatedFrom: task.initiatedFrom,
      });
      await ctx.db.patch(task._id, {
        status: "pending",
        error: undefined,
        errorKind: undefined,
        output: undefined,
        falRequestId: undefined,
        ...taskFields,
        updatedAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.agentTasks.runSpecializedAgent, {
        taskId: task._id,
      });
    }

    if (failed.length > 0 && ["failed", "partial", "ready"].includes(campaign.status)) {
      await ctx.db.patch(args.campaignId, { status: "generating", updatedAt: Date.now() });
    }

    return { retried: failed.length };
  },
});

export const regenerateTask = mutation({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.userId !== userId) throw new Error("Unauthorized");
    if (task.agentType === "attached_video") {
      throw new Error("This is a custom asset - detach and reattach a different one instead.");
    }

    const { taskFields } = await prepareTaskBilling(ctx, {
      taskId: args.taskId,
      userId: task.userId,
      brandId: task.brandId,
      campaignId: task.campaignId,
      agentType: task.agentType,
      input: task.input,
      initiatedFrom: task.initiatedFrom,
    });

    await ctx.db.patch(args.taskId, {
      status: "pending",
      error: undefined,
      errorKind: undefined,
      output: undefined,
      falRequestId: undefined,
      ...taskFields,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.agentTasks.runSpecializedAgent, {
      taskId: args.taskId,
    });

    if (task.campaignId) {
      const campaign = await ctx.db.get(task.campaignId);
      if (campaign && ["ready", "partial", "failed", "completed"].includes(campaign.status)) {
        await ctx.db.patch(task.campaignId, { status: "generating", updatedAt: Date.now() });
      }
    }

    return args.taskId;
  },
});

export const editAndRegenerateTask = mutation({
  args: {
    taskId: v.id("agentTasks"),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.userId !== userId) throw new Error("Unauthorized");
    if (task.agentType === "attached_video") {
      throw new Error("This is a custom asset - detach and reattach a different one.");
    }

    const existingInput = (task.input ?? {}) as Record<string, unknown>;
    const newInput = {
      ...existingInput,
      prompt: args.prompt,
      // Clear resolved/built fields so runSpecializedAgent rebuilds from the new prompt
      builtPrompt: undefined,
      resolvedModel: undefined,
      resolvedStartImageUrl: undefined,
      resolvedElements: undefined,
    };

    const { taskFields } = await prepareTaskBilling(ctx, {
      taskId: args.taskId,
      userId: task.userId,
      brandId: task.brandId,
      campaignId: task.campaignId,
      agentType: task.agentType,
      input: newInput,
      initiatedFrom: task.initiatedFrom,
    });

    await ctx.db.patch(args.taskId, {
      status: "pending",
      error: undefined,
      output: undefined,
      falRequestId: undefined,
      input: newInput,
      ...taskFields,
      updatedAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internal.agentTasks.runSpecializedAgent, {
      taskId: args.taskId,
    });

    if (task.campaignId) {
      const campaign = await ctx.db.get(task.campaignId);
      if (campaign && (campaign.status === "ready" || campaign.status === "failed" || campaign.status === "completed")) {
        await ctx.db.patch(task.campaignId, { status: "generating", updatedAt: Date.now() });
      }
    }

    return args.taskId;
  },
});

export const patchCaptionOutput = mutation({
  args: {
    taskId: v.id("agentTasks"),
    captionIndex: v.optional(v.number()),
    text: v.string(),
    hashtags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.userId !== userId) throw new Error("Unauthorized");

    const output = (task.output ?? {}) as any;
    const text = args.text.trim();
    if (!text) throw new Error("Caption text cannot be empty");

    // script_generator stores captions in output.scripts[N].socialCaption
    if (Array.isArray(output.scripts) && args.captionIndex !== undefined) {
      const idx = args.captionIndex;
      if (idx < 0 || idx >= output.scripts.length) {
        throw new Error("captionIndex out of range");
      }
      const nextScripts = [...output.scripts];
      const hashtagStr = (args.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
      nextScripts[idx] = {
        ...nextScripts[idx],
        socialCaption: hashtagStr ? `${text} ${hashtagStr}` : text,
      };
      await ctx.db.patch(args.taskId, {
        output: { ...output, scripts: nextScripts },
        updatedAt: Date.now(),
      });
    } else if (Array.isArray(output.captions) && args.captionIndex !== undefined) {
      const idx = args.captionIndex;
      if (idx < 0 || idx >= output.captions.length) {
        throw new Error("captionIndex out of range");
      }
      const next = [...output.captions];
      next[idx] = { ...next[idx], text, hashtags: args.hashtags ?? next[idx].hashtags };
      await ctx.db.patch(args.taskId, {
        output: { ...output, captions: next },
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.taskId, {
        output: { ...output, caption: text, hashtags: args.hashtags ?? output.hashtags },
        updatedAt: Date.now(),
      });
    }
  },
});

// ─── regenerateSingleCaption ─────────────────────────────────────────────────
// Regenerates one socialCaption entry from a script_generator task without
// touching any video tasks or campaign status. Fast (single caption, ~200ms).

export const regenerateSingleCaption = action({
  args: {
    taskId: v.id("agentTasks"),
    captionIndex: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    const task = await ctx.runQuery(internal.agentTasks.getTaskInternal, { taskId: args.taskId });
    if (!task) throw new Error("Task not found");
    if (task.agentType !== "script_generator") throw new Error("Not a script task");

    const scripts: any[] = task.output?.scripts ?? [];
    const script = scripts[args.captionIndex];
    if (!script) throw new Error("Caption index out of range");

    const input = task.input as any;
    const angle = (input.angles as any[])?.[args.captionIndex] ?? {};

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not configured");

    const billing = await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
      userId: task.userId,
      brandId: task.brandId,
      campaignId: task.campaignId,
      taskId: args.taskId,
      featureKey: "helper_ai",
      skuKey: "text.caption_regeneration",
      units: 1,
      metadata: { source: "campaign_caption_regeneration", captionIndex: args.captionIndex },
    });

    const contextLines = [
      `Brand: ${input.brandName ?? ""}`,
      input.brandTone ? `Tone: ${input.brandTone}` : null,
      `Product: ${input.productName ?? ""}`,
      input.targetAudience ? `Audience: ${input.targetAudience}` : null,
      input.campaignGoal ? `Campaign goal: ${input.campaignGoal}` : null,
    ].filter(Boolean).join("\n");

    const body = JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You write short, scroll-stopping social media captions for video ads. One caption only. No preamble, no explanation.",
        },
        {
          role: "user",
          content: `Write a fresh social caption for this video angle.\n\n${contextLines}\n\nAngle name: "${angle.name ?? script.angleId}"\nHook: "${angle.hook ?? ""}"\n\nRequirements:\n- Under 150 characters before hashtags\n- Emoji-forward, punchy, scroll-stopping\n- End with 3-5 relevant hashtags on the same line\n- Match the brand tone\n\nRespond with ONLY the caption text + hashtags. Nothing else.`,
        },
      ],
    });

    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        },
        body,
      });

      if (!resp.ok) throw new Error(`OpenRouter error ${resp.status}`);
      const json: any = await resp.json();
      const newCaption = (json.choices?.[0]?.message?.content ?? "").trim();
      if (!newCaption) throw new Error("Empty caption response");

      const nextScripts = [...scripts];
      nextScripts[args.captionIndex] = { ...script, socialCaption: newCaption };

      await ctx.runMutation(internal.agentTasks.patchTaskOutput, {
        taskId: args.taskId,
        output: { ...task.output, scripts: nextScripts },
      });
      await ctx.runMutation(internal.billing.chargeReservationInternal, {
        reservationId: billing.reservationId,
        userId: task.userId,
        taskId: args.taskId,
        skuKey: "text.caption_regeneration",
        reason: "Charged for caption regeneration",
      });

      return newCaption;
    } catch (error) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: task.userId,
        taskId: args.taskId,
        skuKey: "text.caption_regeneration",
        reason: error instanceof Error ? error.message : "Caption regeneration failed",
      });
      throw error;
    }
  },
});

export const renameTaskTitle = mutation({
  args: {
    taskId: v.id("agentTasks"),
    label: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.userId !== userId) throw new Error("Unauthorized");

    const normalizedLabel = args.label.trim().slice(0, 120);
    if (!normalizedLabel) throw new Error("Label cannot be empty");

    await ctx.db.patch(args.taskId, {
      label: normalizedLabel,
      updatedAt: Date.now(),
    });
  },
});

// ─── completeTask / failTask (internalMutations) ──────────────────────────────
// Called by the fal.ai webhook HTTP handler in http.ts.

export const completeTask = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    output: v.any(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    await ctx.db.patch(args.taskId, {
      status: "completed",
      output: args.output,
      updatedAt: Date.now(),
    });

    if (!task) return;
    await finalizeTaskBilling(ctx, {
      ...task,
      status: "completed",
      output: args.output,
      _id: args.taskId,
    });

    // Auto-chain: script_generator → spawn video/image tasks (idempotent)
    if (task.agentType === "script_generator" && task.campaignId) {
      await ctx.scheduler.runAfter(0, internal.agentTasks.spawnVideoTasksFromScript, {
        scriptTaskId: args.taskId,
        campaignId: task.campaignId,
      });
    }

    // Auto-chain: image_generator with _chainToVideo → spawn video_generator (idempotent)
    if (task.agentType === "image_generator" && task.input?._chainToVideo && task.campaignId && args.output?.imageUrl) {
      const existingVideo = await ctx.db.query("agentTasks")
        .withIndex("by_campaignId", (q) => q.eq("campaignId", task.campaignId!))
        .collect();
      const hasVideoForAngle = existingVideo.some(t =>
        t.agentType === "video_generator" &&
        t.angleId === task.angleId &&
        (t.status === "pending" || t.status === "running" || t.status === "completed")
      );
      if (!hasVideoForAngle) {
      await ctx.runMutation(internal.agentTasks.submitTaskInternal, {
        brandId: task.brandId,
        userId: task.userId,
        agentType: "video_generator",
        label: task.label?.replace("Hero image: ", "") || "Product Ad",
        input: {
          prompt: `Smooth cinematic camera movement around the product. Subtle motion - slow orbit, gentle zoom, or light particles. The product stays centered and sharp. ${task.input._videoPrompt || ''}`,
          brandName: "",
          videoStyle: "Product Showcase",
          duration: task.input._videoDuration || "10",
          aspectRatio: "9:16",
          generateAudio: false,
          assetReferences: [{ type: "product", id: "product", name: "product", imageUrl: args.output.imageUrl }],
        },
        initiatedFrom: "campaigns",
        campaignId: task.campaignId,
        angleId: task.angleId || undefined,
      });
      }
    }

    // Auto-transition campaign status. Route through the centralized
    // per-angle check so caption_generator + media failures both reduce the
    // campaign to "partial" instead of slipping through as "ready".
    if (task.campaignId) {
      await maybeMarkCampaignReady(ctx, task.campaignId);
    }

    // Schedule R2 persistence for any task with media URLs (non-blocking)
    if (args.output?.videoUrl || args.output?.imageUrl) {
      await ctx.scheduler.runAfter(0, internal.agentTasks.persistAssetToR2, {
        taskId: args.taskId,
      });
    }
  },
});

// ─── patchTaskOutput ─────────────────────────────────────────────────────────
// Updates task output ONLY - no auto-chain evaluation. Used by R2 persistence
// to safely swap URLs without re-triggering child task spawning.

export const patchTaskOutput = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    output: v.any(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      output: args.output,
      updatedAt: Date.now(),
    });
  },
});

// ─── persistAssetToR2 ───────────────────────────────────────────────────────
// Downloads generated assets (video/image) from fal.ai and uploads to R2.
// Retries up to 3 times with exponential backoff. Never overwrites the
// original URL until R2 upload is confirmed successful.

export const persistAssetToR2 = internalAction({
  args: {
    taskId: v.id("agentTasks"),
    attempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const MAX_RETRIES = 3;
    const attempt = args.attempt ?? 1;

    const task = await ctx.runQuery(internal.agentTasks.getTaskInternal, { taskId: args.taskId });
    if (!task?.output) return;

    // Already persisted or no URLs to migrate
    if (task.output._r2Status === "persisted") return;

    const R2_PUBLIC_BASE = "https://pub-1f5cd68cca10472e9224eff87e49d3fb.r2.dev";
    const urlFields = ["videoUrl", "imageUrl", "thumbnailUrl"] as const;
    const toMigrate = urlFields.filter(
      (f) => task.output[f] && !task.output[f].includes("r2.dev")
    );

    if (toMigrate.length === 0) {
      // URLs already on R2 or no URLs - mark as persisted
      await ctx.runMutation(internal.agentTasks.patchTaskOutput, {
        taskId: args.taskId,
        output: { ...task.output, _r2Status: "persisted" },
      });
      return;
    }

    try {
      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");

      const accountId = process.env.CF_ACCOUNT_ID;
      const bucketName = process.env.CF_R2_BUCKET;
      const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;

      if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
        console.error("[R2] Missing R2 env vars - skipping persistence");
        return;
      }

      const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED" as any,
      });

      // Map field names to semantic asset folders
      const ASSET_FOLDERS: Record<string, string> = {
        videoUrl: "videos",
        imageUrl: "images",
        thumbnailUrl: "thumbnails",
      };

      // Detect extension from Content-Type header, with sensible fallbacks
      const EXT_FROM_MIME: Record<string, string> = {
        "video/mp4": "mp4",
        "video/webm": "webm",
        "video/quicktime": "mov",
        "image/webp": "webp",
        "image/png": "png",
        "image/jpeg": "jpg",
        "image/gif": "gif",
      };
      const FALLBACK_EXT: Record<string, string> = {
        videoUrl: "mp4",
        imageUrl: "webp",
        thumbnailUrl: "webp",
      };

      const updatedOutput = { ...task.output };

      for (const field of toMigrate) {
        const sourceUrl = task.output[field];

        // Download from fal.ai
        const res = await fetch(sourceUrl);
        if (!res.ok) throw new Error(`Download ${field} failed: ${res.status} ${res.statusText}`);

        // Detect content type and extension from response
        const responseMime = res.headers.get("content-type")?.split(";")[0]?.trim() || "";
        const ext = EXT_FROM_MIME[responseMime] || FALLBACK_EXT[field] || "bin";
        const contentType = responseMime || (field === "videoUrl" ? "video/mp4" : "image/webp");

        const folder = ASSET_FOLDERS[field] || "misc";
        const key = `brands/${task.brandId}/assets/${folder}/${task._id}.${ext}`;

        // Stream directly to R2 when Content-Length is available (avoids buffering 20-40MB videos in RAM).
        // Falls back to buffer for responses without Content-Length (small images, thumbnails).
        const contentLengthHeader = res.headers.get("content-length");

        if (res.body && contentLengthHeader) {
          await s3.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: key,
              Body: res.body as any,
              ContentType: contentType,
              ContentLength: parseInt(contentLengthHeader, 10),
            })
          );
        } else {
          // Fallback: buffer in memory (only for small assets without Content-Length)
          const buffer = await res.arrayBuffer();
          await s3.send(
            new PutObjectCommand({
              Bucket: bucketName,
              Key: key,
              Body: new Uint8Array(buffer),
              ContentType: contentType,
            })
          );
        }

        // Preserve original, set R2 as primary
        updatedOutput[`_original_${field}`] = sourceUrl;
        updatedOutput[field] = `${R2_PUBLIC_BASE}/${key}`;
      }

      updatedOutput._r2Status = "persisted";

      // Use patchTaskOutput (no auto-chain) to avoid re-triggering child tasks
      await ctx.runMutation(internal.agentTasks.patchTaskOutput, {
        taskId: args.taskId,
        output: updatedOutput,
      });

      console.log(`[R2] Persisted ${toMigrate.length} asset(s) for task ${args.taskId}`);
    } catch (error) {
      console.error(`[R2] Attempt ${attempt}/${MAX_RETRIES} failed for task ${args.taskId}:`, error);

      if (attempt < MAX_RETRIES) {
        // Exponential backoff: 60s, 120s, 240s
        const backoffMs = Math.pow(2, attempt) * 30_000;
        await ctx.scheduler.runAfter(backoffMs, internal.agentTasks.persistAssetToR2, {
          taskId: args.taskId,
          attempt: attempt + 1,
        });
        console.log(`[R2] Retry ${attempt + 1} scheduled in ${backoffMs / 1000}s`);
      } else {
        // All retries exhausted - mark failed but DO NOT touch URLs
        const latest = await ctx.runQuery(internal.agentTasks.getTaskInternal, { taskId: args.taskId });
        if (latest?.output && latest.output._r2Status !== "persisted") {
          await ctx.runMutation(internal.agentTasks.patchTaskOutput, {
            taskId: args.taskId,
            output: { ...latest.output, _r2Status: "failed" },
          });
        }
        console.error(`[R2] All ${MAX_RETRIES} retries exhausted for task ${args.taskId} - fal.ai URL preserved`);
      }
    }
  },
});

/**
 * Generic R2 copy helper. Downloads a URL and uploads to R2 under the given key.
 * Returns the public R2 URL on success, or the original URL on failure.
 * Use this for any external URL that should be persisted long-term
 * (template covers, etc.) - agent task outputs use persistAssetToR2 instead.
 */
export const copyUrlToR2 = internalAction({
  args: {
    sourceUrl: v.string(),
    key: v.string(), // e.g., "brands/{brandId}/assets/covers/{templateId}.webp"
  },
  handler: async (ctx, args): Promise<{ r2Url: string | null; error?: string }> => {
    const R2_PUBLIC_BASE = "https://pub-1f5cd68cca10472e9224eff87e49d3fb.r2.dev";

    // If already on R2, nothing to do
    if (args.sourceUrl.includes("r2.dev")) return { r2Url: args.sourceUrl };

    try {
      const accountId = process.env.CF_ACCOUNT_ID;
      const bucketName = process.env.CF_R2_BUCKET;
      const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
      if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
        return { r2Url: null, error: "Missing R2 env vars" };
      }

      const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
      const s3 = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
        requestChecksumCalculation: "WHEN_REQUIRED" as any,
      });

      const res = await fetch(args.sourceUrl);
      if (!res.ok) return { r2Url: null, error: `Download failed: ${res.status}` };

      const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/webp";
      const contentLength = res.headers.get("content-length");

      if (res.body && contentLength) {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: args.key,
            Body: res.body as any,
            ContentType: contentType,
            ContentLength: parseInt(contentLength, 10),
          })
        );
      } else {
        const buffer = await res.arrayBuffer();
        await s3.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: args.key,
            Body: new Uint8Array(buffer),
            ContentType: contentType,
          })
        );
      }

      return { r2Url: `${R2_PUBLIC_BASE}/${args.key}` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`[copyUrlToR2] ERROR:`, msg);
      return { r2Url: null, error: msg };
    }
  },
});

// Returns every asset URL referenced anywhere in agentTasks - both outputs and
// input.assetReferences. Used by the orphan reaper to know which R2 objects
// are still in use before deleting anything.
export const listAllReferencedAssetUrls = internalQuery({
  args: {},
  handler: async (ctx) => {
    const tasks = await ctx.db.query("agentTasks").collect();
    const urls = new Set<string>();
    for (const t of tasks) {
      const out = t.output as any;
      if (out?.imageUrl) urls.add(out.imageUrl);
      if (out?.videoUrl) urls.add(out.videoUrl);
      if (out?.thumbnailUrl) urls.add(out.thumbnailUrl);
      const input = t.input as any;
      if (Array.isArray(input?.assetReferences)) {
        for (const ref of input.assetReferences) {
          if (ref?.imageUrl) urls.add(ref.imageUrl);
        }
      }
      if (input?.resolvedStartImageUrl) urls.add(input.resolvedStartImageUrl);
      if (input?.startImageUrl) urls.add(input.startImageUrl);
      if (input?.sourceUrl) urls.add(input.sourceUrl);
    }
    return Array.from(urls);
  },
});

// Weekly orphan reaper. Walks R2 objects under `brands/*/references/`, and
// deletes any object older than 30 days whose public URL is not referenced by
// any agentTasks row. Safe to re-run - non-destructive to in-use uploads.
export const cronReapOrphanUploadReferences = internalAction({
  args: {},
  handler: async (ctx) => {
    const GRACE_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - GRACE_MS;
    const R2_PUBLIC_BASE = "https://pub-1f5cd68cca10472e9224eff87e49d3fb.r2.dev";

    const accountId = process.env.CF_ACCOUNT_ID;
    const bucketName = process.env.CF_R2_BUCKET;
    const accessKeyId = process.env.CF_R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.CF_R2_SECRET_ACCESS_KEY;
    if (!accountId || !bucketName || !accessKeyId || !secretAccessKey) {
      console.error("[cronReapOrphanUploadReferences] Missing R2 env vars");
      return;
    }

    const referencedUrls: string[] = await ctx.runQuery(
      internal.agentTasks.listAllReferencedAssetUrls,
      {},
    );
    const referenced = new Set(referencedUrls);

    const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED" as any,
    });

    let deleted = 0;
    let inspected = 0;
    let continuationToken: string | undefined;

    do {
      const resp: any = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: "brands/",
          ContinuationToken: continuationToken,
        }),
      );
      const objects = resp.Contents ?? [];
      for (const obj of objects) {
        if (!obj.Key || !obj.Key.includes("/references/")) continue;
        inspected++;
        const lastModifiedMs = obj.LastModified ? new Date(obj.LastModified).getTime() : Date.now();
        if (lastModifiedMs > cutoff) continue; // too young to reap
        const publicUrl = `${R2_PUBLIC_BASE}/${obj.Key}`;
        if (referenced.has(publicUrl)) continue; // still in use
        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: obj.Key }));
          deleted++;
        } catch (err) {
          console.warn(`[cronReapOrphanUploadReferences] Failed to delete ${obj.Key}:`, err);
        }
      }
      continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (continuationToken);

    console.log(`[cronReapOrphanUploadReferences] inspected ${inspected} reference uploads, deleted ${deleted} orphans`);
  },
});

export const failTask = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    error: v.string(),
    errorKind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    const kind = args.errorKind ?? classifyError({ message: args.error });
    await ctx.db.patch(args.taskId, {
      status: "failed",
      error: args.error,
      errorKind: kind,
      updatedAt: Date.now(),
    });
    if (task) {
      await releaseTaskBilling(ctx, {
        ...task,
        status: "failed",
        error: args.error,
        errorKind: kind,
        _id: args.taskId,
      }, args.error);
    }

    // Recompute campaign status with the tri-state contract — failed tasks
    // here may flip the campaign to "partial" (some failures) or "failed"
    // (every task failed) instead of incorrectly marking "ready".
    if (task?.campaignId) {
      await maybeMarkCampaignReady(ctx, task.campaignId);
    }
  },
});

// ─── triggerR2Persistence ────────────────────────────────────────────────────
// Manually trigger R2 persistence for a single task. Call from Convex dashboard
// to test: `triggerR2Persistence({ taskId: "..." })`

export const triggerR2Persistence = mutation({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("task not found");
    if (task.output?._r2Status === "persisted") return { status: "already_persisted" };

    await ctx.scheduler.runAfter(0, internal.agentTasks.persistAssetToR2, {
      taskId: args.taskId,
    });

    return { status: "scheduled", taskId: args.taskId };
  },
});

// ─── migrateExistingAssetsToR2 ──────────────────────────────────────────────
// One-time backfill: finds all completed tasks with fal.ai URLs (not yet on R2)
// and schedules persistAssetToR2 for each. Staggers by 2s to avoid hammering.

export const migrateExistingAssetsToR2 = internalAction({
  args: {},
  handler: async (ctx) => {
    let queued = 0;
    let skipped = 0;
    let cursor: string | null = null;
    const PAGE_SIZE = 100;

    while (true) {
      const result: any = await ctx.runQuery(internal.agentTasks.listCompletedTasksForMigration, {
        cursor: cursor ?? undefined,
        limit: PAGE_SIZE,
      });

      for (const task of result.tasks) {
        const output = task.output;
        if (!output) { skipped++; continue; }
        if (output._r2Status === "persisted") { skipped++; continue; }

        const hasExternalUrl =
          (output.videoUrl && !output.videoUrl.includes("r2.dev")) ||
          (output.imageUrl && !output.imageUrl.includes("r2.dev"));

        if (!hasExternalUrl) { skipped++; continue; }

        // Stagger: 2s apart to avoid overwhelming R2/fal.ai
        await ctx.scheduler.runAfter(queued * 2000, internal.agentTasks.persistAssetToR2, {
          taskId: task._id,
        });
        queued++;
      }

      if (!result.hasMore) break;
      cursor = result.cursor;
    }

    console.log(`[R2 Migration] Queued ${queued} tasks, skipped ${skipped}`);
    return { queued, skipped };
  },
});

// Helper query for migration - returns completed tasks in pages
export const listCompletedTasksForMigration = internalQuery({
  args: {
    cursor: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const results = await ctx.db
      .query("agentTasks")
      .filter((q) => q.eq(q.field("status"), "completed"))
      .collect();

    // Manual cursor-based pagination
    const startIdx = args.cursor ? results.findIndex(t => t._id === args.cursor) + 1 : 0;
    const page = results.slice(startIdx, startIdx + args.limit);
    const hasMore = startIdx + args.limit < results.length;
    const nextCursor = page.length > 0 ? page[page.length - 1]._id : null;

    return {
      tasks: page,
      hasMore,
      cursor: nextCursor,
    };
  },
});

// admin schema
export const getAllTasks = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    return await ctx.db.query("agentTasks").order("desc").collect();
  },
});
