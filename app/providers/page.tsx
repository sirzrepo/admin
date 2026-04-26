'use client';

import { BarChart3, DollarSign, Zap, TrendingDown } from 'lucide-react';
import { StatCard } from '@/components/stat-card';

export default function ProvidersPage() {
  const providers = [
    { name: 'OpenAI', cost: '$850', tokens: '1.2M', status: 'active' },
    { name: 'Anthropic', cost: '$320', tokens: '950K', status: 'active' },
    { name: 'Google', cost: '$140', tokens: '420K', status: 'active' },
    { name: 'Others', cost: '$45', tokens: '150K', status: 'limited' },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Provider Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Monitor AI provider usage and costs
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Cost"
          value="$1,355"
          trend={{ value: 8, isPositive: false }}
          icon={<DollarSign className="w-8 h-8" />}
        />
        <StatCard
          label="Tokens Used"
          value="2.7M"
          trend={{ value: 15, isPositive: true }}
          icon={<Zap className="w-8 h-8" />}
        />
        <StatCard
          label="Avg Cost/1K"
          value="$0.50"
          trend={{ value: 3, isPositive: false }}
          icon={<TrendingDown className="w-8 h-8" />}
        />
        <StatCard
          label="Active Providers"
          value="4"
          icon={<BarChart3 className="w-8 h-8" />}
        />
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Provider Breakdown</h2>
        <div className="space-y-4">
          {providers.map((provider) => (
            <div
              key={provider.name}
              className="flex items-center justify-between p-4 bg-secondary rounded-lg"
            >
              <div>
                <p className="font-semibold">{provider.name}</p>
                <p className="text-sm text-muted-foreground">{provider.tokens} tokens</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-green-400">{provider.cost}</p>
                <p className="text-sm text-muted-foreground capitalize">{provider.status}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
