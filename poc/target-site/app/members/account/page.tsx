/* seeded: MEMBERS-AREA — no metadata export, so this page has no <title> and no meta description.
   Scoped to the members area on purpose; the public-page manifest (evidence-check.ts /
   analyzer-gate.ts) only counts issues on public pages, so this must never be added there. */
export default function MembersAccountPage() {
  return (
    <article>
      <h1>Account</h1>
      <p>
        Update your shipping address, payment method, and email preferences here. Member since:
        March 2024. Newsletter: subscribed.
      </p>
      <p>
        Changes to shipping and billing details take effect on the next order — orders already in
        progress ship to the address on file at the time they were placed.
      </p>
    </article>
  );
}
