-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'editor', 'viewer');

-- CreateEnum
CREATE TYPE "SiteRole" AS ENUM ('primary', 'competitor');

-- CreateEnum
CREATE TYPE "CrawlStatus" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled', 'partial');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('queued', 'running', 'done', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "RenderMode" AS ENUM ('auto', 'http', 'always');

-- CreateEnum
CREATE TYPE "RenderedWith" AS ENUM ('http', 'browser');

-- CreateEnum
CREATE TYPE "ContentSource" AS ENUM ('main', 'role-main', 'article', 'body-minus-chrome', 'body', 'rendered-dom', 'none');

-- CreateEnum
CREATE TYPE "LinkKind" AS ENUM ('anchor', 'area', 'iframe', 'frame', 'link:next', 'link:prev', 'link:feed', 'link:hreflang', 'link:canonical', 'data-attribute', 'inline-script', 'form-get', 'meta-refresh');

-- CreateEnum
CREATE TYPE "LinkScope" AS ENUM ('internal', 'external');

-- CreateEnum
CREATE TYPE "ImageSource" AS ENUM ('img', 'srcset', 'picture', 'lazy-attribute', 'css-background', 'css-stylesheet', 'svg-use', 'poster', 'meta', 'icon', 'network');

-- CreateEnum
CREATE TYPE "AltState" AS ENUM ('missing', 'empty', 'described', 'not-checked');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('video', 'audio', 'embed', 'object', 'iframe', 'youtube', 'vimeo', 'file');

-- CreateEnum
CREATE TYPE "StructuredDataFormat" AS ENUM ('json-ld', 'microdata', 'rdfa');

-- CreateEnum
CREATE TYPE "RuleScope" AS ENUM ('page', 'site');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('critical', 'error', 'warning', 'notice');

-- CreateEnum
CREATE TYPE "DetectionTier" AS ENUM ('observed', 'derived', 'heuristic');

-- CreateEnum
CREATE TYPE "AutomationClass" AS ENUM ('auto-safe', 'auto-with-review', 'human-only');

-- CreateEnum
CREATE TYPE "EffortLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('failing', 'passed', 'skipped-data-unavailable', 'errored', 'muted');

-- CreateEnum
CREATE TYPE "FailureClass" AS ENUM ('timeout', 'dns', 'http-4xx', 'http-5xx', 'redirect-loop', 'parse-error', 'tls', 'conn-refused', 'conn-reset', 'rate-limited', 'non-html', 'other');

-- CreateEnum
CREATE TYPE "BlockedReason" AS ENUM ('robots', 'safety-logout', 'safety-destructive', 'user-excluded', 'out-of-scope', 'url-too-long', 'too-many-params', 'asset-extension', 'depth-budget', 'page-budget');

-- CreateEnum
CREATE TYPE "SiteFileKind" AS ENUM ('robots.txt', 'sitemap.xml', 'sitemap-index', 'llms.txt', 'manifest.json', 'security.txt', 'ads.txt', 'feed');

-- CreateEnum
CREATE TYPE "FileParseStatus" AS ENUM ('loaded', 'empty', 'soft-404', 'not-found', 'server-error', 'unreachable', 'malformed', 'gzip-unreadable', 'none');

-- CreateEnum
CREATE TYPE "AiAccessVerdict" AS ENUM ('allowed', 'blocked', 'partly-blocked', 'ignores-robots', 'unknown');

-- CreateEnum
CREATE TYPE "DuplicateKind" AS ENUM ('exact-content', 'near-content', 'title', 'description', 'url-variant');

-- CreateEnum
CREATE TYPE "ComparisonKind" AS ENUM ('historical', 'competitor', 'baseline');

-- CreateEnum
CREATE TYPE "DiffChangeKind" AS ENUM ('page-added', 'page-removed', 'page-changed', 'issue-new', 'issue-fixed', 'issue-persisting', 'issue-churned', 'measurement-delta');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('raw-html', 'static-html', 'rendered-html', 'screenshot-full', 'screenshot-thumb', 'site-file', 'crawl-log', 'export-csv', 'export-ndjson', 'report-html', 'har');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('debug', 'info', 'success', 'warn', 'error');

-- CreateEnum
CREATE TYPE "ActivityKind" AS ENUM ('lifecycle', 'request', 'render', 'retry', 'discovery', 'blocked', 'failure', 'analysis', 'progress');

-- CreateEnum
CREATE TYPE "MeasurementUnit" AS ENUM ('count', 'percent', 'ms', 'byte', 'score', 'ratio', 'text');

-- CreateEnum
CREATE TYPE "TrendDirection" AS ENUM ('up-is-good', 'down-is-good', 'neutral');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(200),
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'viewer',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateTable
CREATE TABLE "sites" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "role" "SiteRole" NOT NULL DEFAULT 'primary',
    "label" VARCHAR(200) NOT NULL,
    "startUrl" TEXT NOT NULL,
    "host" VARCHAR(255) NOT NULL,
    "aliases" TEXT[],
    "defaultSettings" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_schedules" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "cron" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB,
    "lastRunAt" TIMESTAMPTZ(6),
    "nextRunAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crawl_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_jobs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "scheduleId" UUID,
    "requestedById" UUID,
    "state" "JobState" NOT NULL DEFAULT 'queued',
    "priority" SMALLINT NOT NULL DEFAULT 0,
    "startUrl" TEXT NOT NULL,
    "maxPages" INTEGER,
    "maxDepth" SMALLINT,
    "renderMode" "RenderMode" NOT NULL DEFAULT 'auto',
    "respectRobots" BOOLEAN NOT NULL DEFAULT true,
    "concurrency" SMALLINT NOT NULL DEFAULT 4,
    "requestsPerSec" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "followFeeds" BOOLEAN NOT NULL DEFAULT true,
    "checkExternal" BOOLEAN NOT NULL DEFAULT false,
    "captureRawHtml" BOOLEAN NOT NULL DEFAULT true,
    "captureScreens" BOOLEAN NOT NULL DEFAULT false,
    "excludePatterns" TEXT[],
    "authMethod" VARCHAR(40),
    "settings" JSONB,
    "queuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "heartbeatAt" TIMESTAMPTZ(6),
    "workerId" VARCHAR(120),
    "attempts" SMALLINT NOT NULL DEFAULT 0,
    "maxAttempts" SMALLINT NOT NULL DEFAULT 3,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "crawlId" UUID,

    CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawls" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "label" VARCHAR(200),
    "startUrl" TEXT NOT NULL,
    "status" "CrawlStatus" NOT NULL DEFAULT 'pending',
    "startedAt" TIMESTAMPTZ(6),
    "finishedAt" TIMESTAMPTZ(6),
    "durationMs" INTEGER,
    "terminationReason" VARCHAR(60),
    "config" JSONB NOT NULL,
    "configHash" CHAR(64) NOT NULL,
    "extractorVersion" VARCHAR(40) NOT NULL,
    "rulebookVersion" VARCHAR(40),
    "crawlerUserAgent" TEXT,
    "capturedFields" TEXT[],
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "pagesFailed" INTEGER NOT NULL DEFAULT 0,
    "pagesBlocked" INTEGER NOT NULL DEFAULT 0,
    "pagesSkipped" INTEGER NOT NULL DEFAULT 0,
    "pagesRendered" INTEGER NOT NULL DEFAULT 0,
    "requestsMade" INTEGER NOT NULL DEFAULT 0,
    "maxDepthSeen" SMALLINT NOT NULL DEFAULT 0,
    "coveragePercent" DOUBLE PRECISION,
    "totalBytes" BIGINT NOT NULL DEFAULT 0,
    "avgResponseTimeMs" INTEGER,
    "avgWordCount" INTEGER,
    "peakHeapMb" INTEGER,
    "healthScore" DOUBLE PRECISION,
    "healthGrade" VARCHAR(20),
    "healthPenalty" DOUBLE PRECISION,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "warningCount" INTEGER NOT NULL DEFAULT 0,
    "noticeCount" INTEGER NOT NULL DEFAULT 0,
    "cleanPageCount" INTEGER NOT NULL DEFAULT 0,
    "statusHistogram" JSONB,
    "depthHistogram" JSONB,
    "failuresByClass" JSONB,
    "filterCounts" JSONB,
    "notes" JSONB,
    "previousCrawlId" UUID,
    "isBaseline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "crawls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageKey" CHAR(12) NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "urlPath" TEXT NOT NULL,
    "host" VARCHAR(255) NOT NULL,
    "section" VARCHAR(200),
    "urlLength" SMALLINT NOT NULL,
    "statusCode" SMALLINT,
    "contentType" VARCHAR(160),
    "httpVersion" VARCHAR(12),
    "contentEncoding" VARCHAR(40),
    "depth" SMALLINT NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMPTZ(6) NOT NULL,
    "responseTimeMs" INTEGER,
    "ttfbMs" INTEGER,
    "downloadMs" INTEGER,
    "htmlBytes" INTEGER,
    "renderedBytes" INTEGER,
    "retryCount" SMALLINT NOT NULL DEFAULT 0,
    "parentUrl" TEXT,
    "discoverySources" TEXT[],
    "redirectHops" SMALLINT NOT NULL DEFAULT 0,
    "redirectTargetUrl" TEXT,
    "crossHostRedirect" BOOLEAN NOT NULL DEFAULT false,
    "toHttps" BOOLEAN NOT NULL DEFAULT false,
    "redirectLoop" BOOLEAN NOT NULL DEFAULT false,
    "permanentRedirect" BOOLEAN NOT NULL DEFAULT false,
    "canonical" TEXT,
    "canonicalIsSelf" BOOLEAN,
    "noindex" BOOLEAN NOT NULL DEFAULT false,
    "nofollow" BOOLEAN NOT NULL DEFAULT false,
    "indexable" BOOLEAN NOT NULL DEFAULT true,
    "robotsDisallowed" BOOLEAN NOT NULL DEFAULT false,
    "inSitemap" BOOLEAN NOT NULL DEFAULT false,
    "robotsDirectives" TEXT[],
    "title" TEXT,
    "titleLength" SMALLINT,
    "titlePx" SMALLINT,
    "titleCutIndex" SMALLINT,
    "titleCount" SMALLINT NOT NULL DEFAULT 0,
    "metaDescription" TEXT,
    "metaDescriptionLength" SMALLINT,
    "metaDescriptionPx" SMALLINT,
    "metaDescriptionCount" SMALLINT NOT NULL DEFAULT 0,
    "metaKeywords" TEXT,
    "metaTagCount" SMALLINT NOT NULL DEFAULT 0,
    "ogTagCount" SMALLINT NOT NULL DEFAULT 0,
    "twitterTagCount" SMALLINT NOT NULL DEFAULT 0,
    "hasOpenGraph" BOOLEAN NOT NULL DEFAULT false,
    "hasTwitterCard" BOOLEAN NOT NULL DEFAULT false,
    "charset" VARCHAR(40),
    "viewport" TEXT,
    "viewportBlocksZoom" BOOLEAN NOT NULL DEFAULT false,
    "hasMetaRefresh" BOOLEAN NOT NULL DEFAULT false,
    "lang" VARCHAR(20),
    "dir" VARCHAR(8),
    "baseHref" TEXT,
    "h1" TEXT,
    "h1Count" SMALLINT NOT NULL DEFAULT 0,
    "h2Count" SMALLINT NOT NULL DEFAULT 0,
    "h3Count" SMALLINT NOT NULL DEFAULT 0,
    "headingCount" SMALLINT NOT NULL DEFAULT 0,
    "wordCount" INTEGER,
    "charCount" INTEGER,
    "textRatio" DOUBLE PRECISION,
    "readingTimeMin" SMALLINT,
    "contentSource" "ContentSource",
    "contentHash" CHAR(64),
    "simHash" BIGINT,
    "fleschReadingEase" DOUBLE PRECISION,
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateGroupId" UUID,
    "internalLinkCount" INTEGER NOT NULL DEFAULT 0,
    "externalLinkCount" INTEGER NOT NULL DEFAULT 0,
    "outlinkCount" INTEGER NOT NULL DEFAULT 0,
    "inlinkCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueInlinkCount" INTEGER NOT NULL DEFAULT 0,
    "nofollowLinkCount" INTEGER NOT NULL DEFAULT 0,
    "brokenInternalLinkCount" INTEGER NOT NULL DEFAULT 0,
    "brokenExternalLinkCount" INTEGER NOT NULL DEFAULT 0,
    "emptyAnchorCount" INTEGER NOT NULL DEFAULT 0,
    "isOrphan" BOOLEAN NOT NULL DEFAULT false,
    "internalRank" DOUBLE PRECISION,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "imagesMissingAlt" INTEGER NOT NULL DEFAULT 0,
    "imagesEmptyAlt" INTEGER NOT NULL DEFAULT 0,
    "imagesMissingDimensions" INTEGER NOT NULL DEFAULT 0,
    "heavyImageCount" INTEGER NOT NULL DEFAULT 0,
    "imageBytes" BIGINT NOT NULL DEFAULT 0,
    "jsonLdBlockCount" SMALLINT NOT NULL DEFAULT 0,
    "jsonLdValid" BOOLEAN,
    "structuredDataTypes" TEXT[],
    "microdataTypes" TEXT[],
    "rdfaTypes" TEXT[],
    "schemaIssueCount" SMALLINT NOT NULL DEFAULT 0,
    "hreflangCount" SMALLINT NOT NULL DEFAULT 0,
    "renderedWith" "RenderedWith" NOT NULL DEFAULT 'http',
    "renderRequested" BOOLEAN NOT NULL DEFAULT false,
    "renderFailed" BOOLEAN NOT NULL DEFAULT false,
    "renderDiscarded" BOOLEAN NOT NULL DEFAULT false,
    "likelyClientRendered" BOOLEAN NOT NULL DEFAULT false,
    "renderMs" INTEGER,
    "renderFirstContentMs" INTEGER,
    "renderSignals" TEXT[],
    "renderDivergent" BOOLEAN NOT NULL DEFAULT false,
    "clientRedirectTo" TEXT,
    "lcpMs" INTEGER,
    "clsScore" DOUBLE PRECISION,
    "tbtMs" INTEGER,
    "fcpMs" INTEGER,
    "domContentLoadedMs" INTEGER,
    "loadEventMs" INTEGER,
    "domNodes" INTEGER,
    "subresourceRequestCount" INTEGER,
    "subresourceBytes" BIGINT,
    "renderBlockingCount" SMALLINT NOT NULL DEFAULT 0,
    "isHttps" BOOLEAN NOT NULL DEFAULT true,
    "mixedContentCount" SMALLINT NOT NULL DEFAULT 0,
    "missingSecurityHeaderCount" SMALLINT NOT NULL DEFAULT 0,
    "hasHsts" BOOLEAN NOT NULL DEFAULT false,
    "hasCsp" BOOLEAN NOT NULL DEFAULT false,
    "sslValid" BOOLEAN,
    "score" SMALLINT,
    "issueCount" SMALLINT NOT NULL DEFAULT 0,
    "criticalCount" SMALLINT NOT NULL DEFAULT 0,
    "errorCount" SMALLINT NOT NULL DEFAULT 0,
    "warningCount" SMALLINT NOT NULL DEFAULT 0,
    "noticeCount" SMALLINT NOT NULL DEFAULT 0,
    "pageType" VARCHAR(40),
    "httpDetail" JSONB,
    "metaDetail" JSONB,
    "indexingDetail" JSONB,
    "contentDetail" JSONB,
    "perfDetail" JSONB,
    "securityDetail" JSONB,
    "renderDetail" JSONB,
    "headDetail" JSONB,
    "assetsDetail" JSONB,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_contents" (
    "pageId" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "firstWords" TEXT,
    "keywords" JSONB,
    "readability" JSONB,

    CONSTRAINT "page_contents_pkey" PRIMARY KEY ("pageId")
);

-- CreateTable
CREATE TABLE "page_links" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "rawHref" TEXT,
    "targetUrl" TEXT NOT NULL,
    "targetNormalized" TEXT,
    "targetHost" VARCHAR(255),
    "anchor" TEXT,
    "accessibleName" TEXT,
    "kind" "LinkKind" NOT NULL DEFAULT 'anchor',
    "scope" "LinkScope" NOT NULL,
    "rel" VARCHAR(200),
    "nofollow" BOOLEAN NOT NULL DEFAULT false,
    "sponsored" BOOLEAN NOT NULL DEFAULT false,
    "ugc" BOOLEAN NOT NULL DEFAULT false,
    "targetAttr" VARCHAR(40),
    "crawlable" BOOLEAN NOT NULL DEFAULT true,
    "targetStatusCode" SMALLINT,
    "targetPageId" UUID,

    CONSTRAINT "page_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_images" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "rawSrc" TEXT,
    "url" TEXT,
    "alt" TEXT,
    "altState" "AltState" NOT NULL DEFAULT 'not-checked',
    "title" TEXT,
    "declaredWidth" INTEGER,
    "declaredHeight" INTEGER,
    "naturalWidth" INTEGER,
    "naturalHeight" INTEGER,
    "format" VARCHAR(20),
    "loading" VARCHAR(20),
    "lazy" BOOLEAN NOT NULL DEFAULT false,
    "sizeBytes" INTEGER,
    "sizeSource" VARCHAR(20),
    "sizeError" VARCHAR(200),
    "source" "ImageSource" NOT NULL DEFAULT 'img',
    "cssOnly" BOOLEAN NOT NULL DEFAULT false,
    "unresolved" BOOLEAN NOT NULL DEFAULT false,
    "broken" BOOLEAN NOT NULL DEFAULT false,
    "brokenReason" VARCHAR(200),
    "srcset" TEXT,
    "sizesAttr" TEXT,
    "variants" JSONB,

    CONSTRAINT "page_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_media" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "url" TEXT NOT NULL,
    "poster" TEXT,
    "mimeType" VARCHAR(120),
    "providerId" VARCHAR(120),

    CONSTRAINT "page_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_headings" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "level" SMALLINT NOT NULL,
    "text" TEXT NOT NULL,
    "position" SMALLINT NOT NULL,
    "inMain" BOOLEAN NOT NULL DEFAULT false,
    "isEmpty" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "page_headings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "structured_data_items" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "position" SMALLINT NOT NULL,
    "format" "StructuredDataFormat" NOT NULL,
    "types" TEXT[],
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "parseError" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "raw" TEXT,
    "parsed" JSONB,
    "validation" JSONB,

    CONSTRAINT "structured_data_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_redirect_hops" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "hopIndex" SMALLINT NOT NULL,
    "fromUrl" TEXT NOT NULL,
    "toUrl" TEXT,
    "statusCode" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "page_redirect_hops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_targets" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "host" VARCHAR(255),
    "scope" "LinkScope" NOT NULL,
    "refCount" INTEGER NOT NULL DEFAULT 0,
    "sourcePageCount" INTEGER NOT NULL DEFAULT 0,
    "statusCode" SMALLINT,
    "crawled" BOOLEAN NOT NULL DEFAULT false,
    "allNofollow" BOOLEAN NOT NULL DEFAULT false,
    "sampleAnchors" TEXT[],
    "sampleSources" TEXT[],
    "kinds" TEXT[],
    "checkedAt" TIMESTAMPTZ(6),
    "checkError" VARCHAR(200),

    CONSTRAINT "link_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_assets" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "refCount" INTEGER NOT NULL DEFAULT 0,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "missingAltCount" INTEGER NOT NULL DEFAULT 0,
    "emptyAltCount" INTEGER NOT NULL DEFAULT 0,
    "sampleAlts" TEXT[],
    "samplePages" TEXT[],
    "statusCode" SMALLINT,
    "contentType" VARCHAR(120),
    "sizeBytes" INTEGER,
    "pixelWidth" INTEGER,
    "pixelHeight" INTEGER,
    "format" VARCHAR(20),
    "notAnImage" BOOLEAN NOT NULL DEFAULT false,
    "checkError" VARCHAR(200),
    "isSiteTemplate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "image_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" UUID NOT NULL,
    "projectId" UUID,
    "slug" VARCHAR(120) NOT NULL,
    "version" SMALLINT NOT NULL DEFAULT 1,
    "scope" "RuleScope" NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "defaultSeverity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "howToFix" TEXT NOT NULL,
    "detectionTier" "DetectionTier" NOT NULL DEFAULT 'observed',
    "automation" "AutomationClass" NOT NULL DEFAULT 'human-only',
    "autoFixable" BOOLEAN NOT NULL DEFAULT false,
    "thresholds" JSONB,
    "dataRequirements" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "docsUrl" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "deprecatedAt" TIMESTAMPTZ(6),

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "ruleSlug" VARCHAR(120) NOT NULL,
    "scope" "RuleScope" NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "severity" "Severity" NOT NULL,
    "status" "FindingStatus" NOT NULL DEFAULT 'failing',
    "affectedPages" INTEGER NOT NULL DEFAULT 0,
    "affectedInstances" INTEGER NOT NULL DEFAULT 0,
    "evaluatedPages" INTEGER NOT NULL DEFAULT 0,
    "reach" DOUBLE PRECISION,
    "importance" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "priority" SMALLINT NOT NULL DEFAULT 0,
    "damage" DOUBLE PRECISION,
    "effort" "EffortLevel" NOT NULL DEFAULT 'medium',
    "effortWhy" TEXT,
    "automation" "AutomationClass" NOT NULL DEFAULT 'human-only',
    "priorityFactors" JSONB,
    "evidenceSummary" TEXT,
    "sampleUrls" TEXT[],
    "skipReason" TEXT,
    "mutedAt" TIMESTAMPTZ(6),
    "mutedNote" TEXT,
    "firstSeenCrawlId" UUID,
    "firstSeenAt" TIMESTAMPTZ(6),

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "findingId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "ruleSlug" VARCHAR(120) NOT NULL,
    "pageId" UUID,
    "severity" "Severity" NOT NULL,
    "category" VARCHAR(60) NOT NULL,
    "message" TEXT NOT NULL,
    "evidencePaths" TEXT[],
    "evidence" JSONB,
    "relatedPageId" UUID,
    "priority" SMALLINT NOT NULL DEFAULT 0,
    "proposedFix" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rule_mutes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "siteId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "ruleSlug" VARCHAR(120) NOT NULL,
    "note" TEXT,
    "mutedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "rule_mutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "measurements" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "group" VARCHAR(60) NOT NULL,
    "displayOrder" SMALLINT NOT NULL,
    "value" DOUBLE PRECISION,
    "textValue" TEXT,
    "unit" "MeasurementUnit" NOT NULL DEFAULT 'count',
    "explainer" TEXT,
    "direction" "TrendDirection" NOT NULL DEFAULT 'neutral',
    "previousValue" DOUBLE PRECISION,
    "delta" DOUBLE PRECISION,
    "deltaPercent" DOUBLE PRECISION,
    "drilldownHref" TEXT,

    CONSTRAINT "measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log_entries" (
    "seq" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "ActivityLevel" NOT NULL DEFAULT 'info',
    "kind" "ActivityKind" NOT NULL DEFAULT 'request',
    "message" TEXT NOT NULL,
    "url" TEXT,
    "statusCode" SMALLINT,
    "depth" SMALLINT,
    "durationMs" INTEGER,
    "renderedWith" "RenderedWith",
    "progress" JSONB,
    "meta" JSONB,

    CONSTRAINT "activity_log_entries_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "site_files" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "SiteFileKind" NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" SMALLINT,
    "bytes" INTEGER,
    "parseStatus" "FileParseStatus" NOT NULL DEFAULT 'none',
    "fetchedAt" TIMESTAMPTZ(6),
    "contentPreview" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "declaredSitemaps" TEXT[],
    "error" TEXT,
    "meta" JSONB,
    "artifactId" UUID,

    CONSTRAINT "site_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_crawler_verdicts" (
    "id" UUID NOT NULL,
    "siteFileId" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "agent" VARCHAR(80) NOT NULL,
    "vendor" VARCHAR(80) NOT NULL,
    "purpose" VARCHAR(200) NOT NULL,
    "access" "AiAccessVerdict" NOT NULL DEFAULT 'unknown',
    "matchedGroup" VARCHAR(80),
    "disallowed" TEXT[],
    "displayOrder" SMALLINT NOT NULL,

    CONSTRAINT "ai_crawler_verdicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sitemap_files" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "parentId" UUID,
    "isIndex" BOOLEAN NOT NULL DEFAULT false,
    "gzipped" BOOLEAN NOT NULL DEFAULT false,
    "statusCode" SMALLINT,
    "urlCount" INTEGER NOT NULL DEFAULT 0,
    "parseStatus" "FileParseStatus" NOT NULL DEFAULT 'none',
    "error" TEXT,
    "fetchedAt" TIMESTAMPTZ(6),
    "lastmodStats" JSONB,

    CONSTRAINT "sitemap_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sitemap_entries" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "sitemapFileId" UUID NOT NULL,
    "loc" TEXT NOT NULL,
    "normalizedLoc" TEXT NOT NULL,
    "lastmod" TIMESTAMPTZ(6),
    "changefreq" VARCHAR(20),
    "priority" DOUBLE PRECISION,
    "crawled" BOOLEAN NOT NULL DEFAULT false,
    "pageId" UUID,
    "statusCode" SMALLINT,
    "inScope" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sitemap_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "failures" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "failureClass" "FailureClass" NOT NULL,
    "statusCode" SMALLINT,
    "attempts" SMALLINT NOT NULL DEFAULT 1,
    "depth" SMALLINT,
    "parentUrl" TEXT,
    "errorMessage" TEXT,
    "errorReason" VARCHAR(200),
    "firstSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMPTZ(6),

    CONSTRAINT "failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocked_urls" (
    "id" BIGSERIAL NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "reason" "BlockedReason" NOT NULL,
    "matchedPattern" VARCHAR(200),
    "robotsRule" TEXT,
    "robotsLine" SMALLINT,
    "robotsSource" TEXT,
    "foundOn" TEXT,
    "depth" SMALLINT,

    CONSTRAINT "blocked_urls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_groups" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "DuplicateKind" NOT NULL,
    "hash" CHAR(64),
    "similarity" DOUBLE PRECISION,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "sampleValue" TEXT,

    CONSTRAINT "duplicate_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "duplicate_group_members" (
    "groupId" UUID NOT NULL,
    "pageId" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "similarity" DOUBLE PRECISION,

    CONSTRAINT "duplicate_group_members_pkey" PRIMARY KEY ("groupId","pageId")
);

-- CreateTable
CREATE TABLE "run_comparisons" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "ComparisonKind" NOT NULL DEFAULT 'historical',
    "baseCrawlId" UUID NOT NULL,
    "headCrawlId" UUID NOT NULL,
    "generatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pagesAdded" INTEGER NOT NULL DEFAULT 0,
    "pagesRemoved" INTEGER NOT NULL DEFAULT 0,
    "pagesChanged" INTEGER NOT NULL DEFAULT 0,
    "pagesUnchanged" INTEGER NOT NULL DEFAULT 0,
    "newIssueCount" INTEGER NOT NULL DEFAULT 0,
    "fixedIssueCount" INTEGER NOT NULL DEFAULT 0,
    "persistingIssueCount" INTEGER NOT NULL DEFAULT 0,
    "churnedIssueCount" INTEGER NOT NULL DEFAULT 0,
    "healthDelta" DOUBLE PRECISION,
    "issueDiffAvailable" BOOLEAN NOT NULL DEFAULT false,
    "summary" JSONB,

    CONSTRAINT "run_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_diff_entries" (
    "id" BIGSERIAL NOT NULL,
    "comparisonId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "changeKind" "DiffChangeKind" NOT NULL,
    "pageKey" CHAR(12),
    "url" TEXT,
    "basePageId" UUID,
    "headPageId" UUID,
    "ruleSlug" VARCHAR(120),
    "field" VARCHAR(80),
    "baseValue" TEXT,
    "headValue" TEXT,
    "delta" DOUBLE PRECISION,
    "severity" "Severity",

    CONSTRAINT "run_diff_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" UUID NOT NULL,
    "crawlId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "pageId" UUID,
    "kind" "ArtifactKind" NOT NULL,
    "bucket" VARCHAR(60) NOT NULL,
    "path" TEXT NOT NULL,
    "contentType" VARCHAR(120) NOT NULL,
    "bytes" BIGINT NOT NULL DEFAULT 0,
    "rawBytes" BIGINT,
    "compression" VARCHAR(20),
    "checksum" CHAR(64),
    "capturedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6),

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "projects_ownerId_idx" ON "projects"("ownerId");

-- CreateIndex
CREATE INDEX "projects_deletedAt_idx" ON "projects"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "projects_ownerId_slug_key" ON "projects"("ownerId", "slug");

-- CreateIndex
CREATE INDEX "project_members_userId_idx" ON "project_members"("userId");

-- CreateIndex
CREATE INDEX "sites_projectId_role_idx" ON "sites"("projectId", "role");

-- CreateIndex
CREATE INDEX "sites_host_idx" ON "sites"("host");

-- CreateIndex
CREATE UNIQUE INDEX "sites_projectId_host_role_key" ON "sites"("projectId", "host", "role");

-- CreateIndex
CREATE INDEX "crawl_schedules_enabled_nextRunAt_idx" ON "crawl_schedules"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "crawl_schedules_projectId_idx" ON "crawl_schedules"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "crawl_jobs_crawlId_key" ON "crawl_jobs"("crawlId");

-- CreateIndex
CREATE INDEX "crawl_jobs_state_priority_queuedAt_idx" ON "crawl_jobs"("state", "priority" DESC, "queuedAt");

-- CreateIndex
CREATE INDEX "crawl_jobs_projectId_queuedAt_idx" ON "crawl_jobs"("projectId", "queuedAt" DESC);

-- CreateIndex
CREATE INDEX "crawl_jobs_siteId_state_idx" ON "crawl_jobs"("siteId", "state");

-- CreateIndex
CREATE INDEX "crawl_jobs_state_heartbeatAt_idx" ON "crawl_jobs"("state", "heartbeatAt");

-- CreateIndex
CREATE INDEX "crawls_siteId_startedAt_idx" ON "crawls"("siteId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "crawls_projectId_startedAt_idx" ON "crawls"("projectId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "crawls_status_startedAt_idx" ON "crawls"("status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "crawls_siteId_status_finishedAt_idx" ON "crawls"("siteId", "status", "finishedAt" DESC);

-- CreateIndex
CREATE INDEX "crawls_configHash_idx" ON "crawls"("configHash");

-- CreateIndex
CREATE UNIQUE INDEX "crawls_siteId_slug_key" ON "crawls"("siteId", "slug");

-- CreateIndex
CREATE INDEX "pages_crawlId_statusCode_idx" ON "pages"("crawlId", "statusCode");

-- CreateIndex
CREATE INDEX "pages_crawlId_depth_idx" ON "pages"("crawlId", "depth");

-- CreateIndex
CREATE INDEX "pages_crawlId_score_idx" ON "pages"("crawlId", "score" DESC);

-- CreateIndex
CREATE INDEX "pages_crawlId_issueCount_idx" ON "pages"("crawlId", "issueCount" DESC);

-- CreateIndex
CREATE INDEX "pages_crawlId_wordCount_idx" ON "pages"("crawlId", "wordCount");

-- CreateIndex
CREATE INDEX "pages_crawlId_responseTimeMs_idx" ON "pages"("crawlId", "responseTimeMs" DESC);

-- CreateIndex
CREATE INDEX "pages_crawlId_titleLength_idx" ON "pages"("crawlId", "titleLength");

-- CreateIndex
CREATE INDEX "pages_crawlId_metaDescriptionLength_idx" ON "pages"("crawlId", "metaDescriptionLength");

-- CreateIndex
CREATE INDEX "pages_crawlId_imagesMissingAlt_idx" ON "pages"("crawlId", "imagesMissingAlt");

-- CreateIndex
CREATE INDEX "pages_crawlId_inlinkCount_idx" ON "pages"("crawlId", "inlinkCount");

-- CreateIndex
CREATE INDEX "pages_crawlId_internalRank_idx" ON "pages"("crawlId", "internalRank" DESC);

-- CreateIndex
CREATE INDEX "pages_crawlId_section_idx" ON "pages"("crawlId", "section");

-- CreateIndex
CREATE INDEX "pages_crawlId_renderedWith_idx" ON "pages"("crawlId", "renderedWith");

-- CreateIndex
CREATE INDEX "pages_crawlId_contentHash_idx" ON "pages"("crawlId", "contentHash");

-- CreateIndex
CREATE INDEX "pages_crawlId_normalizedUrl_idx" ON "pages"("crawlId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "pages_crawlId_pageType_idx" ON "pages"("crawlId", "pageType");

-- CreateIndex
CREATE INDEX "pages_projectId_idx" ON "pages"("projectId");

-- CreateIndex
CREATE INDEX "pages_duplicateGroupId_idx" ON "pages"("duplicateGroupId");

-- CreateIndex
CREATE INDEX "pages_structuredDataTypes_idx" ON "pages" USING GIN ("structuredDataTypes");

-- CreateIndex
CREATE INDEX "pages_renderSignals_idx" ON "pages" USING GIN ("renderSignals");

-- CreateIndex
CREATE UNIQUE INDEX "pages_crawlId_pageKey_key" ON "pages"("crawlId", "pageKey");

-- CreateIndex
CREATE INDEX "page_contents_crawlId_idx" ON "page_contents"("crawlId");

-- CreateIndex
CREATE INDEX "page_links_pageId_position_idx" ON "page_links"("pageId", "position");

-- CreateIndex
CREATE INDEX "page_links_crawlId_targetNormalized_idx" ON "page_links"("crawlId", "targetNormalized");

-- CreateIndex
CREATE INDEX "page_links_targetPageId_idx" ON "page_links"("targetPageId");

-- CreateIndex
CREATE INDEX "page_links_crawlId_scope_targetStatusCode_idx" ON "page_links"("crawlId", "scope", "targetStatusCode");

-- CreateIndex
CREATE INDEX "page_links_crawlId_targetHost_idx" ON "page_links"("crawlId", "targetHost");

-- CreateIndex
CREATE INDEX "page_images_pageId_position_idx" ON "page_images"("pageId", "position");

-- CreateIndex
CREATE INDEX "page_images_crawlId_url_idx" ON "page_images"("crawlId", "url");

-- CreateIndex
CREATE INDEX "page_images_crawlId_altState_idx" ON "page_images"("crawlId", "altState");

-- CreateIndex
CREATE INDEX "page_images_crawlId_sizeBytes_idx" ON "page_images"("crawlId", "sizeBytes" DESC);

-- CreateIndex
CREATE INDEX "page_media_pageId_position_idx" ON "page_media"("pageId", "position");

-- CreateIndex
CREATE INDEX "page_media_crawlId_kind_idx" ON "page_media"("crawlId", "kind");

-- CreateIndex
CREATE INDEX "page_headings_pageId_position_idx" ON "page_headings"("pageId", "position");

-- CreateIndex
CREATE INDEX "page_headings_crawlId_level_idx" ON "page_headings"("crawlId", "level");

-- CreateIndex
CREATE INDEX "structured_data_items_pageId_position_idx" ON "structured_data_items"("pageId", "position");

-- CreateIndex
CREATE INDEX "structured_data_items_crawlId_format_idx" ON "structured_data_items"("crawlId", "format");

-- CreateIndex
CREATE INDEX "structured_data_items_types_idx" ON "structured_data_items" USING GIN ("types");

-- CreateIndex
CREATE INDEX "page_redirect_hops_crawlId_idx" ON "page_redirect_hops"("crawlId");

-- CreateIndex
CREATE UNIQUE INDEX "page_redirect_hops_pageId_hopIndex_key" ON "page_redirect_hops"("pageId", "hopIndex");

-- CreateIndex
CREATE INDEX "link_targets_crawlId_refCount_idx" ON "link_targets"("crawlId", "refCount" DESC);

-- CreateIndex
CREATE INDEX "link_targets_crawlId_scope_statusCode_idx" ON "link_targets"("crawlId", "scope", "statusCode");

-- CreateIndex
CREATE INDEX "link_targets_crawlId_host_idx" ON "link_targets"("crawlId", "host");

-- CreateIndex
CREATE UNIQUE INDEX "link_targets_crawlId_url_key" ON "link_targets"("crawlId", "url");

-- CreateIndex
CREATE INDEX "image_assets_crawlId_sizeBytes_idx" ON "image_assets"("crawlId", "sizeBytes" DESC);

-- CreateIndex
CREATE INDEX "image_assets_crawlId_refCount_idx" ON "image_assets"("crawlId", "refCount" DESC);

-- CreateIndex
CREATE INDEX "image_assets_crawlId_missingAltCount_idx" ON "image_assets"("crawlId", "missingAltCount");

-- CreateIndex
CREATE UNIQUE INDEX "image_assets_crawlId_url_key" ON "image_assets"("crawlId", "url");

-- CreateIndex
CREATE INDEX "rules_scope_category_idx" ON "rules"("scope", "category");

-- CreateIndex
CREATE INDEX "rules_enabled_defaultSeverity_idx" ON "rules"("enabled", "defaultSeverity");

-- CreateIndex
CREATE INDEX "rules_automation_idx" ON "rules"("automation");

-- CreateIndex
CREATE UNIQUE INDEX "rules_projectId_slug_version_key" ON "rules"("projectId", "slug", "version");

-- CreateIndex
CREATE INDEX "findings_crawlId_priority_idx" ON "findings"("crawlId", "priority" DESC);

-- CreateIndex
CREATE INDEX "findings_crawlId_status_severity_idx" ON "findings"("crawlId", "status", "severity");

-- CreateIndex
CREATE INDEX "findings_crawlId_category_idx" ON "findings"("crawlId", "category");

-- CreateIndex
CREATE INDEX "findings_crawlId_automation_idx" ON "findings"("crawlId", "automation");

-- CreateIndex
CREATE INDEX "findings_projectId_idx" ON "findings"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "findings_crawlId_ruleSlug_key" ON "findings"("crawlId", "ruleSlug");

-- CreateIndex
CREATE INDEX "issues_findingId_priority_idx" ON "issues"("findingId", "priority" DESC);

-- CreateIndex
CREATE INDEX "issues_pageId_severity_idx" ON "issues"("pageId", "severity");

-- CreateIndex
CREATE INDEX "issues_crawlId_ruleSlug_idx" ON "issues"("crawlId", "ruleSlug");

-- CreateIndex
CREATE INDEX "issues_crawlId_severity_idx" ON "issues"("crawlId", "severity");

-- CreateIndex
CREATE INDEX "issues_projectId_idx" ON "issues"("projectId");

-- CreateIndex
CREATE INDEX "rule_mutes_projectId_idx" ON "rule_mutes"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "rule_mutes_siteId_ruleSlug_key" ON "rule_mutes"("siteId", "ruleSlug");

-- CreateIndex
CREATE INDEX "measurements_crawlId_group_displayOrder_idx" ON "measurements"("crawlId", "group", "displayOrder");

-- CreateIndex
CREATE INDEX "measurements_projectId_key_idx" ON "measurements"("projectId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "measurements_crawlId_key_key" ON "measurements"("crawlId", "key");

-- CreateIndex
CREATE INDEX "activity_log_entries_crawlId_seq_idx" ON "activity_log_entries"("crawlId", "seq");

-- CreateIndex
CREATE INDEX "activity_log_entries_crawlId_level_seq_idx" ON "activity_log_entries"("crawlId", "level", "seq");

-- CreateIndex
CREATE INDEX "activity_log_entries_projectId_idx" ON "activity_log_entries"("projectId");

-- CreateIndex
CREATE INDEX "site_files_crawlId_kind_idx" ON "site_files"("crawlId", "kind");

-- CreateIndex
CREATE INDEX "site_files_projectId_idx" ON "site_files"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "site_files_crawlId_kind_url_key" ON "site_files"("crawlId", "kind", "url");

-- CreateIndex
CREATE INDEX "ai_crawler_verdicts_crawlId_access_idx" ON "ai_crawler_verdicts"("crawlId", "access");

-- CreateIndex
CREATE INDEX "ai_crawler_verdicts_projectId_idx" ON "ai_crawler_verdicts"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_crawler_verdicts_crawlId_agent_key" ON "ai_crawler_verdicts"("crawlId", "agent");

-- CreateIndex
CREATE INDEX "sitemap_files_crawlId_idx" ON "sitemap_files"("crawlId");

-- CreateIndex
CREATE INDEX "sitemap_files_parentId_idx" ON "sitemap_files"("parentId");

-- CreateIndex
CREATE INDEX "sitemap_files_projectId_idx" ON "sitemap_files"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "sitemap_files_crawlId_url_key" ON "sitemap_files"("crawlId", "url");

-- CreateIndex
CREATE INDEX "sitemap_entries_crawlId_crawled_idx" ON "sitemap_entries"("crawlId", "crawled");

-- CreateIndex
CREATE INDEX "sitemap_entries_sitemapFileId_idx" ON "sitemap_entries"("sitemapFileId");

-- CreateIndex
CREATE INDEX "sitemap_entries_pageId_idx" ON "sitemap_entries"("pageId");

-- CreateIndex
CREATE INDEX "sitemap_entries_projectId_idx" ON "sitemap_entries"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "sitemap_entries_crawlId_normalizedLoc_key" ON "sitemap_entries"("crawlId", "normalizedLoc");

-- CreateIndex
CREATE INDEX "failures_crawlId_failureClass_idx" ON "failures"("crawlId", "failureClass");

-- CreateIndex
CREATE INDEX "failures_crawlId_statusCode_idx" ON "failures"("crawlId", "statusCode");

-- CreateIndex
CREATE INDEX "failures_projectId_idx" ON "failures"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "failures_crawlId_normalizedUrl_key" ON "failures"("crawlId", "normalizedUrl");

-- CreateIndex
CREATE INDEX "blocked_urls_crawlId_reason_idx" ON "blocked_urls"("crawlId", "reason");

-- CreateIndex
CREATE INDEX "blocked_urls_projectId_idx" ON "blocked_urls"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "blocked_urls_crawlId_normalizedUrl_reason_key" ON "blocked_urls"("crawlId", "normalizedUrl", "reason");

-- CreateIndex
CREATE INDEX "duplicate_groups_crawlId_kind_memberCount_idx" ON "duplicate_groups"("crawlId", "kind", "memberCount" DESC);

-- CreateIndex
CREATE INDEX "duplicate_groups_crawlId_hash_idx" ON "duplicate_groups"("crawlId", "hash");

-- CreateIndex
CREATE INDEX "duplicate_groups_projectId_idx" ON "duplicate_groups"("projectId");

-- CreateIndex
CREATE INDEX "duplicate_group_members_pageId_idx" ON "duplicate_group_members"("pageId");

-- CreateIndex
CREATE INDEX "duplicate_group_members_crawlId_idx" ON "duplicate_group_members"("crawlId");

-- CreateIndex
CREATE INDEX "run_comparisons_projectId_generatedAt_idx" ON "run_comparisons"("projectId", "generatedAt" DESC);

-- CreateIndex
CREATE INDEX "run_comparisons_headCrawlId_idx" ON "run_comparisons"("headCrawlId");

-- CreateIndex
CREATE UNIQUE INDEX "run_comparisons_baseCrawlId_headCrawlId_kind_key" ON "run_comparisons"("baseCrawlId", "headCrawlId", "kind");

-- CreateIndex
CREATE INDEX "run_diff_entries_comparisonId_changeKind_id_idx" ON "run_diff_entries"("comparisonId", "changeKind", "id");

-- CreateIndex
CREATE INDEX "run_diff_entries_comparisonId_ruleSlug_idx" ON "run_diff_entries"("comparisonId", "ruleSlug");

-- CreateIndex
CREATE INDEX "run_diff_entries_projectId_idx" ON "run_diff_entries"("projectId");

-- CreateIndex
CREATE INDEX "artifacts_crawlId_kind_idx" ON "artifacts"("crawlId", "kind");

-- CreateIndex
CREATE INDEX "artifacts_pageId_kind_idx" ON "artifacts"("pageId", "kind");

-- CreateIndex
CREATE INDEX "artifacts_expiresAt_idx" ON "artifacts"("expiresAt");

-- CreateIndex
CREATE INDEX "artifacts_projectId_idx" ON "artifacts"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "artifacts_bucket_path_key" ON "artifacts"("bucket", "path");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sites" ADD CONSTRAINT "sites_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_schedules" ADD CONSTRAINT "crawl_schedules_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "crawl_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawls" ADD CONSTRAINT "crawls_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_contents" ADD CONSTRAINT "page_contents_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_links" ADD CONSTRAINT "page_links_targetPageId_fkey" FOREIGN KEY ("targetPageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_images" ADD CONSTRAINT "page_images_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_images" ADD CONSTRAINT "page_images_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_media" ADD CONSTRAINT "page_media_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_media" ADD CONSTRAINT "page_media_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_headings" ADD CONSTRAINT "page_headings_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_headings" ADD CONSTRAINT "page_headings_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_data_items" ADD CONSTRAINT "structured_data_items_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "structured_data_items" ADD CONSTRAINT "structured_data_items_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_redirect_hops" ADD CONSTRAINT "page_redirect_hops_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page_redirect_hops" ADD CONSTRAINT "page_redirect_hops_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link_targets" ADD CONSTRAINT "link_targets_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_assets" ADD CONSTRAINT "image_assets_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_relatedPageId_fkey" FOREIGN KEY ("relatedPageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_mutes" ADD CONSTRAINT "rule_mutes_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_mutes" ADD CONSTRAINT "rule_mutes_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rule_mutes" ADD CONSTRAINT "rule_mutes_mutedById_fkey" FOREIGN KEY ("mutedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "measurements" ADD CONSTRAINT "measurements_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_log_entries" ADD CONSTRAINT "activity_log_entries_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_files" ADD CONSTRAINT "site_files_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_crawler_verdicts" ADD CONSTRAINT "ai_crawler_verdicts_siteFileId_fkey" FOREIGN KEY ("siteFileId") REFERENCES "site_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sitemap_files" ADD CONSTRAINT "sitemap_files_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sitemap_files" ADD CONSTRAINT "sitemap_files_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "sitemap_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_sitemapFileId_fkey" FOREIGN KEY ("sitemapFileId") REFERENCES "sitemap_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sitemap_entries" ADD CONSTRAINT "sitemap_entries_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failures" ADD CONSTRAINT "failures_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocked_urls" ADD CONSTRAINT "blocked_urls_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_groups" ADD CONSTRAINT "duplicate_groups_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_group_members" ADD CONSTRAINT "duplicate_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "duplicate_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "duplicate_group_members" ADD CONSTRAINT "duplicate_group_members_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_comparisons" ADD CONSTRAINT "run_comparisons_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_comparisons" ADD CONSTRAINT "run_comparisons_baseCrawlId_fkey" FOREIGN KEY ("baseCrawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_comparisons" ADD CONSTRAINT "run_comparisons_headCrawlId_fkey" FOREIGN KEY ("headCrawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_diff_entries" ADD CONSTRAINT "run_diff_entries_comparisonId_fkey" FOREIGN KEY ("comparisonId") REFERENCES "run_comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_diff_entries" ADD CONSTRAINT "run_diff_entries_basePageId_fkey" FOREIGN KEY ("basePageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_diff_entries" ADD CONSTRAINT "run_diff_entries_headPageId_fkey" FOREIGN KEY ("headPageId") REFERENCES "pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_crawlId_fkey" FOREIGN KEY ("crawlId") REFERENCES "crawls"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

