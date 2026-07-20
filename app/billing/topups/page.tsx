'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { MoneyInput } from '@/components/billing/money-input';
import { CreditInput } from '@/components/billing/credit-input';
import { Plus, Edit, Copy, Trash2 } from 'lucide-react';
import { useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';

interface TopUpPackage {
  _id: string;
  key?: string;
  label: string;
  description?: string;
  credits: number;
  priceCents: number;
  currency?: string;
  expiresAfterDays?: number;
  stripePriceId?: string;
  isActive: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export default function TopUpsPage() {
  const [editingPackage, setEditingPackage] = useState<TopUpPackage | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [globalCreditValue] = useState(100); // Would come from billing settings

  const topupsResult = useQuery(api.billingAdmin.adminGetCreditPackages, {});
  const packages: TopUpPackage[] = topupsResult?.packages ?? [];

  const columns = [
    {
      key: 'package',
      header: 'Package',
      cell: (row: TopUpPackage) => (
        <div>
          <p className="font-medium">{row.label}</p>
          {row.description && (
            <p className="text-sm text-muted-foreground">{row.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'credits',
      header: 'Credits',
      cell: (row: TopUpPackage) => row.credits.toLocaleString(),
    },
    {
      key: 'price',
      header: 'Price',
      cell: (row: TopUpPackage) => `$${(row.priceCents / 100).toFixed(2)}`,
    },
    {
      key: 'value',
      header: 'Value per Credit',
      cell: (row: TopUpPackage) => {
        const value = row.credits / (row.priceCents / 100);
        return `${value.toFixed(2)} credits/$`;
      },
    },
    {
      key: 'expiration',
      header: 'Expiration',
      cell: (row: TopUpPackage) => (row.expiresAfterDays ? `${row.expiresAfterDays} days` : 'Never'),
    },
    {
      key: 'currency',
      header: 'Currency',
      cell: (row: TopUpPackage) => row.currency || 'USD',
    },
    {
      key: 'stripePriceId',
      header: 'Stripe Price ID',
      cell: (row: TopUpPackage) => (
        <code className="text-xs bg-muted px-1 rounded">
          {row.stripePriceId || 'Not set'}
        </code>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: TopUpPackage) => (
        <Badge variant={row.isActive ? 'default' : 'secondary'}>
          {row.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row: TopUpPackage) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditingPackage(row);
              setIsDialogOpen(true);
            }}
          >
            <Edit className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              const newPackage: TopUpPackage = {
                _id: '',
                key: undefined,
                label: row.label,
                description: row.description,
                credits: row.credits,
                priceCents: row.priceCents,
                currency: row.currency,
                expiresAfterDays: row.expiresAfterDays,
                stripePriceId: undefined,
                isActive: row.isActive,
              };
              setEditingPackage(newPackage);
              setIsDialogOpen(true);
            }}
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => {
              // TODO: Implement delete logic
              console.log('Delete package:', row._id);
            }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      ),
    },
  ];

  const handleSavePackage = (pkg: TopUpPackage) => {
    // TODO: Implement save logic with Convex mutation
    console.log('Saving package:', pkg);
    setIsDialogOpen(false);
    setEditingPackage(null);
  };

  const suggestedCredits = (priceCents: number) => {
    return Math.round((priceCents / 100) * globalCreditValue);
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Top-Up Packages"
        description="Manage credit top-up packages and pricing"
        action={{
          label: 'Create Package',
          onClick: () => {
            setEditingPackage(null);
            setIsDialogOpen(true);
          },
        }}
      />

      <BillingTable columns={columns} data={packages} />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPackage?._id ? 'Edit Package' : 'Create Package'}
            </DialogTitle>
          </DialogHeader>

          {(editingPackage || true) && (
            <PackageEditForm
              pkg={editingPackage || {
                _id: '',
                key: undefined,
                label: '',
                description: '',
                credits: 0,
                priceCents: 0,
                currency: 'USD',
                expiresAfterDays: 30,
                stripePriceId: '',
                isActive: true,
              }}
              globalCreditValue={globalCreditValue}
              suggestedCredits={suggestedCredits}
              onSave={handleSavePackage}
              onCancel={() => {
                setIsDialogOpen(false);
                setEditingPackage(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PackageEditForm({
  pkg,
  globalCreditValue,
  suggestedCredits,
  onSave,
  onCancel,
}: {
  pkg: TopUpPackage;
  globalCreditValue: number;
  suggestedCredits: (priceCents: number) => number;
  onSave: (pkg: TopUpPackage) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState(pkg);

  const handlePriceChange = (priceCents: number) => {
    setFormData({ ...formData, priceCents });
    // Auto-suggest credits if not manually set
    if (!formData.credits) {
      setFormData({ ...formData, priceCents, credits: suggestedCredits(priceCents) });
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label>Package Name</Label>
          <Input
            value={formData.label}
            onChange={(e) => setFormData({ ...formData, label: e.target.value })}
            placeholder="e.g., Starter Pack"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>Description</Label>
          <Input
            value={formData.description || ''}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Package description"
          />
        </div>

        <MoneyInput
          label="Price"
          value={formData.priceCents}
          onChange={handlePriceChange}
        />

        <CreditInput
          label="Credits"
          value={formData.credits}
          onChange={(value) => setFormData({ ...formData, credits: value })}
        />

        <div className="space-y-2">
          <Label>Expiration (Days)</Label>
          <Input
            type="number"
            value={formData.expiresAfterDays || ''}
            onChange={(e) => setFormData({
              ...formData,
              expiresAfterDays: e.target.value ? parseInt(e.target.value) : undefined,
            })}
            placeholder="30"
          />
          <p className="text-xs text-muted-foreground">
            Leave empty for no expiration
          </p>
        </div>

        <div className="space-y-2">
          <Label>Stripe Price ID</Label>
          <Input
            value={formData.stripePriceId || ''}
            onChange={(e) => setFormData({ ...formData, stripePriceId: e.target.value })}
            placeholder="price_..."
          />
        </div>
      </div>

      {/* Computed Values */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Computed Values</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Suggested Credits:</span>
            <span className="font-medium">{suggestedCredits(formData.priceCents).toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Value per Credit:</span>
            <span className="font-medium">
              {formData.priceCents > 0 ? (formData.credits / (formData.priceCents / 100)).toFixed(2) : '0'} credits/$
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-sm text-muted-foreground">Global Credit Value:</span>
            <span className="font-medium">{globalCreditValue} credits/$</span>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          checked={formData.isActive}
          onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
        />
        <Label htmlFor="isActive">Active</Label>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)}>
          Save Package
        </Button>
      </div>
    </div>
  );
}
