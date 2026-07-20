'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { CreditBadge } from '@/components/billing/credit-badge';
import { Search, Filter, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

interface LedgerEntry {
  _id: string;
  userId: string;
  type: 'purchase' | 'grant' | 'consume' | 'refund' | 'expire' | 'rollover' | string;
  amount: number;
  balanceAfter?: number;
  reason: string;
  skuKey?: string;
  createdAt: number;
}

export default function LedgerPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterSKU, setFilterSKU] = useState<string>('all');

  const ledgerResult = useQuery(api.billingAdmin.adminGetCreditLedger, {});
  const ledgerEntries: LedgerEntry[] = ledgerResult?.ledger ?? [];

  const filteredEntries = ledgerEntries.filter((entry) => {
    if (searchQuery && !entry.userId.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (filterType !== 'all' && entry.type !== filterType) return false;
    if (filterSKU !== 'all' && entry.skuKey !== filterSKU) return false;
    return true;
  });

  const columns = [
    {
      key: 'userId',
      header: 'User ID',
      cell: (row: LedgerEntry) => (
        <code className="text-xs bg-muted px-1 rounded">{row.userId}</code>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      cell: (row: LedgerEntry) => {
        const getTypeIcon = () => {
          switch (row.type) {
            case 'purchase':
            case 'grant':
            case 'rollover':
              return <ArrowUp className="w-4 h-4 text-green-500" />;
            case 'consume':
            case 'expire':
              return <ArrowDown className="w-4 h-4 text-red-500" />;
            case 'refund':
              return <Minus className="w-4 h-4 text-yellow-500" />;
            default:
              return null;
          }
        };

        return (
          <div className="flex items-center gap-2">
            {getTypeIcon()}
            <Badge variant="outline">{row.type}</Badge>
          </div>
        );
      },
    },
    {
      key: 'amount',
      header: 'Amount',
      cell: (row: LedgerEntry) => (
        <span className={row.amount < 0 ? 'text-red-500' : 'text-green-500'}>
          {row.amount > 0 ? '+' : ''}{row.amount.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'balanceAfter',
      header: 'Balance After',
      cell: (row: LedgerEntry) => <CreditBadge credits={row.balanceAfter} />,
    },
    {
      key: 'reason',
      header: 'Reason',
      cell: (row: LedgerEntry) => row.reason,
    },
    {
      key: 'sku',
      header: 'SKU',
      cell: (row: LedgerEntry) => row.skuKey ? <code className="text-xs bg-muted px-1 rounded">{row.skuKey}</code> : '-',
    },
    {
      key: 'date',
      header: 'Date',
      cell: (row: LedgerEntry) => new Date(row.createdAt).toLocaleDateString(),
    },
  ];

  const types = ['all', 'purchase', 'grant', 'consume', 'refund', 'expire', 'rollover'];
  const skus = ['all', ...Array.from(new Set(ledgerEntries.filter((e) => e.skuKey).map((e) => e.skuKey!)))];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Credit Ledger"
        description="View immutable credit transaction history"
      />

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            <div className="space-y-2">
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by type" />
                </SelectTrigger>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type === 'all' ? 'All Types' : type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Select value={filterSKU} onValueChange={setFilterSKU}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by SKU" />
                </SelectTrigger>
                <SelectContent>
                  {skus.map((sku) => (
                    <SelectItem key={sku} value={sku}>
                      {sku === 'all' ? 'All SKUs' : sku}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <BillingTable columns={columns} data={filteredEntries} />

      <Card className="bg-yellow-500/10 border-yellow-500/20">
        <CardContent className="pt-6">
          <p className="text-sm text-yellow-700 dark:text-yellow-300">
            <strong>Important:</strong> Credit ledger entries are immutable and cannot be deleted. 
            All credit transactions are permanently recorded for audit purposes.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
