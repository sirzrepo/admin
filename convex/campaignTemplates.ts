import { mutation, query, action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireAdmin } from "./adminAuth";
import { internal } from "./_generated/api";
import { getUpcomingEvents } from "./data/holidayCalendar";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { z } from "zod";
import { getCurrentTeamMember } from "./helpers";
import { DEFAULT_BILLING_SETTINGS, DEFAULT_PLANS } from "./billingConfig";

// ─── AI Model Setup ─────────────────────────────────────────────────────────
// Env vars aren't available at module scope in Convex actions, so wrap in a fn.

const getModel = () => {
  const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY });
  return openrouter("openai/gpt-4o-mini");
};

// ─── Zod Schemas ─────────────────────────────────────────────────────────────

// Three-way goal classification that shapes asset generation downstream.
// Drives scene direction (urgency vs storytelling) and the social caption.
const campaignGoalSchema = z.enum(["awareness", "conversion", "retention"]);

const templateOutputSchema = z.object({
  templates: z.array(z.object({
    name: z.string(),
    description: z.string(),
    hooks: z.array(z.string()),
    angles: z.array(z.object({
      id: z.string(),
      name: z.string(),
      hook: z.string(),
      scriptOutline: z.string(),
    })),
    recommendedVideoStyle: z.enum(["UGC Ad", "Product Showcase", "mixed"]),
    suggestedAmbassadorCategory: z.string().nullable(),
    suggestedGoal: campaignGoalSchema,
  })),
});

const seasonalTemplateSchema = z.object({
  name: z.string(),
  description: z.string(),
  hooks: z.array(z.string()),
  angles: z.array(z.object({
    id: z.string(),
    name: z.string(),
    hook: z.string(),
    scriptOutline: z.string(),
  })),
  recommendedVideoStyle: z.enum(["UGC Ad", "Product Showcase", "mixed"]),
  suggestedGoal: campaignGoalSchema,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a Shopify product's priceRange into a display-ready price string.
 * Returns undefined when there's no price data so optional fields stay
 * optional all the way to the wire.
 */
function formatShopifyPrice(
  priceRange: { minPrice?: string; currencyCode?: string } | undefined,
): string | undefined {
  if (!priceRange?.minPrice) return undefined;
  const cc = priceRange.currencyCode;
  const symbol =
    cc === "USD" ? "$" :
    cc === "EUR" ? "€" :
    cc === "GBP" ? "£" :
    cc ? `${cc} ` : "";
  return `${symbol}${priceRange.minPrice}`;
}

function mapVideoStyleToTypes(style: string): string[] {
  if (style === "UGC Ad") return ["AI UGC Ads"];
  if (style === "Product Showcase") return ["Product Ads"];
  return ["Product Ads", "AI UGC Ads"];
}

type TemplateEntitlement = {
  enabled: boolean;
  accessStatus: string;
  planKey: string | null;
  templateLimit: number;
  refreshEnabled: boolean;
  refreshDays: number;
  aiCoversEnabled: boolean;
};

function subscriptionAccessStatus(subscription: any): string {
  if (!subscription) return "no_plan";
  if (subscription.status === "trialing" && subscription.trialEndsAt && subscription.trialEndsAt <= Date.now()) {
    return "trial_expired";
  }
  if (["trialing", "active", "internal", "past_due", "canceled", "unpaid", "paused"].includes(subscription.status)) {
    return subscription.status;
  }
  return "no_plan";
}

async function getTemplateEntitlementForUser(ctx: any, userId: string): Promise<TemplateEntitlement> {
  let user: any = null;
  try {
    user = await ctx.db.get(userId as any);
  } catch {
    user = null;
  }

  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
  const subscription = subscriptions.sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0] ?? null;
  const status = user?.role === "admin" ? "internal" : subscriptionAccessStatus(subscription);

  if (status === "trialing") {
    const dbSettings = await ctx.db
      .query("billingSettings")
      .withIndex("by_key", (q: any) => q.eq("key", "global"))
      .first();
    const settings = dbSettings?.isActive
      ? { ...DEFAULT_BILLING_SETTINGS, ...dbSettings }
      : DEFAULT_BILLING_SETTINGS;
    const templateLimit = Math.max(0, Number(settings.trialTemplateLimit ?? 0));
    const refreshDays = Math.max(0, Number(settings.trialTemplateRefreshDays ?? 0));
    return {
      enabled: templateLimit > 0,
      accessStatus: status,
      planKey: subscription?.planKey ?? "trial",
      templateLimit,
      refreshEnabled: !!settings.trialTemplateRefreshEnabled && refreshDays > 0,
      refreshDays,
      aiCoversEnabled: !!settings.trialTemplateAiCovers,
    };
  }

  if (status === "active" || status === "internal") {
    const planKey = status === "internal" ? "internal" : subscription?.planKey;
    const dbPlan = planKey
      ? await ctx.db.query("billingPlans").withIndex("by_key", (q: any) => q.eq("key", planKey)).first()
      : null;
    const fallbackPlan = DEFAULT_PLANS.find((plan) => plan.key === planKey);
    const plan = dbPlan?.isActive ? dbPlan : fallbackPlan;
    const features = { ...(fallbackPlan?.features ?? {}), ...(plan?.features ?? {}) };
    const limits = { ...(fallbackPlan?.limits ?? {}), ...(plan?.limits ?? {}) };
    const templateLimit = Math.max(0, Number(limits.templateLimit ?? 0));
    const refreshDays = Math.max(0, Number(limits.templateRefreshDays ?? 0));
    return {
      enabled: templateLimit > 0,
      accessStatus: status,
      planKey: plan?.key ?? null,
      templateLimit,
      refreshEnabled: !!features.templateRefreshEnabled && refreshDays > 0,
      refreshDays,
      aiCoversEnabled: !!features.templateAiCovers,
    };
  }

  return {
    enabled: false,
    accessStatus: status,
    planKey: subscription?.planKey ?? null,
    templateLimit: 0,
    refreshEnabled: false,
    refreshDays: 0,
    aiCoversEnabled: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Public Queries & Mutations (unchanged)
// ═══════════════════════════════════════════════════════════════════════════════

export const listTemplates = query({
  args: {
    category: v.optional(v.string()),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    let q = ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true));

    const templates = await q.collect();

    let filtered = templates;

    if (args.category) {
      filtered = filtered.filter((t) => t.category === args.category);
    }

    if (args.industry) {
      filtered = filtered.filter((t) => t.industries.includes(args.industry!));
    }

    return filtered.sort((a, b) => b.usageCount - a.usageCount);
  },
});

export const getRecommendedTemplates = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    const allTemplates = await ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();

    const now = Date.now();
    const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;

    const recommended = allTemplates.filter((template) => {
      const matchesIndustry = brand.industry
        ? template.industries.includes(brand.industry)
        : false;

      const matchesSeason = template.seasonalTrigger
        ? template.seasonalTrigger.activeFrom <= thirtyDaysFromNow &&
          template.seasonalTrigger.activeTo >= now
        : false;

      return matchesIndustry || matchesSeason;
    });

    return recommended
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 10);
  },
});

export const createTemplate = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.string(),
    industries: v.array(v.string()),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    suggestedTypes: v.array(v.string()),
    suggestedAngles: v.array(v.string()),
    suggestedAmbassadorCategory: v.optional(v.string()),
    suggestedGoal: v.optional(v.string()),
    sampleHooks: v.optional(v.array(v.string())),
    source: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const templateId = await ctx.db.insert("campaignTemplates", {
      ...args,
      usageCount: 0,
      isActive: true,
      createdAt: Date.now(),
    });

    return templateId;
  },
});

export const incrementUsage = mutation({
  args: { templateId: v.id("campaignTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("template not found");

    await ctx.db.patch(args.templateId, {
      usageCount: template.usageCount + 1,
    });

    return args.templateId;
  },
});

export const adminUpdateTemplate = mutation({
  args: {
    templateId: v.id("campaignTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    industries: v.optional(v.array(v.string())),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    suggestedTypes: v.optional(v.array(v.string())),
    suggestedAngles: v.optional(v.array(v.string())),
    suggestedAmbassadorCategory: v.optional(v.string()),
    suggestedGoal: v.optional(v.string()),
    sampleHooks: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const { templateId, ...updates } = args;
    const patch = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(templateId, patch);
    return templateId;
  },
});

export const adminToggleTemplate = mutation({
  args: { templateId: v.id("campaignTemplates") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("template not found");

    await ctx.db.patch(args.templateId, { isActive: !template.isActive });
    return args.templateId;
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Industry Trends (Vercel AI SDK)
// ═══════════════════════════════════════════════════════════════════════════════

export const getIndustryTrends = action({
  args: { industry: v.string() },
  handler: async (ctx, args): Promise<{ templates: unknown[] }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const billing = await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
      userId: String(userId),
      featureKey: "campaign_generation",
      skuKey: "text.campaign_angle_batch",
      units: 1,
      metadata: { source: "industry_trends", industry: args.industry },
    });
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.campaign_angle_batch",
        reason: "OPENROUTER_API_KEY not configured",
      });
      throw new Error("OPENROUTER_API_KEY not configured");
    }

    try {
      const model = getModel();

    const result = await generateObject({
      model,
      schema: z.object({
        templates: z.array(z.object({
          name: z.string(),
          description: z.string(),
          hooks: z.array(z.string()),
        })),
      }),
      system: `You are a performance marketing creative director who specializes in short-form video ads for ${args.industry} brands on TikTok and Instagram Reels. You track what's working right now in paid social - not theoretical marketing trends, but actual ad formats and creative approaches that are driving engagement and conversions.`,
      prompt: `Identify the top 5 video ad concepts that are performing well for ${args.industry} brands right now. Not generic marketing trends - specific, actionable campaign concepts that a brand could launch this week.

For each, provide:
- A campaign template name (specific to ${args.industry}, not generic like "Summer Sale")
- A one-sentence description of the concept and why it works
- 2-3 scroll-stopping hook lines (mix of spoken-to-camera hooks AND visual-first hooks)

Focus on concepts proven to work as 15-30 second vertical video ads. Think about what makes someone stop scrolling and watch.`,
    });

      await ctx.runMutation(internal.billing.chargeReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.campaign_angle_batch",
        reason: "Charged for industry trend generation",
      });
      return { templates: result.object.templates };
    } catch (error) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.campaign_angle_batch",
        reason: error instanceof Error ? error.message : "Industry trend generation failed",
      });
      throw error;
    }
  },
});

export const extractTrendingTemplates = mutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    const completedCampaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_brandId_status", (q) =>
        q.eq("brandId", args.brandId).eq("status", "completed")
      )
      .collect();

    if (completedCampaigns.length === 0) {
      return { extracted: 0, message: "No completed campaigns to analyze" };
    }

    const anglePatterns = new Map<string, number>();

    for (const campaign of completedCampaigns) {
      if (campaign.shareAsTemplate && campaign.selectedAngles) {
        for (const angle of campaign.selectedAngles) {
          const angleId = typeof angle === "string" ? angle : angle.id;
          anglePatterns.set(angleId, (anglePatterns.get(angleId) || 0) + 1);
        }
      }
    }

    const trendingAngles = Array.from(anglePatterns.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    let extracted = 0;
    for (const [angle, count] of trendingAngles) {
      await ctx.db.insert("campaignTemplates", {
        name: `Trending: ${angle.replace(/-/g, ' ')}`,
        description: `Popular template from your successful campaigns`,
        category: "trending",
        industries: brand.industry ? [brand.industry] : [],
        suggestedTypes: ["Product Ads", "AI UGC Ads"],
        suggestedAngles: [angle],
        usageCount: count,
        source: "user_derived",
        isActive: true,
        createdAt: Date.now(),
      });
      extracted++;
    }

    return { extracted, message: `Extracted ${extracted} trending templates` };
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Internal Mutations
// ═══════════════════════════════════════════════════════════════════════════════

// ─── insertTemplateInternal ───────────────────────────────────────────────────
// Used by cron actions and first-run trigger to insert templates without auth.

export const insertTemplateInternal = internalMutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.string(),
    industries: v.array(v.string()),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    suggestedTypes: v.array(v.string()),
    suggestedAngles: v.array(v.string()),
    suggestedAmbassadorCategory: v.optional(v.string()),
    suggestedGoal: v.optional(v.string()),
    sampleHooks: v.optional(v.array(v.string())),
    usageCount: v.number(),
    source: v.string(),
    isActive: v.boolean(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("campaignTemplates", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ─── deactivateTemplate ───────────────────────────────────────────────────────

export const deactivateTemplate = internalMutation({
  args: { templateId: v.id("campaignTemplates") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, { isActive: false });
  },
});

// ─── deactivateExpiredTemplates ───────────────────────────────────────────────
// Sweeps all active templates and deactivates those past their expiresAt.
// Also deactivates brand templates whose base template is now inactive (orphans).

export const deactivateExpiredTemplates = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let deactivatedBase = 0;
    let deactivatedBrand = 0;

    // Sweep base templates
    const activeBase = await ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    for (const t of activeBase) {
      if (t.expiresAt && t.expiresAt < now) {
        await ctx.db.patch(t._id, { isActive: false });
        deactivatedBase++;
      }
    }

    // Sweep orphaned brand templates (base no longer active)
    if (deactivatedBase > 0) {
      const activeBrand = await ctx.db
        .query("brandCampaignTemplates")
        .filter((q) => q.eq(q.field("isActive"), true))
        .collect();
      for (const bt of activeBrand) {
        const base = await ctx.db.get(bt.baseTemplateId);
        if (!base || !base.isActive) {
          await ctx.db.patch(bt._id, { isActive: false });
          deactivatedBrand++;
        }
      }
    }

    if (deactivatedBase > 0 || deactivatedBrand > 0) {
      console.log(`[deactivateExpiredTemplates] Deactivated ${deactivatedBase} base + ${deactivatedBrand} brand templates`);
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Internal Queries (dedup, stale-check, industry listing)
// ═══════════════════════════════════════════════════════════════════════════════

export const countActiveTemplatesForIndustry = internalQuery({
  args: { industry: v.string() },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    return templates.filter(
      (t) => t.industries.includes(args.industry) && t.category === "industry"
    ).length;
  },
});

export const getSeasonalTemplateForEvent = internalQuery({
  args: { eventName: v.string(), industry: v.string() },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    return (
      templates.find(
        (t) =>
          t.category === "seasonal" &&
          t.seasonalTrigger?.name === args.eventName &&
          t.industries.includes(args.industry)
      ) ?? null
    );
  },
});

export const getStaleIndustryTemplates = internalQuery({
  args: { industry: v.string(), olderThanDays: v.number() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanDays * 24 * 60 * 60 * 1000;
    const templates = await ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    return templates.filter(
      (t) =>
        t.category === "industry" &&
        t.industries.includes(args.industry) &&
        t.createdAt < cutoff
    );
  },
});

export const listActiveBaseTemplatesForIndustry = internalQuery({
  args: { industry: v.string() },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    return templates.filter((t) => t.industries.includes(args.industry));
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// generateIndustryTrendTemplates (Vercel AI SDK + role-play prompt)
// ═══════════════════════════════════════════════════════════════════════════════

export const generateIndustryTrendTemplates = internalAction({
  args: { industry: v.string(), targetCount: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      console.warn("generateIndustryTrendTemplates: OPENROUTER_API_KEY not set, skipping");
      return 0;
    }

    const count = args.targetCount ?? 3;
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;

    try {
      const model = getModel();

      const result = await generateObject({
        model,
        schema: templateOutputSchema,
        system: `You are a performance marketing creative director who has managed $100M+ in ad spend across TikTok and Instagram. You specialize in ${args.industry} brands. You create short-form video ad concepts that stop the scroll and drive conversions. Every concept you produce is specific enough for a video editor to storyboard immediately.`,
        prompt: `Create ${count} campaign templates for ${args.industry} brands. For each:
- A compelling campaign name (not generic -- specific to ${args.industry} trends)
- A one-sentence pitch explaining the campaign concept
- 2-3 video opening hooks a creator would speak to camera
- 2-3 specific video angle concepts, each with: a kebab-case id, a human-readable name, an opening hook line, and a 2-sentence script outline describing what happens in the video
- A recommended video style: "UGC Ad" for creator-facing content, "Product Showcase" for product-focused, or "mixed" for campaigns that benefit from both
- An optional ambassador category hint (e.g. "beauty", "tech", "fitness") if a human presenter would strengthen the concept
- A suggestedGoal that classifies the campaign's intent:
    * "awareness"  - storytelling-first, broad emotional appeal, no hard sell (best for brand introductions, hero product reveals)
    * "conversion" - urgency + value-prop + clear CTA (best for sales, launches, time-bound trends)
    * "retention"  - insider tone, loyalty/upgrade beats, reward language (best for re-engagement, VIP, repeat-buyer angles)
  Pick the one that best matches the concept; do not default to conversion.

Focus on concepts that work as 15-30 second vertical video ads.`,
      });

      const templates = result.object.templates.slice(0, count);
      let inserted = 0;

      for (const template of templates) {
        const angleIds = template.angles.map((a) => a.id);

        await ctx.runMutation(internal.campaignTemplates.insertTemplateInternal, {
          name: template.name,
          description: template.description,
          category: "industry",
          industries: [args.industry],
          suggestedTypes: mapVideoStyleToTypes(template.recommendedVideoStyle),
          suggestedAngles: angleIds,
          suggestedAmbassadorCategory: template.suggestedAmbassadorCategory ?? undefined,
          suggestedGoal: template.suggestedGoal,
          sampleHooks: template.hooks,
          usageCount: 0,
          source: "ai_generated",
          isActive: true,
          expiresAt,
        });
        inserted++;
      }

      await ctx.runMutation(internal.billing.recordPlatformAiUsageInternal, {
        skuKey: "template.base_pool_generation",
        featureKey: "campaign_template_base_pool",
        units: 1,
        status: "succeeded",
        metadata: {
          industry: args.industry,
          requestedCount: count,
          inserted,
        },
      });

      return inserted;
    } catch (err) {
      console.error(`generateIndustryTrendTemplates: error for ${args.industry}`, err);
      await ctx.runMutation(internal.billing.recordPlatformAiUsageInternal, {
        skuKey: "template.base_pool_generation",
        featureKey: "campaign_template_base_pool",
        units: 1,
        status: "failed",
        metadata: {
          industry: args.industry,
          requestedCount: count,
          error: err instanceof Error ? err.message : String(err),
        },
      });
      return 0;
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// generateFirstRunTemplates
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Template Pool Rules (per industry, on the base `campaignTemplates` table):
 *
 * - If there's an upcoming seasonal event that targets this industry AND the
 *   brand's country, use the seasonal pool settings.
 * - Otherwise, use the evergreen/trending pool setting.
 *
 * Brand templates are capped separately by the user's current plan/trial
 * entitlement. The base pool is shared platform inventory.
 */
const POOL_LOOKAHEAD_DAYS = 28;

type TemplatePoolSettings = {
  evergreenTarget: number;
  seasonalEvergreenTarget: number;
  seasonalEventTarget: number;
};

/**
 * Determines the target template pool composition for a brand based on
 * upcoming events that match its industry + country.
 */
function computePoolTarget(
  industry: string,
  countryCode: string | undefined,
  settings: TemplatePoolSettings,
): { seasonalEvents: ReturnType<typeof getUpcomingEvents>; target: { seasonal: number; trending: number } } {
  const seasonalEvents = getUpcomingEvents(POOL_LOOKAHEAD_DAYS, countryCode)
    .filter((e) => e.industries.includes(industry));

  const target = seasonalEvents.length > 0
    ? { seasonal: settings.seasonalEventTarget, trending: settings.seasonalEvergreenTarget }
    : { seasonal: 0, trending: settings.evergreenTarget };
  return { seasonalEvents, target };
}

export const generateFirstRunTemplates = internalAction({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    console.log(`[generateFirstRunTemplates] START brandId=${args.brandId}`);

    // Outer try/catch: any throw inside the pipeline flips the brand's
    // templatesStatus to "failed" so the frontend can offer a Retry CTA
    // instead of leaving the brand stuck at "pending" forever. We still
    // re-throw so convex's scheduled-function logs record the failure.
    try {
      const brand = await ctx.runQuery(internal.brands.getBrandByIdInternal, { brandId: args.brandId });
      if (!brand || brand.status !== "active") {
        console.warn(`[generateFirstRunTemplates] brand not found or not active -- aborting`);
        return;
      }

      const entitlement = await ctx.runQuery(internal.billing.getTemplateEntitlementInternal, {
        userId: String(brand.userId),
      });
      if (!entitlement.enabled) {
        console.log(`[generateFirstRunTemplates] no template entitlement (${entitlement.accessStatus}) - deferring AI template generation`);
        await ctx.runMutation(internal.brands.setTemplatesReady, { brandId: args.brandId });
        return;
      }

      const industry = brand.industry;
      const countryCode = brand.countryCode;
      console.log(`[generateFirstRunTemplates] brand="${brand.name}" industry="${industry ?? "none"}" country="${countryCode ?? "none"}"`);

      if (!industry) {
        console.log(`[generateFirstRunTemplates] no industry set -- skipping all generation`);
        await ctx.runMutation(internal.brands.setTemplatesReady, { brandId: args.brandId });
        return;
      }

      // ── Determine target pool composition ────────────────────────────────────
      const poolSettings = await ctx.runQuery(internal.billing.getTemplatePoolSettingsInternal, {});
      const { seasonalEvents, target } = computePoolTarget(industry, countryCode, poolSettings);
      console.log(
        `[generateFirstRunTemplates] target pool: ${target.trending} trending + ${target.seasonal} seasonal ` +
          `(upcoming events: ${seasonalEvents.map((e) => e.name).join(", ") || "none"})`,
      );

      // ── Ensure trending pool ────────────────────────────────────────────────
      const activeTrendingCount = await ensureTrendingPool(ctx, industry, target.trending);
      if (activeTrendingCount <= 0 && target.trending > 0) {
        throw new Error(`No base templates are available for ${industry}.`);
      }

      // ── Ensure seasonal pool (up to target.seasonal, one per unique upcoming event) ─
      if (target.seasonal > 0 && seasonalEvents.length > 0) {
        await ensureSeasonalPool(ctx, industry, seasonalEvents.slice(0, target.seasonal));
      }

      // ── Personalize for this brand ──────────────────────────────────────────
      console.log(`[generateFirstRunTemplates] personalizing for brand "${brand.name}"`);
      await ctx.runAction(internal.campaignTemplates.generateBrandTemplates, {
        brandId: args.brandId,
        maxTemplates: entitlement.templateLimit,
        aiCoversEnabled: entitlement.aiCoversEnabled,
      });

      await ctx.runMutation(internal.brands.setTemplatesReady, { brandId: args.brandId });
      console.log(`[generateFirstRunTemplates] COMPLETE brandId=${args.brandId}`);
    } catch (err) {
      console.error(`[generateFirstRunTemplates] FAILED brandId=${args.brandId}:`, err);
      try {
        await ctx.runMutation(internal.brands.setTemplatesFailed, { brandId: args.brandId });
      } catch (markErr) {
        // If even the status-flip mutation fails, log and continue -
        // we'd rather re-throw the original error than mask it.
        console.error(`[generateFirstRunTemplates] could not mark status=failed:`, markErr);
      }
      throw err;
    }
  },
});

/**
 * Ensures the base campaignTemplates table has exactly `targetCount` active
 * trending/industry templates for this industry. Generates new ones via AI
 * if under target; skips if at or above target.
 */
async function ensureTrendingPool(ctx: any, industry: string, targetCount: number): Promise<number> {
  if (targetCount <= 0) return 0;

  const existingCount: number = await ctx.runQuery(
    internal.campaignTemplates.countActiveTemplatesForIndustry,
    { industry }
  );

  const needed = Math.max(0, targetCount - existingCount);
  if (needed === 0) {
    console.log(`[ensureTrendingPool] industry="${industry}" already has ${existingCount} active - no generation`);
    return existingCount;
  }

  console.log(`[ensureTrendingPool] generating ${needed} trending template(s) for "${industry}"`);
  await ctx.runAction(internal.campaignTemplates.generateIndustryTrendTemplates, {
    industry,
    targetCount: needed,
  });
  return await ctx.runQuery(
    internal.campaignTemplates.countActiveTemplatesForIndustry,
    { industry },
  );
}

/**
 * Ensures each upcoming event has a corresponding seasonal template for this industry.
 * Generates new ones via AI if missing.
 */
async function ensureSeasonalPool(
  ctx: any,
  industry: string,
  events: ReturnType<typeof getUpcomingEvents>,
): Promise<void> {
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    console.warn(`[ensureSeasonalPool] No OPENROUTER_API_KEY - skipping seasonal generation`);
    return;
  }

  for (const event of events) {
    const existing = await ctx.runQuery(
      internal.campaignTemplates.getSeasonalTemplateForEvent,
      { eventName: event.name, industry }
    );

    if (existing) {
      console.log(`[ensureSeasonalPool] "${event.name}"/${industry} already exists - skipping`);
      continue;
    }

    console.log(`[ensureSeasonalPool] generating seasonal "${event.name}" for "${industry}"`);

    const activeFrom = event.startDate - POOL_LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000;
    const activeTo = event.startDate + event.duration * 24 * 60 * 60 * 1000;

    let templateName = "", templateDesc = "", hooks: string[] = [];
    let angleIds: string[] = [];
    let types: string[] = ["Product Ads", "AI UGC Ads"];
    let suggestedGoal: "awareness" | "conversion" | "retention" | undefined;

    try {
      const model = getModel();
      const result = await generateObject({
        model,
        schema: seasonalTemplateSchema,
        system: `You are a seasonal campaign strategist for ${industry} brands. You create timely, event-driven video ad concepts that feel native to the cultural moment - not forced or generic. You understand that the best seasonal campaigns connect the product to the emotion of the event, not just slap the event name on a discount.`,
        prompt: `Create a video ad campaign concept for ${event.name} targeting ${industry} consumers.

Event context: ${event.name} is a ${event.type} that lasts ${event.duration} day${event.duration !== 1 ? 's' : ''}. Think about what ${industry} consumers feel, want, and do during this time.

Generate:
- A campaign name that's specific to ${industry} + ${event.name} (not generic like "${event.name} Sale")
- A one-sentence pitch explaining the concept and the emotional angle
- 3 video hooks (mix of spoken-to-camera AND visual-first)
- 2-3 creative angles with kebab-case id, name, hook, and 2-sentence script outline
- Recommended video style: "UGC Ad", "Product Showcase", or "mixed"
- suggestedGoal: classify the campaign's intent:
    * "awareness"  - storytelling-first, broad emotional appeal (best for brand-moments / hero seasonal reveals)
    * "conversion" - urgency + clear CTA (best for sale-driven seasonal events like Black Friday)
    * "retention"  - loyalty / upgrade / VIP reward beats (best for end-of-year customer-appreciation events)
  Pick the one that best matches this event + concept; do not default to conversion.

Make it feel culturally relevant, not just transactional.`,
      });

      const data = result.object;
      templateName = data.name;
      templateDesc = data.description;
      hooks = data.hooks;
      angleIds = data.angles.map((a: any) => a.id);
      types = mapVideoStyleToTypes(data.recommendedVideoStyle);
      suggestedGoal = data.suggestedGoal;
    } catch (err) {
      console.error(`[ensureSeasonalPool] AI generation failed for "${event.name}/${industry}"`, err);
      continue;
    }

    await ctx.runMutation(internal.campaignTemplates.insertTemplateInternal, {
      name: templateName,
      description: templateDesc,
      category: "seasonal",
      industries: [industry],
      seasonalTrigger: { type: event.type, name: event.name, activeFrom, activeTo },
      suggestedTypes: types,
      suggestedAngles: angleIds,
      suggestedGoal,
      sampleHooks: hooks,
      usageCount: 0,
      source: "ai_generated",
      isActive: true,
      expiresAt: activeTo,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// cronExtractTrendingTemplates (disabled pending success metrics)
// ═══════════════════════════════════════════════════════════════════════════════

export const cronExtractTrendingTemplates = internalAction({
  args: {},
  handler: async (_ctx) => {
    // Placeholder: Will be activated when campaign success metrics are defined.
    // Currently no criteria to identify "successful" campaigns for template extraction.
    console.log("[cronExtractTrendingTemplates] Skipped -- pending success metrics definition");
    return;

    // --- Previous implementation kept for future reference ---
    // const brands = await ctx.runQuery(internal.brands.listAllActiveBrandsInternal, {});
    //
    // for (const brand of brands) {
    //   try {
    //     const completedCampaigns: Array<{
    //       selectedAngles?: string[];
    //       shareAsTemplate?: boolean;
    //     }> = await ctx.runQuery(internal.campaigns.listCompletedOptInCampaigns, {
    //       brandId: brand._id,
    //     });
    //
    //     if (completedCampaigns.length === 0) continue;
    //
    //     const anglePatterns = new Map<string, number>();
    //     for (const campaign of completedCampaigns) {
    //       if (campaign.shareAsTemplate && campaign.selectedAngles) {
    //         for (const angle of campaign.selectedAngles) {
    //           anglePatterns.set(angle, (anglePatterns.get(angle) || 0) + 1);
    //         }
    //       }
    //     }
    //
    //     const trendingAngles = Array.from(anglePatterns.entries())
    //       .filter(([, count]) => count >= 2)
    //       .sort((a, b) => b[1] - a[1])
    //       .slice(0, 5);
    //
    //     for (const [angle] of trendingAngles) {
    //       await ctx.runMutation(internal.campaignTemplates.insertTemplateInternal, {
    //         name: `Trending: ${angle.replace(/-/g, " ")}`,
    //         description: "Popular template derived from successful campaigns",
    //         category: "trending",
    //         industries: brand.industry ? [brand.industry] : [],
    //         suggestedTypes: ["Product Ads", "AI UGC Ads"],
    //         suggestedAngles: [angle],
    //         usageCount: 0,
    //         source: "user_derived",
    //         isActive: true,
    //       });
    //     }
    //   } catch (err) {
    //     console.error(`cronExtractTrendingTemplates: failed for brand ${brand._id}`, err);
    //   }
    // }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// cronResearchIndustryTrends (weekly cron)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Weekly refresh cron. Enforces the pool rules per industry:
 *
 * 1. Expire old stuff (seasonals past their end date → isActive: false,
 *    orphan brand templates → isActive: false).
 * 2. ALWAYS refresh trending - delete stale trending (> 7 days old), then
 *    regenerate to hit the target count for this industry.
 * 3. FILL seasonal gaps - for each industry with upcoming country-aware
 *    events, ensure one seasonal per event up to target.seasonal.
 * 4. Personalize for brands - for each brand whose base pool changed,
 *    run generateBrandTemplates (idempotent, locked).
 */
export const cronResearchIndustryTrends = internalAction({
  args: {},
  handler: async (ctx) => {
    // ── 1. Expire old stuff ────────────────────────────────────────────────
    await ctx.runMutation(internal.campaignTemplates.deactivateExpiredTemplates, {});
    console.log("[cron] Expired templates swept");

    const industries: string[] = await ctx.runQuery(
      internal.brands.listDistinctIndustriesInternal,
      {}
    );

    // ── Determine target pool per industry based on upcoming events ────────
    // We compute target assuming no specific country (includes all global events).
    // Brand personalization below still respects per-brand country filtering.
    const poolSettings = await ctx.runQuery(internal.billing.getTemplatePoolSettingsInternal, {});
    for (const industry of industries) {
      try {
        // Figure out if any upcoming event targets THIS industry (globally).
        const upcomingForIndustry = getUpcomingEvents(POOL_LOOKAHEAD_DAYS)
          .filter((e) => e.industries.includes(industry));

        const target = upcomingForIndustry.length > 0
          ? {
              seasonal: poolSettings.seasonalEventTarget,
              trending: poolSettings.seasonalEvergreenTarget,
            }
          : {
              seasonal: 0,
              trending: poolSettings.evergreenTarget,
            };

        console.log(
          `[cron] industry="${industry}" target=${target.trending}T + ${target.seasonal}S ` +
          `(events: ${upcomingForIndustry.map((e) => e.name).join(", ") || "none"})`
        );

        // ── 2. Trending pool - ALWAYS refresh ──────────────────────────────
        // Mark all trending older than 7 days as stale, then regenerate up to target.
        const stale = await ctx.runQuery(
          internal.campaignTemplates.getStaleIndustryTemplates,
          { industry, olderThanDays: 7 }
        );
        for (const t of stale) {
          await ctx.runMutation(internal.campaignTemplates.deactivateTemplate, {
            templateId: t._id,
          });
        }
        await ensureTrendingPool(ctx, industry, target.trending);

        // ── 3. Seasonal pool - gap-fill only ───────────────────────────────
        if (target.seasonal > 0) {
          await ensureSeasonalPool(ctx, industry, upcomingForIndustry.slice(0, target.seasonal));
        }
      } catch (err) {
        console.error(`[cron] industry="${industry}" failed`, err);
      }
    }

    // ── 4. Personalize for all affected brands ─────────────────────────────
    // generateBrandTemplates is idempotent (skips bases already personalized).
    // It also holds a per-brand lock to prevent concurrent runs.
    console.log("[cron] Personalizing brand templates...");
    for (const industry of industries) {
      try {
        const brandsInIndustry = await ctx.runQuery(
          internal.campaignTemplates.listBrandsForIndustry,
          { industry }
        );
        for (const brand of brandsInIndustry) {
          const entitlement = await ctx.runQuery(internal.billing.getTemplateEntitlementInternal, {
            userId: String(brand.userId),
          });
          if (!entitlement.enabled) continue;
          const existingTemplates = await ctx.runQuery(
            internal.campaignTemplates.listActiveBrandTemplatesInternal,
            { brandId: brand._id },
          );
          if (existingTemplates.length > 0 && !entitlement.refreshEnabled) continue;
          if (existingTemplates.length > 0 && entitlement.refreshDays > 0) {
            const newest = Math.max(...existingTemplates.map((template: any) => Number(template.createdAt ?? 0)));
            const refreshAt = newest + entitlement.refreshDays * 24 * 60 * 60 * 1000;
            if (refreshAt > Date.now()) continue;
          }
          await ctx.runAction(internal.campaignTemplates.generateBrandTemplates, {
            brandId: brand._id,
            maxTemplates: entitlement.templateLimit,
            aiCoversEnabled: entitlement.aiCoversEnabled,
          });
        }
      } catch (err) {
        console.error(`[cron] personalization failed for industry ${industry}`, err);
      }
    }
    console.log("[cron] COMPLETE");
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// Brand Campaign Template Queries & Mutations
// ═══════════════════════════════════════════════════════════════════════════════

export const listBrandTemplates = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const entitlement = await getTemplateEntitlementForUser(ctx, String(userId));
    if (!entitlement.enabled || entitlement.templateLimit <= 0) return [];

    const raw = await ctx.db
      .query("brandCampaignTemplates")
      .withIndex("by_brandId_isActive", (q) => q.eq("brandId", args.brandId).eq("isActive", true))
      .collect();

    if (raw.length === 0) return [];

    // Get used template IDs for this brand
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_brandId_status", (q) => q.eq("brandId", args.brandId))
      .collect();
    const usedIds = new Set(campaigns.map(c => c.brandTemplateId || c.templateId).filter(Boolean));

    const now = Date.now();
    const DAY = 86400000;

    // Enrich with base template data
    const enriched = await Promise.all(raw.map(async (bt) => {
      const base = await ctx.db.get(bt.baseTemplateId);
      return {
        ...bt,
        category: bt.category || base?.category || 'industry',
        seasonalTrigger: bt.seasonalTrigger || base?.seasonalTrigger,
        usageCount: base?.usageCount ?? 0,
        _used: usedIds.has(bt._id) || usedIds.has(bt.baseTemplateId),
        _age: now - bt.createdAt,
      };
    }));

    // Relevance scoring - same logic used by getDashboardSummary
    const score = (t: any): number => {
      let s = 0;
      const trigger = t.seasonalTrigger;
      if (t.category === 'seasonal' && trigger) {
        const daysUntil = (trigger.activeFrom - now) / DAY;
        const daysPast = (now - trigger.activeTo) / DAY;
        if (daysPast > 0) s -= 500;
        else if (daysUntil <= 7) s += 2000;
        else if (daysUntil <= 14) s += 1500;
        else if (daysUntil <= 28) s += 800;
      }
      if (t.category === 'trending') s += 400;
      else if (t.category === 'industry') s += 300;
      else if (t.category === 'evergreen') s += 200;
      s += Math.min(t.usageCount * 20, 200);
      if (t._age < 3 * DAY) s += 150;
      else if (t._age < 7 * DAY) s += 50;
      if (t._used) s -= 300;
      return s;
    };

    const sorted = enriched.sort((a, b) => score(b) - score(a)).slice(0, entitlement.templateLimit);
    return sorted.map(({ _used, _age, ...rest }) => rest);
  },
});

export const getBrandTemplate = query({
  args: { templateId: v.id("brandCampaignTemplates") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(args.templateId);
  },
});

// Internal query for copilot getBrandTemplates tool - lists brand templates + falls back to base
export const listTemplatesForAgent = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const brandTemplates = await ctx.db
      .query("brandCampaignTemplates")
      .withIndex("by_brandId_isActive", (q) => q.eq("brandId", args.brandId).eq("isActive", true))
      .collect();

    if (brandTemplates.length > 0) {
      return { type: "brand" as const, templates: brandTemplates };
    }

    const baseTemplates = await ctx.db
      .query("campaignTemplates")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    return { type: "base" as const, templates: baseTemplates };
  },
});

// Internal query for agent tools - accepts a string ID, tries brandCampaignTemplates first, falls back to campaignTemplates
export const getAnyTemplate = internalQuery({
  args: { templateId: v.string() },
  handler: async (ctx, args) => {
    try {
      const brandTemplate = await ctx.db.get(args.templateId as any);
      if (brandTemplate) {
        // Resolve ambassador info if this is a brand template with one set
        let ambassadorInfo: any = null;
        if ((brandTemplate as any).prefillData?.suggestedAmbassadorId) {
          const amb = await ctx.db.get((brandTemplate as any).prefillData.suggestedAmbassadorId);
          if (amb && typeof amb === "object" && "name" in amb && "niche" in amb && "personality" in amb) {
            ambassadorInfo = { name: amb.name, niche: amb.niche, personality: amb.personality };
          }
        }
        return { template: brandTemplate, ambassador: ambassadorInfo };
      }
    } catch {}
    return null;
  },
});

export const insertBrandTemplate = internalMutation({
  args: {
    brandId: v.id("brands"),
    baseTemplateId: v.id("campaignTemplates"),
    name: v.string(),
    description: v.string(),
    personalizedHooks: v.array(v.string()),
    prefillData: v.object({
      suggestedTypes: v.array(v.string()),
      suggestedAngles: v.array(v.object({
        id: v.string(),
        name: v.string(),
        hook: v.string(),
        scriptOutline: v.string(),
        format: v.union(v.literal("Product Ads"), v.literal("AI UGC Ads")),
      })),
      suggestedAmbassadorId: v.optional(v.id("ambassadors")),
      targetAudience: v.optional(v.string()),
      videoStyle: v.optional(v.string()),
      productId: v.optional(v.id("products")),
      productName: v.optional(v.string()),
      productImageUrl: v.optional(v.string()),
      productPrice: v.optional(v.string()),
      suggestedGoal: v.optional(v.string()),
    }),
    coverImageUrl: v.optional(v.string()),
    category: v.optional(v.string()),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Atomic dedup: within the same transaction, check if an active brand
    // template for (brandId, baseTemplateId) already exists. Skip if so.
    // This is the race-condition safety net - two concurrent generate calls
    // will both pass the upstream "newBaseTemplates" filter, but only one
    // insert succeeds per (brand, base) pair.
    const existing = await ctx.db
      .query("brandCampaignTemplates")
      .withIndex("by_brandId_isActive", (q) => q.eq("brandId", args.brandId).eq("isActive", true))
      .filter((q) => q.eq(q.field("baseTemplateId"), args.baseTemplateId))
      .first();

    if (existing) {
      console.log(`[insertBrandTemplate] skipping duplicate - brand ${args.brandId} already has active template for base ${args.baseTemplateId}`);
      return existing._id;
    }

    return await ctx.db.insert("brandCampaignTemplates", {
      ...args,
      isActive: true,
      createdAt: Date.now(),
    });
  },
});

export const patchBrandTemplateCover = internalMutation({
  args: {
    templateId: v.id("brandCampaignTemplates"),
    coverImageUrl: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, { coverImageUrl: args.coverImageUrl });
  },
});

// Returns active brand templates that have no coverImageUrl yet. Used by the
// daily retry cron to fill in covers that failed on first generation (usually
// due to fal.ai credit exhaustion or transient errors).
export const listActiveTemplatesMissingCovers = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("brandCampaignTemplates")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
    return active
      .filter((t) => !t.coverImageUrl)
      .slice(0, args.limit);
  },
});

// Daily retry for templates with empty covers. Rate-limited to N per run and
// staggered so we don't hammer fal.ai. If fal is still out of credits the
// retry fails harmlessly and next day's run tries again.
export const cronRetryMissingTemplateCovers = internalAction({
  args: {},
  handler: async (ctx) => {
    const BATCH = 20;
    const STAGGER_MS = 5000;

    const templates = await ctx.runQuery(
      internal.campaignTemplates.listActiveTemplatesMissingCovers,
      { limit: BATCH },
    );
    if (templates.length === 0) {
      console.log("[cronRetryMissingTemplateCovers] no templates need covers");
      return;
    }

    // Group by brand so we only fetch each brand once.
    const brandIds = Array.from(new Set(templates.map((t) => t.brandId)));
    const brandEntries = await Promise.all(
      brandIds.map(async (id) => {
        const brand = await ctx.runQuery(internal.brands.getBrandByIdInternal, { brandId: id });
        return [id, brand] as const;
      }),
    );
    const brandMap = new Map(brandEntries.filter(([, b]) => b).map(([id, b]) => [id, b!]));

    let scheduled = 0;
    for (const t of templates) {
      const brand = brandMap.get(t.brandId);
      if (!brand) continue;
      const entitlement = await ctx.runQuery(internal.billing.getTemplateEntitlementInternal, {
        userId: String(brand.userId),
      });
      if (!entitlement.enabled || !entitlement.aiCoversEnabled) continue;
      await ctx.scheduler.runAfter(
        scheduled * STAGGER_MS,
        internal.campaignTemplates.generateTemplateCoverImage,
        {
          templateId: t._id,
          brandName: brand.name,
          brandTone: brand.brandTone || "Modern, clean, confident",
          primaryColor: brand.primaryColor || "#000000",
        },
      );
      scheduled++;
    }
    console.log(`[cronRetryMissingTemplateCovers] scheduled ${scheduled} cover retries (staggered ${STAGGER_MS}ms)`);
  },
});

export const generateTemplateCoverImage = internalAction({
  args: {
    templateId: v.id("brandCampaignTemplates"),
    brandName: v.string(),
    brandTone: v.string(),
    primaryColor: v.string(),
  },
  handler: async (ctx, args) => {
    const FAL_API_KEY = process.env.FAL_API_KEY;
    if (!FAL_API_KEY) return;

    const template = await ctx.runQuery(internal.campaignTemplates.getBrandTemplateInternal, {
      templateId: args.templateId,
    });
    if (!template || !template.isActive) return;
    const brand = await ctx.runQuery(internal.brands.getBrandByIdInternal, {
      brandId: template.brandId,
    });
    if (!brand) return;
    const entitlement = await ctx.runQuery(internal.billing.getTemplateEntitlementInternal, {
      userId: String(brand.userId),
    });
    if (!entitlement.enabled || !entitlement.aiCoversEnabled) return;

    const { runImageGenerator } = await import("./specializedAgents/imageGenerator");

    const productName = template.prefillData.productName || "the product";
    const category = template.category || "industry";
    const hasProductImage = Boolean(template.prefillData.productImageUrl);

    // Seasonal templates get event-specific context
    const seasonalContext = category === "seasonal" && template.seasonalTrigger?.name
      ? `Evoke the mood of ${template.seasonalTrigger.name} - use seasonal visual cues that feel natural, not cliche.`
      : "";

    // Build prompt + style based on whether we have a product image to reference.
    // With product image → product-focused composition using the image as reference.
    // Without product image → brand-concept thumbnail using brand color + tone + category vibe.
    let prompt: string;
    let assetReferences: any[] = [];
    let style: string;

    if (hasProductImage) {
      const compositionStyles = [
        `product placed in its natural environment (outdoors, action context), shot from a dynamic low angle with dramatic depth of field`,
        `product as hero on a clean surface with cinematic rim lighting, shot from slightly above with bokeh background`,
        `lifestyle flat-lay with the product surrounded by contextual props, warm overhead lighting`,
        `product in motion or mid-use, captured with slight motion blur for energy, wide angle`,
        `dramatic close-up of the product's key detail or texture, macro-style with shallow depth of field`,
      ];
      const styleIndex = Math.abs(template.name.length + template.createdAt) % compositionStyles.length;
      const composition = compositionStyles[styleIndex];

      prompt =
        `Create a campaign thumbnail for "${template.name}". ` +
        `Campaign concept: ${template.description}. ` +
        `The provided product image of "${productName}" must be the clear focal point. ` +
        `Composition: ${composition}. ` +
        `Mood: ${args.brandTone}. ${seasonalContext} ` +
        `The background should use contextual environmental elements that match the campaign theme (not abstract, not plain white). ` +
        `Landscape 16:9. No text, no logos, no watermarks, no human faces. ` +
        `The result should feel like a scroll-stopping ad thumbnail.`;
      assetReferences = [
        { type: "product", imageUrl: template.prefillData.productImageUrl, name: productName },
      ];
      style = "Product Shot";
    } else {
      // Brand-concept thumbnail (no product image available)
      const conceptStyles = [
        `abstract lifestyle composition with bold color accents, dynamic light and shadow play`,
        `cinematic mood image that captures the feeling of the campaign - no products, just atmosphere and emotion`,
        `graphic editorial composition with layered shapes, textures, and the brand's primary color as the dominant hue`,
        `environmental/contextual shot that evokes where the target customer would use this kind of product`,
        `bold typography-free hero composition with strong directional light and cinematic framing`,
      ];
      const styleIndex = Math.abs(template.name.length + template.createdAt) % conceptStyles.length;
      const composition = conceptStyles[styleIndex];

      prompt =
        `Create a campaign thumbnail for "${template.name}". ` +
        `Campaign concept: ${template.description}. ` +
        `Composition: ${composition}. ` +
        `Use the brand's primary color (${args.primaryColor}) prominently in lighting or accent. ` +
        `Mood: ${args.brandTone}. ${seasonalContext} ` +
        `Landscape 16:9. No text, no logos, no watermarks, no human faces. ` +
        `The result should feel like a scroll-stopping ad thumbnail that represents the campaign idea - not a literal product shot.`;
      assetReferences = [];
      style = "Cinematic";
    }

    try {
      const result = await runImageGenerator(
        {
          prompt,
          brandName: args.brandName,
          primaryColor: args.primaryColor,
          brandTone: args.brandTone,
          style,
          aspectRatio: "16:9",
          assetReferences,
        },
        FAL_API_KEY,
      );

      if ("imageUrl" in result && result.imageUrl) {
        // Phase 1 - immediately set the fal.ai URL so users see the cover as soon
        // as it's generated (no wait for R2 copy).
        await ctx.runMutation(internal.campaignTemplates.patchBrandTemplateCover, {
          templateId: args.templateId,
          coverImageUrl: result.imageUrl,
        });
        await ctx.runMutation(internal.billing.recordPlatformAiUsageInternal, {
          userId: String(brand.userId),
          brandId: template.brandId,
          skuKey: "template.cover_image",
          featureKey: "campaign_template_covers",
          units: 1,
          status: "succeeded",
          metadata: { templateId: String(args.templateId) },
        });
        console.log(`[generateTemplateCoverImage] Cover generated (fal.ai) for "${template.name}"`);

        // Phase 2 - schedule R2 persistence in background. fal.ai URLs expire;
        // once copied, the template URL is swapped to R2 transparently.
        // We use runAfter(0) so the action returns quickly and the copy happens
        // off the critical path.
        await ctx.scheduler.runAfter(
          0,
          internal.campaignTemplates.persistTemplateCoverToR2,
          { templateId: args.templateId, sourceUrl: result.imageUrl },
        );
      }
    } catch (err) {
      await ctx.runMutation(internal.billing.recordPlatformAiUsageInternal, {
        userId: String(brand.userId),
        brandId: template.brandId,
        skuKey: "template.cover_image",
        featureKey: "campaign_template_covers",
        units: 1,
        status: "failed",
        metadata: {
          templateId: String(args.templateId),
          error: err instanceof Error ? err.message : String(err),
        },
      });
      console.error(`[generateTemplateCoverImage] Failed for template "${template.name}":`, err);
    }
  },
});

/**
 * Background R2 copy for template cover images.
 * Runs after generateTemplateCoverImage so the user sees the fal.ai URL instantly,
 * then we transparently upgrade the URL to R2 for permanent storage.
 */
export const persistTemplateCoverToR2 = internalAction({
  args: {
    templateId: v.id("brandCampaignTemplates"),
    sourceUrl: v.string(),
  },
  handler: async (ctx, args) => {
    // Skip if already on R2 (defensive)
    if (args.sourceUrl.includes("r2.dev")) return;

    const template = await ctx.runQuery(internal.campaignTemplates.getBrandTemplateInternal, {
      templateId: args.templateId,
    });
    if (!template) return;

    const persisted: { r2Url: string | null; error?: string } = await ctx.runAction(
      internal.agentTasks.copyUrlToR2,
      {
        sourceUrl: args.sourceUrl,
        key: `brands/${template.brandId}/assets/template-covers/${args.templateId}.webp`,
      },
    );

    if (persisted.r2Url) {
      await ctx.runMutation(internal.campaignTemplates.patchBrandTemplateCover, {
        templateId: args.templateId,
        coverImageUrl: persisted.r2Url,
      });
      console.log(`[persistTemplateCoverToR2] Swapped to R2 for template ${args.templateId}`);
    } else {
      console.warn(`[persistTemplateCoverToR2] R2 persistence failed for ${args.templateId}: ${persisted.error}. fal.ai URL remains.`);
    }
  },
});

export const deactivateBrandTemplatesForBase = internalMutation({
  args: { baseTemplateId: v.id("campaignTemplates") },
  handler: async (ctx, args) => {
    const templates = await ctx.db
      .query("brandCampaignTemplates")
      .withIndex("by_baseTemplateId", (q) => q.eq("baseTemplateId", args.baseTemplateId))
      .collect();
    for (const t of templates) {
      if (t.isActive) await ctx.db.patch(t._id, { isActive: false });
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// generateBrandTemplates (brand personalization layer)
// ═══════════════════════════════════════════════════════════════════════════════

export const generateBrandTemplates = internalAction({
  args: {
    brandId: v.id("brands"),
    maxTemplates: v.optional(v.number()),
    aiCoversEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // ── Acquire per-brand lock to prevent concurrent runs ────────────────────
    // If another generation is already in flight for this brand, skip silently.
    // The insert-level dedup is a safety net; the lock is the primary guard.
    const acquired: boolean = await ctx.runMutation(
      internal.brands.tryAcquireTemplateLock,
      { brandId: args.brandId },
    );
    if (!acquired) {
      console.log(`[generateBrandTemplates] brand ${args.brandId} is already generating - skipping`);
      return;
    }

    try {
      const brand = await ctx.runQuery(internal.brands.getBrandByIdInternal, { brandId: args.brandId });
      if (!brand || brand.status !== "active") return;

      const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
      if (!OPENROUTER_API_KEY) return;

      // Get base templates for this brand's industry
      const baseTemplates = brand.industry
        ? await ctx.runQuery(internal.campaignTemplates.listActiveBaseTemplatesForIndustry, { industry: brand.industry })
        : [];

      if (baseTemplates.length === 0) return;

      // Dedup: check which base templates already have active brand templates
      const existingBrandTemplates = await ctx.runQuery(
        internal.campaignTemplates.listActiveBrandTemplatesInternal,
        { brandId: args.brandId }
      );
      const existingBaseIds = new Set(existingBrandTemplates.map((bt: any) => bt.baseTemplateId));
      const maxTemplates = typeof args.maxTemplates === "number"
        ? Math.max(0, Math.floor(args.maxTemplates))
        : Number.POSITIVE_INFINITY;
      const remainingSlots = Number.isFinite(maxTemplates)
        ? Math.max(0, maxTemplates - existingBrandTemplates.length)
        : Number.POSITIVE_INFINITY;
      if (remainingSlots <= 0) {
        console.log(`[generateBrandTemplates] brand already has ${existingBrandTemplates.length}/${maxTemplates} allowed templates - skipping`);
        return;
      }
      const newBaseTemplates = baseTemplates
        .filter((bt: any) => !existingBaseIds.has(bt._id))
        .slice(0, remainingSlots);
      if (newBaseTemplates.length === 0) {
        console.log(`[generateBrandTemplates] all ${baseTemplates.length} base templates already have brand templates - skipping`);
        return;
      }
      console.log(`[generateBrandTemplates] ${newBaseTemplates.length} new base templates to personalize (${existingBaseIds.size} already exist)`);

    // Get brand's ambassador preference
    let ambassadorId = brand.preferredAmbassadorId;
    if (!ambassadorId) {
      const presets = await ctx.runQuery(internal.campaignTemplates.listPresetAmbassadorsForBrandTemplates);
      if (presets.length > 0) ambassadorId = presets[0]._id;
    }

    // Get brand's products for AI product matching
    const rawProducts = await ctx.runQuery(internal.products.listProductsInternal, { brandId: args.brandId });
    // Products table uses 'title' not 'name' - normalize here
    const products = rawProducts.map((p: any) => ({
      _id: p._id,
      name: p.title || p.name || "Untitled Product",
      category: p.category || p.productType || "",
      imageUrl: p.imageUrl,
      handle: p.handle,
      priceRange: p.priceRange,
    }));

    // Build target audience string
    const demo = brand.targetDemographics;
    const audienceParts: string[] = [];
    if (demo?.ageRange) audienceParts.push(`aged ${demo.ageRange}`);
    if (demo?.gender) audienceParts.push(demo.gender);
    if (demo?.interests?.length) audienceParts.push(`interested in ${demo.interests.slice(0, 3).join(", ")}`);
    const audienceStr = audienceParts.length > 0 ? audienceParts.join(", ") : "general consumers";

    // Build product catalog string for AI matching
    const productCatalog = products.length > 0
      ? products.map((p, i) => `${i + 1}. "${p.name}"${p.category ? ` (${p.category})` : ''}`).join("\n")
      : "";

    const model = getModel();

    const brandTemplateSchema = z.object({
      name: z.string(),
      description: z.string(),
      hooks: z.array(z.string()),
      productAdAngles: z.array(z.object({
        id: z.string().describe("kebab-case unique id"),
        name: z.string(),
        hook: z.string().describe("Opening text/visual hook for the product showcase"),
        scriptOutline: z.string().describe("2-sentence description of what happens in the video visually"),
      })).describe("Product Ad angles. Can be 0 if this concept doesn't suit product-only visuals, or 1-4 if it does."),
      ugcAdAngles: z.array(z.object({
        id: z.string().describe("kebab-case unique id"),
        name: z.string(),
        hook: z.string().describe("Opening line the avatar speaks to camera"),
        scriptOutline: z.string().describe("2-sentence description of what the avatar says and does"),
      })).describe("UGC Ad angles. Can be 0 if this concept doesn't suit creator presentation, or 1-4 if it does."),
      videoStyle: z.string().describe('"UGC Ad", "Product Showcase", or "mixed"'),
      targetAudience: z.string(),
      bestFitProductIndex: z.number().describe("1-indexed number of the best-fit product from the catalog. Required when products are available."),
    });

    const templateIds: string[] = [];
    let lastProductIndex = 0; // Round-robin fallback counter
    const alreadyPickedProducts: string[] = []; // Track picks across iterations for diversity

    for (const base of newBaseTemplates) {
      try {
        // Shuffle product catalog per iteration to eliminate positional/primacy bias
        const shuffledProducts = products.length > 0
          ? [...products].sort(() => Math.random() - 0.5)
          : [];
        const shuffledCatalog = shuffledProducts.length > 0
          ? shuffledProducts.map((p, i) => `${i + 1}. "${p.name}"${p.category ? ` (${p.category})` : ''}`).join("\n")
          : "";

        const diversityHint = alreadyPickedProducts.length > 0
          ? `\nProducts already assigned to other campaigns: ${alreadyPickedProducts.join(", ")}. Pick a DIFFERENT product if possible to ensure product variety across campaigns.`
          : "";

        const productPromptSection = shuffledCatalog
          ? `\n\nAvailable products:\n${shuffledCatalog}\n\nPick the single product that BEST matches this specific campaign's theme "${base.name}" and concept "${base.description}". Consider which product a viewer of this campaign would most want to buy. Set bestFitProductIndex to that product's number (1-indexed).${diversityHint}`
          : "";

        const result = await generateObject({
          model,
          schema: brandTemplateSchema,
          system: `You are the in-house creative lead for ${brand.name}. Your brand voice is: ${brand.brandTone || "professional and approachable"}. You create campaign concepts for a ${brand.industry} brand targeting ${audienceStr}. Every concept you create feels native to the brand -- as if ${brand.name} came up with it themselves.`,
          prompt: `Personalize this campaign template for ${brand.name}:

Template: ${base.name}
Concept: ${base.description}
Base hooks: ${(base.sampleHooks || []).join("; ")}
Base angles: ${(base.suggestedAngles || []).join(", ")}${productPromptSection}

Generate:
- A personalized campaign name that feels like ${brand.name}'s own campaign
- A personalized description in the brand's voice
- 3 video opening hooks that mention or feel connected to ${brand.name}
- Product Ad angles: visual-first concepts where the product is the star (no avatar). Each with a kebab-case id, name, visual hook text, and 2-sentence script outline. Generate as many as the campaign concept naturally calls for (could be 0 if this concept is purely creator-driven, or 1-4 if product visuals are central).
- AI UGC Ad angles: creator-style concepts where an AI avatar speaks to camera. Each with a kebab-case id, name, spoken opening hook, and 2-sentence outline. Generate as many as makes sense for this concept (could be 0 if the concept is purely visual/product-focused, or 1-4 if creator presentation is key).
- Recommended video style: "UGC Ad" (only UGC angles), "Product Showcase" (only product angles), or "mixed" (both)
- A target audience description

Decide the number and mix of angles based on: the campaign concept, the brand's tone, the target audience, and what would actually perform well for a ${brand.industry || 'consumer'} brand. Not every campaign needs both formats.`,
        });

        const data = result.object;

        // Resolve AI-selected product from shuffled list - always assign one if products exist
        let selectedProduct: typeof products[0] | undefined;
        if (shuffledProducts.length > 0) {
          const rawIndex = data.bestFitProductIndex;
          // Handle both 0-indexed and 1-indexed responses from AI
          const resolvedIndex = rawIndex !== undefined && rawIndex !== null
            ? (rawIndex >= 1 ? rawIndex - 1 : rawIndex)
            : -1;

          if (resolvedIndex >= 0 && resolvedIndex < shuffledProducts.length) {
            selectedProduct = shuffledProducts[resolvedIndex];
            console.log(`[generateBrandTemplates] AI picked product "${selectedProduct.name}" (index ${rawIndex} in shuffled list) for "${base.name}"`);
          } else {
            // Fallback: round-robin across the original products array
            selectedProduct = products[lastProductIndex % products.length];
            console.log(`[generateBrandTemplates] Fallback: assigned product "${selectedProduct.name}" (round-robin ${lastProductIndex}) for "${base.name}" - AI returned index: ${rawIndex}`);
            lastProductIndex++;
          }
          alreadyPickedProducts.push(`"${selectedProduct.name}"`);
        }

        // Map video style to types
        const types = data.videoStyle === "UGC Ad" ? ["AI UGC Ads"]
          : data.videoStyle === "Product Showcase" ? ["Product Ads"]
          : ["Product Ads", "AI UGC Ads"];

        // Merge angles with format tags
        const allAngles: Array<{
          id: string;
          name: string;
          hook: string;
          scriptOutline: string;
          format: "Product Ads" | "AI UGC Ads";
        }> = [
          ...data.productAdAngles.map((a): { id: string; name: string; hook: string; scriptOutline: string; format: "Product Ads" } => ({
            id: a.id,
            name: a.name,
            hook: a.hook,
            scriptOutline: a.scriptOutline,
            format: "Product Ads",
          })),
          ...data.ugcAdAngles.map((a): { id: string; name: string; hook: string; scriptOutline: string; format: "AI UGC Ads" } => ({
            id: a.id,
            name: a.name,
            hook: a.hook,
            scriptOutline: a.scriptOutline,
            format: "AI UGC Ads",
          })),
        ];

        const templateId = await ctx.runMutation(internal.campaignTemplates.insertBrandTemplate, {
          brandId: args.brandId,
          baseTemplateId: base._id,
          name: data.name,
          description: data.description,
          personalizedHooks: data.hooks,
          prefillData: {
            suggestedTypes: types,
            suggestedAngles: allAngles,
            suggestedAmbassadorId: ambassadorId || undefined,
            targetAudience: data.targetAudience,
            videoStyle: data.videoStyle,
            productId: selectedProduct?._id,
            productName: selectedProduct?.name,
            productImageUrl: selectedProduct?.imageUrl,
            // Pull from the product's Shopify priceRange so wizard step 1
            // can prefill the Price field without an extra round trip.
            // Falls back to undefined for manual / no-priceRange products.
            productPrice: formatShopifyPrice(selectedProduct?.priceRange),
            // Inherit the goal the LLM picked at base-template generation
            // time. Brand personalization doesn't re-decide the goal; it
            // mostly just slots a product + ambassador into the existing
            // strategic frame.
            suggestedGoal: base.suggestedGoal,
          },
          category: base.category,
          seasonalTrigger: base.seasonalTrigger,
          expiresAt: base.expiresAt || Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
        await ctx.runMutation(internal.billing.recordPlatformAiUsageInternal, {
          userId: String(brand.userId),
          brandId: args.brandId,
          skuKey: "template.personalization",
          featureKey: "campaign_templates",
          units: 1,
          status: "succeeded",
          metadata: {
            templateId: String(templateId),
            baseTemplateId: String(base._id),
          },
        });

        templateIds.push(templateId);
      } catch (err) {
        console.error(`[generateBrandTemplates] Failed for base template ${base.name}:`, err);
      }
    }

      // Schedule cover image generation for EVERY brand template.
      // generateTemplateCoverImage handles both paths internally:
      //   - With product image → product-focused composition
      //   - Without product image → brand-concept thumbnail using brand color + tone
      const FAL_API_KEY = process.env.FAL_API_KEY;
      if (args.aiCoversEnabled !== false && FAL_API_KEY && templateIds.length > 0) {
        for (const templateId of templateIds) {
          try {
            await ctx.scheduler.runAfter(0, internal.campaignTemplates.generateTemplateCoverImage, {
              templateId: templateId as any,
              brandName: brand.name,
              brandTone: brand.brandTone || "professional",
              primaryColor: brand.primaryColor || "#3d56f5",
            });
          } catch (err) {
            console.error(`[generateBrandTemplates] Failed to schedule cover generation for ${templateId}:`, err);
          }
        }
      }
    } finally {
      // Always release the lock, even if generation failed partway.
      await ctx.runMutation(internal.brands.releaseTemplateLock, { brandId: args.brandId });
    }
  },
});

// ─── Helper query: list preset ambassadors (internal, no auth) ───────────────
// Used by generateBrandTemplates to find a fallback ambassador if the brand
// doesn't have a preferredAmbassadorId set.

export const getBrandTemplateInternal = internalQuery({
  args: { templateId: v.id("brandCampaignTemplates") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.templateId);
  },
});

export const listPresetAmbassadorsForBrandTemplates = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("ambassadors")
      .withIndex("by_type", (q) => q.eq("type", "preset"))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

export const listBrandsForIndustry = internalQuery({
  args: { industry: v.string() },
  handler: async (ctx, args) => {
    const brands = await ctx.db
      .query("brands")
      .withIndex("by_userId")
      .filter((q) => q.and(
        q.eq(q.field("status"), "active"),
        q.eq(q.field("industry"), args.industry)
      ))
      .collect();
    return brands;
  },
});

export const listActiveBrandTemplatesInternal = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("brandCampaignTemplates")
      .withIndex("by_brandId_isActive", (q) => q.eq("brandId", args.brandId).eq("isActive", true))
      .collect();
  },
});

export const deactivateBrandTemplate = internalMutation({
  args: { templateId: v.id("brandCampaignTemplates") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.templateId, { isActive: false });
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
// generateCampaignAngles - AI-generated angles for from-scratch campaigns
// ═══════════════════════════════════════════════════════════════════════════════

// Angles get tagged with their format so the wizard can keep them in
// lock-step with the type cards (toggling off "AI UGC Ads" drops every
// UGC angle from the pool). v1 stored angle.format the same way.
const angleFormatSchema = z.enum(["Product Ads", "AI UGC Ads"]);

const campaignAnglesSchema = z.object({
  angles: z.array(z.object({
    id: z.string().describe("kebab-case unique id"),
    name: z.string(),
    hook: z.string(),
    scriptOutline: z.string(),
    format: angleFormatSchema.describe('"Product Ads" or "AI UGC Ads" - which content type this angle belongs to'),
  })),
});

export const generateCampaignAngles: any = action({
  args: {
    brandId: v.id("brands"),
    productName: v.string(),
    productCategory: v.optional(v.string()),
    targetAudience: v.optional(v.string()),
    keyBenefit: v.optional(v.string()),
    campaignGoal: v.optional(v.union(v.literal("awareness"), v.literal("conversion"), v.literal("retention"))),
    videoStyles: v.array(v.string()),
    variationCount: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set");

    const brand = await ctx.runQuery(internal.brands.getBrandByIdInternal, { brandId: args.brandId });
    if (!brand) throw new Error("Brand not found");
    if (brand.userId !== String(userId)) throw new Error("not authorized");

    // Reject style values we don't recognize so a bad caller can't slip a
    // free-text string into the prompt and confuse the AI.
    const allowedStyles = args.videoStyles.filter(
      (s): s is "Product Ads" | "AI UGC Ads" => s === "Product Ads" || s === "AI UGC Ads",
    );
    if (allowedStyles.length === 0) {
      throw new Error("videoStyles must include at least one of: Product Ads, AI UGC Ads");
    }

    const skuConfig = await ctx.runQuery(internal.billing.getSkuConfigurationInternal, {
      skuKey: "text.campaign_angle_batch",
    });
    const configuredBatchSize = skuConfig.metadata?.batchSize;
    const batchSize = typeof configuredBatchSize === "number" && configuredBatchSize > 0
      ? configuredBatchSize
      : 4;

    const billing = await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
      userId: String(userId),
      brandId: args.brandId,
      featureKey: "campaign_generation",
      skuKey: "text.campaign_angle_batch",
      units: Math.max(1, Math.ceil(args.variationCount / batchSize)),
      metadata: {
        source: "campaign_angle_generation",
        variationCount: args.variationCount,
        videoStyles: allowedStyles,
      },
    });

    const model = getModel();
    const styleDesc = allowedStyles.join(" and ");
    const goalDirection =
      args.campaignGoal === "awareness" ? "Lead with bold, scroll-stopping hooks that build recognition."
      : args.campaignGoal === "conversion" ? "Lead with urgency, social proof, and a clear value prop."
      : args.campaignGoal === "retention" ? "Lead with loyalty cues, repeat-use benefits, and community feel."
      : "";

    try {
      const result = await generateObject({
        model,
        schema: campaignAnglesSchema,
        system: `You are a creative director for ${brand.industry || "e-commerce"} brands who creates short-form video ad concepts for TikTok and Instagram Reels. You think in terms of what stops the scroll and drives action - not generic marketing ideas.`,
        prompt: `Create ${args.variationCount} video ad concepts for:

Product: ${args.productName}${args.productCategory ? `\nCategory: ${args.productCategory}` : ''}${args.targetAudience ? `\nAudience: ${args.targetAudience}` : ''}${args.keyBenefit ? `\nKey benefit: ${args.keyBenefit}` : ''}
Brand: ${brand.name} (voice: ${brand.brandTone || "professional and approachable"})
Formats available: ${styleDesc}${goalDirection ? `\nCampaign goal: ${goalDirection}` : ''}

For each concept provide:
- A kebab-case id (unique across the set)
- A short name
- An opening hook (under 10 words - could be spoken to camera OR a visual text hook, depending on the format)
- A 2-sentence script outline describing what happens in the video
- A "format" field tagged as either "Product Ads" (visual-first, no avatar) or "AI UGC Ads" (creator-style avatar speaking to camera). Only use formats from: ${styleDesc}.

Each concept should have a distinct creative approach. If both formats are available, create a natural mix - don't force every concept into both. If only one format is available, every concept must use it.`,
      });

      // The model can satisfy the schema while returning formats that the user
      // did not request. Only charge when at least one usable angle exists.
      const usableAngles = result.object.angles.filter((a) => allowedStyles.includes(a.format));
      if (usableAngles.length === 0) {
        throw new Error("No usable campaign angles were generated");
      }

      await ctx.runMutation(internal.billing.chargeReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.campaign_angle_batch",
        reason: "Charged for campaign angle generation",
      });

      return usableAngles;
    } catch (error) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "text.campaign_angle_batch",
        reason: error instanceof Error ? error.message : "Campaign angle generation failed",
      });
      throw error;
    }
  },
});


// Admin schema to Get all campaign templates
export const getCampaignTemplates = query({
  args: {
    category: v.optional(v.string()),
    industry: v.optional(v.string()),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let templates;
    
    // Use appropriate index based on filters
    if (args.activeOnly === true) {
      templates = await ctx.db
        .query("campaignTemplates")
        .withIndex("by_isActive", (q) => q.eq("isActive", true))
        .collect();
    } else if (args.activeOnly === false) {
      templates = await ctx.db
        .query("campaignTemplates")
        .withIndex("by_isActive", (q) => q.eq("isActive", false))
        .collect();
    } else if (args.category) {
      templates = await ctx.db
        .query("campaignTemplates")
        .withIndex("by_category", (q) => q.eq("category", args.category!))
        .collect();
    } else {
      templates = await ctx.db.query("campaignTemplates").collect();
    }

    // Filter by category if not already filtered by index
    if (args.category && args.activeOnly === undefined) {
      templates = templates.filter(t => t.category === args.category);
    }

    // Filter by industry if specified
    if (args.industry) {
      templates = templates.filter(t => t.industries.includes(args.industry!));
    }

    // Filter by active status if not already filtered by index
    if (args.activeOnly === true && args.category) {
      templates = templates.filter(t => t.isActive);
    }

    // Filter out expired templates
    const now = Date.now();
    templates = templates.filter(t => !t.expiresAt || t.expiresAt > now);

    return templates.sort((a, b) => b.usageCount - a.usageCount);
  },
});

// Create a new campaign template
export const createCampaignTemplate = mutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.string(),
    industries: v.array(v.string()),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    suggestedTypes: v.array(v.string()),
    suggestedAngles: v.array(v.string()),
    suggestedAmbassadorCategory: v.optional(v.string()),
    sampleHooks: v.optional(v.array(v.string())),
    source: v.string(),
    isActive: v.boolean(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const templateId = await ctx.db.insert("campaignTemplates", {
      name: args.name,
      description: args.description,
      category: args.category,
      industries: args.industries,
      seasonalTrigger: args.seasonalTrigger,
      suggestedTypes: args.suggestedTypes,
      suggestedAngles: args.suggestedAngles,
      suggestedAmbassadorCategory: args.suggestedAmbassadorCategory,
      sampleHooks: args.sampleHooks,
      source: args.source,
      isActive: args.isActive,
      expiresAt: args.expiresAt,
      usageCount: 0,
      createdAt: Date.now(),
    });

    return templateId;
  },
});

// Update campaign template
export const updateCampaignTemplate = mutation({
  args: {
    templateId: v.id("campaignTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    category: v.optional(v.string()),
    industries: v.optional(v.array(v.string())),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    suggestedTypes: v.optional(v.array(v.string())),
    suggestedAngles: v.optional(v.array(v.string())),
    suggestedAmbassadorCategory: v.optional(v.string()),
    sampleHooks: v.optional(v.array(v.string())),
    isActive: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    const updateData: any = {};
    if (args.name !== undefined) updateData.name = args.name;
    if (args.description !== undefined) updateData.description = args.description;
    if (args.category !== undefined) updateData.category = args.category;
    if (args.industries !== undefined) updateData.industries = args.industries;
    if (args.seasonalTrigger !== undefined) updateData.seasonalTrigger = args.seasonalTrigger;
    if (args.suggestedTypes !== undefined) updateData.suggestedTypes = args.suggestedTypes;
    if (args.suggestedAngles !== undefined) updateData.suggestedAngles = args.suggestedAngles;
    if (args.suggestedAmbassadorCategory !== undefined) updateData.suggestedAmbassadorCategory = args.suggestedAmbassadorCategory;
    if (args.sampleHooks !== undefined) updateData.sampleHooks = args.sampleHooks;
    if (args.isActive !== undefined) updateData.isActive = args.isActive;
    if (args.expiresAt !== undefined) updateData.expiresAt = args.expiresAt;

    await ctx.db.patch(args.templateId, updateData);
    return args.templateId;
  },
});

// Delete campaign template
export const deleteCampaignTemplate = mutation({
  args: { templateId: v.id("campaignTemplates") },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    await ctx.db.delete(args.templateId);
    return args.templateId;
  },
});


// Create campaign from template
export const createCampaignFromTemplate = mutation({
  args: {
    templateId: v.id("campaignTemplates"),
    brandId: v.id("brands"),
    customName: v.optional(v.string()),
    selectedProducts: v.optional(v.array(v.object({
      name: v.string(),
      shopifyProductId: v.optional(v.id("products")),
      imageUrl: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      keyBenefit: v.optional(v.string()),
      problemSolved: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    // Get the template
    const template = await ctx.db.get(args.templateId);
    if (!template || !template.isActive) {
      throw new Error("Template not found or inactive");
    }

    // Check if template is expired
    if (template.expiresAt && template.expiresAt < Date.now()) {
      throw new Error("Template has expired");
    }

    // Convert template suggestedAngles to campaign format
    const campaignAngles = template.suggestedAngles.map((angle, index) => ({
      id: `angle_${index}`,
      name: angle,
      hook: template.sampleHooks?.[index] || `Hook for ${angle}`,
      scriptOutline: `Script outline for ${angle}`,
      format: "AI UGC Ads" as const,
    }));

    // Create campaign from template
    const campaignId = await ctx.db.insert("campaigns", {
      name: args.customName || template.name,
      description: template.description,
      brandId: args.brandId,
      campaignType: "template",
      templateId: args.templateId,
      products: args.selectedProducts || [],
      selectedTypes: template.suggestedTypes,
      selectedAngles: campaignAngles,
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Increment template usage count
    await ctx.db.patch(args.templateId, { 
      usageCount: template.usageCount + 1 
    });

    return campaignId;
  },
});
