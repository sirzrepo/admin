import { internalAction, internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  lowCreditsEmail,
  paymentFailedEmail,
  planDowngradeScheduledEmail,
  planUpgradedEmail,
  planActivatedEmail,
  renewalUpcomingEmail,
  subscriptionCancelledEmail,
  subscriptionResumedEmail,
  topUpCompletedEmail,
  trialActivatedEmail,
  trialEndingEmail,
  welcomeEmail,
} from "./email";

const DELIVERY_LEASE_MS = 5 * 60 * 1000;
const MAX_DELIVERY_ATTEMPTS = 3;

// ─── sendWelcomeEmail ────────────────────────────────────────────────────────
// Scheduled by completeBranding after a brand finishes onboarding.
// Runs as an internalAction since it calls the Resend API (external HTTP).

export const sendWelcomeEmail = internalAction({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const brand = await ctx.runQuery(internal.brands.getBrandByIdInternal, { brandId: args.brandId });
    if (!brand) return;

    const user = await ctx.runQuery(internal.users.getUserById, { userId: brand.userId });
    if (!user?.email) return;

    const deliveryKey = `welcome:v1:${args.brandId}`;
    const claim = await ctx.runMutation(internal.services.sendEmail.claimEmailDelivery, {
      key: deliveryKey,
      userId: `${brand.userId}`,
      type: "welcome",
      recipient: user.email,
      metadata: { brandId: args.brandId, brandName: brand.name },
    });
    if (!claim.claimed) return { sent: false, reason: "already_sent_or_in_progress" };

    const apiKey = process.env.AUTH_RESEND_KEY;
    const from = process.env.AUTH_EMAIL_FROM || "SIRz <noreply@breezepost.app>";
    if (!apiKey) {
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "failed",
        error: "AUTH_RESEND_KEY is not configured",
      });
      console.warn("[sendWelcomeEmail] AUTH_RESEND_KEY not set, skipping welcome email");
      return { sent: false, reason: "email_not_configured" };
    }

    const email = welcomeEmail({ brandName: brand.name });

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": deliveryKey,
        },
        body: JSON.stringify({
          from,
          to: user.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });

      const responseBody: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseBody?.message ?? `Resend request failed: ${res.status}`);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "sent",
        providerMessageId: responseBody?.id,
      });
      console.log(`[sendWelcomeEmail] Welcome email sent to ${user.email}`);
      return { sent: true, providerMessageId: responseBody?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "failed",
        error: message,
      });
      console.error("[sendWelcomeEmail] Resend error:", message);
      if (claim.attempts < MAX_DELIVERY_ATTEMPTS) {
        const delay = claim.attempts === 1 ? 60_000 : 5 * 60_000;
        await ctx.scheduler.runAfter(delay, internal.services.sendEmail.sendWelcomeEmail, args);
      }
      return { sent: false, reason: "provider_error", error: message };
    }
  },
});

export const getTrialActivatedEmailContext = internalQuery({
  args: { stripeSessionId: v.string() },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("stripeCheckoutSessions")
      .withIndex("by_stripeSessionId", (q) => q.eq("stripeSessionId", args.stripeSessionId))
      .first();
    if (!session?.planKey || session.mode !== "subscription" || session.status !== "complete") return null;

    const user = await ctx.db.get(session.userId as Id<"users">);
    if (!user?.email) return null;
    const subscription = session.stripeSubscriptionId
      ? await ctx.db
        .query("subscriptions")
        .withIndex("by_stripeSubscriptionId", (q) => q.eq("stripeSubscriptionId", session.stripeSubscriptionId))
        .first()
      : null;
    if (!subscription || subscription.status !== "trialing" || !subscription.trialEndsAt) return null;
    const plan = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) => q.eq("key", session.planKey!))
      .first();
    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", session.userId))
      .first();
    if (!plan) return null;

    return {
      userId: session.userId,
      recipient: user.email,
      customerName: user.name,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      planName: plan.name,
      credits: subscription.trialCreditsGranted ?? account?.availableCredits ?? 0,
      trialEndsAt: subscription.trialEndsAt,
      priceMonthlyCents: plan.priceMonthlyCents,
      currency: plan.currency,
    };
  },
});

export const claimEmailDelivery = internalMutation({
  args: {
    key: v.string(),
    userId: v.string(),
    type: v.string(),
    recipient: v.string(),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("emailDeliveries")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing?.status === "sent") return { claimed: false, attempts: existing.attempts };
    if (existing?.status === "sending" && existing.updatedAt > now - DELIVERY_LEASE_MS) {
      return { claimed: false, attempts: existing.attempts };
    }
    const attempts = (existing?.attempts ?? 0) + 1;
    if (attempts > MAX_DELIVERY_ATTEMPTS) return { claimed: false, attempts: existing?.attempts ?? 0 };
    const payload = {
      userId: args.userId,
      type: args.type,
      recipient: args.recipient,
      status: "sending",
      attempts,
      error: undefined,
      metadata: args.metadata,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, payload);
    } else {
      await ctx.db.insert("emailDeliveries", { ...payload, key: args.key, createdAt: now });
    }
    return { claimed: true, attempts };
  },
});

export const completeEmailDelivery = internalMutation({
  args: {
    key: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const delivery = await ctx.db
      .query("emailDeliveries")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (!delivery) return;
    await ctx.db.patch(delivery._id, {
      status: args.status,
      providerMessageId: args.providerMessageId,
      error: args.error,
      sentAt: args.status === "sent" ? Date.now() : delivery.sentAt,
      updatedAt: Date.now(),
    });
  },
});

export const sendTrialActivatedEmail = internalAction({
  args: { stripeSessionId: v.string() },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.services.sendEmail.getTrialActivatedEmailContext, args);
    if (!context) return { sent: false, reason: "context_not_ready" };

    const deliveryKey = `trial_activated:v2:${context.stripeSubscriptionId ?? args.stripeSessionId}`;
    const claim = await ctx.runMutation(internal.services.sendEmail.claimEmailDelivery, {
      key: deliveryKey,
      userId: context.userId,
      type: "trial_activated",
      recipient: context.recipient,
      metadata: { stripeSessionId: args.stripeSessionId, stripeSubscriptionId: context.stripeSubscriptionId },
    });
    if (!claim.claimed) return { sent: false, reason: "already_sent_or_in_progress" };

    const apiKey = process.env.AUTH_RESEND_KEY;
    const from = process.env.AUTH_EMAIL_FROM || "SIRz <noreply@breezepost.app>";
    if (!apiKey) {
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "failed",
        error: "AUTH_RESEND_KEY is not configured",
      });
      return { sent: false, reason: "email_not_configured" };
    }

    const dashboardUrl = `${process.env.SITE_URL || "http://localhost:5174"}/dashboard`;
    const email = trialActivatedEmail({
      customerName: context.customerName,
      planName: context.planName,
      credits: context.credits,
      trialEndsAt: context.trialEndsAt,
      priceMonthlyCents: context.priceMonthlyCents,
      currency: context.currency,
      dashboardUrl,
    });

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": deliveryKey,
        },
        body: JSON.stringify({
          from,
          to: context.recipient,
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });
      const responseBody: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseBody?.message ?? `Resend request failed: ${res.status}`);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "sent",
        providerMessageId: responseBody?.id,
      });
      return { sent: true, providerMessageId: responseBody?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "failed",
        error: message,
      });
      if (claim.attempts < MAX_DELIVERY_ATTEMPTS) {
        const delay = claim.attempts === 1 ? 60_000 : 5 * 60_000;
        await ctx.scheduler.runAfter(delay, internal.services.sendEmail.sendTrialActivatedEmail, args);
      }
      return { sent: false, reason: "provider_error", error: message };
    }
  },
});

export const getPlanActivatedEmailContext = internalQuery({
  args: { userId: v.string(), planKey: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId as Id<"users">);
    if (!user?.email) return null;
    const plan = await ctx.db
      .query("billingPlans")
      .withIndex("by_key", (q) => q.eq("key", args.planKey))
      .first();
    if (!plan) return null;
    return {
      userId: args.userId,
      recipient: user.email,
      customerName: user.name,
      planName: plan.name,
      credits: plan.includedCredits,
    };
  },
});

export const sendPlanActivatedEmail = internalAction({
  args: {
    userId: v.string(),
    planKey: v.string(),
    stripeInvoiceId: v.string(),
    amountPaidCents: v.number(),
    currency: v.string(),
    nextRenewalAt: v.optional(v.number()),
    invoiceUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.services.sendEmail.getPlanActivatedEmailContext, {
      userId: args.userId,
      planKey: args.planKey,
    });
    if (!context) return { sent: false, reason: "context_not_ready" };

    const deliveryKey = `plan_activated:v1:${args.stripeInvoiceId}`;
    const claim = await ctx.runMutation(internal.services.sendEmail.claimEmailDelivery, {
      key: deliveryKey,
      userId: context.userId,
      type: "plan_activated",
      recipient: context.recipient,
      metadata: { stripeInvoiceId: args.stripeInvoiceId, planKey: args.planKey },
    });
    if (!claim.claimed) return { sent: false, reason: "already_sent_or_in_progress" };

    const apiKey = process.env.AUTH_RESEND_KEY;
    const from = process.env.AUTH_EMAIL_FROM || "SIRz <noreply@breezepost.app>";
    if (!apiKey) {
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "failed",
        error: "AUTH_RESEND_KEY is not configured",
      });
      return { sent: false, reason: "email_not_configured" };
    }

    const dashboardUrl = `${process.env.SITE_URL || "http://localhost:5174"}/dashboard`;
    const email = planActivatedEmail({
      customerName: context.customerName,
      planName: context.planName,
      credits: context.credits,
      amountPaidCents: args.amountPaidCents,
      currency: args.currency,
      nextRenewalAt: args.nextRenewalAt,
      dashboardUrl,
      invoiceUrl: args.invoiceUrl,
    });

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": deliveryKey,
        },
        body: JSON.stringify({
          from,
          to: context.recipient,
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });
      const responseBody: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseBody?.message ?? `Resend request failed: ${res.status}`);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "sent",
        providerMessageId: responseBody?.id,
      });
      return { sent: true, providerMessageId: responseBody?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: deliveryKey,
        status: "failed",
        error: message,
      });
      if (claim.attempts < MAX_DELIVERY_ATTEMPTS) {
        const delay = claim.attempts === 1 ? 60_000 : 5 * 60_000;
        await ctx.scheduler.runAfter(delay, internal.services.sendEmail.sendPlanActivatedEmail, args);
      }
      return { sent: false, reason: "provider_error", error: message };
    }
  },
});

export const getBillingLifecycleEmailContext = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId as Id<"users">);
    if (!user?.email) return null;
    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();
    const subscription = subscriptions.sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    const plan = subscription?.planKey
      ? await ctx.db.query("billingPlans").withIndex("by_key", (q) => q.eq("key", subscription.planKey)).first()
      : null;
    const account = await ctx.db
      .query("creditAccounts")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .first();
    return {
      recipient: user.email,
      planName: plan?.name ?? "SIRz",
      priceMonthlyCents: plan?.priceMonthlyCents,
      currency: plan?.currency,
      subscriptionStatus: subscription?.status,
      currentPeriodEnd: subscription?.currentPeriodEnd,
      trialEndsAt: subscription?.trialEndsAt,
      availableCredits: account?.availableCredits ?? 0,
    };
  },
});

export const sendBillingLifecycleEmail = internalAction({
  args: {
    deliveryKey: v.string(),
    userId: v.string(),
    type: v.union(
      v.literal("trial_ending"),
      v.literal("cancellation_scheduled"),
      v.literal("subscription_ended"),
      v.literal("subscription_resumed"),
      v.literal("plan_upgraded"),
      v.literal("plan_downgrade_scheduled"),
      v.literal("payment_failed"),
      v.literal("renewal_upcoming"),
      v.literal("low_credits"),
      v.literal("top_up_completed"),
    ),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.services.sendEmail.getBillingLifecycleEmailContext, {
      userId: args.userId,
    });
    if (!context) return { sent: false, reason: "context_not_ready" };

    const claim = await ctx.runMutation(internal.services.sendEmail.claimEmailDelivery, {
      key: args.deliveryKey,
      userId: args.userId,
      type: args.type,
      recipient: context.recipient,
      metadata: args.payload,
    });
    if (!claim.claimed) return { sent: false, reason: "already_sent_or_in_progress" };

    const apiKey = process.env.AUTH_RESEND_KEY;
    const from = process.env.AUTH_EMAIL_FROM || "SIRz <noreply@breezepost.app>";
    if (!apiKey) {
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: args.deliveryKey,
        status: "failed",
        error: "AUTH_RESEND_KEY is not configured",
      });
      return { sent: false, reason: "email_not_configured" };
    }

    const billingUrl = `${process.env.SITE_URL || "http://localhost:5174"}/settings?section=billing`;
    const payload = args.payload ?? {};
    const email = args.type === "trial_ending"
      ? trialEndingEmail({
        planName: context.planName,
        trialEndsAt: Number(payload.trialEndsAt ?? context.trialEndsAt ?? Date.now()),
        credits: context.availableCredits,
        billingUrl,
        priceMonthlyCents: typeof context.priceMonthlyCents === "number" ? context.priceMonthlyCents : undefined,
        currency: typeof context.currency === "string" ? context.currency : undefined,
      })
      : args.type === "cancellation_scheduled" || args.type === "subscription_ended"
        ? subscriptionCancelledEmail({
          planName: context.planName,
          accessEndsAt: Number(payload.accessEndsAt ?? context.currentPeriodEnd) || undefined,
          billingUrl,
          ended: args.type === "subscription_ended",
        })
        : args.type === "subscription_resumed"
          ? subscriptionResumedEmail({
            planName: context.planName,
            nextRenewalAt: Number(payload.nextRenewalAt ?? context.currentPeriodEnd) || undefined,
            billingUrl,
          })
        : args.type === "plan_upgraded"
          ? planUpgradedEmail({
            planName: String(payload.planName ?? context.planName),
            credits: Number(payload.credits ?? 0),
            amountPaidCents: Number(payload.amountPaidCents ?? 0),
            currency: String(payload.currency ?? "USD"),
            nextRenewalAt: Number(payload.nextRenewalAt ?? context.currentPeriodEnd) || undefined,
            billingUrl,
            invoiceUrl: typeof payload.invoiceUrl === "string" ? payload.invoiceUrl : undefined,
          })
        : args.type === "plan_downgrade_scheduled"
          ? planDowngradeScheduledEmail({
            currentPlanName: String(payload.currentPlanName ?? context.planName),
            nextPlanName: String(payload.nextPlanName ?? "your new plan"),
            effectiveAt: Number(payload.effectiveAt ?? context.currentPeriodEnd) || undefined,
            billingUrl,
          })
        : args.type === "payment_failed"
          ? paymentFailedEmail({ planName: context.planName, billingUrl })
        : args.type === "renewal_upcoming"
          ? renewalUpcomingEmail({
            planName: String(payload.planName ?? context.planName),
            renewalAt: Number(payload.renewalAt ?? context.currentPeriodEnd) || undefined,
            amountDueCents: Number(payload.amountDueCents ?? 0),
            currency: String(payload.currency ?? "USD"),
            billingUrl,
          })
          : args.type === "low_credits"
            ? lowCreditsEmail({
              credits: Number(payload.credits ?? context.availableCredits),
              threshold: Number(payload.threshold ?? 0),
              trialing: context.subscriptionStatus === "trialing",
              billingUrl,
            })
            : topUpCompletedEmail({
              creditsAdded: Number(payload.creditsAdded ?? 0),
              balance: Number(payload.balance ?? context.availableCredits),
              amountPaidCents: Number(payload.amountPaidCents ?? 0),
              currency: String(payload.currency ?? "USD"),
              billingUrl,
            });

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": args.deliveryKey,
        },
        body: JSON.stringify({
          from,
          to: context.recipient,
          subject: email.subject,
          html: email.html,
          text: email.text,
        }),
      });
      const responseBody: any = await res.json().catch(() => null);
      if (!res.ok) throw new Error(responseBody?.message ?? `Resend request failed: ${res.status}`);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: args.deliveryKey,
        status: "sent",
        providerMessageId: responseBody?.id,
      });
      return { sent: true, providerMessageId: responseBody?.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.services.sendEmail.completeEmailDelivery, {
        key: args.deliveryKey,
        status: "failed",
        error: message,
      });
      if (claim.attempts < MAX_DELIVERY_ATTEMPTS) {
        const delay = claim.attempts === 1 ? 60_000 : 5 * 60_000;
        await ctx.scheduler.runAfter(delay, internal.services.sendEmail.sendBillingLifecycleEmail, args);
      }
      return { sent: false, reason: "provider_error", error: message };
    }
  },
});
