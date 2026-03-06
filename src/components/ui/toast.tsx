"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  AlertCircle,
  AlertTriangle,
  InformationCircleIcon,
  Cancel
} from "@hugeicons/core-free-icons";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastProps {
  type: ToastType;
  message: string;
  duration?: number;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const toastStyles = {
  success: "bg-[#10B981] text-white",
  error: "bg-[#EF4444] text-white",
  warning: "bg-[#F59E0B] text-white",
  info: "bg-[#3B82F6] text-white",
};

const toastIcons = {
  success: CheckmarkCircle02Icon,
  error: AlertCircle,
  warning: AlertTriangle,
  info: InformationCircleIcon,
};

export function Toast({ type, message, duration = 3000, onClose, action }: ToastProps) {
  const [isVisible, setIsVisible] = React.useState(true);

  React.useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(() => onClose?.(), 200);
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  if (!isVisible) return null;

  const Icon = toastIcons[type];

  return (
    <div
      className={cn(
        "fixed top-4 right-4 z-50 w-[360px] rounded shadow-lg p-3 flex items-start gap-3 animate-in slide-in-from-right-5 fade-in",
        toastStyles[type],
        !isVisible && "animate-out slide-out-to-right-5 fade-out"
      )}
      role="alert"
      aria-live={type === "error" ? "assertive" : "polite"}
    >
      <HugeiconsIcon icon={Icon} className="h-5 w-5 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{message}</p>
        {action && (
          <button
            onClick={action.onClick}
            className="mt-2 text-sm font-medium underline hover:no-underline"
          >
            {action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => {
          setIsVisible(false);
          setTimeout(() => onClose?.(), 200);
        }}
        className="shrink-0 p-0.5 rounded hover:bg-white/20 transition-colors"
        aria-label="关闭"
      >
        <HugeiconsIcon icon={Cancel} className="h-4 w-4" />
      </button>
    </div>
  );
}

// Toast Container for managing multiple toasts
export interface ToastContainerProps {
  toasts: Array<ToastProps & { id: string }>;
  onRemove: (id: string) => void;
}

export function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} {...toast} onClose={() => onRemove(toast.id)} />
      ))}
    </div>
  );
}


