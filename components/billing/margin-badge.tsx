'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface MarginBadgeProps {
  margin: number; // percentage
  className?: string;
}

export function MarginBadge({ margin, className }: MarginBadgeProps) {
  const getVariant = () => {
    if (margin >= 50) return 'default';
    if (margin >= 30) return 'secondary';
    if (margin >= 10) return 'outline';
    return 'destructive';
  };

  const getColor = () => {
    if (margin >= 50) return 'text-green-500';
    if (margin >= 30) return 'text-blue-500';
    if (margin >= 10) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <Badge
      variant={getVariant()}
      className={cn('font-mono', getColor(), className)}
    >
      {margin.toFixed(1)}%
    </Badge>
  );
}
