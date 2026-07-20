'use client';

import { useQuery } from 'convex/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatCard } from '@/components/stat-card';
import { Users, DollarSign, Coins, TrendingUp, AlertCircle, CheckCircle } from 'lucide-react';
import { api } from '@/convex/_generated/api';

export default function BillingOverviewPage() {
  const overview = useQuery(api.adminBillingAnalytics.getOverviewAnalytics, {});

  const stats = {
    activeSubscribers: overview?.subscriptions.active ?? 0,
    trialUsers: overview?.subscriptions.trialing ?? 0,
    pastDueUsers: overview?.subscriptions.pastDue ?? 0,
    monthlySubscriptionRevenue: overview?.revenue.monthlyRecurringRevenue ?? 0,
    totalRevenue: overview?.revenue.totalRevenueCents ?? 0,
    totalCreditsAvailable: overview?.credits.available ?? 0,
    totalReservedCredits: overview?.credits.reserved ?? 0,
    creditsConsumed: overview?.credits.consumed ?? 0,
    totalCustomers: overview?.system.totalCustomers ?? 0,
    totalTransactions: overview?.system.totalTransactions ?? 0,
    totalAIProviders: overview?.ai.providers ?? 0,
    totalSKUs: overview?.ai.totalSkus ?? 0,
    activeSKUs: overview?.ai.activeSkus ?? 0,
    pendingReservations: overview?.reservations.pending ?? 0,
    reservedReservations: overview?.reservations.reserved ?? 0,
    chargedReservations: overview?.reservations.charged ?? 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Billing Overview</h1>
        <p className="text-muted-foreground mt-2">
          Monitor your billing metrics, revenue, and system health
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Active Subscribers"
          value={stats.activeSubscribers.toLocaleString()}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Trial Users"
          value={stats.trialUsers.toLocaleString()}
          icon={<CheckCircle className="h-4 w-4" />}
        />
        <StatCard
          label="Past Due Users"
          value={stats.pastDueUsers.toLocaleString()}
          icon={<AlertCircle className="h-4 w-4" />}
        />
        <StatCard
          label="Monthly MRR"
          value={`$${(stats.monthlySubscriptionRevenue / 100).toLocaleString()}`}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <StatCard
          label="Total Credits Available"
          value={stats.totalCreditsAvailable.toLocaleString()}
          icon={<Coins className="h-4 w-4" />}
        />
        <StatCard
          label="Credits Consumed"
          value={stats.creditsConsumed.toLocaleString()}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <StatCard
          label="Total Customers"
          value={stats.totalCustomers.toLocaleString()}
          icon={<Users className="h-4 w-4" />}
        />
        <StatCard
          label="Total Transactions"
          value={stats.totalTransactions.toLocaleString()}
          icon={<CheckCircle className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${(stats.totalRevenue / 100).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Total completed revenue</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI Providers</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalAIProviders.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">Active AI providers</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">AI SKUs</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.activeSKUs.toLocaleString()} / {stats.totalSKUs.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Active / total AI SKUs</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Reservation Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Pending</span>
                <span>{stats.pendingReservations.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Reserved</span>
                <span>{stats.reservedReservations.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Charged</span>
                <span>{stats.chargedReservations.toLocaleString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Credits Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm text-muted-foreground">
              <div className="flex justify-between">
                <span>Available</span>
                <span>{stats.totalCreditsAvailable.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Reserved</span>
                <span>{stats.totalReservedCredits.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>Consumed</span>
                <span>{stats.creditsConsumed.toLocaleString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
