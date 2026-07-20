'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Feature {
  id: string;
  label: string;
  enabled: boolean;
}

interface FeatureToggleGroupProps {
  features: Feature[];
  onChange: (features: Feature[]) => void;
  className?: string;
}

export function FeatureToggleGroup({
  features,
  onChange,
  className,
}: FeatureToggleGroupProps) {
  const handleToggle = (featureId: string) => {
    const updated = features.map((f) =>
      f.id === featureId ? { ...f, enabled: !f.enabled } : f
    );
    onChange(updated);
  };

  return (
    <div className={cn('space-y-3', className)}>
      {features.map((feature) => (
        <div key={feature.id} className="flex items-center space-x-2">
          <Checkbox
            id={feature.id}
            checked={feature.enabled}
            onCheckedChange={() => handleToggle(feature.id)}
          />
          <Label
            htmlFor={feature.id}
            className="cursor-pointer flex-1"
          >
            {feature.label}
          </Label>
        </div>
      ))}
    </div>
  );
}
