'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Limit {
  id: string;
  label: string;
  value: number | undefined;
}

interface LimitsEditorProps {
  limits: Limit[];
  onChange: (limits: Limit[]) => void;
  className?: string;
}

export function LimitsEditor({ limits, onChange, className }: LimitsEditorProps) {
  const handleChange = (limitId: string, value: string) => {
    const numValue = value === '' ? undefined : parseInt(value, 10);
    const updated = limits.map((l) =>
      l.id === limitId ? { ...l, value: numValue } : l
    );
    onChange(updated);
  };

  return (
    <div className={cn('space-y-4', className)}>
      {limits.map((limit) => (
        <div key={limit.id} className="space-y-2">
          <Label htmlFor={limit.id}>{limit.label}</Label>
          <Input
            id={limit.id}
            type="number"
            min="0"
            value={limit.value ?? ''}
            onChange={(e) => handleChange(limit.id, e.target.value)}
            placeholder="Unlimited"
          />
        </div>
      ))}
    </div>
  );
}
