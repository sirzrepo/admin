'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

const sessionModes = ['all', 'subscription', 'payment'] as const;
const sessionStatuses = ['all', 'open', 'complete', 'completed', 'expired'] as const;

type CheckoutSessionMode = (typeof sessionModes)[number];
type CheckoutSessionStatus = (typeof sessionStatuses)[number];

interface CheckoutSessionRow {
  userId: string;
  mode: string;
  status: string;
  stripeSessionId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  planKey?: string;
  packageKey?: string;
  credits?: number;
  amountCents?: number;
  currency?: string;
  url?: string;
  createdAt: number;
  updatedAt: number;
}

function formatDate(timestamp?: number) {
  return timestamp ? new Date(timestamp).toLocaleString() : '-';
}

function formatAmount(value?: number, currency?: string) {
  if (value === undefined) return '-';
  return `${currency ?? 'USD'} $${(value / 100).toFixed(2)}`;
}

export default function CheckoutSessionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<CheckoutSessionMode>('all');
  const [filterStatus, setFilterStatus] = useState<CheckoutSessionStatus>('all');

  const checkoutResult = useQuery(api.billingAdmin.adminGetCheckoutSessions, {});
  const sessions = checkoutResult?.checkoutSessions ?? [];

  const filteredSessions = sessions.filter((session) => {
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      const sessionText = [
        session.userId,
        session.stripeSessionId,
        session.stripeCustomerId ?? '',
        session.stripeSubscriptionId ?? '',
        session.planKey ?? '',
        session.packageKey ?? '',
        session.url ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (!sessionText.includes(query)) {
        return false;
      }
    }

    if (filterMode !== 'all' && session.mode !== filterMode) {
      return false;
    }

    if (filterStatus !== 'all' && session.status !== filterStatus) {
      return false;
    }

    return true;
  });

  const columns = [
    {
      key: 'userId',
      header: 'User ID',
      cell: (row: CheckoutSessionRow) => (
        <code className="text-xs bg-muted px-1 rounded">{row.userId}</code>
      ),
    },
    {
      key: 'mode',
      header: 'Mode',
      cell: (row: CheckoutSessionRow) => row.mode,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: CheckoutSessionRow) => (
        <Badge variant={row.status === 'open' ? 'secondary' : 'default'}>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'planOrPackage',
      header: 'Plan / Package',
      cell: (row: CheckoutSessionRow) => row.planKey ?? row.packageKey ?? '-',
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (row: CheckoutSessionRow) => (row.credits !== undefined ? row.credits : '-'),
    },
    {
      key: 'amount',
      header: 'Amount',
      cell: (row: CheckoutSessionRow) => formatAmount(row.amountCents, row.currency),
    },
    {
      key: 'stripeSessionId',
      header: 'Stripe Session',
      cell: (row: CheckoutSessionRow) => (
        <code className="text-xs bg-muted px-1 rounded">{row.stripeSessionId}</code>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created At',
      cell: (row: CheckoutSessionRow) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Checkout Sessions"
        description="View Stripe checkout session records pulled from Convex."
      />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Label>Search sessions</Label>
              <Input
                placeholder="Search by user, Stripe ID, plan, package, or URL"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Mode</Label>
              <Select
                value={filterMode}
                onValueChange={(value) => setFilterMode(value as CheckoutSessionMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessionModes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {mode === 'all' ? 'All modes' : mode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={filterStatus}
                onValueChange={(value) => setFilterStatus(value as CheckoutSessionStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sessionStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status === 'all' ? 'All statuses' : status}
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
        data={filteredSessions}
        emptyMessage={sessions.length === 0 ? 'Loading checkout sessions...' : 'No checkout sessions match your filters.'}
      />
    </div>
  );
}
