/**
 * Analytics aggregation queries.
 *
 * Source of truth: scheduledPosts.analytics, populated by syncCampaignAnalytics
 * (manual) and syncPostAnalytics (cron) in scheduledPosts.ts. We only return
 * what TikTok actually exposes for organic posts: views, likes, comments,
 * shares. Clicks/conversions/revenue are not in scope until Shopify
 * attribution (Phase 2) lands.
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

type RawPost = {
  _id: any;
  taskId?: any;
  angleId?: string;
  platform: string;
  scheduledAt: number;
  postedAt?: number;
  status: string;
  analytics?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    lastSyncedAt: number;
  };
};

type Aggregate = {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  engagementRate: number; // (likes + comments + shares) / views, 0-1
  lastSyncedAt: number | null;
  postedCount: number;
  totalCount: number;
  hasAnalytics: boolean; // true if at least one posted post has analytics
};

function aggregate(posts: RawPost[]): Aggregate {
  let views = 0, likes = 0, comments = 0, shares = 0;
  let lastSyncedAt: number | null = null;
  let postedCount = 0;
  let hasAnalytics = false;
  for (const p of posts) {
    if (p.status === "posted") postedCount++;
    if (!p.analytics) continue;
    hasAnalytics = true;
    views += p.analytics.views;
    likes += p.analytics.likes;
    comments += p.analytics.comments;
    shares += p.analytics.shares;
    if (!lastSyncedAt || p.analytics.lastSyncedAt > lastSyncedAt) {
      lastSyncedAt = p.analytics.lastSyncedAt;
    }
  }
  const engagementRate = views > 0 ? (likes + comments + shares) / views : 0;
  return {
    views, likes, comments, shares,
    engagementRate,
    lastSyncedAt,
    postedCount,
    totalCount: posts.length,
    hasAnalytics,
  };
}

// Per-campaign aggregate + per-post breakdown. Powers Campaign Detail's
// Overview cards and Analytics tab.
export const getCampaignAnalytics = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return null;
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) return null;

    const posts = (await ctx.db
      .query("scheduledPosts")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect()) as RawPost[];

    return {
      aggregate: aggregate(posts),
      posts: posts.map((p) => ({
        _id: p._id,
        taskId: p.taskId,
        angleId: p.angleId,
        platform: p.platform,
        scheduledAt: p.scheduledAt,
        postedAt: p.postedAt,
        status: p.status,
        analytics: p.analytics,
      })),
    };
  },
});

// Portfolio-level counts for the dashboard top cards. Gives a "how
// much have you built / how much is shipping / how is it performing"
// snapshot rather than duplicating per-campaign engagement metrics.
export const getBrandPortfolioStats = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return null;

    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    const posts = await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();

    const campaignStatusCount = (s: string) => campaigns.filter((c) => c.status === s).length;
    const activeCount = campaignStatusCount("active") + campaignStatusCount("scheduled") + campaignStatusCount("paused");
    const completedCount = campaignStatusCount("completed");
    const draftCount = campaignStatusCount("draft") + campaignStatusCount("ready") + campaignStatusCount("failed") + campaignStatusCount("generating");

    const completedAssets = tasks.filter(
      (t) =>
        (t.agentType === "video_generator" ||
          t.agentType === "image_generator" ||
          t.agentType === "attached_video") &&
        t.status === "completed" &&
        (t.output?.videoUrl || t.output?.imageUrl),
    );
    const videoCount = completedAssets.filter((t) => t.output?.videoUrl).length;
    const imageCount = completedAssets.filter((t) => !t.output?.videoUrl && t.output?.imageUrl).length;

    const postsPublished = posts.filter((p) => p.status === "posted").length;
    const postsScheduled = posts.filter((p) => p.status === "scheduled" || p.status === "publishing").length;
    const postsFailed = posts.filter((p) => p.status === "failed").length;

    let totalViews = 0;
    for (const p of posts) if (p.analytics) totalViews += p.analytics.views;

    return {
      campaigns: {
        total: campaigns.length,
        active: activeCount,
        completed: completedCount,
        draft: draftCount,
      },
      assets: {
        total: completedAssets.length,
        videos: videoCount,
        images: imageCount,
      },
      posts: {
        published: postsPublished,
        scheduled: postsScheduled,
        failed: postsFailed,
      },
      totalViews,
    };
  },
});

// Brand-wide aggregate across all campaigns + a daily views time-series
// over the last 30 days. Powers the Dashboard's metrics row and chart.
export const getBrandAnalytics = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return null;

    const posts = (await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect()) as RawPost[];

    // Daily views over the last 30 days (UTC), zero-filled so the chart
    // renders a continuous line even when some days have no posts.
    const DAYS = 30;
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const startMs = now - (DAYS - 1) * dayMs;

    const dayKey = (ts: number) => {
      const d = new Date(ts);
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    };

    const dailyMap = new Map<string, { views: number; likes: number; posts: number }>();
    for (let i = 0; i < DAYS; i++) {
      dailyMap.set(dayKey(startMs + i * dayMs), { views: 0, likes: 0, posts: 0 });
    }
    for (const p of posts) {
      if (!p.postedAt) continue;
      if (p.postedAt < startMs) continue;
      const key = dayKey(p.postedAt);
      const cell = dailyMap.get(key);
      if (!cell) continue;
      cell.posts += 1;
      if (p.analytics) {
        cell.views += p.analytics.views;
        cell.likes += p.analytics.likes;
      }
    }
    const dailyViews = Array.from(dailyMap.entries()).map(([date, v]) => ({
      date,
      views: v.views,
      likes: v.likes,
      posts: v.posts,
    }));

    return {
      aggregate: aggregate(posts),
      dailyViews,
    };
  },
});
