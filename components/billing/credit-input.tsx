'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface CreditInputProps {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  min?: number;
}

export function CreditInput({
  value,
  onChange,
  label,
  className,
  disabled,
  placeholder = '0',
  min = 0,
}: CreditInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const numValue = parseInt(e.target.value, 10);
    if (!isNaN(numValue) && numValue >= min) {
      onChange(numValue);
    } else {
      onChange(min);
    }
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && <Label>{label}</Label>}
      <Input
        type="number"
        step="1"
        min={min}
        value={value}
        onChange={handleChange}
        disabled={disabled}
        placeholder={placeholder}
      />
    </div>
  );
}
