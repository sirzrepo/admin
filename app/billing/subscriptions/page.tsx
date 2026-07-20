'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { SubscriptionStatusBadge } from '@/components/billing/subscription-status-badge';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

const subscriptionStatuses = [
  'all',
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
] as const;

type SubscriptionStatus = (typeof subscriptionStatuses)[number];

interface SubscriptionRow {
  userId: string;
  planKey: string;
  status: string;
  stripeSubscriptionId?: string;
  stripeCustomerId?: string;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  cancelAtPeriodEnd?: boolean;
  updatedAt: number;
  plan?: { name: string } | null;
}

function formatDate(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleString() : '-';
}

export default function SubscriptionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<SubscriptionStatus>('all');

  const subscriptionsResult = useQuery(api.billingAdmin.adminGetSubscriptions, {});
  const subscriptions = subscriptionsResult?.subscriptions ?? [];

  const filteredSubscriptions = subscriptions.filter((subscription) => {
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      const planName = subscription.plan?.name ?? subscription.planKey;
      const matchesQuery =
        subscription.userId.toLowerCase().includes(query) ||
        planName.toLowerCase().includes(query) ||
        subscription.stripeSubscriptionId?.toLowerCase().includes(query) ||
        subscription.stripeCustomerId?.toLowerCase().includes(query);
      if (!matchesQuery) return false;
    }

    if (filterStatus !== 'all' && subscription.status !== filterStatus) {
      return false;
    }

    return true;
  });

  const columns = [
    {
      key: 'userId',
      header: 'User ID',
      cell: (row: SubscriptionRow) => (
        <code className="text-xs bg-muted px-1 rounded">{row.userId}</code>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (row: SubscriptionRow) => row.plan?.name ?? row.planKey,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: SubscriptionRow) => (
        <SubscriptionStatusBadge status={row.status as any} />
      ),
    },
    {
      key: 'period',
      header: 'Period',
      cell: (row: SubscriptionRow) => (
        <div className="space-y-1 text-sm">
          <div>{formatDate(row.currentPeriodStart)}</div>
          <div className="text-muted-foreground">to {formatDate(row.currentPeriodEnd)}</div>
        </div>
      ),
    },
    {
      key: 'stripeSubscriptionId',
      header: 'Stripe Subscription',
      cell: (row: SubscriptionRow) => (
        row.stripeSubscriptionId ? (
          <code className="text-xs bg-muted px-1 rounded">{row.stripeSubscriptionId}</code>
        ) : (
          '-'
        )
      ),
    },
    {
      key: 'stripeCustomerId',
      header: 'Stripe Customer',
      cell: (row: SubscriptionRow) => (
        row.stripeCustomerId ? (
          <code className="text-xs bg-muted px-1 rounded">{row.stripeCustomerId}</code>
        ) : (
          '-'
        )
      ),
    },
    {
      key: 'cancelAtPeriodEnd',
      header: 'Cancel at Period End',
      cell: (row: SubscriptionRow) => (row.cancelAtPeriodEnd ? 'Yes' : 'No'),
    },
    {
      key: 'updatedAt',
      header: 'Updated At',
      cell: (row: SubscriptionRow) => formatDate(row.updatedAt),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Subscriptions"
        description="Review active and historical subscription records managed through Convex."
      />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Label>Search subscriptions</Label>
              <Input
                placeholder="Search by user, plan, Stripe IDs..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={filterStatus} onValueChange={(value) => setFilterStatus(value as SubscriptionStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {subscriptionStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status === 'all' ? 'All statuses' : status.replace('_', ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <BillingTable
        columns={columns}
        data={filteredSubscriptions}
        emptyMessage={subscriptions.length === 0 ? 'Loading subscriptions...' : 'No subscriptions match your filters.'}
      />
    </div>
  );
}
