"use server";

import { getPages } from "@/lib/data";
import { computeMatchingPages, type DrilldownResult } from "@/lib/measurements-drilldown";

/** Server Action backing the "View matching pages" drill-down — called directly from the client
 *  panel, no new app/api/** route needed (that tree isn't owned by this slice). */
export async function fetchMatchingPages(runId: string, measurementId: string): Promise<DrilldownResult | null> {
  const pages = await getPages(runId);
  return computeMatchingPages(pages, measurementId);
}
