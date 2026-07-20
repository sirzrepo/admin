'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/billing/section-header';
import { BillingTable } from '@/components/billing/billing-table';
import { PlanStatusBadge } from '@/components/billing/plan-status-badge';
import { MoneyInput } from '@/components/billing/money-input';
import { CreditInput } from '@/components/billing/credit-input';
import { FeatureToggleGroup } from '@/components/billing/feature-toggle-group';
import { LimitsEditor } from '@/components/billing/limits-editor';
import { Edit, AlertTriangle, ExternalLink } from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { useToast } from '@/hooks/use-toast';
import { api } from '../../../convex/_generated/api';

interface Plan {
  key: string;
  name: string;
  description?: string;
  priceMonthlyCents: number;
  currency: string;
  includedCredits: number;
  lowCreditThreshold?: number;
  maxBrands: number;
  maxSeats: number;
  stripePriceId?: string;
  features: {
    customAmbassadors?: boolean;
    monthlyRolloverCapMultiplier?: number;
    templateAiCovers?: boolean;
    templateRefreshEnabled?: boolean;
  };
  limits: {
    concurrentAiJobs: number;
    templateLimit: number;
    templateRefreshDays: number;
  };
  isActive?: boolean;
  canSubscribe?: boolean;
}

export default function PlansPage() {
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isCreateMode, setIsCreateMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const billingResult = useQuery(api.billingAdmin.adminGetBillingPlans);
  const plans = billingResult?.plans ?? [];
  const createPlan = useMutation(api.billingAdmin.adminCreateBillingPlan);
  const updatePlan = useMutation(api.billingAdmin.adminUpdateBillingPlan);

  console.log("billingResult", billingResult);

  const columns = [
    {
      key: 'plan',
      header: 'Plan',
      cell: (row: Plan) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-sm text-muted-foreground">{row.key}</p>
        </div>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      cell: (row: Plan) => `$${(row.priceMonthlyCents / 100).toFixed(2)}/mo`,
    },
    {
      key: 'credits',
      header: 'Monthly Credits',
      cell: (row: Plan) => row.includedCredits.toLocaleString(),
    },
    {
      key: 'stripePriceId',
      header: 'Stripe Price ID',
      cell: (row: Plan) => (
        <div className="flex items-center gap-2">
          {row.stripePriceId ? (
            <>
              <code className="text-xs bg-muted px-1 rounded">{row.stripePriceId}</code>
              <ExternalLink className="w-3 h-3 text-muted-foreground" />
            </>
          ) : (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="w-3 h-3" />
              Missing
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row: Plan) => (
        <PlanStatusBadge isActive={row.isActive ?? false} hasSubscribers={false} />
      ),
    },
    {
      key: 'canSubscribe',
      header: 'Can Subscribe',
      cell: (row: Plan) => (
        row.canSubscribe ? 'Yes' : 'No'
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      cell: (row: Plan) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditingPlan(row);
            setIsCreateMode(false);
            setIsDialogOpen(true);
          }}
        >
          <Edit className="w-4 h-4" />
        </Button>
      ),
    },
  ];

  const handleSavePlan = async (plan: Plan) => {
    setIsSaving(true);
    try {
      if (!isCreateMode) {
        await updatePlan({
          key: plan.key,
          name: plan.name,
          description: plan.description || '',
          priceMonthlyCents: plan.priceMonthlyCents,
          currency: plan.currency || 'USD',
          includedCredits: plan.includedCredits,
          lowCreditThreshold: plan.lowCreditThreshold ?? 0,
          maxBrands: plan.maxBrands,
          maxSeats: plan.maxSeats,
          stripePriceId: plan.stripePriceId || undefined,
          isActive: plan.isActive ?? false,
          features: plan.features,
          limits: plan.limits,
        });

        toast({
          title: 'Plan updated',
          description: 'The billing plan was updated successfully.',
        });
      } else {
        await createPlan({
          key: plan.key.trim(),
          name: plan.name,
          description: plan.description || '',
          priceMonthlyCents: plan.priceMonthlyCents,
          currency: plan.currency || 'USD',
          includedCredits: plan.includedCredits,
          lowCreditThreshold: plan.lowCreditThreshold ?? 0,
          maxBrands: plan.maxBrands,
          maxSeats: plan.maxSeats,
          stripePriceId: plan.stripePriceId || undefined,
          isActive: plan.isActive ?? false,
          features: plan.features,
          limits: plan.limits,
        });

        toast({
          title: 'Plan created',
          description: 'The billing plan was created successfully.',
        });
      }

      setIsDialogOpen(false);
      setEditingPlan(null);
      setIsCreateMode(false);
    } catch (error) {
      toast({
        title: 'Error saving plan',
        description: error instanceof Error ? error.message : 'Unable to save plan.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Billing Plans"
        description="Manage subscription plans and pricing"
        action={{
          label: 'Create Plan',
          onClick: () => {
            setEditingPlan(null);
            setIsCreateMode(true);
            setIsDialogOpen(true);
          },
        }}
      />

      <BillingTable columns={columns} data={plans} />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isCreateMode ? 'Create Billing Plan' : 'Update Billing Plan'}
            </DialogTitle>
          </DialogHeader>

          <PlanEditForm
            plan={editingPlan ?? {
              key: '',
              name: '',
              description: '',
              priceMonthlyCents: 0,
              currency: 'USD',
              includedCredits: 0,
              lowCreditThreshold: 0,
              maxBrands: 0,
              maxSeats: 0,
              stripePriceId: undefined,
              features: {
                customAmbassadors: false,
                monthlyRolloverCapMultiplier: 2,
                templateAiCovers: false,
                templateRefreshEnabled: false,
              },
              limits: {
                concurrentAiJobs: 0,
                templateLimit: 0,
                templateRefreshDays: 0,
              },
              isActive: false,
              canSubscribe: false,
            }}
            isCreateMode={isCreateMode}
            onSave={handleSavePlan}
            onCancel={() => {
              setIsDialogOpen(false);
              setEditingPlan(null);
              setIsCreateMode(false);
            }}
            isSaving={isSaving}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlanEditForm({
  plan,
  isCreateMode,
  onSave,
  onCancel,
  isSaving,
}: {
  plan: Plan;
  isCreateMode: boolean;
  onSave: (plan: Plan) => void;
  onCancel: () => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState(plan);

  useEffect(() => {
    setFormData(plan);
  }, [plan]);

  const features = [
    { id: 'ai-covers', label: 'AI Covers', enabled: formData.features.templateAiCovers ?? false },
    { id: 'custom-ambassadors', label: 'Custom Ambassadors', enabled: formData.features.customAmbassadors ?? false },
    { id: 'template-refresh', label: 'Template Refresh', enabled: formData.features.templateRefreshEnabled ?? false },
    { id: 'monthly-rollover', label: 'Monthly Rollover', enabled: formData.features.monthlyRolloverCapMultiplier !== undefined },
    { id: 'priority-support', label: 'Priority Support', enabled: false },
  ];

  const limits = [
    { id: 'concurrentAiJobs', label: 'Concurrent AI Jobs', value: formData.limits?.concurrentAiJobs },
    { id: 'templateLimit', label: 'Template Limit', value: formData.limits?.templateLimit },
    { id: 'refreshDays', label: 'Refresh Days', value: formData.limits?.templateRefreshDays },
    { id: 'seats', label: 'Seats', value: formData.maxSeats },
    { id: 'brands', label: 'Brands', value: formData.maxBrands },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Plan Key</Label>
          <Input
            value={formData.key}
            onChange={(e) => setFormData({ ...formData, key: e.target.value })}
            disabled={!isCreateMode && Boolean(plan.key)}
          />
          <p className="text-xs text-muted-foreground">
            {plan.key ? 'Cannot be changed after creation' : 'Unique identifier for the plan'}
          </p>
        </div>

        <div className="space-y-2">
          <Label>Plan Name</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Input
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Plan description"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <MoneyInput
          label="Monthly Price"
          value={formData.priceMonthlyCents}
          onChange={(value) => setFormData({ ...formData, priceMonthlyCents: value })}
        />

        <CreditInput
          label="Included Credits"
          value={formData.includedCredits}
          onChange={(value) => setFormData({ ...formData, includedCredits: value })}
        />
      </div>

      <CreditInput
        label="Low Credit Threshold"
        value={formData.lowCreditThreshold || 0}
        onChange={(value) => setFormData({ ...formData, lowCreditThreshold: value })}
      />

      <div className="space-y-2">
        <Label>Stripe Price ID</Label>
        <Input
          value={formData.stripePriceId || ''}
          onChange={(e) => setFormData({ ...formData, stripePriceId: e.target.value })}
          placeholder="price_..."
        />
        {!formData.stripePriceId && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            Warning: Missing Stripe Price ID
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label>Features</Label>
        <FeatureToggleGroup
          features={features}
          onChange={(updated) => {
            setFormData({
              ...formData,
              features: {
                customAmbassadors:
                  updated.find(f => f.label === "customAmbassadors")?.enabled ?? false,

                templateAiCovers:
                  updated.find(f => f.label === "templateAiCovers")?.enabled ?? false,

                templateRefreshEnabled:
                  updated.find(f => f.label === "templateRefreshEnabled")?.enabled ?? false,

                monthlyRolloverCapMultiplier:
                  formData.features.monthlyRolloverCapMultiplier ?? 2,
              },
            });
          }}
        />
      </div>

      <div className="space-y-2">
        <Label>Limits</Label>
        <LimitsEditor
          limits={limits}
          onChange={(updated) => {
            const newLimits: any = {};
            updated.forEach((l) => {
              if (l.value !== undefined) {
                newLimits[l.id] = l.value;
              }
            });
            setFormData({ ...formData, limits: newLimits });
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isActive"
          checked={formData.isActive}
          onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
        />
        <Label htmlFor="isActive">Active</Label>
        {!formData.canSubscribe && !formData.isActive && (
          <Badge variant="destructive" className="ml-2">
            Cannot Subscribe
          </Badge>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={() => onSave(formData)} disabled={isSaving}>
          {isCreateMode ? 'Create Plan' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
