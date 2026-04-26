import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

export default defineSchema({
  ...authTables,

  // Users - extended from auth
  users: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phone: v.optional(v.string()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    role: v.optional(v.union(v.literal("admin"), v.literal("user"))),
  }).index("email", ["email"]),

  invites: defineTable({
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("expired")),
    token: v.string(),
    invitedBy: v.id("users"),
    invitedAt: v.number(),
    acceptedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  }).index("by_email", ["email"])
    .index("invitedBy", ["invitedBy"])
    .index("status", ["status"])
    .index("by_token_email", ["token", "email"]),

  // Third-party Integrations (e.g. Shopify, TikTok)
  integrations: defineTable({
    userId: v.id("users"),
    provider: v.string(), // "shopify"
    accessToken: v.string(),
    domain: v.optional(v.string()), // xyz.myshopify.com
    storeData: v.optional(v.any()), // Cached metadata from the provider
    syncStatus: v.optional(v.string()), // "idle" | "syncing" | "done" | "error"
    lastSyncedAt: v.optional(v.number()),
    productCount: v.optional(v.number()),
  }).index("by_userId", ["userId"])
    .index("by_provider", ["provider"]),

  // Synced Products (from Shopify)
  products: defineTable({
    brandId: v.id("brands"),
    shopifyProductId: v.string(),     // Shopify's GID (e.g. "gid://shopify/Product/123")
    title: v.string(),
    description: v.optional(v.string()),
    handle: v.string(),               // URL slug
    productType: v.optional(v.string()),
    vendor: v.optional(v.string()),
    status: v.string(),               // "ACTIVE", "DRAFT", "ARCHIVED"
    tags: v.array(v.string()),
    imageUrl: v.optional(v.string()), // Featured image
    priceRange: v.optional(v.object({
      minPrice: v.string(),
      maxPrice: v.string(),
      currencyCode: v.string(),
    })),
    variantCount: v.number(),
    stockCount: v.optional(v.number()),   // Total inventory across all variants
    category: v.optional(v.string()),     // Shopify standardized category name
    syncedAt: v.number(),             // Timestamp of last sync
  }).index("by_brandId", ["brandId"])
    .index("by_shopifyId", ["shopifyProductId"]),

  // Brand Identity (Onboarding State)
  brands: defineTable({
    userId: v.id("users"),
    name: v.string(),
    tagline: v.optional(v.string()),
    primaryColor: v.optional(v.string()),
    secondaryColor: v.optional(v.string()),
    brandTone: v.optional(v.string()), // Made optional since user can skip
    logoUrl: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    countryCode: v.optional(v.string()),
    goal: v.optional(v.string()), // e.g. "UGC Videos", "Content Calendar"
    shopifyConnected: v.optional(v.boolean()),
    setupDetails: v.optional(v.any()),
    status: v.optional(v.union(v.literal("draft"), v.literal("active"))),
    onboardingStep: v.optional(v.number()), // persists which step the user was on
    // Campaign-focused fields
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
    templatesStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"))),
    // Timestamp guard — prevents concurrent generateBrandTemplates runs for the same brand.
    // Set at the start of generation, cleared at the end. A stale lock (>10 min) is ignored.
    templatesGenerationLockedAt: v.optional(v.number()),
  }).index("by_userId", ["userId"]),

  // AI Agent Threads (allows user to have multiple conversations)
  threads: defineTable({
    userId: v.string(),
    brandId: v.id("brands"),
    threadId: v.optional(v.string()), // from @convex-dev/agent
  }).index("by_userId", ["userId"]).index("by_brandId", ["brandId"]),

  // Feature: Campaigns
  campaigns: defineTable({
    brandId: v.id("brands"),
    name: v.string(),
    description: v.optional(v.string()),
    campaignType: v.string(),
    templateId: v.optional(v.string()),
    brandTemplateId: v.optional(v.id("brandCampaignTemplates")),
    shareAsTemplate: v.optional(v.boolean()),
    products: v.array(v.object({
      name: v.string(),
      shopifyProductId: v.optional(v.id("products")),
      imageUrl: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      keyBenefit: v.optional(v.string()),
      problemSolved: v.optional(v.string()),
    })),
    ambassadorId: v.optional(v.id("ambassadors")),
    selectedTypes: v.array(v.string()),
    selectedAngles: v.array(v.object({
      id: v.string(),
      name: v.string(),
      hook: v.string(),
      scriptOutline: v.string(),
      format: v.union(v.literal("Product Ads"), v.literal("AI UGC Ads")),
    })),
    targetPlatforms: v.optional(v.array(v.string())),
    status: v.string(),
    progress: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    launchedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_brandId", ["brandId"])
    .index("by_brandId_status", ["brandId", "status"])
    .index("by_status", ["status"]),

  // Feature: Campaign Templates
 campaignTemplates: defineTable({
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
    usageCount: v.number(),
    source: v.string(),
    isActive: v.boolean(),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_isActive", ["isActive"]),

brandCampaignTemplates: defineTable({
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
    category: v.optional(v.string()), // "industry" | "seasonal" | "evergreen" | "trending"
    seasonalTrigger: v.optional(v.object({
      type: v.string(),
      name: v.string(),
      activeFrom: v.number(),
      activeTo: v.number(),
    })),
    isActive: v.boolean(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_brandId", ["brandId"])
    .index("by_baseTemplateId", ["baseTemplateId"])
    .index("by_brandId_isActive", ["brandId", "isActive"]),

    // Platform Connections - social media platform OAuth connections
  platformConnections: defineTable({
    brandId: v.id("brands"),
    platform: v.string(),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    accountId: v.string(),
    accountName: v.string(),
    accountAvatarUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    isActive: v.boolean(),
    connectedAt: v.number(),
  })
    .index("by_brandId", ["brandId"])
    .index("by_brandId_platform", ["brandId", "platform"]),

  // Scheduled Posts - campaign post scheduling
  scheduledPosts: defineTable({
    campaignId: v.id("campaigns"),
    brandId: v.id("brands"),
    taskId: v.optional(v.id("agentTasks")),
    angleId: v.optional(v.string()),
    platform: v.string(),
    assetUrl: v.string(),
    caption: v.string(),
    scheduledAt: v.number(),
    postedAt: v.optional(v.number()),
    status: v.string(),
    tiktokSettings: v.optional(v.object({
      privacyLevel: v.optional(v.string()),
      disableComment: v.optional(v.boolean()),
      disableDuet: v.optional(v.boolean()),
      disableStitch: v.optional(v.boolean()),
      coverTimestampMs: v.optional(v.number()),
    })),
    platformPostId: v.optional(v.string()),
    error: v.optional(v.string()),
    analytics: v.optional(v.object({
      views: v.number(),
      likes: v.number(),
      comments: v.number(),
      shares: v.number(),
      lastSyncedAt: v.number(),
    })),
    createdAt: v.number(),
  })
    .index("by_campaignId", ["campaignId"])
    .index("by_brandId", ["brandId"])
    .index("by_status_scheduledAt", ["status", "scheduledAt"]),

  // Feature: Content Planner
  contentItems: defineTable({
    brandId: v.id("brands"),
    title: v.string(),
    caption: v.optional(v.string()),
    date: v.string(),
    platforms: v.array(v.string()),
    status: v.string(),
    type: v.string(),
    mediaUrl: v.optional(v.string()),
  }).index("by_brandId", ["brandId"]),

  // Feature: Email Automation
  emailSequences: defineTable({
    brandId: v.id("brands"),
    name: v.string(),
    status: v.string(),
    trigger: v.string(),
    steps: v.array(v.any()),
    linkedCampaignId: v.optional(v.id("campaigns")),
  }).index("by_brandId", ["brandId"]),

  // Feature: Landing Pages
  landingPages: defineTable({
    brandId: v.id("brands"),
    name: v.string(),
    status: v.string(),
    sections: v.array(v.any()),
    conversionRate: v.number(),
  }).index("by_brandId", ["brandId"]),

  // Feature: Ambassadors
  ambassadors: defineTable({
    brandId: v.id("brands"),
    name: v.string(),
    category: v.string(),
    niche: v.string(),
    personality: v.string(),
    type: v.string(),
    imageUrl: v.optional(v.string()),
    sampleHook: v.optional(v.string()),
    isActive: v.boolean(),
    generationTaskId: v.optional(v.id("agentTasks")),
    createdAt: v.number(),
  }).index("by_brandId", ["brandId"])
    .index("by_generationTaskId", ["generationTaskId"]),

  // Specialized Agent Tasks — tracks all async AI generation jobs
  // Shared across Brand Agent and all tab UIs for cross-context awareness
  agentTasks: defineTable({
    brandId: v.id("brands"),
    userId: v.string(),
    // The specialized agent type: "character_designer" | "image_generator" | "video_generator" etc.
    agentType: v.string(),
    // Human-readable label shown in UI and used by Brand Agent to describe the task
    label: v.string(),
    // "pending" | "running" | "completed" | "failed"
    status: v.string(),
    // The structured input that was passed to the agent (typed per agent)
    input: v.any(),
    // The structured output returned by the agent (null until completed)
    output: v.optional(v.any()),
    // Error message if the task failed
    error: v.optional(v.string()),
    // Which surface initiated the task: "creative_studio" | "campaigns" | "brand_agent" | "planner" etc.
    initiatedFrom: v.string(),
    // fal.ai request ID — used to match incoming webhook callbacks to the right task row
    falRequestId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brandId", ["brandId"])
    .index("by_brandId_status", ["brandId", "status"])
    .index("by_brandId_agentType", ["brandId", "agentType"])
    .index("by_falRequestId", ["falRequestId"]),

    // Tone Presets - admin-manageable voice presets for brand tone step
  tonePresets: defineTable({
    label: v.string(),     // e.g. "Bold"
    value: v.string(),     // e.g. "Direct, confident, and unapologetic. We say what we mean..."
    order: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_isActive", ["isActive"]),

  // Notifications - for in-app notifications when tasks complete
  notifications: defineTable({
    userId: v.string(),
      brandId: v.id("brands"),
      type: v.string(), // "task_completed" | "task_failed" | etc.
      title: v.string(),
      message: v.string(),
      taskId: v.optional(v.id("agentTasks")),
      link: v.optional(v.string()), // optional link to navigate to
      read: v.boolean(),
      createdAt: v.number(),
    })
      .index("by_userId", ["userId"])
      .index("by_userId_read", ["userId", "read"])
      .index("by_brandId", ["brandId"]),
});



