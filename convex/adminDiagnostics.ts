import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireAdmin } from "./adminAuth";
import { Id } from "./_generated/dataModel";

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;

function clampLimit(limit?: number) {
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit ?? DEFAULT_LIMIT)));
}

function includesSearch(value: unknown, search: string) {
  return String(value ?? "").toLowerCase().includes(search);
}

async function latestSubscription(ctx: any, userId: string) {
  const subscriptions = await ctx.db
    .query("subscriptions")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .collect();
  return subscriptions.sort((a: any, b: any) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0] ?? null;
}

async function creditAccount(ctx: any, userId: string) {
  return await ctx.db
    .query("creditAccounts")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .first();
}

async function userSummary(ctx: any, user: any) {
  const userId = String(user._id);
  const [subscription, account, brands, ledger, transactions] = await Promise.all([
    latestSubscription(ctx, userId),
    creditAccount(ctx, userId),
    ctx.db.query("brands").withIndex("by_userId", (q: any) => q.eq("userId", user._id)).collect(),
    ctx.db.query("creditLedger").withIndex("by_userId", (q: any) => q.eq("userId", userId)).order("desc").take(100),
    ctx.db.query("billingTransactions").withIndex("by_userId_occurredAt", (q: any) => q.eq("userId", userId)).order("desc").take(20),
  ]);
  const usage = creditUsageSummary(ledger);
  const risk = userRiskSummary({ subscription, account, usage, transactions });
  return {
    _id: user._id,
    name: user.name ?? null,
    email: user.email ?? null,
    image: user.image ?? null,
    role: user.role ?? "user",
    createdAt: user._creationTime,
    subscription,
    creditAccount: account,
    usage,
    risk,
    brands: brands.map((brand: any) => ({
      _id: brand._id,
      name: brand.name,
      status: brand.status ?? null,
      templatesStatus: brand.templatesStatus ?? null,
      logoUrl: brand.logoUrl ?? null,
    })),
  };
}

function creditUsageSummary(ledger: any[]) {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const charges = ledger.filter((row: any) => row.type === "charge");
  const chargeAmount = (rows: any[]) => rows.reduce((sum: number, row: any) => sum + Math.abs(row.amount ?? 0), 0);
  const charged7d = chargeAmount(charges.filter((row: any) => row.createdAt >= now - 7 * day));
  const charged30d = chargeAmount(charges.filter((row: any) => row.createdAt >= now - 30 * day));
  const granted30d = chargeAmount(ledger.filter((row: any) => ["grant", "purchase", "admin_grant"].includes(row.type) && row.createdAt >= now - 30 * day));
  const lastCharge = charges.sort((a: any, b: any) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0] ?? null;
  const bySku: Record<string, number> = {};
  for (const row of charges) {
    const key = row.skuKey ?? row.reason ?? "unknown";
    bySku[key] = (bySku[key] ?? 0) + Math.abs(row.amount ?? 0);
  }
  const topSkus = Object.entries(bySku)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([skuKey, credits]) => ({ skuKey, credits }));
  return {
    charged7d,
    charged30d,
    avgDailyBurn7d: Math.round((charged7d / 7) * 10) / 10,
    avgDailyBurn30d: Math.round((charged30d / 30) * 10) / 10,
    granted30d,
    lastChargeAt: lastCharge?.createdAt ?? null,
    topSkus,
  };
}

function userRiskSummary({ subscription, account, usage, transactions }: { subscription: any; account: any; usage: any; transactions: any[] }) {
  const available = account?.availableCredits ?? 0;
  const reserved = account?.reservedCredits ?? 0;
  const failedPayment = transactions.some((row: any) => row.status === "failed");
  if (!subscription) {
    return {
      level: "warning",
      label: "No plan",
      reason: "No subscription record found.",
    };
  }
  if (["past_due", "unpaid"].includes(subscription.status) || failedPayment) {
    return {
      level: "danger",
      label: "Payment issue",
      reason: "Payment or subscription needs attention.",
    };
  }
  if (available <= 0) {
    return {
      level: "warning",
      label: "No credits",
      reason: "User has no spendable credits.",
    };
  }
  if (available <= 25) {
    return {
      level: "warning",
      label: "Low credits",
      reason: `${available} credits remain.`,
    };
  }
  if (usage.avgDailyBurn7d > 0 && available / usage.avgDailyBurn7d <= 3) {
    return {
      level: "warning",
      label: "Burn risk",
      reason: "At the current 7-day burn rate, credits may run out soon.",
    };
  }
  if (reserved > 0) {
    return {
      level: "neutral",
      label: "Credits reserved",
      reason: `${reserved} credits are reserved for generation work.`,
    };
  }
  return {
    level: "success",
    label: "Healthy",
    reason: "No immediate billing or credit issue detected.",
  };
}

async function taskSummary(ctx: any, task: any) {
  const [brand, campaign, user, account] = await Promise.all([
    ctx.db.get(task.brandId),
    task.campaignId ? ctx.db.get(task.campaignId) : null,
    ctx.db.get(task.userId),
    creditAccount(ctx, String(task.userId)),
  ]);
  const source = taskSource(task);
  return {
    _id: task._id,
    agentType: task.agentType,
    label: task.label,
    status: task.status,
    errorKind: task.errorKind ?? null,
    error: task.error ?? null,
    initiatedFrom: task.initiatedFrom,
    sourceKey: source.key,
    sourceLabel: source.label,
    skuKey: task.skuKey ?? null,
    creditsPriced: task.creditsPriced ?? 0,
    creditsChargedToCustomer: task.creditsChargedToCustomer ?? 0,
    falRequestId: task.falRequestId ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    user: user ? { _id: user._id, name: user.name ?? null, email: user.email ?? null, availableCredits: account?.availableCredits ?? 0, reservedCredits: account?.reservedCredits ?? 0 } : null,
    brand: brand ? { _id: brand._id, name: brand.name, logoUrl: brand.logoUrl ?? null } : null,
    campaign: campaign ? { _id: campaign._id, name: campaign.name, status: campaign.status } : null,
    previewUrl: extractTaskPreviewUrl(task),
  };
}

function taskSource(task: any) {
  if (task.campaignId) return { key: "campaign", label: "Campaign" };
  const sources: Record<string, string> = {
    creative_studio: "Creative Studio",
    content_planner: "Content Planner",
    brand_agent: "Brand assistant",
    onboarding: "Onboarding",
    settings: "Settings",
    ambassador_modal: "Ambassador creator",
    campaigns: "Campaign",
    campaign_wizard_attached: "Campaign attachment",
  };
  const key = String(task.initiatedFrom ?? "").trim();
  if (key && sources[key]) return { key, label: sources[key] };
  return { key: key || "system", label: key ? humanizeKey(key) : "System workflow" };
}

function humanizeKey(value: string) {
  const words = value.replace(/[._-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "System workflow";
}

function extractTaskPreviewUrl(task: any) {
  const output = task.output;
  if (!output) return null;
  return output.videoUrl
    ?? output.imageUrl
    ?? output.url
    ?? output.assetUrl
    ?? output.r2Url
    ?? output.publicUrl
    ?? output.mediaUrl
    ?? null;
}

export const adminOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const [users, tasks, transactions, webhookEvents] = await Promise.all([
      ctx.db.query("users").order("desc").take(200),
      ctx.db.query("agentTasks").order("desc").take(200),
      ctx.db.query("billingTransactions").order("desc").take(50),
      ctx.db.query("billingWebhookEvents").order("desc").take(50),
    ]);

    const activeSubscriptions = await ctx.db.query("subscriptions").collect();
    const creditAccounts = await ctx.db.query("creditAccounts").collect();
    const failedTasks = tasks.filter((task: any) => task.status === "failed");
    const runningTasks = tasks.filter((task: any) => task.status === "running" || task.status === "pending");
    const userSummaries = await Promise.all(users.slice(0, 50).map((user: any) => userSummary(ctx, user)));
    const atRiskUsers = userSummaries
      .filter((user: any) => user.risk.level === "danger" || user.risk.level === "warning")
      .sort((a: any, b: any) => {
        const rank: Record<string, number> = { danger: 0, warning: 1, neutral: 2, success: 3 };
        return (rank[a.risk.level] ?? 9) - (rank[b.risk.level] ?? 9) || (b.usage.charged7d ?? 0) - (a.usage.charged7d ?? 0);
      })
      .slice(0, 8);
    const totalBurn7d = userSummaries.reduce((sum: number, user: any) => sum + (user.usage.charged7d ?? 0), 0);
    const totalBurn30d = userSummaries.reduce((sum: number, user: any) => sum + (user.usage.charged30d ?? 0), 0);

    return {
      counts: {
        sampledUsers: users.length,
        subscriptions: activeSubscriptions.length,
        creditAccounts: creditAccounts.length,
        recentTasks: tasks.length,
        recentFailedTasks: failedTasks.length,
        recentRunningTasks: runningTasks.length,
        recentTransactions: transactions.length,
        recentWebhookErrors: webhookEvents.filter((event: any) => event.status === "failed").length,
        atRiskUsers: atRiskUsers.length,
      },
      usage: {
        sampledBurn7d: totalBurn7d,
        sampledBurn30d: totalBurn30d,
        sampledAvgDailyBurn7d: Math.round((totalBurn7d / 7) * 10) / 10,
      },
      atRiskUsers,
      recentFailures: await Promise.all(failedTasks.slice(0, 8).map((task: any) => taskSummary(ctx, task))),
      recentTransactions: transactions.slice(0, 8),
      recentWebhookEvents: webhookEvents.slice(0, 8),
    };
  },
});

export const adminActivityFeed = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = clampLimit(args.limit);
    const [tasks, campaigns, ledger, transactions, emails] = await Promise.all([
      ctx.db.query("agentTasks").order("desc").take(120),
      ctx.db.query("campaigns").order("desc").take(80),
      ctx.db.query("creditLedger").order("desc").take(180),
      ctx.db.query("billingTransactions").order("desc").take(80),
      ctx.db.query("emailDeliveries").order("desc").take(80),
    ]);

    const taskById = new Map(tasks.map((task: any) => [String(task._id), task]));
    const campaignById = new Map(campaigns.map((campaign: any) => [String(campaign._id), campaign]));
    const userIds = new Set<string>();
    for (const row of [...tasks, ...ledger, ...transactions, ...emails] as any[]) if (row.userId) userIds.add(String(row.userId));
    const brandIds = [...new Set(campaigns.map((campaign: any) => String(campaign.brandId)))];
    const brands = await Promise.all(brandIds.map(async (brandId) => [brandId, await ctx.db.get(brandId as any)] as const));
    const brandById = new Map(brands);
    for (const [, brand] of brands) if ((brand as any)?.userId) userIds.add(String((brand as any).userId));
    const users = await Promise.all([...userIds].map(async (userId) => [userId, await ctx.db.get(userId as any)] as const));
    const userById = new Map(users);
    const actor = (userId?: string) => {
      const user: any = userId ? userById.get(String(userId)) : null;
      return user?.name ?? user?.email ?? "A customer";
    };

    const events: any[] = [];
    for (const task of tasks) {
      const campaign: any = task.campaignId ? campaignById.get(String(task.campaignId)) : null;
      const source = taskSource(task);
      events.push({
        key: `task:${task._id}:${task.updatedAt}`,
        type: "ai_task",
        tone: task.status === "failed" ? "danger" : task.status === "completed" ? "success" : "warning",
        title: task.status === "failed" ? `${actor(task.userId)} had an AI task fail` : task.status === "completed" ? `${actor(task.userId)} completed an AI task` : `${actor(task.userId)} started an AI task`,
        detail: `${task.label ?? humanizeKey(task.agentType)}${campaign ? ` in ${campaign.name}` : ""} · ${source.label}`,
        status: task.errorKind ?? task.status,
        occurredAt: task.updatedAt ?? task.createdAt,
        userId: String(task.userId),
        taskId: String(task._id),
        campaignId: task.campaignId ? String(task.campaignId) : null,
      });
    }

    const releaseGroups = new Map<string, any>();
    for (const row of ledger) {
      if (row.type === "release") {
        const groupKey = String(row.taskId ?? row.reservationId ?? row._id);
        const current = releaseGroups.get(groupKey) ?? { rows: [], latest: row };
        current.rows.push(row);
        if ((row.createdAt ?? 0) > (current.latest.createdAt ?? 0)) current.latest = row;
        releaseGroups.set(groupKey, current);
        continue;
      }
      if (!["charge", "grant", "purchase", "admin_grant", "expire"].includes(row.type)) continue;
      const task: any = row.taskId ? taskById.get(String(row.taskId)) : null;
      const campaign: any = row.campaignId ? campaignById.get(String(row.campaignId)) : null;
      events.push({
        key: `credit:${row._id}`,
        type: "credit",
        tone: row.type === "charge" || row.type === "expire" ? "neutral" : "success",
        title: `${actor(row.userId)} ${creditActivityVerb(row.type)}`,
        detail: `${Math.abs(row.amount ?? 0)} credits${task ? ` for ${task.label ?? humanizeKey(task.agentType)}` : campaign ? ` for ${campaign.name}` : ""}${row.balanceAfter !== undefined ? ` · Balance ${row.balanceAfter}` : ""}`,
        status: row.type,
        occurredAt: row.createdAt,
        userId: String(row.userId),
        taskId: row.taskId ? String(row.taskId) : null,
        campaignId: row.campaignId ? String(row.campaignId) : null,
      });
    }

    for (const group of releaseGroups.values()) {
      const latest = group.latest;
      const task: any = latest.taskId ? taskById.get(String(latest.taskId)) : null;
      const campaign: any = latest.campaignId ? campaignById.get(String(latest.campaignId)) : null;
      const amounts = [...new Set(group.rows.map((row: any) => Math.abs(row.amount ?? 0)))];
      const amountSummary = amounts.length === 1
        ? `${amounts[0]} credits each`
        : `${group.rows.reduce((sum: number, row: any) => sum + Math.abs(row.amount ?? 0), 0)} credits across all holds`;
      events.push({
        key: `release:${latest.taskId ?? latest.reservationId ?? latest._id}`,
        type: "credit_return",
        tone: "warning",
        title: `${actor(latest.userId)} had ${group.rows.length} temporary hold${group.rows.length === 1 ? "" : "s"} returned`,
        detail: `${amountSummary} after failed or cancelled attempts${task ? ` for ${task.label ?? humanizeKey(task.agentType)}` : campaign ? ` in ${campaign.name}` : ""} · No net customer charge${latest.balanceAfter !== undefined ? ` · Balance ${latest.balanceAfter}` : ""}`,
        status: "returned",
        occurredAt: latest.createdAt,
        userId: String(latest.userId),
        taskId: latest.taskId ? String(latest.taskId) : null,
        campaignId: latest.campaignId ? String(latest.campaignId) : null,
      });
    }

    for (const campaign of campaigns) {
      const brand: any = brandById.get(String(campaign.brandId));
      events.push({
        key: `campaign:${campaign._id}:${campaign.updatedAt}`,
        type: "campaign",
        tone: campaign.status === "failed" ? "danger" : campaign.status === "completed" ? "success" : "neutral",
        title: `${actor(brand?.userId)} · ${campaign.name}`,
        detail: campaign.description || humanizeKey(campaign.campaignType ?? "Campaign workflow"),
        status: campaign.status,
        occurredAt: campaign.updatedAt ?? campaign.createdAt,
        campaignId: String(campaign._id),
      });
    }

    for (const row of transactions) events.push({
      key: `transaction:${row._id}`,
      type: "payment",
      tone: row.status === "failed" ? "danger" : "success",
      title: `${actor(row.userId)} · ${row.title}`,
      detail: `${row.amountCents == null ? "No amount" : `${(row.amountCents / 100).toFixed(2)} ${String(row.currency ?? "USD").toUpperCase()}`}${row.credits ? ` · ${row.credits} credits` : ""}`,
      status: row.status,
      occurredAt: row.occurredAt,
      userId: String(row.userId),
    });

    for (const row of emails) events.push({
      key: `email:${row._id}`,
      type: "email",
      tone: row.status === "failed" ? "danger" : "neutral",
      title: `${humanizeKey(row.type)} email ${row.status === "sent" ? "sent" : humanizeKey(row.status).toLowerCase()}`,
      detail: row.recipient,
      status: row.status,
      occurredAt: row.sentAt ?? row.updatedAt ?? row.createdAt,
      userId: row.userId ? String(row.userId) : null,
    });

    return events.sort((a, b) => (b.occurredAt ?? 0) - (a.occurredAt ?? 0)).slice(0, limit);
  },
});

function creditActivityVerb(type: string) {
  if (type === "charge") return "spent credits";
  if (type === "grant") return "received plan or trial credits";
  if (type === "purchase") return "purchased credits";
  if (type === "admin_grant") return "received an admin credit adjustment";
  if (type === "expire") return "had credits expire";
  return "had credit activity";
}

export const adminListBillingUsers = query({
  args: {
    search: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = clampLimit(args.limit);
    const search = (args.search ?? "").trim().toLowerCase();
    const users = await ctx.db.query("users").order("desc").take(300);
    const filtered = search
      ? users.filter((user: any) => includesSearch(user.email, search) || includesSearch(user.name, search) || includesSearch(user._id, search))
      : users;
    return await Promise.all(filtered.slice(0, limit).map((user: any) => userSummary(ctx, user)));
  },
});

export const adminGetUserBillingDetail = query({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const user = await ctx.db.get(args.userId as any);
    if (!user) return null;
    const [summary, subscriptions, ledger, reservations, transactions, sessions, emails] = await Promise.all([
      userSummary(ctx, user),
      ctx.db.query("subscriptions").withIndex("by_userId", (q: any) => q.eq("userId", args.userId)).collect(),
      ctx.db.query("creditLedger").withIndex("by_userId", (q: any) => q.eq("userId", args.userId)).order("desc").take(50),
      ctx.db.query("creditReservations").withIndex("by_userId_status", (q: any) => q.eq("userId", args.userId)).order("desc").take(50),
      ctx.db.query("billingTransactions").withIndex("by_userId_occurredAt", (q: any) => q.eq("userId", args.userId)).order("desc").take(50),
      ctx.db.query("stripeCheckoutSessions").withIndex("by_userId", (q: any) => q.eq("userId", args.userId)).order("desc").take(25),
      ctx.db.query("emailDeliveries").withIndex("by_userId", (q: any) => q.eq("userId", args.userId)).order("desc").take(25),
    ]);
    return { summary, subscriptions, ledger, reservations, transactions, sessions, emails };
  },
});

export const adminListAiTasks = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    initiatedFrom: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = clampLimit(args.limit);
    const search = (args.search ?? "").trim().toLowerCase();
    const tasks = await ctx.db.query("agentTasks").order("desc").take(300);
    const filtered = tasks.filter((task: any) => {
      if (args.status && task.status !== args.status) return false;
      if (args.initiatedFrom && task.initiatedFrom !== args.initiatedFrom) return false;
      if (!search) return true;
      return includesSearch(task.label, search)
        || includesSearch(task.agentType, search)
        || includesSearch(task.error, search)
        || includesSearch(task.falRequestId, search)
        || includesSearch(task._id, search);
    });
    return await Promise.all(filtered
      .sort((a: any, b: any) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
      .slice(0, limit)
      .map((task: any) => taskSummary(ctx, task)));
  },
});

export const adminGetAiTaskDetail = query({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const [summary, reservation, ledger, usageEvents] = await Promise.all([
      taskSummary(ctx, task),
      task.reservationId ? ctx.db.get(task.reservationId) : null,
      ctx.db.query("creditLedger").withIndex("by_taskId", (q: any) => q.eq("taskId", args.taskId)).order("desc").take(25),
      ctx.db.query("aiUsageEvents").withIndex("by_taskId", (q: any) => q.eq("taskId", args.taskId)).order("desc").take(25),
    ]);
    return { summary, task, reservation, ledger, usageEvents };
  },
});

export const adminListCampaigns = query({
  args: {
    search: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const limit = clampLimit(args.limit);
    const search = (args.search ?? "").trim().toLowerCase();
    const campaigns = await ctx.db.query("campaigns").order("desc").take(250);
    const filtered = campaigns.filter((campaign: any) => {
      if (args.status && campaign.status !== args.status) return false;
      if (!search) return true;
      return includesSearch(campaign.name, search) || includesSearch(campaign.description, search) || includesSearch(campaign._id, search);
    });
    return await Promise.all(filtered
      .sort((a: any, b: any) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))
      .slice(0, limit)
      .map(async (campaign: any) => {
      const [brand, tasks, posts] = await Promise.all([
        ctx.db.get(campaign.brandId),
        ctx.db.query("agentTasks").withIndex("by_campaignId", (q: any) => q.eq("campaignId", campaign._id)).collect(),
        ctx.db.query("scheduledPosts").withIndex("by_campaignId", (q: any) => q.eq("campaignId", campaign._id)).collect(),
      ]);
      const user = brand && "userId" in brand ? await ctx.db.get(brand.userId as Id<"users"> ) : null;
      const account = user ? await creditAccount(ctx, String(user._id)) : null;
      return {
        _id: campaign._id,
        name: campaign.name,
        status: campaign.status,
        campaignType: campaign.campaignType,
        selectedTypes: campaign.selectedTypes,
        createdAt: campaign.createdAt,
        updatedAt: campaign.updatedAt,
        brand: brand && "name" in brand ? { _id: brand._id, name: brand.name, logoUrl: "logoUrl" in brand ? brand.logoUrl ?? null : null } : null,
        user: user ? { _id: user._id, name: user.name ?? null, email: user.email ?? null, availableCredits: account?.availableCredits ?? 0, reservedCredits: account?.reservedCredits ?? 0 } : null,
        taskCounts: {
          total: tasks.length,
          completed: tasks.filter((task: any) => task.status === "completed").length,
          failed: tasks.filter((task: any) => task.status === "failed").length,
          running: tasks.filter((task: any) => task.status === "running" || task.status === "pending").length,
        },
        scheduledPostCounts: {
          total: posts.length,
          failed: posts.filter((post: any) => post.status === "failed").length,
          posted: posts.filter((post: any) => post.status === "posted").length,
        },
      };
    }));
  },
});

export const adminGetCampaignAssetView = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    const [brand, tasks, posts] = await Promise.all([
      ctx.db.get(campaign.brandId),
      ctx.db.query("agentTasks").withIndex("by_campaignId", (q: any) => q.eq("campaignId", args.campaignId)).collect(),
      ctx.db.query("scheduledPosts").withIndex("by_campaignId", (q: any) => q.eq("campaignId", args.campaignId)).collect(),
    ]);
    const user = brand ? await ctx.db.get(brand.userId) : null;
    const account = user ? await creditAccount(ctx, String(user._id)) : null;
    return {
      campaign,
      brand,
      user: user ? { _id: user._id, name: user.name ?? null, email: user.email ?? null, image: user.image ?? null, availableCredits: account?.availableCredits ?? 0, reservedCredits: account?.reservedCredits ?? 0 } : null,
      tasks: await Promise.all(tasks.sort((a: any, b: any) => b.createdAt - a.createdAt).map((task: any) => taskSummary(ctx, task))),
      scheduledPosts: posts.sort((a: any, b: any) => b.createdAt - a.createdAt),
    };
  },
});
