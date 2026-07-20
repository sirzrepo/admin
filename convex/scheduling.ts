import { action } from "./_generated/server";
import { v } from "convex/values";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

const MODEL = "openai/gpt-4o-mini";

export const batchSuggestPostingTimes = action({
  args: {
    slots: v.array(v.object({
      contentType: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const billing = await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
      userId: String(userId),
      featureKey: "helper_ai",
      skuKey: "text.scheduling_suggestions",
      units: 1,
      metadata: { source: "batch_scheduling_suggestions", slotCount: args.slots.length },
    });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.scheduling_suggestions",
        reason: "OPENROUTER_API_KEY not configured",
      });
      throw new Error("OPENROUTER_API_KEY not configured");
    }

    try {
      const openrouter = createOpenRouter({ apiKey });

    const count = args.slots.length;
    if (count === 0) return [];

    const now = new Date();
    const maxDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const currentDay = now.toLocaleDateString("en-US", { weekday: "long" });
    const currentHour = now.getUTCHours();

    // Compute target dates in code so the AI only picks time-of-day, not the day itself.
    // Interval: evenly distribute across ~5 days (not the full 7-day max).
    // Start today if before 6pm UTC, otherwise tomorrow.
    const intervalDays = Math.max(1, Math.floor(5 / count));
    const startOffset = currentHour < 18 ? 0 : 1;
    const targetDates = Array.from({ length: count }, (_, i) => {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() + startOffset + i * intervalDays);
      return d.toISOString().split("T")[0];
    });

    const slotList = args.slots
      .map((s, i) => `Post ${i + 1} (${targetDates[i]}): ${s.contentType ?? "UGC video ad"}`)
      .join("\n");

    const result = await generateObject({
      model: openrouter(MODEL),
      schema: z.object({
        suggestions: z.array(
          z.object({
            suggestedAt: z.string().describe("ISO 8601 UTC datetime string"),
            reason: z.string().describe("One concise sentence explaining why this time-of-day window performs well"),
          }),
        ),
      }),
      system: `You are a senior social media strategist with deep knowledge of TikTok algorithm behavior and audience engagement patterns.
You schedule content for maximum reach based on platform data and creator benchmarks.`,
      prompt: `Pick the best time-of-day for each TikTok post below. The dates are already fixed - do not change them.

Current time: ${now.toISOString()} UTC (${currentDay})
Platform: TikTok

Posts (date is fixed, pick the time):
${slotList}

For each post, choose the single best UTC time on that exact date from these TikTok peak windows:
- Morning commute: 07:00–09:00 UTC
- Lunch: 12:00–14:00 UTC
- Evening: 19:00–21:00 UTC

Base the choice on the content type and day of week. Return exactly ${count} suggestion${count > 1 ? "s" : ""}, in order.

Return the array.`,
    });

    const suggestions = result.object.suggestions.slice(0, count);
    const minTime = Date.now() + 5 * 60 * 1000;
    const maxTime = maxDate.getTime();

    const mapped = suggestions.map((s) => {
      const ms = new Date(s.suggestedAt).getTime();
      if (isNaN(ms)) throw new Error("Model returned an invalid date");
      return {
        suggestedAt: Math.min(maxTime, Math.max(minTime, ms)),
        reason: s.reason,
      };
    });
      await ctx.runMutation(internal.billing.chargeReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.scheduling_suggestions",
        reason: "Charged for scheduling suggestions",
      });
      return mapped;
    } catch (error) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.scheduling_suggestions",
        reason: error instanceof Error ? error.message : "Scheduling suggestions failed",
      });
      throw error;
    }
  },
});
