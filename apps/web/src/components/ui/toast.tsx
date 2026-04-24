import { Toast } from "@base-ui/react/toast";
import {
  CheckCircle,
  XCircle,
  Info,
  AlertTriangle,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

// Custom toast data that can be passed via toast.add({ data: { ... } })
export interface ToastData {
  variant?: "success" | "error" | "info" | "warning";
  action?: ReactNode;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-4 right-4 z-[200] flex w-80 max-w-[calc(100vw-2rem)] flex-col sm:bottom-4 sm:right-4 safe-bottom safe-right pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)]">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

const icons = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
  warning: AlertTriangle,
};

const iconColors = {
  success: "text-success-500",
  error: "text-danger-500",
  info: "text-accent-600",
  warning: "text-amber-500",
};

const progressColors = {
  success: "bg-success-500",
  error: "bg-danger-500",
  info: "bg-accent-600",
  warning: "bg-amber-500",
};

function ToastList() {
  const { toasts } = Toast.useToastManager<ToastData>();
  return toasts.map((toast) => {
    const variant = toast.data?.variant;
    const action = toast.data?.action;
    const Icon = variant ? icons[variant] : null;
    const iconColor = variant ? iconColors[variant] : "";
    const progressColor = variant ? progressColors[variant] : "bg-accent-600";

    return (
      <Toast.Root
        key={toast.id}
        toast={toast}
        className="absolute right-0 bottom-0 z-[calc(1000-var(--toast-index))] w-full origin-bottom overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-elevated select-none
          [transform:translateX(var(--toast-swipe-movement-x,0px))_translateY(var(--toast-swipe-movement-y,0px))_scale(calc(1-var(--toast-index,0)*0.05))]
          data-[expanded]:[transform:translateX(var(--toast-swipe-movement-x,0px))_translateY(calc(var(--toast-offset-y,0px)*-1+var(--toast-swipe-movement-y,0px)))]
          data-[limited]:opacity-0
          data-[starting-style]:[transform:translateX(100%)] data-[starting-style]:opacity-0
          data-[ending-style]:[transform:translateX(100%)] data-[ending-style]:opacity-0
          [transition:transform_0.3s_cubic-bezier(0.22,1,0.36,1),opacity_0.3s]"
      >
        <Toast.Content className="flex flex-col transition-opacity duration-[250ms] data-[behind]:pointer-events-none data-[behind]:opacity-0 data-[expanded]:opacity-100">
          <div className="flex items-start gap-3 p-4">
            {Icon && <Icon size={20} className={iconColor} />}
            <div className="min-w-0 flex-1">
              <Toast.Title className="text-sm font-medium text-neutral-900" />
              <Toast.Description className="mt-0.5 text-sm text-neutral-500" />
              {action && <div className="mt-2">{action}</div>}
            </div>
            <Toast.Close
              className="shrink-0 rounded-md p-0.5 text-neutral-400 transition-colors hover:text-neutral-600"
              aria-label="Close"
            >
              <X size={16} />
            </Toast.Close>
          </div>
          {/* Auto-dismiss progress bar */}
          <div className="h-0.5 w-full bg-neutral-100">
            <div
              className={`h-full ${progressColor} animate-shrink`}
              style={{ width: "100%" }}
            />
          </div>
        </Toast.Content>
      </Toast.Root>
    );
  });
}

export function useToast() {
  return Toast.useToastManager<ToastData>();
}
