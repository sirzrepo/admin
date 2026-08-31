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
    // Set at signup when the user agrees to Terms of Service + Privacy Policy.
    // termsVersion lets us re-prompt if the policy materially changes.
    termsAcceptedAt: v.optional(v.number()),
    termsVersion: v.optional(v.string()),
  }).index("email", ["email"]),

  // Third-party Integrations (e.g. Shopify, TikTok)
  integrations: defineTable({
    userId: v.id("users"),
    provider: v.string(), // "shopify"
    accessToken: v.string(),
    refreshToken: v.optional(v.string()), // Shopify expiring offline tokens (post-April 2026 apps)
    accessTokenExpiresAt: v.optional(v.number()), // ms timestamp; null/undefined => non-expiring legacy token
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
    shopifyProductId: v.optional(v.string()), // Shopify's GID (e.g. "gid://shopify/Product/123"); null for manually entered products
    source: v.optional(v.string()),   // "shopify" | "manual"
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
    .index("by_shopifyId", ["shopifyProductId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["brandId"],
    }),

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
    // Free-text target audience description captured on Step 5 (Campaign
    // Defaults). Used by AI content generation alongside `targetDemographics`
    // for richer audience signal (age, lifestyle, values).
    targetAudience: v.optional(v.string()),
    // Brand-guide upload (manual onboarding 2c flow). Persists the R2 URL of
    // the uploaded document and a flag indicating the AI extractor has run.
    // The flag also drives the "AI Generated" badge + banner on the Review
    // screen so users see provenance for the auto-filled fields.
    brandGuideUrl: v.optional(v.string()),
    brandGuideAnalyzed: v.optional(v.boolean()),
    preferredPlatforms: v.optional(v.array(v.string())),
    // Email-marketing audience segments selected during onboarding's email
    // sub-flow. Stored as an array of lowercase IDs from the in-app
    // AUDIENCE_SEGMENTS constant (e.g., "new_subscribers", "repeat_buyers").
    audienceSegments: v.optional(v.array(v.string())),
    timezone: v.optional(v.string()),
    description: v.optional(v.string()),
    preferredAmbassadorId: v.optional(v.id("ambassadors")),
    // `failed` is set by generateFirstRunTemplates when its action throws.
    // Frontend treats `failed` exactly like `ready-with-empty-templates` - a
    // single "Try again" affordance re-fires the mutation. v1's Dashboard
    // auto-trigger reads this as "not ready" and retries on mount, so
    // adding this literal is backwards-compatible.
    templatesStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
    // Timestamp guard - prevents concurrent generateBrandTemplates runs for the same brand.
    // Set at the start of generation, cleared at the end. A stale lock (>10 min) is ignored.
    templatesGenerationLockedAt: v.optional(v.number()),
    logoWatermarkDefaults: v.optional(v.object({
      enabled: v.optional(v.boolean()),
      opacityPercent: v.optional(v.number()),
      position: v.optional(v.string()),
      sizePercent: v.optional(v.number()),
    })),
  }).index("by_userId", ["userId"]),

  // AI Ambassadors - both preset and custom
  ambassadors: defineTable({
    name: v.string(),
    imageUrl: v.string(),
    personality: v.string(),
    niche: v.string(),
    category: v.string(),
    sampleHook: v.string(),
    type: v.string(), // "preset" | "custom"
    brandId: v.optional(v.id("brands")),
    generationTaskId: v.optional(v.id("agentTasks")),
    isActive: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_type", ["type"])
    .index("by_brandId", ["brandId"])
    .index("by_category", ["category"]),

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
      // Free-text price entered by user or copied from Shopify priceRange.
      // String not number so we preserve currency formatting like "$24.99".
      price: v.optional(v.string()),
      targetAudience: v.optional(v.string()),
      keyBenefit: v.optional(v.string()),
      problemSolved: v.optional(v.string()),
    })),
    // High-level campaign goal selected in the wizard. Drives AI tone +
    // surfaces in the launch summary. v1 didn't capture this; v2 does.
    // One of: "awareness" | "conversion" | "retention". Optional so v1
    // campaigns without it stay valid.
    goal: v.optional(v.string()),
    ambassadorId: v.optional(v.id("ambassadors")),
    selectedTypes: v.array(v.string()),
    selectedAngles: v.array(v.object({
      id: v.string(),
      name: v.string(),
      hook: v.string(),
      scriptOutline: v.string(),
      format: v.union(v.literal("Product Ads"), v.literal("AI UGC Ads")),
      // Optional pre-existing agent task whose output is used as this
      // angle's video instead of generating a fresh one. When set, the
      // campaign pipeline skips video_generator dispatch for this angle
      // and synthesizes an attached_video task row pointing at the
      // source task's URL.
      attachedAssetTaskId: v.optional(v.id("agentTasks")),
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

  // Campaign Templates - intelligent, personalized templates for campaign creation
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
    // AI-picked campaign goal for this template - cascades to every brand
    // template generated from it (see brandCampaignTemplates.prefillData).
    // One of: "awareness" | "conversion" | "retention". Optional so legacy
    // templates without it stay valid.
    suggestedGoal: v.optional(v.string()),
    sampleHooks: v.optional(v.array(v.string())),
    usageCount: v.number(),
    source: v.string(),
    isActive: v.boolean(),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_isActive", ["isActive"]),

  // Brand Campaign Templates - per-brand personalized versions of base templates
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
      // Pulled from the linked product's priceRange.minPrice at generation
      // time so the wizard can prefill it without re-querying products.
      // Formatted "$24.99" etc., kept as a string to preserve currency.
      productPrice: v.optional(v.string()),
      // Inherited from the base template's suggestedGoal at brand-template
      // personalization time so the wizard can prefill the Goal radio.
      // One of: "awareness" | "conversion" | "retention".
      suggestedGoal: v.optional(v.string()),
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
    // Comma-separated list of scopes granted at OAuth time. Used to detect
    // when an existing connection predates a scope addition (e.g. video.list
    // for analytics) and the merchant needs to reconnect.
    grantedScopes: v.optional(v.string()),
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
    mediaType: v.optional(v.string()),
    caption: v.string(),
    scheduledAt: v.number(),
    postedAt: v.optional(v.number()),
    status: v.string(),
    tiktokSettings: v.optional(v.object({
      privacyLevel: v.optional(v.union(
        v.literal("PUBLIC_TO_EVERYONE"),
        v.literal("MUTUAL_FOLLOW_FRIENDS"),
        v.literal("FOLLOWER_OF_CREATOR"),
        v.literal("SELF_ONLY"),
      )),
      disableComment: v.optional(v.boolean()),
      disableDuet: v.optional(v.boolean()),
      disableStitch: v.optional(v.boolean()),
      contentDisclosureEnabled: v.optional(v.boolean()),
      brandOrganicToggle: v.optional(v.boolean()),
      brandContentToggle: v.optional(v.boolean()),
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
    analyticsFailureCount: v.optional(v.number()),
    analyticsTrackingEndsAt: v.optional(v.number()),
    nextAnalyticsSyncAt: v.optional(v.number()),
    analyticsDisabledReason: v.optional(v.string()),
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
    mediaType: v.optional(v.string()),
    assetTaskId: v.optional(v.id("agentTasks")),
    assetName: v.optional(v.string()),
    tiktokSettings: v.optional(v.object({
      privacyLevel: v.optional(v.union(
        v.literal("PUBLIC_TO_EVERYONE"),
        v.literal("MUTUAL_FOLLOW_FRIENDS"),
        v.literal("FOLLOWER_OF_CREATOR"),
        v.literal("SELF_ONLY"),
      )),
      disableComment: v.optional(v.boolean()),
      disableDuet: v.optional(v.boolean()),
      disableStitch: v.optional(v.boolean()),
      contentDisclosureEnabled: v.optional(v.boolean()),
      brandOrganicToggle: v.optional(v.boolean()),
      brandContentToggle: v.optional(v.boolean()),
      coverTimestampMs: v.optional(v.number()),
    })),
    scheduledAt: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    platformPostId: v.optional(v.string()),
    error: v.optional(v.string()),
    source: v.optional(v.string()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
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

  // Specialized Agent Tasks - tracks all async AI generation jobs
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
    // Coarse failure category for UI messaging + retry decisioning. One of:
    // "out_of_credits" | "model_error" | "timeout" | "rate_limited" |
    // "invalid_input" | "unknown". Set alongside `error` when classifiable.
    errorKind: v.optional(v.string()),
    // Which surface initiated the task: "creative_studio" | "campaigns" | "brand_agent" | "planner" etc.
    initiatedFrom: v.string(),
    // fal.ai request ID - used to match incoming webhook callbacks to the right task row
    falRequestId: v.optional(v.string()),
    // Thread ID for Copilot chat notifications (set when initiated from brand_agent)
    threadId: v.optional(v.string()),
    // Campaign linkage for campaign-generated tasks
    campaignId: v.optional(v.id("campaigns")),
    angleId: v.optional(v.string()),
    // Billing/credit metadata. These are optional so historical tasks stay
    // valid and manual uploads remain no-credit records.
    reservationId: v.optional(v.id("creditReservations")),
    skuKey: v.optional(v.string()),
    creditSource: v.optional(v.string()),
    creditsPriced: v.optional(v.number()),
    creditsChargedToCustomer: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_brandId", ["brandId"])
    .index("by_brandId_status", ["brandId", "status"])
    .index("by_brandId_agentType", ["brandId", "agentType"])
    .index("by_falRequestId", ["falRequestId"])
    .index("by_campaignId", ["campaignId"]),

  // Billing: configurable plan definitions. Seeded from billingConfig.ts
  // first, then editable by admin UI later.
  billingPlans: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    priceMonthlyCents: v.number(),
    currency: v.string(),
    includedCredits: v.number(),
    lowCreditThreshold: v.optional(v.number()),
    maxBrands: v.number(),
    maxSeats: v.number(),
    features: v.any(),
    limits: v.any(),
    stripePriceId: v.optional(v.string()),
    isActive: v.boolean(),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_isActive", ["isActive"]),

  billingSettings: defineTable({
    key: v.string(),
    trialDurationDays: v.number(),
    trialCredits: v.number(),
    trialLowCreditThreshold: v.optional(v.number()),
    trialTemplateLimit: v.optional(v.number()),
    trialTemplateRefreshEnabled: v.optional(v.boolean()),
    trialTemplateRefreshDays: v.optional(v.number()),
    trialTemplateAiCovers: v.optional(v.boolean()),
    templateBasePoolEvergreenTarget: v.optional(v.number()),
    templateBasePoolSeasonalEvergreenTarget: v.optional(v.number()),
    templateBasePoolSeasonalEventTarget: v.optional(v.number()),
    // Legacy names retained only so existing dev/staging rows stay readable.
    templateBasePoolTrendingTarget: v.optional(v.number()),
    templateBasePoolSeasonalTrendingTarget: v.optional(v.number()),
    templateBasePoolSeasonalTarget: v.optional(v.number()),
    creditPurchaseInvoicePolicy: v.optional(v.union(
      v.literal("receipt_only"),
      v.literal("always"),
      v.literal("on_request"),
    )),
    requirePaymentMethodForTrial: v.boolean(),
    allowTopUpsDuringTrial: v.boolean(),
    oneTrialPerAccount: v.boolean(),
    defaultCreditValueCents: v.number(),
    defaultMarkup: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  subscriptions: defineTable({
    userId: v.string(),
    planKey: v.string(),
    planVersion: v.number(),
    status: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    trialStartedAt: v.optional(v.number()),
    trialEndsAt: v.optional(v.number()),
    trialCreditsGranted: v.optional(v.number()),
    manualTrialActivationAt: v.optional(v.number()),
    convertedAt: v.optional(v.number()),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    subscriptionState: v.optional(v.string()),
    previousPlanKey: v.optional(v.string()),
    pendingPlanKey: v.optional(v.string()),
    pendingUpgradeCredits: v.optional(v.number()),
    pendingPlanChangedAt: v.optional(v.number()),
    pendingPlanEffectiveAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"])
    .index("by_stripeSubscriptionId", ["stripeSubscriptionId"]),

  creditAccounts: defineTable({
    userId: v.string(),
    availableCredits: v.number(),
    reservedCredits: v.number(),
    lifetimePurchasedCredits: v.number(),
    lifetimeGrantedCredits: v.number(),
    lifetimeConsumedCredits: v.number(),
    currentPeriodGrantedCredits: v.number(),
    planKey: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  creditTopUpPackages: defineTable({
    key: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    credits: v.number(),
    priceCents: v.number(),
    currency: v.string(),
    expiresAfterDays: v.optional(v.number()),
    stripePriceId: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_isActive", ["isActive"]),

  stripeCheckoutSessions: defineTable({
    userId: v.string(),
    mode: v.string(),
    status: v.string(),
    stripeSessionId: v.string(),
    stripeCustomerId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
    planKey: v.optional(v.string()),
    packageKey: v.optional(v.string()),
    credits: v.optional(v.number()),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    url: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_stripeSessionId", ["stripeSessionId"])
    .index("by_stripeCustomerId", ["stripeCustomerId"]),

  billingWebhookEvents: defineTable({
    stripeEventId: v.string(),
    type: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    processedAt: v.optional(v.number()),
  }).index("by_stripeEventId", ["stripeEventId"]),

  billingTransactions: defineTable({
    key: v.string(),
    userId: v.string(),
    type: v.string(),
    status: v.string(),
    title: v.string(),
    amountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    credits: v.optional(v.number()),
    stripeCustomerId: v.optional(v.string()),
    stripeSessionId: v.optional(v.string()),
    stripeInvoiceId: v.optional(v.string()),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    receiptUrl: v.optional(v.string()),
    invoiceUrl: v.optional(v.string()),
    metadata: v.optional(v.any()),
    occurredAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_userId_occurredAt", ["userId", "occurredAt"]),

  emailDeliveries: defineTable({
    key: v.string(),
    userId: v.string(),
    type: v.string(),
    recipient: v.string(),
    status: v.string(),
    attempts: v.number(),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
    sentAt: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_userId", ["userId"]),

  creditLedger: defineTable({
    userId: v.string(),
    brandId: v.optional(v.id("brands")),
    campaignId: v.optional(v.id("campaigns")),
    taskId: v.optional(v.id("agentTasks")),
    reservationId: v.optional(v.id("creditReservations")),
    type: v.string(),
    amount: v.number(),
    balanceAfter: v.optional(v.number()),
    skuKey: v.optional(v.string()),
    creditSource: v.optional(v.string()),
    reason: v.string(),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    createdBy: v.optional(v.string()),
  })
    .index("by_userId", ["userId"])
    .index("by_brandId", ["brandId"])
    .index("by_taskId", ["taskId"])
    .index("by_reservationId", ["reservationId"]),

  creditReservations: defineTable({
    userId: v.string(),
    brandId: v.optional(v.id("brands")),
    campaignId: v.optional(v.id("campaigns")),
    taskId: v.optional(v.id("agentTasks")),
    status: v.string(),
    estimatedCredits: v.number(),
    chargedCredits: v.number(),
    releasedCredits: v.number(),
    featureKey: v.string(),
    skuBreakdown: v.any(),
    creditSource: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_userId_status", ["userId", "status"])
    .index("by_campaignId", ["campaignId"])
    .index("by_taskId", ["taskId"]),

  aiSkus: defineTable({
    key: v.string(),
    label: v.string(),
    provider: v.string(),
    model: v.string(),
    unitType: v.string(),
    providerCostPerUnitCents: v.number(),
    creditValueOverrideCents: v.optional(v.number()),
    markupOverride: v.optional(v.number()),
    defaultCreditSource: v.string(),
    isActive: v.boolean(),
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_isActive", ["isActive"]),

  generationThrottleBuckets: defineTable({
    userId: v.string(),
    featureKey: v.string(),
    windowStartedAt: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  }).index("by_user_feature", ["userId", "featureKey"]),

  aiUsageEvents: defineTable({
    userId: v.optional(v.string()),
    brandId: v.optional(v.id("brands")),
    taskId: v.optional(v.id("agentTasks")),
    campaignId: v.optional(v.id("campaigns")),
    featureKey: v.string(),
    skuKey: v.string(),
    provider: v.string(),
    model: v.string(),
    units: v.number(),
    estimatedProviderCostCents: v.number(),
    creditsPriced: v.number(),
    creditsChargedToCustomer: v.number(),
    creditSource: v.string(),
    status: v.string(),
    providerRequestId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_brandId", ["brandId"])
    .index("by_taskId", ["taskId"])
    .index("by_campaignId", ["campaignId"]),

  // Tone Presets - admin-manageable voice presets for brand tone step
  tonePresets: defineTable({
    label: v.string(),     // e.g. "Bold"
    value: v.string(),     // e.g. "Direct, confident, and unapologetic. We say what we mean..."
    order: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_isActive", ["isActive"]),

  // Short-lived nonces for OAuth initiation. Minted by an authenticated
  // mutation so the server knows who the caller is, then handed to the browser
  // to put in the redirect URL. The OAuth route consumes the nonce to recover
  // the trusted userId/brandId instead of trusting query params from the client.
  oauthNonces: defineTable({
    nonce: v.string(),
    provider: v.string(),              // "shopify" | "tiktok"
    userId: v.id("users"),
    brandId: v.optional(v.id("brands")), // only set for providers that scope to a brand (tiktok)
    expiresAt: v.number(),             // ms since epoch; reject if now > expiresAt
    createdAt: v.number(),
  }).index("by_nonce", ["nonce"]),

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



    // -------------------------------------- Admin Specifics ----------------------------------------------------------


  invites: defineTable({
    email: v.string(),
    role: v.string(),
    token: v.string(),
    status: v.union(
        v.literal("pending"),
        v.literal("accepted"),
        v.literal("expired")
    ),
    invitedBy: v.id('teams'),
    expiresAt: v.number(),
})
    .index('by_status', ['status'])
    .index('by_email', ['email'])
    .index('by_token', ['token']),

  teams: defineTable({
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
    phone: v.optional(v.string()),
    bio: v.optional(v.string()),
    location: v.optional(v.string()),

    // Marketplace/merchant fields
    referralCode: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("verified", ["verified"])
    .index("isActive", ["isActive"])
    .index("by_clerkId", ["clerkId"]),

  roles: defineTable({
    name: v.string(),
  })
  .index('by_name', ['name']),

  roleTeams: defineTable({
    roleId: v.id("roles"),
    teamId: v.id("teams"),
  })
  .index('by_role', ['roleId'])
  .index('by_team', ['teamId'])
  .index('by_role_team', ['roleId', 'teamId']),

  permissions: defineTable({
    name: v.string(),
  })
  .index('by_name', ['name']),

  permissionRoles: defineTable({
    permissionId: v.id('permissions'),
    roleId: v.id('roles')
  })
    .index('by_role', ['roleId'])
    .index('by_permission', ['permissionId'])
    .index('by_permission_role', ['permissionId', 'roleId']),

  // Website showcase items ("Made with SIRz" creative wall).
  // Managed from the admin app, rendered publicly on the marketing site.
  showcaseItems: defineTable({
    title: v.string(),        // brand name, e.g. "ABC Gems"
    tag: v.string(),          // free-form chip label, e.g. "AI UGC Video"
    caption: v.string(),      // e.g. "Necklace review · creator-led"
    imageUrl: v.optional(v.union(v.string(), v.null())), // public R2 URL (image, or poster when videoUrl is set)
    videoUrl: v.optional(v.union(v.string(), v.null())), // public R2 URL when the creative is a video
    categoryId: v.optional(v.union(v.id("showcaseCategories"), v.null())), // filter tab on the wall
    sortOrder: v.number(),
    isPublished: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sortOrder", ["sortOrder"])
    .index("by_category", ["categoryId"])
    .index("by_published_sortOrder", ["isPublished", "sortOrder"]),

  // Editable "Made with SIRz" wall categories. Managed from the admin app;
  // rendered as filter tabs on the marketing site.
  showcaseCategories: defineTable({
    name: v.string(),      // display name, e.g. "AI UGC Video"
    slug: v.string(),      // stable identifier, derived from the name at creation
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_sortOrder", ["sortOrder"])
    .index("by_slug", ["slug"]),

  // -------------------------------------- Website workspace ----------------------------------------------------------
  // Members of the private website workspace (the "Made with SIRz" wall admins).
  // Mirrors the investor workspace's teamMembers flow: invitation -> sign in ->
  // activation. "owner" is the allowlisted internal admin; everyone else invited
  // via /admin/members is an "admin".
  workspaceMembers: defineTable({
    userId: v.id("users"),
    email: v.string(),
    name: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin")),
    status: v.union(v.literal("active"), v.literal("pending"), v.literal("suspended")),
    invitedBy: v.optional(v.id("users")),
    invitedAt: v.number(),
    joinedAt: v.optional(v.number()),
    suspendedAt: v.optional(v.number()),
  })
    .index("by_userId", ["userId"])
    .index("by_email", ["email"]),

  // Pending invitations to the website workspace. Acceptance is automatic once
  // the invited address verifies its six-digit sign-in code (no token link needed).
  workspaceInvitations: defineTable({
    email: v.string(),
    name: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("admin")),
    tokenHash: v.string(),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_tokenHash", ["tokenHash"])
    .index("by_email", ["email"]),
});




