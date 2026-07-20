'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface MoneyInputProps {
  value: number; // in cents
  onChange: (value: number) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}

export function MoneyInput({
  value,
  onChange,
  label,
  className,
  disabled,
  placeholder = '0.00',
}: MoneyInputProps) {
  const displayValue = (value / 100).toFixed(2);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numValue = parseFloat(e.target.value);
    if (!isNaN(numValue)) {
      onChange(Math.round(numValue * 100));
    } else {
      onChange(0);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && <Label>{label}</Label>}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
          $
        </span>
        <Input
          type="number"
          step="0.01"
          min="0"
          value={displayValue}
          onChange={handleChange}
          disabled={disabled}
          placeholder={placeholder}
          className="pl-7"
        />
      </div>
    </div>
  );
}
