-- Appendix A of D:\projects\seo-team-audit\PLAN-02-Data-Model.md — raw SQL Prisma cannot express.
-- Applied as a hand-written migration per that document's instruction (§3, §6). Prisma bypasses
-- RLS as table owner (§6.4) — this is defence in depth; code-level projectId scoping is the
-- real enforcement boundary for server-side queries.
--
-- NOTE: table names are snake_case (@@map on each model) but COLUMN names are the raw camelCase
-- field names (no @map on scalars in this schema) — every mixed-case column below is quoted.

-- A.1 — auth.users -> public.users sync (best-effort: skipped if this role lacks auth schema
-- trigger privilege on this Supabase project; RLS/indexes below do not depend on it).
DO $$
BEGIN
  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $BODY$
  BEGIN
    INSERT INTO public.users (id, email, "displayName", "avatarUrl", "createdAt", "updatedAt")
    VALUES (NEW.id, NEW.email,
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'avatar_url', now(), now())
    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, "updatedAt" = now();
    RETURN NEW;
  END; $BODY$;

  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
  AFTER INSERT OR UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'A.1 skipped: no privilege on auth.users from this role — wire the trigger via the Supabase dashboard SQL editor instead.';
END $$;

-- A.2 — RLS helper (§6.2). STABLE + (SELECT auth.uid()) so the planner caches it as an InitPlan
-- instead of evaluating once per row; SECURITY DEFINER avoids recursive RLS on project_members.
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.user_project_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT "projectId" FROM public.project_members WHERE "userId" = (SELECT auth.uid());
$$;

-- A.2 / §6.3 — RLS: enable + force + a single SELECT-own policy on every projectId-bearing
-- table. No write policy for `authenticated` anywhere here: all writes go through
-- Prisma/Express with the service role or the table-owner connection (§6.3).
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'sites','crawl_schedules','crawl_jobs','crawls','pages','page_contents','page_links',
    'page_images','page_media','page_headings','structured_data_items','page_redirect_hops',
    'link_targets','image_assets','findings','issues','rule_mutes','measurements',
    'activity_log_entries','site_files','ai_crawler_verdicts','sitemap_files','sitemap_entries',
    'failures','blocked_urls','duplicate_groups','duplicate_group_members','run_comparisons',
    'run_diff_entries','artifacts'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ("projectId" IN (SELECT app.user_project_ids()))',
      t || '_select_own', t
    );
  END LOOP;
END $$;

-- projects: an owner may rename/delete their own project
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
CREATE POLICY "projects_select" ON public.projects FOR SELECT TO authenticated
  USING (id IN (SELECT app.user_project_ids()));
CREATE POLICY "projects_update_owner" ON public.projects FOR UPDATE TO authenticated
  USING ("ownerId" = (SELECT auth.uid())) WITH CHECK ("ownerId" = (SELECT auth.uid()));

-- users: a user reads/edits only their own row
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users FORCE ROW LEVEL SECURITY;
CREATE POLICY "users_self" ON public.users FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
CREATE POLICY "users_self_update" ON public.users FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));

-- rules: global rulebook world-readable to signed-in users; project overrides scoped
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules FORCE ROW LEVEL SECURITY;
CREATE POLICY "rules_select" ON public.rules FOR SELECT TO authenticated
  USING ("projectId" IS NULL OR "projectId" IN (SELECT app.user_project_ids()));

-- project_members: read via helper avoided here (would recurse) — direct self/member check
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members FORCE ROW LEVEL SECURITY;
CREATE POLICY "members_select_self" ON public.project_members FOR SELECT TO authenticated
  USING ("userId" = (SELECT auth.uid()) OR "projectId" IN (SELECT app.user_project_ids()));

-- A.3 — Partial indexes, one per boolean filter chip (Prisma's @@index has no WHERE clause)
CREATE INDEX pages_noindex_idx        ON pages ("crawlId", id) WHERE noindex;
CREATE INDEX pages_orphan_idx         ON pages ("crawlId", id) WHERE "isOrphan";
CREATE INDEX pages_duplicate_idx      ON pages ("crawlId", id) WHERE "isDuplicate";
CREATE INDEX pages_needs_js_idx       ON pages ("crawlId", id) WHERE "likelyClientRendered";
CREATE INDEX pages_render_div_idx     ON pages ("crawlId", id) WHERE "renderDivergent";
CREATE INDEX pages_missing_alt_idx    ON pages ("crawlId", id) WHERE "imagesMissingAlt" > 0;
CREATE INDEX pages_no_title_idx       ON pages ("crawlId", id) WHERE title IS NULL;
CREATE INDEX pages_no_desc_idx        ON pages ("crawlId", id) WHERE "metaDescription" IS NULL;
CREATE INDEX pages_no_h1_idx          ON pages ("crawlId", id) WHERE "h1Count" = 0;
CREATE INDEX pages_mixed_content_idx  ON pages ("crawlId", id) WHERE "mixedContentCount" > 0;
CREATE INDEX pages_not_in_sitemap_idx ON pages ("crawlId", id) WHERE "inSitemap" = false;
CREATE INDEX pages_errors_idx         ON pages ("crawlId", id) WHERE "statusCode" >= 400;
CREATE INDEX sitemap_uncrawled_idx    ON sitemap_entries ("crawlId", id) WHERE crawled = false;
CREATE INDEX links_broken_idx         ON page_links ("crawlId", id) WHERE "targetStatusCode" >= 400;

-- A.4 — Trigram search (extensions created in the init migration)
CREATE INDEX pages_url_trgm   ON pages USING gin (url   extensions.gin_trgm_ops);
CREATE INDEX pages_title_trgm ON pages USING gin (title extensions.gin_trgm_ops);

-- A.5 — BRIN on the append-only activity table (cheap range deletes for retention)
CREATE INDEX activity_at_brin ON activity_log_entries USING brin (at) WITH (pages_per_range = 32);

-- A.6 (Realtime publication) intentionally NOT applied — §4.5/§9.2 flag it as an open decision
-- (large crawls would flood a per-row subscription). Add later with:
--   ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log_entries;
