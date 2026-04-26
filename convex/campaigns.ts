import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Get all campaigns for the current user's brands
export const getCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    // Get user's brands
    const brands = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    // Get campaigns for all user's brands
    const campaigns = [];
    for (const brand of brands) {
      const brandCampaigns = await ctx.db
        .query("campaigns")
        .withIndex("by_brandId", (q) => q.eq("brandId", brand._id))
        .collect();
      campaigns.push(...brandCampaigns);
    }

    return campaigns.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get a single campaign by ID
export const getCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;

    // Verify user owns this campaign's brand
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) return null;

    return campaign;
  },
});

// Create a new campaign
export const createCampaign = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    brandId: v.id("brands"),
    campaignType: v.string(),
    templateId: v.optional(v.string()),
    brandTemplateId: v.optional(v.id("brandCampaignTemplates")),
    shareAsTemplate: v.optional(v.boolean()),
    products: v.optional(v.array(v.object({
      name: v.string(),
      shopifyProductId: v.optional(v.id("products")),
      imageUrl: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      keyBenefit: v.optional(v.string()),
      problemSolved: v.optional(v.string()),
    }))),
    ambassadorId: v.optional(v.id("ambassadors")),
    selectedTypes: v.optional(v.array(v.string())),
    selectedAngles: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      hook: v.string(),
      scriptOutline: v.string(),
      format: v.union(v.literal("Product Ads"), v.literal("AI UGC Ads")),
    }))),
    targetPlatforms: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to create campaigns for this brand");
    }

    const campaignId = await ctx.db.insert("campaigns", {
      name: args.name,
      description: args.description,
      brandId: args.brandId,
      campaignType: args.campaignType,
      templateId: args.templateId,
      brandTemplateId: args.brandTemplateId,
      shareAsTemplate: args.shareAsTemplate,
      products: args.products || [],
      ambassadorId: args.ambassadorId,
      selectedTypes: args.selectedTypes || [],
      selectedAngles: args.selectedAngles || [],
      targetPlatforms: args.targetPlatforms,
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return campaignId;
  },
});

// Update campaign
export const updateCampaign = mutation({
  args: {
    campaignId: v.id("campaigns"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    progress: v.optional(v.number()),
    templateId: v.optional(v.string()),
    brandTemplateId: v.optional(v.id("brandCampaignTemplates")),
    shareAsTemplate: v.optional(v.boolean()),
    products: v.optional(v.array(v.object({
      name: v.string(),
      shopifyProductId: v.optional(v.id("products")),
      imageUrl: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      keyBenefit: v.optional(v.string()),
      problemSolved: v.optional(v.string()),
    }))),
    ambassadorId: v.optional(v.id("ambassadors")),
    selectedTypes: v.optional(v.array(v.string())),
    selectedAngles: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      hook: v.string(),
      scriptOutline: v.string(),
      format: v.union(v.literal("Product Ads"), v.literal("AI UGC Ads")),
    }))),
    targetPlatforms: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("Campaign not found");

    // Verify user owns this campaign's brand
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to update this campaign");
    }

    const updateData: any = { updatedAt: Date.now() };
    if (args.name !== undefined) updateData.name = args.name;
    if (args.description !== undefined) updateData.description = args.description;
    if (args.status !== undefined) updateData.status = args.status;
    if (args.progress !== undefined) updateData.progress = args.progress;
    if (args.templateId !== undefined) updateData.templateId = args.templateId;
    if (args.brandTemplateId !== undefined) updateData.brandTemplateId = args.brandTemplateId;
    if (args.shareAsTemplate !== undefined) updateData.shareAsTemplate = args.shareAsTemplate;
    if (args.products !== undefined) updateData.products = args.products;
    if (args.ambassadorId !== undefined) updateData.ambassadorId = args.ambassadorId;
    if (args.selectedTypes !== undefined) updateData.selectedTypes = args.selectedTypes;
    if (args.selectedAngles !== undefined) updateData.selectedAngles = args.selectedAngles;
    if (args.targetPlatforms !== undefined) updateData.targetPlatforms = args.targetPlatforms;
    
    // Set timestamps based on status changes
    if (args.status === "launched" && campaign.status !== "launched") {
      updateData.launchedAt = Date.now();
    }
    if (args.status === "completed" && campaign.status !== "completed") {
      updateData.completedAt = Date.now();
    }

    await ctx.db.patch(args.campaignId, updateData);
    return args.campaignId;
  },
});

// Get all campaigns (admin only)
export const getAllCampaigns = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("unauthenticated");
    }

    // Check if user is admin
    const user = await ctx.db.get(userId);
    if (!user || user.role !== "admin") {
      throw new Error("unauthorized: only admins can access all campaigns");
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

// Delete campaign
export const deleteCampaign = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) throw new Error("Campaign not found");

    // Verify user owns this campaign's brand
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to delete this campaign");
    }

    await ctx.db.delete(args.campaignId);
    return args.campaignId;
  },
});
