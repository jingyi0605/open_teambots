/** Disposable database and the real plugin dialog: setup-card fields must be saved before Connect. */
import { createPluginTemplate } from "@openteam/plugin-sdk";
import { chromium } from "../../computer/node_modules/playwright-core";
import { createPluginFlowFixture } from "../../server/test/plugin/fixtures/plugin-flow";

if (!process.env.OPENTEAM_TEST_DATABASE_URL)
  throw new Error("A disposable test database is required");
const databaseUrl = process.env.OPENTEAM_TEST_DATABASE_URL;
const uiOrigin = process.env.OPENTEAM_TEST_UI_ORIGIN ?? "http://127.0.0.1:63387";
const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
});
const assert = (value: unknown, message: string) => {
  if (!value) throw new Error(message);
};
type Fixture = Awaited<ReturnType<typeof createPluginFlowFixture>>;
const actionsSince = (fixture: Fixture, start: number) =>
  fixture.requests
    .slice(start)
    .filter((request) => request.method !== "GET")
    .map((request) => `${request.method} ${request.path}`);
const openPlugin = async (fixture: Fixture, pluginKey: string) => {
  const context = await browser.newContext({ viewport: { width: 1050, height: 900 } });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    `${uiOrigin}/test/browser/plugin-lifecycle.html?server=${encodeURIComponent(fixture.server.url.origin)}&reviewPlugin=${encodeURIComponent(pluginKey)}`
  );
  await page.getByRole("button", { name: "Open plugin setup", exact: true }).click();
  return { context, page, errors };
};
// The dialog ignores actions while installation is still settling.
const installed = (page: Awaited<ReturnType<typeof openPlugin>>["page"]) =>
  page.locator("button:enabled", { hasText: /^Uninstall$/ }).waitFor();

try {
  {
    const fixture = await createPluginFlowFixture(databaseUrl, { packaged: true });
    // A packaged connector whose only setup is a non-secret value, like iMessage (SSH)'s Mac address.
    const plugin = createPluginTemplate("packaged-mcp", `flow-address-${crypto.randomUUID()}`);
    plugin.name = "Flow Address";
    plugin.setupFields = [];
    const connector = plugin.connections[0]!;
    connector.configuration = { ...connector.configuration, env: { FLOW_ADDRESS: "${ADDRESS}" } };
    plugin.setup = {
      kind: "none",
      connectionKey: connector.key,
      title: "Connect your account",
      description: "Enter the account address once.",
      documentationUrl: null,
      requiredScopes: [],
      steps: ["Enter the address, then choose Connect."],
      fields: [{ key: "ADDRESS", label: "Account address", required: true, secret: false }],
    };
    fixture.definitions.push(plugin);
    try {
      const { page, errors } = await openPlugin(fixture, plugin.key);
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await installed(page);
      await page.getByLabel("Account address", { exact: true }).fill("  user@100.64.0.10 ");
      const start = fixture.requests.length;
      await page.getByRole("button", { name: "Connect", exact: true }).click();
      await page
        .getByText("Connected", { exact: true })
        .or(page.getByRole("alert"))
        .first()
        .waitFor();
      const actions = actionsSince(fixture, start);
      assert(
        /^PUT .*\/configuration$/.test(actions[0] ?? "") &&
          /^POST .*\/connect$/.test(actions[1] ?? ""),
        "Connect must save setup values first: " + actions.join(", ")
      );
      const account = await fixture.db.pluginConnection.findFirstOrThrow({
        where: { installation: { pluginKey: plugin.key } },
      });
      assert(
        (account.configuration as { values?: Record<string, unknown> }).values?.ADDRESS ===
          "user@100.64.0.10",
        "The entered address was not saved"
      );
      assert(account.status === "ready", "The account did not connect: " + account.statusMessage);
      assert(errors.length === 0, errors.join("\n"));
    } finally {
      await fixture.close();
    }
  }

  {
    const fixture = await createPluginFlowFixture(databaseUrl);
    // Dynamic OAuth that also needs a value first: sign-in must wait until it is saved.
    const plugin = structuredClone(fixture.definitions[0]!);
    plugin.key = `flow-oauth-workspace-${crypto.randomUUID()}`;
    plugin.name = "Flow OAuth Workspace";
    plugin.setup = {
      kind: "oauth",
      connectionKey: plugin.connections[0]!.key,
      title: "Connect your workspace",
      description: "Enter the workspace, then sign in.",
      documentationUrl: null,
      requiredScopes: [],
      steps: ["Enter the workspace, then continue."],
      fields: [{ key: "WORKSPACE", label: "Workspace", required: true, secret: false }],
    };
    fixture.definitions.push(plugin);
    try {
      const { context, page, errors } = await openPlugin(fixture, plugin.key);
      let start = fixture.requests.length;
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await installed(page);
      assert(
        !actionsSince(fixture, start).some((action) => action.endsWith("/authenticate")),
        "Sign-in started before the required field was entered"
      );
      assert(
        (await page.getByRole("alert").count()) === 0,
        "Installing showed an error before setup"
      );
      await page.getByLabel("Workspace", { exact: true }).fill("acme");
      start = fixture.requests.length;
      const opened = context.waitForEvent("page");
      await page.locator("[data-setup-action]").click();
      const provider = await opened;
      const actions = actionsSince(fixture, start);
      assert(
        /^PUT .*\/configuration$/.test(actions[0] ?? "") &&
          /^POST .*\/authenticate$/.test(actions[1] ?? ""),
        "Sign-in must save setup values first: " + actions.join(", ")
      );
      await provider.getByRole("button", { name: "Authorize Account A" }).click();
      await page.getByText("Connected", { exact: true }).first().waitFor();
      const account = await fixture.db.pluginConnection.findFirstOrThrow({
        where: { installation: { pluginKey: plugin.key } },
      });
      assert(
        (account.configuration as { values?: Record<string, unknown> }).values?.WORKSPACE ===
          "acme",
        "The entered workspace was not saved"
      );

      // Dynamic OAuth without setup fields still starts sign-in right after Add.
      const dynamic = fixture.definitions[0]!;
      const next = await openPlugin(fixture, dynamic.key);
      const signIn = next.context.waitForEvent("page");
      await next.page.getByRole("button", { name: "Add", exact: true }).click();
      await (await signIn).getByRole("button", { name: "Authorize Account A" }).waitFor();
      assert(
        errors.length === 0 && next.errors.length === 0,
        [...errors, ...next.errors].join("\n")
      );
    } finally {
      await fixture.close();
    }
  }
  console.log(
    "PASS: setup-card values are saved before connecting or signing in, and dynamic OAuth without fields still signs in right away."
  );
} finally {
  await browser.close();
}
