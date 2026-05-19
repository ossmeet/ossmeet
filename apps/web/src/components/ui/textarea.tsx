import { Field } from "@base-ui/react/field";
import { cn } from "@ossmeet/shared";
import {
  type TextareaHTMLAttributes,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
} from "react";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  autoResize?: boolean;
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    { className, label, error, autoResize = false, showCount = false, id, name, maxLength, ...props },
    ref
  ) => {
    const innerRef = useRef<HTMLTextAreaElement>(null);

    // Merge the internal ref (used for autoResize) with any forwarded ref.
    // Handles both object refs and callback refs safely.
    const mergedRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
        }
      },
      [ref],
    );

    const resize = useCallback(() => {
      if (autoResize && innerRef.current) {
        innerRef.current.style.height = "auto";
        innerRef.current.style.height = `${innerRef.current.scrollHeight}px`;
      }
    }, [autoResize]);

    useEffect(() => {
      resize();
    }, [props.value, resize]);

    const charCount =
      typeof props.value === "string" ? props.value.length : 0;

    return (
      <Field.Root invalid={!!error} name={name} className="w-full">
        {label && (
          <Field.Label className="mb-1.5 block text-sm font-medium text-neutral-700">
            {label}
          </Field.Label>
        )}
        {/* Field.Control types are bound to <input>; cast is safe because Base UI
            uses the `render` element's type at runtime. */}
        <Field.Control
          render={<textarea ref={mergedRef} id={id} maxLength={maxLength} onInput={autoResize ? resize : undefined} />}
          className={cn(
            "flex min-h-[5rem] w-full rounded-lg border bg-white px-3 py-2 text-sm transition-all duration-150 placeholder:text-neutral-400 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            autoResize && "resize-none overflow-hidden",
            error
              ? "border-danger-300 focus-visible:border-danger-500 focus-visible:ring-2 focus-visible:ring-danger-500/20"
              : "border-neutral-300 focus-visible:border-accent-400 focus-visible:ring-2 focus-visible:ring-accent-500/20",
            className
          )}
          {...(props as unknown as React.ComponentProps<typeof Field.Control>)}
        />
        <div className="mt-1 flex items-center justify-between">
          {error && (
            <Field.Error match className="text-sm text-danger-600">
              {error}
            </Field.Error>
          )}
          {showCount && maxLength && (
            <p
              className={cn(
                "ml-auto text-xs",
                charCount > maxLength * 0.9
                  ? "text-warning-500"
                  : "text-neutral-400"
              )}
            >
              {charCount}/{maxLength}
            </p>
          )}
        </div>
      </Field.Root>
    );
  }
);

Textarea.displayName = "Textarea";
