'use client';

import { ShoppingCart, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { StatCard } from '@/components/stat-card';

export default function ShopifyMonitorPage() {
  const stores = [
    {
      name: 'TechFlow Pro Store',
      products: '2,847',
      synced: '2,812',
      pending: '35',
      status: 'syncing',
    },
    {
      name: 'GrowthHub Store',
      products: '1,245',
      synced: '1,245',
      pending: '0',
      status: 'synced',
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Shopify Monitoring</h1>
        <p className="text-muted-foreground mt-1">
          Track Shopify store synchronization and product updates
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Products"
          value="4,092"
          icon={<ShoppingCart className="w-8 h-8" />}
        />
        <StatCard
          label="Synced"
          value="4,057"
          trend={{ value: 99, isPositive: true }}
          icon={<CheckCircle2 className="w-8 h-8" />}
        />
        <StatCard
          label="Pending"
          value="35"
          icon={<Clock className="w-8 h-8" />}
        />
        <StatCard
          label="Errors"
          value="0"
          icon={<AlertCircle className="w-8 h-8" />}
        />
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-lg font-semibold text-foreground mb-4">Connected Stores</h2>
        <div className="space-y-4">
          {stores.map((store) => (
            <div
              key={store.name}
              className="p-4 bg-secondary rounded-lg border border-border"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="font-semibold">{store.name}</p>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${
                    store.status === 'synced'
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-blue-500/20 text-blue-400'
                  }`}
                >
                  {store.status}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Total Products</p>
                  <p className="font-semibold">{store.products}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Synced</p>
                  <p className="font-semibold text-green-400">{store.synced}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Pending</p>
                  <p className="font-semibold text-yellow-400">{store.pending}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
