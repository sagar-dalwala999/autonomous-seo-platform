// One-off seed script — NOT imported by the app, run manually. Creates/resets the QA login used
// for Supabase Auth. Needs the service-role key (packages/db/.env's SUPABASE_SERVICE_ROLE_KEY),
// which bypasses RLS — never wire that key into the app itself, only into this script's own env
// at invocation time. Idempotent: creates the user if absent, resets the password if present.
//
// Usage (run from this file's directory or anywhere, with node_modules resolvable):
//   SEED_SERVICE_ROLE_KEY="<service-role key>" \
//   SEED_QA_EMAIL="qa-user@seo-platform.test" \
//   SEED_QA_PASSWORD="<a strong password>" \
//   node scripts/seed-qa-user.mjs
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://jlmdsrrwfczgryilsjsy.supabase.co";
const SERVICE_ROLE_KEY = process.env.SEED_SERVICE_ROLE_KEY;
const QA_EMAIL = process.env.SEED_QA_EMAIL || "qa-user@seo-platform.test";
const QA_PASSWORD = process.env.SEED_QA_PASSWORD;

if (!SERVICE_ROLE_KEY) {
  console.error("SEED_SERVICE_ROLE_KEY env var not set (see packages/db/.env's SUPABASE_SERVICE_ROLE_KEY).");
  process.exit(1);
}
if (!QA_PASSWORD) {
  console.error("SEED_QA_PASSWORD env var not set.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: existing, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (listErr) throw listErr;
  const found = existing.users.find((u) => u.email === QA_EMAIL);

  if (found) {
    const { error: updateErr } = await admin.auth.admin.updateUserById(found.id, {
      password: QA_PASSWORD,
      email_confirm: true,
    });
    if (updateErr) throw updateErr;
    console.log(`Updated existing QA user ${QA_EMAIL} (id ${found.id}) with new password.`);
    return;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: QA_EMAIL,
    password: QA_PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  console.log(`Created QA user ${QA_EMAIL} (id ${data.user.id}).`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
