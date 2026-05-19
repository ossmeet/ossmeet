import { Slider as BaseSlider } from "@base-ui/react/slider";
import { cn } from "@ossmeet/shared";

interface SliderProps {
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  onValueCommitted?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  name?: string;
  label?: string;
  "aria-label"?: string;
  className?: string;
  orientation?: "horizontal" | "vertical";
}

export function Slider({
  value,
  defaultValue,
  onValueChange,
  onValueCommitted,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  name,
  label,
  "aria-label": ariaLabel,
  className,
  orientation = "horizontal",
}: SliderProps) {
  return (
    <BaseSlider.Root
      name={name}
      value={value}
      defaultValue={defaultValue}
      onValueChange={
        onValueChange
          ? (v) => onValueChange(Array.isArray(v) ? v[0] : v)
          : undefined
      }
      onValueCommitted={
        onValueCommitted
          ? (v) => onValueCommitted(Array.isArray(v) ? v[0] : v)
          : undefined
      }
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      orientation={orientation}
      className={cn("flex w-full flex-col gap-1", className)}
    >
      {label && (
        <BaseSlider.Label className="text-sm font-medium text-neutral-700">
          {label}
        </BaseSlider.Label>
      )}
      <BaseSlider.Control
        className={cn(
          "flex touch-none select-none items-center",
          orientation === "vertical" ? "h-32 flex-col px-3" : "w-full py-3"
        )}
      >
        <BaseSlider.Track
          className={cn(
            "relative rounded-full bg-neutral-200",
            orientation === "vertical" ? "h-full w-1.5" : "h-1.5 w-full"
          )}
        >
          <BaseSlider.Indicator className="rounded-full bg-accent-600 data-[disabled]:bg-neutral-400" />
          <BaseSlider.Thumb
            aria-label={ariaLabel ?? label ?? "Slider"}
            className={cn(
              "size-4 rounded-full bg-white shadow-sm outline outline-1 outline-neutral-300 transition-[outline-width]",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-500",
              "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
            )}
          />
        </BaseSlider.Track>
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
