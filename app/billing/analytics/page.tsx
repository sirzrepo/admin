'use client';

import { useQuery } from 'convex/react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { StatCard } from '@/components/stat-card';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { AIProviderBadge } from '@/components/billing/ai-provider-badge';
import { BarChart3, PieChart } from 'lucide-react';
import { api } from '../../../convex/_generated/api';

interface AiProviderRow {
  provider: string;
  requests: number;
  credits: number;
  retailValue: number;
}

interface AiSkuRow {
  sku: string;
  label: string;
  provider: string;
  requests: number;
  credits: number;
}

interface AiCustomerRow {
  userId: string;
  requests: number;
  credits: number;
}

interface AiFeatureRow {
  feature: string;
  requests: number;
  credits: number;
}

export default function AICostDashboardPage() {
  const aiAnalytics = useQuery(api.adminBillingAnalytics.getAiAnalytics, {});

  const summary = aiAnalytics?.summary ?? {
    activeSubscriptions: 0,
    totalProviders: 0,
    totalSkus: 0,
    activeSkus: 0,
    totalRequests: 0,
    totalCreditsConsumed: 0,
    averageCreditsPerRequest: 0,
  };

  const providers: AiProviderRow[] = aiAnalytics?.providers ?? [];
  const skus: AiSkuRow[] = aiAnalytics?.skus ?? [];
  const customers: AiCustomerRow[] = aiAnalytics?.customers ?? [];
  const features: AiFeatureRow[] = aiAnalytics?.features ?? [];

  const providerColumns = [
    {
      key: 'provider',
      header: 'Provider',
      cell: (row: AiProviderRow) => <AIProviderBadge provider={row.provider} />,
    },
    {
      key: 'requests',
      header: 'Requests',
      cell: (row: AiProviderRow) => row.requests.toLocaleString(),
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (row: AiProviderRow) => row.credits.toLocaleString(),
    },
    {
      key: 'retailValue',
      header: 'Retail Value',
      cell: (row: AiProviderRow) => row.retailValue.toLocaleString(),
    },
  ];

  const skuColumns = [
    {
      key: 'sku',
      header: 'SKU',
      cell: (row: AiSkuRow) => (
        <div>
          <p className="font-medium">{row.label}</p>
          <code className="text-xs text-muted-foreground">{row.sku}</code>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      cell: (row: AiSkuRow) => <AIProviderBadge provider={row.provider} />,
    },
    {
      key: 'requests',
      header: 'Requests',
      cell: (row: AiSkuRow) => row.requests.toLocaleString(),
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (row: AiSkuRow) => row.credits.toLocaleString(),
    },
  ];

  const customerColumns = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (row: AiCustomerRow) => (
        <div>
          <p className="font-medium">{row.userId}</p>
          <p className="text-sm text-muted-foreground">User ID</p>
        </div>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      cell: (row: AiCustomerRow) => row.requests.toLocaleString(),
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (row: AiCustomerRow) => row.credits.toLocaleString(),
    },
  ];

  const featureColumns = [
    {
      key: 'feature',
      header: 'Feature',
      cell: (row: AiFeatureRow) => (
        <span className="capitalize">{row.feature.replace('_', ' ')}</span>
      ),
    },
    {
      key: 'requests',
      header: 'Requests',
      cell: (row: AiFeatureRow) => row.requests.toLocaleString(),
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (row: AiFeatureRow) => row.credits.toLocaleString(),
    },
  ];

  const totalCredits = summary.totalCreditsConsumed;
  const totalRequests = summary.totalRequests;
  const averageCreditsPerRequest = summary.averageCreditsPerRequest;
  const activeSubscriptions = summary.activeSubscriptions;
  const totalProviders = summary.totalProviders;
  const totalSkus = summary.totalSkus;
  const activeSkus = summary.activeSkus;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="AI Cost Dashboard"
        description="Analytics for AI costs, margins, and usage patterns"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Requests"
          value={totalRequests.toLocaleString()}
        />
        <StatCard
          label="Total Credits Consumed"
          value={totalCredits.toLocaleString()}
        />
        <StatCard
          label="Avg Credits / Request"
          value={averageCreditsPerRequest.toFixed(1)}
        />
        <StatCard
          label="Active Subscriptions"
          value={activeSubscriptions.toLocaleString()}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          label="Active Providers"
          value={totalProviders.toLocaleString()}
        />
        <StatCard
          label="Active SKUs"
          value={`${activeSkus.toLocaleString()} / ${totalSkus.toLocaleString()}`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="w-5 h-5" />
            Cost by Provider
          </CardTitle>
          <CardDescription>API usage broken down by AI provider.</CardDescription>
        </CardHeader>
        <CardContent>
          <BillingTable columns={providerColumns} data={providers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Top SKUs
          </CardTitle>
          <CardDescription>Most used AI SKUs by credits consumed.</CardDescription>
        </CardHeader>
        <CardContent>
          <BillingTable columns={skuColumns} data={skus} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Customers</CardTitle>
          <CardDescription>Customers generating the most AI usage.</CardDescription>
        </CardHeader>
        <CardContent>
          <BillingTable columns={customerColumns} data={customers} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature Usage</CardTitle>
          <CardDescription>AI usage by feature or credit source.</CardDescription>
        </CardHeader>
        <CardContent>
          <BillingTable columns={featureColumns} data={features} />
        </CardContent>
      </Card>
    </div>
  );
}
