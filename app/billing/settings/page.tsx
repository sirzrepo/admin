'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SectionHeader } from '@/components/billing/section-header';
import { CreditInput } from '@/components/billing/credit-input';
import { Calculator, TrendingUp } from 'lucide-react';
import { useMutation, useQuery } from 'convex/react';
import { useToast } from '@/hooks/use-toast';
import { api } from '../../../convex/_generated/api';

type BillingInvoicePolicy = 'receipt_only' | 'always' | 'on_request';

interface BillingSettings {
  key: string;
  trialDurationDays: number;
  trialCredits: number;
  trialLowCreditThreshold: number;
  trialTemplateLimit: number;
  trialTemplateRefreshEnabled: boolean;
  trialTemplateRefreshDays: number;
  trialTemplateAiCovers: boolean;
  templateBasePoolEvergreenTarget: number;
  templateBasePoolSeasonalEvergreenTarget: number;
  templateBasePoolSeasonalEventTarget: number;
  creditPurchaseInvoicePolicy: BillingInvoicePolicy;
  requirePaymentMethodForTrial: boolean;
  allowTopUpsDuringTrial: boolean;
  oneTrialPerAccount: boolean;
  defaultCreditValueCents: number;
  defaultMarkup: number;
  isActive: boolean;
}

const DEFAULT_SETTINGS: BillingSettings = {
  key: 'global',
  trialDurationDays: 14,
  trialCredits: 5000,
  trialLowCreditThreshold: 10,
  trialTemplateLimit: 0,
  trialTemplateRefreshEnabled: false,
  trialTemplateRefreshDays: 0,
  trialTemplateAiCovers: false,
  templateBasePoolEvergreenTarget: 0,
  templateBasePoolSeasonalEvergreenTarget: 0,
  templateBasePoolSeasonalEventTarget: 0,
  creditPurchaseInvoicePolicy: 'receipt_only',
  requirePaymentMethodForTrial: false,
  allowTopUpsDuringTrial: false,
  oneTrialPerAccount: true,
  defaultCreditValueCents: 10,
  defaultMarkup: 1,
  isActive: true,
};

export default function BillingSettingsPage() {
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_SETTINGS);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const billingResult = useQuery(api.billingAdmin.adminGetBillingSettings);
  const updateBillingSettings = useMutation(api.billingAdmin.adminUpdateBillingSettings);
  const activeSettings = billingResult?.active;

  useEffect(() => {
    if (activeSettings) {
      setSettings({
        key: activeSettings.key,
        trialDurationDays: activeSettings.trialDurationDays,
        trialCredits: activeSettings.trialCredits,
        trialLowCreditThreshold: activeSettings.trialLowCreditThreshold ?? 0,
        trialTemplateLimit: activeSettings.trialTemplateLimit ?? 0,
        trialTemplateRefreshEnabled: activeSettings.trialTemplateRefreshEnabled ?? false,
        trialTemplateRefreshDays: activeSettings.trialTemplateRefreshDays ?? 0,
        trialTemplateAiCovers: activeSettings.trialTemplateAiCovers ?? false,
        templateBasePoolEvergreenTarget: activeSettings.templateBasePoolEvergreenTarget ?? 0,
        templateBasePoolSeasonalEvergreenTarget: activeSettings.templateBasePoolSeasonalEvergreenTarget ?? 0,
        templateBasePoolSeasonalEventTarget: activeSettings.templateBasePoolSeasonalEventTarget ?? 0,
        creditPurchaseInvoicePolicy: activeSettings.creditPurchaseInvoicePolicy ?? 'receipt_only',
        requirePaymentMethodForTrial: activeSettings.requirePaymentMethodForTrial,
        allowTopUpsDuringTrial: activeSettings.allowTopUpsDuringTrial,
        oneTrialPerAccount: activeSettings.oneTrialPerAccount,
        defaultCreditValueCents: activeSettings.defaultCreditValueCents,
        defaultMarkup: activeSettings.defaultMarkup,
        isActive: activeSettings.isActive,
      });
    }
  }, [activeSettings]);

  const computedValues = {
    currentCreditValue: settings.defaultCreditValueCents,
    suggestedCreditsPerDollar:
      settings.defaultCreditValueCents > 0
        ? Math.floor(100 / settings.defaultCreditValueCents)
        : 0,
    currentMarkup: settings.defaultMarkup,
    estimatedGrossMargin:
      settings.defaultMarkup > 0
        ? Math.round((1 - 1 / settings.defaultMarkup) * 100)
        : 0,
  };

  const handleSave = async () => {
    if (!activeSettings) {
      toast({
        title: 'Unable to save settings',
        description: 'Billing settings are not loaded yet.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);

    try {
      await updateBillingSettings({
        key: settings.key,
        trialDurationDays: settings.trialDurationDays,
        trialCredits: settings.trialCredits,
        trialLowCreditThreshold: settings.trialLowCreditThreshold,
        trialTemplateLimit: settings.trialTemplateLimit,
        trialTemplateRefreshEnabled: settings.trialTemplateRefreshEnabled,
        trialTemplateRefreshDays: settings.trialTemplateRefreshDays,
        trialTemplateAiCovers: settings.trialTemplateAiCovers,
        templateBasePoolEvergreenTarget: settings.templateBasePoolEvergreenTarget,
        templateBasePoolSeasonalEvergreenTarget: settings.templateBasePoolSeasonalEvergreenTarget,
        templateBasePoolSeasonalEventTarget: settings.templateBasePoolSeasonalEventTarget,
        creditPurchaseInvoicePolicy: settings.creditPurchaseInvoicePolicy,
        requirePaymentMethodForTrial: settings.requirePaymentMethodForTrial,
        allowTopUpsDuringTrial: settings.allowTopUpsDuringTrial,
        oneTrialPerAccount: settings.oneTrialPerAccount,
        defaultCreditValueCents: settings.defaultCreditValueCents,
        defaultMarkup: settings.defaultMarkup,
        isActive: settings.isActive,
      });

      toast({
        title: 'Billing settings updated',
        description: 'The billing settings were saved successfully.',
      });
    } catch (error) {
      toast({
        title: 'Error saving settings',
        description: error instanceof Error ? error.message : 'Unable to save settings.',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Global Billing Settings"
        description="Configure global billing behavior and pricing policies"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Main Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Trial Settings</CardTitle>
            <CardDescription>Configure trial behavior for new users</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Trial Duration (Days)</Label>
              <Input
                type="number"
                value={settings.trialDurationDays}
                onChange={(e) => setSettings({ ...settings, trialDurationDays: parseInt(e.target.value) })}
              />
            </div>

            <CreditInput
              label="Trial Credits"
              value={settings.trialCredits}
              onChange={(value) => setSettings({ ...settings, trialCredits: value })}
            />

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Allow Top-ups During Trial</Label>
                <p className="text-xs text-muted-foreground">
                  Users can purchase additional credits while on trial
                </p>
              </div>
              <Switch
                checked={settings.allowTopUpsDuringTrial}
                onCheckedChange={(checked) => setSettings({ ...settings, allowTopUpsDuringTrial: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Require Payment Method</Label>
                <p className="text-xs text-muted-foreground">
                  Require payment method before trial starts
                </p>
              </div>
              <Switch
                checked={settings.requirePaymentMethod}
                onCheckedChange={(checked) => setSettings({ ...settings, requirePaymentMethod: checked })}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>One Trial Per Account</Label>
                <p className="text-xs text-muted-foreground">
                  Prevent users from starting multiple trials
                </p>
              </div>
              <Switch
                checked={settings.oneTrialPerAccount}
                onCheckedChange={(checked) => setSettings({ ...settings, oneTrialPerAccount: checked })}
              />
            </div>
          </CardContent>
        </Card>

        {/* Credit Pricing */}
        <Card>
          <CardHeader>
            <CardTitle>Credit Pricing</CardTitle>
            <CardDescription>Configure default credit price and invoice policy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <CreditInput
              label="Default Credit Price (Cents per Credit)"
              value={settings.defaultCreditValueCents}
              onChange={(value) => setSettings({ ...settings, defaultCreditValueCents: value })}
            />

            <div className="space-y-2">
              <Label>Markup (%)</Label>
              <Input
                type="number"
                value={settings.defaultMarkup}
                onChange={(e) => setSettings({ ...settings, defaultMarkup: Number(e.target.value) || 1 })}
                min="1"
                max="200"
              />
              <p className="text-xs text-muted-foreground">
                Percentage markup applied to provider cost when calculating credits
              </p>
            </div>

            <CreditInput
              label="Trial Low Credit Threshold"
              value={settings.trialLowCreditThreshold}
              onChange={(value) => setSettings({ ...settings, trialLowCreditThreshold: value })}
            />

            <div className="space-y-2">
              <Label>Credit Purchase Invoice Policy</Label>
              <Select
                value={settings.creditPurchaseInvoicePolicy}
                onValueChange={(value: BillingInvoicePolicy) => setSettings({ ...settings, creditPurchaseInvoicePolicy: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="receipt_only">Receipt only</SelectItem>
                  <SelectItem value="always">Always issue invoice</SelectItem>
                  <SelectItem value="on_request">Issue invoice on request</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Template Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Template Pool Settings</CardTitle>
            <CardDescription>Configure template generation targets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Evergreen Targets</Label>
              <Input
                type="number"
                value={settings.templateBasePoolEvergreenTarget}
                onChange={(e) => setSettings({
                  ...settings,
                  templateBasePoolEvergreenTarget: Number(e.target.value) || 0,
                })}
              />
              <p className="text-xs text-muted-foreground">
                Number of evergreen templates to maintain per brand
              </p>
            </div>

            <div className="space-y-2">
              <Label>Seasonal Targets</Label>
              <Input
                type="number"
                value={settings.templateBasePoolSeasonalEvergreenTarget}
                onChange={(e) => setSettings({
                  ...settings,
                  templateBasePoolSeasonalEvergreenTarget: Number(e.target.value) || 0,
                })}
              />
              <p className="text-xs text-muted-foreground">
                Number of seasonal templates to maintain per brand
              </p>
            </div>

            <div className="space-y-2">
              <Label>Event Targets</Label>
              <Input
                type="number"
                value={settings.templateBasePoolSeasonalEventTarget}
                onChange={(e) => setSettings({
                  ...settings,
                  templateBasePoolSeasonalEventTarget: Number(e.target.value) || 0,
                })}
              />
              <p className="text-xs text-muted-foreground">
                Number of event templates to maintain per brand
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Template Refresh Settings</CardTitle>
            <CardDescription>Configure automatic template refresh</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>Enable Template Refresh</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically refresh templates periodically
                </p>
              </div>
              <Switch
                checked={settings.trialTemplateRefreshEnabled}
                onCheckedChange={(checked) => setSettings({ ...settings, trialTemplateRefreshEnabled: checked })}
              />
            </div>

            {settings.trialTemplateRefreshEnabled && (
              <div className="space-y-2">
                <Label>Refresh Frequency (Days)</Label>
                <Input
                  type="number"
                  value={settings.trialTemplateRefreshDays}
                  onChange={(e) => setSettings({ ...settings, trialTemplateRefreshDays: Number(e.target.value) || 0 })}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Computed Values */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="w-5 h-5" />
            Computed Values
          </CardTitle>
          <CardDescription>
            Real-time calculations based on current settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Current Credit Value</p>
              <p className="text-2xl font-bold">{computedValues.currentCreditValue} credits/$</p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Suggested Credits per Dollar</p>
              <p className="text-2xl font-bold">{computedValues.suggestedCreditsPerDollar.toFixed(0)} credits/$</p>
              <p className="text-xs text-muted-foreground">
                After {computedValues.currentMargin}% markup
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Estimated Gross Margin</p>
              <p className="text-2xl font-bold flex items-center gap-2">
                {computedValues.estimatedGrossMargin}%
                <TrendingUp className="w-5 h-5 text-green-500" />
              </p>
              <p className="text-xs text-muted-foreground">
                After platform costs
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} size="lg">
          Save Settings
        </Button>
      </div>
    </div>
  );
}
