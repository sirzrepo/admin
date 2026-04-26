import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

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
    industry: v.optional(v.string()),
    targetDemographics: v.optional(v.object({
      ageRange: v.optional(v.string()),
      gender: v.optional(v.string()),
      interests: v.optional(v.array(v.string())),
    })),
    websiteUrl: v.optional(v.string()),
    preferredPlatforms: v.optional(v.array(v.string())),
    timezone: v.optional(v.string()),
    description: v.optional(v.string()),
    preferredAmbassadorId: v.optional(v.id("ambassadors")),
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
      // Always patch — never insert a second brand row
      await ctx.db.patch(targetBrand._id, {
        ...args,
        status: "active",
      });

      return targetBrand._id;
    }

    // Absolute fallback (should never happen): insert from scratch
    const brandId = await ctx.db.insert("brands", {
      ...args,
      userId,
      status: "active",
    });

    return brandId;
  },
});

export const getBrandContext = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const brand = await ctx.db.get(args.brandId);
    if (!brand) return null;
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
      targetDemographics: brand.targetDemographics,
      websiteUrl: brand.websiteUrl,
      preferredPlatforms: brand.preferredPlatforms,
      timezone: brand.timezone,
      description: brand.description,
      preferredAmbassadorId: brand.preferredAmbassadorId,
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

export const getAllBrands = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("unauthenticated");
    }

    // Check if user is admin
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") {
      throw new Error("unauthorized: only admins can access all brands");
    }

    // Get all brands regardless of user ownership and status
    const brands = await ctx.db
      .query("brands")
      .collect();

    return brands;
  },
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
      accessToken: shopifyIntegration.accessToken,
      domain: shopifyIntegration.domain,
      status: shopifyIntegration.syncStatus || 'idle',
      count: shopifyIntegration.productCount || 0,
      lastSyncedAt: shopifyIntegration.lastSyncedAt
    } : null;

    // 3. Count Feature Records (Metrics)
    // Promise.all for parallel counting
    const [
      campaigns,
      contentItems,
      emailSequences,
      landingPages
    ] = await Promise.all([
      ctx.db.query("campaigns").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect(),
      ctx.db.query("contentItems").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect(),
      ctx.db.query("emailSequences").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect(),
      ctx.db.query("landingPages").withIndex("by_brandId", q => q.eq("brandId", brand._id)).collect()
    ]);

    const stats = {
      campaignsCount: campaigns.length,
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
    let recommendedAction = {
      title: "Create Your First Campaign",
      description: "Start growing your brand by launching an AI-driven marketing campaign.",
      icon: "campaign",
      route: "campaigns",
      button: "Start Campaign"
    };

    const goal = brand.goal || 'ugc';

    if (stats.campaignsCount === 0) {
      if (goal === 'ugc') {
        recommendedAction = {
          title: "Generate Your First UGC Video",
          description: "Create a high-converting AI UGC video ad for your brand in minutes.",
          icon: "videocam",
          route: "studio",
          button: "Open Studio"
        };
      } else if (goal === 'calendar' || goal === 'blog') {
        recommendedAction = {
          title: "Plan Your First Content",
          description: "Your content planner is empty. Generate a week's worth of ideas with the Brand Agent.",
          icon: "edit_calendar",
          route: "planner",
          button: "Go to Planner"
        };
      } else if (goal === 'email') {
        recommendedAction = {
          title: "Set Up Welcome Sequence",
          description: "Don't let new subscribers slip away. Draft an automated welcome series.",
          icon: "mark_email_unread",
          route: "email",
          button: "Create Flow"
        };
      }
    } else if (stats.contentItemsCount === 0 && (goal === 'calendar' || goal === 'blog' || goal === 'ugc')) {
      recommendedAction = {
        title: "Create Assets for Your Campaign",
        description: "You have an active campaign, but no content. Let's generate some scripts or posts.",
        icon: "video_camera_front",
        route: "studio",
        button: "Open Studio"
      };
    } else if (stats.campaignsCount > 0) {
      // "All good" state
      recommendedAction = {
        title: "Review Campaign Performance",
        description: `You have ${stats.campaignsCount} active campaigns. Check in to see how they're performing across channels.`,
        icon: "trending_up",
        route: "campaigns",
        button: "View Metrics"
      };
    }

    // 6. Return aggregated dashboard state
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
      recentWorkstreams: campaigns.slice(0, 3) // Preview the 3 most recent campaigns
    };
  },
});

// Create a new brand (for brands management page)
export const createBrand = mutation({
  args: {
    name: v.string(),
    tagline: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    brandTone: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    industry: v.optional(v.string()),
    targetDemographics: v.optional(v.object({
      ageRange: v.optional(v.string()),
      gender: v.optional(v.string()),
      interests: v.optional(v.array(v.string())),
    })),
    websiteUrl: v.optional(v.string()),
    preferredPlatforms: v.optional(v.array(v.string())),
    timezone: v.optional(v.string()),
    description: v.optional(v.string()),
    preferredAmbassadorId: v.optional(v.id("ambassadors")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    // Create a new active brand
    const brandId = await ctx.db.insert("brands", {
      userId,
      name: args.name,
      tagline: args.tagline,
      primaryColor: args.primaryColor,
      secondaryColor: args.secondaryColor,
      brandTone: args.brandTone,
      logoUrl: args.logoUrl,
      coverImageUrl: args.coverImageUrl,
      industry: args.industry,
      targetDemographics: args.targetDemographics,
      websiteUrl: args.websiteUrl,
      preferredPlatforms: args.preferredPlatforms,
      timezone: args.timezone,
      description: args.description,
      preferredAmbassadorId: args.preferredAmbassadorId,
      status: "active",
    });

    return brandId;
  },
});

// Update an existing brand
export const updateBrand = mutation({
  args: {
    brandId: v.id("brands"),
    name: v.optional(v.string()),
    tagline: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    brandTone: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"))),
    industry: v.optional(v.string()),
    targetDemographics: v.optional(v.object({
      ageRange: v.optional(v.string()),
      gender: v.optional(v.string()),
      interests: v.optional(v.array(v.string())),
    })),
    websiteUrl: v.optional(v.string()),
    preferredPlatforms: v.optional(v.array(v.string())),
    timezone: v.optional(v.string()),
    description: v.optional(v.string()),
    preferredAmbassadorId: v.optional(v.id("ambassadors")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("unauthorized: you don't own this brand");
    }

    // Remove brandId from args before updating
    const { brandId: _, ...updateData } = args;

    await ctx.db.patch(args.brandId, updateData);
    return args.brandId;
  },
});

// Delete a brand
export const deleteBrand = mutation({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("unauthorized: you don't own this brand");
    }

    await ctx.db.delete(args.brandId);
    return args.brandId;
  },
});
