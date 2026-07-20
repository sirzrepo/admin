'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { StripeLink } from '@/components/billing/stripe-link';
import { CreditInput } from '@/components/billing/credit-input';
import { MoneyInput } from '@/components/billing/money-input';
import { Search, DollarSign, ExternalLink, Edit, Trash2 } from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { useToast } from '@/hooks/use-toast';
import { api } from '../../../convex/_generated/api';

interface Transaction {
  _id: string;
  key: string;
  userId: string;
  customerName?: string | null;
  customerEmail?: string | null;
  title: string;
  type: 'payment' | 'refund' | 'subscription' | 'topup' | 'invoice' | string;
  amountCents?: number;
  currency?: string;
  credits?: number;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | string;
  stripePaymentIntentId?: string;
  stripeInvoiceId?: string;
  stripeCustomerId?: string;
  // stripeInvoiceId?: string;
  stripeSessionId?: string;
  stripeChargeId?: string;
  receiptUrl?: string;
  invoiceUrl?: string;
  occurredAt: number;
  createdAt: number;
}

const transactionTypes = ['payment', 'refund', 'subscription', 'topup', 'invoice'];
const transactionStatuses = ['pending', 'completed', 'failed', 'refunded'];

export default function TransactionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { toast } = useToast();
  const transactionResult = useQuery(api.billingAdmin.adminGetTransactions);
  const createTransaction = useMutation((api.billingAdmin as any).adminCreateTransaction);
  const updateTransaction = useMutation((api.billingAdmin as any).adminUpdateTransaction);
  const deleteTransaction = useMutation((api.billingAdmin as any).adminDeleteTransaction);

  const transactions = transactionResult?.transactions ?? [];

  const filteredTransactions = transactions.filter((tx) => {
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      const matchesCustomer =
        tx.customerName?.toLowerCase().includes(query) ||
        tx.customerEmail?.toLowerCase().includes(query) ||
        tx.userId.toLowerCase().includes(query);
      const matchesTitle = tx.title.toLowerCase().includes(query);
      const matchesKey = tx.key.toLowerCase().includes(query);
      if (!matchesCustomer && !matchesTitle && !matchesKey) {
        return false;
      }
    }

    if (filterType !== 'all' && tx.type !== filterType) return false;
    if (filterStatus !== 'all' && tx.status !== filterStatus) return false;
    return true;
  });

  const handleExportCSV = () => {
    const headers = [
      'Transaction Key',
      'User ID',
      'Customer Name',
      'Customer Email',
      'Title',
      'Type',
      'Status',
      'Amount',
      'Currency',
      'Credits',
      'Occurred At',
      'Stripe Payment Intent',
      'Stripe Invoice',
    ];

    const rows = filteredTransactions.map((row) => [
      row.key,
      row.userId,
      row.customerName ?? '',
      row.customerEmail ?? '',
      row.title,
      row.type,
      row.status,
      row.amountCents !== undefined ? (row.amountCents / 100).toFixed(2) : '',
      row.currency ?? '',
      row.credits?.toString() ?? '',
      new Date(row.occurredAt).toISOString(),
      row.stripePaymentIntentId ?? '',
      row.stripeInvoiceId ?? '',
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleSaveTransaction = async (transaction: Transaction) => {
    setIsSaving(true);
    try {
      if (isCreateMode) {
        await createTransaction({
          key: transaction.key.trim(),
          userId: transaction.userId.trim(),
          title: transaction.title.trim(),
          type: transaction.type.trim(),
          status: transaction.status.trim(),
          amountCents: transaction.amountCents,
          currency: transaction.currency?.trim() || undefined,
          credits: transaction.credits,
          stripeCustomerId: transaction.stripeCustomerId?.trim() || undefined,
          stripeSessionId: transaction.stripeSessionId?.trim() || undefined,
          stripeInvoiceId: transaction.stripeInvoiceId?.trim() || undefined,
          stripePaymentIntentId: transaction.stripePaymentIntentId?.trim() || undefined,
          stripeChargeId: transaction.stripeChargeId?.trim() || undefined,
          receiptUrl: transaction.receiptUrl?.trim() || undefined,
          invoiceUrl: transaction.invoiceUrl?.trim() || undefined,
          metadata: undefined,
          occurredAt: transaction.occurredAt,
        });

        toast({
          title: 'Transaction created',
          description: 'The transaction was created successfully.',
        });
      } else if (selectedTransaction) {
        await updateTransaction({
          key: selectedTransaction.key,
          title: transaction.title.trim(),
          type: transaction.type.trim(),
          status: transaction.status.trim(),
          amountCents: transaction.amountCents,
          currency: transaction.currency?.trim() || undefined,
          credits: transaction.credits,
          stripeCustomerId: transaction.stripeCustomerId?.trim() || undefined,
          stripeSessionId: transaction.stripeSessionId?.trim() || undefined,
          stripeInvoiceId: transaction.stripeInvoiceId?.trim() || undefined,
          stripePaymentIntentId: transaction.stripePaymentIntentId?.trim() || undefined,
          stripeChargeId: transaction.stripeChargeId?.trim() || undefined,
          receiptUrl: transaction.receiptUrl?.trim() || undefined,
          invoiceUrl: transaction.invoiceUrl?.trim() || undefined,
          metadata: undefined,
          occurredAt: transaction.occurredAt,
        });

        toast({
          title: 'Transaction updated',
          description: 'The transaction was updated successfully.',
        });
      }

      setIsDialogOpen(false);
      setSelectedTransaction(null);
      setIsCreateMode(false);
    } catch (error) {
      toast({
        title: 'Error saving transaction',
        description: error instanceof Error ? error.message : 'Unable to save transaction.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteTransaction = async (transaction: Transaction) => {
    if (!confirm(`Delete transaction ${transaction.key}? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteTransaction({ key: transaction.key });
      toast({
        title: 'Transaction deleted',
        description: 'The transaction was deleted successfully.',
      });
    } catch (error) {
      toast({
        title: 'Error deleting transaction',
        description: error instanceof Error ? error.message : 'Unable to delete transaction.',
        variant: 'destructive',
      });
    }
  };

  const columns = [
    {
      key: 'customer',
      header: 'Customer',
      cell: (row: Transaction) => (
        <div>
          <p className="font-medium">{row.customerName || row.userId}</p>
          <p className="text-sm text-muted-foreground">{row.customerEmail || row.userId}</p>
        </div>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      cell: (row: Transaction) => row.title,
    },
    {
      key: 'type',
      header: 'Type',
      cell: (row: Transaction) => <Badge variant="outline">{row.type}</Badge>,
    },
    {
      key: 'amount',
      header: 'Amount',
      cell: (row: Transaction) => {
        const amount = row.amountCents ?? 0;
        return (
          <span className={amount < 0 ? 'text-red-500' : ''}>
            ${Math.abs(amount / 100).toFixed(2)}
          </span>
        );
      },
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (row: Transaction) => (
        <span className={row.credits !== undefined && row.credits < 0 ? 'text-red-500' : ''}>
          {row.credits !== undefined ? row.credits.toLocaleString() : '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: Transaction) => (
        <Badge variant="outline">{row.status}</Badge>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      cell: (row: Transaction) => new Date(row.occurredAt).toLocaleDateString(),
    },
    {
      key: 'stripe',
      header: 'Stripe',
      cell: (row: Transaction) => (
        <div className="flex gap-2">
          {row.stripePaymentIntentId && (
            <StripeLink
              href={`https://dashboard.stripe.com/payments/${row.stripePaymentIntentId}`}
              label="Payment"
              size="sm"
            />
          )}
          {row.stripeInvoiceId && (
            <StripeLink
              href={`https://dashboard.stripe.com/invoices/${row.stripeInvoiceId}`}
              label="Invoice"
              size="sm"
            />
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row: Transaction) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedTransaction(row);
              setIsCreateMode(false);
              setIsDialogOpen(true);
            }}
          >
            <Edit className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => handleDeleteTransaction(row)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Transactions"
        description="View and manage billing transactions"
        action={{
          label: 'Create Transaction',
          onClick: () => {
            setSelectedTransaction(null);
            setIsCreateMode(true);
            setIsDialogOpen(true);
          },
        }}
      />

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-4">
            <div className="md:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search by customer, email, title, or key..."
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
                  <SelectItem value="all">All Types</SelectItem>
                  {transactionTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {transactionStatuses.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end justify-end">
              <Button variant="secondary" onClick={handleExportCSV}>
                <DollarSign className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <BillingTable columns={columns} data={filteredTransactions} />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isCreateMode ? 'Create Transaction' : 'Edit Transaction'}
            </DialogTitle>
          </DialogHeader>
          <TransactionForm
            transaction={
              selectedTransaction ?? {
                _id: '',
                key: '',
                userId: '',
                title: '',
                type: 'payment',
                status: 'completed',
                amountCents: 0,
                currency: 'USD',
                credits: 0,
                occurredAt: Date.now(),
                createdAt: Date.now(),
              }
            }
            isCreateMode={isCreateMode}
            onSave={handleSaveTransaction}
            onCancel={() => {
              setIsDialogOpen(false);
              setSelectedTransaction(null);
              setIsCreateMode(false);
            }}
            isSaving={isSaving}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TransactionForm({
  transaction,
  isCreateMode,
  onSave,
  onCancel,
  isSaving,
}: {
  transaction: Transaction;
  isCreateMode: boolean;
  onSave: (transaction: Transaction) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState<Transaction>(transaction);

  useEffect(() => {
    setFormData(transaction);
  }, [transaction]);

  const formatDate = (value: number) => {
    return new Date(value).toISOString().slice(0, 10);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Transaction Key</Label>
          <Input
            value={formData.key}
            onChange={(e) => setFormData({ ...formData, key: e.target.value })}
            disabled={!isCreateMode}
          />
          {!isCreateMode && (
            <p className="text-xs text-muted-foreground">Transaction key cannot be changed after creation.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>User ID</Label>
          <Input
            value={formData.userId}
            onChange={(e) => setFormData({ ...formData, userId: e.target.value })}
            placeholder="User ID"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Title</Label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Transaction title"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
            <SelectTrigger>
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              {transactionTypes.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Status</Label>
          <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              {transactionStatuses.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Occurred At</Label>
          <Input
            type="date"
            value={formatDate(formData.occurredAt)}
            onChange={(e) => setFormData({ ...formData, occurredAt: new Date(e.target.value).getTime() })}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MoneyInput
          label="Amount"
          value={formData.amountCents ?? 0}
          onChange={(value) => setFormData({ ...formData, amountCents: value })}
        />

        <div className="space-y-2">
          <Label>Currency</Label>
          <Input
            value={formData.currency ?? 'USD'}
            onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
            placeholder="USD"
          />
        </div>
      </div>

      <CreditInput
        label="Credits"
        value={formData.credits ?? 0}
        onChange={(value) => setFormData({ ...formData, credits: value })}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Stripe Payment Intent ID</Label>
          <Input
            value={formData.stripePaymentIntentId || ''}
            onChange={(e) => setFormData({ ...formData, stripePaymentIntentId: e.target.value })}
            placeholder="pi_..."
          />
        </div>

        <div className="space-y-2">
          <Label>Stripe Invoice ID</Label>
          <Input
            value={formData.stripeInvoiceId || ''}
            onChange={(e) => setFormData({ ...formData, stripeInvoiceId: e.target.value })}
            placeholder="in_..."
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Stripe Customer ID</Label>
        <Input
          value={formData.stripeCustomerId || ''}
          onChange={(e) => setFormData({ ...formData, stripeCustomerId: e.target.value })}
          placeholder="cus_..."
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)} disabled={isSaving}>
          {isCreateMode ? 'Create Transaction' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
