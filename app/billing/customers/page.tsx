'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { CreditBadge } from '@/components/billing/credit-badge';
import { Search, User } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

interface CreditAccount {
  _id: string;
  _creationTime?: number;
  userId: string;
  availableCredits: number;
  reservedCredits: number;
  lifetimePurchasedCredits: number;
  lifetimeGrantedCredits: number;
  lifetimeConsumedCredits: number;
  currentPeriodGrantedCredits: number;
  planKey?: string;
  updatedAt: number;
}

export default function CustomersPage() {
  const [selectedAccount, setSelectedAccount] = useState<CreditAccount | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const customersResult = useQuery(api.billingAdmin.adminGetCreditAccounts, {});
  const accounts: CreditAccount[] = customersResult?.accounts ?? [];

  const filteredAccounts = accounts.filter((account) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      account.userId.toLowerCase().includes(query) ||
      account.planKey?.toLowerCase().includes(query) ||
      account._id.toLowerCase().includes(query)
    );
  });

  const columns = [
    {
      key: 'userId',
      header: 'User ID',
      cell: (row: CreditAccount) => (
        <code className="text-xs bg-muted px-1 rounded">{row.userId}</code>
      ),
    },
    {
      key: 'availableCredits',
      header: 'Available',
      cell: (row: CreditAccount) => <CreditBadge credits={row.availableCredits} />, 
    },
    {
      key: 'currentPeriodGrantedCredits',
      header: 'Current Period Granted',
      cell: (row: CreditAccount) => row.currentPeriodGrantedCredits,
    },
    {
      key: 'lifetimeConsumedCredits',
      header: 'Lifetime Consumed',
      cell: (row: CreditAccount) => row.lifetimeConsumedCredits,
    },
    {
      key: 'lifetimeGrantedCredits',
      header: 'Lifetime Granted',
      cell: (row: CreditAccount) => row.lifetimeGrantedCredits,
    },
    {
      key: 'lifetimePurchasedCredits',
      header: 'Lifetime Purchased',
      cell: (row: CreditAccount) => row.lifetimePurchasedCredits,
    },
    {
      key: 'planKey',
      header: 'Plan',
      cell: (row: CreditAccount) => row.planKey ?? '-',
    },
    {
      key: 'reservedCredits',
      header: 'Reserved',
      cell: (row: CreditAccount) => row.reservedCredits,
    },
    {
      key: 'updatedAt',
      header: 'Updated At',
      cell: (row: CreditAccount) => new Date(row.updatedAt).toLocaleString(),
    },
    {
      key: '_creationTime',
      header: 'Created At',
      cell: (row: CreditAccount) =>
        row._creationTime ? new Date(row._creationTime).toLocaleString() : '-',
    },
    {
      key: '_id',
      header: 'Account ID',
      cell: (row: CreditAccount) => (
        <code className="text-xs bg-muted px-1 rounded">{row._id}</code>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row: CreditAccount) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSelectedAccount(row);
            setIsDialogOpen(true);
          }}
        >
          <User className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Customers"
        description="View and manage customer billing information"
      />

      <Card>
        <CardContent className="pt-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search customers by name, email, or brand..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      <BillingTable columns={columns} data={filteredAccounts} />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Credit Account Details</DialogTitle>
          </DialogHeader>

          {selectedAccount && <AccountProfile account={selectedAccount} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AccountProfile({ account }: { account: CreditAccount }) {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Account Overview</CardTitle>
          <CardDescription>Live credit account data from Convex.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-muted-foreground">User ID</p>
              <code className="block mt-1 text-xs bg-muted px-2 py-1 rounded">{account.userId}</code>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Plan Key</p>
              <p className="font-medium">{account.planKey ?? 'unset'}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Available Credits</p>
              <CreditBadge credits={account.availableCredits} variant="default" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Reserved Credits</p>
              <CreditBadge credits={account.reservedCredits} variant="secondary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Lifetime Purchased</p>
              <p className="font-medium">{account.lifetimePurchasedCredits.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Lifetime Granted</p>
              <p className="font-medium">{account.lifetimeGrantedCredits.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Lifetime Consumed</p>
              <p className="font-medium">{account.lifetimeConsumedCredits.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Current Period Granted</p>
              <p className="font-medium">{account.currentPeriodGrantedCredits.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Updated At</p>
              <p className="font-medium">{new Date(account.updatedAt).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created At</p>
              <p className="font-medium">{account._creationTime ? new Date(account._creationTime).toLocaleString() : '-'}</p>
            </div>
            <div className="md:col-span-2">
              <p className="text-sm text-muted-foreground">Account ID</p>
              <code className="block mt-1 text-xs bg-muted px-2 py-1 rounded">{account._id}</code>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
