import "./globals.css";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";

/* No sitewide metadata on purpose — pages own their titles/descriptions (enables manifest #1, #4). */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        <main className="page">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
