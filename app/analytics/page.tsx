'use client';

import { BarChart3, Users, TrendingUp, Activity } from 'lucide-react';
import { StatCard } from '@/components/stat-card';

export default function AnalyticsPage() {
  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Platform Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Comprehensive analytics and performance metrics
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Users"
          value="2,847"
          trend={{ value: 18, isPositive: true }}
          icon={<Users className="w-8 h-8" />}
        />
        <StatCard
          label="Active Sessions"
          value="384"
          trend={{ value: 5, isPositive: true }}
          icon={<Activity className="w-8 h-8" />}
        />
        <StatCard
          label="Conversion Rate"
          value="12.5%"
          trend={{ value: 2, isPositive: true }}
          icon={<TrendingUp className="w-8 h-8" />}
        />
        <StatCard
          label="Avg. Session"
          value="8m 32s"
          trend={{ value: 12, isPositive: true }}
          icon={<BarChart3 className="w-8 h-8" />}
        />
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Coming Soon</h2>
        <p className="text-muted-foreground">
          Detailed analytics dashboard with real-time data visualization
        </p>
      </div>
    </div>
  );
}
