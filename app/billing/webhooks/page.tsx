'use client';

'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { WebhookStatusBadge } from '@/components/billing/webhook-status-badge';
import { Search, RefreshCw, AlertCircle } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

interface WebhookEvent {
  _id: string;
  stripeEventId: string;
  eventType: string;
  status: 'pending' | 'processed' | 'failed';
  error?: string;
  createdAt: number;
  processedAt?: number;
}

export default function WebhooksPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');

  const webhookResult = useQuery(api.billingAdmin.adminGetWebhookEvents);
  const webhookEvents = webhookResult?.webhookEvents ?? [];
  const eventTypes = ['all', ...(webhookResult?.eventTypes?.map((item: any) => item.type) ?? [])];

  const filteredEvents = webhookEvents.filter((event) => {
    if (searchQuery && !event.stripeEventId.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !event.eventType.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (filterStatus !== 'all' && event.status !== filterStatus) return false;
    if (filterType !== 'all' && !event.eventType.includes(filterType)) return false;
    return true;
  });

  const columns = [
    {
      key: 'eventId',
      header: 'Event ID',
      cell: (row: WebhookEvent) => (
        <code className="text-xs bg-muted px-1 rounded">{row.stripeEventId}</code>
      ),
    },
    {
      key: 'eventType',
      header: 'Event Type',
      cell: (row: WebhookEvent) => (
        <span className="text-sm">{row.eventType}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: WebhookEvent) => <WebhookStatusBadge status={row.status} />,
    },
    {
      key: 'error',
      header: 'Error',
      cell: (row: WebhookEvent) => row.error ? (
        <span className="text-destructive text-sm">{row.error}</span>
      ) : '-',
    },
    {
      key: 'createdAt',
      header: 'Created',
      cell: (row: WebhookEvent) => new Date(row.createdAt).toLocaleString(),
    },
    {
      key: 'processedAt',
      header: 'Processed',
      cell: (row: WebhookEvent) => row.processedAt ? new Date(row.processedAt).toLocaleString() : '-',
    },
    {
      key: 'duration',
      header: 'Duration',
      cell: (row: WebhookEvent) => {
        if (!row.processedAt) return '-';
        const duration = row.processedAt - row.createdAt;
        return `${duration}ms`;
      },
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row: WebhookEvent) => (
        <Button
          variant="outline"
          size="sm"
          disabled={row.status !== 'failed'}
          onClick={() => {
            // TODO: Implement retry logic
            console.log('Retry event:', row._id);
          }}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  const statuses = ['all', 'pending', 'processed', 'failed'];
  const handleRetry = (eventId: string) => {
    // Retry is handled by server-side webhook processing. If you add a retry mutation, call it here.
    console.log('Retrying event:', eventId);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Stripe Webhooks"
        description="Monitor Stripe webhook events and processing status"
      />

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by event ID or type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="space-y-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  {statuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status === 'all' ? 'All Statuses' : status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  {eventTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type === 'all' ? 'All Types' : type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <BillingTable columns={columns} data={filteredEvents} />

      <Card className="bg-yellow-500/10 border-yellow-500/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-yellow-700 dark:text-yellow-300 mt-0.5" />
            <div>
              <p className="text-sm text-yellow-700 dark:text-yellow-300 font-medium mb-1">
                Retry Action Disabled
              </p>
              <p className="text-sm text-yellow-700 dark:text-yellow-300">
                The retry action is currently disabled as the backend API is not yet implemented. 
                This will be enabled once the corresponding Convex mutation is available.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
