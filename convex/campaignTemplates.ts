import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { Id } from "./_generated/dataModel";

// Get all campaign templates
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

// Get a single campaign template by ID
export const getCampaignTemplate = query({
  args: { templateId: v.id("campaignTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    return template;
  },
});

// Increment template usage count
export const incrementTemplateUsage = mutation({
  args: { templateId: v.id("campaignTemplates") },
  handler: async (ctx, args) => {
    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    await ctx.db.patch(args.templateId, { 
      usageCount: template.usageCount + 1 
    });

    return template.usageCount + 1;
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin (you might want to add role checking)
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to create campaign templates");
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify user owns the brand
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) {
      throw new Error("Not authorized to create campaigns for this brand");
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to update campaign templates");
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
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Check if user is admin
    const user = await ctx.db.get(userId as Id<"users">);
    if (!user || user.role !== "admin") {
      throw new Error("Not authorized to delete campaign templates");
    }

    const template = await ctx.db.get(args.templateId);
    if (!template) throw new Error("Template not found");

    await ctx.db.delete(args.templateId);
    return args.templateId;
  },
});