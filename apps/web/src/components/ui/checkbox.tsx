import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { cn } from "@ossmeet/shared";

interface CheckboxProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Checkbox({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  className,
  id,
}: CheckboxProps) {
  return (
    <BaseCheckbox.Root
      id={id}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "flex h-4 w-4 shrink-0 items-center justify-center rounded",
        "border border-neutral-300 bg-white transition-colors",
        "data-[checked]:border-accent-600 data-[checked]:bg-accent-600",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      <BaseCheckbox.Indicator className="data-[unchecked]:hidden text-white">
        <Check className="h-3 w-3" strokeWidth={3} />
      </BaseCheckbox.Indicator>
    </BaseCheckbox.Root>
  );
}
