'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { MarginBadge } from '@/components/billing/margin-badge';
import { AIProviderBadge } from '@/components/billing/ai-provider-badge';
import { MoneyInput } from '@/components/billing/money-input';
import { CreditInput } from '@/components/billing/credit-input';
import { Edit } from 'lucide-react';
import { api } from '../../../convex/_generated/api';

interface AISKU {
  _id: string;
  sku: string;
  key: string;
  label: string;
  provider: string;
  model: string;
  unit: string;
  providerCost: number;
  creditValue?: number;
  markupOverride?: number;
  computedCredits?: number;
  retailValue?: number;
  margin?: number;
  status: 'active' | 'inactive' | 'deprecated';
  defaultCreditSource?: string;
  effectiveFrom?: number;
  effectiveTo?: number;
  metadata?: any;
  createdAt?: number;
  updatedAt?: number;
}

export default function SKUsPage() {
  const [editingSKU, setEditingSKU] = useState<AISKU | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const aiSkusResult = useQuery(api.billingAdmin.adminGetAiSkus, {});
  const skus: AISKU[] = (aiSkusResult?.skus ?? []).map((sku) => ({
    _id: sku._id,
    key: sku.key,
    sku: sku.key,
    label: sku.label,
    provider: sku.provider,
    model: sku.model,
    unit: sku.unitType,
    providerCost: sku.providerCostPerUnitCents,
    creditValue: sku.creditValueOverrideCents,
    markupOverride: sku.markupOverride,
    computedCredits: sku.creditValueOverrideCents
      ? Math.max(
          1,
          Math.round(
            (sku.providerCostPerUnitCents * (sku.markupOverride ?? 50)) /
              sku.creditValueOverrideCents,
          ),
        )
      : undefined,
    retailValue:
      sku.markupOverride !== undefined
        ? Math.round(sku.providerCostPerUnitCents * (1 + sku.markupOverride / 100))
        : undefined,
    margin:
      sku.markupOverride !== undefined
        ? Math.round(
            ((sku.providerCostPerUnitCents * (1 + sku.markupOverride / 100) -
              sku.providerCostPerUnitCents) /
              (sku.providerCostPerUnitCents * (1 + sku.markupOverride / 100))) *
              100,
          )
        : undefined,
    status: sku.isActive ? 'active' : 'inactive',
    defaultCreditSource: sku.defaultCreditSource,
    effectiveFrom: sku.effectiveFrom,
    effectiveTo: sku.effectiveTo,
    metadata: sku.metadata,
    createdAt: sku.createdAt,
    updatedAt: sku.updatedAt,
  }));

  const filteredSKUs = skus.filter((sku) => {
    if (filterProvider !== 'all' && sku.provider !== filterProvider) return false;
    if (filterStatus !== 'all' && sku.status !== filterStatus) return false;
    return true;
  });

  const columns = [
    {
      key: 'sku',
      header: 'SKU',
      cell: (row: AISKU) => (
        <div>
          <p className="font-medium">{row.label}</p>
          <code className="text-xs text-muted-foreground">{row.sku}</code>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      cell: (row: AISKU) => <AIProviderBadge provider={row.provider} />,
    },
    {
      key: 'model',
      header: 'Model',
      cell: (row: AISKU) => (
        <div>
          <p className="text-sm">{row.model}</p>
          <p className="text-xs text-muted-foreground">{row.unit}</p>
        </div>
      ),
    },
    {
      key: 'providerCost',
      header: 'Provider Cost',
      cell: (row: AISKU) => `$${(row.providerCost / 100).toFixed(2)}`,
    },
    {
      key: 'creditValue',
      header: 'Credit Value',
      cell: (row: AISKU) => (row.creditValue !== undefined ? row.creditValue : 'Default'),
    },
    {
      key: 'markup',
      header: 'Markup',
      cell: (row: AISKU) =>
        row.markupOverride !== undefined ? `${row.markupOverride}%` : 'Default',
    },
    {
      key: 'computedCredits',
      header: 'Computed Credits',
      cell: (row: AISKU) => row.computedCredits?.toLocaleString() || '-',
    },
    {
      key: 'retailValue',
      header: 'Retail Value',
      cell: (row: AISKU) =>
        row.retailValue !== undefined ? `$${(row.retailValue / 100).toFixed(2)}` : '-',
    },
    {
      key: 'margin',
      header: 'Margin',
      cell: (row: AISKU) =>
        row.margin !== undefined ? <MarginBadge margin={row.margin} /> : '-',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: AISKU) => (
        <span
          className={`px-2 py-1 rounded-full text-xs font-medium ${
            row.status === 'active'
              ? 'bg-green-500/10 text-green-500'
              : 'bg-gray-500/10 text-gray-500'
          }`}
        >
          {row.status}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row: AISKU) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditingSKU(row);
            setIsDialogOpen(true);
          }}
        >
          <Edit className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  const handleSaveSKU = (sku: AISKU) => {
    // TODO: Implement save logic with Convex mutation
    console.log('Saving SKU:', sku);
    setIsDialogOpen(false);
    setEditingSKU(null);
  };

  const providers = ['all', ...Array.from(new Set(skus.map((s) => s.provider)))];
  const statuses = ['all', 'active', 'inactive'];

  return (
    <div className="space-y-6">
      <SectionHeader
        title="AI SKU Catalog"
        description="Manage AI model pricing and credit calculations"
      />

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label>Filter by Provider</Label>
              <Select value={filterProvider} onValueChange={setFilterProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {providers.map((provider) => (
                    <SelectItem key={provider} value={provider}>
                      {provider === 'all' ? 'All Providers' : provider}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 space-y-2">
              <Label>Filter by Status</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue />
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
          </div>
        </CardContent>
      </Card>

      <BillingTable columns={columns} data={filteredSKUs} />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit SKU</DialogTitle>
          </DialogHeader>

          {editingSKU && (
            <SKUEditForm
              sku={editingSKU}
              onSave={handleSaveSKU}
              onCancel={() => {
                setIsDialogOpen(false);
                setEditingSKU(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SKUEditForm({
  sku,
  onSave,
  onCancel,
}: {
  sku: AISKU;
  onSave: (sku: AISKU) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState(sku);

  const computedCredits = formData.creditValue
    ? formData.creditValue * (1 - (formData.markupOverride || 50) / 100)
    : undefined;

  const retailValue = computedCredits
    ? (formData.providerCost * (1 + (formData.markupOverride || 50) / 100))
    : undefined;

  const margin = retailValue && formData.providerCost
    ? ((retailValue - formData.providerCost) / retailValue) * 100
    : undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>SKU</Label>
          <Input value={formData.sku} disabled />
        </div>

        <div className="space-y-2">
          <Label>Label</Label>
          <Input
            value={formData.label}
            onChange={(e) => setFormData({ ...formData, label: e.target.value })}
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Provider</Label>
          <Input value={formData.provider} disabled />
        </div>

        <div className="space-y-2">
          <Label>Model</Label>
          <Input value={formData.model} disabled />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Unit</Label>
        <Input value={formData.unit} disabled />
      </div>

      <MoneyInput
        label="Provider Cost"
        value={formData.providerCost}
        onChange={(value) => setFormData({ ...formData, providerCost: value })}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <CreditInput
          label="Credit Value Override"
          value={formData.creditValue || 0}
          onChange={(value) => setFormData({ ...formData, creditValue: value || undefined })}
        />

        <div className="space-y-2">
          <Label>Markup Override (%)</Label>
          <Input
            type="number"
            value={formData.markupOverride || ''}
            onChange={(e) => setFormData({
              ...formData,
              markupOverride: e.target.value ? parseInt(e.target.value) : undefined,
            })}
            placeholder="Default"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Status</Label>
        <Select
          value={formData.status}
          onValueChange={(value: 'active' | 'inactive' | 'deprecated') =>
            setFormData({ ...formData, status: value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="deprecated">Deprecated</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {computedCredits !== undefined && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Computed Values</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Computed Credits:</span>
              <span className="font-medium">{computedCredits.toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Retail Value:</span>
              <span className="font-medium">${retailValue?.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-muted-foreground">Margin:</span>
              {margin !== undefined ? <MarginBadge margin={margin} /> : '-'}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
