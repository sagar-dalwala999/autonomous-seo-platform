export type RenderMode = "auto" | "never" | "always";
export type PanelState = "form" | "starting" | "running" | "done" | "failed";

export interface CrawlStatusResponse {
  runId: string;
  state: "running" | "done" | "failed";
  exitCode: number | null;
  log: string[];
  reportReady: boolean;
}
