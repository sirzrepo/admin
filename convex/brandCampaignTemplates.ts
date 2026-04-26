import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// Get brand campaign templates
export const getBrandCampaignTemplates = query({
  args: {
    brandId: v.id("brands"),
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let templates;
    
    if (args.activeOnly === true) {
      templates = await ctx.db
        .query("brandCampaignTemplates")
        .withIndex("by_brandId_isActive", (q) => 
          q.eq("brandId", args.brandId).eq("isActive", true)
        )
        .collect();
    } else {
      templates = await ctx.db
        .query("brandCampaignTemplates")
        .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
        .collect();
    }

    // Filter out expired templates
    const now = Date.now();
    templates = templates.filter(t => t.expiresAt > now);

    return templates.sort((a, b) => b.createdAt - a.createdAt);
  },
});

// Get a single brand campaign template by ID
export const getBrandCampaignTemplate = query({
  args: { templateId: v.id("brandCampaignTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    return template;
  },
});

// Create a new brand campaign template
export const createBrandCampaignTemplate = mutation({
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
    }),
    coverImageUrl: v.optional(v.string()),
    category: v.optional(v.string()),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    isActive: v.boolean(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to create templates for this brand");
    }

    // Verify base template exists and is active
    const baseTemplate = await ctx.db.get(args.baseTemplateId);
    if (!baseTemplate || !baseTemplate.isActive) {
      throw new Error("Base template not found or inactive");
    }

    const templateId = await ctx.db.insert("brandCampaignTemplates", {
      brandId: args.brandId,
      baseTemplateId: args.baseTemplateId,
      name: args.name,
      description: args.description,
      personalizedHooks: args.personalizedHooks,
      prefillData: args.prefillData,
      coverImageUrl: args.coverImageUrl,
      category: args.category,
      seasonalTrigger: args.seasonalTrigger,
      isActive: args.isActive,
      expiresAt: args.expiresAt,
      createdAt: Date.now(),
    });

    return templateId;
  },
});

// Update brand campaign template
export const updateBrandCampaignTemplate = mutation({
  args: {
    templateId: v.id("brandCampaignTemplates"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    personalizedHooks: v.optional(v.array(v.string())),
    prefillData: v.optional(v.object({
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
    })),
    coverImageUrl: v.optional(v.string()),
    category: v.optional(v.string()),
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    isActive: v.optional(v.boolean()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(template.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to update this template");
    }

    const updateData: any = {};
    if (args.name !== undefined) updateData.name = args.name;
    if (args.description !== undefined) updateData.description = args.description;
    if (args.personalizedHooks !== undefined) updateData.personalizedHooks = args.personalizedHooks;
    if (args.prefillData !== undefined) updateData.prefillData = args.prefillData;
    if (args.coverImageUrl !== undefined) updateData.coverImageUrl = args.coverImageUrl;
    if (args.category !== undefined) updateData.category = args.category;
    if (args.seasonalTrigger !== undefined) updateData.seasonalTrigger = args.seasonalTrigger;
    if (args.isActive !== undefined) updateData.isActive = args.isActive;
    if (args.expiresAt !== undefined) updateData.expiresAt = args.expiresAt;

    await ctx.db.patch(args.templateId, updateData);
    return args.templateId;
  },
});

// Delete brand campaign template
export const deleteBrandCampaignTemplate = mutation({
  args: { templateId: v.id("brandCampaignTemplates") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    // Verify user owns the brand
    const brand = await ctx.db.get(template.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to delete this template");
    }

    await ctx.db.delete(args.templateId);
    return args.templateId;
  },
});

// Create campaign from brand template
export const createCampaignFromBrandTemplate = mutation({
  args: {
    templateId: v.id("brandCampaignTemplates"),
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Get the brand template
    const template = await ctx.db.get(args.templateId);
    if (!template || !template.isActive) {
      throw new Error("Template not found or inactive");
    }

    // Verify user owns the brand
    const brand = await ctx.db.get(template.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to create campaigns from this template");
    }

    // Check if template is expired
    if (template.expiresAt && template.expiresAt < Date.now()) {
      throw new Error("Template has expired");
    }

    // Create campaign from brand template
    const campaignId = await ctx.db.insert("campaigns", {
      name: args.customName || template.name,
      description: template.description,
      brandId: template.brandId,
      campaignType: "brandTemplate",
      templateId: args.templateId,
      products: args.selectedProducts || [],
      selectedTypes: template.prefillData.suggestedTypes,
      selectedAngles: template.prefillData.suggestedAngles,
      status: "draft",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return campaignId;
  },
});
