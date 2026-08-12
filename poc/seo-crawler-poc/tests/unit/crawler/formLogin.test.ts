import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { performFormLogin, cookiesToHeader } from "../../../src/crawler/formLogin";
import type { FormLoginConfig } from "../../../src/models/types";

const VALID_USER = "testuser";
const VALID_PASS = "testpass";

/** Minimal stand-in for target-site's /login + /api/session flow: real form, real 303 redirect,
 * real Set-Cookie — so the test exercises actual browser navigation/cookie behavior, not mocks. */
function startTestServer(): Promise<{ server: http.Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");

      if (req.method === "GET" && url.pathname === "/login") {
        const errNotice = url.searchParams.get("error") ? `<p id="login-error">Invalid credentials</p>` : "";
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><body>
          ${errNotice}
          <form action="/session" method="POST">
            <input name="username" />
            <input name="password" type="password" />
            <button type="submit">Log in</button>
          </form>
        </body></html>`);
        return;
      }

      if (req.method === "GET" && url.pathname === "/no-form") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><body><p>No login form here.</p></body></html>`);
        return;
      }

      if (req.method === "POST" && url.pathname === "/session") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          const params = new URLSearchParams(body);
          if (params.get("username") === VALID_USER && params.get("password") === VALID_PASS) {
            res.writeHead(303, { Location: "/dashboard", "Set-Cookie": "session=abc123; Path=/; HttpOnly" });
            res.end();
          } else {
            res.writeHead(303, { Location: "/login?error=1" });
            res.end();
          }
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/dashboard") {
        res.writeHead(200, { "content-type": "text/html" });
        res.end(`<html><body><div id="welcome">Welcome back</div></body></html>`);
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

function configFor(baseUrl: string, overrides: Partial<FormLoginConfig> = {}): FormLoginConfig {
  return {
    loginUrl: `${baseUrl}/login`,
    usernameSelector: "input[name=username]",
    passwordSelector: "input[type=password]",
    submitSelector: "button[type=submit]",
    username: VALID_USER,
    password: VALID_PASS,
    successSelector: null,
    ...overrides,
  };
}

describe("performFormLogin", () => {
  let server: http.Server;
  let baseUrl: string;
  let browser: Browser;
  let context: BrowserContext;

  beforeAll(async () => {
    ({ server, baseUrl } = await startTestServer());
    browser = await chromium.launch();
  }, 30000);

  afterAll(async () => {
    await browser.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    context = await browser.newContext();
  });

  afterEach(async () => {
    await context.close();
  });

  it("succeeds with correct credentials and captures the session cookie", async () => {
    const result = await performFormLogin(configFor(baseUrl), context);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    const session = result.cookies.find((c) => c.name === "session");
    expect(session?.value).toBe("abc123");
  }, 20000);

  it("succeeds and verifies via successSelector when configured", async () => {
    const result = await performFormLogin(configFor(baseUrl, { successSelector: "#welcome" }), context);

    expect(result.ok).toBe(true);
    expect(result.cookies.some((c) => c.name === "session")).toBe(true);
  }, 20000);

  it("fails on wrong credentials — no cookie set, ok:false with a reason", async () => {
    const result = await performFormLogin(configFor(baseUrl, { password: "wrong-password" }), context);

    expect(result.ok).toBe(false);
    expect(result.cookies).toEqual([]);
    expect(result.error).toBeTruthy();
  }, 20000);

  it("fails on wrong credentials when successSelector is configured — never appears", async () => {
    const result = await performFormLogin(
      configFor(baseUrl, { password: "wrong-password", successSelector: "#welcome" }),
      context,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/successSelector/);
  }, 20000);

  it("never throws on a bad username selector — returns ok:false with a clear reason", async () => {
    const result = await performFormLogin(configFor(baseUrl, { usernameSelector: "input[name=does-not-exist]" }), context);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 20000);

  it("never throws when the login page has no form at all", async () => {
    const result = await performFormLogin(configFor(baseUrl, { loginUrl: `${baseUrl}/no-form` }), context);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 20000);

  it("never throws on an unreachable loginUrl", async () => {
    const result = await performFormLogin(configFor("http://127.0.0.1:1"), context);

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  }, 20000);
});

describe("cookiesToHeader", () => {
  it("joins name=value pairs with '; '", () => {
    const header = cookiesToHeader([
      { name: "session", value: "abc123", domain: "example.com", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" },
      { name: "csrf", value: "xyz", domain: "example.com", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" },
    ]);
    expect(header).toBe("session=abc123; csrf=xyz");
  });

  it("returns an empty string for no cookies", () => {
    expect(cookiesToHeader([])).toBe("");
  });
});
