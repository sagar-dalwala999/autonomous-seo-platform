import Link from "next/link";

export default function SiteNav() {
  return (
    <nav className="site-nav">
      <Link href="/" className="brand">
        Summit Trail Gear
      </Link>
      <Link href="/blog">Blog</Link>
      <Link href="/products">Products</Link>
      <Link href="/guides">Guides</Link>
      <Link href="/about">About</Link>
      <Link href="/contact">Contact</Link>
      <Link href="/members">Members</Link>
    </nav>
  );
}
