'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { CreditBadge } from '@/components/billing/credit-badge';
import { Clock, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

interface Reservation {
  _id: string;
  userId: string;
  customerName: string;
  customerEmail: string;
  status: 'pending' | 'charged' | 'released' | 'expired';
  estimatedCredits: number;
  chargedCredits?: number;
  releasedCredits?: number;
  feature: string;
  taskId?: string;
  campaign?: string;
  expiresAt: number;
  createdAt: number;
}

export default function ReservationsPage() {
  const reservationResult = useQuery(api.billingAdmin.adminGetReservations);
  const reservations: Reservation[] = reservationResult?.reservations ?? [];

  const columns = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (row: Reservation) => (
        <div>
          <p className="font-medium">{row.userId}</p>
          <p className="text-sm text-muted-foreground">{row.userId}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: Reservation) => {
        const getStatusConfig = () => {
          switch (row.status) {
            case 'pending':
              return {
                icon: <Clock className="w-4 h-4" />,
                variant: 'secondary' as const,
                label: 'Pending',
              };
            case 'charged':
              return {
                icon: <CheckCircle className="w-4 h-4" />,
                variant: 'default' as const,
                label: 'Charged',
              };
            case 'released':
              return {
                icon: <CheckCircle className="w-4 h-4" />,
                variant: 'outline' as const,
                label: 'Released',
              };
            case 'expired':
              return {
                icon: <XCircle className="w-4 h-4" />,
                variant: 'destructive' as const,
                label: 'Expired',
              };
            default:
              return {
                icon: null,
                variant: 'outline' as const,
                label: row.status,
              };
          }
        };

        const config = getStatusConfig();
        return (
          <Badge variant={config.variant} className="gap-1">
            {config.icon}
            {config.label}
          </Badge>
        );
      },
    },
    {
      key: 'estimatedCredits',
      header: 'Estimated',
      cell: (row: Reservation) => <CreditBadge credits={row.estimatedCredits} />,
    },
    {
      key: 'chargedCredits',
      header: 'Charged',
      cell: (row: Reservation) => row.chargedCredits ? <CreditBadge credits={row.chargedCredits} /> : '-',
    },
    {
      key: 'releasedCredits',
      header: 'Released',
      cell: (row: Reservation) => row.releasedCredits ? <CreditBadge credits={row.releasedCredits} /> : '-',
    },
    {
      key: 'feature',
      header: 'Feature',
      cell: (row: Reservation) => (
        <Badge variant="outline">{row.feature}</Badge>
      ),
    },
    {
      key: 'task',
      header: 'Task',
      cell: (row: Reservation) => row.taskId ? <code className="text-xs bg-muted px-1 rounded">{row.taskId}</code> : '-',
    },
    {
      key: 'expiration',
      header: 'Expires',
      cell: (row: Reservation) => new Date(row.expiresAt).toLocaleString(),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row: Reservation) => (
        <div className="flex gap-2">
          {row.status === 'pending' && (
            <Button variant="outline" size="sm" disabled>
              Release
            </Button>
          )}
          {(row.status === 'charged' || row.status === 'pending') && (
            <Button variant="outline" size="sm" disabled>
              Repair
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Credit Reservations"
        description="View and manage credit holds for async operations"
      />

      <BillingTable columns={columns} data={reservations} />

      <Card className="bg-blue-500/10 border-blue-500/20">
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-blue-700 dark:text-blue-300 mt-0.5" />
            <div>
              <p className="text-sm text-blue-700 dark:text-blue-300 font-medium mb-1">
                Backend Actions Disabled
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                Release and Repair actions are currently disabled as the backend APIs are not yet implemented. 
                These will be enabled once the corresponding Convex mutations are available.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
