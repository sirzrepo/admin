import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireAdmin } from "./adminAuth";
import {
  BILLING_CONFIG_VERSION,
  DEFAULT_BILLING_SETTINGS,
  DEFAULT_PLANS,
  DEFAULT_SKUS,
  DEFAULT_TOP_UP_PACKAGES,
  type SeedPlan,
  type SeedSku,
  type SeedTopUpPackage,
} from "./billingConfig";

const RESERVATION_TTL_MS = 6 * 60 * 60 * 1000;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const LEGACY_PLAN_KEYS = ["launch", "studio", "agency"] as const;
const CURRENT_PUBLIC_PLAN_KEYS = ["starter", "growth", "pro"] as const;
const THROTTLE_WINDOW_MS = 60 * 1000;
const GENERATION_BURST_LIMITS: Record<string, number> = {
  image_generation: 30,
  video_generation: 15,
  campaign_generation: 15,
  helper_ai: 60,
};

type AgentEstimateArgs = {
  userId?: string;
  brandId?: any;
  campaignId?: any;
  agentType: string;
  input: any;
  initiatedFrom?: string;
};

type SkuLine = {
  skuKey: string;
  units: number;
  credits: number;
  provider: string;
  model: string;
  estimatedProviderCostCents: number;
  defaultCreditSource: string;
};

export const adminSeedBillingConfig = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await seedBillingConfig(ctx);
  },
});

export const seedBillingConfigInternal = internalMutation({
  args: {},
  handler: async (ctx) => await seedBillingConfig(ctx),
});

export const sendPendingDowngradeEmailInternal = internalMutation({
  args: {
    userId: v.optional(v.string()),
    stripeSubscriptionId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let subscription: any = null;
    if (args.stripeSubscriptionId) {
      subscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_stripeSubscriptionId", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId!))
        .first();
    } else if (args.userId) {
      subscription = await getLatestSubscription(ctx, args.userId);
    } else {
      const pending = (await ctx.db.query("subscriptions").collect())
        .filter((entry: any) => !!entry.pendingPlanKey);
      if (pending.length !== 1) {
        throw new Error(`Expected exactly one pending downgrade subscription, found ${pending.length}`);
      }
      subscription = pending[0];
    }
    if (!subscription?.pendingPlanKey) throw new Error("No pending plan change found");
    if (!subscription.pendingPlanEffectiveAt) throw new Error("Pending plan change has no effective date");

    const currentPlan = await getPlan(ctx, subscription.planKey);
    const nextPlan = await getPlan(ctx, subscription.pendingPlanKey);
    if (nextPlan.priceMonthlyCents >= currentPlan.priceMonthlyCents) {
      throw new Error("Pending plan change is not a downgrade");
    }

    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
      deliveryKey: `plan_downgrade_scheduled:v1:${subscription.stripeSubscriptionId ?? subscription._id}:${nextPlan.key}:${Math.floor(subscription.pendingPlanEffectiveAt / 1000)}`,
      userId: String(subscription.userId),
      type: "plan_downgrade_scheduled",
      payload: {
        stripeSubscriptionId: subscription.stripeSubscriptionId,
        currentPlanName: currentPlan.name,
        nextPlanName: nextPlan.name,
        effectiveAt: subscription.pendingPlanEffectiveAt,
      },
    });

    return {
      queued: true,
      userId: subscription.userId,
      currentPlanName: currentPlan.name,
      nextPlanName: nextPlan.name,
      effectiveAt: subscription.pendingPlanEffectiveAt,
    };
  },
});

export const clearPendingPlanForCanceledSubscriptionsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = (await ctx.db.query("subscriptions").collect())
      .filter((entry: any) => entry.cancelAtPeriodEnd && !!entry.pendingPlanKey);
    for (const row of rows) {
      await ctx.db.patch(row._id, {
        pendingPlanKey: undefined,
        pendingUpgradeCredits: undefined,
        pendingPlanChangedAt: undefined,
        pendingPlanEffectiveAt: undefined,
        updatedAt: Date.now(),
      });
    }
    return { cleared: rows.length };
  },
});

export const bootstrapBillingConfig = mutation({
  args: { secret: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existingPlan = await ctx.db.query("billingPlans").first();
    if (existingPlan) {
      const expectedSecret = process.env.BILLING_SEED_SECRET;
      let allowed = false;
      if (expectedSecret && args.secret && args.secret === expectedSecret) {
        allowed = true;
      } else {
        try {
          await requireAdmin(ctx);
          allowed = true;
        } catch {
          allowed = false;
        }
      }
      if (!allowed) throw new Error("Billing config already exists; admin or seed secret required");
    }
    return await seedBillingConfig(ctx);
  },
});

export const getAdminPricingCatalog = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const settings = await getBillingSettings(ctx);
    const rows = await ctx.db.query("aiSkus").collect();
    const skus = await Promise.all(rows
      .map(async (sku: any) => {
        const resolved = await resolveSkuPricing(ctx, sku);
        const retailValueCents = resolved.creditsPerUnit * resolved.creditValueCents;
        return {
          key: resolved.key,
          label: resolved.label,
          provider: resolved.provider,
          model: resolved.model,
          unitType: resolved.unitType,
          providerCostPerUnitCents: resolved.providerCostPerUnitCents,
          creditValueCents: resolved.creditValueCents,
          markup: resolved.markup,
          creditsPerUnit: resolved.creditsPerUnit,
          retailValueCents,
          effectiveMarginPercent: retailValueCents > 0
            ? Math.round((1 - resolved.providerCostPerUnitCents / retailValueCents) * 10000) / 100
            : 0,
          usesGlobalCreditValue: resolved.creditValueOverrideCents === undefined,
          usesGlobalMarkup: resolved.markupOverride === undefined,
          creditValueOverrideCents: resolved.creditValueOverrideCents,
          markupOverride: resolved.markupOverride,
          creditSource: resolved.defaultCreditSource,
          isActive: sku.isActive,
          metadata: resolved.metadata,
        };
      }));
    return {
      globalLevers: {
        creditValueCents: settings.defaultCreditValueCents,
        markup: settings.defaultMarkup,
        targetGrossMarginPercent: Math.round((1 - 1 / settings.defaultMarkup) * 10000) / 100,
      },
      formula: "ceil(providerCostPerUnitCents * markup / creditValueCents)",
      skus: skus.sort((a, b) => a.key.localeCompare(b.key)),
    };
  },
});

export const adminGetBillingConfiguration = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const settings = await getBillingSettings(ctx);
    const plans = await ctx.db.query("billingPlans").collect();
    const topUps = await ctx.db.query("creditTopUpPackages").collect();
    const subscriptions = await ctx.db.query("subscriptions").collect();
    const activeStatuses = new Set(["active", "trialing", "past_due"]);
    const subscriptionCounts = new Map<string, number>();
    for (const subscription of subscriptions) {
      if (!activeStatuses.has(subscription.status)) continue;
      subscriptionCounts.set(subscription.planKey, (subscriptionCounts.get(subscription.planKey) ?? 0) + 1);
    }
    return {
      settings,
      plans: plans
        .map((plan) => ({ ...plan, activeSubscriptionCount: subscriptionCounts.get(plan.key) ?? 0 }))
        .sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents),
      topUps: topUps.sort((a, b) => a.priceCents - b.priceCents),
      subscriptions,
    };
  },
});

export const adminUpdateBillingSettings = mutation({
  args: {
    trialDurationDays: v.number(),
    trialCredits: v.number(),
    trialLowCreditThreshold: v.number(),
    trialTemplateLimit: v.number(),
    trialTemplateRefreshEnabled: v.boolean(),
    trialTemplateRefreshDays: v.number(),
    trialTemplateAiCovers: v.boolean(),
    templateBasePoolEvergreenTarget: v.number(),
    templateBasePoolSeasonalEvergreenTarget: v.number(),
    templateBasePoolSeasonalEventTarget: v.number(),
    creditPurchaseInvoicePolicy: v.union(v.literal("receipt_only"), v.literal("always"), v.literal("on_request")),
    requirePaymentMethodForTrial: v.boolean(),
    allowTopUpsDuringTrial: v.boolean(),
    oneTrialPerAccount: v.boolean(),
    defaultCreditValueCents: v.number(),
    defaultMarkup: v.number(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    assertNonNegativeFields(args, ["trialDurationDays", "trialCredits", "trialLowCreditThreshold", "trialTemplateLimit", "trialTemplateRefreshDays", "templateBasePoolEvergreenTarget", "templateBasePoolSeasonalEvergreenTarget", "templateBasePoolSeasonalEventTarget"]);
    if (args.defaultCreditValueCents <= 0) throw new Error("Credit value must be greater than zero.");
    if (args.defaultMarkup < 1) throw new Error("Markup must be at least 1.");
    const existing = await ctx.db.query("billingSettings").withIndex("by_key", (q) => q.eq("key", "global")).first();
    if (!existing) throw new Error("Global billing settings have not been seeded.");
    await ctx.db.patch(existing._id, { ...args, updatedAt: Date.now() });
    return { updated: true };
  },
});

export const adminUpdateBillingPlan = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.string(),
    priceMonthlyCents: v.number(),
    currency: v.string(),
    includedCredits: v.number(),
    lowCreditThreshold: v.number(),
    maxBrands: v.number(),
    maxSeats: v.number(),
    stripePriceId: v.optional(v.string()),
    isActive: v.boolean(),
    features: v.any(),
    limits: v.any(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const key = args.key.trim();
    const existing = await ctx.db.query("billingPlans").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (!existing) throw new Error("Plan not found.");
    if (!args.name.trim()) throw new Error("Plan name is required.");
    assertNonNegativeFields(args, ["priceMonthlyCents", "includedCredits", "lowCreditThreshold", "maxBrands", "maxSeats"]);
    if (!args.isActive && existing.isActive) {
      const subscriptions = await ctx.db.query("subscriptions").collect();
      const activeCount = subscriptions.filter((row) => row.planKey === key && ["active", "trialing", "past_due"].includes(row.status)).length;
      if (activeCount > 0) throw new Error(`This plan still has ${activeCount} active subscription${activeCount === 1 ? "" : "s"}. Move those customers before deactivating it.`);
    }
    await ctx.db.patch(existing._id, {
      name: args.name.trim(),
      description: args.description.trim() || undefined,
      priceMonthlyCents: args.priceMonthlyCents,
      currency: args.currency.trim().toUpperCase(),
      includedCredits: args.includedCredits,
      lowCreditThreshold: args.lowCreditThreshold,
      maxBrands: args.maxBrands,
      maxSeats: args.maxSeats,
      stripePriceId: args.stripePriceId?.trim() || undefined,
      isActive: args.isActive,
      features: args.features,
      limits: args.limits,
      version: (existing.version ?? BILLING_CONFIG_VERSION) + 1,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const adminUpdateAiSku = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.query("aiSkus").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    if (!existing) throw new Error("AI pricing item not found.");
    if (!args.label.trim() || !args.provider.trim() || !args.model.trim()) throw new Error("Label, provider and model are required.");
    if (args.providerCostPerUnitCents < 0) throw new Error("Provider cost cannot be negative.");
    if (args.creditValueOverrideCents !== undefined && args.creditValueOverrideCents <= 0) throw new Error("Credit value override must be greater than zero.");
    if (args.markupOverride !== undefined && args.markupOverride < 1) throw new Error("Markup override must be at least 1.");
    await ctx.db.patch(existing._id, {
      label: args.label.trim(),
      provider: args.provider.trim(),
      model: args.model.trim(),
      unitType: args.unitType.trim(),
      providerCostPerUnitCents: args.providerCostPerUnitCents,
      creditValueOverrideCents: args.creditValueOverrideCents,
      markupOverride: args.markupOverride,
      defaultCreditSource: args.defaultCreditSource,
      isActive: args.isActive,
      effectiveFrom: Date.now(),
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

export const adminUpdateTopUpPackage = mutation({
  args: {
    key: v.string(),
    label: v.string(),
    description: v.string(),
    credits: v.number(),
    priceCents: v.number(),
    currency: v.string(),
    expiresAfterDays: v.optional(v.number()),
    stripePriceId: v.optional(v.string()),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const existing = await ctx.db.query("creditTopUpPackages").withIndex("by_key", (q) => q.eq("key", args.key)).first();
    if (!existing) throw new Error("Top-up package not found.");
    if (!args.label.trim()) throw new Error("Package name is required.");
    assertNonNegativeFields(args, ["credits", "priceCents"]);
    if (args.expiresAfterDays !== undefined && args.expiresAfterDays < 1) throw new Error("Expiry must be at least one day.");
    await ctx.db.patch(existing._id, {
      label: args.label.trim(),
      description: args.description.trim() || undefined,
      credits: args.credits,
      priceCents: args.priceCents,
      currency: args.currency.trim().toUpperCase(),
      expiresAfterDays: args.expiresAfterDays,
      stripePriceId: args.stripePriceId?.trim() || undefined,
      isActive: args.isActive,
      updatedAt: Date.now(),
    });
    return { updated: true };
  },
});

function assertNonNegativeFields(value: Record<string, any>, fields: string[]) {
  for (const field of fields) {
    if (!Number.isFinite(value[field]) || value[field] < 0) throw new Error(`${field} cannot be negative.`);
  }
}

export const getMyCreditBalance = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .first();
    const subscription = await getLatestSubscription(ctx, String(userId));
    const plan = subscription?.planKey ? await getPlan(ctx, subscription.planKey) : null;
    const pendingPlan = subscription?.pendingPlanKey && !subscription.cancelAtPeriodEnd
      ? await getPlan(ctx, subscription.pendingPlanKey)
      : null;
    const baseAccessStatus = subscriptionAccessStatus(subscription);
    const accessStatus = baseAccessStatus === "trialing" && (account?.availableCredits ?? 0) <= 0
      ? "trial_exhausted"
      : baseAccessStatus;
    const hasMonthlyGrant = baseAccessStatus === "active"
      ? await hasMonthlyPlanCreditGrant(ctx, String(userId))
      : false;
    const isPaymentProcessing = baseAccessStatus === "active"
      && !!subscription?.convertedAt
      && !hasMonthlyGrant;
    const trialCreditsRemaining = baseAccessStatus === "trialing" || isPaymentProcessing
      ? await getAvailableCreditsForSource(ctx, String(userId), "trial_credits")
      : 0;
    const settings = await getBillingSettings(ctx);
    const lowCreditThreshold = baseAccessStatus === "trialing"
      ? settings.trialLowCreditThreshold
      : plan?.lowCreditThreshold ?? 0;

    return {
      availableCredits: account?.availableCredits ?? 0,
      reservedCredits: account?.reservedCredits ?? 0,
      trialCreditsRemaining: Math.min(account?.availableCredits ?? 0, trialCreditsRemaining),
      lowCreditThreshold,
      isLowCredit: lowCreditThreshold > 0 && (account?.availableCredits ?? 0) <= lowCreditThreshold,
      planKey: plan?.key ?? null,
      planName: plan?.name ?? null,
      includedCredits: plan?.includedCredits ?? 0,
      accessStatus,
      trialEndsAt: subscription?.trialEndsAt,
      currentPeriodEnd: subscription?.currentPeriodEnd,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      pendingPlanKey: pendingPlan?.key,
      pendingPlanName: pendingPlan?.name,
      pendingPlanEffectiveAt: subscription?.cancelAtPeriodEnd ? undefined : subscription?.pendingPlanEffectiveAt,
      isPaymentProcessing,
      canUseAi: accessStatus === "trialing" || accessStatus === "active" || accessStatus === "internal",
      canBuyTopUps: accessStatus === "active" && !isPaymentProcessing,
      canManageBilling: !!subscription?.stripeCustomerId,
    };
  },
});

export const getTrialOffer = query({
  args: {},
  handler: async (ctx) => {
    const settings = await getBillingSettings(ctx);
    return {
      trialDurationDays: settings.trialDurationDays,
      trialCredits: settings.trialCredits,
      requirePaymentMethodForTrial: settings.requirePaymentMethodForTrial,
    };
  },
});

export const getTemplateEntitlementInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    let user: any = null;
    try {
      user = await ctx.db.get(args.userId as any);
    } catch {
      user = null;
    }
    if (user?.role === "admin") {
      const plan = await getPlan(ctx, "internal");
      return templateEntitlementFromPlan(plan, "internal");
    }

    const subscription = await getLatestSubscription(ctx, args.userId);
    const status = subscriptionAccessStatus(subscription);
    const settings = await getBillingSettings(ctx);

    if (status === "trialing") {
      return {
        enabled: settings.trialTemplateLimit > 0,
        accessStatus: "trialing",
        planKey: subscription?.planKey ?? "trial",
        templateLimit: Math.max(0, Number(settings.trialTemplateLimit ?? 0)),
        refreshEnabled: !!settings.trialTemplateRefreshEnabled && Math.max(0, Number(settings.trialTemplateRefreshDays ?? 0)) > 0,
        refreshDays: Math.max(0, Number(settings.trialTemplateRefreshDays ?? 0)),
        aiCoversEnabled: !!settings.trialTemplateAiCovers,
      };
    }

    if (status === "active" || status === "internal") {
      const plan = await getPlan(ctx, subscription?.planKey ?? "internal");
      return templateEntitlementFromPlan(plan, status);
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
  },
});

export const getSkuQuote = query({
  args: {
    skuKey: v.string(),
    units: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const sku = await getSku(ctx, args.skuKey);
    const units = Math.max(0, args.units ?? 1);
    const credits = Math.ceil(units * sku.creditsPerUnit);
    const subscription = await getLatestSubscription(ctx, String(userId));
    const status = subscriptionAccessStatus(subscription);
    let user: any = null;
    try {
      user = await ctx.db.get(userId);
    } catch {
      user = null;
    }
    const isInternal = status === "internal" || user?.role === "admin";
    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .first();
    const availableCredits = account?.availableCredits ?? 0;
    const hasAccess = isInternal || status === "trialing" || status === "active";

    return {
      skuKey: sku.key,
      label: sku.label,
      batchSize: typeof sku.metadata?.batchSize === "number" ? sku.metadata.batchSize : undefined,
      units,
      credits,
      availableCredits,
      hasAccess,
      canAfford: isInternal || (hasAccess && availableCredits >= credits),
      accessStatus: isInternal ? "internal" : status,
    };
  },
});

export const getSkuConfigurationInternal = internalQuery({
  args: { skuKey: v.string() },
  handler: async (ctx, args) => {
    const sku = await getSku(ctx, args.skuKey);
    return {
      key: sku.key,
      metadata: sku.metadata,
    };
  },
});

export const recordPlatformAiUsageInternal = internalMutation({
  args: {
    userId: v.optional(v.string()),
    brandId: v.optional(v.id("brands")),
    skuKey: v.string(),
    featureKey: v.string(),
    units: v.optional(v.number()),
    status: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const sku = await getSku(ctx, args.skuKey);
    const units = Math.max(0, args.units ?? 1);
    const creditsPriced = Math.ceil(units * sku.creditsPerUnit);
    await recordOperationUsage(ctx, {
      userId: args.userId,
      brandId: args.brandId,
      featureKey: args.featureKey,
      sku,
      units,
      creditsPriced,
      creditsChargedToCustomer: 0,
      creditSource: "platform_covered",
      status: args.status,
      metadata: args.metadata,
    });
    return { creditsPriced, creditsChargedToCustomer: 0 };
  },
});

export const getTemplatePoolSettingsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const settings = await getBillingSettings(ctx);
    return {
      evergreenTarget: Math.max(0, Math.floor(Number(
        settings.templateBasePoolEvergreenTarget
          ?? settings.templateBasePoolTrendingTarget
          ?? DEFAULT_BILLING_SETTINGS.templateBasePoolEvergreenTarget,
      ))),
      seasonalEvergreenTarget: Math.max(0, Math.floor(Number(
        settings.templateBasePoolSeasonalEvergreenTarget
          ?? settings.templateBasePoolSeasonalTrendingTarget
          ?? DEFAULT_BILLING_SETTINGS.templateBasePoolSeasonalEvergreenTarget,
      ))),
      seasonalEventTarget: Math.max(0, Math.floor(Number(
        settings.templateBasePoolSeasonalEventTarget
          ?? settings.templateBasePoolSeasonalTarget
          ?? DEFAULT_BILLING_SETTINGS.templateBasePoolSeasonalEventTarget,
      ))),
    };
  },
});

export const getOperationQuote = query({
  args: {
    lines: v.array(v.object({ skuKey: v.string(), units: v.number() })),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const lines = await Promise.all(args.lines.map(async (line) => {
      const sku = await getSku(ctx, line.skuKey);
      const units = Math.max(0, line.units);
      return {
        skuKey: sku.key,
        label: sku.label,
        units,
        credits: Math.ceil(units * sku.creditsPerUnit),
      };
    }));
    const credits = lines.reduce((total, line) => total + line.credits, 0);
    const subscription = await getLatestSubscription(ctx, String(userId));
    const status = subscriptionAccessStatus(subscription);
    let user: any = null;
    try {
      user = await ctx.db.get(userId);
    } catch {
      user = null;
    }
    const isInternal = status === "internal" || user?.role === "admin";
    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .first();
    const availableCredits = account?.availableCredits ?? 0;
    const hasAccess = isInternal || status === "trialing" || status === "active";
    return {
      credits,
      availableCredits,
      hasAccess,
      canAfford: isInternal || (hasAccess && availableCredits >= credits),
      accessStatus: isInternal ? "internal" : status,
      lines,
    };
  },
});

export const getAgentTaskQuote = query({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== String(userId) || task.agentType === "attached_video") return null;
    const estimate = await estimateAgentTaskRetryCredits(ctx, task);
    const subscription = await getLatestSubscription(ctx, String(userId));
    const status = subscriptionAccessStatus(subscription);
    let user: any = null;
    try {
      user = await ctx.db.get(userId);
    } catch {
      user = null;
    }
    const isInternal = status === "internal" || user?.role === "admin";
    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .first();
    const availableCredits = account?.availableCredits ?? 0;
    const hasAccess = isInternal || status === "trialing" || status === "active";
    return {
      credits: estimate.creditsPriced,
      availableCredits,
      hasAccess,
      canAfford: isInternal || (hasAccess && availableCredits >= estimate.creditsPriced),
      accessStatus: isInternal ? "internal" : status,
      lines: estimate.skuBreakdown.map((line) => ({
        skuKey: line.skuKey,
        label: line.skuKey,
        units: line.units,
        credits: line.credits,
      })),
    };
  },
});

export const getCampaignRetryQuote = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== String(userId)) return null;

    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();
    const reservations = await ctx.db
      .query("creditReservations")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect();

    const failed = tasks.filter((task: any) => {
      if (task.status !== "failed" || task.agentType === "attached_video") return false;
      if (task.agentType === "script_generator") {
        return !tasks.some((candidate: any) =>
          candidate.agentType === "script_generator" &&
          candidate.status === "completed" &&
          Array.isArray(candidate.output?.scripts) &&
          candidate.output.scripts.some((script: any) => typeof script.socialCaption === "string" && script.socialCaption.trim()),
        );
      }
      if (task.agentType === "image_generator" || task.agentType === "video_generator") {
        const sameAngle = tasks.filter((candidate: any) => candidate.angleId === task.angleId);
        const hasCompletedFinal = sameAngle.some((candidate: any) =>
          (candidate.agentType === "video_generator" || candidate.agentType === "attached_video") &&
          candidate.status === "completed" &&
          (candidate.output?.videoUrl || candidate.output?.imageUrl),
        );
        if (hasCompletedFinal) return false;
        if (task.agentType === "image_generator") {
          return !sameAngle.some((candidate: any) =>
            candidate.agentType === "image_generator" &&
            candidate.status === "completed" &&
            candidate.output?.imageUrl,
          );
        }
      }
      return true;
    });

    const estimates = await Promise.all(failed.map((task: any) => estimateAgentTaskRetryCredits(ctx, task)));
    const credits = estimates.reduce((sum, estimate) => sum + estimate.creditsPriced, 0);
    const subscription = await getLatestSubscription(ctx, String(userId));
    const status = subscriptionAccessStatus(subscription);
    let user: any = null;
    try {
      user = await ctx.db.get(userId);
    } catch {
      user = null;
    }
    const isInternal = status === "internal" || user?.role === "admin";
    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .first();
    const availableCredits = account?.availableCredits ?? 0;
    const hasAccess = isInternal || status === "trialing" || status === "active";

    return {
      credits,
      chargedCredits: reservations.reduce((sum, reservation) => sum + reservation.chargedCredits, 0),
      releasedCredits: reservations.reduce((sum, reservation) => sum + reservation.releasedCredits, 0),
      failedTaskCount: failed.length,
      availableCredits,
      hasAccess,
      canAfford: isInternal || (hasAccess && availableCredits >= credits),
      accessStatus: isInternal ? "internal" : status,
      lines: estimates.flatMap((estimate) => estimate.skuBreakdown.map((line) => ({
        skuKey: line.skuKey,
        label: line.skuKey,
        units: line.units,
        credits: line.credits,
      }))),
    };
  },
});

export const getMyCreditLedger = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("creditLedger")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .order("desc")
      .take(args.limit ?? 25);
  },
});

export const getMyBillingTransactions = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { page: [], isDone: true, continueCursor: "" };
    return await ctx.db
      .query("billingTransactions")
      .withIndex("by_userId_occurredAt", (q) => q.eq("userId", String(userId)))
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getMyCreditActivity = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { page: [], isDone: true, continueCursor: "" };
    const result = await ctx.db
      .query("creditLedger")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .filter((q) => q.or(
        q.eq(q.field("type"), "grant"),
        q.eq(q.field("type"), "purchase"),
        q.eq(q.field("type"), "charge"),
        q.eq(q.field("type"), "expire"),
        q.eq(q.field("type"), "admin_grant"),
        q.eq(q.field("type"), "adjustment"),
      ))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((entry) => ({
        _id: entry._id,
        type: entry.type,
        title: creditActivityTitle(entry),
        amount: creditActivityAmount(entry),
        balanceAfter: entry.balanceAfter,
        createdAt: entry.createdAt,
      })),
    };
  },
});

export const getMyCheckoutConfirmation = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const session = await ctx.db
      .query("stripeCheckoutSessions")
      .withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.sessionId))
      .first();
    if (!session || session.userId !== String(userId) || session.mode !== "subscription") {
      return null;
    }

    const subscription = await getLatestSubscription(ctx, String(userId));
    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", String(userId)))
      .first();
    const plan = session.planKey ? await getPlan(ctx, session.planKey) : null;
    const accessStatus = subscriptionAccessStatus(subscription);
    const confirmed = session.status === "complete"
      && (accessStatus === "trialing" || accessStatus === "active");

    return {
      confirmed,
      checkoutStatus: session.status,
      accessStatus,
      planName: plan?.name ?? null,
      priceMonthlyCents: plan?.priceMonthlyCents ?? null,
      currency: plan?.currency ?? null,
      availableCredits: account?.availableCredits ?? 0,
      trialEndsAt: subscription?.trialEndsAt,
    };
  },
});

export const listCreditTopUpPackages = query({
  args: {},
  handler: async (ctx) => {
    const packages = await ctx.db
      .query("creditTopUpPackages")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    if (packages.length > 0) {
      return packages.sort((a, b) => a.priceCents - b.priceCents);
    }
    return DEFAULT_TOP_UP_PACKAGES
      .filter((pack) => pack.isActive)
      .sort((a, b) => a.priceCents - b.priceCents);
  },
});

export const listBillingPlans = query({
  args: {},
  handler: async (ctx) => {
    const plans = await ctx.db
      .query("billingPlans")
      .withIndex("by_isActive", (q) => q.eq("isActive", true))
      .collect();
    const source = plans.length > 0 ? plans : DEFAULT_PLANS;
    const hasCurrentPlans = source.some((plan) => CURRENT_PUBLIC_PLAN_KEYS.includes(plan.key as any));
    return source
      .filter((plan) => plan.key !== "internal" && !(hasCurrentPlans && LEGACY_PLAN_KEYS.includes(plan.key as any)))
      .sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents)
      .map((plan) => {
        const fallback = DEFAULT_PLANS.find((candidate) => candidate.key === plan.key);
        return {
        key: plan.key,
        name: plan.name,
        description: plan.description,
        priceMonthlyCents: plan.priceMonthlyCents,
        currency: plan.currency,
        includedCredits: plan.includedCredits,
        lowCreditThreshold: plan.lowCreditThreshold ?? 0,
        maxBrands: plan.maxBrands,
        maxSeats: plan.maxSeats,
        features: { ...(fallback?.features ?? {}), ...(plan.features ?? {}) },
        limits: { ...(fallback?.limits ?? {}), ...(plan.limits ?? {}) },
        canSubscribe: !!plan.stripePriceId && plan.priceMonthlyCents > 0,
        };
      });
  },
});

export const createCreditTopUpCheckoutSession = action({
  args: {
    packageKey: v.string(),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
    requestInvoice: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ url: string; sessionId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const eligibility = await ctx.runQuery(internal.billing.getCheckoutEligibilityInternal, {
      userId: String(userId),
    });
    if (!eligibility.canBuyTopUps) {
      throw new Error("Credit top-ups are available after your paid plan becomes active.");
    }
    const pack = await ctx.runQuery(internal.billing.getTopUpPackageInternal, {
      packageKey: args.packageKey,
    });
    if (!pack || !pack.isActive) throw new Error("Credit package not available");
    const customer = await ctx.runQuery(internal.billing.getStripeCustomerForUserInternal, {
      userId: String(userId),
    });
    if (!customer?.stripeCustomerId) {
      throw new Error("Your Stripe billing profile is not ready. Please refresh and try again.");
    }
    const settings = await ctx.runQuery(internal.billing.getBillingSettingsInternal, {});
    const issueInvoice = settings.creditPurchaseInvoicePolicy === "always"
      || (settings.creditPurchaseInvoicePolicy === "on_request" && args.requestInvoice === true);

    const appUrl = process.env.SITE_URL || "http://localhost:5173";
    const session = await stripeRequest("checkout/sessions", {
      mode: "payment",
      success_url: args.successUrl ?? `${appUrl}/settings?billing=success`,
      cancel_url: args.cancelUrl ?? `${appUrl}/settings?billing=cancelled`,
      client_reference_id: String(userId),
      customer: customer.stripeCustomerId,
      "invoice_creation[enabled]": issueInvoice ? "true" : undefined,
      "invoice_creation[invoice_data][description]": issueInvoice
        ? `${pack.label} credit purchase for SIRz`
        : undefined,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": pack.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(pack.priceCents),
      "line_items[0][price_data][product_data][name]": pack.label,
      "line_items[0][price_data][product_data][description]": pack.description ?? `${pack.credits} SIRz credits`,
      "metadata[userId]": String(userId),
      "metadata[type]": "credit_top_up",
      "metadata[packageKey]": pack.key,
      "metadata[credits]": String(pack.credits),
      "metadata[invoicePolicy]": settings.creditPurchaseInvoicePolicy,
      "metadata[invoiceRequested]": issueInvoice ? "true" : "false",
      "metadata[expiresAfterDays]": pack.expiresAfterDays ? String(pack.expiresAfterDays) : "",
    });

    await ctx.runMutation(internal.billing.recordStripeCheckoutSessionInternal, {
      userId: String(userId),
      mode: "payment",
      status: session.status ?? "open",
      stripeSessionId: session.id,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
      packageKey: pack.key,
      credits: pack.credits,
      amountCents: pack.priceCents,
      currency: pack.currency,
      url: session.url,
      metadata: session.metadata ?? {},
    });

    return { url: session.url, sessionId: session.id };
  },
});

export const createPlanCheckoutSession = action({
  args: {
    planKey: v.string(),
    successUrl: v.optional(v.string()),
    cancelUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ url: string; sessionId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const user = await ctx.runQuery(internal.users.getUserById, { userId });
    const eligibility = await ctx.runQuery(internal.billing.getCheckoutEligibilityInternal, {
      userId: String(userId),
    });
    if (!eligibility.canStartTrial) {
      throw new Error(eligibility.reason ?? "This account is not eligible to start another trial.");
    }
    const settings = await ctx.runQuery(internal.billing.getBillingSettingsInternal, {});
    const plan = await ctx.runQuery(internal.billing.getBillingPlanInternal, {
      planKey: args.planKey,
    });
    if (!plan || !plan.isActive || plan.priceMonthlyCents <= 0) {
      throw new Error("Plan is not available for subscription");
    }
    if (!plan.stripePriceId) {
      throw new Error(`Stripe price is not configured for ${plan.name}`);
    }

    const testClockGuard = getStripeTestClockGuard();
    const existingCustomer = testClockGuard.enabled
      ? await ctx.runQuery(internal.billing.getStripeTestClockCustomerForUserInternal, {
        userId: String(userId),
      })
      : await ctx.runQuery(internal.billing.getStripeCustomerForUserInternal, {
        userId: String(userId),
      });
    let stripeCustomerId = existingCustomer?.stripeCustomerId;
    if (testClockGuard.enabled && stripeCustomerId) {
      console.log("[billing:createPlanCheckoutSession] Reusing Stripe test clock customer", {
        userId: String(userId),
        stripeCustomerId,
        stripeTestClockId: existingCustomer?.stripeTestClockId,
      });
    }
    if (!stripeCustomerId) {
      const testClockCustomer = await maybeCreateStripeTestClockCustomerForUser(
        ctx,
        String(userId),
        user?.email,
      );
      stripeCustomerId = testClockCustomer?.stripeCustomerId;
      if (testClockCustomer) {
        console.log("[billing:createPlanCheckoutSession] Using Stripe test clock customer", {
          userId: String(userId),
          stripeCustomerId: testClockCustomer.stripeCustomerId,
          stripeTestClockId: testClockCustomer.stripeTestClockId,
        });
      }
    }

    const reusableSession = await ctx.runQuery(
      internal.billing.getReusablePlanCheckoutSessionInternal,
      {
        userId: String(userId),
        planKey: plan.key,
        amountCents: plan.priceMonthlyCents,
        currency: plan.currency,
      },
    );
    if (reusableSession?.url && !testClockGuard.enabled) {
      console.log("[billing:createPlanCheckoutSession] Reusing open Stripe checkout session", {
        userId: String(userId),
        stripeSessionId: reusableSession.stripeSessionId,
      });
      return { url: reusableSession.url, sessionId: reusableSession.stripeSessionId };
    }
    if (reusableSession?.url && testClockGuard.enabled) {
      console.log("[billing:createPlanCheckoutSession] Ignoring reusable checkout session for test-clock run", {
        userId: String(userId),
        stripeSessionId: reusableSession.stripeSessionId,
      });
    }

    const appUrl = process.env.SITE_URL || "http://localhost:5173";
    const session = await stripeRequest("checkout/sessions", {
      mode: "subscription",
      success_url: args.successUrl ?? `${appUrl}/settings?billing=success`,
      cancel_url: args.cancelUrl ?? `${appUrl}/settings?billing=cancelled`,
      client_reference_id: String(userId),
      customer: stripeCustomerId,
      customer_email: stripeCustomerId ? undefined : user?.email,
      "line_items[0][quantity]": "1",
      "line_items[0][price]": plan.stripePriceId,
      "metadata[userId]": String(userId),
      "metadata[type]": "subscription",
      "metadata[planKey]": plan.key,
      "subscription_data[metadata][userId]": String(userId),
      "subscription_data[metadata][planKey]": plan.key,
      "subscription_data[trial_period_days]": String(settings.trialDurationDays),
      payment_method_collection: settings.requirePaymentMethodForTrial ? "always" : "if_required",
      "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
    });

    await ctx.runMutation(internal.billing.recordStripeCheckoutSessionInternal, {
      userId: String(userId),
      mode: "subscription",
      status: session.status ?? "open",
      stripeSessionId: session.id,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : undefined,
      stripeSubscriptionId: typeof session.subscription === "string" ? session.subscription : undefined,
      planKey: plan.key,
      amountCents: plan.priceMonthlyCents,
      currency: plan.currency,
      url: session.url,
      metadata: session.metadata ?? {},
    });

    return { url: session.url, sessionId: session.id };
  },
});

export const createBillingPortalSession = action({
  args: { returnUrl: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const customer = await ctx.runQuery(internal.billing.getStripeCustomerForUserInternal, {
      userId: String(userId),
    });
    if (!customer?.stripeCustomerId) throw new Error("No Stripe customer found");
    const appUrl = process.env.SITE_URL || "http://localhost:5173";
    const session = await stripeRequest("billing_portal/sessions", {
      customer: customer.stripeCustomerId,
      return_url: args.returnUrl ?? `${appUrl}/settings`,
    });
    return { url: session.url };
  },
});

export const createPlanChangePortalSession = action({
  args: {
    targetPlanKey: v.string(),
    returnUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ url: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const subscription = await ctx.runQuery(internal.billing.getActiveSubscriptionForUpgradeInternal, {
      userId: String(userId),
    });
    if (!subscription?.stripeCustomerId || !subscription.stripeSubscriptionId) {
      throw new Error("No active Stripe subscription found");
    }
    if (subscription.status !== "active") {
      throw new Error("Plan changes are available after your paid plan becomes active.");
    }
    const currentPlan = await ctx.runQuery(internal.billing.getBillingPlanInternal, {
      planKey: subscription.planKey,
    });
    const targetPlan = await ctx.runQuery(internal.billing.getBillingPlanInternal, {
      planKey: args.targetPlanKey,
    });
    if (!targetPlan?.isActive || !targetPlan.stripePriceId || targetPlan.key === currentPlan.key) {
      throw new Error("The selected plan is not available as a plan change.");
    }

    const stripeSubscription = await stripeRetrieve(`subscriptions/${subscription.stripeSubscriptionId}`);
    const subscriptionItemId = stripeSubscription.items?.data?.[0]?.id;
    if (!subscriptionItemId || stripeSubscription.items?.data?.length !== 1) {
      throw new Error("This subscription cannot be changed automatically. Please contact support.");
    }

    const appUrl = process.env.SITE_URL || "http://localhost:5173";
    const returnUrl = args.returnUrl ?? `${appUrl}/settings?section=billing`;
    const session = await stripeRequest("billing_portal/sessions", {
      customer: subscription.stripeCustomerId,
      return_url: returnUrl,
      "flow_data[type]": "subscription_update_confirm",
      "flow_data[after_completion][type]": "redirect",
      "flow_data[after_completion][redirect][return_url]": returnUrl,
      "flow_data[subscription_update_confirm][subscription]": subscription.stripeSubscriptionId,
      "flow_data[subscription_update_confirm][items][0][id]": subscriptionItemId,
      "flow_data[subscription_update_confirm][items][0][price]": targetPlan.stripePriceId,
    });
    return { url: session.url };
  },
});

export const activateTrialNow = action({
  args: {},
  handler: async (ctx): Promise<{ activated: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const subscription = await ctx.runQuery(internal.billing.getTrialSubscriptionForUserInternal, {
      userId: String(userId),
    });
    if (!subscription?.stripeSubscriptionId) throw new Error("No active Stripe trial found");
    const account = await ctx.runQuery(internal.billing.getCreditAccountForActivationInternal, {
      userId: String(userId),
    });
    if ((account?.reservedCredits ?? 0) > 0) {
      throw new ConvexError({
        code: "BILLING_JOBS_IN_PROGRESS",
        message: "Wait for your queued generations to finish before activating your plan.",
      });
    }
    await ctx.runMutation(internal.billing.markTrialActivatedManuallyInternal, {
      stripeSubscriptionId: subscription.stripeSubscriptionId,
    });
    try {
      await stripeRequest(`subscriptions/${subscription.stripeSubscriptionId}`, {
        trial_end: "now",
        proration_behavior: "none",
      });
    } catch (error) {
      await ctx.runMutation(internal.billing.clearManualTrialActivationInternal, {
        stripeSubscriptionId: subscription.stripeSubscriptionId,
      });
      throw error;
    }
    return { activated: true };
  },
});

export const markTrialActivatedManuallyInternal = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .first();
    if (!subscription) return;
    await ctx.db.patch(subscription._id, {
      manualTrialActivationAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const clearManualTrialActivationInternal = internalMutation({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .first();
    if (!subscription) return;
    await ctx.db.patch(subscription._id, {
      manualTrialActivationAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const estimateAgentTask = query({
  args: {
    agentType: v.string(),
    input: v.any(),
    initiatedFrom: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const estimate = await estimateAgentTaskCredits(ctx, args);
    return {
      credits: estimate.creditsPriced,
      creditSource: estimate.creditSource,
      featureKey: estimate.featureKey,
      skuBreakdown: estimate.skuBreakdown,
    };
  },
});

export const adminGrantCredits = mutation({
  args: {
    userId: v.string(),
    credits: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const adminId = await requireAdmin(ctx);
    const account = await ensureCreditAccount(ctx, args.userId);
    const nextAvailable = account.availableCredits + args.credits;
    await ctx.db.patch(account._id, {
      availableCredits: nextAvailable,
      lifetimeGrantedCredits: account.lifetimeGrantedCredits + Math.max(0, args.credits),
      updatedAt: Date.now(),
    });
    await ctx.db.insert("creditLedger", {
      userId: args.userId,
      type: "admin_grant",
      amount: args.credits,
      balanceAfter: nextAvailable,
      creditSource: "admin_grant",
      reason: args.reason,
      createdAt: Date.now(),
      createdBy: String(adminId),
    });
    return { availableCredits: nextAvailable };
  },
});

export const linkReservationToTaskInternal = internalMutation({
  args: {
    reservationId: v.id("creditReservations"),
    taskId: v.id("agentTasks"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reservationId, {
      taskId: args.taskId,
      updatedAt: Date.now(),
    });
  },
});

export const getTopUpPackageInternal = internalQuery({
  args: { packageKey: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("creditTopUpPackages")
      .withIndex("by_key", (q) => q.eq("key", args.packageKey))
      .first();
    return existing ?? DEFAULT_TOP_UP_PACKAGES.find((pack) => pack.key === args.packageKey) ?? null;
  },
});

export const getBillingPlanInternal = internalQuery({
  args: { planKey: v.string() },
  handler: async (ctx, args) => {
    return await getPlan(ctx, args.planKey);
  },
});

export const getBillingSettingsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await getBillingSettings(ctx);
  },
});

export const getReusablePlanCheckoutSessionInternal = internalQuery({
  args: {
    userId: v.string(),
    planKey: v.string(),
    amountCents: v.number(),
    currency: v.string(),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("stripeCheckoutSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
    const cutoff = Date.now() - 15 * 60 * 1000;
    return sessions.find((session) =>
      session.mode === "subscription"
      && session.status === "open"
      && session.planKey === args.planKey
      && session.amountCents === args.amountCents
      && session.currency?.toUpperCase() === args.currency.toUpperCase()
      && session.createdAt >= cutoff
      && !!session.url,
    ) ?? null;
  },
});

export const getCheckoutEligibilityInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    const current = subscriptions
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const status = subscriptionAccessStatus(current);
    const hasUsedTrial = subscriptions.some((subscription) =>
      !!subscription.trialStartedAt || subscription.status === "trialing" || !!subscription.trialCreditsGranted,
    );
    const hasCurrentAccess = status === "trialing" || status === "active" || status === "internal";
    return {
      status,
      canStartTrial: !hasUsedTrial && !hasCurrentAccess,
      canBuyTopUps: status === "active",
      reason: hasCurrentAccess
        ? "This account already has an active subscription."
        : hasUsedTrial
          ? "This account has already used its free trial."
          : undefined,
    };
  },
});

export const assertAiAccessInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const access = await requireAiAccess(ctx, args.userId);
    return { status: access.status, planKey: access.plan.key };
  },
});

export const getStripeCustomerForUserInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const subscription = await getActiveSubscription(ctx, args.userId);
    if (subscription?.stripeCustomerId) {
      return { stripeCustomerId: subscription.stripeCustomerId };
    }
    const session = await ctx.db
      .query("stripeCheckoutSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
    const withCustomer = session.find((item) => !!item.stripeCustomerId);
    return withCustomer?.stripeCustomerId
      ? {
        stripeCustomerId: withCustomer.stripeCustomerId,
        stripeTestClockId: undefined,
      }
      : null;
  },
});

export const getStripeTestClockCustomerForUserInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("stripeCheckoutSessions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);
    const marker = sessions.find((item) =>
      item.mode === "test_clock_customer" &&
      !!item.stripeCustomerId &&
      item.metadata?.source === "sirz_dev_test_clock" &&
      !!item.metadata?.stripeTestClockId,
    );
    return marker?.stripeCustomerId
      ? {
        stripeCustomerId: marker.stripeCustomerId,
        stripeTestClockId: marker.metadata.stripeTestClockId,
      }
      : null;
  },
});

export const getTrialSubscriptionForUserInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    return subscriptions
      .filter((subscription) => subscription.status === "trialing")
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  },
});

export const getActiveSubscriptionForUpgradeInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await getLatestSubscription(ctx, args.userId),
});

export const getCreditAccountForActivationInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await getCreditAccount(ctx, args.userId),
});

export const backfillBillingTransactionsInternal = internalMutation({
  args: {
    phase: v.optional(v.union(v.literal("sessions"), v.literal("invoices"))),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ phase: string; checked: number; written: number; hasMore: boolean }> => {
    const phase = args.phase ?? "sessions";
    const result = phase === "sessions"
      ? await ctx.db.query("stripeCheckoutSessions").paginate({ cursor: args.cursor ?? null, numItems: 100 })
      : await ctx.db
        .query("creditLedger")
        .filter((q) => q.and(
          q.eq(q.field("type"), "grant"),
          q.eq(q.field("creditSource"), "monthly_plan_credits"),
        ))
        .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    let written = 0;

    if (phase === "sessions") {
      for (const session of result.page as any[]) {
        if (session.mode !== "payment" || session.status !== "complete" || session.metadata?.type !== "credit_top_up") continue;
        const credits = Number(session.credits ?? session.metadata?.credits ?? 0);
        await upsertBillingTransaction(ctx, {
          key: `stripe_checkout:${session.stripeSessionId}`,
          userId: session.userId,
          type: "credit_purchase",
          status: "paid",
          title: `${credits.toLocaleString("en-US")} credit top-up`,
          amountCents: session.amountCents,
          currency: session.currency,
          credits,
          stripeCustomerId: session.stripeCustomerId,
          stripeSessionId: session.stripeSessionId,
          occurredAt: session.updatedAt ?? session.createdAt,
          metadata: { packageKey: session.packageKey, backfilled: true },
        });
        written++;
      }
    } else {
      for (const entry of result.page as any[]) {
        const invoiceId = entry.metadata?.stripeInvoiceId;
        const planKey = entry.metadata?.planKey;
        if (!invoiceId || !planKey) continue;
        const plan = await getPlan(ctx, planKey);
        const subscription = await getLatestSubscription(ctx, entry.userId);
        await upsertBillingTransaction(ctx, {
          key: `stripe_invoice:${invoiceId}`,
          userId: entry.userId,
          type: "subscription_payment",
          status: "paid",
          title: `${plan.name} subscription`,
          amountCents: undefined,
          currency: plan.currency,
          credits: entry.amount,
          stripeCustomerId: subscription?.stripeCustomerId,
          stripeInvoiceId: invoiceId,
          occurredAt: entry.createdAt,
          metadata: { planKey, stripeSubscriptionId: entry.metadata?.stripeSubscriptionId, backfilled: true },
        });
        written++;
      }
    }

    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.billing.backfillBillingTransactionsInternal, {
        phase,
        cursor: result.continueCursor,
      });
    } else if (phase === "sessions") {
      await ctx.scheduler.runAfter(0, internal.billing.backfillBillingTransactionsInternal, {
        phase: "invoices",
      });
    }
    return { phase, checked: result.page.length, written, hasMore: !result.isDone };
  },
});

export const getBackfilledInvoicesForHydrationInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const transactions = await ctx.db.query("billingTransactions").collect();
    return transactions
      .filter((transaction) => transaction.type === "subscription_payment"
        && !!transaction.stripeInvoiceId
        && transaction.metadata?.backfilled === true)
      .map((transaction) => ({
        key: transaction.key,
        stripeInvoiceId: transaction.stripeInvoiceId!,
      }));
  },
});

export const recordHydratedInvoiceTransactionInternal = internalMutation({
  args: {
    key: v.string(),
    invoice: v.any(),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const transaction = await ctx.db
      .query("billingTransactions")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!transaction) return false;
    const invoice = args.invoice;
    await ctx.db.patch(transaction._id, {
      status: invoice.status === "paid" ? "paid" : String(invoice.status ?? transaction.status),
      amountCents: Number(invoice.amount_paid ?? invoice.amount_due ?? 0),
      currency: String(invoice.currency ?? transaction.currency ?? "USD").toUpperCase(),
      stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : transaction.stripeCustomerId,
      stripePaymentIntentId: typeof invoice.payment_intent === "string" ? invoice.payment_intent : transaction.stripePaymentIntentId,
      invoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : transaction.invoiceUrl,
      occurredAt: invoice.status_transitions?.paid_at
        ? Number(invoice.status_transitions.paid_at) * 1000
        : transaction.occurredAt,
      metadata: { ...(transaction.metadata ?? {}), hydratedFromStripe: true },
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const hydrateBackfilledBillingInvoicesInternal = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number; hydrated: number }> => {
    const invoices = await ctx.runQuery(internal.billing.getBackfilledInvoicesForHydrationInternal, {});
    let hydrated = 0;
    for (const item of invoices) {
      const invoice = await stripeRetrieve(`invoices/${item.stripeInvoiceId}`);
      const updated = await ctx.runMutation(internal.billing.recordHydratedInvoiceTransactionInternal, {
        key: item.key,
        invoice,
      });
      if (updated) hydrated++;
    }
    return { checked: invoices.length, hydrated };
  },
});

export const getCreditPurchasesForReceiptHydrationInternal = internalQuery({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.key) {
      const transaction = await ctx.db
        .query("billingTransactions")
        .withIndex("by_key", (q) => q.eq("key", args.key!))
        .first();
      return transaction?.type === "credit_purchase" && transaction.stripeSessionId && !transaction.receiptUrl
        ? [transaction]
        : [];
    }
    const transactions = await ctx.db.query("billingTransactions").collect();
    return transactions
      .filter((transaction) => transaction.type === "credit_purchase" && transaction.stripeSessionId && !transaction.receiptUrl)
      .slice(0, 50);
  },
});

export const recordCreditPurchaseReceiptInternal = internalMutation({
  args: {
    key: v.string(),
    stripePaymentIntentId: v.optional(v.string()),
    stripeChargeId: v.optional(v.string()),
    receiptUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<boolean> => {
    const transaction = await ctx.db
      .query("billingTransactions")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!transaction) return false;
    await ctx.db.patch(transaction._id, {
      stripePaymentIntentId: args.stripePaymentIntentId ?? transaction.stripePaymentIntentId,
      stripeChargeId: args.stripeChargeId ?? transaction.stripeChargeId,
      receiptUrl: args.receiptUrl ?? transaction.receiptUrl,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const hydrateCreditPurchaseReceiptsInternal = internalAction({
  args: { key: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ checked: number; hydrated: number }> => {
    const purchases = await ctx.runQuery(internal.billing.getCreditPurchasesForReceiptHydrationInternal, args);
    let hydrated = 0;
    for (const purchase of purchases) {
      const session = await stripeRetrieve(`checkout/sessions/${purchase.stripeSessionId}`);
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : undefined;
      if (!paymentIntentId) continue;
      const paymentIntent = await stripeRetrieve(`payment_intents/${paymentIntentId}`);
      const chargeId = typeof paymentIntent.latest_charge === "string" ? paymentIntent.latest_charge : undefined;
      if (!chargeId) continue;
      const charge = await stripeRetrieve(`charges/${chargeId}`);
      const updated = await ctx.runMutation(internal.billing.recordCreditPurchaseReceiptInternal, {
        key: purchase.key,
        stripePaymentIntentId: paymentIntentId,
        stripeChargeId: chargeId,
        receiptUrl: typeof charge.receipt_url === "string" ? charge.receipt_url : undefined,
      });
      if (updated) hydrated++;
    }
    return { checked: purchases.length, hydrated };
  },
});

export const recordStripeCheckoutSessionInternal = internalMutation({
  args: {
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
  },
  handler: async (ctx, args): Promise<string> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("stripeCheckoutSessions")
      .withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId))
      .first();
    const payload = {
      userId: args.userId,
      mode: args.mode,
      status: args.status,
      stripeSessionId: args.stripeSessionId,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      planKey: args.planKey,
      packageKey: args.packageKey,
      credits: args.credits,
      amountCents: args.amountCents,
      currency: args.currency,
      url: args.url,
      metadata: args.metadata,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
      return existing._id;
    }
    return await ctx.db.insert("stripeCheckoutSessions", {
      ...payload,
      createdAt: now,
    });
  },
});

export const processStripeEventInternal = internalMutation({
  args: { event: v.any() },
  handler: async (ctx, args): Promise<{ processed: true; type: string } | { ignored: true; reason: string }> => {
    const event = args.event;
    const eventId = String(event.id ?? "");
    const type = String(event.type ?? "");
    if (!eventId || !type) throw new Error("Invalid Stripe event");
    const object = event.data?.object ?? {};
    const eventCreatedAt = event.created ? Number(event.created) * 1000 : undefined;

    const existing = await ctx.db
      .query("billingWebhookEvents")
      .withIndex("by_stripeEventId", (q) => q.eq("stripeEventId", eventId))
      .first();
    if (existing?.status === "processed") {
      if (type === "checkout.session.completed" && object.id) {
        await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendTrialActivatedEmail, {
          stripeSessionId: String(object.id),
        });
      } else if (type === "invoice.paid") {
        await schedulePlanActivatedEmailIfFirstInvoice(ctx, object);
      } else if (type === "customer.subscription.trial_will_end") {
        await handleSubscriptionChanged(ctx, object, eventCreatedAt, type);
      }
      return { ignored: true, reason: "already_processed" };
    }

    const now = Date.now();
    const markerId = existing?._id ?? await ctx.db.insert("billingWebhookEvents", {
      stripeEventId: eventId,
      type,
      status: "processing",
      createdAt: now,
    });

    try {
      if (type === "checkout.session.completed") {
        await handleCheckoutCompleted(ctx, object, eventCreatedAt);
      } else if (type === "invoice.paid") {
        await handleInvoicePaid(ctx, object, eventCreatedAt);
      } else if (type === "invoice.payment_failed") {
        await handleInvoicePaymentFailed(ctx, object, eventCreatedAt);
      } else if (type === "invoice.upcoming") {
        await handleInvoiceUpcoming(ctx, object, eventCreatedAt);
      } else if (type === "charge.refunded") {
        await handleChargeRefunded(ctx, object, eventCreatedAt);
      } else if (type.startsWith("customer.subscription.")) {
        await handleSubscriptionChanged(
          ctx,
          object,
          eventCreatedAt,
          type,
        );
      } else if (type.startsWith("subscription_schedule.")) {
        await handleSubscriptionScheduleChanged(ctx, object, type, eventCreatedAt);
      }

      await ctx.db.patch(markerId, {
        status: "processed",
        processedAt: Date.now(),
        error: undefined,
      });
      return { processed: true, type };
    } catch (error) {
      await ctx.db.patch(markerId, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        processedAt: Date.now(),
      });
      throw error;
    }
  },
});

export const devProcessStripeEventById = action({
  args: { eventId: v.string() },
  handler: async (ctx, args): Promise<{ processed: true; type: string } | { ignored: true; reason: string }> => {
    const guard = getStripeTestClockGuard();
    if (!guard.enabled) {
      throw new Error(`Stripe event replay is only available in local test-clock mode: ${guard.reason}`);
    }
    const event = await stripeRetrieve(`events/${args.eventId}`);
    console.log("[billing:devProcessStripeEventById] Replaying Stripe event", {
      eventId: event.id,
      type: event.type,
      created: event.created,
    });
    return await ctx.runMutation(internal.billing.processStripeEventInternal, { event });
  },
});

export const repairPaidUpgradeInvoiceInternal = internalAction({
  args: { stripeInvoiceId: v.string() },
  handler: async (ctx, args): Promise<{ repaired: true; stripeInvoiceId: string }> => {
    const invoice = await stripeRetrieve(`invoices/${args.stripeInvoiceId}`);
    if (invoice.billing_reason !== "subscription_update" || invoice.status !== "paid") {
      throw new Error("Only paid subscription upgrade invoices can be repaired");
    }
    return await ctx.runMutation(internal.billing.reprocessPaidUpgradeInvoiceInternal, { invoice });
  },
});

export const devSendPlanActivatedEmailForInvoice = action({
  args: { stripeInvoiceId: v.string() },
  handler: async (ctx, args): Promise<{ queued: true; stripeInvoiceId: string }> => {
    const guard = getStripeTestClockGuard();
    if (!guard.enabled) {
      throw new Error(`Plan activation email repair is only available in local test-clock mode: ${guard.reason}`);
    }
    const invoice = await stripeRetrieve(`invoices/${args.stripeInvoiceId}`);
    if (Number(invoice.amount_paid ?? 0) <= 0 || invoice.status !== "paid") {
      throw new Error("Only paid invoices can trigger a plan activation email");
    }
    return await ctx.runMutation(internal.billing.schedulePlanActivatedEmailForInvoiceInternal, {
      invoice,
    });
  },
});

export const schedulePlanActivatedEmailForInvoiceInternal = internalMutation({
  args: { invoice: v.any() },
  handler: async (ctx, args): Promise<{ queued: true; stripeInvoiceId: string }> => {
    await schedulePlanActivatedEmailIfFirstInvoice(ctx, args.invoice);
    return { queued: true, stripeInvoiceId: String(args.invoice.id) };
  },
});

export const devProcessLatestPaidInvoiceForCustomer = action({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args): Promise<{ processed: true; stripeInvoiceId: string }> => {
    const guard = getStripeTestClockGuard();
    if (!guard.enabled) {
      throw new Error(`Paid invoice repair is only available in local test-clock mode: ${guard.reason}`);
    }
    const invoices = await stripeGet("invoices", {
      customer: args.stripeCustomerId,
      status: "paid",
      limit: "10",
    });
    const invoice = invoices.data?.find((item: any) => Number(item.amount_paid ?? 0) > 0);
    if (!invoice) {
      throw new Error(`No paid invoice found for customer ${args.stripeCustomerId}`);
    }
    console.log("[billing:devProcessLatestPaidInvoiceForCustomer] Processing paid invoice", {
      stripeCustomerId: args.stripeCustomerId,
      stripeInvoiceId: invoice.id,
      amountPaid: invoice.amount_paid,
      billingReason: invoice.billing_reason,
    });
    return await ctx.runMutation(internal.billing.reprocessPaidInvoiceInternal, { invoice });
  },
});

export const devDiagnoseStripeCustomerBilling = action({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args): Promise<any> => {
    const guard = getStripeTestClockGuard();
    if (!guard.enabled) {
      throw new Error(`Billing diagnostics are only available in local test-clock mode: ${guard.reason}`);
    }
    const [stripeSubscriptions, stripeInvoices, local] = await Promise.all([
      stripeGet("subscriptions", { customer: args.stripeCustomerId, limit: "10" }),
      stripeGet("invoices", { customer: args.stripeCustomerId, limit: "10" }),
      ctx.runQuery(internal.billing.getLocalBillingStateForStripeCustomerInternal, {
        stripeCustomerId: args.stripeCustomerId,
      }),
    ]);
    return {
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptions: (stripeSubscriptions.data ?? []).map((subscription: any) => ({
        id: subscription.id,
        status: subscription.status,
        trialStart: subscription.trial_start,
        trialEnd: subscription.trial_end,
        currentPeriodStart: subscription.current_period_start,
        currentPeriodEnd: subscription.current_period_end,
        latestInvoice: typeof subscription.latest_invoice === "string"
          ? subscription.latest_invoice
          : subscription.latest_invoice?.id,
      })),
      stripeInvoices: (stripeInvoices.data ?? []).map((invoice: any) => ({
        id: invoice.id,
        status: invoice.status,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        billingReason: invoice.billing_reason,
        subscription: stripeSubscriptionIdFromInvoice(invoice),
        created: invoice.created,
        paidAt: invoice.status_transitions?.paid_at,
      })),
      local,
    };
  },
});

export const getLocalBillingStateForStripeCustomerInternal = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeCustomerId", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .first();
    const userId = subscription?.userId
      ?? (await userIdForStripeCustomer(ctx, args.stripeCustomerId));
    const account = userId ? await getCreditAccount(ctx, userId) : null;
    const ledger = userId
      ? await ctx.db
        .query("creditLedger")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .order("desc")
        .take(10)
      : [];
    const transactions = userId
      ? await ctx.db
        .query("billingTransactions")
        .withIndex("by_userId_occurredAt", (q) => q.eq("userId", userId))
        .order("desc")
        .take(10)
      : [];
    return {
      userId,
      subscription,
      account,
      ledger: ledger.map((entry) => ({
        type: entry.type,
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        creditSource: entry.creditSource,
        reason: entry.reason,
        metadata: entry.metadata,
        createdAt: entry.createdAt,
      })),
      transactions: transactions.map((transaction) => ({
        type: transaction.type,
        status: transaction.status,
        title: transaction.title,
        amountCents: transaction.amountCents,
        credits: transaction.credits,
        stripeInvoiceId: transaction.stripeInvoiceId,
        createdAt: transaction.createdAt,
      })),
    };
  },
});

export const reprocessPaidInvoiceInternal = internalMutation({
  args: { invoice: v.any() },
  handler: async (ctx, args): Promise<{ processed: true; stripeInvoiceId: string }> => {
    await handleInvoicePaid(ctx, args.invoice);
    return { processed: true, stripeInvoiceId: String(args.invoice.id) };
  },
});

export const reprocessPaidUpgradeInvoiceInternal = internalMutation({
  args: { invoice: v.any() },
  handler: async (ctx, args): Promise<{ repaired: true; stripeInvoiceId: string }> => {
    const invoice = args.invoice;
    const stripeSubscriptionId = stripeSubscriptionIdFromInvoice(invoice);
    if (!stripeSubscriptionId) throw new Error("Stripe invoice has no subscription");
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
      .first();
    if (!subscription) throw new Error("SIRz subscription was not found");

    await reverseIncorrectUpgradeTrialExpiry(ctx, subscription.userId, String(invoice.id));
    await handleInvoicePaid(ctx, invoice);
    return { repaired: true, stripeInvoiceId: String(invoice.id) };
  },
});

// export const releaseExpiredReservationsInternal = internalMutation({
//   args: v.optional(v.object({ limit: v.optional(v.number()) })),
//   handler: async (ctx, args): Promise<{ released: number }> => {
//     const now = Date.now();
//     const reservations = await ctx.db
//       .query("creditReservations")
//       .collect();
//     const expired = reservations
//       .filter((reservation) => reservation.status === "reserved" && reservation.expiresAt <= now)
//       .slice(0, args.limit ?? 100);

//     for (const reservation of expired) {
//       const account = await getCreditAccount(ctx, reservation.userId);
//       if (account) {
//         await ctx.db.patch(account._id, {
//           availableCredits: account.availableCredits + reservation.estimatedCredits,
//           reservedCredits: Math.max(0, account.reservedCredits - reservation.estimatedCredits),
//           updatedAt: now,
//         });
//       }
//       await ctx.db.patch(reservation._id, {
//         status: "expired",
//         chargedCredits: 0,
//         releasedCredits: reservation.estimatedCredits,
//         updatedAt: now,
//       });
//       await ctx.db.insert("creditLedger", {
//         userId: reservation.userId,
//         brandId: reservation.brandId,
//         campaignId: reservation.campaignId,
//         taskId: reservation.taskId,
//         reservationId: reservation._id,
//         type: "release",
//         amount: reservation.estimatedCredits,
//         balanceAfter: account ? account.availableCredits + reservation.estimatedCredits : undefined,
//         creditSource: reservation.creditSource,
//         reason: "Expired unused credit reservation",
//         metadata: { skuBreakdown: reservation.skuBreakdown },
//         createdAt: now,
//         createdBy: "system",
//       });
//     }

//     return { released: expired.length };
//   },
// });

export const releaseExpiredReservationsInternal = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },

  handler: async (ctx, args): Promise<{ released: number }> => {
    const now = Date.now();

    const reservations = await ctx.db
      .query("creditReservations")
      .collect();

    const expired = reservations
      .filter(
        (reservation) =>
          reservation.status === "reserved" &&
          reservation.expiresAt <= now,
      )
      .slice(0, args.limit ?? 100);

        for (const reservation of expired) {
      const account = await getCreditAccount(ctx, reservation.userId);
      if (account) {
        await ctx.db.patch(account._id, {
          availableCredits: account.availableCredits + reservation.estimatedCredits,
          reservedCredits: Math.max(0, account.reservedCredits - reservation.estimatedCredits),
          updatedAt: now,
        });
      }
      await ctx.db.patch(reservation._id, {
        status: "expired",
        chargedCredits: 0,
        releasedCredits: reservation.estimatedCredits,
        updatedAt: now,
      });
      await ctx.db.insert("creditLedger", {
        userId: reservation.userId,
        brandId: reservation.brandId,
        campaignId: reservation.campaignId,
        taskId: reservation.taskId,
        reservationId: reservation._id,
        type: "release",
        amount: reservation.estimatedCredits,
        balanceAfter: account ? account.availableCredits + reservation.estimatedCredits : undefined,
        creditSource: reservation.creditSource,
        reason: "Expired unused credit reservation",
        metadata: { skuBreakdown: reservation.skuBreakdown },
        createdAt: now,
        createdBy: "system",
      });
    }

    return {
      released: expired.length,
    };
  },
});

export const cleanupStaleGenerationThrottleBucketsInternal = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const staleBefore = Date.now() - 24 * 60 * 60 * 1000;
    const buckets = await ctx.db.query("generationThrottleBuckets").collect();
    const stale = buckets.filter((bucket) => bucket.updatedAt < staleBefore).slice(0, 200);
    for (const bucket of stale) await ctx.db.delete(bucket._id);
    return { deleted: stale.length };
  },
});

export const reconcileLowCreditNotificationsInternal = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ checked: number; scheduled: number; hasMore: boolean }> => {
    const page = await ctx.db.query("creditAccounts").paginate({
      cursor: args.cursor ?? null,
      numItems: 100,
    });
    let scheduled = 0;
    for (const account of page.page) {
      if (await maybeScheduleLowCreditEmail(ctx, account.userId)) scheduled++;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.billing.reconcileLowCreditNotificationsInternal, {
        cursor: page.continueCursor,
      });
    }
    return {
      checked: page.page.length,
      scheduled,
      hasMore: !page.isDone,
    };
  },
});

export const reserveSkuOperationInternal = internalMutation({
  args: {
    userId: v.string(),
    brandId: v.optional(v.id("brands")),
    campaignId: v.optional(v.id("campaigns")),
    taskId: v.optional(v.id("agentTasks")),
    featureKey: v.string(),
    skuKey: v.string(),
    units: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args): Promise<{
    reservationId?: import("./_generated/dataModel").Id<"creditReservations">;
    creditsPriced: number;
    creditsChargedToCustomer: number;
    creditSource: string;
    skuKey: string;
  }> => {
    const sku = await getSku(ctx, args.skuKey);
    const units = Math.max(0, args.units ?? 1);
    const creditsPriced = Math.ceil(units * sku.creditsPerUnit);
    const estimate = {
      featureKey: args.featureKey,
      primarySkuKey: sku.key,
      creditsPriced,
      creditsChargedToCustomer: creditsPriced,
      creditSource: sku.defaultCreditSource,
      skuBreakdown: [{
        skuKey: sku.key,
        units,
        credits: creditsPriced,
        provider: sku.provider,
        model: sku.model,
        estimatedProviderCostCents: units * sku.providerCostPerUnitCents,
        defaultCreditSource: sku.defaultCreditSource,
      }],
    };
    const access = await requireAiAccess(ctx, args.userId);
    const plan = access.plan;
    await checkAndRecordRateLimit(ctx, {
      userId: args.userId,
      featureKey: args.featureKey,
    });

    let user: any = null;
    try {
      user = await ctx.db.get(args.userId as any);
    } catch {
      user = null;
    }
    const isInternalBypass = plan.key === "internal" || user?.role === "admin";
    const resolvedCreditSource = access.status === "trialing"
      ? "trial_credits"
      : await resolveCreditSource(ctx, { userId: args.userId, plan, estimate });
    const now = Date.now();

    if ((resolvedCreditSource === "platform_covered" && access.status !== "trialing") || isInternalBypass || creditsPriced <= 0) {
      await recordOperationUsage(ctx, {
        ...args,
        sku,
        units,
        creditsPriced,
        creditsChargedToCustomer: 0,
        creditSource: isInternalBypass ? "admin_grant" : resolvedCreditSource,
        status: "submitted",
        metadata: args.metadata,
      });
      return {
        reservationId: undefined,
        creditsPriced,
        creditsChargedToCustomer: 0,
        creditSource: isInternalBypass ? "admin_grant" : resolvedCreditSource,
        skuKey: sku.key,
      };
    }

    const account = await ensureCreditAccount(ctx, args.userId, plan);
    if (account.availableCredits < creditsPriced) {
      throw new Error(`Insufficient credits. Needed ${creditsPriced}, available ${account.availableCredits}.`);
    }

    const reservationId = await ctx.db.insert("creditReservations", {
      userId: args.userId,
      brandId: args.brandId,
      campaignId: args.campaignId,
      taskId: args.taskId,
      status: "reserved",
      estimatedCredits: creditsPriced,
      chargedCredits: 0,
      releasedCredits: 0,
      featureKey: args.featureKey,
      skuBreakdown: estimate.skuBreakdown,
      creditSource: resolvedCreditSource,
      expiresAt: now + RESERVATION_TTL_MS,
      createdAt: now,
      updatedAt: now,
    });

    const nextAvailable = account.availableCredits - creditsPriced;
    await ctx.db.patch(account._id, {
      availableCredits: nextAvailable,
      reservedCredits: account.reservedCredits + creditsPriced,
      updatedAt: now,
    });
    await ctx.db.insert("creditLedger", {
      userId: args.userId,
      brandId: args.brandId,
      campaignId: args.campaignId,
      taskId: args.taskId,
      reservationId,
      type: "reserve",
      amount: creditsPriced,
      balanceAfter: nextAvailable,
      skuKey: sku.key,
      creditSource: resolvedCreditSource,
      reason: `Reserved for ${args.featureKey}`,
      metadata: args.metadata,
      createdAt: now,
      createdBy: "system",
    });
    await recordOperationUsage(ctx, {
      ...args,
      reservationId,
      sku,
      units,
      creditsPriced,
      creditsChargedToCustomer: creditsPriced,
      creditSource: resolvedCreditSource,
      status: "submitted",
      metadata: args.metadata,
    });

    return {
      reservationId,
      creditsPriced,
      creditsChargedToCustomer: creditsPriced,
      creditSource: resolvedCreditSource,
      skuKey: sku.key,
    };
  },
});

export const chargeReservationInternal = internalMutation({
  args: {
    reservationId: v.optional(v.id("creditReservations")),
    userId: v.string(),
    skuKey: v.string(),
    taskId: v.optional(v.id("agentTasks")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ charged: number }> => {
    const now = Date.now();
    if (!args.reservationId) {
      await patchUsageEventsForOperation(ctx, args, { status: "succeeded", updatedAt: now });
      return { charged: 0 };
    }
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.status !== "reserved") return { charged: 0 };
    const account = await getCreditAccount(ctx, reservation.userId);
    if (account) {
      await ctx.db.patch(account._id, {
        reservedCredits: Math.max(0, account.reservedCredits - reservation.estimatedCredits),
        lifetimeConsumedCredits: account.lifetimeConsumedCredits + reservation.estimatedCredits,
        updatedAt: now,
      });
    }
    await ctx.db.patch(reservation._id, {
      status: "charged",
      chargedCredits: reservation.estimatedCredits,
      releasedCredits: 0,
      updatedAt: now,
    });
    await ctx.db.insert("creditLedger", {
      userId: reservation.userId,
      brandId: reservation.brandId,
      campaignId: reservation.campaignId,
      taskId: args.taskId ?? reservation.taskId,
      reservationId: reservation._id,
      type: "charge",
      amount: reservation.estimatedCredits,
      balanceAfter: account?.availableCredits,
      skuKey: args.skuKey,
      creditSource: reservation.creditSource,
      reason: args.reason ?? `Charged for ${reservation.featureKey}`,
      metadata: { skuBreakdown: reservation.skuBreakdown },
      createdAt: now,
      createdBy: "system",
    });
    await patchUsageEventsForOperation(ctx, args, { status: "succeeded", updatedAt: now });
    await maybeScheduleLowCreditEmail(ctx, reservation.userId);
    return { charged: reservation.estimatedCredits };
  },
});

export const releaseReservationInternal = internalMutation({
  args: {
    reservationId: v.optional(v.id("creditReservations")),
    userId: v.string(),
    skuKey: v.string(),
    taskId: v.optional(v.id("agentTasks")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ released: number }> => {
    const now = Date.now();
    if (!args.reservationId) {
      await patchUsageEventsForOperation(ctx, args, { status: "failed", updatedAt: now });
      return { released: 0 };
    }
    const reservation = await ctx.db.get(args.reservationId);
    if (!reservation || reservation.status !== "reserved") return { released: 0 };
    const account = await getCreditAccount(ctx, reservation.userId);
    if (account) {
      await ctx.db.patch(account._id, {
        availableCredits: account.availableCredits + reservation.estimatedCredits,
        reservedCredits: Math.max(0, account.reservedCredits - reservation.estimatedCredits),
        updatedAt: now,
      });
    }
    await ctx.db.patch(reservation._id, {
      status: "released",
      chargedCredits: 0,
      releasedCredits: reservation.estimatedCredits,
      updatedAt: now,
    });
    await ctx.db.insert("creditLedger", {
      userId: reservation.userId,
      brandId: reservation.brandId,
      campaignId: reservation.campaignId,
      taskId: args.taskId ?? reservation.taskId,
      reservationId: reservation._id,
      type: "release",
      amount: reservation.estimatedCredits,
      balanceAfter: account ? account.availableCredits + reservation.estimatedCredits : undefined,
      skuKey: args.skuKey,
      creditSource: reservation.creditSource,
      reason: args.reason ?? `Released for ${reservation.featureKey}`,
      metadata: { skuBreakdown: reservation.skuBreakdown },
      createdAt: now,
      createdBy: "system",
    });
    await patchUsageEventsForOperation(ctx, args, { status: "failed", updatedAt: now });
    return { released: reservation.estimatedCredits };
  },
});

export async function reserveForAgentTask(ctx: any, args: AgentEstimateArgs) {
  const estimate = await estimateAgentTaskCredits(ctx, args);
  if (!args.userId) {
    return { ...estimate, creditsChargedToCustomer: 0, creditSource: "platform_covered", reservationId: undefined };
  }
  const access = await requireAiAccess(ctx, args.userId);
  const plan = access.plan;
  await checkAndRecordRateLimit(ctx, {
    userId: args.userId,
    featureKey: estimate.featureKey,
  });

  if (estimate.creditsPriced <= 0) {
    return { ...estimate, reservationId: undefined };
  }

  let user: any = null;
  try {
    user = await ctx.db.get(args.userId as any);
  } catch {
    user = null;
  }
  const isInternalBypass = plan.key === "internal" || user?.role === "admin";
  const resolvedCreditSource = access.status === "trialing"
    ? "trial_credits"
    : await resolveCreditSource(ctx, { userId: args.userId, plan, estimate });

  if ((resolvedCreditSource === "platform_covered" && access.status !== "trialing") || isInternalBypass) {
    return {
      ...estimate,
      creditSource: isInternalBypass ? "admin_grant" : resolvedCreditSource,
      creditsChargedToCustomer: 0,
      reservationId: undefined,
    };
  }

  const account = await ensureCreditAccount(ctx, args.userId, plan);
  if (account.availableCredits < estimate.creditsPriced) {
    throw new Error(`Insufficient credits. Needed ${estimate.creditsPriced}, available ${account.availableCredits}.`);
  }

  const now = Date.now();
  const reservationId = await ctx.db.insert("creditReservations", {
    userId: args.userId,
    brandId: args.brandId,
    campaignId: args.campaignId,
    status: "reserved",
    estimatedCredits: estimate.creditsPriced,
    chargedCredits: 0,
    releasedCredits: 0,
    featureKey: estimate.featureKey,
    skuBreakdown: estimate.skuBreakdown,
    creditSource: resolvedCreditSource,
    expiresAt: now + RESERVATION_TTL_MS,
    createdAt: now,
    updatedAt: now,
  });

  const nextAvailable = account.availableCredits - estimate.creditsPriced;
  await ctx.db.patch(account._id, {
    availableCredits: nextAvailable,
    reservedCredits: account.reservedCredits + estimate.creditsPriced,
    updatedAt: now,
  });
  await ctx.db.insert("creditLedger", {
    userId: args.userId,
    brandId: args.brandId,
    campaignId: args.campaignId,
    reservationId,
    type: "reserve",
    amount: estimate.creditsPriced,
    balanceAfter: nextAvailable,
    skuKey: estimate.primarySkuKey,
    creditSource: resolvedCreditSource,
    reason: `Reserved for ${estimate.featureKey}`,
    metadata: { skuBreakdown: estimate.skuBreakdown },
    createdAt: now,
    createdBy: "system",
  });

  return {
    ...estimate,
    creditSource: resolvedCreditSource,
    creditsChargedToCustomer: estimate.creditsPriced,
    reservationId,
  };
}

export async function recordTaskSubmittedUsage(ctx: any, args: {
  taskId: any;
  userId?: string;
  brandId?: any;
  campaignId?: any;
  estimate: Awaited<ReturnType<typeof reserveForAgentTask>>;
}) {
  if (args.estimate.creditsPriced <= 0 || args.estimate.skuBreakdown.length === 0) return;
  const now = Date.now();
  for (const line of args.estimate.skuBreakdown) {
    const share = args.estimate.creditsPriced > 0 ? line.credits / args.estimate.creditsPriced : 0;
    await ctx.db.insert("aiUsageEvents", {
      userId: args.userId,
      brandId: args.brandId,
      taskId: args.taskId,
      campaignId: args.campaignId,
      featureKey: args.estimate.featureKey,
      skuKey: line.skuKey,
      provider: line.provider,
      model: line.model,
      units: line.units,
      estimatedProviderCostCents: line.estimatedProviderCostCents,
      creditsPriced: line.credits,
      creditsChargedToCustomer: Math.round((args.estimate.creditsChargedToCustomer ?? 0) * share),
      creditSource: args.estimate.creditSource,
      status: "submitted",
      createdAt: now,
    });
  }
}

export async function finalizeTaskBilling(ctx: any, task: any) {
  if (!task) return;
  const now = Date.now();
  const reservation = task.reservationId ? await ctx.db.get(task.reservationId) : null;
  if (reservation && reservation.status === "reserved") {
    const account = await getCreditAccount(ctx, reservation.userId);
    if (account) {
      await ctx.db.patch(account._id, {
        reservedCredits: Math.max(0, account.reservedCredits - reservation.estimatedCredits),
        lifetimeConsumedCredits: account.lifetimeConsumedCredits + reservation.estimatedCredits,
        updatedAt: now,
      });
    }
    await ctx.db.patch(reservation._id, {
      status: "charged",
      chargedCredits: reservation.estimatedCredits,
      releasedCredits: 0,
      updatedAt: now,
    });
    await ctx.db.insert("creditLedger", {
      userId: reservation.userId,
      brandId: reservation.brandId,
      campaignId: reservation.campaignId,
      taskId: task._id,
      reservationId: reservation._id,
      type: "charge",
      amount: reservation.estimatedCredits,
      balanceAfter: account?.availableCredits,
      skuKey: task.skuKey,
      creditSource: reservation.creditSource,
      reason: `Charged for ${reservation.featureKey}`,
      metadata: { skuBreakdown: reservation.skuBreakdown },
      createdAt: now,
      createdBy: "system",
    });
    await maybeScheduleLowCreditEmail(ctx, reservation.userId);
  }

  await patchUsageEventsForTask(ctx, task._id, {
    status: "succeeded",
    providerRequestId: task.falRequestId,
    updatedAt: now,
  });
}

export async function releaseTaskBilling(ctx: any, task: any, reason = "Generation failed") {
  if (!task) return;
  const now = Date.now();
  const reservation = task.reservationId ? await ctx.db.get(task.reservationId) : null;
  if (reservation && reservation.status === "reserved") {
    const account = await getCreditAccount(ctx, reservation.userId);
    if (account) {
      await ctx.db.patch(account._id, {
        availableCredits: account.availableCredits + reservation.estimatedCredits,
        reservedCredits: Math.max(0, account.reservedCredits - reservation.estimatedCredits),
        updatedAt: now,
      });
    }
    await ctx.db.patch(reservation._id, {
      status: "released",
      chargedCredits: 0,
      releasedCredits: reservation.estimatedCredits,
      updatedAt: now,
    });
    await ctx.db.insert("creditLedger", {
      userId: reservation.userId,
      brandId: reservation.brandId,
      campaignId: reservation.campaignId,
      taskId: task._id,
      reservationId: reservation._id,
      type: "release",
      amount: reservation.estimatedCredits,
      balanceAfter: account ? account.availableCredits + reservation.estimatedCredits : undefined,
      skuKey: task.skuKey,
      creditSource: reservation.creditSource,
      reason,
      metadata: { skuBreakdown: reservation.skuBreakdown },
      createdAt: now,
      createdBy: "system",
    });
  }

  await patchUsageEventsForTask(ctx, task._id, {
    status: "failed",
    updatedAt: now,
  });
}

async function handleCheckoutCompleted(ctx: any, session: any, eventCreatedAt?: number) {
  const metadata = session.metadata ?? {};
  const userId = String(metadata.userId || session.client_reference_id || "");
  if (!userId) throw new Error("Stripe checkout session missing userId metadata");

  const mode = String(session.mode ?? "");
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : undefined;
  const stripeSubscriptionId = typeof session.subscription === "string" ? session.subscription : undefined;
  const now = eventCreatedAt ?? Date.now();

  const existingSession = await ctx.db
    .query("stripeCheckoutSessions")
    .withIndex("by_stripeSessionId", (q: any) => q.eq("stripeSessionId", session.id))
    .first();
  const sessionPatch = {
    status: String(session.status ?? "complete"),
    stripeCustomerId,
    stripeSubscriptionId,
    updatedAt: now,
  };
  if (existingSession) {
    await ctx.db.patch(existingSession._id, sessionPatch);
  } else {
    await ctx.db.insert("stripeCheckoutSessions", {
      userId,
      mode,
      status: String(session.status ?? "complete"),
      stripeSessionId: String(session.id),
      stripeCustomerId,
      stripeSubscriptionId,
      planKey: metadata.planKey,
      packageKey: metadata.packageKey,
      credits: metadata.credits ? Number(metadata.credits) : undefined,
      amountCents: session.amount_total ?? undefined,
      currency: session.currency?.toUpperCase(),
      metadata,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (mode === "payment" && metadata.type === "credit_top_up") {
    const credits = Number(metadata.credits ?? 0);
    if (!credits || credits <= 0) throw new Error("Credit top-up checkout missing credits");
    await upsertBillingTransaction(ctx, {
      key: `stripe_checkout:${session.id}`,
      userId,
      type: "credit_purchase",
      status: session.payment_status === "paid" ? "paid" : String(session.payment_status ?? "complete"),
      title: `${credits.toLocaleString("en-US")} credit top-up`,
      amountCents: Number(session.amount_total ?? 0),
      currency: String(session.currency ?? "USD").toUpperCase(),
      credits,
      stripeCustomerId,
      stripeSessionId: String(session.id),
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : undefined,
      stripeInvoiceId: typeof session.invoice === "string" ? session.invoice : undefined,
      occurredAt: session.created ? Number(session.created) * 1000 : now,
      metadata: { packageKey: metadata.packageKey, invoicePolicy: metadata.invoicePolicy },
    });
    await ctx.scheduler.runAfter(0, internal.billing.hydrateCreditPurchaseReceiptsInternal, {
      key: `stripe_checkout:${session.id}`,
    });
    await grantCreditsIfNeeded(ctx, {
      userId,
      amount: credits,
      creditSource: "top_up_credits",
      type: "purchase",
      reason: `Purchased ${credits} credits`,
      grantKey: `stripe_checkout:${session.id}`,
      metadata: {
        stripeSessionId: session.id,
        stripeCustomerId,
        packageKey: metadata.packageKey,
        amountTotal: session.amount_total,
        currency: session.currency,
        expiresAfterDays: metadata.expiresAfterDays ? Number(metadata.expiresAfterDays) : undefined,
      },
    });
    const account = await getCreditAccount(ctx, userId);
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
      deliveryKey: `top_up_completed:v1:${session.id}`,
      userId,
      type: "top_up_completed",
      payload: {
        creditsAdded: credits,
        balance: account?.availableCredits ?? credits,
        amountPaidCents: Number(session.amount_total ?? 0),
        currency: String(session.currency ?? "USD").toUpperCase(),
        stripeSessionId: String(session.id),
      },
    });
  }

  if (mode === "subscription") {
    const planKey = String(metadata.planKey || "");
    if (!planKey) throw new Error("Subscription checkout missing planKey");
    const plan = await getPlan(ctx, planKey);
    const settings = await getBillingSettings(ctx);
    const trialEndsAt = now + settings.trialDurationDays * 24 * 60 * 60 * 1000;
    await upsertSubscription(ctx, {
      userId,
      plan,
      stripeCustomerId,
      stripeSubscriptionId,
      status: "trialing",
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt,
      trialStartedAt: now,
      trialEndsAt,
      trialCreditsGranted: settings.trialCredits,
    });
    await grantCreditsIfNeeded(ctx, {
      userId,
      amount: settings.trialCredits,
      creditSource: "trial_credits",
      type: "grant",
      reason: "SIRz free trial credits",
      grantKey: `stripe_trial_start:${stripeSubscriptionId ?? session.id}`,
      metadata: {
        stripeSessionId: session.id,
        stripeSubscriptionId,
        targetPlanKey: plan.key,
        trialEndsAt,
      },
    });
    const brand = await ctx.db
      .query("brands")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId as any))
      .filter((q: any) => q.eq(q.field("status"), "active"))
      .first();
    if (brand) {
      await ctx.db.patch(brand._id, { templatesStatus: "pending" });
      await ctx.scheduler.runAfter(0, internal.campaignTemplates.generateFirstRunTemplates, {
        brandId: brand._id,
      });
    }
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendTrialActivatedEmail, {
      stripeSessionId: String(session.id),
    });
  }
}

async function handleInvoicePaid(ctx: any, invoice: any, eventCreatedAt?: number) {
  if (Number(invoice.amount_paid ?? 0) <= 0) return;
  const stripeSubscriptionId = stripeSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;

  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
    .first();
  const metadata = invoice.subscription_details?.metadata ?? invoice.parent?.subscription_details?.metadata ?? {};
  const userId = subscription?.userId ?? metadata.userId;
  const invoicePlanKey = await planKeyForStripePrice(ctx, stripePriceIdFromInvoice(invoice));
  const planKey = invoicePlanKey ?? subscription?.pendingPlanKey ?? subscription?.planKey ?? metadata.planKey;
  if (!userId || !planKey) return;

  const plan = await getPlan(ctx, planKey);
  const hasExistingMonthlyGrant = await hasMonthlyPlanCreditGrant(ctx, String(userId));
  const isUpgradeInvoice = invoice.billing_reason === "subscription_update" && hasExistingMonthlyGrant;
  const wasTrialing = subscription?.status === "trialing" || !hasExistingMonthlyGrant;
  const existingInvoiceTransaction = await ctx.db
    .query("billingTransactions")
    .withIndex("by_key", (q: any) => q.eq("key", `stripe_invoice:${invoice.id}`))
    .first();
  const existingUpgradeGrant = isUpgradeInvoice
    ? (await ctx.db
      .query("creditLedger")
      .withIndex("by_userId", (q: any) => q.eq("userId", String(userId)))
      .collect())
      .find((entry: any) => entry.metadata?.grantKey === `stripe_upgrade:${invoice.id}`)
    : undefined;
  let creditsToGrant = plan.includedCredits;
  if (isUpgradeInvoice) {
    if (subscription?.pendingUpgradeCredits !== undefined) {
      creditsToGrant = subscription.pendingUpgradeCredits;
    } else if (subscription?.planKey && subscription.planKey !== plan.key) {
      const previousPlan = await getPlan(ctx, subscription.planKey);
      const targetLine = targetPlanLineFromInvoice(invoice);
      creditsToGrant = proratedUpgradeCredits(
        previousPlan,
        plan,
        targetLine?.period?.start
          ? targetLine.period.start * 1000
          : subscription.currentPeriodStart,
        targetLine?.period?.end
          ? targetLine.period.end * 1000
          : subscription.currentPeriodEnd,
        eventCreatedAt ?? Date.now(),
      );
    } else {
      creditsToGrant = Number(existingUpgradeGrant?.amount ?? existingInvoiceTransaction?.credits ?? 0);
    }
  }
  await upsertBillingTransaction(ctx, {
    key: `stripe_invoice:${invoice.id}`,
    userId: String(userId),
    type: "subscription_payment",
    status: "paid",
    title: isUpgradeInvoice ? `Upgrade to ${plan.name}` : `${plan.name} subscription`,
    amountCents: Number(invoice.amount_paid ?? 0),
    currency: String(invoice.currency ?? plan.currency ?? "USD").toUpperCase(),
    credits: creditsToGrant,
    stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : subscription?.stripeCustomerId,
    stripeInvoiceId: String(invoice.id),
    stripePaymentIntentId: typeof invoice.payment_intent === "string" ? invoice.payment_intent : undefined,
    invoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : undefined,
    occurredAt: invoice.status_transitions?.paid_at
      ? Number(invoice.status_transitions.paid_at) * 1000
      : eventCreatedAt ?? Date.now(),
    metadata: { stripeSubscriptionId, planKey, billingReason: invoice.billing_reason },
  });
  if (!isUpgradeInvoice && !hasExistingMonthlyGrant) {
    await expireTrialCredits(ctx, userId, `stripe_invoice:${invoice.id}`);
  }
  if (subscription && (subscription.status !== "active" || subscription.planKey !== plan.key || isUpgradeInvoice)) {
    await ctx.db.patch(subscription._id, {
      status: "active",
      planKey: plan.key,
      planVersion: plan.version ?? BILLING_CONFIG_VERSION,
      convertedAt: subscription.convertedAt ?? eventCreatedAt ?? Date.now(),
      previousPlanKey: isUpgradeInvoice ? undefined : subscription.previousPlanKey,
      pendingPlanKey: undefined,
      pendingUpgradeCredits: undefined,
      pendingPlanChangedAt: undefined,
      pendingPlanEffectiveAt: undefined,
      updatedAt: Date.now(),
    });
  }
  if (creditsToGrant > 0) {
    await grantCreditsIfNeeded(ctx, {
      userId,
      amount: creditsToGrant,
      creditSource: "monthly_plan_credits",
      type: "grant",
      reason: isUpgradeInvoice ? `Prorated upgrade credits for ${plan.name}` : `${plan.name} monthly credits`,
      grantKey: `${isUpgradeInvoice ? "stripe_upgrade" : "stripe_invoice"}:${invoice.id}`,
      metadata: {
        stripeInvoiceId: invoice.id,
        stripeSubscriptionId,
        planKey,
        billingReason: invoice.billing_reason,
        periodStart: invoice.period_start ? invoice.period_start * 1000 : undefined,
        periodEnd: invoice.period_end ? invoice.period_end * 1000 : undefined,
      },
    });
  }
  const creditAccount = await getCreditAccount(ctx, String(userId));
  if (creditAccount && creditAccount.planKey !== plan.key) {
    await ctx.db.patch(creditAccount._id, { planKey: plan.key, updatedAt: Date.now() });
  }
  await scheduleTemplateEntitlementSyncForUser(ctx, String(userId));
  if (isUpgradeInvoice) {
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
      deliveryKey: `plan_upgraded:v3:${String(invoice.id)}`,
      userId: String(userId),
      type: "plan_upgraded",
      payload: {
        planName: plan.name,
        credits: creditsToGrant,
        amountPaidCents: Number(invoice.amount_paid ?? 0),
        currency: String(invoice.currency ?? plan.currency ?? "USD").toUpperCase(),
        nextRenewalAt: subscription?.currentPeriodEnd,
        invoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : undefined,
      },
    });
  } else if (wasTrialing) {
    await schedulePlanActivatedEmailForInvoice(ctx, invoice, String(userId), String(planKey));
  } else {
    await schedulePlanActivatedEmailIfFirstInvoice(ctx, invoice, String(userId), String(planKey));
  }
}

async function schedulePlanActivatedEmailForInvoice(
  ctx: any,
  invoice: any,
  knownUserId?: string,
  knownPlanKey?: string,
) {
  if (!invoice?.id || Number(invoice.amount_paid ?? 0) <= 0) return;
  const stripeSubscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : typeof invoice.parent?.subscription_details?.subscription === "string"
      ? invoice.parent.subscription_details.subscription
      : undefined;
  const subscription = stripeSubscriptionId
    ? await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
      .first()
    : null;
  const metadata = invoice.subscription_details?.metadata ?? invoice.parent?.subscription_details?.metadata ?? {};
  const userId = knownUserId ?? subscription?.userId ?? metadata.userId;
  const planKey = knownPlanKey ?? subscription?.planKey ?? metadata.planKey;
  if (!userId || !planKey) return;

  await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendPlanActivatedEmail, {
    userId: String(userId),
    planKey: String(planKey),
    stripeInvoiceId: String(invoice.id),
    amountPaidCents: Number(invoice.amount_paid),
    currency: String(invoice.currency ?? "usd").toUpperCase(),
    nextRenewalAt: invoice.period_end ? Number(invoice.period_end) * 1000 : subscription?.currentPeriodEnd,
    invoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : undefined,
  });
}

async function scheduleTemplateEntitlementSyncForUser(ctx: any, userId: string) {
  const brand = await ctx.db
    .query("brands")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId as any))
    .filter((q: any) => q.eq(q.field("status"), "active"))
    .first();
  if (!brand) return;
  await ctx.db.patch(brand._id, { templatesStatus: "pending" });
  await ctx.scheduler.runAfter(0, internal.campaignTemplates.generateFirstRunTemplates, {
    brandId: brand._id,
  });
}

async function schedulePlanActivatedEmailIfFirstInvoice(
  ctx: any,
  invoice: any,
  knownUserId?: string,
  knownPlanKey?: string,
) {
  if (!invoice?.id || Number(invoice.amount_paid ?? 0) <= 0) return;
  const stripeSubscriptionId = stripeSubscriptionIdFromInvoice(invoice);
  const subscription = stripeSubscriptionId
    ? await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
      .first()
    : null;
  const metadata = invoice.subscription_details?.metadata ?? invoice.parent?.subscription_details?.metadata ?? {};
  const userId = knownUserId ?? subscription?.userId ?? metadata.userId;
  const planKey = knownPlanKey ?? subscription?.planKey ?? metadata.planKey;
  if (!userId || !planKey) return;

  const ledger = await ctx.db
    .query("creditLedger")
    .withIndex("by_userId", (q: any) => q.eq("userId", String(userId)))
    .collect();
  const firstMonthlyGrant = ledger
    .filter((entry: any) => entry.creditSource === "monthly_plan_credits" && entry.type === "grant")
    .sort((a: any, b: any) => a.createdAt - b.createdAt)[0];
  if (firstMonthlyGrant?.metadata?.stripeInvoiceId !== String(invoice.id)) return;

  await schedulePlanActivatedEmailForInvoice(ctx, invoice, String(userId), String(planKey));
}

async function handleInvoicePaymentFailed(ctx: any, invoice: any, eventCreatedAt?: number) {
  const stripeSubscriptionId = typeof invoice.subscription === "string"
    ? invoice.subscription
    : typeof invoice.parent?.subscription_details?.subscription === "string"
      ? invoice.parent.subscription_details.subscription
      : undefined;
  if (!stripeSubscriptionId) return;
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
    .first();
  if (!subscription) return;
  const plan = await getPlan(ctx, subscription.planKey);
  await upsertBillingTransaction(ctx, {
    key: `stripe_invoice:${invoice.id}`,
    userId: subscription.userId,
    type: "subscription_payment",
    status: "failed",
    title: `${plan.name} subscription`,
    amountCents: Number(invoice.amount_due ?? 0),
    currency: String(invoice.currency ?? plan.currency ?? "USD").toUpperCase(),
    credits: plan.includedCredits,
    stripeCustomerId: typeof invoice.customer === "string" ? invoice.customer : subscription.stripeCustomerId,
    stripeInvoiceId: String(invoice.id),
    invoiceUrl: typeof invoice.hosted_invoice_url === "string" ? invoice.hosted_invoice_url : undefined,
    occurredAt: invoice.status_transitions?.finalized_at
      ? Number(invoice.status_transitions.finalized_at) * 1000
      : invoice.created
        ? Number(invoice.created) * 1000
        : eventCreatedAt ?? Date.now(),
    metadata: { stripeSubscriptionId, planKey: subscription.planKey },
  });
  await ctx.db.patch(subscription._id, {
    status: "past_due",
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
    deliveryKey: `payment_failed:v1:${String(invoice.id)}`,
    userId: subscription.userId,
    type: "payment_failed",
    payload: { stripeInvoiceId: String(invoice.id) },
  });
}

async function handleInvoiceUpcoming(ctx: any, invoice: any, _eventCreatedAt?: number) {
  const stripeSubscriptionId = stripeSubscriptionIdFromInvoice(invoice);
  if (!stripeSubscriptionId) return;
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
    .first();
  if (!subscription || subscription.status !== "active" || subscription.cancelAtPeriodEnd) return;
  const plan = await getPlan(ctx, subscription.planKey);
  const renewalAt = invoice.period_end
    ? Number(invoice.period_end) * 1000
    : subscription.currentPeriodEnd;
  await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
    deliveryKey: `renewal_upcoming:v1:${stripeSubscriptionId}:${Math.floor(renewalAt / 1000)}`,
    userId: subscription.userId,
    type: "renewal_upcoming",
    payload: {
      stripeSubscriptionId,
      planName: plan.name,
      renewalAt,
      amountDueCents: Number(invoice.amount_due ?? plan.priceMonthlyCents ?? 0),
      currency: String(invoice.currency ?? plan.currency ?? "USD").toUpperCase(),
    },
  });
}

async function handleChargeRefunded(ctx: any, charge: any, eventCreatedAt?: number) {
  const stripeCustomerId = typeof charge.customer === "string" ? charge.customer : undefined;
  if (!stripeCustomerId) return;
  const userId = await userIdForStripeCustomer(ctx, stripeCustomerId);
  if (!userId) return;
  const amountRefunded = Number(charge.amount_refunded ?? 0);
  await upsertBillingTransaction(ctx, {
    key: `stripe_refund:${charge.id}`,
    userId,
    type: "refund",
    status: charge.refunded ? "refunded" : "partially_refunded",
    title: "Payment refund",
    amountCents: -Math.abs(amountRefunded),
    currency: String(charge.currency ?? "USD").toUpperCase(),
    stripeCustomerId,
    stripePaymentIntentId: typeof charge.payment_intent === "string" ? charge.payment_intent : undefined,
    stripeChargeId: String(charge.id),
    receiptUrl: typeof charge.receipt_url === "string" ? charge.receipt_url : undefined,
    occurredAt: eventCreatedAt ?? Date.now(),
  });
}

async function expireTrialCredits(ctx: any, userId: string, conversionKey: string) {
  const account = await getCreditAccount(ctx, userId);
  if (!account || account.availableCredits <= 0) return;
  if (account.reservedCredits > 0) {
    throw new Error("Cannot expire trial credits while generation credits are reserved");
  }
  const remainingTrialCredits = await getAvailableCreditsForSource(ctx, userId, "trial_credits");
  const amount = Math.min(account.availableCredits, remainingTrialCredits);
  if (amount <= 0) return;
  const nextAvailable = account.availableCredits - amount;
  await ctx.db.patch(account._id, {
    availableCredits: nextAvailable,
    updatedAt: Date.now(),
  });
  await ctx.db.insert("creditLedger", {
    userId,
    type: "expire",
    amount: -amount,
    balanceAfter: nextAvailable,
    creditSource: "trial_credits",
    reason: "Unused trial credits expired when paid plan activated",
    metadata: { conversionKey },
    createdAt: Date.now(),
    createdBy: "system",
  });
}

async function hasMonthlyPlanCreditGrant(ctx: any, userId: string) {
  const ledger = await ctx.db
    .query("creditLedger")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
  return ledger.some((entry: any) =>
    entry.type === "grant" && entry.creditSource === "monthly_plan_credits",
  );
}

async function reverseIncorrectUpgradeTrialExpiry(ctx: any, userId: string, stripeInvoiceId: string) {
  const repairKey = `upgrade_trial_expiry_reversal:${stripeInvoiceId}`;
  const ledger = await ctx.db
    .query("creditLedger")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
  if (ledger.some((entry: any) => entry.metadata?.repairKey === repairKey)) return;

  const conversionKey = `stripe_invoice:${stripeInvoiceId}`;
  const incorrectExpiry = ledger.find((entry: any) =>
    entry.type === "expire" && entry.metadata?.conversionKey === conversionKey,
  );
  if (!incorrectExpiry) return;

  const amount = Math.abs(Number(incorrectExpiry.amount ?? 0));
  if (amount <= 0) return;
  const account = await getCreditAccount(ctx, userId);
  if (!account) throw new Error("Credit account was not found");
  const nextAvailable = account.availableCredits + amount;
  await ctx.db.patch(account._id, { availableCredits: nextAvailable, updatedAt: Date.now() });
  await ctx.db.insert("creditLedger", {
    userId,
    type: "adjustment",
    amount,
    balanceAfter: nextAvailable,
    creditSource: "system_correction",
    reason: "Credit correction for plan upgrade",
    metadata: { repairKey, stripeInvoiceId, reversedLedgerId: incorrectExpiry._id },
    createdAt: Date.now(),
    createdBy: "system",
  });
}

async function handleSubscriptionChanged(
  ctx: any,
  subscription: any,
  eventCreatedAt?: number,
  eventType?: string,
) {
  const stripeSubscriptionId = String(subscription.id ?? "");
  if (!stripeSubscriptionId) return;
  const metadata = subscription.metadata ?? {};
  const existing = await ctx.db
    .query("subscriptions")
    .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
    .first();
  const userId = existing?.userId ?? metadata.userId;
  const pricePlanKey = await planKeyForStripePrice(ctx, subscription.items?.data?.[0]?.price?.id);
  const planKey = pricePlanKey ?? metadata.planKey ?? existing?.planKey;
  if (!userId || !planKey) return;
  const plan = await getPlan(ctx, planKey);
  const previousPlan = existing?.planKey ? await getPlan(ctx, existing.planKey) : null;
  const isPendingUpgrade = !!existing && !!previousPlan && plan.key !== previousPlan.key
    && plan.priceMonthlyCents > previousPlan.priceMonthlyCents;
  const nextStatus = normalizeStripeSubscriptionStatus(subscription.status);
  await upsertSubscription(ctx, {
    userId,
    plan: isPendingUpgrade ? previousPlan : plan,
    stripeCustomerId: typeof subscription.customer === "string" ? subscription.customer : undefined,
    stripeSubscriptionId,
    status: nextStatus,
    currentPeriodStart: subscription.current_period_start ? subscription.current_period_start * 1000 : eventCreatedAt ?? Date.now(),
    currentPeriodEnd: subscription.current_period_end ? subscription.current_period_end * 1000 : (eventCreatedAt ?? Date.now()) + MONTH_MS,
    trialStartedAt: subscription.trial_start ? subscription.trial_start * 1000 : existing?.trialStartedAt,
    trialEndsAt: subscription.trial_end ? subscription.trial_end * 1000 : existing?.trialEndsAt,
    trialCreditsGranted: existing?.trialCreditsGranted,
    convertedAt: subscription.status === "active" && existing?.status === "trialing" ? eventCreatedAt ?? Date.now() : existing?.convertedAt,
    cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
  });

  if (isPendingUpgrade && existing && previousPlan) {
    const periodStart = subscription.current_period_start
      ? subscription.current_period_start * 1000
      : existing.currentPeriodStart;
    const periodEnd = subscription.current_period_end
      ? subscription.current_period_end * 1000
      : existing.currentPeriodEnd;
    const pendingUpgradeCredits = proratedUpgradeCredits(previousPlan, plan, periodStart, periodEnd, eventCreatedAt ?? Date.now());
    await ctx.db.patch(existing._id, {
      previousPlanKey: previousPlan.key,
      pendingPlanKey: plan.key,
      pendingUpgradeCredits,
      pendingPlanChangedAt: eventCreatedAt ?? Date.now(),
      updatedAt: Date.now(),
    });
  } else if (existing?.pendingPlanKey === plan.key) {
    await ctx.db.patch(existing._id, {
      previousPlanKey: undefined,
      pendingPlanKey: undefined,
      pendingUpgradeCredits: undefined,
      pendingPlanChangedAt: undefined,
      pendingPlanEffectiveAt: undefined,
      updatedAt: Date.now(),
    });
  }

  if (subscription.cancel_at_period_end && !existing?.cancelAtPeriodEnd) {
    if (existing?.pendingPlanKey) {
      await ctx.db.patch(existing._id, {
        pendingPlanKey: undefined,
        pendingUpgradeCredits: undefined,
        pendingPlanChangedAt: undefined,
        pendingPlanEffectiveAt: undefined,
        updatedAt: Date.now(),
      });
    }
    const cancellationMarker = subscription.canceled_at
      ?? subscription.cancel_at
      ?? Math.floor(Date.now() / 1000);
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
      deliveryKey: `cancellation_scheduled:v2:${stripeSubscriptionId}:${subscription.current_period_end ?? "unknown"}:${cancellationMarker}`,
      userId: String(userId),
      type: "cancellation_scheduled",
      payload: {
        stripeSubscriptionId,
        accessEndsAt: subscription.current_period_end ? subscription.current_period_end * 1000 : undefined,
      },
    });
  }

  if (nextStatus === "canceled" && existing?.status !== "canceled") {
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
      deliveryKey: `subscription_ended:v1:${stripeSubscriptionId}`,
      userId: String(userId),
      type: "subscription_ended",
      payload: { stripeSubscriptionId },
    });
  }

  if (existing?.cancelAtPeriodEnd && !subscription.cancel_at_period_end
    && (nextStatus === "active" || nextStatus === "trialing")) {
    const resumedMarker = subscription.canceled_at
      ?? subscription.cancel_at
      ?? Math.floor(Date.now() / 1000);
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
      deliveryKey: `subscription_resumed:v2:${stripeSubscriptionId}:${subscription.current_period_end ?? "current"}:${resumedMarker}`,
      userId: String(userId),
      type: "subscription_resumed",
      payload: {
        stripeSubscriptionId,
        nextRenewalAt: subscription.current_period_end ? subscription.current_period_end * 1000 : undefined,
      },
    });
  }

  const manuallyActivated = !!existing?.manualTrialActivationAt || !!existing?.convertedAt;
  if (subscription.status === "trialing" && subscription.trial_end && existing?.status !== "active" && !manuallyActivated) {
    const trialEndsAt = subscription.trial_end * 1000;
    const reminderWindowMs = 3 * 24 * 60 * 60 * 1000;
    const minimumLeadMs = 60 * 60 * 1000;
    const referenceNow = eventCreatedAt ?? Date.now();
    const trialEndsInFuture = trialEndsAt - referenceNow >= minimumLeadMs;
    const stripeSaysTrialWillEnd = eventType === "customer.subscription.trial_will_end";
    if (trialEndsInFuture && (stripeSaysTrialWillEnd || trialEndsAt - referenceNow <= reminderWindowMs)) {
      await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
        deliveryKey: `trial_ending:v1:${stripeSubscriptionId}:${subscription.trial_end}`,
        userId: String(userId),
        type: "trial_ending",
        payload: { stripeSubscriptionId, trialEndsAt },
      });
    }
  }
}

async function handleSubscriptionScheduleChanged(ctx: any, schedule: any, eventType: string, eventCreatedAt?: number) {
  const stripeSubscriptionId = typeof schedule.subscription === "string"
    ? schedule.subscription
    : typeof schedule.released_subscription === "string"
      ? schedule.released_subscription
      : undefined;
  if (!stripeSubscriptionId) return;
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", stripeSubscriptionId))
    .first();
  if (!subscription) return;

  if (eventType.endsWith(".aborted") || eventType.endsWith(".canceled") || eventType.endsWith(".released") || eventType.endsWith(".completed")) {
    await ctx.db.patch(subscription._id, {
      pendingPlanKey: undefined,
      pendingPlanChangedAt: undefined,
      pendingPlanEffectiveAt: undefined,
      updatedAt: Date.now(),
    });
    return;
  }

  const phases = Array.isArray(schedule.phases) ? schedule.phases : [];
  if (subscription.cancelAtPeriodEnd) return;
  for (const phase of phases) {
    const price = phase.items?.[0]?.price;
    const priceId = typeof price === "string" ? price : price?.id;
    const targetPlanKey = await planKeyForStripePrice(ctx, priceId);
    if (!targetPlanKey || targetPlanKey === subscription.planKey) continue;
    const targetPlan = await getPlan(ctx, targetPlanKey);
    const currentPlan = await getPlan(ctx, subscription.planKey);
    if (targetPlan.priceMonthlyCents >= currentPlan.priceMonthlyCents) continue;
    const effectiveAt = phase.start_date
      ? Number(phase.start_date) * 1000
      : subscription.currentPeriodEnd;
    await ctx.db.patch(subscription._id, {
      pendingPlanKey: targetPlan.key,
      pendingPlanChangedAt: eventCreatedAt ?? Date.now(),
      pendingPlanEffectiveAt: effectiveAt,
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
      deliveryKey: `plan_downgrade_scheduled:v2:${stripeSubscriptionId}:${targetPlan.key}:${Math.floor(effectiveAt / 1000)}`,
      userId: String(subscription.userId),
      type: "plan_downgrade_scheduled",
      payload: {
        stripeSubscriptionId,
        stripeScheduleId: schedule.id,
        currentPlanName: currentPlan.name,
        nextPlanName: targetPlan.name,
        effectiveAt,
      },
    });
    return;
  }
}

async function upsertSubscription(ctx: any, args: {
  userId: string;
  plan: any;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  status: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  trialStartedAt?: number;
  trialEndsAt?: number;
  trialCreditsGranted?: number;
  convertedAt?: number;
  cancelAtPeriodEnd?: boolean;
}) {
  const now = Date.now();
  const existing = args.stripeSubscriptionId
    ? await ctx.db
      .query("subscriptions")
      .withIndex("by_stripeSubscriptionId", (q: any) => q.eq("stripeSubscriptionId", args.stripeSubscriptionId))
      .first()
    : null;
  const payload = {
    userId: args.userId,
    planKey: args.plan.key,
    planVersion: args.plan.version ?? BILLING_CONFIG_VERSION,
    status: args.status,
    stripeCustomerId: args.stripeCustomerId,
    stripeSubscriptionId: args.stripeSubscriptionId,
    currentPeriodStart: args.currentPeriodStart,
    currentPeriodEnd: args.currentPeriodEnd,
    trialStartedAt: args.trialStartedAt,
    trialEndsAt: args.trialEndsAt,
    trialCreditsGranted: args.trialCreditsGranted,
    convertedAt: args.convertedAt,
    cancelAtPeriodEnd: args.cancelAtPeriodEnd,
    updatedAt: now,
  };
  if (existing) {
    await ctx.db.patch(existing._id, payload);
  } else {
    await ctx.db.insert("subscriptions", {
      ...payload,
      createdAt: now,
    });
  }

  const account = await ensureCreditAccount(ctx, args.userId, args.plan);
  await ctx.db.patch(account._id, {
    planKey: args.plan.key,
    updatedAt: now,
  });
}

async function grantCreditsIfNeeded(ctx: any, args: {
  userId: string;
  amount: number;
  creditSource: string;
  type: string;
  reason: string;
  grantKey: string;
  metadata?: any;
}) {
  if (args.amount <= 0) return { granted: 0 };
  const existingLedger = await ctx.db
    .query("creditLedger")
    .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
    .collect();
  const alreadyGranted = existingLedger.some((entry: any) => entry.metadata?.grantKey === args.grantKey);
  if (alreadyGranted) return { granted: 0, duplicate: true };

  const account = await ensureCreditAccount(ctx, args.userId);
  const nextAvailable = account.availableCredits + args.amount;
  await ctx.db.patch(account._id, {
    availableCredits: nextAvailable,
    lifetimePurchasedCredits: account.lifetimePurchasedCredits + (args.creditSource === "top_up_credits" ? args.amount : 0),
    lifetimeGrantedCredits: account.lifetimeGrantedCredits + (args.creditSource === "top_up_credits" ? 0 : args.amount),
    currentPeriodGrantedCredits: account.currentPeriodGrantedCredits + (args.creditSource === "monthly_plan_credits" ? args.amount : 0),
    updatedAt: Date.now(),
  });
  await ctx.db.insert("creditLedger", {
    userId: args.userId,
    type: args.type,
    amount: args.amount,
    balanceAfter: nextAvailable,
    creditSource: args.creditSource,
    reason: args.reason,
    metadata: { ...(args.metadata ?? {}), grantKey: args.grantKey },
    createdAt: Date.now(),
    createdBy: "stripe",
  });
  return { granted: args.amount };
}

async function planKeyForStripePrice(ctx: any, stripePriceId?: string) {
  if (!stripePriceId) return undefined;
  const plans = await ctx.db.query("billingPlans").collect();
  return plans.find((plan: any) => plan.stripePriceId === stripePriceId)?.key
    ?? DEFAULT_PLANS.find((plan) => plan.stripePriceId === stripePriceId)?.key;
}

function targetPlanLineFromInvoice(invoice: any) {
  const lines = (invoice.lines?.data ?? []).filter((item: any) =>
    item.type === "subscription"
      || item.parent?.type === "subscription_item_details"
      || item.parent?.subscription_item_details,
  );
  return lines.sort((a: any, b: any) => Number(b.amount ?? 0) - Number(a.amount ?? 0))[0]
    ?? invoice.lines?.data?.[0];
}

function stripePriceIdFromInvoice(invoice: any) {
  const line = targetPlanLineFromInvoice(invoice);
  return line?.price?.id
    ?? line?.pricing?.price_details?.price
    ?? line?.parent?.subscription_item_details?.price?.id;
}

function stripeSubscriptionIdFromInvoice(invoice: any) {
  if (typeof invoice.subscription === "string") return invoice.subscription;
  if (typeof invoice.parent?.subscription_details?.subscription === "string") {
    return invoice.parent.subscription_details.subscription;
  }
  const line = targetPlanLineFromInvoice(invoice);
  return typeof line?.parent?.subscription_item_details?.subscription === "string"
    ? line.parent.subscription_item_details.subscription
    : undefined;
}

function proratedUpgradeCredits(previousPlan: any, targetPlan: any, periodStart: number, periodEnd: number, now: number) {
  const difference = Math.max(0, targetPlan.includedCredits - previousPlan.includedCredits);
  const duration = Math.max(1, periodEnd - periodStart);
  const remaining = Math.max(0, Math.min(duration, periodEnd - now));
  return Math.ceil(difference * (remaining / duration));
}

function normalizeStripeSubscriptionStatus(status?: string) {
  if (status === "trialing") return "trialing";
  if (status === "active") return "active";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "canceled";
  if (status === "unpaid") return "unpaid";
  return status ?? "unknown";
}

async function seedBillingConfig(ctx: any) {
  const now = Date.now();

  const existingSettings = await ctx.db
    .query("billingSettings")
    .withIndex("by_key", (q: any) => q.eq("key", DEFAULT_BILLING_SETTINGS.key))
    .first();
  if (existingSettings) {
    await ctx.db.patch(existingSettings._id, {
      defaultCreditValueCents: existingSettings.defaultCreditValueCents
        ?? DEFAULT_BILLING_SETTINGS.defaultCreditValueCents,
      defaultMarkup: existingSettings.defaultMarkup ?? DEFAULT_BILLING_SETTINGS.defaultMarkup,
      trialLowCreditThreshold: existingSettings.trialLowCreditThreshold
        ?? DEFAULT_BILLING_SETTINGS.trialLowCreditThreshold,
      trialTemplateLimit: existingSettings.trialTemplateLimit
        ?? DEFAULT_BILLING_SETTINGS.trialTemplateLimit,
      trialTemplateRefreshEnabled: existingSettings.trialTemplateRefreshEnabled
        ?? DEFAULT_BILLING_SETTINGS.trialTemplateRefreshEnabled,
      trialTemplateRefreshDays: existingSettings.trialTemplateRefreshDays
        ?? DEFAULT_BILLING_SETTINGS.trialTemplateRefreshDays,
      trialTemplateAiCovers: existingSettings.trialTemplateAiCovers
        ?? DEFAULT_BILLING_SETTINGS.trialTemplateAiCovers,
      templateBasePoolEvergreenTarget: existingSettings.templateBasePoolEvergreenTarget
        ?? existingSettings.templateBasePoolTrendingTarget
        ?? DEFAULT_BILLING_SETTINGS.templateBasePoolEvergreenTarget,
      templateBasePoolSeasonalEvergreenTarget: existingSettings.templateBasePoolSeasonalEvergreenTarget
        ?? existingSettings.templateBasePoolSeasonalTrendingTarget
        ?? DEFAULT_BILLING_SETTINGS.templateBasePoolSeasonalEvergreenTarget,
      templateBasePoolSeasonalEventTarget: existingSettings.templateBasePoolSeasonalEventTarget
        ?? existingSettings.templateBasePoolSeasonalTarget
        ?? DEFAULT_BILLING_SETTINGS.templateBasePoolSeasonalEventTarget,
      creditPurchaseInvoicePolicy: existingSettings.creditPurchaseInvoicePolicy
        ?? DEFAULT_BILLING_SETTINGS.creditPurchaseInvoicePolicy,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert("billingSettings", { ...DEFAULT_BILLING_SETTINGS, createdAt: now, updatedAt: now });
  }

  let plans = 0;
  for (const plan of DEFAULT_PLANS) {
    const existing = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q: any) => q.eq("key", plan.key))
      .first();
    const payload = {
      ...plan,
      stripePriceId: plan.stripePriceId ?? existing?.stripePriceId,
      version: BILLING_CONFIG_VERSION,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("billingPlans", { ...payload, createdAt: now });
    }
    plans++;
  }
  const legacyTrialPlan = await ctx.db
    .query("billingPlans")
    .withIndex("by_key", (q: any) => q.eq("key", "trial"))
    .first();
  if (legacyTrialPlan?.isActive) {
    await ctx.db.patch(legacyTrialPlan._id, { isActive: false, updatedAt: now });
  }
  for (const legacyKey of LEGACY_PLAN_KEYS) {
    const legacyPlan = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q: any) => q.eq("key", legacyKey))
      .first();
    if (!legacyPlan?.isActive) continue;
    const legacySubscriptions = await ctx.db
      .query("subscriptions")
      .filter((q: any) => q.eq(q.field("planKey"), legacyKey))
      .take(1);
    if (legacySubscriptions.length === 0) {
      await ctx.db.patch(legacyPlan._id, { isActive: false, updatedAt: now });
    }
  }

  let skus = 0;
  for (const sku of DEFAULT_SKUS) {
    const existing = await ctx.db
      .query("aiSkus")
      .withIndex("by_key", (q: any) => q.eq("key", sku.key))
      .first();
    const {
      creditValueCents: _legacyCreditValue,
      markup: _legacyMarkup,
      creditsPerUnit: _legacyCredits,
      ...skuConfig
    } = sku;
    const payload = {
      ...skuConfig,
      effectiveFrom: now,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.replace(existing._id, { ...payload, createdAt: existing.createdAt ?? now });
    } else {
      await ctx.db.insert("aiSkus", { ...payload, createdAt: now });
    }
    skus++;
  }

  let topUpPackages = 0;
  for (const pack of DEFAULT_TOP_UP_PACKAGES) {
    const existing = await ctx.db
      .query("creditTopUpPackages")
      .withIndex("by_key", (q: any) => q.eq("key", pack.key))
      .first();
    const payload = { ...pack, updatedAt: now };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("creditTopUpPackages", { ...payload, createdAt: now });
    }
    topUpPackages++;
  }

  let migratedLegacyTrialAccounts = 0;
  const accounts = await ctx.db.query("creditAccounts").collect();
  for (const account of accounts) {
    if (account.planKey !== "trial") continue;
    const amount = account.availableCredits;
    await ctx.db.patch(account._id, {
      availableCredits: 0,
      reservedCredits: 0,
      currentPeriodGrantedCredits: 0,
      planKey: undefined,
      updatedAt: now,
    });
    if (amount > 0) {
      await ctx.db.insert("creditLedger", {
        userId: account.userId,
        type: "expire",
        amount: -amount,
        balanceAfter: 0,
        creditSource: "trial_credits",
        reason: "Legacy automatic trial balance removed during trial-policy migration",
        metadata: { migration: "global_trial_v2" },
        createdAt: now,
        createdBy: "system",
      });
    }
    migratedLegacyTrialAccounts++;
  }

  return {
    plans,
    skus,
    throttleMode: "internal_burst",
    topUpPackages,
    billingSettings: 1,
    migratedLegacyTrialAccounts,
    version: BILLING_CONFIG_VERSION,
  };
}

async function estimateAgentTaskCredits(ctx: any, args: { agentType: string; input: any; initiatedFrom?: string }) {
  const featureKey = featureKeyForAgent(args.agentType, args.initiatedFrom);
  const rawLines = rawSkuLinesForAgent(args.agentType, args.input);
  const skuBreakdown: SkuLine[] = [];

  for (const raw of rawLines) {
    const sku = await getSku(ctx, raw.skuKey);
    const units = Math.max(0, raw.units);
    const credits = Math.ceil(units * sku.creditsPerUnit);
    skuBreakdown.push({
      skuKey: sku.key,
      units,
      credits,
      provider: sku.provider,
      model: sku.model,
      estimatedProviderCostCents: units * sku.providerCostPerUnitCents,
      defaultCreditSource: sku.defaultCreditSource,
    });
  }

  const creditsPriced = skuBreakdown.reduce((sum, line) => sum + line.credits, 0);
  return {
    featureKey,
    primarySkuKey: skuBreakdown[0]?.skuKey,
    creditsPriced,
    creditsChargedToCustomer: creditsPriced,
    creditSource: skuBreakdown[0]?.defaultCreditSource ?? "platform_covered",
    skuBreakdown,
  };
}

async function estimateAgentTaskRetryCredits(ctx: any, task: any) {
  const estimate = await estimateAgentTaskCredits(ctx, {
    agentType: task.agentType,
    input: task.input,
    initiatedFrom: task.initiatedFrom,
  });
  if (task.agentType !== "image_generator" || !task.input?._chainToVideo) return estimate;

  const downstream = await estimateAgentTaskCredits(ctx, {
    agentType: "video_generator",
    initiatedFrom: task.initiatedFrom,
    input: {
      duration: task.input._videoDuration ?? "5",
      generateAudio: false,
      assetReferences: [{ imageUrl: "pending-product-image" }],
    },
  });
  const skuBreakdown = [...estimate.skuBreakdown, ...downstream.skuBreakdown];
  const creditsPriced = estimate.creditsPriced + downstream.creditsPriced;
  return {
    ...estimate,
    creditsPriced,
    creditsChargedToCustomer: creditsPriced,
    skuBreakdown,
  };
}

function rawSkuLinesForAgent(agentType: string, input: any): Array<{ skuKey: string; units: number }> {
  if (agentType === "character_designer") {
    return [{ skuKey: "ambassador.custom_generation", units: 1 }];
  }

  if (agentType === "image_generator") {
    const refs = Array.isArray(input?.assetReferences) ? input.assetReferences : [];
    const hasRefs = refs.some((ref: any) => !!ref?.imageUrl);
    const isSquare = input?.aspectRatio === "1:1";
    const quality = input?.quality === "low" || input?.quality === "medium" ? input.quality : "high";
    return [{
      skuKey: hasRefs
        ? input?.resolution === "4K"
          ? "image.reference_edit.4k"
          : input?.resolution === "1K" ? "image.reference_edit.1k" : "image.reference_edit.2k"
        : `image.text_to_image.${quality}${isSquare ? ".square" : ""}`,
      units: 1,
    }];
  }

  if (agentType === "video_generator") {
    const refs = Array.isArray(input?.assetReferences) ? input.assetReferences : [];
    const hasRefs = refs.some((ref: any) => !!ref?.imageUrl);
    const audio = input?.generateAudio !== false;
    const duration = Number.parseInt(String(input?.duration ?? "5"), 10);
    if (!Number.isInteger(duration) || duration < 3 || duration > 15) {
      throw new Error("Kling Standard duration must be a whole number from 3 to 15 seconds.");
    }
    const skuKey = hasRefs
      ? audio ? "video.kling.v3.standard.image_to_video.audio" : "video.kling.v3.standard.image_to_video.no_audio"
      : audio ? "video.kling.v3.standard.text_to_video.audio" : "video.kling.v3.standard.text_to_video.no_audio";
    return [{ skuKey, units: duration }];
  }

  if (agentType === "script_generator") {
    const angles = Array.isArray(input?.angles) ? input.angles : [];
    const attached = angles.filter((angle: any) => !!angle?.attachedAssetTaskId).length;
    const generated = Math.max(0, angles.length - attached);
    return [
      ...(generated > 0 ? [{ skuKey: "text.campaign_script_per_angle", units: generated }] : []),
      ...(attached > 0 ? [{ skuKey: "text.campaign_attached_media_caption", units: attached }] : []),
    ];
  }

  if (agentType === "brand_guide_analyzer") {
    return [{ skuKey: "onboarding.brand_guide_analyzer", units: 1 }];
  }

  return [];
}

function featureKeyForAgent(agentType: string, initiatedFrom?: string) {
  if (agentType === "image_generator") return "image_generation";
  if (agentType === "video_generator") return "video_generation";
  if (agentType === "script_generator") return "campaign_generation";
  if (agentType === "character_designer") return "ambassador_generation";
  if (initiatedFrom === "onboarding") return "helper_ai";
  return "helper_ai";
}

type ResolvedSku = SeedSku & {
  _id?: any;
  creditValueCents: number;
  markup: number;
  creditsPerUnit: number;
};

function computeCreditsPerUnit(providerCostPerUnitCents: number, markup: number, creditValueCents: number) {
  if (creditValueCents <= 0) throw new Error("Global credit value must be greater than zero.");
  if (markup <= 0) throw new Error("Global markup must be greater than zero.");
  return Math.max(1, Math.ceil((providerCostPerUnitCents * markup) / creditValueCents));
}

async function resolveSkuPricing(ctx: any, sku: SeedSku & { _id?: any }): Promise<ResolvedSku> {
  const settings = await getBillingSettings(ctx);
  const creditValueCents = sku.creditValueOverrideCents ?? settings.defaultCreditValueCents;
  const markup = sku.markupOverride ?? settings.defaultMarkup;
  return {
    ...sku,
    creditValueCents,
    markup,
    creditsPerUnit: computeCreditsPerUnit(sku.providerCostPerUnitCents, markup, creditValueCents),
  };
}

async function getSku(ctx: any, key: string): Promise<ResolvedSku> {
  const dbSku = await ctx.db.query("aiSkus").withIndex("by_key", (q: any) => q.eq("key", key)).first();
  if (dbSku) {
    if (!dbSku.isActive) throw new Error(`Billing SKU is inactive: ${key}`);
    return await resolveSkuPricing(ctx, dbSku);
  }
  const fallback = DEFAULT_SKUS.find((sku) => sku.key === key);
  if (!fallback) throw new Error(`Billing SKU not configured: ${key}`);
  return await resolveSkuPricing(ctx, fallback);
}

async function getPlan(ctx: any, key: string): Promise<SeedPlan & { _id?: any; version?: number }> {
  const dbPlan = await ctx.db.query("billingPlans").withIndex("by_key", (q: any) => q.eq("key", key)).first();
  if (dbPlan?.isActive) return dbPlan;
  const fallback = DEFAULT_PLANS.find((plan) => plan.key === key);
  if (!fallback) throw new Error(`Billing plan not configured: ${key}`);
  return { ...fallback, version: BILLING_CONFIG_VERSION };
}

function templateEntitlementFromPlan(plan: any, accessStatus: string) {
  const fallback = DEFAULT_PLANS.find((candidate) => candidate.key === plan?.key);
  const features = { ...(fallback?.features ?? {}), ...(plan?.features ?? {}) };
  const limits = { ...(fallback?.limits ?? {}), ...(plan?.limits ?? {}) };
  const templateLimit = Math.max(0, Number(limits.templateLimit ?? 0));
  const refreshDays = Math.max(0, Number(limits.templateRefreshDays ?? 0));
  return {
    enabled: templateLimit > 0,
    accessStatus,
    planKey: plan?.key ?? null,
    templateLimit,
    refreshEnabled: !!features.templateRefreshEnabled && refreshDays > 0,
    refreshDays,
    aiCoversEnabled: !!features.templateAiCovers,
  };
}

async function getBillingSettings(ctx: any) {
  const settings = await ctx.db
    .query("billingSettings")
    .withIndex("by_key", (q: any) => q.eq("key", "global"))
    .first();
  return settings?.isActive
    ? { ...DEFAULT_BILLING_SETTINGS, ...settings }
    : DEFAULT_BILLING_SETTINGS;
}

async function getLatestSubscription(ctx: any, userId: string) {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
  return subscriptions.sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0] ?? null;
}

function subscriptionAccessStatus(subscription: any) {
  if (!subscription) return "no_plan";
  if (subscription.status === "trialing" && subscription.trialEndsAt && subscription.trialEndsAt <= Date.now()) {
    return "trial_expired";
  }
  if (["trialing", "active", "internal", "past_due", "canceled", "unpaid", "paused"].includes(subscription.status)) {
    return subscription.status;
  }
  return "no_plan";
}

async function requireAiAccess(ctx: any, userId: string) {
  let user: any = null;
  try {
    user = await ctx.db.get(userId as any);
  } catch {
    user = null;
  }
  if (user?.role === "admin") {
    return { status: "internal", plan: await getPlan(ctx, "internal"), subscription: null };
  }
  const subscription = await getLatestSubscription(ctx, userId);
  const status = subscriptionAccessStatus(subscription);
  if (status !== "trialing" && status !== "active" && status !== "internal") {
    throw new Error("A free trial or active plan is required to use AI generation.");
  }
  return { status, plan: await getPlan(ctx, subscription.planKey), subscription };
}

async function getActiveSubscription(ctx: any, userId: string) {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
  return subscriptions
    .filter((s: any) => ["trialing", "active", "internal"].includes(s.status))
    .sort((a: any, b: any) => b.updatedAt - a.updatedAt)[0] ?? null;
}

async function ensureCreditAccount(ctx: any, userId: string, plan?: any) {
  const existing = await getCreditAccount(ctx, userId);
  if (existing) return existing;

  const now = Date.now();
  const accountId = await ctx.db.insert("creditAccounts", {
    userId,
    availableCredits: 0,
    reservedCredits: 0,
    lifetimePurchasedCredits: 0,
    lifetimeGrantedCredits: 0,
    lifetimeConsumedCredits: 0,
    currentPeriodGrantedCredits: 0,
    planKey: plan?.key,
    updatedAt: now,
  });
  return await ctx.db.get(accountId);
}

async function getCreditAccount(ctx: any, userId: string) {
  return await ctx.db.query("creditAccounts").withIndex("by_userId", (q: any) => q.eq("userId", userId)).first();
}

async function upsertBillingTransaction(ctx: any, args: {
  key: string;
  userId: string;
  type: string;
  status: string;
  title: string;
  amountCents?: number;
  currency?: string;
  credits?: number;
  stripeCustomerId?: string;
  stripeSessionId?: string;
  stripeInvoiceId?: string;
  stripePaymentIntentId?: string;
  stripeChargeId?: string;
  receiptUrl?: string;
  invoiceUrl?: string;
  metadata?: any;
  occurredAt: number;
}) {
  const existing = await ctx.db
    .query("billingTransactions")
    .withIndex("by_key", (q: any) => q.eq("key", args.key))
    .first();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, { ...args, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("billingTransactions", {
    ...args,
    createdAt: now,
    updatedAt: now,
  });
}

async function userIdForStripeCustomer(ctx: any, stripeCustomerId: string) {
  const subscription = await ctx.db
    .query("subscriptions")
    .withIndex("by_stripeCustomerId", (q: any) => q.eq("stripeCustomerId", stripeCustomerId))
    .first();
  if (subscription?.userId) return subscription.userId;
  const session = await ctx.db
    .query("stripeCheckoutSessions")
    .withIndex("by_stripeCustomerId", (q: any) => q.eq("stripeCustomerId", stripeCustomerId))
    .first();
  return session?.userId;
}

async function getAvailableCreditsForSource(ctx: any, userId: string, creditSource: string) {
  const entries = await ctx.db
    .query("creditLedger")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();

  return Math.max(0, entries
    .filter((entry: any) => entry.creditSource === creditSource)
    .reduce((balance: number, entry: any) => {
      if (entry.type === "reserve" || entry.type === "expire") {
        return balance - Math.abs(entry.amount);
      }
      if (entry.type === "release" || entry.type === "grant" || entry.type === "purchase") {
        return balance + Math.abs(entry.amount);
      }
      return balance;
    }, 0));
}

function creditActivityAmount(entry: any) {
  if (entry.type === "charge" || entry.type === "expire") return -Math.abs(entry.amount);
  return Math.abs(entry.amount);
}

function creditActivityTitle(entry: any) {
  if (entry.type === "purchase") return "Credits purchased";
  if (entry.type === "expire") return "Credits expired";
  if (entry.type === "admin_grant") return "Credits adjusted";
  if (entry.type === "adjustment") return "Credit correction";
  if (entry.type === "grant") {
    if (entry.creditSource === "monthly_plan_credits") return "Monthly plan credits";
    if (entry.creditSource === "trial_credits") return "Trial credits";
    return "Credits added";
  }
  return entry.reason || "AI generation";
}

async function maybeScheduleLowCreditEmail(ctx: any, userId: string) {
  const subscription = await getLatestSubscription(ctx, userId);
  const status = subscriptionAccessStatus(subscription);
  if (status !== "trialing" && status !== "active") return false;
  const account = await getCreditAccount(ctx, userId);
  if (!account) return false;
  const plan = subscription?.planKey ? await getPlan(ctx, subscription.planKey) : null;
  const settings = await getBillingSettings(ctx);
  const threshold = status === "trialing"
    ? settings.trialLowCreditThreshold
    : plan?.lowCreditThreshold ?? 0;
  if (threshold <= 0 || account.availableCredits > threshold) return false;

  const periodKey = status === "trialing"
    ? subscription?.trialStartedAt ?? subscription?.currentPeriodStart
    : subscription?.currentPeriodStart;
  const deliveryKey = `low_credits:v1:${userId}:${periodKey ?? "current"}`;
  const delivery = await ctx.db
    .query("emailDeliveries")
    .withIndex("by_key", (q: any) => q.eq("key", deliveryKey))
    .first();
  if (delivery?.status === "sent" || (delivery?.attempts ?? 0) >= 3) return false;

  await ctx.scheduler.runAfter(0, internal.services.sendEmail.sendBillingLifecycleEmail, {
    deliveryKey,
    userId,
    type: "low_credits",
    payload: {
      credits: account.availableCredits,
      threshold,
      accessStatus: status,
    },
  });
  return true;
}

async function resolveCreditSource(ctx: any, args: { userId: string; plan: any; estimate: any }) {
  if (args.estimate.creditSource === "platform_covered") return "platform_covered";
  return "customer_balance";
}

async function checkAndRecordRateLimit(ctx: any, args: {
  userId?: string;
  featureKey: string;
}) {
  if (!args.userId) return;
  const limit = GENERATION_BURST_LIMITS[args.featureKey] ?? GENERATION_BURST_LIMITS.helper_ai;
  const now = Date.now();
  const bucket = await ctx.db
    .query("generationThrottleBuckets")
    .withIndex("by_user_feature", (q: any) =>
      q.eq("userId", args.userId).eq("featureKey", args.featureKey),
    )
    .first();

  if (!bucket || now - bucket.windowStartedAt >= THROTTLE_WINDOW_MS) {
    if (bucket) {
      await ctx.db.patch(bucket._id, { windowStartedAt: now, count: 1, updatedAt: now });
    } else {
      await ctx.db.insert("generationThrottleBuckets", {
        userId: args.userId,
        featureKey: args.featureKey,
        windowStartedAt: now,
        count: 1,
        updatedAt: now,
      });
    }
    return;
  }

  if (bucket.count >= limit) {
    throw new ConvexError({
      code: "GENERATION_RATE_LIMITED",
      message: "Too many generation attempts in a short time.",
      retryAfterMs: Math.max(1000, bucket.windowStartedAt + THROTTLE_WINDOW_MS - now),
    });
  }
  await ctx.db.patch(bucket._id, { count: bucket.count + 1, updatedAt: now });
}

async function patchUsageEventsForTask(ctx: any, taskId: any, patch: Record<string, any>) {
  const events = await ctx.db
    .query("aiUsageEvents")
    .withIndex("by_taskId", (q: any) => q.eq("taskId", taskId))
    .collect();
  for (const event of events) {
    if (event.status === "succeeded" && patch.status === "succeeded") continue;
    await ctx.db.patch(event._id, patch);
  }
}

async function recordOperationUsage(ctx: any, args: {
  userId?: string;
  brandId?: any;
  campaignId?: any;
  taskId?: any;
  reservationId?: any;
  featureKey: string;
  sku: SeedSku;
  units: number;
  creditsPriced: number;
  creditsChargedToCustomer: number;
  creditSource: string;
  status: string;
  metadata?: any;
}) {
  await ctx.db.insert("aiUsageEvents", {
    userId: args.userId,
    brandId: args.brandId,
    taskId: args.taskId,
    campaignId: args.campaignId,
    featureKey: args.featureKey,
    skuKey: args.sku.key,
    provider: args.sku.provider,
    model: args.sku.model,
    units: args.units,
    estimatedProviderCostCents: args.units * args.sku.providerCostPerUnitCents,
    creditsPriced: args.creditsPriced,
    creditsChargedToCustomer: args.creditsChargedToCustomer,
    creditSource: args.creditSource,
    status: args.status,
    metadata: {
      ...(args.metadata ?? {}),
      reservationId: args.reservationId ? String(args.reservationId) : undefined,
    },
    createdAt: Date.now(),
  });
}

async function patchUsageEventsForOperation(ctx: any, args: {
  userId: string;
  skuKey: string;
  taskId?: any;
}, patch: Record<string, any>) {
  const candidates = args.taskId
    ? await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_taskId", (q: any) => q.eq("taskId", args.taskId))
      .collect()
    : await ctx.db
      .query("aiUsageEvents")
      .withIndex("by_userId", (q: any) => q.eq("userId", args.userId))
      .order("desc")
      .take(20);

  const event = candidates.find((candidate: any) =>
    candidate.skuKey === args.skuKey &&
    candidate.status === "submitted",
  );
  if (event) await ctx.db.patch(event._id, patch);
}

async function stripeRequest(path: string, params: Record<string, string | number | boolean | undefined | null>) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    body.set(key, String(value));
  }

  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const json: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error?.message ?? `Stripe request failed: ${response.status}`);
  }
  return json;
}

async function stripeGet(path: string, params?: Record<string, string | number | boolean | undefined | null>) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  const response = await fetch(`${STRIPE_API_BASE}/${path}${suffix}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const json: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error?.message ?? `Stripe request failed: ${response.status}`);
  }
  return json;
}

async function maybeCreateStripeTestClockCustomerForUser(
  ctx: any,
  userId: string,
  email?: string | null,
): Promise<{ stripeCustomerId: string; stripeTestClockId: string } | null> {
  const guard = getStripeTestClockGuard();
  if (!guard.enabled) {
    console.log("[billing:testClock] Skipped Stripe test clock customer", {
      userId,
      reason: guard.reason,
    });
    return null;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const clock = await stripeRequest("test_helpers/test_clocks", {
    frozen_time: nowSeconds,
    name: `SIRz dev ${userId.slice(0, 8)}`,
  });

  const customer = await stripeRequest("customers", {
    email: email ?? undefined,
    test_clock: clock.id,
    "metadata[userId]": userId,
    "metadata[source]": "sirz_dev_test_clock",
  });

  console.log("[billing:testClock] Created Stripe test clock customer", {
    userId,
    stripeCustomerId: customer.id,
    stripeTestClockId: clock.id,
  });

  await ctx.runMutation(internal.billing.recordStripeCheckoutSessionInternal, {
    userId,
    mode: "test_clock_customer",
    status: "complete",
    stripeSessionId: `test_clock_customer:${customer.id}`,
    stripeCustomerId: customer.id,
    metadata: {
      stripeTestClockId: clock.id,
      source: "sirz_dev_test_clock",
    },
  });

  return { stripeCustomerId: customer.id, stripeTestClockId: clock.id };
}

function getStripeTestClockGuard(): { enabled: true } | { enabled: false; reason: string } {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? "";
  const siteUrl = process.env.SITE_URL ?? "";
  if (process.env.STRIPE_ENABLE_TEST_CLOCKS !== "true") {
    return { enabled: false, reason: "STRIPE_ENABLE_TEST_CLOCKS is not true" };
  }
  if (!secretKey.startsWith("sk_test_")) {
    return { enabled: false, reason: "STRIPE_SECRET_KEY is not a test key" };
  }
  if (!siteUrl.includes("localhost") && !siteUrl.includes("127.0.0.1")) {
    return { enabled: false, reason: "SITE_URL is not local" };
  }
  return { enabled: true };
}

async function stripeRetrieve(path: string) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured");
  const response = await fetch(`${STRIPE_API_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const json: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error?.message ?? `Stripe request failed: ${response.status}`);
  }
  return json;
}
