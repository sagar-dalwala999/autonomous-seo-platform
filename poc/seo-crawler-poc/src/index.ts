/** Slice S4 implements the real arg parsing + wiring. */
import { parseArgs } from "node:util";
import { runCrawl } from "./crawler/crawl";
import { defaultSafety } from "./crawler/safety";
import { printSummary } from "./report/summary";
import type { CrawlAuth, CrawlOptions, CrawlSafety, FormLoginConfig } from "./models/types";

const HELP_TEXT = `
seo-crawler-poc — POC-1 CLI crawler for the Autonomous SEO Platform

Usage:
  npm run crawl -- <startUrl> [options]

Options:
  --max-pages N       Max pages to crawl (default: 200; 0 = no limit, crawl the whole site)
  --max-depth N       Max link-hops from the start URL (default: unlimited; 0 = start URL only)
  --concurrency N      Max concurrent requests (default: 5)
  --no-robots          Ignore robots.txt (evidence is still recorded; enforcement is skipped)
  --render MODE         auto | never | always (default: auto)
  --out DIR            Output directory for run evidence (default: storage)
  --alias host[,host]  Extra hostnames treated as this site (e.g. staging-domain crawls)
  --rps N               Requests/sec cap (default: 10 for localhost/127.*, 2 otherwise)
  --run-id ID           Run identifier (default: <hostname>-<yyyymmdd-hhmmss>)
  --check-external      HEAD-check up to 50 unique external link targets after the crawl
                         (rps <= 2, 10s timeout) -> external-links.json. Off by default.
  --basic-auth user:pass  HTTP Basic auth credentials for protected routes
  --cookie "<header>"     Raw Cookie header value (e.g. "session=abc; csrf=xyz")
  --header "Name: Value"  Extra request header, repeatable (API tokens, WAF bypass tokens)
  --exclude a,b,c         Comma-separated path substrings to always skip
  --no-safety             Disable logout/destructive guard rails (UNSAFE on authenticated crawls)

  Auth step 2 — browser-driven form login (for sites a pasted cookie can't reach):
  --login-url URL              Login page URL (required to enable form login)
  --login-user USER            Username (required with --login-url)
  --login-pass PASS            Password (required with --login-url)
  --login-user-selector SEL    Username field selector (default: input[name=username])
  --login-pass-selector SEL    Password field selector (default: input[type=password])
  --login-submit-selector SEL  Submit button selector (default: button[type=submit])
  --login-success-selector SEL Optional selector that must appear post-login to confirm success

  -h, --help            Show this help

Exit codes:
  0  crawl completed, no failures
  2  crawl completed, one or more URLs failed
  1  fatal error (invalid arguments, crawl could not start)
`.trim();

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function defaultRunId(hostname: string): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `${hostname}-${stamp}`;
}

function parseStartUrl(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    // allow "localhost:3105" style input without an explicit scheme
    return new URL(`http://${raw}`);
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      "max-pages": { type: "string" },
      "max-depth": { type: "string" },
      concurrency: { type: "string" },
      "no-robots": { type: "boolean" },
      render: { type: "string" },
      out: { type: "string" },
      alias: { type: "string" },
      rps: { type: "string" },
      "run-id": { type: "string" },
      "check-external": { type: "boolean" },
      "basic-auth": { type: "string" },
      cookie: { type: "string" },
      header: { type: "string", multiple: true },
      exclude: { type: "string" },
      "no-safety": { type: "boolean" },
      "login-url": { type: "string" },
      "login-user": { type: "string" },
      "login-pass": { type: "string" },
      "login-user-selector": { type: "string" },
      "login-pass-selector": { type: "string" },
      "login-submit-selector": { type: "string" },
      "login-success-selector": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const rawStartUrl = positionals[0];
  if (!rawStartUrl) {
    console.error("Error: missing <startUrl>.\n");
    console.log(HELP_TEXT);
    process.exit(1);
  }

  let parsedStart: URL;
  try {
    parsedStart = parseStartUrl(rawStartUrl);
  } catch {
    console.error(`Error: could not parse start URL: ${rawStartUrl}`);
    process.exit(1);
    return;
  }

  const renderRaw = values.render ?? "auto";
  if (renderRaw !== "auto" && renderRaw !== "never" && renderRaw !== "always") {
    console.error(`Error: --render must be one of auto|never|always (got "${renderRaw}")`);
    process.exit(1);
  }
  const render = renderRaw as "auto" | "never" | "always";

  const maxPagesRaw = Number(values["max-pages"] ?? "200");
  const concurrency = Number(values.concurrency ?? "5");
  if (!Number.isFinite(maxPagesRaw) || maxPagesRaw < 0) {
    console.error(`Error: --max-pages must be 0 (no limit) or a positive number (got "${values["max-pages"]}")`);
    process.exit(1);
  }
  // 0 = crawl-all sentinel; internally a huge number so every budget comparison stays plain math.
  const maxPages = maxPagesRaw === 0 ? Number.MAX_SAFE_INTEGER : maxPagesRaw;
  if (!Number.isFinite(concurrency) || concurrency <= 0) {
    console.error(`Error: --concurrency must be a positive number (got "${values.concurrency}")`);
    process.exit(1);
  }

  let maxDepth: number | null = null;
  if (values["max-depth"] !== undefined) {
    maxDepth = Number(values["max-depth"]);
    if (!Number.isInteger(maxDepth) || maxDepth < 0) {
      console.error(`Error: --max-depth must be a non-negative integer (got "${values["max-depth"]}")`);
      process.exit(1);
    }
  }

  const isLocalSeed = parsedStart.hostname === "localhost" || /^127\./.test(parsedStart.hostname);
  const rps = Number(values.rps ?? (isLocalSeed ? "10" : "2"));
  if (!Number.isFinite(rps) || rps <= 0) {
    console.error(`Error: --rps must be a positive number (got "${values.rps}")`);
    process.exit(1);
  }

  const hostAliases = values.alias
    ? values.alias.split(",").map((h) => h.trim()).filter(Boolean)
    : [];

  const runId = values["run-id"] ?? defaultRunId(parsedStart.hostname);

  let basic: { username: string; password: string } | null = null;
  if (values["basic-auth"] !== undefined) {
    const idx = values["basic-auth"].indexOf(":");
    if (idx === -1) {
      console.error(`Error: --basic-auth must be user:pass (got "${values["basic-auth"]}")`);
      process.exit(1);
    }
    basic = { username: values["basic-auth"].slice(0, idx), password: values["basic-auth"].slice(idx + 1) };
  }

  const customHeaders: Record<string, string> = {};
  for (const raw of values.header ?? []) {
    const idx = raw.indexOf(":");
    if (idx === -1) {
      console.error(`Error: --header must be "Name: Value" (got "${raw}")`);
      process.exit(1);
    }
    customHeaders[raw.slice(0, idx).trim()] = raw.slice(idx + 1).trim();
  }

  // Auth step 2 (C1): if ANY login-* flag is present, loginUrl + user + pass are all required —
  // a partially-specified form login is an operator mistake, not a silent skip.
  let formLogin: FormLoginConfig | null = null;
  if (values["login-url"] || values["login-user"] || values["login-pass"]) {
    if (!values["login-url"] || !values["login-user"] || !values["login-pass"]) {
      console.error("Error: --login-url, --login-user, and --login-pass must all be provided together for form login.");
      process.exit(1);
    }
    formLogin = {
      loginUrl: values["login-url"],
      username: values["login-user"],
      password: values["login-pass"],
      usernameSelector: values["login-user-selector"] ?? "input[name=username]",
      passwordSelector: values["login-pass-selector"] ?? "input[type=password]",
      submitSelector: values["login-submit-selector"] ?? "button[type=submit]",
      successSelector: values["login-success-selector"] ?? null,
    };
  }

  const cookie = values.cookie ?? null;
  const hasHeaderAuth = basic !== null || cookie !== null || Object.keys(customHeaders).length > 0;
  const auth: CrawlAuth | null = hasHeaderAuth || formLogin ? { basic, cookie, headers: customHeaders, formLogin } : null;

  const excludePatterns = values.exclude
    ? values.exclude.split(",").map((p) => p.trim()).filter(Boolean)
    : [];

  // defaultSafety() predates form login and only inspects basic/cookie/headers — form login is
  // authentication too, so OR its presence into the same asymmetric "strict when credentials are
  // present" default (see CrawlSafety doc comment in models/types.ts) without touching safety.ts.
  const baseSafety = defaultSafety(auth);
  const authenticated = baseSafety.denyLogout || formLogin !== null;
  let safety: CrawlSafety = { excludePatterns, denyLogout: authenticated, denyDestructive: authenticated };
  if (values["no-safety"]) {
    console.warn(
      "WARNING: --no-safety disables the logout/destructive guard rails. Unsafe on authenticated crawls " +
        "— the crawler may follow /logout or a destructive GET endpoint and disrupt its own session.",
    );
    safety = { ...safety, denyLogout: false, denyDestructive: false };
  }

  const options: CrawlOptions = {
    startUrl: parsedStart.toString(),
    maxPages,
    concurrency,
    respectRobots: !values["no-robots"],
    render,
    outDir: values.out ?? "storage",
    runId,
    userAgent: "seo-crawler-poc/0.1 (+poc; respectful)",
    maxRequestsPerSecond: rps,
    hostAliases,
    maxDepth,
    auth,
    safety,
  };

  const checkExternal = values["check-external"] === true;

  // Never print credentials — name the auth method only, never the value.
  const authLabel =
    formLogin !== null
      ? "form-login"
      : basic !== null
        ? "basic"
        : cookie !== null
          ? "cookie"
          : Object.keys(customHeaders).length > 0
            ? "headers"
            : "none";

  console.log(`Crawl started: ${options.startUrl}`);
  console.log(`  run-id: ${options.runId} | render: ${options.render} | robots: ${options.respectRobots} | max-pages: ${options.maxPages === Number.MAX_SAFE_INTEGER ? "all" : options.maxPages} | max-depth: ${options.maxDepth ?? "unlimited"} | check-external: ${checkExternal} | auth: ${authLabel}`);

  try {
    const summary = await runCrawl(options, checkExternal);
    printSummary(summary);
    process.exit(summary.failed > 0 ? 2 : 0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
