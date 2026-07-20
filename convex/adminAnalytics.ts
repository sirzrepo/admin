import { query } from "./_generated/server";
import { getCurrentTeamMember } from "./helpers";

async function requireBillingAdmin(ctx: any) {
  const teamMember = await getCurrentTeamMember(ctx);

  if (!teamMember) {
    throw new Error("Unauthenticated");
  }

  return teamMember;
}



// admin schema
export const getCampaignActivity = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const campaigns = await ctx.db
      .query("campaigns")
      .collect();

    const today = new Date();
    const chart: Record<
      string,
      {
        date: string;
        campaigns: number;
        completions: number;
        failed: number;
      }
    > = {};

    // Initialize the last 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);

      const key = d.toISOString().split("T")[0];

      chart[key] = {
        date: d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }), // e.g. "Jul 21"
        campaigns: 0,
        completions: 0,
        failed: 0,
      };
    }

    // Aggregate campaign data
    for (const campaign of campaigns) {
      const key = new Date(campaign.createdAt)
        .toISOString()
        .split("T")[0];

      const bucket = chart[key];
      if (!bucket) continue;

      bucket.campaigns++;

      switch (campaign.status) {
        case "completed":
          bucket.completions++;
          break;

        case "failed":
          bucket.failed++;
          break;
      }
    }

    return {
      chart: Object.values(chart),
    };
  },
});


export const getTotalCampaignCount = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    return (await ctx.db.query("campaigns").collect()).length;
  },
});


export const getActiveAmbassadorCount = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
        if (!teamMember) {
        throw new Error("unauthenticated");
        }

    const ambassadors = await ctx.db
      .query("ambassadors")
      .collect();

    const activeCount = ambassadors.filter(
      (ambassador) => ambassador.isActive == true
    ).length;

    return {
      total: activeCount,
    };
  },
});


// admin schema
export const getTotalPlatformConnectionCount = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const platformConnections = await ctx.db
      .query("platformConnections")
      .collect();

    return {
      total: platformConnections.length,
    };
  },
});

// admin schema
export const getPlatformConnectionStats = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const connections = await ctx.db
      .query("platformConnections")
      .collect();

    const counts = new Map<string, number>();

    for (const connection of connections) {
      if (!connection.isActive) continue;

      counts.set(
        connection.platform,
        (counts.get(connection.platform) ?? 0) + 1
      );
    }

    const chart = [...counts.entries()]
      .map(([name, value]) => ({
        name,
        value,
      }))
      .sort((a, b) => b.value - a.value);

    return {
      total: connections.filter((c) => c.isActive).length,
      chart,
      mostUsed: chart[0] ?? null,
      leastUsed: chart[chart.length - 1] ?? null,
    };
  },
});

// admin schema
export const getTotalUserCount = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const users = await ctx.db
      .query("users")
      .collect();

    return {
      total: users.length,
    };
  },
});

// admin schema
export const getTotalTaskCount = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const tasks = await ctx.db
      .query("agentTasks")
      .collect();

    return {
      total: tasks.length,
    };
  },
});


// admin brand schema
export const getTotalBrandCount = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const brands = await ctx.db
      .query("brands")
      .collect();

    return {
      total: brands.length,
    };
  },
});


// admin schema
export const getIntegrationSummary = query({
  args: {},
  handler: async (ctx) => {
    const teamMember = await getCurrentTeamMember(ctx);
    if (!teamMember) {
      throw new Error("unauthenticated");
    }

    const integrations = await ctx.db
      .query("integrations")
      .collect();

    const recentIntegrations = integrations
      .sort((a, b) => b._creationTime - a._creationTime)
      .slice(0, 10); // Adjust this number as needed

    return {
      total: integrations.length,
      recent: recentIntegrations,
    };
  },
});



export const getAiGenerationVolume = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const events = await ctx.db
      .query("aiUsageEvents")
      .collect();

    const counts = new Map<string, number>();

    for (const event of events) {
      const type = event.featureKey;

      counts.set(type, (counts.get(type) ?? 0) + 1);
    }

    const chart = [...counts.entries()]
      .map(([type, count]) => ({
        type,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      total: events.length,
      chart,
      mostUsed: chart[0] ?? null,
      leastUsed: chart[chart.length - 1] ?? null,
    };
  },
});