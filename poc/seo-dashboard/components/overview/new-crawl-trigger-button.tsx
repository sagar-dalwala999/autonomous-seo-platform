"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  variant?: "primary" | "outline" | "ghost" | "dark";
  size?: "sm" | "md";
  label?: string;
}

/** "+ New crawl" now routes to the dedicated /new-crawl page (Sagar, 2026-08-11) — no longer a slide-over. */
export function NewCrawlTriggerButton({ variant = "primary", size = "sm", label = "New crawl" }: Props) {
  const router = useRouter();
  return (
    <Button variant={variant} size={size} onClick={() => router.push("/new-crawl")}>
      <Plus size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </Button>
  );
}
