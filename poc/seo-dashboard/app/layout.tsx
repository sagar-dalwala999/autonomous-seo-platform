import type { Metadata } from "next";
import Script from "next/script";
import { Inter } from "next/font/google";
import { AppShell } from "@/components/shell/app-shell";
import { TopbarActionsProvider } from "@/lib/topbar-actions-context";
import { listRuns, getReportPath } from "@/lib/data";
import { createClient } from "@/lib/auth-server";
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

// This layout reads the crawler's storage dir on every render (listRuns for the topbar selector),
// so no route under it may be prerendered — a build-time snapshot would serve a stale run list.
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Gate the shell on the session: an anonymous visitor must not see nav chrome, and
  // listRuns() must not read the crawler's storage dir to build a selector they can't use.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims);

  const shell = signedIn ? (
    <AppShell {...(await shellProps())}>{children}</AppShell>
  ) : (
    children
  );

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="h-dvh overflow-hidden antialiased">
        <Script id="theme-no-flash" strategy="beforeInteractive">
          {NO_FLASH_SCRIPT}
        </Script>
        <TopbarActionsProvider>{shell}</TopbarActionsProvider>
      </body>
    </html>
  );
}

async function shellProps() {
  const runs = await listRuns();
  return { runs, runCount: runs.length, reportPath: getReportPath() };
}
