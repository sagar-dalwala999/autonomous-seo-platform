import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { TopbarActionsProvider } from "@/lib/topbar-actions-context";
import { listRuns, getReportPath } from "@/lib/data";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "SEO Platform · Crawler POC",
  description: "Local analytics dashboard over seo-crawler-poc evidence.",
};

// Reads localStorage before paint so the resolved theme is correct on first frame (no flash).
// Keep in sync with lib/theme.ts's resolveTheme() — this copy can't import a module.
const NO_FLASH_SCRIPT = `(function(){try{var s=localStorage.getItem("theme");var p=s==="light"||s==="dark"||s==="system"?s:"system";var r=p==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p;document.documentElement.setAttribute("data-theme",r);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const runs = await listRuns();
  const reportPath = getReportPath();

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="h-dvh overflow-hidden antialiased">
        <Script id="theme-no-flash" strategy="beforeInteractive">
          {NO_FLASH_SCRIPT}
        </Script>
        <TopbarActionsProvider>
          <AppShell runs={runs} runCount={runs.length} reportPath={reportPath}>
            {children}
          </AppShell>
        </TopbarActionsProvider>
      </body>
    </html>
  );
}
