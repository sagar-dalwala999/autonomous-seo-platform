"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";

interface Props {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}

/** Labeled switch row; state is quadruple-signaled: track fill, knob icon, On/Off chip, sentence. */
export function RobotsSwitch({ checked, onChange, disabled }: Props) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-control border border-border bg-card px-3 py-2.5">
      <div className="flex flex-col gap-0.5">
        <p className="text-xs font-medium text-foreground">Respect robots.txt</p>
        <p className={cn("text-[11px]", checked ? "text-faint" : "text-warn")} aria-live="polite">
          {checked ? "On — blocked URLs are recorded, not fetched" : "Off — robots rules ignored for this crawl"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span
          className={cn(
            "rounded-pill border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            checked ? "border-primary/40 bg-primary/10 text-primary" : "border-warn/40 bg-warn-bg text-warn",
          )}
        >
          {checked ? "On" : "Off"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label="Respect robots.txt"
          disabled={disabled}
          onClick={() => onChange(!checked)}
          className={cn(
            "relative h-7 w-[52px] shrink-0 rounded-pill border-2 transition-colors duration-150 outline-none",
            "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            "disabled:pointer-events-none disabled:opacity-50",
            checked ? "border-primary bg-primary" : "border-border-strong bg-border-strong",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-card transition-transform duration-150",
              checked ? "translate-x-[24px]" : "translate-x-0.5",
            )}
          >
            {checked ? (
              <Check size={12} strokeWidth={3} className="text-primary" aria-hidden="true" />
            ) : (
              <X size={12} strokeWidth={3} className="text-secondary" aria-hidden="true" />
            )}
          </span>
        </button>
      </div>
    </div>
  );
}
