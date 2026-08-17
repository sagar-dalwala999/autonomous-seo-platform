-- Google Search Console storage for the dashboard.
--
-- Keyed directly by the Supabase user id (a UUID) rather than through
-- User -> Project -> Site: the dashboard's GSC integration has no Project/Site
-- row, so these tables carry their own (userId, domain) scope and there is
-- deliberately no FK to public.users (a dashboard user may not have a User row
-- yet). App-level userId scoping is the enforcement boundary, matching how the
-- JSON store it replaces was scoped by directory.
--
-- Date *keys* (date, windowStart, windowEnd, attempt date) are VARCHAR(10)
-- YYYY-MM-DD text so the dashboard's string comparisons keep working unchanged;
-- real timestamps are TIMESTAMPTZ(6) and are converted to/from ISO strings at
-- the store API (packages/db/src/gsc/store.ts).

-- CreateTable
CREATE TABLE "gsc_connections" (
    "userId" UUID NOT NULL,
    "googleEmail" VARCHAR(320),
    "refreshTokenEnc" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(6),
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gsc_connections_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "gsc_linked_properties" (
    "userId" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "propertyType" VARCHAR(16) NOT NULL,
    "permissionLevel" VARCHAR(64),
    "lastSyncedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gsc_linked_properties_pkey" PRIMARY KEY ("userId","domain")
);

-- CreateIndex
CREATE INDEX "gsc_linked_properties_userId_idx" ON "gsc_linked_properties"("userId");

-- CreateTable
CREATE TABLE "gsc_metrics_meta" (
    "userId" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "propertyType" VARCHAR(16) NOT NULL,
    "lastSyncedAt" TIMESTAMPTZ(6),
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gsc_metrics_meta_pkey" PRIMARY KEY ("userId","domain")
);

-- CreateIndex
CREATE INDEX "gsc_metrics_meta_userId_idx" ON "gsc_metrics_meta"("userId");

-- CreateTable
CREATE TABLE "gsc_page_metrics" (
    "userId" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "normalizedUrl" TEXT,
    "searchType" VARCHAR(8) NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "gsc_page_metrics_pkey" PRIMARY KEY ("userId","domain","date","pageUrl","searchType")
);

-- CreateIndex
CREATE INDEX "gsc_page_metrics_userId_domain_searchType_date_idx" ON "gsc_page_metrics"("userId","domain","searchType","date");

-- CreateTable
CREATE TABLE "gsc_breakdowns" (
    "userId" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "dimension" VARCHAR(24) NOT NULL,
    "searchType" VARCHAR(8) NOT NULL,
    "keyValue" TEXT NOT NULL,
    "windowStart" VARCHAR(10) NOT NULL,
    "windowEnd" VARCHAR(10) NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "gsc_breakdowns_pkey" PRIMARY KEY ("userId","domain","dimension","searchType","windowStart","windowEnd","keyValue")
);

-- CreateIndex
CREATE INDEX "gsc_breakdowns_userId_domain_searchType_idx" ON "gsc_breakdowns"("userId","domain","searchType");

-- CreateTable
CREATE TABLE "gsc_inspections" (
    "userId" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "pageUrl" TEXT NOT NULL,
    "verdict" VARCHAR(24) NOT NULL,
    "coverageState" TEXT,
    "robotsTxtState" TEXT,
    "indexingState" TEXT,
    "pageFetchState" TEXT,
    "googleCanonical" TEXT,
    "userCanonical" TEXT,
    "lastCrawlTime" TIMESTAMPTZ(6),
    "crawledAs" TEXT,
    "sitemaps" TEXT[],
    "raw" JSONB,
    "inspectedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "gsc_inspections_pkey" PRIMARY KEY ("userId","domain","pageUrl")
);

-- CreateIndex
CREATE INDEX "gsc_inspections_userId_domain_idx" ON "gsc_inspections"("userId","domain");

-- CreateTable
CREATE TABLE "gsc_inspection_attempts" (
    "id" BIGSERIAL NOT NULL,
    "userId" UUID NOT NULL,
    "domain" VARCHAR(255) NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "succeeded" BOOLEAN NOT NULL,

    CONSTRAINT "gsc_inspection_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gsc_inspection_attempts_userId_domain_date_idx" ON "gsc_inspection_attempts"("userId","domain","date");
