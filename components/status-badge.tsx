import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  variant?: 'default' | 'outline';
}

export function StatusBadge({ status, variant = 'default' }: StatusBadgeProps) {
  const statusConfig: Record<string, { bg: string; text: string; dot: string }> = {
    active: {
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      dot: 'w-2 h-2 bg-green-500 rounded-full',
    },
    inactive: {
      bg: 'bg-gray-500/20',
      text: 'text-gray-400',
      dot: 'w-2 h-2 bg-gray-500 rounded-full',
    },
    pending: {
      bg: 'bg-yellow-500/20',
      text: 'text-yellow-400',
      dot: 'w-2 h-2 bg-yellow-500 rounded-full',
    },
    accepted: {
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      dot: 'w-2 h-2 bg-green-500 rounded-full',
    },
    expired: {
      bg: 'bg-red-500/20',
      text: 'text-red-400',
      dot: 'w-2 h-2 bg-red-500 rounded-full',
    },
    completed: {
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      dot: 'w-2 h-2 bg-green-500 rounded-full',
    },
    processing: {
      bg: 'bg-blue-500/20',
      text: 'text-blue-400',
      dot: 'w-2 h-2 bg-blue-500 rounded-full',
    },
    queued: {
      bg: 'bg-purple-500/20',
      text: 'text-purple-400',
      dot: 'w-2 h-2 bg-purple-500 rounded-full',
    },
    failed: {
      bg: 'bg-red-500/20',
      text: 'text-red-400',
      dot: 'w-2 h-2 bg-red-500 rounded-full',
    },
    running: {
      bg: 'bg-blue-500/20',
      text: 'text-blue-400',
      dot: 'w-2 h-2 bg-blue-500 rounded-full',
    },
    planning: {
      bg: 'bg-gray-500/20',
      text: 'text-gray-400',
      dot: 'w-2 h-2 bg-gray-500 rounded-full',
    },
    success: {
      bg: 'bg-green-500/20',
      text: 'text-green-400',
      dot: 'w-2 h-2 bg-green-500 rounded-full',
    },
    failure: {
      bg: 'bg-red-500/20',
      text: 'text-red-400',
      dot: 'w-2 h-2 bg-red-500 rounded-full',
    },
  };

  const config = statusConfig[status.toLowerCase()] || statusConfig.pending;

  return (
    <div className={cn('inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium', config.bg)}>
      <div className={config.dot} />
      <span className={config.text}>{status}</span>
    </div>
  );
}
