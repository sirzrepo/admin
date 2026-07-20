/**
 * Rules-based AI Insights.
 *
 * Computes 6 deterministic insights from real TikTok analytics. No LLM,
 * no tokens. Each rule:
 *   - declares a minimum data threshold (skips if not met)
 *   - returns null when there's nothing meaningful to say
 *   - includes the numerical basis in the body so the user can verify
 *
 * Insights are computed per-query, not cached - cheap enough at our
 * data sizes (a brand has tens to low-hundreds of posts).
 */

import { query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export type InsightSeverity = "positive" | "info" | "warning";

export type Insight = {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  cta?: { label: string; href?: string };
};

type Post = {
  _id: any;
  campaignId: any;
  angleId?: string;
  scheduledAt: number;
  postedAt?: number;
  status: string;
  tiktokSettings?: { privacyLevel?: string };
  analytics?: {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    lastSyncedAt: number;
  };
};

// Helpers --------------------------------------------------------------

const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M`
  : n >= 1_000  ? `${(n / 1_000).toFixed(1)}K`
  : String(Math.round(n));

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const avgViews = (posts: Post[]) => {
  const withAnalytics = posts.filter((p) => p.analytics);
  if (withAnalytics.length === 0) return 0;
  return withAnalytics.reduce((s, p) => s + (p.analytics!.views), 0) / withAnalytics.length;
};

const engagement = (p: Post) =>
  p.analytics ? (p.analytics.likes + p.analytics.comments + p.analytics.shares) / Math.max(1, p.analytics.views) : 0;

// Rule 1: Best time slot --------------------------------------------------
// Cluster posted posts into day-of-week + 3-hour buckets, find the slot
// whose average views are at least 1.5x the overall average. Needs 4+
// posted posts with analytics so single outliers don't dominate.

function ruleBestTimeSlot(posts: Post[]): Insight | null {
  const withData = posts.filter((p) => p.postedAt && p.analytics && p.analytics.views > 0);
  if (withData.length < 4) return null;

  const slots = new Map<string, { day: string; hour: number; views: number[] }>();
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  for (const p of withData) {
    const d = new Date(p.postedAt!);
    const day = d.getUTCDay();
    const hourBucket = Math.floor(d.getUTCHours() / 3) * 3;
    const key = `${day}-${hourBucket}`;
    const slot = slots.get(key) ?? { day: DAY_NAMES[day], hour: hourBucket, views: [] };
    slot.views.push(p.analytics!.views);
    slots.set(key, slot);
  }

  // Need at least 2 posts in the winning slot to be meaningful.
  const overallAvg = avgViews(withData);
  let best: { day: string; hour: number; avg: number; count: number } | null = null;
  for (const slot of slots.values()) {
    if (slot.views.length < 2) continue;
    const avg = slot.views.reduce((s, v) => s + v, 0) / slot.views.length;
    if (!best || avg > best.avg) best = { day: slot.day, hour: slot.hour, avg, count: slot.views.length };
  }
  if (!best || best.avg < overallAvg * 1.5) return null;

  const endHour = best.hour + 3;
  const ratio = (best.avg / overallAvg).toFixed(1);
  const hourLabel = (h: number) => h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
  return {
    id: "best-time-slot",
    severity: "positive",
    title: "Your peak posting window",
    body: `${best.day} ${hourLabel(best.hour)} to ${hourLabel(endHour)} UTC averaged ${fmt(best.avg)} views across ${best.count} posts, ${ratio}x your overall average. Schedule there.`,
  };
}

// Rule 2: Top angle/format ----------------------------------------------
// Compare average views for UGC vs Product Ad posts within the same
// brand. Needs at least 3 of each so we're not extrapolating from noise.

function ruleTopFormat(posts: Post[], formatByAngleId: Map<string, string>): Insight | null {
  const ugc: Post[] = [];
  const ad: Post[] = [];
  for (const p of posts) {
    if (!p.analytics || !p.angleId) continue;
    const fmt = formatByAngleId.get(p.angleId);
    if (fmt === "AI UGC Ads") ugc.push(p);
    else if (fmt === "Product Ads") ad.push(p);
  }
  if (ugc.length < 3 || ad.length < 3) return null;

  const ugcAvg = avgViews(ugc);
  const adAvg = avgViews(ad);
  if (Math.abs(ugcAvg - adAvg) < Math.max(ugcAvg, adAvg) * 0.2) return null; // < 20% difference, not worth surfacing

  const winner = ugcAvg > adAvg ? "UGC Videos" : "Product Ads";
  const loser = ugcAvg > adAvg ? "Product Ads" : "UGC Videos";
  const winAvg = Math.max(ugcAvg, adAvg);
  const loseAvg = Math.min(ugcAvg, adAvg);
  const ratio = (winAvg / Math.max(1, loseAvg)).toFixed(1);

  return {
    id: "top-format",
    severity: "info",
    title: `${winner} are outperforming ${loser}`,
    body: `${winner} averaged ${fmt(winAvg)} views vs ${fmt(loseAvg)} for ${loser} (${ratio}x). Lean into ${winner.toLowerCase()} for your next campaign.`,
  };
}

// Rule 3: Engagement trend ----------------------------------------------
// Compare engagement rate of last 5 posts vs prior 5. Needs 6+ posted
// posts with analytics. Trend must be ≥20% in either direction to surface.

function ruleEngagementTrend(posts: Post[]): Insight | null {
  const withData = posts
    .filter((p) => p.postedAt && p.analytics && p.analytics.views > 0)
    .sort((a, b) => b.postedAt! - a.postedAt!);
  if (withData.length < 6) return null;

  const recent = withData.slice(0, 5);
  const prior = withData.slice(5, 10);
  if (prior.length < 1) return null;

  const recentEng = recent.reduce((s, p) => s + engagement(p), 0) / recent.length;
  const priorEng = prior.reduce((s, p) => s + engagement(p), 0) / prior.length;
  if (priorEng === 0) return null;

  const change = (recentEng - priorEng) / priorEng;
  if (Math.abs(change) < 0.2) return null;

  const up = change > 0;
  return {
    id: "engagement-trend",
    severity: up ? "positive" : "warning",
    title: up ? "Engagement is climbing" : "Engagement is slipping",
    body: up
      ? `Engagement rate up ${pct(change)} over your last 5 posts vs the prior 5 (${pct(recentEng)} vs ${pct(priorEng)}). Audience is leaning in, keep the cadence going.`
      : `Engagement rate down ${pct(Math.abs(change))} over your last 5 posts vs the prior 5 (${pct(recentEng)} vs ${pct(priorEng)}). Try a fresh hook or format to reset.`,
  };
}

// Rule 4: Posting silence -----------------------------------------------
// If the last post is >7 days old, nudge to schedule. Threshold based on
// the well-known TikTok finding that consistent cadence sustains reach.

function rulePostingSilence(posts: Post[]): Insight | null {
  const posted = posts.filter((p) => p.status === "posted" && p.postedAt);
  if (posted.length === 0) return null;
  const lastPostedAt = Math.max(...posted.map((p) => p.postedAt!));
  const daysSince = Math.floor((Date.now() - lastPostedAt) / (24 * 60 * 60 * 1000));
  if (daysSince < 7) return null;

  return {
    id: "posting-silence",
    severity: "warning",
    title: "You've gone quiet",
    body: `Your last post was ${daysSince} days ago. Consistent posting (3x/week) sustains 2x the reach of irregular cadence. Schedule your next batch.`,
    cta: { label: "Start a campaign", href: "/campaigns/new" },
  };
}

// Rule 5: Hero post -----------------------------------------------------
// Surface the single post performing >3x the brand's average. Useful for
// "do more of this." Needs 3+ posts so the average isn't dominated by
// the hero itself.

function ruleHeroPost(posts: Post[], angleNameByAngleId: Map<string, string>): Insight | null {
  const withData = posts.filter((p) => p.analytics && p.analytics.views > 0);
  if (withData.length < 3) return null;

  const avg = avgViews(withData);
  let hero: Post | null = null;
  for (const p of withData) {
    if (!hero || p.analytics!.views > hero.analytics!.views) hero = p;
  }
  if (!hero || hero.analytics!.views < avg * 3) return null;

  const angleName = hero.angleId ? angleNameByAngleId.get(hero.angleId) : null;
  const ratio = (hero.analytics!.views / avg).toFixed(1);

  return {
    id: "hero-post",
    severity: "positive",
    title: angleName ? `"${angleName}" is your hero hook` : "You have a hero post",
    body: `${angleName ? `Your "${angleName}" post` : "One of your posts"} pulled ${fmt(hero.analytics!.views)} views, ${ratio}x your average. Worth scaling this angle across more campaigns.`,
  };
}

// Rule 6: Privacy-level impact -----------------------------------------
// If the brand has both PUBLIC and follower/private posts (typical for
// unaudited TikTok apps), surface the gap so they know to push for
// PUBLIC once they're audited.

function rulePrivacyImpact(posts: Post[]): Insight | null {
  const withData = posts.filter((p) => p.analytics && p.analytics.views > 0 && p.tiktokSettings?.privacyLevel);
  const pub = withData.filter((p) => p.tiktokSettings!.privacyLevel === "PUBLIC_TO_EVERYONE");
  const priv = withData.filter((p) => p.tiktokSettings!.privacyLevel !== "PUBLIC_TO_EVERYONE");
  if (pub.length < 2 || priv.length < 2) return null;

  const pubAvg = avgViews(pub);
  const privAvg = avgViews(priv);
  if (pubAvg < privAvg * 2) return null;

  const ratio = (pubAvg / Math.max(1, privAvg)).toFixed(1);
  return {
    id: "privacy-impact",
    severity: "info",
    title: "Public posts dramatically outperform private ones",
    body: `Your PUBLIC posts averaged ${fmt(pubAvg)} views vs ${fmt(privAvg)} for follower/private (${ratio}x). If your TikTok app is in sandbox mode, getting audited unlocks PUBLIC and the reach gap closes.`,
  };
}

// Public queries --------------------------------------------------------

// Brand-wide insights. Combines posts across all campaigns so we have
// enough signal to detect patterns.
export const getBrandInsights = query({
  args: { brandId: v.id("brands") },
  handler: async (ctx, args): Promise<Insight[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const brand = await ctx.db.get(args.brandId);
    if (!brand || brand.userId !== userId) return [];

    const posts = (await ctx.db
      .query("scheduledPosts")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect()) as Post[];

    // Build angle lookup tables by reading all campaigns for this brand.
    // Cheap: campaigns table is small per-brand.
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_brandId", (q) => q.eq("brandId", args.brandId))
      .collect();
    const formatByAngleId = new Map<string, string>();
    const angleNameByAngleId = new Map<string, string>();
    for (const c of campaigns) {
      for (const a of (c.selectedAngles ?? [])) {
        if (a.id && a.format) formatByAngleId.set(a.id, a.format);
        if (a.id && a.name) angleNameByAngleId.set(a.id, a.name);
      }
    }

    return [
      ruleBestTimeSlot(posts),
      ruleTopFormat(posts, formatByAngleId),
      ruleEngagementTrend(posts),
      rulePostingSilence(posts),
      ruleHeroPost(posts, angleNameByAngleId),
      rulePrivacyImpact(posts),
    ].filter((x): x is Insight => x !== null);
  },
});

// Per-campaign insights. Smaller signal pool, so we only run a subset
// of rules and require the same per-rule thresholds.
export const getCampaignInsights = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args): Promise<Insight[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const campaign = await ctx.db.get(args.campaignId);
    if (!campaign) return [];
    const brand = await ctx.db.get(campaign.brandId);
    if (!brand || brand.userId !== userId) return [];

    const posts = (await ctx.db
      .query("scheduledPosts")
      .withIndex("by_campaignId", (q) => q.eq("campaignId", args.campaignId))
      .collect()) as Post[];

    const angleNameByAngleId = new Map<string, string>();
    for (const a of (campaign.selectedAngles ?? [])) {
      if (a.id && a.name) angleNameByAngleId.set(a.id, a.name);
    }

    // For per-campaign view we surface the hero post and engagement trend
    // when there's enough data. Best-time/format/privacy comparisons are
    // less meaningful at single-campaign scale.
    return [
      ruleHeroPost(posts, angleNameByAngleId),
      ruleEngagementTrend(posts),
    ].filter((x): x is Insight => x !== null);
  },
});
