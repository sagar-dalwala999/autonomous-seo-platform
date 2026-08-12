import type { Metadata } from "next";

export const metadata: Metadata = {
  /* seeded: very short title, under 15 chars (manifest #3b) */
  title: "Contact",
  description:
    "Contact the Summit Trail Gear team about orders, returns, product questions, or trail-guide feedback.",
};

export default function ContactPage() {
  return (
    <article>
      {/* seeded: page has no H1 — starts at H2 (manifest #6a) */}
      <h2>Get in touch</h2>
      <p>
        The fastest way to reach us is email: <strong>hello@summittrailgear.example</strong>. We
        answer order and returns questions within two business days, usually sooner.
      </p>
      <h2>Returns</h2>
      <p>
        Unused gear can come back within 60 days for a full refund. If something failed on trail,
        tell us what happened — field failures are exactly the reports our testing loop needs, and
        we repair or replace verified defects at no charge.
      </p>
      <h2>Wholesale</h2>
      <p>
        Independent outdoor shops can write to the same address with the subject line
        &quot;wholesale&quot; for the current line sheet and terms.
      </p>
    </article>
  );
}
