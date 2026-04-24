import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { cn } from "@ossmeet/shared";

interface SwitchProps {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
  id?: string;
  className?: string;
  size?: "sm" | "md";
}

const rootSizes = {
  sm: "h-4 w-7",
  md: "h-5 w-9",
};

const thumbSizes = {
  sm: "h-3 w-3 data-[checked]:translate-x-3",
  md: "h-3.5 w-3.5 data-[checked]:translate-x-4",
};

export function Switch({
  checked,
  defaultChecked,
  onCheckedChange,
  disabled,
  name,
  id,
  className,
  size = "md",
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      id={id}
      name={name}
      checked={checked}
      defaultChecked={defaultChecked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent p-0.5 transition-colors duration-150",
        "bg-neutral-200 data-[checked]:bg-accent-600",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-1",
        "disabled:cursor-not-allowed disabled:opacity-50",
        rootSizes[size],
        className
      )}
    >
      <BaseSwitch.Thumb
        className={cn(
          "pointer-events-none block rounded-full bg-white shadow-sm transition-transform duration-150",
          thumbSizes[size]
        )}
      />
    </BaseSwitch.Root>
  );
}
