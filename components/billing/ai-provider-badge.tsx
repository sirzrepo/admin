'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface AIProviderBadgeProps {
  provider: string;
  className?: string;
}

export function AIProviderBadge({ provider, className }: AIProviderBadgeProps) {
  const getProviderConfig = () => {
    const p = provider.toLowerCase();
    if (p.includes('openai')) {
      return {
        label: 'OpenAI',
        variant: 'default' as const,
        className: 'bg-green-600',
      };
    }
    if (p.includes('anthropic')) {
      return {
        label: 'Anthropic',
        variant: 'secondary' as const,
        className: 'bg-orange-600',
      };
    }
    if (p.includes('fal')) {
      return {
        label: 'Fal.ai',
        variant: 'outline' as const,
        className: 'border-purple-500 text-purple-500',
      };
    }
    if (p.includes('replicate')) {
      return {
        label: 'Replicate',
        variant: 'outline' as const,
        className: 'border-blue-500 text-blue-500',
      };
    }
    return {
      label: provider,
      variant: 'outline' as const,
      className: '',
    };
  };

  const config = getProviderConfig();

  return (
    <Badge
      variant={config.variant}
      className={cn(config.className, className)}
    >
      {config.label}
    </Badge>
  );
}
