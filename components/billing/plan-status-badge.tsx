'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface PlanStatusBadgeProps {
  isActive: boolean;
  hasSubscribers?: boolean;
  className?: string;
}

export function PlanStatusBadge({
  isActive,
  hasSubscribers = false,
  className,
}: PlanStatusBadgeProps) {
  if (!isActive) {
    return (
      <Badge variant="secondary" className={cn('bg-gray-500', className)}>
        Inactive
      </Badge>
    );
  }

  if (hasSubscribers) {
    return (
      <Badge variant="default" className={cn('bg-green-600', className)}>
        Active
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className={cn('border-green-500 text-green-500', className)}>
      Active
    </Badge>
  );
}
