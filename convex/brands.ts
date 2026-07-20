import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText } from "ai";
import { getCurrentTeamMember } from "./helpers";

// Internal query used by webhooks to look up a brand by userId without auth context
export const getBrandByUserId = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      // Allow finding "draft" brands since Shopify connects during onboarding
      .first();
  },
});

export const getBrand = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return null;
    }

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    return brand;
  },
});

// Returns the user's current draft brand (for prefilling onboarding on reload)
export const getMyDraft = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    return await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "draft"))
      .first();
  },
});

// Saves partial brand fields + current step to the draft mid-onboarding
export const patchDraft = mutation({
  args: {
    name: v.optional(v.string()),
    tagline: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    brandTone: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    goal: v.optional(v.string()),
    shopifyConnected: v.optional(v.boolean()),
    setupDetails: v.optional(v.any()),
    onboardingStep: v.optional(v.number()),
    industry: v.optional(v.string()),
    targetDemographics: v.optional(v.object({
      ageRange: v.optional(v.string()),
      gender: v.optional(v.string()),
      interests: v.optional(v.array(v.string())),
    })),
    websiteUrl: v.optional(v.string()),
    preferredPlatforms: v.optional(v.array(v.string())),
    audienceSegments: v.optional(v.array(v.string())),
    targetAudience: v.optional(v.string()),
    brandGuideUrl: v.optional(v.string()),
    brandGuideAnalyzed: v.optional(v.boolean()),
    timezone: v.optional(v.string()),
    description: v.optional(v.string()),
    preferredAmbassadorId: v.optional(v.id("ambassadors")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const draft = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "draft"))
      .first();

    if (!draft) return null; // no draft to patch yet

    // Only include defined fields to avoid overwriting good data with undefined
    const patch = Object.fromEntries(
      Object.entries(args).filter(([, v]) => v !== undefined)
    );

    await ctx.db.patch(draft._id, patch);
    return draft._id;
  },
});

/**
 * Called from the v2 signup flow right after Convex Auth creates the user.
 * Inserts a draft brand row carrying the company name the user typed at signup
 * so the rest of the onboarding flow can patch it. Idempotent: returns the
 * existing brand id if one already exists for this user.
 */
/**
 * Applies the structured output of the `brand_guide_analyzer` agent to the
 * user's draft brand. Idempotent and write-once-per-field - never overwrites
 * a non-empty field the user already entered manually. Sets
 * `brandGuideAnalyzed: true` so the Review screen can show the AI badge.
 */
export const applyBrandGuideExtraction = mutation({
  args: {
    extracted: v.object({
      name: v.optional(v.string()),
      tagline: v.optional(v.string()),
      description: v.optional(v.string()),
      primaryColor: v.optional(v.string()),
      secondaryColor: v.optional(v.string()),
      brandTone: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      interests: v.optional(v.array(v.string())),
      industry: v.optional(v.string()),
    }),
    brandGuideUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const draft = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "draft"))
      .first();
    if (!draft) return null;

    // Helper: only patch when the existing field is empty/undefined so we
    // don't clobber edits the user made manually before triggering analysis.
    const e = args.extracted;
    const patch: Record<string, unknown> = {
      brandGuideAnalyzed: true,
    };
    if (args.brandGuideUrl) patch.brandGuideUrl = args.brandGuideUrl;
    if (e.name && !draft.name?.trim()) patch.name = e.name;
    if (e.tagline && !draft.tagline?.trim()) patch.tagline = e.tagline;
    if (e.description && !draft.description?.trim()) patch.description = e.description;
    if (e.primaryColor && !draft.primaryColor) patch.primaryColor = e.primaryColor;
    if (e.secondaryColor && !draft.secondaryColor) patch.secondaryColor = e.secondaryColor;
    if (e.brandTone && !draft.brandTone?.trim()) patch.brandTone = e.brandTone;
    if (e.targetAudience && !draft.targetAudience?.trim()) patch.targetAudience = e.targetAudience;
    if (e.industry && !draft.industry) patch.industry = e.industry;
    if (e.interests && e.interests.length && !draft.targetDemographics?.interests?.length) {
      patch.targetDemographics = { interests: e.interests };
    }

    await ctx.db.patch(draft._id, patch);
    return draft._id;
  },
});

/**
 * Flips the user's draft brand from `status: "draft"` → `status: "active"`,
 * effectively completing onboarding. Optionally accepts last-mile fields
 * (timezone, websiteUrl, countryCode) so the Review screen can patch + flip
 * in a single round-trip. Idempotent: returns the brand id whether the row
 * was already active or just flipped.
 */
export const activateBrand = mutation({
  args: {
    timezone: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!brand) throw new Error("no brand to activate");

    const patch = Object.fromEntries(
      Object.entries(args).filter(([, v]) => v !== undefined),
    );

    await ctx.db.patch(brand._id, {
      ...patch,
      status: "active",
    });

    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendWelcomeEmail, {
      brandId: brand._id,
    });

    return brand._id;
  },
});

// Idempotent: ensures a draft brand row exists for the authenticated user.
// `companyName` is optional so this can be called from any auth path (password
// signup passes it for prefill; Google/OAuth signups omit it and the brand
// name is captured later during onboarding).
export const createStubAtSignup = mutation({
  args: { companyName: v.optional(v.string()) },
  handler: async (ctx, { companyName }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (existing) return existing._id;

    return await ctx.db.insert("brands", {
      userId,
      name: companyName?.trim() ?? "",
      status: "draft",
      onboardingStep: 0,
    });
  },
});

export const updateActiveBrand = mutation({
  args: {
    brandId: v.id("brands"),
    name: v.optional(v.string()),
    tagline: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    brandTone: v.optional(v.string()),
    goal: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    setupDetails: v.optional(v.any()),
    preferredAmbassadorId: v.optional(v.id("ambassadors")),
    industry: v.optional(v.string()),
    websiteUrl: v.optional(v.string()),
    timezone: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    description: v.optional(v.string()),
    targetDemographics: v.optional(v.object({
      ageRange: v.optional(v.string()),
      gender: v.optional(v.string()),
      interests: v.array(v.string()),
    })),
    preferredPlatforms: v.optional(v.array(v.string())),
    audienceSegments: v.optional(v.array(v.string())),
    targetAudience: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Brand not found or not authorized");
    }

    const { brandId, ...patchData } = args;
    
    // Only include defined fields to avoid overwriting good data with undefined
    const patch = Object.fromEntries(
      Object.entries(patchData).filter(([, val]) => val !== undefined)
    );

    await ctx.db.patch(brandId, patch);
    return brandId;
  },
});

export const initializeDraft = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brandName = args.name?.trim() || "Untitled Brand";

    // Check for an in-progress draft
    const existingDraft = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "draft"))
      .first();

    if (existingDraft) {
      // Update the name in case the user changed it
      await ctx.db.patch(existingDraft._id, { name: brandName });
      return existingDraft._id;
    }

    // Create a minimal draft brand record with the real name
    const brandId = await ctx.db.insert("brands", {
      userId,
      name: brandName,
      status: "draft",
    });

    return brandId;
  },
});

// Finalises the draft brand created at the start of onboarding
export const completeBranding = mutation({
  args: {
    name: v.string(),
    tagline: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    brandTone: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    goal: v.string(),
    shopifyConnected: v.boolean(),
    setupDetails: v.any(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("unauthenticated");
    }

    // Find the draft created at start of onboarding
    const draftBrand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "draft"))
      .first();

    // Fallback: find any existing active brand (edge case: user re-onboards)
    const activeBrand = !draftBrand
      ? await ctx.db
          .query("brands")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .filter((q) => q.eq(q.field("status"), "active"))
          .first()
      : null;

    const targetBrand = draftBrand ?? activeBrand;

    if (targetBrand) {
      // Always patch - never insert a second brand row
      await ctx.db.patch(targetBrand._id, {
        ...args,
        status: "active",
        templatesStatus: "pending",
      });

      // Schedule first-run template generation in the background
      await ctx.scheduler.runAfter(
        0,
        internal.campaignTemplates.generateFirstRunTemplates,
        { brandId: targetBrand._id }
      );

      // Send welcome email
      await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendWelcomeEmail, {
        brandId: targetBrand._id,
      });

      return targetBrand._id;
    }

    // Absolute fallback: double-check no active brand exists before inserting
    const existingActive = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (existingActive) {
      // Race condition - another tab already completed. Patch the existing one.
      await ctx.db.patch(existingActive._id, {
        ...args,
        status: "active",
        templatesStatus: existingActive.templatesStatus ?? "pending",
      });
      return existingActive._id;
    }

    const brandId = await ctx.db.insert("brands", {
      ...args,
      userId,
      status: "active",
      templatesStatus: "pending",
    });

    await ctx.scheduler.runAfter(
      0,
      internal.campaignTemplates.generateFirstRunTemplates,
      { brandId }
    );

    // Send welcome email
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendWelcomeEmail, { brandId });

    return brandId;
  },
});

export const getBrandContext = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const brand = await ctx.db.get(args.brandId);
    if (!brand) return null;

    // Enrich with product count
    const products = await ctx.db
      .query("products")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    // Enrich with connected platforms
    const connections = await ctx.db
      .query("platformConnections")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    // Enrich with preferred ambassador
    let ambassadorInfo: { name: string; niche: string } | null = null;
    if (brand.preferredAmbassadorId) {
      const amb = await ctx.db.get(brand.preferredAmbassadorId);
      if (amb) ambassadorInfo = { name: amb.name, niche: amb.niche };
    }

    return {
      name: brand.name,
      tagline: brand.tagline,
      goal: brand.goal,
      brandTone: brand.brandTone,
      primaryColor: brand.primaryColor,
      secondaryColor: brand.secondaryColor,
      countryCode: brand.countryCode,
      setupDetails: brand.setupDetails,
      industry: brand.industry,
      description: brand.description,
      websiteUrl: brand.websiteUrl,
      preferredPlatforms: brand.preferredPlatforms,
      targetDemographics: brand.targetDemographics,
      templatesStatus: brand.templatesStatus,
      productCount: products.length,
      connectedPlatforms: connections.map(c => c.platform),
      ambassador: ambassadorInfo,
    };
  },
});

export const getThreadId = query({
  args: { brandId: v.id("brands"), userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("threads")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .filter((q) => q.eq(q.field("brandId"), args.brandId))
      .first();
  }
});

export const saveThreadId = mutation({
  args: { brandId: v.id("brands"), userId: v.string(), threadId: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.insert("threads", {
      brandId: args.brandId,
      userId: args.userId,
      threadId: args.threadId,
    });
  }
});

export const getDashboardSummary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // 1. Get Active Brand
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (!brand) return null;

    // 2. Get Integration Status (Shopify)
    const shopifyIntegration = await ctx.db
      .query("integrations")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("provider"), "shopify"))
      .first();

    const hasShopify = !!shopifyIntegration;
    const shopifySync = hasShopify ? {
      integrationId: shopifyIntegration._id,
      domain: shopifyIntegration.domain,
      status: shopifyIntegration.syncStatus || 'idle',
      count: shopifyIntegration.productCount || 0,
      lastSyncedAt: shopifyIntegration.lastSyncedAt
    } : null;

    // 3. Count Feature Records (Metrics) + Check for completed video generation
    // Promise.all for parallel counting
    const [
      campaigns,
      contentItems,
      emailSequences,
      landingPages,
      completedVideoTasks
    ] = await Promise.all([
      ctx.db.query("campaigns").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect(),
      ctx.db.query("contentItems").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect(),
      ctx.db.query("emailSequences").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect(),
      ctx.db.query("landingPages").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect(),
      ctx.db.query("agentTasks")
        .withIndex("by_brandId_agentType", q => q.eq("brandId", brand._id).eq("agentType", "video_generator"))
        .filter(q => q.eq(q.field("status"), "completed"))
        .collect()
    ]);

    const activeCampaigns = campaigns.filter(c => c.status === 'active' || c.status === 'scheduled' || c.status === 'generating');
    const stats = {
      campaignsCount: campaigns.length,
      activeCampaignsCount: activeCampaigns.length,
      generatedAssetsCount: completedVideoTasks.length,
      contentItemsCount: contentItems.length,
      emailFlowsCount: emailSequences.length,
      landingPagesCount: landingPages.length,
    };

    // 4. Calculate Setup Progress (0 - 100%)
    let progress = 0;
    const completenessChecks = [
      !!brand.name,
      !!brand.logoUrl,
      !!brand.primaryColor,
      !!brand.tagline,
      !!brand.brandTone,
      !!brand.goal,
      hasShopify
    ];
    
    // 14.28% per completed step
    progress = Math.round((completenessChecks.filter(Boolean).length / completenessChecks.length) * 100);

    // 5. Compute Recommended Action
    // All paths ultimately drive toward creating and launching campaigns.
    // The marketing focus (goal) personalizes the message, not the destination.

    const goal = brand.goal || 'campaign';
    const hasGeneratedVideo = completedVideoTasks.length > 0;
    const hasActiveCampaigns = stats.activeCampaignsCount > 0;

    let recommendedAction = {
      title: "Create Your First Campaign",
      description: "Launch an AI-powered marketing campaign for your brand in minutes.",
      icon: "campaign",
      route: "creator",
      button: "Start Campaign",
    };

    if (stats.campaignsCount === 0) {
      // No campaigns yet - tailor the pitch based on their marketing focus
      const focusMessages: Record<string, { title: string; description: string; icon: string }> = {
        campaign: {
          title: "Launch Your First Video Campaign",
          description: "Generate AI video ads for your products and publish to your connected socials.",
          icon: "movie_creation",
        },
        calendar: {
          title: "Create Your First Campaign",
          description: "Build a content campaign you can schedule across your social calendar.",
          icon: "calendar_month",
        },
        blog: {
          title: "Create Your First Campaign",
          description: "Start with a campaign to generate content that drives organic traffic.",
          icon: "edit_note",
        },
        email: {
          title: "Create Your First Campaign",
          description: "Build a campaign with assets you can repurpose across email sequences.",
          icon: "mail",
        },
      };
      const msg = focusMessages[goal] || focusMessages.campaign;
      recommendedAction = { ...msg, route: "creator", button: "Start Campaign" };
    } else if (hasActiveCampaigns) {
      // Has active campaigns - suggest checking on them
      recommendedAction = {
        title: "Check Your Active Campaigns",
        description: `You have ${stats.activeCampaignsCount} campaign${stats.activeCampaignsCount !== 1 ? "s" : ""} running. Review generated content and publishing status.`,
        icon: "campaign",
        route: "creator",
        button: "View Campaigns",
      };
    } else if (hasGeneratedVideo) {
      // Has generated content but no active campaigns - nudge to launch
      recommendedAction = {
        title: "Launch a Campaign",
        description: "You have generated content ready to go. Create a campaign to publish it.",
        icon: "rocket_launch",
        route: "creator",
        button: "Launch Campaign",
      };
    } else {
      // Has campaigns but none active (all completed/cancelled) - create another
      recommendedAction = {
        title: "Start a New Campaign",
        description: "Your previous campaigns are wrapped up. Launch a fresh one to keep growing.",
        icon: "add_circle",
        route: "creator",
        button: "New Campaign",
      };
    }

    // 6. Get Recommended Templates - weighted relevance sort
    let recommendedTemplates: any[] = [];
    try {
      const allTemplates = await ctx.db
        .query("campaignTemplates")
        .withIndex("by_isActive", (q) => q.eq("isActive", true))
        .collect();

      const now = Date.now();
      const thirtyDaysFromNow = now + 30 * 24 * 60 * 60 * 1000;

      const industryOrSeason = allTemplates.filter((template) => {
        const matchesIndustry = brand.industry
          ? template.industries.includes(brand.industry)
          : false;
        const matchesSeason = template.seasonalTrigger
          ? template.seasonalTrigger.activeFrom <= thirtyDaysFromNow &&
            template.seasonalTrigger.activeTo >= now
          : false;
        return matchesIndustry || matchesSeason;
      });

      const scoreTemplate = (t: typeof allTemplates[number]) => {
        const daysUntilEvent = t.seasonalTrigger
          ? (t.seasonalTrigger.activeFrom - now) / (24 * 60 * 60 * 1000)
          : Infinity;
        return (
          (daysUntilEvent <= 14 ? 1000 : 0) +
          (daysUntilEvent <= 28 ? 500 : 0) +
          (brand.industry && t.industries.includes(brand.industry) ? 200 : 0) +
          t.usageCount
        );
      };

      recommendedTemplates = industryOrSeason
        .sort((a, b) => scoreTemplate(b) - scoreTemplate(a))
        .slice(0, 3);
    } catch (e) {
      console.error("Error fetching recommended templates:", e);
    }

    // 6b. Brand-personalized templates - sorted by relevance (single source of truth in listBrandTemplates)
    let brandTemplates: any[] = [];
    try {
      brandTemplates = await ctx.db
        .query("brandCampaignTemplates")
        .withIndex("by_brandId_isActive", (q) => q.eq("brandId", brand._id).eq("isActive", true))
        .collect();
      // Note: full relevance scoring happens in listBrandTemplates query.
      // Dashboard uses this raw list for the carousel component which calls listBrandTemplates directly.
    } catch (e) {
      console.error("Error fetching brand templates:", e);
    }

    // 7. Return aggregated dashboard state
    return {
      brand: {
        id: brand._id,
        name: brand.name,
        goal: brand.goal,
        primaryColor: brand.primaryColor,
        logoUrl: brand.logoUrl,
      },
      stats,
      hasShopify,
      shopifySync,
      setupProgress: progress,
      recommendedAction,
      recentWorkstreams: campaigns.slice(0, 3),
      recommendedTemplates,
      brandTemplates,
      templatesStatus: brand.templatesStatus ?? null,
    };
  },
});

// ─── setTemplatesReady ───────────────────────────────────────────────────────
// Called by generateFirstRunTemplates action when generation completes.

export const setTemplatesReady = internalMutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.brandId, { templatesStatus: "ready" });
  },
});

// ─── setTemplatesFailed ──────────────────────────────────────────────────────
// Called by generateFirstRunTemplates action's catch block when the
// pipeline throws. Surfaces an explicit signal to the frontend so it
// can offer a retry instead of leaving the brand stuck at "pending".

export const setTemplatesFailed = internalMutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.brandId, { templatesStatus: "failed" });
  },
});

/**
 * Try to acquire the brand template generation lock.
 * Returns true if acquired, false if another run is already in progress.
 * Stale locks (> 10 min old) are treated as expired and stolen.
 */
export const tryAcquireTemplateLock = internalMutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const brand = await ctx.db.get(args.brandId);
    if (!brand) return false;

    const now = Date.now();
    const STALE_MS = 10 * 60 * 1000;
    const existing = brand.templatesGenerationLockedAt;

    if (existing && now - existing < STALE_MS) {
      return false; // Another run holds the lock
    }

    await ctx.db.patch(args.brandId, { templatesGenerationLockedAt: now });
    return true;
  },
});

export const releaseTemplateLock = internalMutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.brandId, { templatesGenerationLockedAt: undefined });
  },
});

// ─── getBrandByIdInternal ────────────────────────────────────────────────────
// Used by internalActions which cannot access ctx.db directly.

export const getBrandByIdInternal = internalQuery({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.brandId);
  },
});

// ─── scheduleTemplateGeneration ──────────────────────────────────────────────
// Called from the Dashboard for existing users who have no templates yet.
// Idempotent: no-ops if status is already pending or ready.

export const scheduleTemplateGeneration = mutation({
  args: { brandId: v.id("brands"), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) throw new Error("not authorized");

    // Already done - don't re-trigger unless the user explicitly retries a
    // ready-empty state from the template UI.
    if (brand.templatesStatus === "ready" && !args.force) {
      return;
    }

    await ctx.db.patch(args.brandId, { templatesStatus: "pending" });
    await ctx.scheduler.runAfter(
      0,
      internal.campaignTemplates.generateFirstRunTemplates,
      { brandId: args.brandId }
    );
  },
});

// ─── listAllActiveBrandsInternal ──────────────────────────────────────────────
// Used by cron jobs to iterate all active brands (no auth required).

export const listAllActiveBrandsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("brands")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();
  },
});

// ─── listDistinctIndustriesInternal ──────────────────────────────────────────
// Used by the weekly industry-trend cron to find which industries to research.

export const listDistinctIndustriesInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const brands = await ctx.db
      .query("brands")
      .filter((q) => q.eq(q.field("status"), "active"))
      .collect();

    const industries = new Set<string>();
    for (const brand of brands) {
      if (brand.industry) industries.add(brand.industry);
    }
    return Array.from(industries);
  },
});

// ─── analyzeToneFromImage ────────────────────────────────────────────────────
// Accepts a base64-encoded image and returns a brand tone description.
// Uses OpenRouter so the API key stays server-side.

export const analyzeToneFromImage = action({
  args: { imageBase64: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const billing = await ctx.runMutation(internal.billing.reserveSkuOperationInternal, {
      userId: String(userId),
      featureKey: "helper_ai",
      skuKey: "onboarding.brand_tone_image",
      units: 1,
      metadata: { source: "brand_tone_image" },
    });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "onboarding.brand_tone_image",
        reason: "OPENROUTER_API_KEY not configured",
      });
      return "Professional and approachable.";
    }

    try {
      // Strip data URI prefix if present - keep the full data URI for the SDK
      const base64Data = args.imageBase64.includes(",")
        ? args.imageBase64.split(",")[1]
        : args.imageBase64;

      const openrouter = createOpenRouter({ apiKey });
      const model = openrouter("openai/gpt-4o-mini");

      const result = await generateText({
        model,
        system:
          "You are an expert brand strategist and visual identity consultant. You analyze visual tone, mood, and brand personality from images. You distill what you see into concise, actionable brand voice descriptions that a copywriter could immediately use as a style guide. Return ONLY the brand voice description - no preamble, no bullet points, no explanation.",
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: base64Data },
              {
                type: "text",
                text: "Analyze the visual tone and brand mood of this image. Describe the brand's tone of voice and personality for marketing copy in under 30 words. Examples: 'Warm, approachable, and genuine. Speaks like a knowledgeable friend.' or 'Bold, unapologetic, and direct. Every word earns its place.'",
              },
            ],
          },
        ],
        // maxTokens: 100,
      });

      const text = result.text.trim();
      await ctx.runMutation(internal.billing.chargeReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "onboarding.brand_tone_image",
        reason: "Charged for brand tone analysis",
      });
      return text;
    } catch (error) {
      console.error("[analyzeToneFromImage] Error:", error);
      await ctx.runMutation(internal.billing.releaseReservationInternal, {
        reservationId: billing.reservationId,
        userId: String(userId),
        skuKey: "onboarding.brand_tone_image",
        reason: error instanceof Error ? error.message : "Brand tone analysis failed",
      });
      return "Modern, clean, and professional.";
    }
  },
});

// ─── extractAmbassadorPersonality ────────────────────────────────────────────
// Generates a 1-2 sentence personality string for a custom-generated AI
// ambassador by blending the avatar description with the brand's voice. Used
// downstream by scriptGenerator to drive how the ambassador "speaks". Falls
// back to brand tone (or a generic default) if the LLM call fails or
// OPENROUTER_API_KEY is missing.

export const extractAmbassadorPersonality = action({
  args: {
    description: v.string(),
    brandTone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.runQuery(internal.billing.assertAiAccessInternal, { userId: String(userId) });
    const fallback = args.brandTone?.trim() || "Professional & Approachable";
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return fallback;

    try {
      const openrouter = createOpenRouter({ apiKey });
      const model = openrouter("openai/gpt-4o-mini");

      const result = await generateText({
        model,
        system:
          "You are a brand strategist. You write concise, actionable ambassador personality strings that a script writer can use to control how a video presenter speaks, their energy, and their delivery style. Return ONLY the personality description - no preamble, no bullet points, no explanation.",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `A user is creating an AI brand ambassador. Combine the avatar description and brand tone into a single 1-2 sentence personality, under 30 words. Lead with 3-4 trait adjectives, then a short delivery hint.\n\nAvatar description: ${args.description}\nBrand tone: ${args.brandTone || "(not specified)"}\n\nExamples:\n- "Warm, grounded, and quietly confident. Speaks like a thoughtful friend who knows the craft."\n- "Bold, sharp, and unapologetic. Every line lands like a punch."`,
              },
            ],
          },
        ],
        // maxTokens: 100,
      });

      const text = result.text.trim();
      return text || fallback;
    } catch (error) {
      console.error("[extractAmbassadorPersonality] Error:", error);
      return fallback;
    }
  },
});


// admin brand schema
export const getAllBrands = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }
    const brands = await ctx.db
      .query("brands")
      .collect();

    return brands;
  },
});

// admin brand schema
export const createBrand = mutation({
  args: {
    name: v.string(),
    userId: v.id("users"),
    logoUrl: v.optional(v.string()),
    website: v.optional(v.string()),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const now = Date.now();

    return await ctx.db.insert("brands", {
      ...args,
      status: "active"
    });
  },
});

// admin brand schema
export const updateBrand = mutation({
  args: {
    brandId: v.id("brands"),
    name: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    website: v.optional(v.string()),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const { brandId, ...updates } = args;

    const brand = await ctx.db.get(brandId);
    if (!brand) {
      throw new Error("Brand not found.");
    }

    await ctx.db.patch(brandId, {
      ...updates,
      status: "active",
    });

    return brandId;
  },
});

// admin brand schema
export const deleteBrand = mutation({
  args: {
    brandId: v.id("brands"),
  },
  handler: async (ctx, args) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const brand = await ctx.db.get(args.brandId);
    if (!brand) {
      throw new Error("Brand not found.");
    }

    await ctx.db.delete(args.brandId);

    return args.brandId;
  },
});
