'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type WebhookStatus = 'pending' | 'processed' | 'failed';

interface WebhookStatusBadgeProps {
  status: WebhookStatus;
  className?: string;
}

export function WebhookStatusBadge({ status, className }: WebhookStatusBadgeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case 'processed':
        return {
          label: 'Processed',
          variant: 'default' as const,
          className: 'bg-green-600',
        };
      case 'failed':
        return {
          label: 'Failed',
          variant: 'destructive' as const,
          className: 'bg-red-600',
        };
      case 'pending':
      default:
        return {
          label: 'Pending',
          variant: 'secondary' as const,
          className: 'bg-yellow-600',
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
