'use client';

import { Button } from '@/components/ui/button';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StripeLinkProps {
  href: string;
  label?: string;
  className?: string;
  variant?: 'default' | 'ghost' | 'outline' | 'secondary' | 'link' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function StripeLink({
  href,
  label = 'Open in Stripe',
  className,
  variant = 'ghost',
  size = 'sm',
}: StripeLinkProps) {
  return (
    <Button
      variant={variant}
      size={size}
      asChild
      className={cn('text-purple-600 hover:text-purple-700', className)}
    >
      <a href={href} target="_blank" rel="noopener noreferrer">
        <ExternalLink className="w-3 h-3 mr-1" />
        {label}
      </a>
    </Button>
  );
}
