"use client";

import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  variant?: "primary" | "outline" | "ghost" | "dark";
  size?: "sm" | "md";
  label?: string;
  className?: string;
}

export function NewCrawlTriggerButton({ variant = "primary", size = "sm", label = "New crawl", className }: Props) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size={size}
      onClick={() => router.push("/new-crawl")}
      className={className}
      title="Start new crawl"
      aria-label="Start new crawl"
    >
      <Plus size={14} strokeWidth={2} aria-hidden="true" />
      <span>{label}</span>
    </Button>
  );
}
