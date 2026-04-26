import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { runCharacterDesigner, buildCharacterPrompt } from "./specializedAgents/characterDesigner";
import type { CharacterDesignerInput, CharacterDesignerOutput } from "./specializedAgents/types";
import { AGENT_REGISTRY } from "./specializedAgents/types";

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
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Validate agentType is in the registry
    if (!(args.agentType in AGENT_REGISTRY)) {
      throw new Error(`Unknown agent type: ${args.agentType}`);
    }

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
      createdAt: now,
      updatedAt: now,
    });

    // Schedule the background action immediately (0ms delay)
    await ctx.scheduler.runAfter(0, internal.agentTasks.runSpecializedAgent, {
      taskId,
    });

    return taskId;
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

// ─── runSpecializedAgent (internalAction) ──────────────────────────────────────
// Scheduled by submitTask. Calls the pure agent function.
// Uses webhook mode (primary) — fal.ai posts result back to /api/fal-webhook.
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
    const webhookUrl = siteUrl ? `${siteUrl}/api/fal-webhook` : undefined;

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
          // Webhook mode — store the fal.ai requestId and wait for webhook
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            falRequestId: result.requestId,
          });
          console.log(`[runSpecializedAgent] fal.ai job queued. requestId: ${result.requestId}`);
        } else {
          // Polling mode — result is already here
          await ctx.runMutation(internal.agentTasks.patchTask, {
            taskId: args.taskId,
            status: "completed",
            output: result,
          });
          console.log(`[runSpecializedAgent] Task completed (polling mode): ${args.taskId}`);
        }
      } else {
        await ctx.runMutation(internal.agentTasks.patchTask, {
          taskId: args.taskId,
          status: "failed",
          error: `Agent type "${task.agentType}" is not yet implemented.`,
        });
      }
    } catch (error: any) {
      console.error(`[runSpecializedAgent] Error:`, error);
      await ctx.runMutation(internal.agentTasks.patchTask, {
        taskId: args.taskId,
        status: "failed",
        error: error?.message || "Unknown error from fal.ai",
      });
    }
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
    falRequestId: v.optional(v.string()),
    input: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, any> = { updatedAt: Date.now() };
    if (args.status !== undefined) patch.status = args.status;
    if (args.output !== undefined) patch.output = args.output;
    if (args.error !== undefined) patch.error = args.error;
    if (args.falRequestId !== undefined) patch.falRequestId = args.falRequestId;
    if (args.input !== undefined) patch.input = args.input;
    await ctx.db.patch(args.taskId, patch);
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
    await ctx.db.patch(args.taskId, {
      status: "completed",
      output: args.output,
      updatedAt: Date.now(),
    });
  },
});

export const failTask = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: "failed",
      error: args.error,
      updatedAt: Date.now(),
    });
  },
});
