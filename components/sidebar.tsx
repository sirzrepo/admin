'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Briefcase,
  Users,
  Zap,
  LineChart,
  Settings,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Layers,
  Activity,
  ShoppingCart,
  BookOpen,
  LayoutTemplate,
  ListIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { icon: BarChart3, label: 'Overview', href: '/' },
  { icon: Briefcase, label: 'Brands', href: '/brands' },
  { icon: Users, label: 'Ambassadors', href: '/ambassadors' },
  { icon: ListIcon, label: 'Products', href: '/products' },
  { icon: Layers, label: 'Campaign Kits', href: '/campaigns' },
  { icon: LayoutTemplate, label: 'Campaign Templates', href: '/campaign-templates' },
  { icon: LayoutTemplate, label: 'Brand Campaigns', href: '/brand-campaigns' },
  { icon: Zap, label: 'AI Generation', href: '/generation' },
  { icon: LineChart, label: 'Provider Analytics', href: '/providers' },
  { icon: ShoppingCart, label: 'Shopify Monitor', href: '/shopify' },
  { icon: Activity, label: 'Platform Analytics', href: '/analytics' },
  { icon: BookOpen, label: 'Audit Logs', href: '/audit' },
  { icon: Users, label: 'Team Members', href: '/teams' },
  { icon: Settings, label: 'Settings', href: '/settings' },
];

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 flex flex-col z-40',
        collapsed ? 'w-20' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
        <div className={cn('flex items-center gap-2', collapsed && 'justify-center w-full')}>
          {!collapsed && (
            <>
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
                <Zap className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-bold text-sidebar-foreground text-lg">SIRz</span>
            </>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-5 h-5 text-primary-foreground" />
            </div>
          )}
        </div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 hover:bg-sidebar-accent rounded-lg transition-colors"
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4 text-sidebar-foreground" />
          ) : (
            <ChevronLeft className="w-4 h-4 text-sidebar-foreground" />
          )}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg transition-colors group',
                isActive
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent'
              )}
              title={collapsed ? item.label : ''}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-sidebar-border px-2 py-4 space-y-2">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
          <LogOut className="w-5 h-5 flex-shrink-0" />
          {!collapsed && <span className="text-sm font-medium">Logout</span>}
        </button>
      </div>
    </aside>
  );
}
