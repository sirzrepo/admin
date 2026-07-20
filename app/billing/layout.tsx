'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CreditCard,
  Settings,
  Package,
  Users,
  FileText,
  History,
  Clock,
  Webhook,
  TrendingUp,
  DollarSign
} from 'lucide-react';
import { cn } from '@/lib/utils';

const billingNavItems = [
  { icon: LayoutDashboard, label: 'Overview', href: '/billing' },
  { icon: TrendingUp, label: 'AI Cost Dashboard', href: '/billing/analytics' },
  { icon: CreditCard, label: 'Plans', href: '/billing/plans' },
  { icon: Settings, label: 'Global Settings', href: '/billing/settings' },
  { icon: Package, label: 'AI SKU Catalog', href: '/billing/skus' },
  { icon: DollarSign, label: 'Top-Up Packages', href: '/billing/topups' },
  { icon: Users, label: 'Customers', href: '/billing/customers' },
  { icon: FileText, label: 'Transactions', href: '/billing/transactions' },
  { icon: History, label: 'Credit Ledger', href: '/billing/ledger' },
  { icon: Clock, label: 'Reservations', href: '/billing/reservations' },
  { icon: Webhook, label: 'Webhooks', href: '/billing/webhooks' },
  { icon: Webhook, label: 'Subscriptions', href: '/billing/subscriptions' },
  { icon: Webhook, label: 'Stripe Checkout Sessions', href: '/billing/stripe-checkout' },
];

export default function BillingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-[calc(100vh-64px)]">
      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </main>

      {/* Billing Sidebar */}
      <aside className="w-64 border-l border-border bg-card p-4">
        <nav className="space-y-1">
          {billingNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </div>
  );
}
