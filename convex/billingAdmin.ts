import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { BILLING_CONFIG_VERSION } from "./billingConfig";
import { getCurrentTeamMember } from "./helpers";

async function requireBillingAdmin(ctx: any) {
  const teamMember = await getCurrentTeamMember(ctx);

  if (!teamMember) {
    throw new Error("Unauthenticated");
  }

  return teamMember;
}

function assertNonNegativeFields(
  value: Record<string, any>,
  fields: string[],
) {
  for (const field of fields) {
    if (!Number.isFinite(value[field]) || value[field] < 0) {
      throw new Error(`${field} cannot be negative.`);
    }
  }
}

async function getActiveSubscriptionCounts(ctx: any) {
  const subscriptions = await ctx.db.query("subscriptions").collect();

  const counts = new Map<string, number>();

  for (const subscription of subscriptions) {
    if (!["active", "trialing", "past_due"].includes(subscription.status)) {
      continue;
    }

    counts.set(
      subscription.planKey,
      (counts.get(subscription.planKey) ?? 0) + 1,
    );
  }

  return counts;
}



// BILLING PLANS

export const adminGetBillingPlans = query({
  args: {},
  handler: async (ctx) => {
    // await requireBillingAdmin(ctx);

    const plans = await ctx.db.query("billingPlans").collect();
    const subscriptions = await ctx.db.query("subscriptions").collect();

    console.log("subscriptions*************", subscriptions)
    console.log("plans*************", plans)

    const activeStatuses = new Set([
      "active",
      "trialing",
      "past_due",
    ]);

    console.log("activeStatuses*************", activeStatuses)

    const subscriptionCounts = new Map<string, number>();

    for (const subscription of subscriptions) {
      if (!activeStatuses.has(subscription.status)) continue;

      subscriptionCounts.set(
        subscription.planKey,
        (subscriptionCounts.get(subscription.planKey) ?? 0) + 1,
      );
    }

    const rows = plans
      .map((plan) => ({
        ...plan,
        activeSubscriptionCount:
          subscriptionCounts.get(plan.key) ?? 0,
      }))
      .sort((a, b) => a.priceMonthlyCents - b.priceMonthlyCents);

    return {
      plans: rows,
      summary: {
        total: rows.length,
        active: rows.filter((p) => p.isActive).length,
        inactive: rows.filter((p) => !p.isActive).length,
      },
    };
  },
});

// admin function to get billing plans
export const adminGetBillingPlan = query({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const plan = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (!plan) {
      throw new Error("Plan not found.");
    }

    const subscriptions = await ctx.db
      .query("subscriptions")
      .collect();

    const activeSubscriptionCount = subscriptions.filter(
      (subscription) =>
        subscription.planKey === plan.key &&
        ["active", "trialing", "past_due"].includes(subscription.status),
    ).length;

    return {
      ...plan,
      activeSubscriptionCount,
    };
  },
});

export const adminCreateBillingPlan = mutation({
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
    await requireBillingAdmin(ctx);

    const key = args.key.trim();
    if (!key) {
      throw new Error("Plan key is required.");
    }

    if (!args.name.trim()) {
      throw new Error("Plan name is required.");
    }

    const existing = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (existing) {
      throw new Error("A plan with that key already exists.");
    }

    assertNonNegativeFields(args, [
      "priceMonthlyCents",
      "includedCredits",
      "lowCreditThreshold",
      "maxBrands",
      "maxSeats",
    ]);

    const now = Date.now();

    await ctx.db.insert("billingPlans", {
      key,
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
      version: BILLING_CONFIG_VERSION,
      createdAt: now,
      updatedAt: now,
    });

    return { created: true, key };
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
    await requireBillingAdmin (ctx);
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

export const adminDeleteBillingPlan = mutation({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim();

    const existing = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("Plan not found.");
    }

    const activeStatuses = new Set([
      "active",
      "trialing",
      "past_due",
    ]);

    const activeSubscriptionCount = (
      await ctx.db.query("subscriptions").collect()
    ).filter(
      (subscription) =>
        subscription.planKey === key &&
        activeStatuses.has(subscription.status),
    ).length;

    if (activeSubscriptionCount > 0) {
      throw new Error(
        `Cannot delete this plan because ${activeSubscriptionCount} active subscription${
          activeSubscriptionCount === 1 ? "" : "s"
        } still use it.`,
      );
    }

    if (!existing.isActive) {
      return {
        deleted: false,
        message: "Plan is already inactive.",
      };
    }

    await ctx.db.patch(existing._id, {
      isActive: false,
      updatedAt: Date.now(),
      version: (existing.version ?? BILLING_CONFIG_VERSION) + 1,
    });

    return {
      deleted: true,
      key,
    };
  },
});


// BILLING SETTINGS

export const adminGetBillingSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const settings = await ctx.db.query("billingSettings").collect();

    const rows = settings.sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );

    return {
      settings: rows,
      active:
        rows.find((row) => row.isActive) ?? null,
      summary: {
        total: rows.length,
        active: rows.filter((row) => row.isActive).length,
        inactive: rows.filter((row) => !row.isActive).length,
      },
    };
  },
});

export const adminUpdateBillingSettings = mutation({
  args: {
    key: v.string(),

    trialDurationDays: v.number(),
    trialCredits: v.number(),
    trialLowCreditThreshold: v.number(),

    trialTemplateLimit: v.optional(v.number()),
    trialTemplateRefreshEnabled: v.optional(v.boolean()),
    trialTemplateRefreshDays: v.optional(v.number()),
    trialTemplateAiCovers: v.optional(v.boolean()),

    templateBasePoolEvergreenTarget: v.optional(v.number()),
    templateBasePoolSeasonalEvergreenTarget: v.optional(v.number()),
    templateBasePoolSeasonalEventTarget: v.optional(v.number()),

    // legacy values
    templateBasePoolTrendingTarget: v.optional(v.number()),
    templateBasePoolSeasonalTrendingTarget: v.optional(v.number()),
    templateBasePoolSeasonalTarget: v.optional(v.number()),

    creditPurchaseInvoicePolicy: v.optional(
      v.union(
        v.literal("receipt_only"),
        v.literal("always"),
        v.literal("on_request"),
      ),
    ),

    requirePaymentMethodForTrial: v.boolean(),
    allowTopUpsDuringTrial: v.boolean(),
    oneTrialPerAccount: v.boolean(),

    defaultCreditValueCents: v.number(),
    defaultMarkup: v.number(),

    isActive: v.boolean(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim();

    const existing = await ctx.db
      .query("billingSettings")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("Billing settings not found.");
    }

    assertNonNegativeFields(args, [
      "trialDurationDays",
      "trialCredits",
      "trialLowCreditThreshold",
      "defaultCreditValueCents",
      "defaultMarkup",
    ]);

    if (
      args.trialTemplateLimit !== undefined &&
      args.trialTemplateLimit < 0
    ) {
      throw new Error(
        "trialTemplateLimit cannot be negative.",
      );
    }

    if (
      args.trialTemplateRefreshDays !== undefined &&
      args.trialTemplateRefreshDays < 0
    ) {
      throw new Error(
        "trialTemplateRefreshDays cannot be negative.",
      );
    }

    const optionalNonNegative = [
      "templateBasePoolEvergreenTarget",
      "templateBasePoolSeasonalEvergreenTarget",
      "templateBasePoolSeasonalEventTarget",
      "templateBasePoolTrendingTarget",
      "templateBasePoolSeasonalTrendingTarget",
      "templateBasePoolSeasonalTarget",
    ] as const;

    for (const field of optionalNonNegative) {
      const value = args[field];

      if (value !== undefined && value < 0) {
        throw new Error(`${field} cannot be negative.`);
      }
    }

    if (!args.isActive && existing.isActive) {
      const activeSettings = (
        await ctx.db.query("billingSettings").collect()
      ).filter(
        (row) =>
          row._id !== existing._id &&
          row.isActive,
      );

      if (activeSettings.length === 0) {
        throw new Error(
          "At least one active billing settings record must exist.",
        );
      }
    }

    await ctx.db.patch(existing._id, {
      trialDurationDays: args.trialDurationDays,
      trialCredits: args.trialCredits,
      trialLowCreditThreshold:
        args.trialLowCreditThreshold,

      trialTemplateLimit:
        args.trialTemplateLimit,
      trialTemplateRefreshEnabled:
        args.trialTemplateRefreshEnabled,
      trialTemplateRefreshDays:
        args.trialTemplateRefreshDays,
      trialTemplateAiCovers:
        args.trialTemplateAiCovers,

      templateBasePoolEvergreenTarget:
        args.templateBasePoolEvergreenTarget,
      templateBasePoolSeasonalEvergreenTarget:
        args.templateBasePoolSeasonalEvergreenTarget,
      templateBasePoolSeasonalEventTarget:
        args.templateBasePoolSeasonalEventTarget,

      templateBasePoolTrendingTarget:
        args.templateBasePoolTrendingTarget,
      templateBasePoolSeasonalTrendingTarget:
        args.templateBasePoolSeasonalTrendingTarget,
      templateBasePoolSeasonalTarget:
        args.templateBasePoolSeasonalTarget,

      creditPurchaseInvoicePolicy:
        args.creditPurchaseInvoicePolicy,

      requirePaymentMethodForTrial:
        args.requirePaymentMethodForTrial,
      allowTopUpsDuringTrial:
        args.allowTopUpsDuringTrial,
      oneTrialPerAccount:
        args.oneTrialPerAccount,

      defaultCreditValueCents:
        args.defaultCreditValueCents,
      defaultMarkup: args.defaultMarkup,

      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    return {
      updated: true,
      key,
    };
  },
});


// CREDIT TOP-UP PACKAGES

export const adminGetCreditPackages = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const packages = await ctx.db
      .query("creditTopUpPackages")
      .collect();

    const rows = packages.sort(
      (a, b) => a.priceCents - b.priceCents,
    );

    return {
      packages: rows,
      summary: {
        total: rows.length,
        active: rows.filter((p) => p.isActive).length,
        inactive: rows.filter((p) => !p.isActive).length,
      },
    };
  },
});

export const adminGetCreditPackage = query({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const pkg = await ctx.db
      .query("creditTopUpPackages")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (!pkg) {
      throw new Error("Credit package not found.");
    }

    return pkg;
  },
});

export const adminCreateCreditPackage = mutation({
  args: {
    key: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    credits: v.number(),
    priceCents: v.number(),
    currency: v.string(),
    expiresAfterDays: v.optional(v.number()),
    stripePriceId: v.optional(v.string()),
    isActive: v.boolean(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim().toLowerCase();

    if (!key) {
      throw new Error("Package key is required.");
    }

    if (!args.label.trim()) {
      throw new Error("Package label is required.");
    }

    const existing = await ctx.db
      .query("creditTopUpPackages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (existing) {
      throw new Error(
        "A package with this key already exists.",
      );
    }

    assertNonNegativeFields(args, [
      "credits",
      "priceCents",
    ]);

    if (
      args.expiresAfterDays !== undefined &&
      args.expiresAfterDays < 0
    ) {
      throw new Error(
        "expiresAfterDays cannot be negative.",
      );
    }

    const now = Date.now();

    const id = await ctx.db.insert(
      "creditTopUpPackages",
      {
        key,
        label: args.label.trim(),
        description:
          args.description?.trim() || undefined,
        credits: args.credits,
        priceCents: args.priceCents,
        currency: args.currency
          .trim()
          .toUpperCase(),
        expiresAfterDays:
          args.expiresAfterDays,
        stripePriceId:
          args.stripePriceId?.trim() ||
          undefined,
        isActive: args.isActive,
        createdAt: now,
        updatedAt: now,
      },
    );

    return {
      created: true,
      id,
      key,
    };
  },
});

export const adminUpdateCreditPackage = mutation({
  args: {
    key: v.string(),
    label: v.string(),
    description: v.optional(v.string()),
    credits: v.number(),
    priceCents: v.number(),
    currency: v.string(),
    expiresAfterDays: v.optional(v.number()),
    stripePriceId: v.optional(v.string()),
    isActive: v.boolean(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim().toLowerCase();

    const existing = await ctx.db
      .query("creditTopUpPackages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("Credit package not found.");
    }

    if (!args.label.trim()) {
      throw new Error("Package label is required.");
    }

    assertNonNegativeFields(args, [
      "credits",
      "priceCents",
    ]);

    if (
      args.expiresAfterDays !== undefined &&
      args.expiresAfterDays < 0
    ) {
      throw new Error(
        "expiresAfterDays cannot be negative."
      );
    }

    await ctx.db.patch(existing._id, {
      label: args.label.trim(),
      description:
        args.description?.trim() || undefined,
      credits: args.credits,
      priceCents: args.priceCents,
      currency: args.currency
        .trim()
        .toUpperCase(),
      expiresAfterDays:
        args.expiresAfterDays,
      stripePriceId:
        args.stripePriceId?.trim() ||
        undefined,
      isActive: args.isActive,
      updatedAt: Date.now(),
    });

    return {
      updated: true,
      key,
    };
  },
});

export const adminDeleteCreditPackage = mutation({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim().toLowerCase();

    const existing = await ctx.db
      .query("creditTopUpPackages")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("Credit package not found.");
    }

    if (!existing.isActive) {
      return {
        deleted: false,
        message: "Credit package is already inactive.",
      };
    }

    await ctx.db.patch(existing._id, {
      isActive: false,
      updatedAt: Date.now(),
    });

    return {
      deleted: true,
      key,
    };
  },
});


// AI SKUS

export const adminGetAiSkus = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const skus = await ctx.db.query("aiSkus").collect();

    const rows = skus.sort((a, b) => {
      if (a.provider === b.provider) {
        return a.label.localeCompare(b.label);
      }

      return a.provider.localeCompare(b.provider);
    });

    return {
      skus: rows,
      summary: {
        total: rows.length,
        active: rows.filter((s) => s.isActive).length,
        inactive: rows.filter((s) => !s.isActive).length,
      },
    };
  },
});

export const adminGetAiSku = query({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const sku = await ctx.db
      .query("aiSkus")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();

    if (!sku) {
      throw new Error("AI SKU not found.");
    }

    return sku;
  },
});

export const adminCreateAiSku = mutation({
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
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim().toLowerCase();

    if (!key) {
      throw new Error("SKU key is required.");
    }

    if (!args.label.trim()) {
      throw new Error("SKU label is required.");
    }

    if (!args.provider.trim()) {
      throw new Error("Provider is required.");
    }

    if (!args.model.trim()) {
      throw new Error("Model is required.");
    }

    if (!args.unitType.trim()) {
      throw new Error("Unit type is required.");
    }

    if (!args.defaultCreditSource.trim()) {
      throw new Error("Default credit source is required.");
    }

    const existing = await ctx.db
      .query("aiSkus")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (existing) {
      throw new Error(
        "An AI SKU with this key already exists."
      );
    }

    assertNonNegativeFields(args, [
      "providerCostPerUnitCents",
    ]);

    if (
      args.creditValueOverrideCents !== undefined &&
      args.creditValueOverrideCents < 0
    ) {
      throw new Error(
        "creditValueOverrideCents cannot be negative."
      );
    }

    if (
      args.markupOverride !== undefined &&
      args.markupOverride < 0
    ) {
      throw new Error(
        "markupOverride cannot be negative."
      );
    }

    if (
      args.effectiveTo !== undefined &&
      args.effectiveTo < args.effectiveFrom
    ) {
      throw new Error(
        "effectiveTo must be after effectiveFrom."
      );
    }

    const now = Date.now();

    const id = await ctx.db.insert("aiSkus", {
      key,
      label: args.label.trim(),
      provider: args.provider.trim(),
      model: args.model.trim(),
      unitType: args.unitType.trim(),
      providerCostPerUnitCents:
        args.providerCostPerUnitCents,
      creditValueOverrideCents:
        args.creditValueOverrideCents,
      markupOverride: args.markupOverride,
      defaultCreditSource:
        args.defaultCreditSource.trim(),
      isActive: args.isActive,
      effectiveFrom: args.effectiveFrom,
      effectiveTo: args.effectiveTo,
      metadata: args.metadata,
      createdAt: now,
      updatedAt: now,
    });

    return {
      created: true,
      id,
      key,
    };
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
    effectiveFrom: v.number(),
    effectiveTo: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim().toLowerCase();

    const existing = await ctx.db
      .query("aiSkus")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("AI SKU not found.");
    }

    if (!args.label.trim()) {
      throw new Error("SKU label is required.");
    }

    if (!args.provider.trim()) {
      throw new Error("Provider is required.");
    }

    if (!args.model.trim()) {
      throw new Error("Model is required.");
    }

    if (!args.unitType.trim()) {
      throw new Error("Unit type is required.");
    }

    if (!args.defaultCreditSource.trim()) {
      throw new Error("Default credit source is required.");
    }

    assertNonNegativeFields(args, [
      "providerCostPerUnitCents",
    ]);

    if (
      args.creditValueOverrideCents !== undefined &&
      args.creditValueOverrideCents < 0
    ) {
      throw new Error(
        "creditValueOverrideCents cannot be negative."
      );
    }

    if (
      args.markupOverride !== undefined &&
      args.markupOverride < 0
    ) {
      throw new Error(
        "markupOverride cannot be negative."
      );
    }

    if (
      args.effectiveTo !== undefined &&
      args.effectiveTo < args.effectiveFrom
    ) {
      throw new Error(
        "effectiveTo must be after effectiveFrom."
      );
    }

    await ctx.db.patch(existing._id, {
      label: args.label.trim(),
      provider: args.provider.trim(),
      model: args.model.trim(),
      unitType: args.unitType.trim(),
      providerCostPerUnitCents:
        args.providerCostPerUnitCents,
      creditValueOverrideCents:
        args.creditValueOverrideCents,
      markupOverride: args.markupOverride,
      defaultCreditSource:
        args.defaultCreditSource.trim(),
      isActive: args.isActive,
      effectiveFrom: args.effectiveFrom,
      effectiveTo: args.effectiveTo,
      metadata: args.metadata,
      updatedAt: Date.now(),
    });

    return {
      updated: true,
      key,
    };
  },
});

export const adminDeleteAiSku = mutation({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim().toLowerCase();

    const existing = await ctx.db
      .query("aiSkus")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("AI SKU not found.");
    }

    if (!existing.isActive) {
      return {
        deleted: false,
        message: "AI SKU is already inactive.",
      };
    }

    // Prevent deactivating a SKU that is currently in effect.
    const now = Date.now();

    if (
      existing.effectiveFrom <= now &&
      (!existing.effectiveTo ||
        existing.effectiveTo >= now)
    ) {
      throw new Error(
        "This AI SKU is currently effective. Set an effectiveTo date or migrate usage before deactivating it."
      );
    }

    await ctx.db.patch(existing._id, {
      isActive: false,
      updatedAt: Date.now(),
    });

    return {
      deleted: true,
      key,
    };
  },
});


// SUBSCRIPTIONS

export const adminGetSubscriptions = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const subscriptions = await ctx.db
      .query("subscriptions")
      .collect();

    const plans = await ctx.db
      .query("billingPlans")
      .collect();

    const planMap = new Map(
      plans.map((plan) => [plan.key, plan]),
    );

    const rows = subscriptions
      .map((subscription) => ({
        ...subscription,
        plan: planMap.get(subscription.planKey) ?? null,
      }))
      .sort(
        (a, b) => b.updatedAt - a.updatedAt,
      );

    const activeStatuses = new Set([
      "active",
      "trialing",
      "past_due",
    ]);

    return {
      subscriptions: rows,
      summary: {
        total: rows.length,
        active: rows.filter((s) =>
          activeStatuses.has(s.status),
        ).length,
        cancelled: rows.filter(
          (s) => s.status === "canceled",
        ).length,
        trialing: rows.filter(
          (s) => s.status === "trialing",
        ).length,
        scheduledForCancellation: rows.filter(
          (s) => s.cancelAtPeriodEnd,
        ).length,
      },
    };
  },
});

export const adminGetSubscription = query({
  args: {
    subscriptionId: v.id("subscriptions"),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const subscription = await ctx.db.get(
      args.subscriptionId,
    );

    if (!subscription) {
      throw new Error(
        "Subscription not found.",
      );
    }

    const plan = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) =>
        q.eq("key", subscription.planKey),
      )
      .first();

    const previousPlan = subscription.previousPlanKey
      ? await ctx.db
          .query("billingPlans")
          .withIndex("by_key", (q) =>
            q.eq(
              "key",
              subscription.previousPlanKey!,
            ),
          )
          .first()
      : null;

    const pendingPlan = subscription.pendingPlanKey
      ? await ctx.db
          .query("billingPlans")
          .withIndex("by_key", (q) =>
            q.eq(
              "key",
              subscription.pendingPlanKey!,
            ),
          )
          .first()
      : null;

    const creditAccount = (
      await ctx.db
        .query("creditAccounts")
        .withIndex("by_userId", (q) =>
          q.eq("userId", subscription.userId),
        )
        .first()
    ) ?? null;

    return {
      ...subscription,
      plan,
      previousPlan,
      pendingPlan,
      creditAccount,
    };
  },
});

export const adminCancelSubscription = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    immediate: v.optional(v.boolean()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const subscription = await ctx.db.get(
      args.subscriptionId,
    );

    if (!subscription) {
      throw new Error("Subscription not found.");
    }

    if (
      ["canceled", "cancelled"].includes(
        subscription.status,
      )
    ) {
      throw new Error(
        "Subscription is already cancelled."
      );
    }

    const now = Date.now();

    if (args.immediate) {
      await ctx.db.patch(subscription._id, {
        status: "canceled",
        cancelAtPeriodEnd: false,
        currentPeriodEnd: now,
        updatedAt: now,
      });

      return {
        cancelled: true,
        immediate: true,
      };
    }

    await ctx.db.patch(subscription._id, {
      cancelAtPeriodEnd: true,
      updatedAt: now,
    });

    return {
      cancelled: true,
      immediate: false,
    };
  },
});

export const adminResumeSubscription = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const subscription = await ctx.db.get(
      args.subscriptionId,
    );

    if (!subscription) {
      throw new Error("Subscription not found.");
    }

    if (
      ["canceled", "cancelled"].includes(
        subscription.status,
      )
    ) {
      throw new Error(
        "A cancelled subscription cannot be resumed."
      );
    }

    if (!subscription.cancelAtPeriodEnd) {
      return {
        resumed: false,
        message:
          "Subscription is already active.",
      };
    }

    await ctx.db.patch(subscription._id, {
      cancelAtPeriodEnd: false,
      updatedAt: Date.now(),
    });

    return {
      resumed: true,
    };
  },
});

export const adminChangeSubscriptionPlan = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    planKey: v.string(),
    effectiveImmediately: v.optional(v.boolean()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const subscription = await ctx.db.get(
      args.subscriptionId,
    );

    if (!subscription) {
      throw new Error("Subscription not found.");
    }

    const plan = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) =>
        q.eq("key", args.planKey.trim())
      )
      .first();

    if (!plan || !plan.isActive) {
      throw new Error(
        "Billing plan not found or inactive."
      );
    }

    if (plan.key === subscription.planKey) {
      throw new Error(
        "Subscription is already on this plan."
      );
    }

    const now = Date.now();

    if (args.effectiveImmediately) {
      await ctx.db.patch(subscription._id, {
        previousPlanKey: subscription.planKey,
        planKey: plan.key,
        planVersion:
          plan.version ?? BILLING_CONFIG_VERSION,
        pendingPlanKey: undefined,
        pendingPlanChangedAt: undefined,
        pendingPlanEffectiveAt: undefined,
        pendingUpgradeCredits: undefined,
        updatedAt: now,
      });

      return {
        updated: true,
        effectiveImmediately: true,
        planKey: plan.key,
      };
    }

    await ctx.db.patch(subscription._id, {
      pendingPlanKey: plan.key,
      pendingPlanChangedAt: now,
      pendingPlanEffectiveAt:
        subscription.currentPeriodEnd,
      updatedAt: now,
    });

    return {
      updated: true,
      effectiveImmediately: false,
      planKey: plan.key,
    };
  },
});

export const adminGrantTrial = mutation({
  args: {
    subscriptionId: v.id("subscriptions"),
    durationDays: v.number(),
    trialCredits: v.number(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const subscription = await ctx.db.get(
      args.subscriptionId,
    );

    if (!subscription) {
      throw new Error("Subscription not found.");
    }

    assertNonNegativeFields(args, [
      "durationDays",
      "trialCredits",
    ]);

    if (args.durationDays <= 0) {
      throw new Error(
        "Trial duration must be greater than zero."
      );
    }

    const now = Date.now();
    const trialEndsAt =
      now + args.durationDays * 24 * 60 * 60 * 1000;

    await ctx.db.patch(subscription._id, {
      status: "trialing",
      trialStartedAt: now,
      trialEndsAt,
      trialCreditsGranted: args.trialCredits,
      manualTrialActivationAt: now,
      cancelAtPeriodEnd: false,
      updatedAt: now,
    });

    const creditAccount = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) =>
        q.eq("userId", subscription.userId)
      )
      .first();

    if (creditAccount) {
      await ctx.db.patch(creditAccount._id, {
        availableCredits:
          creditAccount.availableCredits +
          args.trialCredits,
        updatedAt: now,
      });

    //   await ctx.db.insert("creditLedger", {
    //     accountId: creditAccount._id,
    //     userId: subscription.userId,
    //     type: "trial_credit_grant",
    //     amount: args.trialCredits,
    //     balanceAfter:
    //       creditAccount.availableCredits +
    //       args.trialCredits,
    //     metadata: {
    //       subscriptionId: subscription._id,
    //       grantedBy: "admin",
    //     },
    //     createdAt: now,
    //   }

      await ctx.db.insert("creditLedger", {
        userId: subscription.userId,
        type: "trial_credit_grant",
        amount: args.trialCredits,
        balanceAfter:
            creditAccount.availableCredits + args.trialCredits,
        creditSource: "trial",
        reason: "Admin granted trial credits",
        metadata: {
            subscriptionId: subscription._id,
            grantedBy: "admin",
        },
        createdAt: now,
        createdBy: "admin",
       });
    }

    return {
      granted: true,
      trialEndsAt,
    };
  },
});

// CREDIT ACCOUNTS

export const adminGetCreditAccounts = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const accounts = await ctx.db
      .query("creditAccounts")
      .collect();

    const rows = accounts.sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );

    return {
      accounts: rows,
      summary: {
        total: rows.length,
        totalAvailableCredits: rows.reduce(
          (sum, row) => sum + row.availableCredits,
          0,
        ),
        totalReservedCredits: rows.reduce(
          (sum, row) => sum + row.reservedCredits,
          0,
        ),
        totalPurchasedCredits: rows.reduce(
          (sum, row) => sum + row.lifetimePurchasedCredits,
          0,
        ),
        totalGrantedCredits: rows.reduce(
          (sum, row) => sum + row.lifetimeGrantedCredits,
          0,
        ),
        totalConsumedCredits: rows.reduce(
          (sum, row) => sum + row.lifetimeConsumedCredits,
          0,
        ),
      },
    };
  },
});

export const adminAdjustCredits = mutation({
  args: {
    userId: v.string(),
    amount: v.number(),
    reason: v.string(),
    metadata: v.optional(v.any()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    if (args.amount === 0) {
      throw new Error(
        "Adjustment amount cannot be zero.",
      );
    }

    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) =>
        q.eq("userId", args.userId),
      )
      .first();

    if (!account) {
      throw new Error(
        "Credit account not found.",
      );
    }

    const balance =
      account.availableCredits + args.amount;

    if (balance < 0) {
      throw new Error(
        "Insufficient available credits.",
      );
    }

    const now = Date.now();

    await ctx.db.patch(account._id, {
      availableCredits: balance,
      lifetimeGrantedCredits:
        args.amount > 0
          ? account.lifetimeGrantedCredits +
            args.amount
          : account.lifetimeGrantedCredits,
      lifetimeConsumedCredits:
        args.amount < 0
          ? account.lifetimeConsumedCredits +
            Math.abs(args.amount)
          : account.lifetimeConsumedCredits,
      updatedAt: now,
    });

    await ctx.db.insert("creditLedger", {
      userId: args.userId,
      type: "admin_adjustment",
      amount: args.amount,
      balanceAfter: balance,
      reason: args.reason.trim(),
      metadata: args.metadata,
      createdAt: now,
    });

    return {
      adjusted: true,
      balance,
    };
  },
});

export const adminGrantCredits = mutation({
  args: {
    userId: v.string(),
    credits: v.number(),
    reason: v.string(),
    metadata: v.optional(v.any()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    assertNonNegativeFields(args, [
      "credits",
    ]);

    if (args.credits <= 0) {
      throw new Error(
        "Credits must be greater than zero.",
      );
    }

    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) =>
        q.eq("userId", args.userId),
      )
      .first();

    if (!account) {
      throw new Error(
        "Credit account not found.",
      );
    }

    const now = Date.now();
    const balance =
      account.availableCredits + args.credits;

    await ctx.db.patch(account._id, {
      availableCredits: balance,
      lifetimeGrantedCredits:
        account.lifetimeGrantedCredits +
        args.credits,
      currentPeriodGrantedCredits:
        account.currentPeriodGrantedCredits +
        args.credits,
      updatedAt: now,
    });

    await ctx.db.insert("creditLedger", {
      userId: args.userId,
      type: "admin_grant",
      amount: args.credits,
      balanceAfter: balance,
      reason: args.reason.trim(),
      metadata: args.metadata,
      createdAt: now,
    });

    return {
      granted: true,
      balance,
    };
  },
});

export const adminDeductCredits = mutation({
  args: {
    userId: v.string(),
    credits: v.number(),
    reason: v.string(),
    metadata: v.optional(v.any()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    assertNonNegativeFields(args, [
      "credits",
    ]);

    if (args.credits <= 0) {
      throw new Error(
        "Credits must be greater than zero.",
      );
    }

    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) =>
        q.eq("userId", args.userId),
      )
      .first();

    if (!account) {
      throw new Error(
        "Credit account not found.",
      );
    }

    if (
      account.availableCredits < args.credits
    ) {
      throw new Error(
        "Insufficient available credits."
      );
    }

    const now = Date.now();
    const balance =
      account.availableCredits - args.credits;

    await ctx.db.patch(account._id, {
      availableCredits: balance,
      lifetimeConsumedCredits:
        account.lifetimeConsumedCredits +
        args.credits,
      updatedAt: now,
    });

    await ctx.db.insert("creditLedger", {
      userId: args.userId,
      type: "admin_deduction",
      amount: -args.credits,
      balanceAfter: balance,
      reason: args.reason.trim(),
      metadata: args.metadata,
      createdAt: now,
    });

    return {
      deducted: true,
      balance,
    };
  },
});


// BILLING TRANSACTIONS

export const adminGetTransactions = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const transactions = await ctx.db
      .query("billingTransactions")
      .collect();

    const sorted = transactions.sort(
      (a, b) => b.occurredAt - a.occurredAt,
    );

    const rows = await Promise.all(
      sorted.map(async (transaction) => {
        const user = await ctx.db.get(transaction.userId as any);
        return {
          ...transaction,
          customerName: user?._id ?? null,
          customerEmail: user?._id ?? null,
        };
      }),
    );

    return {
      transactions: rows,
      summary: {
        total: rows.length,
        completed: rows.filter(
          (t) => t.status === "completed",
        ).length,
        pending: rows.filter(
          (t) => t.status === "pending",
        ).length,
        failed: rows.filter(
          (t) => t.status === "failed",
        ).length,
        refunded: rows.filter(
          (t) => t.status === "refunded",
        ).length,

        totalRevenueCents: rows
          .filter(
            (t) =>
              t.status === "completed" &&
              t.amountCents !== undefined,
          )
          .reduce(
            (sum, t) => sum + (t.amountCents ?? 0),
            0,
          ),

        totalCreditsSold: rows.reduce(
          (sum, t) => sum + (t.credits ?? 0),
          0,
        ),
      },
    };
  },
});

export const adminGetTransaction = query({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const transaction = await ctx.db
      .query("billingTransactions")
      .withIndex("by_key", (q) =>
        q.eq("key", args.key.trim())
      )
      .first();

    if (!transaction) {
      throw new Error(
        "Transaction not found.",
      );
    }

    return transaction;
  },
});

export const adminCreateTransaction = mutation({
  args: {
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
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim();
    if (!key) {
      throw new Error("Transaction key is required.");
    }

    const existing = await ctx.db
      .query("billingTransactions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (existing) {
      throw new Error("A transaction with that key already exists.");
    }

    const now = Date.now();

    await ctx.db.insert("billingTransactions", {
      key,
      userId: args.userId.trim(),
      type: args.type.trim(),
      status: args.status.trim(),
      title: args.title.trim(),
      amountCents: args.amountCents,
      currency: args.currency?.trim() || undefined,
      credits: args.credits,
      stripeCustomerId: args.stripeCustomerId?.trim() || undefined,
      stripeSessionId: args.stripeSessionId?.trim() || undefined,
      stripeInvoiceId: args.stripeInvoiceId?.trim() || undefined,
      stripePaymentIntentId: args.stripePaymentIntentId?.trim() || undefined,
      stripeChargeId: args.stripeChargeId?.trim() || undefined,
      receiptUrl: args.receiptUrl?.trim() || undefined,
      invoiceUrl: args.invoiceUrl?.trim() || undefined,
      metadata: args.metadata,
      occurredAt: args.occurredAt,
      createdAt: now,
      updatedAt: now,
    });

    return { created: true, key };
  },
});

export const adminUpdateTransaction = mutation({
  args: {
    key: v.string(),
    title: v.optional(v.string()),
    status: v.optional(v.string()),
    type: v.optional(v.string()),
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
    occurredAt: v.optional(v.number()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim();
    if (!key) {
      throw new Error("Transaction key is required.");
    }

    const existing = await ctx.db
      .query("billingTransactions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("Transaction not found.");
    }

    const patch: Record<string, any> = {
      updatedAt: Date.now(),
    };

    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.status !== undefined) patch.status = args.status.trim();
    if (args.type !== undefined) patch.type = args.type.trim();
    if (args.amountCents !== undefined) patch.amountCents = args.amountCents;
    if (args.currency !== undefined) patch.currency = args.currency?.trim() || undefined;
    if (args.credits !== undefined) patch.credits = args.credits;
    if (args.stripeCustomerId !== undefined) patch.stripeCustomerId = args.stripeCustomerId?.trim() || undefined;
    if (args.stripeSessionId !== undefined) patch.stripeSessionId = args.stripeSessionId?.trim() || undefined;
    if (args.stripeInvoiceId !== undefined) patch.stripeInvoiceId = args.stripeInvoiceId?.trim() || undefined;
    if (args.stripePaymentIntentId !== undefined) patch.stripePaymentIntentId = args.stripePaymentIntentId?.trim() || undefined;
    if (args.stripeChargeId !== undefined) patch.stripeChargeId = args.stripeChargeId?.trim() || undefined;
    if (args.receiptUrl !== undefined) patch.receiptUrl = args.receiptUrl?.trim() || undefined;
    if (args.invoiceUrl !== undefined) patch.invoiceUrl = args.invoiceUrl?.trim() || undefined;
    if (args.metadata !== undefined) patch.metadata = args.metadata;
    if (args.occurredAt !== undefined) patch.occurredAt = args.occurredAt;

    await ctx.db.patch(existing._id, patch);

    return { updated: true };
  },
});

export const adminDeleteTransaction = mutation({
  args: {
    key: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const key = args.key.trim();
    if (!key) {
      throw new Error("Transaction key is required.");
    }

    const existing = await ctx.db
      .query("billingTransactions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .first();

    if (!existing) {
      throw new Error("Transaction not found.");
    }

    await ctx.db.delete(existing._id);

    return { deleted: true };
  },
});

// CREDIT LEDGER

export const adminGetCreditLedger = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const entries = await ctx.db
      .query("creditLedger")
      .collect();

    const rows = entries.sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    return {
      ledger: rows,
      summary: {
        total: rows.length,

        creditsGranted: rows
          .filter((r) => r.amount > 0)
          .reduce((sum, r) => sum + r.amount, 0),

        creditsDeducted: rows
          .filter((r) => r.amount < 0)
          .reduce(
            (sum, r) => sum + Math.abs(r.amount),
            0,
          ),

        adminAdjustments: rows.filter((r) =>
          r.type.startsWith("admin"),
        ).length,

        reservationEntries: rows.filter(
          (r) => r.reservationId,
        ).length,

        aiUsageEntries: rows.filter(
          (r) => r.skuKey,
        ).length,
      },
    };
  },
});


// CREDIT RESERVATIONS

export const adminGetReservations = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const reservations = await ctx.db
      .query("creditReservations")
      .collect();

    const rows = reservations.sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    return {
      reservations: rows,
      summary: {
        total: rows.length,

        pending: rows.filter(
          (r) => r.status === "pending",
        ).length,

        reserved: rows.filter(
          (r) => r.status === "reserved",
        ).length,

        charged: rows.filter(
          (r) => r.status === "charged",
        ).length,

        released: rows.filter(
          (r) => r.status === "released",
        ).length,

        expired: rows.filter(
          (r) => r.expiresAt <= Date.now(),
        ).length,

        reservedCredits: rows.reduce(
          (sum, r) => sum + r.estimatedCredits,
          0,
        ),

        chargedCredits: rows.reduce(
          (sum, r) => sum + r.chargedCredits,
          0,
        ),

        releasedCredits: rows.reduce(
          (sum, r) => sum + r.releasedCredits,
          0,
        ),
      },
    };
  },
});

export const adminReleaseReservation = mutation({
  args: {
    reservationId: v.id("creditReservations"),
    reason: v.optional(v.string()),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const reservation = await ctx.db.get(
      args.reservationId,
    );

    if (!reservation) {
      throw new Error(
        "Reservation not found.",
      );
    }

    if (reservation.status === "released") {
      throw new Error(
        "Reservation has already been released."
      );
    }

    if (reservation.status === "charged") {
      throw new Error(
        "A charged reservation cannot be released."
      );
    }

    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) =>
        q.eq("userId", reservation.userId),
      )
      .first();

    if (!account) {
      throw new Error(
        "Credit account not found."
      );
    }

    const releaseAmount =
      reservation.estimatedCredits -
      reservation.chargedCredits -
      reservation.releasedCredits;

    if (releaseAmount <= 0) {
      throw new Error(
        "No credits remain to release."
      );
    }

    const now = Date.now();

    await ctx.db.patch(account._id, {
      availableCredits:
        account.availableCredits +
        releaseAmount,
      reservedCredits:
        Math.max(
          0,
          account.reservedCredits -
            releaseAmount,
        ),
      updatedAt: now,
    });

    await ctx.db.patch(reservation._id, {
      status: "released",
      releasedCredits:
        reservation.releasedCredits +
        releaseAmount,
      updatedAt: now,
    });

    await ctx.db.insert("creditLedger", {
      userId: reservation.userId,
      brandId: reservation.brandId,
      campaignId: reservation.campaignId,
      taskId: reservation.taskId,
      reservationId: reservation._id,
      type: "reservation_release",
      amount: releaseAmount,
      balanceAfter:
        account.availableCredits +
        releaseAmount,
      creditSource:
        reservation.creditSource,
      reason:
        args.reason?.trim() ||
        "Released by administrator",
      createdAt: now,
      createdBy: "admin",
    });

    return {
      released: true,
      creditsReleased: releaseAmount,
    };
  },
});

// AI USAGE EVENTS

export const adminGetAiUsageEvents = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const events = await ctx.db
      .query("aiUsageEvents")
      .collect();

    const rows = events.sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    const providerSummary = new Map<
      string,
      {
        requests: number;
        units: number;
        providerCost: number;
        customerCredits: number;
      }
    >();

    for (const event of rows) {
      const summary =
        providerSummary.get(event.provider) ?? {
          requests: 0,
          units: 0,
          providerCost: 0,
          customerCredits: 0,
        };

      summary.requests += 1;
      summary.units += event.units;
      summary.providerCost +=
        event.estimatedProviderCostCents;
      summary.customerCredits +=
        event.creditsChargedToCustomer;

      providerSummary.set(
        event.provider,
        summary,
      );
    }

    return {
      usageEvents: rows,

      providerSummary: Array.from(
        providerSummary.entries(),
      ).map(([provider, stats]) => ({
        provider,
        ...stats,
      })),

      summary: {
        total: rows.length,

        successful: rows.filter(
          (r) => r.status === "success",
        ).length,

        failed: rows.filter(
          (r) => r.status === "failed",
        ).length,

        pending: rows.filter(
          (r) => r.status === "pending",
        ).length,

        totalUnits: rows.reduce(
          (sum, r) => sum + r.units,
          0,
        ),

        totalEstimatedProviderCostCents:
          rows.reduce(
            (sum, r) =>
              sum +
              r.estimatedProviderCostCents,
            0,
          ),

        totalCreditsPriced: rows.reduce(
          (sum, r) =>
            sum + r.creditsPriced,
          0,
        ),

        totalCreditsCharged: rows.reduce(
          (sum, r) =>
            sum +
            r.creditsChargedToCustomer,
          0,
        ),
      },
    };
  },
});

export const adminGetAiUsageEvent = query({
  args: {
    aiUsageEventId: v.id("aiUsageEvents"),
  },
  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const event = await ctx.db.get(args.aiUsageEventId);
    if (!event) {
      throw new Error("AI usage event not found.");
    }

    return event;
  },
});


// STRIPE CHECKOUT SESSIONS

export const adminGetCheckoutSessions = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const sessions = await ctx.db
      .query("stripeCheckoutSessions")
      .collect();

    const rows = sessions.sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    return {
      checkoutSessions: rows,

      summary: {
        total: rows.length,

        open: rows.filter(
          (s) => s.status === "open",
        ).length,

        completed: rows.filter(
          (s) =>
            s.status === "complete" ||
            s.status === "completed",
        ).length,

        expired: rows.filter(
          (s) => s.status === "expired",
        ).length,

        subscriptionSessions: rows.filter(
          (s) => s.mode === "subscription",
        ).length,

        paymentSessions: rows.filter(
          (s) => s.mode === "payment",
        ).length,

        totalRevenueCents: rows
          .filter(
            (s) =>
              s.status === "complete" ||
              s.status === "completed",
          )
          .reduce(
            (sum, s) =>
              sum + (s.amountCents ?? 0),
            0,
          ),

        totalCreditsPurchased: rows.reduce(
          (sum, s) => sum + (s.credits ?? 0),
          0,
        ),
      },
    };
  },
});


// BILLING WEBHOOK EVENTS

export const adminGetWebhookEvents = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const events = await ctx.db
      .query("billingWebhookEvents")
      .collect();

    const rows = events.sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    const eventTypeSummary = new Map<
      string,
      number
    >();

    for (const event of rows) {
      eventTypeSummary.set(
        event.type,
        (eventTypeSummary.get(event.type) ?? 0) +
          1,
      );
    }

    return {
      webhookEvents: rows,

      eventTypes: Array.from(
        eventTypeSummary.entries(),
      ).map(([type, count]) => ({
        type,
        count,
      })),

      summary: {
        total: rows.length,

        processed: rows.filter(
          (e) => e.status === "processed",
        ).length,

        pending: rows.filter(
          (e) => e.status === "pending",
        ).length,

        failed: rows.filter(
          (e) => e.status === "failed",
        ).length,

        errored: rows.filter(
          (e) => !!e.error,
        ).length,
      },
    };
  },
});


// GENERATION THROTTLE BUCKETS

export const adminGetThrottleBuckets = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const buckets = await ctx.db
      .query("generationThrottleBuckets")
      .collect();

    const rows = buckets.sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );

    const featureSummary = new Map<
      string,
      {
        users: number;
        requests: number;
      }
    >();

    for (const bucket of rows) {
      const summary =
        featureSummary.get(bucket.featureKey) ?? {
          users: 0,
          requests: 0,
        };

      summary.users += 1;
      summary.requests += bucket.count;

      featureSummary.set(
        bucket.featureKey,
        summary,
      );
    }

    return {
      throttleBuckets: rows,

      featureSummary: Array.from(
        featureSummary.entries(),
      ).map(([featureKey, stats]) => ({
        featureKey,
        ...stats,
      })),

      summary: {
        total: rows.length,

        uniqueUsers: new Set(
          rows.map((r) => r.userId),
        ).size,

        totalRequests: rows.reduce(
          (sum, r) => sum + r.count,
          0,
        ),

        featuresTracked:
          featureSummary.size,
      },
    };
  },
});

export const adminResetThrottleBucket = mutation({
  args: {
    userId: v.string(),
    featureKey: v.string(),
  },

  handler: async (ctx, args) => {
    await requireBillingAdmin(ctx);

    const bucket = await ctx.db
      .query("generationThrottleBuckets")
      .withIndex("by_user_feature", (q) =>
        q
          .eq("userId", args.userId)
          .eq("featureKey", args.featureKey)
      )
      .first();

    if (!bucket) {
      throw new Error(
        "Throttle bucket not found."
      );
    }

    const now = Date.now();

    await ctx.db.patch(bucket._id, {
      count: 0,
      windowStartedAt: now,
      updatedAt: now,
    });

    return {
      reset: true,
      userId: args.userId,
      featureKey: args.featureKey,
    };
  },
});