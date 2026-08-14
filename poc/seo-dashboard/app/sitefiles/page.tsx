import { redirect } from "next/navigation";

export default async function SitefilesPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const sp = await searchParams;
  const q = sp.run ? `?run=${encodeURIComponent(sp.run)}` : "";
  redirect(`/sitemap${q}`);
}
