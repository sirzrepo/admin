'use client';

import {
  BarChart3,
  Briefcase,
  Users,
  Zap,
  TrendingUp,
  Activity,
} from 'lucide-react';
import { StatCard } from '@/components/stat-card';
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartTooltip,
} from '@/components/ui/chart';
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { mockAnalytics } from '@/lib/mock-data';

export default function OverviewPage() {
  const chartConfig = {
    campaigns: {
      label: 'Campaigns',
      color: '#3b82f6',
    },
    completions: {
      label: 'Completions',
      color: '#10b981',
    },
    failed: {
      label: 'Failed',
      color: '#ef4444',
    },
  } satisfies ChartConfig;

  const providerChartConfig = {
    value: {
      label: 'Cost Share',
      color: '#3b82f6',
    },
  } satisfies ChartConfig;

  return (
    <div className="space-y-6 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Overview</h1>
        <p className="text-muted-foreground mt-1">
          Real-time metrics and insights for your AI generation platform
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Campaigns"
          value={mockAnalytics.overview.totalCampaigns}
          trend={{ value: 8, isPositive: true }}
          icon={<Briefcase className="w-8 h-8" />}
          description="Active this month"
        />
        <StatCard
          label="Active Ambassadors"
          value={mockAnalytics.overview.totalAmbassadors}
          trend={{ value: 12, isPositive: true }}
          icon={<Users className="w-8 h-8" />}
          description="Across all brands"
        />
        <StatCard
          label="AI Generations"
          value={mockAnalytics.overview.aiGenerations}
          trend={{ value: 24, isPositive: true }}
          icon={<Zap className="w-8 h-8" />}
          description="This month"
        />
        <StatCard
          label="Total Revenue"
          value={mockAnalytics.overview.totalRevenue}
          trend={{ value: 5, isPositive: true }}
          icon={<TrendingUp className="w-8 h-8" />}
          description="Year to date"
        />
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Campaign Activity Chart */}
        <div className="lg:col-span-2 bg-card border border-border rounded-lg p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground">Campaign Activity</h2>
            <p className="text-sm text-muted-foreground mt-1">Weekly generation metrics</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={mockAnalytics.campaignActivity}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis dataKey="date" stroke="rgba(255,255,255,0.5)" />
              <YAxis stroke="rgba(255,255,255,0.5)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'rgba(10, 10, 10, 0.9)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="campaigns"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={{ fill: '#3b82f6', r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="completions"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ fill: '#10b981', r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="failed"
                stroke="#ef4444"
                strokeWidth={2}
                dot={{ fill: '#ef4444', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Provider Distribution */}
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-foreground">Provider Costs</h2>
            <p className="text-sm text-muted-foreground mt-1">Distribution by provider</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={mockAnalytics.providerCosts}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={({ name, percentage }) => `${name} ${percentage}%`}
                outerRadius={80}
                fill="#8884d8"
                dataKey="value"
              >
                {mockAnalytics.providerCosts.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={chartColors[index % chartColors.length]} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Generation Volume Chart */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-foreground">Generation Volume by Type</h2>
          <p className="text-sm text-muted-foreground mt-1">Total items generated this month</p>
        </div>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={mockAnalytics.generationVolume}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis dataKey="type" stroke="rgba(255,255,255,0.5)" />
            <YAxis stroke="rgba(255,255,255,0.5)" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'rgba(10, 10, 10, 0.9)',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
              }}
            />
            <Bar dataKey="count" fill="#3b82f6" radius={[8, 8, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Token Usage and Cost */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Token Usage</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-muted-foreground">Total Tokens Used</span>
                <span className="font-semibold text-foreground">
                  {mockAnalytics.overview.tokensUsed}
                </span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full"
                  style={{ width: '72%' }}
                />
              </div>
            </div>
            <div className="pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Cost per 1K tokens: ${mockAnalytics.overview.costPerThousandTokens}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Quick Stats</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <span className="text-sm text-muted-foreground">Monthly Growth</span>
              <span className="text-lg font-semibold text-green-500">
                {mockAnalytics.overview.monthlyGrowth}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Active Campaigns</span>
              <span className="font-semibold text-foreground">
                {mockAnalytics.overview.activeCampaigns}/{mockAnalytics.overview.totalCampaigns}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const chartColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444'];
