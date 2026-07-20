import { query } from "./_generated/server";
import { getCurrentTeamMember } from "./helpers";

async function requireBillingAdmin(ctx: any) {
  const teamMember = await getCurrentTeamMember(ctx);

  if (!teamMember) {
    throw new Error("Unauthenticated");
  }

  return teamMember;
}

const ACTIVE_SUBSCRIPTION_STATUSES = new Set([
  "active",
  "trialing",
  "past_due",
]);

export const getOverviewAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [
      subscriptions,
      billingPlans,
      creditAccounts,
      billingTransactions,
      creditLedger,
      reservations,
      aiSkus,
      creditPackages,
    ] = await Promise.all([
      ctx.db.query("subscriptions").collect(),
      ctx.db.query("billingPlans").collect(),
      ctx.db.query("creditAccounts").collect(),
      ctx.db.query("billingTransactions").collect(),
      ctx.db.query("creditLedger").collect(),
      ctx.db.query("creditReservations").collect(),
      ctx.db.query("aiSkus").collect(),
      ctx.db.query("creditTopUpPackages").collect(),
    ]);

    const activeSubscriptions = subscriptions.filter((s) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
    );

    const completedTransactions = billingTransactions.filter(
      (t) => t.status === "completed",
    );

    const refundedTransactions = billingTransactions.filter(
      (t) => t.status === "refunded",
    );

    const pendingTransactions = billingTransactions.filter(
      (t) => t.status === "pending",
    );

    const failedTransactions = billingTransactions.filter(
      (t) => t.status === "failed",
    );

    const totalRevenueCents = completedTransactions.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const monthlyRecurringRevenue = activeSubscriptions.reduce((sum, sub) => {
      const plan = billingPlans.find((p) => p.key === sub.planKey);
      return sum + (plan?.priceMonthlyCents ?? 0);
    }, 0);

    const annualRecurringRevenue = monthlyRecurringRevenue * 12;

    const totalCreditsAvailable = creditAccounts.reduce(
      (sum, a) => sum + a.availableCredits,
      0,
    );

    const totalCreditsReserved = creditAccounts.reduce(
      (sum, a) => sum + a.reservedCredits,
      0,
    );

    const totalCreditsPurchased = creditAccounts.reduce(
      (sum, a) => sum + a.lifetimePurchasedCredits,
      0,
    );

    const totalCreditsGranted = creditAccounts.reduce(
      (sum, a) => sum + a.lifetimeGrantedCredits,
      0,
    );

    const totalCreditsConsumed = creditAccounts.reduce(
      (sum, a) => sum + a.lifetimeConsumedCredits,
      0,
    );

    const reservationStats = {
      total: reservations.length,
      pending: reservations.filter((r) => r.status === "pending").length,
      reserved: reservations.filter((r) => r.status === "reserved").length,
      charged: reservations.filter((r) => r.status === "charged").length,
      released: reservations.filter((r) => r.status === "released").length,
      expired: reservations.filter((r) => r.expiresAt <= Date.now()).length,
    };

    const ledgerStats = {
      entries: creditLedger.length,
      adminActions: creditLedger.filter((l) =>
        l.type.startsWith("admin"),
      ).length,
      trialGrants: creditLedger.filter(
        (l) => l.type === "trial_credit_grant",
      ).length,
      aiUsage: creditLedger.filter((l) => l.skuKey).length,
    };

    const subscriptionStats = {
      total: subscriptions.length,
      active: activeSubscriptions.length,
      trialing: subscriptions.filter((s) => s.status === "trialing").length,
      pastDue: subscriptions.filter((s) => s.status === "past_due").length,
      cancelled: subscriptions.filter((s) =>
        ["cancelled", "canceled"].includes(s.status),
      ).length,
      scheduledForCancellation: subscriptions.filter(
        (s) => s.cancelAtPeriodEnd,
      ).length,
    };

    const billingPlanStats = {
      total: billingPlans.length,
      active: billingPlans.filter((p) => p.isActive).length,
      inactive: billingPlans.filter((p) => !p.isActive).length,
    };

    const aiStats = {
      totalSkus: aiSkus.length,
      activeSkus: aiSkus.filter((s) => s.isActive).length,
      providers: [...new Set(aiSkus.map((s) => s.provider))].length,
    };

    const packageStats = {
      total: creditPackages.length,
      active: creditPackages.filter((p) => p.isActive).length,
    };

    const averageRevenuePerCustomer =
      activeSubscriptions.length === 0
        ? 0
        : Math.round(monthlyRecurringRevenue / activeSubscriptions.length);

    return {
      generatedAt: Date.now(),

      revenue: {
        totalRevenueCents,
        monthlyRecurringRevenue,
        annualRecurringRevenue,
        averageRevenuePerCustomer,
        completedTransactions: completedTransactions.length,
        pendingTransactions: pendingTransactions.length,
        failedTransactions: failedTransactions.length,
        refundedTransactions: refundedTransactions.length,
      },

      subscriptions: subscriptionStats,

      billingPlans: billingPlanStats,

      credits: {
        available: totalCreditsAvailable,
        reserved: totalCreditsReserved,
        purchased: totalCreditsPurchased,
        granted: totalCreditsGranted,
        consumed: totalCreditsConsumed,
      },

      reservations: reservationStats,

      ledger: ledgerStats,

      ai: aiStats,

      creditPackages: packageStats,

      system: {
        totalCustomers: creditAccounts.length,
        totalTransactions: billingTransactions.length,
        totalLedgerEntries: creditLedger.length,
      },
    };
  },
});

export const getRevenueAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [transactions, subscriptions, plans] = await Promise.all([
      ctx.db.query("billingTransactions").collect(),
      ctx.db.query("subscriptions").collect(),
      ctx.db.query("billingPlans").collect(),
    ]);

    const completed = transactions.filter(
      (t) => t.status === "completed",
    );

    const pending = transactions.filter(
      (t) => t.status === "pending",
    );

    const failed = transactions.filter(
      (t) => t.status === "failed",
    );

    const refunded = transactions.filter(
      (t) => t.status === "refunded",
    );

    const activeSubscriptions = subscriptions.filter((s) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
    );

    // -----------------------------
    // Revenue KPIs
    // -----------------------------

    const totalRevenueCents = completed.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const refundedRevenueCents = refunded.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const pendingRevenueCents = pending.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const failedRevenueCents = failed.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const monthlyRecurringRevenue = activeSubscriptions.reduce(
      (sum, subscription) => {
        const plan = plans.find(
          (p) => p.key === subscription.planKey,
        );

        return sum + (plan?.priceMonthlyCents ?? 0);
      },
      0,
    );

    const annualRecurringRevenue =
      monthlyRecurringRevenue * 12;

    const averageTransactionValue =
      completed.length === 0
        ? 0
        : Math.round(
            totalRevenueCents / completed.length,
          );

    const averageRevenuePerSubscriber =
      activeSubscriptions.length === 0
        ? 0
        : Math.round(
            monthlyRecurringRevenue /
              activeSubscriptions.length,
          );

    // -----------------------------
    // Revenue By Month
    // -----------------------------

    const revenueByMonth = new Map<
      string,
      {
        month: string;
        revenueCents: number;
        transactions: number;
      }
    >();

    for (const transaction of completed) {
      const date = new Date(transaction.occurredAt);

      const month = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}`;

      const existing = revenueByMonth.get(month);

      if (existing) {
        existing.revenueCents +=
          transaction.amountCents ?? 0;

        existing.transactions += 1;
      } else {
        revenueByMonth.set(month, {
          month,
          revenueCents:
            transaction.amountCents ?? 0,
          transactions: 1,
        });
      }
    }

    // -----------------------------
    // Revenue By Day (Last 30 Days)
    // -----------------------------

    const revenueByDay = new Map<
      string,
      {
        day: string;
        revenueCents: number;
        transactions: number;
      }
    >();

    for (const transaction of completed) {
      const date = new Date(transaction.occurredAt);

      const day = date.toISOString().split("T")[0];

      const existing = revenueByDay.get(day);

      if (existing) {
        existing.revenueCents +=
          transaction.amountCents ?? 0;

        existing.transactions++;
      } else {
        revenueByDay.set(day, {
          day,
          revenueCents:
            transaction.amountCents ?? 0,
          transactions: 1,
        });
      }
    }

    // -----------------------------
    // Revenue By Transaction Type
    // -----------------------------

    const revenueByType = new Map<
      string,
      {
        type: string;
        revenueCents: number;
        count: number;
      }
    >();

    for (const transaction of completed) {
      const existing = revenueByType.get(
        transaction.type,
      );

      if (existing) {
        existing.revenueCents +=
          transaction.amountCents ?? 0;

        existing.count++;
      } else {
        revenueByType.set(transaction.type, {
          type: transaction.type,
          revenueCents:
            transaction.amountCents ?? 0,
          count: 1,
        });
      }
    }

    // -----------------------------
    // Revenue By Currency
    // -----------------------------

    const revenueByCurrency = new Map<
      string,
      {
        currency: string;
        revenueCents: number;
        count: number;
      }
    >();

    for (const transaction of completed) {
      const currency =
        transaction.currency ?? "UNKNOWN";

      const existing =
        revenueByCurrency.get(currency);

      if (existing) {
        existing.revenueCents +=
          transaction.amountCents ?? 0;

        existing.count++;
      } else {
        revenueByCurrency.set(currency, {
          currency,
          revenueCents:
            transaction.amountCents ?? 0,
          count: 1,
        });
      }
    }

    // -----------------------------
    // Top Transactions
    // -----------------------------

    const topTransactions = completed
      .sort(
        (a, b) =>
          (b.amountCents ?? 0) -
          (a.amountCents ?? 0),
      )
      .slice(0, 20);

    return {
      generatedAt: Date.now(),

      summary: {
        totalRevenueCents,
        monthlyRecurringRevenue,
        annualRecurringRevenue,
        averageTransactionValue,
        averageRevenuePerSubscriber,

        completedTransactions:
          completed.length,

        pendingTransactions:
          pending.length,

        failedTransactions:
          failed.length,

        refundedTransactions:
          refunded.length,

        pendingRevenueCents,
        refundedRevenueCents,
        failedRevenueCents,
      },

      charts: {
        revenueByMonth: Array.from(
          revenueByMonth.values(),
        ).sort((a, b) =>
          a.month.localeCompare(b.month),
        ),

        revenueByDay: Array.from(
          revenueByDay.values(),
        ).sort((a, b) =>
          a.day.localeCompare(b.day),
        ),

        revenueByType: Array.from(
          revenueByType.values(),
        ).sort(
          (a, b) =>
            b.revenueCents -
            a.revenueCents,
        ),

        revenueByCurrency: Array.from(
          revenueByCurrency.values(),
        ).sort(
          (a, b) =>
            b.revenueCents -
            a.revenueCents,
        ),
      },

      topTransactions,
    };
  },
});


export const getSubscriptionAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [subscriptions, billingPlans] = await Promise.all([
      ctx.db.query("subscriptions").collect(),
      ctx.db.query("billingPlans").collect(),
    ]);

    const planMap = new Map(
      billingPlans.map((plan) => [plan.key, plan]),
    );

    const activeSubscriptions = subscriptions.filter((s) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
    );

    const trialingSubscriptions = subscriptions.filter(
      (s) => s.status === "trialing",
    );

    const cancelledSubscriptions = subscriptions.filter((s) =>
      ["cancelled", "canceled"].includes(s.status),
    );

    const pastDueSubscriptions = subscriptions.filter(
      (s) => s.status === "past_due",
    );

    const scheduledForCancellation = subscriptions.filter(
      (s) => s.cancelAtPeriodEnd,
    );

    // --------------------------------------------------
    // KPI
    // --------------------------------------------------

    const trialConversionRate =
      trialingSubscriptions.length === 0
        ? 0
        : (
            ((activeSubscriptions.length -
              trialingSubscriptions.length) /
              trialingSubscriptions.length) *
            100
          );

    const cancellationRate =
      subscriptions.length === 0
        ? 0
        : (cancelledSubscriptions.length / subscriptions.length) * 100;

    // --------------------------------------------------
    // Plans
    // --------------------------------------------------

    const planAnalytics = new Map<
      string,
      {
        planKey: string;
        planName: string;
        subscribers: number;
        activeSubscribers: number;
        trialing: number;
        cancelled: number;
        pastDue: number;
        scheduledCancellation: number;
        monthlyRevenueCents: number;
      }
    >();

    for (const plan of billingPlans) {
      planAnalytics.set(plan.key, {
        planKey: plan.key,
        planName: plan.name,
        subscribers: 0,
        activeSubscribers: 0,
        trialing: 0,
        cancelled: 0,
        pastDue: 0,
        scheduledCancellation: 0,
        monthlyRevenueCents: 0,
      });
    }

    for (const subscription of subscriptions) {
      const row = planAnalytics.get(subscription.planKey);

      if (!row) continue;

      row.subscribers++;

      if (ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status)) {
        row.activeSubscribers++;
        row.monthlyRevenueCents +=
          planMap.get(subscription.planKey)?.priceMonthlyCents ?? 0;
      }

      if (subscription.status === "trialing") row.trialing++;

      if (subscription.status === "past_due") row.pastDue++;

      if (
        ["cancelled", "canceled"].includes(subscription.status)
      ) {
        row.cancelled++;
      }

      if (subscription.cancelAtPeriodEnd) {
        row.scheduledCancellation++;
      }
    }

    // --------------------------------------------------
    // Status Distribution
    // --------------------------------------------------

    const statusDistribution = [
      {
        status: "Active",
        count: activeSubscriptions.length,
      },
      {
        status: "Trialing",
        count: trialingSubscriptions.length,
      },
      {
        status: "Past Due",
        count: pastDueSubscriptions.length,
      },
      {
        status: "Cancelled",
        count: cancelledSubscriptions.length,
      },
      {
        status: "Scheduled Cancellation",
        count: scheduledForCancellation.length,
      },
    ];

    // --------------------------------------------------
    // Subscription Growth
    // --------------------------------------------------

    const growthByMonth = new Map<
      string,
      {
        month: string;
        newSubscriptions: number;
      }
    >();

    for (const subscription of subscriptions) {
      const date = new Date(subscription.createdAt);

      const month = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}`;

      const row = growthByMonth.get(month);

      if (row) {
        row.newSubscriptions++;
      } else {
        growthByMonth.set(month, {
          month,
          newSubscriptions: 1,
        });
      }
    }

    // --------------------------------------------------
    // Upgrades / Downgrades
    // --------------------------------------------------

    const planChanges = new Map<
      string,
      {
        from: string;
        to: string;
        count: number;
      }
    >();

    for (const subscription of subscriptions) {
      if (
        !subscription.previousPlanKey ||
        subscription.previousPlanKey === subscription.planKey
      ) {
        continue;
      }

      const key = `${subscription.previousPlanKey}->${subscription.planKey}`;

      const row = planChanges.get(key);

      if (row) {
        row.count++;
      } else {
        planChanges.set(key, {
          from: subscription.previousPlanKey,
          to: subscription.planKey,
          count: 1,
        });
      }
    }

    // --------------------------------------------------
    // Pending Plan Changes
    // --------------------------------------------------

    const pendingPlanChanges = subscriptions
      .filter((s) => s.pendingPlanKey)
      .map((subscription) => ({
        subscriptionId: subscription._id,
        currentPlan: subscription.planKey,
        pendingPlan: subscription.pendingPlanKey,
        effectiveAt: subscription.pendingPlanEffectiveAt,
        changedAt: subscription.pendingPlanChangedAt,
      }));

    return {
      generatedAt: Date.now(),

      summary: {
        totalSubscriptions: subscriptions.length,
        activeSubscriptions: activeSubscriptions.length,
        trialingSubscriptions: trialingSubscriptions.length,
        cancelledSubscriptions:
          cancelledSubscriptions.length,
        pastDueSubscriptions:
          pastDueSubscriptions.length,
        scheduledForCancellation:
          scheduledForCancellation.length,

        trialConversionRate,

        cancellationRate,
      },

      charts: {
        statusDistribution,

        subscriptionGrowth: Array.from(
          growthByMonth.values(),
        ).sort((a, b) =>
          a.month.localeCompare(b.month),
        ),
      },

      plans: Array.from(planAnalytics.values()).sort(
        (a, b) =>
          b.activeSubscribers - a.activeSubscribers,
      ),

      planChanges: Array.from(planChanges.values()).sort(
        (a, b) => b.count - a.count,
      ),

      pendingPlanChanges,
    };
  },
});


export const getBillingPlanAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [plans, subscriptions] = await Promise.all([
      ctx.db.query("billingPlans").collect(),
      ctx.db.query("subscriptions").collect(),
    ]);

    const activeSubscriptions = subscriptions.filter((s) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
    );

    // --------------------------------------------------
    // KPI
    // --------------------------------------------------

    const totalPlans = plans.length;

    const activePlans = plans.filter((p) => p.isActive).length;

    const inactivePlans = totalPlans - activePlans;

    const averageMonthlyPrice =
      plans.length === 0
        ? 0
        : Math.round(
            plans.reduce(
              (sum, p) => sum + p.priceMonthlyCents,
              0,
            ) / plans.length,
          );

    const averageCredits =
      plans.length === 0
        ? 0
        : Math.round(
            plans.reduce(
              (sum, p) => sum + p.includedCredits,
              0,
            ) / plans.length,
          );

    // --------------------------------------------------
    // Per Plan Analytics
    // --------------------------------------------------

    const analytics = plans.map((plan) => {
      const subscribers = subscriptions.filter(
        (s) => s.planKey === plan.key,
      );

      const activeSubscribers = subscribers.filter((s) =>
        ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
      );

      const cancelledSubscribers = subscribers.filter((s) =>
        ["cancelled", "canceled"].includes(s.status),
      );

      const trialSubscribers = subscribers.filter(
        (s) => s.status === "trialing",
      );

      const pastDueSubscribers = subscribers.filter(
        (s) => s.status === "past_due",
      );

      const scheduledCancellation = subscribers.filter(
        (s) => s.cancelAtPeriodEnd,
      );

      const monthlyRevenue =
        activeSubscribers.length *
        plan.priceMonthlyCents;

      const annualRevenue = monthlyRevenue * 12;

      const marketShare =
        activeSubscriptions.length === 0
          ? 0
          : (activeSubscribers.length /
              activeSubscriptions.length) *
            100;

      return {
        id: plan._id,

        key: plan.key,

        name: plan.name,

        description: plan.description,

        active: plan.isActive,

        subscribers: subscribers.length,

        activeSubscribers:
          activeSubscribers.length,

        cancelledSubscribers:
          cancelledSubscribers.length,

        trialSubscribers:
          trialSubscribers.length,

        pastDueSubscribers:
          pastDueSubscribers.length,

        scheduledCancellation:
          scheduledCancellation.length,

        monthlyRevenueCents:
          monthlyRevenue,

        annualRevenueCents:
          annualRevenue,

        marketShare,

        includedCredits:
          plan.includedCredits,

        maxBrands:
          plan.maxBrands,

        maxSeats:
          plan.maxSeats,

        concurrentAiJobs:
          plan.limits.concurrentAiJobs,

        templateLimit:
          plan.limits.templateLimit,

        monthlyPriceCents:
          plan.priceMonthlyCents,

        yearlyProjection:
          annualRevenue,
      };
    });

    // --------------------------------------------------
    // Revenue Distribution
    // --------------------------------------------------

    const revenueDistribution = analytics
      .map((plan) => ({
        plan: plan.name,
        revenueCents:
          plan.monthlyRevenueCents,
      }))
      .sort(
        (a, b) =>
          b.revenueCents - a.revenueCents,
      );

    // --------------------------------------------------
    // Subscriber Distribution
    // --------------------------------------------------

    const subscriberDistribution = analytics
      .map((plan) => ({
        plan: plan.name,
        subscribers:
          plan.activeSubscribers,
      }))
      .sort(
        (a, b) =>
          b.subscribers - a.subscribers,
      );

    // --------------------------------------------------
    // Credits Distribution
    // --------------------------------------------------

    const creditsDistribution = analytics.map(
      (plan) => ({
        plan: plan.name,
        includedCredits:
          plan.includedCredits,
      }),
    );

    // --------------------------------------------------
    // Average Revenue Per Plan
    // --------------------------------------------------

    const averageRevenuePerPlan =
      analytics.length === 0
        ? 0
        : Math.round(
            analytics.reduce(
              (sum, p) =>
                sum +
                p.monthlyRevenueCents,
              0,
            ) / analytics.length,
          );

    return {
      generatedAt: Date.now(),

      summary: {
        totalPlans,

        activePlans,

        inactivePlans,

        averageMonthlyPrice,

        averageCredits,

        averageRevenuePerPlan,

        totalSubscribers:
          subscriptions.length,

        activeSubscribers:
          activeSubscriptions.length,
      },

      charts: {
        revenueDistribution,

        subscriberDistribution,

        creditsDistribution,
      },

      plans: analytics.sort(
        (a, b) =>
          b.monthlyRevenueCents -
          a.monthlyRevenueCents,
      ),
    };
  },
});


export const getCreditAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [accounts, ledger, reservations, subscriptions] =
      await Promise.all([
        ctx.db.query("creditAccounts").collect(),
        ctx.db.query("creditLedger").collect(),
        ctx.db.query("creditReservations").collect(),
        ctx.db.query("subscriptions").collect(),
      ]);

    // --------------------------------------------------
    // Credit Account KPIs
    // --------------------------------------------------

    const totalAccounts = accounts.length;

    const totalAvailableCredits = accounts.reduce(
      (sum, account) => sum + account.availableCredits,
      0,
    );

    const totalReservedCredits = accounts.reduce(
      (sum, account) => sum + account.reservedCredits,
      0,
    );

    const totalPurchasedCredits = accounts.reduce(
      (sum, account) => sum + account.lifetimePurchasedCredits,
      0,
    );

    const totalGrantedCredits = accounts.reduce(
      (sum, account) => sum + account.lifetimeGrantedCredits,
      0,
    );

    const totalConsumedCredits = accounts.reduce(
      (sum, account) => sum + account.lifetimeConsumedCredits,
      0,
    );

    const averageBalance =
      totalAccounts === 0
        ? 0
        : Math.round(totalAvailableCredits / totalAccounts);

    // --------------------------------------------------
    // Ledger Analytics
    // --------------------------------------------------

    const creditsByType = new Map<
      string,
      {
        type: string;
        credits: number;
        entries: number;
      }
    >();

    for (const entry of ledger) {
      const row = creditsByType.get(entry.type);

      if (row) {
        row.credits += Math.abs(entry.amount);
        row.entries++;
      } else {
        creditsByType.set(entry.type, {
          type: entry.type,
          credits: Math.abs(entry.amount),
          entries: 1,
        });
      }
    }

    // --------------------------------------------------
    // Credit Sources
    // --------------------------------------------------

    const purchasedCredits = ledger
      .filter((l) => l.amount > 0 && l.type.includes("purchase"))
      .reduce((sum, l) => sum + l.amount, 0);

    const grantedCredits = ledger
      .filter((l) => l.amount > 0 && l.type.includes("grant"))
      .reduce((sum, l) => sum + l.amount, 0);

    const trialCredits = ledger
      .filter((l) => l.type.includes("trial"))
      .reduce((sum, l) => sum + Math.abs(l.amount), 0);

    const bonusCredits = ledger
      .filter((l) => l.type.includes("bonus"))
      .reduce((sum, l) => sum + Math.abs(l.amount), 0);

    const adminCredits = ledger
      .filter((l) => l.type.startsWith("admin"))
      .reduce((sum, l) => sum + Math.abs(l.amount), 0);

    const sourceDistribution = [
      {
        source: "Purchased",
        credits: purchasedCredits,
      },
      {
        source: "Granted",
        credits: grantedCredits,
      },
      {
        source: "Trial",
        credits: trialCredits,
      },
      {
        source: "Bonus",
        credits: bonusCredits,
      },
      {
        source: "Admin",
        credits: adminCredits,
      },
    ];

    // --------------------------------------------------
    // Reservation Analytics
    // --------------------------------------------------

    const reservationSummary = {
      total: reservations.length,

      pending: reservations.filter(
        (r) => r.status === "pending",
      ).length,

      reserved: reservations.filter(
        (r) => r.status === "reserved",
      ).length,

      charged: reservations.filter(
        (r) => r.status === "charged",
      ).length,

      released: reservations.filter(
        (r) => r.status === "released",
      ).length,

      expired: reservations.filter(
        (r) => r.expiresAt < Date.now(),
      ).length,
    };

    // --------------------------------------------------
    // Largest Credit Accounts
    // --------------------------------------------------

    const topAccounts = accounts
      .map((account) => ({
        userId: account.userId,

        availableCredits: account.availableCredits,

        reservedCredits: account.reservedCredits,

        purchasedCredits:
          account.lifetimePurchasedCredits,

        grantedCredits:
          account.lifetimeGrantedCredits,

        consumedCredits:
          account.lifetimeConsumedCredits,

        utilization:
          account.lifetimePurchasedCredits === 0
            ? 0
            : (
                (account.lifetimeConsumedCredits /
                  account.lifetimePurchasedCredits) *
                100
              ),
      }))
      .sort(
        (a, b) =>
          b.consumedCredits - a.consumedCredits,
      )
      .slice(0, 25);

    // --------------------------------------------------
    // Credit Utilization
    // --------------------------------------------------

    const utilizationRate =
      totalPurchasedCredits === 0
        ? 0
        : (
            (totalConsumedCredits /
              totalPurchasedCredits) *
            100
          );

    // --------------------------------------------------
    // Active Subscriber Credit Health
    // --------------------------------------------------

    const activeSubscribers = subscriptions.filter((s) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
    );

    const lowBalanceAccounts = accounts.filter(
      (account) => account.availableCredits <= 100,
    );

    return {
      generatedAt: Date.now(),

      summary: {
        totalAccounts,

        activeSubscribers: activeSubscribers.length,

        totalAvailableCredits,

        totalReservedCredits,

        totalPurchasedCredits,

        totalGrantedCredits,

        totalConsumedCredits,

        averageBalance,

        utilizationRate,

        lowBalanceAccounts: lowBalanceAccounts.length,
      },

      charts: {
        sourceDistribution,

        creditsByType: Array.from(
          creditsByType.values(),
        ).sort(
          (a, b) => b.credits - a.credits,
        ),
      },

      reservations: reservationSummary,

      largestAccounts: topAccounts,
    };
  },
});


export const getTransactionAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [transactions, subscriptions] = await Promise.all([
      ctx.db.query("billingTransactions").collect(),
      ctx.db.query("subscriptions").collect(),
    ]);

    // --------------------------------------------------
    // Transaction Groups
    // --------------------------------------------------

    const completed = transactions.filter(
      (t) => t.status === "completed",
    );

    const pending = transactions.filter(
      (t) => t.status === "pending",
    );

    const failed = transactions.filter(
      (t) => t.status === "failed",
    );

    const refunded = transactions.filter(
      (t) => t.status === "refunded",
    );

    // --------------------------------------------------
    // KPI
    // --------------------------------------------------

    const totalRevenueCents = completed.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const refundedRevenueCents = refunded.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const pendingRevenueCents = pending.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const failedRevenueCents = failed.reduce(
      (sum, t) => sum + (t.amountCents ?? 0),
      0,
    );

    const successRate =
      transactions.length === 0
        ? 0
        : (completed.length / transactions.length) * 100;

    const refundRate =
      completed.length === 0
        ? 0
        : (refunded.length / completed.length) * 100;

    const averageTransactionValue =
      completed.length === 0
        ? 0
        : Math.round(totalRevenueCents / completed.length);

    // --------------------------------------------------
    // Revenue By Status
    // --------------------------------------------------

    const revenueByStatus = [
      {
        status: "Completed",
        count: completed.length,
        revenueCents: totalRevenueCents,
      },
      {
        status: "Pending",
        count: pending.length,
        revenueCents: pendingRevenueCents,
      },
      {
        status: "Failed",
        count: failed.length,
        revenueCents: failedRevenueCents,
      },
      {
        status: "Refunded",
        count: refunded.length,
        revenueCents: refundedRevenueCents,
      },
    ];

    // --------------------------------------------------
    // Revenue By Type
    // --------------------------------------------------

    const revenueByType = new Map<
      string,
      {
        type: string;
        transactions: number;
        revenueCents: number;
      }
    >();

    for (const transaction of completed) {
      const row = revenueByType.get(transaction.type);

      if (row) {
        row.transactions++;
        row.revenueCents += transaction.amountCents ?? 0;
      } else {
        revenueByType.set(transaction.type, {
          type: transaction.type,
          transactions: 1,
          revenueCents: transaction.amountCents ?? 0,
        });
      }
    }

    // --------------------------------------------------
    // Revenue By Currency
    // --------------------------------------------------

    const revenueByCurrency = new Map<
      string,
      {
        currency: string;
        transactions: number;
        revenueCents: number;
      }
    >();

    for (const transaction of completed) {
      const currency = transaction.currency ?? "UNKNOWN";

      const row = revenueByCurrency.get(currency);

      if (row) {
        row.transactions++;
        row.revenueCents += transaction.amountCents ?? 0;
      } else {
        revenueByCurrency.set(currency, {
          currency,
          transactions: 1,
          revenueCents: transaction.amountCents ?? 0,
        });
      }
    }

    // --------------------------------------------------
    // Daily Revenue
    // --------------------------------------------------

    const revenueByDay = new Map<
      string,
      {
        day: string;
        revenueCents: number;
        transactions: number;
      }
    >();

    for (const transaction of completed) {
      const day = new Date(transaction.occurredAt)
        .toISOString()
        .split("T")[0];

      const row = revenueByDay.get(day);

      if (row) {
        row.transactions++;
        row.revenueCents += transaction.amountCents ?? 0;
      } else {
        revenueByDay.set(day, {
          day,
          transactions: 1,
          revenueCents: transaction.amountCents ?? 0,
        });
      }
    }

    // --------------------------------------------------
    // Monthly Revenue
    // --------------------------------------------------

    const revenueByMonth = new Map<
      string,
      {
        month: string;
        revenueCents: number;
        transactions: number;
      }
    >();

    for (const transaction of completed) {
      const date = new Date(transaction.occurredAt);

      const month = `${date.getFullYear()}-${String(
        date.getMonth() + 1,
      ).padStart(2, "0")}`;

      const row = revenueByMonth.get(month);

      if (row) {
        row.transactions++;
        row.revenueCents += transaction.amountCents ?? 0;
      } else {
        revenueByMonth.set(month, {
          month,
          transactions: 1,
          revenueCents: transaction.amountCents ?? 0,
        });
      }
    }

    // --------------------------------------------------
    // Largest Transactions
    // --------------------------------------------------

    const largestTransactions = completed
      .map((transaction) => ({
        ...transaction,
      }))
      .sort(
        (a, b) =>
          (b.amountCents ?? 0) - (a.amountCents ?? 0),
      )
      .slice(0, 25);

    // --------------------------------------------------
    // Recent Transactions
    // --------------------------------------------------

    const recentTransactions = [...transactions]
      .sort(
        (a, b) => b.occurredAt - a.occurredAt,
      )
      .slice(0, 50);

    // --------------------------------------------------
    // Subscriber Purchase Distribution
    // --------------------------------------------------

    const purchasesPerSubscriber = new Map<
      string,
      {
        subscriptionId: string;
        transactions: number;
        revenueCents: number;
      }
    >();

    for (const transaction of completed) {
      const subscriptionId = (transaction as any).subscriptionId;

      if (!subscriptionId) continue;

      const key = subscriptionId;

      const row = purchasesPerSubscriber.get(key);

      if (row) {
        row.transactions++;
        row.revenueCents += transaction.amountCents ?? 0;
      } else {
        purchasesPerSubscriber.set(key, {
          subscriptionId: key,
          transactions: 1,
          revenueCents: transaction.amountCents ?? 0,
        });
      }
    }

    return {
      generatedAt: Date.now(),

      summary: {
        totalTransactions: transactions.length,

        completedTransactions: completed.length,

        pendingTransactions: pending.length,

        failedTransactions: failed.length,

        refundedTransactions: refunded.length,

        totalRevenueCents,

        refundedRevenueCents,

        pendingRevenueCents,

        failedRevenueCents,

        averageTransactionValue,

        successRate,

        refundRate,

        activeSubscribers: subscriptions.filter((s) =>
          ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
        ).length,
      },

      charts: {
        revenueByStatus,

        revenueByType: Array.from(
          revenueByType.values(),
        ).sort(
          (a, b) => b.revenueCents - a.revenueCents,
        ),

        revenueByCurrency: Array.from(
          revenueByCurrency.values(),
        ).sort(
          (a, b) => b.revenueCents - a.revenueCents,
        ),

        revenueByDay: Array.from(
          revenueByDay.values(),
        ).sort((a, b) =>
          a.day.localeCompare(b.day),
        ),

        revenueByMonth: Array.from(
          revenueByMonth.values(),
        ).sort((a, b) =>
          a.month.localeCompare(b.month),
        ),
      },

      largestTransactions,

      recentTransactions,

      purchasesPerSubscriber: Array.from(
        purchasesPerSubscriber.values(),
      ).sort(
        (a, b) => b.revenueCents - a.revenueCents,
      ),
    };
  },
});


export const getAiAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [aiSkus, ledger, reservations, subscriptions] =
      await Promise.all([
        ctx.db.query("aiSkus").collect(),
        ctx.db.query("creditLedger").collect(),
        ctx.db.query("creditReservations").collect(),
        ctx.db.query("subscriptions").collect(),
      ]);

    const skuMap = new Map(
      aiSkus.map((sku) => [sku.key, sku]),
    );

    // --------------------------------------------------
    // Provider Analytics
    // --------------------------------------------------

    const providers = new Map<
      string,
      {
        provider: string;
        requests: number;
        credits: number;
        retailValue: number;
      }
    >();

    // --------------------------------------------------
    // SKU Analytics
    // --------------------------------------------------

    const skus = new Map<
      string,
      {
        sku: string;
        label: string;
        provider: string;
        requests: number;
        credits: number;
      }
    >();

    // --------------------------------------------------
    // Customer Analytics
    // --------------------------------------------------

    const customers = new Map<
      string,
      {
        userId: string;
        requests: number;
        credits: number;
      }
    >();

    // --------------------------------------------------
    // Feature Analytics
    // --------------------------------------------------

    const features = new Map<
      string,
      {
        feature: string;
        requests: number;
        credits: number;
      }
    >();

    let totalCredits = 0;
    let totalRequests = 0;

    for (const entry of ledger) {
      if (!entry.skuKey) continue;

      const sku = skuMap.get(entry.skuKey);

      if (!sku) continue;

      const credits = Math.abs(entry.amount);

      totalCredits += credits;
      totalRequests++;

      //----------------------------------------
      // Provider
      //----------------------------------------

      {
        const existing = providers.get(
          sku.provider,
        );

        if (existing) {
          existing.requests++;
          existing.credits += credits;
          existing.retailValue += credits;
        } else {
          providers.set(sku.provider, {
            provider: sku.provider,
            requests: 1,
            credits,
            retailValue: credits,
          });
        }
      }

      //----------------------------------------
      // SKU
      //----------------------------------------

      {
        const existing = skus.get(sku.key);

        if (existing) {
          existing.requests++;
          existing.credits += credits;
        } else {
          skus.set(sku.key, {
            sku: sku.key,
            label: sku.label,
            provider: sku.provider,
            requests: 1,
            credits,
          });
        }
      }

      //----------------------------------------
      // Customer
      //----------------------------------------

      {
        const existing = customers.get(entry.userId);

        if (existing) {
          existing.requests++;
          existing.credits += credits;
        } else {
          customers.set(entry.userId, {
            userId: entry.userId,
            requests: 1,
            credits,
          });
        }
      }

      //----------------------------------------
      // Feature
      //----------------------------------------

      const feature =
        entry.creditSource ?? "unknown";

      {
        const existing = features.get(feature);

        if (existing) {
          existing.requests++;
          existing.credits += credits;
        } else {
          features.set(feature, {
            feature,
            requests: 1,
            credits,
          });
        }
      }
    }

    // --------------------------------------------------
    // Reservation Analytics
    // --------------------------------------------------

    const reservationSummary = {
      total: reservations.length,

      pending: reservations.filter(
        (r) => r.status === "pending",
      ).length,

      reserved: reservations.filter(
        (r) => r.status === "reserved",
      ).length,

      charged: reservations.filter(
        (r) => r.status === "charged",
      ).length,

      released: reservations.filter(
        (r) => r.status === "released",
      ).length,
    };

    // --------------------------------------------------
    // Summary
    // --------------------------------------------------

    const activeSubscriptions =
      subscriptions.filter((s) =>
        ACTIVE_SUBSCRIPTION_STATUSES.has(
          s.status,
        ),
      ).length;

    return {
      generatedAt: Date.now(),

      summary: {
        activeSubscriptions,

        totalProviders: providers.size,

        totalSkus: aiSkus.length,

        activeSkus: aiSkus.filter(
          (s) => s.isActive,
        ).length,

        totalRequests,

        totalCreditsConsumed:
          totalCredits,

        averageCreditsPerRequest:
          totalRequests === 0
            ? 0
            : totalCredits /
              totalRequests,
      },

      providers: Array.from(
        providers.values(),
      ).sort(
        (a, b) =>
          b.credits - a.credits,
      ),

      skus: Array.from(
        skus.values(),
      ).sort(
        (a, b) =>
          b.credits - a.credits,
      ),

      customers: Array.from(
        customers.values(),
      ).sort(
        (a, b) =>
          b.credits - a.credits,
      ),

      features: Array.from(
        features.values(),
      ).sort(
        (a, b) =>
          b.credits - a.credits,
      ),

      reservations: reservationSummary,

      charts: {
        providerBreakdown: Array.from(
          providers.values(),
        ),

        skuBreakdown: Array.from(
          skus.values(),
        ),

        featureBreakdown: Array.from(
          features.values(),
        ),
      },
    };
  },
});


// export const getReservationAnalytics = query({
//   args: {},
//   handler: async (ctx) => {
//     await requireBillingAdmin(ctx);

//     const [reservations, ledger, accounts, aiSkus] =
//       await Promise.all([
//         ctx.db.query("creditReservations").collect(),
//         ctx.db.query("creditLedger").collect(),
//         ctx.db.query("creditAccounts").collect(),
//         ctx.db.query("aiSkus").collect(),
//       ]);

//     const now = Date.now();

//     // --------------------------------------------------
//     // Reservation Groups
//     // --------------------------------------------------

//     const pending = reservations.filter(
//       (r) => r.status === "pending",
//     );

//     const reserved = reservations.filter(
//       (r) => r.status === "reserved",
//     );

//     const charged = reservations.filter(
//       (r) => r.status === "charged",
//     );

//     const released = reservations.filter(
//       (r) => r.status === "released",
//     );

//     const expired = reservations.filter(
//       (r) => r.expiresAt <= now,
//     );

//     // --------------------------------------------------
//     // KPI
//     // --------------------------------------------------

//     const totalReservedCredits = reservations.reduce(
//       (sum, reservation) =>
//         sum + reservation.amount,
//       0,
//     );

//     const pendingCredits = pending.reduce(
//       (sum, reservation) =>
//         sum + reservation.amount,
//       0,
//     );

//     const reservedCredits = reserved.reduce(
//       (sum, reservation) =>
//         sum + reservation.amount,
//       0,
//     );

//     const chargedCredits = charged.reduce(
//       (sum, reservation) =>
//         sum + reservation.amount,
//       0,
//     );

//     const releasedCredits = released.reduce(
//       (sum, reservation) =>
//         sum + reservation.amount,
//       0,
//     );

//     const expiredCredits = expired.reduce(
//       (sum, reservation) =>
//         sum + reservation.amount,
//       0,
//     );

//     const averageReservation =
//       reservations.length === 0
//         ? 0
//         : Math.round(
//             totalReservedCredits /
//               reservations.length,
//           );

//     const reservationSuccessRate =
//       reservations.length === 0
//         ? 0
//         : (charged.length /
//             reservations.length) *
//           100;

//     // --------------------------------------------------
//     // Reservations by SKU
//     // --------------------------------------------------

//     const skuAnalytics = new Map<
//       string,
//       {
//         sku: string;
//         provider: string;
//         reservations: number;
//         credits: number;
//       }
//     >();

//     const skuMap = new Map(
//       aiSkus.map((sku) => [sku.key, sku]),
//     );

//     for (const reservation of reservations) {
//       if (!reservation.skuKey) continue;

//       const sku = skuMap.get(
//         reservation.skuKey,
//       );

//       if (!sku) continue;

//       const row = skuAnalytics.get(
//         reservation.skuKey,
//       );

//       if (row) {
//         row.reservations++;
//         row.credits +=
//           reservation.amount;
//       } else {
//         skuAnalytics.set(
//           reservation.skuKey,
//           {
//             sku: sku.label,
//             provider: sku.provider,
//             reservations: 1,
//             credits: reservation.amount,
//           },
//         );
//       }
//     }

//     // --------------------------------------------------
//     // Reservations by User
//     // --------------------------------------------------

//     const userAnalytics = new Map<
//       string,
//       {
//         userId: string;
//         reservations: number;
//         credits: number;
//       }
//     >();

//     for (const reservation of reservations) {
//       const row = userAnalytics.get(
//         reservation.userId,
//       );

//       if (row) {
//         row.reservations++;
//         row.credits +=
//           reservation.amount;
//       } else {
//         userAnalytics.set(
//           reservation.userId,
//           {
//             userId: reservation.userId,
//             reservations: 1,
//             credits: reservation.amount,
//           },
//         );
//       }
//     }

//     // --------------------------------------------------
//     // Reservation Timeline
//     // --------------------------------------------------

//     const reservationTimeline = new Map<
//       string,
//       {
//         day: string;
//         reservations: number;
//         credits: number;
//       }
//     >();

//     for (const reservation of reservations) {
//       const day = new Date(
//         reservation.createdAt,
//       )
//         .toISOString()
//         .split("T")[0];

//       const row =
//         reservationTimeline.get(day);

//       if (row) {
//         row.reservations++;
//         row.credits +=
//           reservation.amount;
//       } else {
//         reservationTimeline.set(day, {
//           day,
//           reservations: 1,
//           credits: reservation.amount,
//         });
//       }
//     }

//     // --------------------------------------------------
//     // Largest Reservations
//     // --------------------------------------------------

//     const largestReservations =
//       [...reservations]
//         .sort(
//           (a, b) =>
//             b.amount - a.amount,
//         )
//         .slice(0, 25);

//     // --------------------------------------------------
//     // Reservation Status Distribution
//     // --------------------------------------------------

//     const statusDistribution = [
//       {
//         status: "Pending",
//         count: pending.length,
//       },
//       {
//         status: "Reserved",
//         count: reserved.length,
//       },
//       {
//         status: "Charged",
//         count: charged.length,
//       },
//       {
//         status: "Released",
//         count: released.length,
//       },
//       {
//         status: "Expired",
//         count: expired.length,
//       },
//     ];

//     // --------------------------------------------------
//     // Credit Health
//     // --------------------------------------------------

//     const lowBalanceAccounts =
//       accounts.filter((account) => {
//         const threshold = ('lowCreditThreshold' in account
//           ? (account as any).lowCreditThreshold
//           : 0) ?? 0;
//         return account.availableCredits <= threshold;
//       }).length;

//     const totalAvailableCredits =
//       accounts.reduce(
//         (sum, account) =>
//           sum +
//           account.availableCredits,
//         0,
//       );

//     return {
//       generatedAt: Date.now(),

//       summary: {
//         totalReservations:
//           reservations.length,

//         pendingReservations:
//           pending.length,

//         reservedReservations:
//           reserved.length,

//         chargedReservations:
//           charged.length,

//         releasedReservations:
//           released.length,

//         expiredReservations:
//           expired.length,

//         totalReservedCredits,

//         pendingCredits,

//         reservedCredits,

//         chargedCredits,

//         releasedCredits,

//         expiredCredits,

//         averageReservation,

//         reservationSuccessRate,

//         totalAvailableCredits,

//         lowBalanceAccounts,
//       },

//       charts: {
//         statusDistribution,

//         reservationTimeline:
//           Array.from(
//             reservationTimeline.values(),
//           ).sort((a, b) =>
//             a.day.localeCompare(
//               b.day,
//             ),
//           ),

//         reservationsBySku:
//           Array.from(
//             skuAnalytics.values(),
//           ).sort(
//             (a, b) =>
//               b.credits -
//               a.credits,
//           ),

//         reservationsByUser:
//           Array.from(
//             userAnalytics.values(),
//           ).sort(
//             (a, b) =>
//               b.credits -
//               a.credits,
//           ),
//       },

//       largestReservations,

//       reservationLedger: ledger
//         .filter((l) => l.reservationId)
//         .sort(
//           (a, b) =>
//             b._creationTime -
//             a._creationTime,
//         )
//         .slice(0, 100),
//     };
//   },
// });


export const getCreditPackageAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [packages, transactions] = await Promise.all([
      ctx.db.query("creditTopUpPackages").collect(),
      ctx.db.query("billingTransactions").collect(),
    ]);

    const completedTransactions = transactions.filter(
      (t) =>
        t.status === "completed" &&
        ("creditPackageId" in t && (t as any).creditPackageId),
    );

    // --------------------------------------------------
    // KPI
    // --------------------------------------------------

    const totalPackages = packages.length;

    const activePackages = packages.filter(
      (p) => p.isActive,
    ).length;

    const inactivePackages =
      totalPackages - activePackages;

    const totalSales = completedTransactions.length;

    const totalRevenueCents = completedTransactions.reduce(
      (sum, transaction) =>
        sum + (transaction.amountCents ?? 0),
      0,
    );

    const averageSaleValue =
      totalSales === 0
        ? 0
        : Math.round(
            totalRevenueCents / totalSales,
          );

    // --------------------------------------------------
    // Package Analytics
    // --------------------------------------------------

    const packageAnalytics = packages.map((pkg) => {
      const sales = completedTransactions.filter(
        (transaction) =>
          // some transaction typings don't include creditPackageId
          // cast to any to allow matching legacy/extended records
          ((transaction as any).creditPackageId === pkg._id),
      );

      const purchases = sales.length;

      const revenueCents = sales.reduce(
        (sum, transaction) =>
          sum + (transaction.amountCents ?? 0),
        0,
      );

      const creditsSold =
        purchases * pkg.credits;

      const averageRevenue =
        purchases === 0
          ? 0
          : Math.round(
              revenueCents / purchases,
            );

      return {
        id: pkg._id,

        name: pkg.key,

        key: pkg.key,

        active: pkg.isActive,

        credits: pkg.credits,

        priceCents: pkg.priceCents,

        purchases,

        creditsSold,

        revenueCents,

        averageRevenue,

        revenuePerCredit:
          pkg.credits === 0
            ? 0
            : revenueCents / creditsSold,
      };
    });

    // --------------------------------------------------
    // Revenue Distribution
    // --------------------------------------------------

    const revenueDistribution = packageAnalytics
      .map((pkg) => ({
        package: pkg.name,
        revenueCents: pkg.revenueCents,
      }))
      .sort(
        (a, b) =>
          b.revenueCents - a.revenueCents,
      );

    // --------------------------------------------------
    // Purchase Distribution
    // --------------------------------------------------

    const purchaseDistribution =
      packageAnalytics
        .map((pkg) => ({
          package: pkg.name,
          purchases: pkg.purchases,
        }))
        .sort(
          (a, b) =>
            b.purchases - a.purchases,
        );

    // --------------------------------------------------
    // Credits Sold Distribution
    // --------------------------------------------------

    const creditsDistribution =
      packageAnalytics
        .map((pkg) => ({
          package: pkg.name,
          creditsSold: pkg.creditsSold,
        }))
        .sort(
          (a, b) =>
            b.creditsSold -
            a.creditsSold,
        );

    // --------------------------------------------------
    // Revenue Timeline
    // --------------------------------------------------

    const revenueTimeline = new Map<
      string,
      {
        day: string;
        purchases: number;
        revenueCents: number;
      }
    >();

    for (const transaction of completedTransactions) {
      const day = new Date(
        transaction.occurredAt,
      )
        .toISOString()
        .split("T")[0];

      const row =
        revenueTimeline.get(day);

      if (row) {
        row.purchases++;
        row.revenueCents +=
          transaction.amountCents ?? 0;
      } else {
        revenueTimeline.set(day, {
          day,
          purchases: 1,
          revenueCents:
            transaction.amountCents ?? 0,
        });
      }
    }

    // --------------------------------------------------
    // Largest Purchases
    // --------------------------------------------------

    const largestPurchases =
      completedTransactions
        .sort(
          (a, b) =>
            (b.amountCents ?? 0) -
            (a.amountCents ?? 0),
        )
        .slice(0, 25);

    return {
      generatedAt: Date.now(),

      summary: {
        totalPackages,

        activePackages,

        inactivePackages,

        totalSales,

        totalRevenueCents,

        averageSaleValue,

        averageRevenuePerPackage:
          packageAnalytics.length === 0
            ? 0
            : Math.round(
                totalRevenueCents /
                  packageAnalytics.length,
              ),
      },

      charts: {
        revenueDistribution,

        purchaseDistribution,

        creditsDistribution,

        revenueTimeline: Array.from(
          revenueTimeline.values(),
        ).sort((a, b) =>
          a.day.localeCompare(b.day),
        ),
      },

      packages: packageAnalytics.sort(
        (a, b) =>
          b.revenueCents -
          a.revenueCents,
      ),

      largestPurchases,
    };
  },
});


export const getCustomerAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [
      users,
      subscriptions,
      creditAccounts,
      billingTransactions,
      creditLedger,
      reservations,
    ] = await Promise.all([
      ctx.db.query("users").collect(),
      ctx.db.query("subscriptions").collect(),
      ctx.db.query("creditAccounts").collect(),
      ctx.db.query("billingTransactions").collect(),
      ctx.db.query("creditLedger").collect(),
      ctx.db.query("creditReservations").collect(),
    ]);

    const customerAnalytics = users.map((user) => {
      const subscription = subscriptions.find(
        (s) => s.userId === user._id,
      );

      const account = creditAccounts.find(
        (a) => a.userId === user._id,
      );

      const transactions = billingTransactions.filter(
        (t) => t.userId === user._id,
      );

      const completedTransactions = transactions.filter(
        (t) => t.status === "completed",
      );

      const ledgerEntries = creditLedger.filter(
        (l) => l.userId === user._id,
      );

      const reservationsForUser = reservations.filter(
        (r) => r.userId === user._id,
      );

      const totalRevenue = completedTransactions.reduce(
        (sum, t) => sum + (t.amountCents ?? 0),
        0,
      );

      const aiCreditsConsumed = ledgerEntries
        .filter((l) => l.amount < 0)
        .reduce((sum, l) => sum + Math.abs(l.amount), 0);

      const platformGrantedCredits = ledgerEntries
        .filter((l) => l.amount > 0)
        .reduce((sum, l) => sum + l.amount, 0);

      return {
        userId: user._id,

        email: user.email,

        name: user.name,

        createdAt: user._creationTime,

        subscriptionStatus:
          subscription?.status ?? "none",

        planKey:
          subscription?.planKey ?? null,

        availableCredits:
          account?.availableCredits ?? 0,

        reservedCredits:
          account?.reservedCredits ?? 0,

        purchasedCredits:
          account?.lifetimePurchasedCredits ?? 0,

        grantedCredits:
          account?.lifetimeGrantedCredits ?? 0,

        consumedCredits:
          account?.lifetimeConsumedCredits ?? 0,

        revenueCents: totalRevenue,

        completedTransactions:
          completedTransactions.length,

        totalTransactions:
          transactions.length,

        ledgerEntries:
          ledgerEntries.length,

        reservations:
          reservationsForUser.length,

        aiCreditsConsumed,

        platformGrantedCredits,
      };
    });

    // --------------------------------------------------
    // KPI
    // --------------------------------------------------

    const activeCustomers = customerAnalytics.filter((c) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(c.subscriptionStatus),
    );

    const payingCustomers = customerAnalytics.filter(
      (c) => c.revenueCents > 0,
    );

    const totalRevenue = customerAnalytics.reduce(
      (sum, c) => sum + c.revenueCents,
      0,
    );

    const totalCredits = customerAnalytics.reduce(
      (sum, c) => sum + c.availableCredits,
      0,
    );

    const averageRevenue =
      payingCustomers.length === 0
        ? 0
        : Math.round(
            totalRevenue / payingCustomers.length,
          );

    const averageCredits =
      customerAnalytics.length === 0
        ? 0
        : Math.round(
            totalCredits / customerAnalytics.length,
          );

    // --------------------------------------------------
    // Charts
    // --------------------------------------------------

    const customersByPlan = new Map<
      string,
      {
        plan: string;
        customers: number;
      }
    >();

    for (const customer of customerAnalytics) {
      const key = customer.planKey ?? "No Plan";

      const row = customersByPlan.get(key);

      if (row) {
        row.customers++;
      } else {
        customersByPlan.set(key, {
          plan: key,
          customers: 1,
        });
      }
    }

    const customersByStatus = new Map<
      string,
      {
        status: string;
        customers: number;
      }
    >();

    for (const customer of customerAnalytics) {
      const row = customersByStatus.get(
        customer.subscriptionStatus,
      );

      if (row) {
        row.customers++;
      } else {
        customersByStatus.set(
          customer.subscriptionStatus,
          {
            status:
              customer.subscriptionStatus,
            customers: 1,
          },
        );
      }
    }

    // --------------------------------------------------
    // Leaderboards
    // --------------------------------------------------

    const topRevenueCustomers =
      [...customerAnalytics]
        .sort(
          (a, b) =>
            b.revenueCents -
            a.revenueCents,
        )
        .slice(0, 25);

    const topCreditUsers =
      [...customerAnalytics]
        .sort(
          (a, b) =>
            b.consumedCredits -
            a.consumedCredits,
        )
        .slice(0, 25);

    const topAiUsers =
      [...customerAnalytics]
        .sort(
          (a, b) =>
            b.aiCreditsConsumed -
            a.aiCreditsConsumed,
        )
        .slice(0, 25);

    const newestCustomers =
      [...customerAnalytics]
        .sort(
          (a, b) =>
            b.createdAt -
            a.createdAt,
        )
        .slice(0, 25);

    return {
      generatedAt: Date.now(),

      summary: {
        totalCustomers:
          customerAnalytics.length,

        activeCustomers:
          activeCustomers.length,

        payingCustomers:
          payingCustomers.length,

        totalRevenue,

        totalCredits,

        averageRevenue,

        averageCredits,
      },

      charts: {
        customersByPlan:
          Array.from(
            customersByPlan.values(),
          ).sort(
            (a, b) =>
              b.customers -
              a.customers,
          ),

        customersByStatus:
          Array.from(
            customersByStatus.values(),
          ).sort(
            (a, b) =>
              b.customers -
              a.customers,
          ),
      },

      topRevenueCustomers,

      topCreditUsers,

      topAiUsers,

      newestCustomers,

      customers: customerAnalytics,
    };
  },
});


export const getTrialAnalytics = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [subscriptions, billingPlans, billingTransactions] =
      await Promise.all([
        ctx.db.query("subscriptions").collect(),
        ctx.db.query("billingPlans").collect(),
        ctx.db.query("billingTransactions").collect(),
      ]);

    const now = Date.now();

    const trialSubscriptions = subscriptions.filter(
      (s) => s.status === "trialing",
    );

    const activeSubscriptions = subscriptions.filter((s) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
    );

    // --------------------------------------------------
    // Trial KPIs
    // --------------------------------------------------

    const expiredTrials = trialSubscriptions.filter(
      (s) =>
        s.trialEndsAt &&
        s.trialEndsAt < now,
    );

    const activeTrials = trialSubscriptions.filter(
      (s) =>
        s.trialEndsAt &&
        s.trialEndsAt >= now,
    );

    const convertedTrials = subscriptions.filter(
      (s) =>
        s.status === "active" &&
        s.trialEndsAt,
    );

    const conversionRate =
      trialSubscriptions.length === 0
        ? 0
        : (
            (convertedTrials.length /
              trialSubscriptions.length) *
            100
          );

    const getTrialStart = (s: {
      trialStartedAt?: number;
      _creationTime: number;
    }) => s.trialStartedAt ?? s._creationTime;

    const averageTrialLength =
      trialSubscriptions.length === 0
        ? 0
        : Math.round(
            trialSubscriptions.reduce(
              (sum, s) =>
                sum +
                ((s.trialEndsAt ?? getTrialStart(s)) -
                  getTrialStart(s)),
              0,
            ) /
              trialSubscriptions.length /
              (1000 * 60 * 60 * 24),
          );

    // --------------------------------------------------
    // Trial By Plan
    // --------------------------------------------------

    const trialsByPlan = billingPlans.map(
      (plan) => {
        const trials =
          trialSubscriptions.filter(
            (s) => s.planKey === plan.key,
          );

        const converted =
          convertedTrials.filter(
            (s) => s.planKey === plan.key,
          );

        return {
          planKey: plan.key,

          planName: plan.name,

          trials: trials.length,

          converted:
            converted.length,

          conversionRate:
            trials.length === 0
              ? 0
              : (converted.length /
                  trials.length) *
                100,
        };
      },
    );

    // --------------------------------------------------
    // Trial Timeline
    // --------------------------------------------------

    const timeline = new Map<
      string,
      {
        day: string;
        started: number;
      }
    >();

    for (const subscription of trialSubscriptions) {
      const day = new Date(
        getTrialStart(subscription),
      )
        .toISOString()
        .split("T")[0];

      const row = timeline.get(day);

      if (row) {
        row.started++;
      } else {
        timeline.set(day, {
          day,
          started: 1,
        });
      }
    }

    // --------------------------------------------------
    // Expiring Soon
    // --------------------------------------------------

    const nextSevenDays =
      now + 7 * 24 * 60 * 60 * 1000;

    const expiringSoon =
      activeTrials.filter(
        (s) =>
          (s.trialEndsAt ?? 0) <=
          nextSevenDays,
      );

    // --------------------------------------------------
    // Trial Revenue
    // --------------------------------------------------

    const convertedRevenue =
      billingTransactions
        .filter((t) => {
          const subscriptionId =
            (t as { subscriptionId?: string })
              .subscriptionId;

          return (
            t.status === "completed" &&
            !!subscriptionId &&
            convertedTrials.some(
              (s) => s._id === subscriptionId,
            )
          );
        })
        .reduce(
          (sum, t) =>
            sum +
            (t.amountCents ?? 0),
          0,
        );

    return {
      generatedAt: Date.now(),

      summary: {
        totalTrials:
          trialSubscriptions.length,

        activeTrials:
          activeTrials.length,

        expiredTrials:
          expiredTrials.length,

        convertedTrials:
          convertedTrials.length,

        conversionRate,

        averageTrialLength,

        trialRevenueCents:
          convertedRevenue,

        activeSubscriptions:
          activeSubscriptions.length,
      },

      charts: {
        trialsByPlan,

        trialTimeline:
          Array.from(
            timeline.values(),
          ).sort((a, b) =>
            a.day.localeCompare(
              b.day,
            ),
          ),
      },

      expiringSoon: expiringSoon
        .sort(
          (a, b) =>
            (a.trialEndsAt ?? 0) -
            (b.trialEndsAt ?? 0),
        )
        .slice(0, 25),

      convertedTrials:
        convertedTrials.slice(0, 50),

      activeTrials:
        activeTrials.slice(0, 50),
    };
  },
});


export const getSystemHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireBillingAdmin(ctx);

    const [
      subscriptions,
      billingPlans,
      billingTransactions,
      creditAccounts,
      creditLedger,
      creditReservations,
      aiSkus,
      creditPackages,
      users,
    ] = await Promise.all([
      ctx.db.query("subscriptions").collect(),
      ctx.db.query("billingPlans").collect(),
      ctx.db.query("billingTransactions").collect(),
      ctx.db.query("creditAccounts").collect(),
      ctx.db.query("creditLedger").collect(),
      ctx.db.query("creditReservations").collect(),
      ctx.db.query("aiSkus").collect(),
      ctx.db.query("creditTopUpPackages").collect(),
      ctx.db.query("users").collect(),
    ]);

    const now = Date.now();

    // --------------------------------------------------
    // Subscription Health
    // --------------------------------------------------

    const activeSubscriptions = subscriptions.filter((s) =>
      ACTIVE_SUBSCRIPTION_STATUSES.has(s.status),
    );

    const pastDueSubscriptions = subscriptions.filter(
      (s) => s.status === "past_due",
    );

    const cancelledSubscriptions = subscriptions.filter((s) =>
      ["cancelled", "canceled"].includes(s.status),
    );

    // --------------------------------------------------
    // Transaction Health
    // --------------------------------------------------

    const completedTransactions = billingTransactions.filter(
      (t) => t.status === "completed",
    );

    const pendingTransactions = billingTransactions.filter(
      (t) => t.status === "pending",
    );

    const failedTransactions = billingTransactions.filter(
      (t) => t.status === "failed",
    );

    const refundedTransactions = billingTransactions.filter(
      (t) => t.status === "refunded",
    );

    const paymentSuccessRate =
      billingTransactions.length === 0
        ? 100
        : (completedTransactions.length /
            billingTransactions.length) *
          100;

    // --------------------------------------------------
    // Credit Health
    // --------------------------------------------------

    const totalAvailableCredits = creditAccounts.reduce(
      (sum, account) => sum + account.availableCredits,
      0,
    );

    const totalReservedCredits = creditAccounts.reduce(
      (sum, account) => sum + account.reservedCredits,
      0,
    );

    const lowBalanceAccounts = creditAccounts.filter(
      (account) => account.availableCredits <= 0,
    );

    const negativeBalanceAccounts = creditAccounts.filter(
      (account) => account.availableCredits < 0,
    );

    // --------------------------------------------------
    // Reservation Health
    // --------------------------------------------------

    const pendingReservations = creditReservations.filter(
      (r) => r.status === "pending",
    );

    const reservedReservations = creditReservations.filter(
      (r) => r.status === "reserved",
    );

    const expiredReservations = creditReservations.filter(
      (r) => r.expiresAt <= now,
    );

    const staleReservations = creditReservations.filter(
      (r) =>
        r.status === "reserved" &&
        now - r.createdAt >
          30 * 60 * 1000,
    );

    // --------------------------------------------------
    // AI Health
    // --------------------------------------------------

    const activeSkus = aiSkus.filter(
      (sku) => sku.isActive,
    );

    const inactiveSkus = aiSkus.filter(
      (sku) => !sku.isActive,
    );

    const providers = [
      ...new Set(aiSkus.map((s) => s.provider)),
    ];

    // --------------------------------------------------
    // Billing Health
    // --------------------------------------------------

    const inactivePlans = billingPlans.filter(
      (plan) => !plan.isActive,
    );

    const inactivePackages = creditPackages.filter(
      (pkg) => !pkg.isActive,
    );

    // --------------------------------------------------
    // Ledger Health
    // --------------------------------------------------

    const aiLedgerEntries = creditLedger.filter(
      (l) => l.skuKey,
    );

    const orphanLedgerEntries = creditLedger.filter(
      (l) => !l.userId,
    );

    // --------------------------------------------------
    // Integrity Checks
    // --------------------------------------------------

    const accountsWithoutSubscription =
      creditAccounts.filter(
        (account) =>
          !subscriptions.some(
            (s) => s.userId === account.userId,
          ),
      );

    const subscriptionsWithoutAccount =
      subscriptions.filter(
        (subscription) =>
          !creditAccounts.some(
            (a) =>
              a.userId ===
              subscription.userId,
          ),
      );

    // --------------------------------------------------
    // Health Score
    // --------------------------------------------------

    let healthScore = 100;

    healthScore -= failedTransactions.length * 0.5;
    healthScore -= expiredReservations.length * 0.2;
    healthScore -= staleReservations.length * 0.5;
    healthScore -= lowBalanceAccounts.length * 0.2;
    healthScore -= negativeBalanceAccounts.length * 2;
    healthScore -= pastDueSubscriptions.length * 0.5;
    healthScore -= orphanLedgerEntries.length;

    healthScore = Math.max(
      0,
      Math.min(100, healthScore),
    );

    // --------------------------------------------------
    // Warnings
    // --------------------------------------------------

    const warnings: string[] = [];

    if (paymentSuccessRate < 95) {
      warnings.push(
        "Payment success rate is below 95%.",
      );
    }

    if (negativeBalanceAccounts.length > 0) {
      warnings.push(
        `${negativeBalanceAccounts.length} account(s) have negative credit balances.`,
      );
    }

    if (staleReservations.length > 0) {
      warnings.push(
        `${staleReservations.length} reservation(s) appear stuck.`,
      );
    }

    if (expiredReservations.length > 0) {
      warnings.push(
        `${expiredReservations.length} reservation(s) have expired.`,
      );
    }

    if (subscriptionsWithoutAccount.length > 0) {
      warnings.push(
        `${subscriptionsWithoutAccount.length} subscription(s) have no credit account.`,
      );
    }

    if (accountsWithoutSubscription.length > 0) {
      warnings.push(
        `${accountsWithoutSubscription.length} credit account(s) have no subscription.`,
      );
    }

    return {
      generatedAt: now,

      healthScore,

      summary: {
        totalUsers: users.length,

        activeSubscriptions:
          activeSubscriptions.length,

        pastDueSubscriptions:
          pastDueSubscriptions.length,

        cancelledSubscriptions:
          cancelledSubscriptions.length,

        totalTransactions:
          billingTransactions.length,

        paymentSuccessRate,

        totalAvailableCredits,

        totalReservedCredits,

        lowBalanceAccounts:
          lowBalanceAccounts.length,

        negativeBalanceAccounts:
          negativeBalanceAccounts.length,

        pendingReservations:
          pendingReservations.length,

        reservedReservations:
          reservedReservations.length,

        expiredReservations:
          expiredReservations.length,

        staleReservations:
          staleReservations.length,

        activeSkus:
          activeSkus.length,

        inactiveSkus:
          inactiveSkus.length,

        providers: providers.length,

        inactivePlans:
          inactivePlans.length,

        inactivePackages:
          inactivePackages.length,

        ledgerEntries:
          creditLedger.length,

        aiLedgerEntries:
          aiLedgerEntries.length,
      },

      integrity: {
        subscriptionsWithoutAccount,

        accountsWithoutSubscription,

        orphanLedgerEntries,
      },

      warnings,
    };
  },
});