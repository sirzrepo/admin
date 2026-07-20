'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type SubscriptionStatus =
  | 'active'
  | 'trialing'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete';

interface SubscriptionStatusBadgeProps {
  status: SubscriptionStatus;
  className?: string;
}

export function SubscriptionStatusBadge({
  status,
  className,
}: SubscriptionStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'active':
        return {
          label: 'Active',
          variant: 'default' as const,
          className: 'bg-green-600',
        };
      case 'trialing':
        return {
          label: 'Trial',
          variant: 'secondary' as const,
          className: 'bg-blue-600',
        };
      case 'past_due':
        return {
          label: 'Past Due',
          variant: 'destructive' as const,
          className: 'bg-orange-600',
        };
      case 'canceled':
        return {
          label: 'Canceled',
          variant: 'outline' as const,
          className: 'border-gray-500 text-gray-500',
        };
      case 'unpaid':
        return {
          label: 'Unpaid',
          variant: 'destructive' as const,
          className: 'bg-red-600',
        };
      case 'incomplete':
        return {
          label: 'Incomplete',
          variant: 'outline' as const,
          className: 'border-yellow-500 text-yellow-500',
        };
      default:
        return {
          label: status,
          variant: 'outline' as const,
          className: '',
        };
    }
  };

  const config = getStatusConfig();

  return (
    <Badge
      variant={config.variant}
      className={cn(config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
