'use client';

import { Badge } from '@/components/ui/badge';
import { Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CreditBadgeProps {
  credits: number;
  className?: string;
  variant?: 'default' | 'outline' | 'secondary';
}

export function CreditBadge({
  credits,
  className,
  variant = 'outline',
}: CreditBadgeProps) {
  const formatCredits = (value: number) => {
    if (value >= 1000000) {
      return `${(value / 1000000).toFixed(1)}M`;
    }
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)}K`;
    }
    return value.toString();
  };

  return (
    <Badge variant={variant} className={cn('gap-1', className)}>
      <Coins className="w-3 h-3" />
      {formatCredits(credits)}
    </Badge>
  );
}
