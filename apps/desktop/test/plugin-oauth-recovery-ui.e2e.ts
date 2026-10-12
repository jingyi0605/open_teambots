/** Disposable database, local OAuth provider and the real account UI. */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "../../computer/node_modules/playwright-core";
import { createPluginFlowFixture } from "../../server/test/plugin/fixtures/plugin-flow";
import { createOpenTeamClient } from "../../../packages/client-core/src";

if (!process.env.OPENTEAM_TEST_DATABASE_URL) throw new Error("A disposable test database is required");
const uiOrigin = process.env.OPENTEAM_TEST_UI_ORIGIN ?? "http://127.0.0.1:63387";
const output = resolve(import.meta.dirname, "../../../findings/oauth-recovery");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
try {
  for (const packaged of [true, false]) {
    const fixture = await createPluginFlowFixture(process.env.OPENTEAM_TEST_DATABASE_URL, { packaged, authSessions: ["browser-owner"], callbackMode: "manual" });
    const client = createOpenTeamClient({ baseUrl: fixture.server.url.origin, getAuthToken: () => "browser-owner" });
    const context = await browser.newContext({ viewport: { width: 1050, height: 900 } });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1") return route.abort();
      if (url.port === "42813" && url.pathname === "/callback") return route.abort("connectionrefused");
      return route.continue();
    });
    try {
      const pluginKey = fixture.definitions[packaged ? 0 : 1]!.key;
      await client.installPlugin(pluginKey);
      const account = (await client.pluginSettings()).installs.find(row => row.pluginKey === pluginKey)!.connections[0]!;
      fixture.provider.registerClient(account.id, "http://127.0.0.1:42813/callback", "fixture-secret");
      await client.savePluginConfiguration(account.id, { values: { clientId: account.id }, secrets: { clientSecret: { action: "replace", value: "fixture-secret" } } });
      const initial = await fixture.db.pluginConnection.findUniqueOrThrow({ where: { id: account.id } });
      await fixture.db.pluginConnection.update({ where: { id: account.id }, data: {
        status: "error", statusMessage: "Local runtime unavailable: Token has been expired or revoked.",
        credentials: { ...(initial.credentials as any), oauth: { tokens: { access_token: "expired", refresh_token: "revoked", token_type: "Bearer" }, tokensExpireAt: 1 } },
      } });
      const open = async () => {
        await page.goto(`${uiOrigin}/test/browser/plugin-lifecycle.html?server=${encodeURIComponent(fixture.server.url.origin)}&authSession=browser-owner&reviewPlugin=${encodeURIComponent(pluginKey)}`);
        await page.getByRole("button", { name: "Open plugin setup", exact: true }).click();
        await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
      };
      const signIn = async () => {
        const firstRequest = fixture.requests.length;
        await page.getByRole("button", { name: "Sign in", exact: true }).click();
        await page.getByText("Before you sign in", { exact: true }).waitFor();
        const actions = fixture.requests.slice(firstRequest).filter(request => request.method === "POST");
        assert(actions.some(request => request.path.endsWith("/authenticate")), "Sign in must call authenticate");
        assert(!actions.some(request => request.path.endsWith("/restart")), "Sign in must not restart rejected credentials");
        assert(await page.getByRole("button", { name: "Continue to browser", exact: true }).isEnabled(), "Sign-in action must release busy state");
        const pending = await fixture.db.pluginConnection.findUniqueOrThrow({ where: { id: account.id } });
        assert((pending.credentials as any).oauth.callbackSessionId === "browser-owner", "Authorization must belong to the signed-in user");
        const opened = context.waitForEvent("page");
        await page.getByRole("button", { name: "Continue to browser", exact: true }).click();
        const provider = await opened;
        const returned = context.waitForEvent("request", request => new URL(request.url()).port === "42813");
        await provider.getByRole("button", { name: "Authorize Account A", exact: true }).click();
        const callback = (await returned).url();
        await page.getByLabel("Browser address from sign-in", { exact: true }).fill(callback);
        await page.getByRole("button", { name: "Complete sign-in", exact: true }).click();
        await page.getByText("Connected", { exact: true }).first().waitFor();
        assert(JSON.stringify(await client.testPluginConnection(account.id, { toolName: "whoami", arguments: {} })).includes("Account A"), "Recovered account must execute a tool");
        await provider.close();
      };
      await open();
      await page.screenshot({ path: resolve(output, `${packaged ? "packaged" : "http"}-legacy-error.png`), fullPage: true });
      await signIn();
      if (packaged) {
        const connected = await fixture.db.pluginConnection.findUniqueOrThrow({ where: { id: account.id } });
        const credentials = connected.credentials as any;
        await fixture.db.pluginConnection.update({ where: { id: account.id }, data: { credentials: { ...credentials, oauth: { ...credentials.oauth, tokensExpireAt: 1 } } } });
        fixture.provider.setRefreshFailure({ error: "invalid_grant", error_description: "Token has been expired or revoked." });
        let rejected = false;
        try { await client.testPluginConnection(account.id, { toolName: "whoami", arguments: {} }); } catch { rejected = true; }
        assert(rejected, "Expired grant must fail the tool call");
        await open();
        await page.getByText("Sign-in needed", { exact: true }).waitFor();
        await page.screenshot({ path: resolve(output, "packaged-needs-auth.png"), fullPage: true });
        fixture.provider.setRefreshFailure(null);
        await signIn();
      }
      await page.screenshot({ path: resolve(output, `${packaged ? "packaged" : "http"}-recovered.png`), fullPage: true });
      assert(errors.length === 0, errors.join("\n"));
      console.log(`${packaged ? "Packaged" : "HTTP"} OAuth recovery UI passed`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, "failure.png"), fullPage: true });
      console.error(await page.locator("body").innerText());
      throw error;
    } finally { await context.close(); await fixture.close(); }
  }
} finally { await browser.close(); }
