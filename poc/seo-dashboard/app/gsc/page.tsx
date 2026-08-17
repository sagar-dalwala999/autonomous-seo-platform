import { History } from "lucide-react";
import { listSites } from "@/lib/gsc/sites";
import { GscClient } from "@/components/gsc/gsc-client";
import { EmptyState } from "@/components/ui/empty-state";

interface Props {
  searchParams: Promise<{ site?: string }>;
}

export default async function GscPage({ searchParams }: Props) {
  const { site } = await searchParams;
  const sites = await listSites();

  if (sites.length === 0) {
    return (
      <EmptyState
        icon={History}
        title="No crawl runs yet"
        description="Run a crawl first — the Search Console view is organised by the sites you've crawled, and each one can be linked to a Google Search Console property."
      />
    );
  }

  // ?site= wins; otherwise default to the most recently crawled site.
  const initialDomain = site && sites.some((s) => s.domain === site) ? site : sites[0]?.domain ?? null;

  return <GscClient sites={sites} initialDomain={initialDomain} />;
}
