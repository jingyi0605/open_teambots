import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installationPaths, writeFileAtomic } from "../src/config";
import { refreshPluginHostComponents } from "../src/plugin-host";
import type { CommandRunner, RunOptions } from "../src/process";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
const temporary = (prefix: string) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
};

const setup = () => {
  const paths = installationPaths(temporary("openteam-cli-plugin-host-"));
  writeFileAtomic(paths.environment, "OPENTEAM_CONTROL_TOKEN=control-secret\nOPENTEAM_API_PORT=18899\n", 0o600);
  const home = temporary("openteam-cli-home-");
  const component = {
    key: "imessage-ssh",
    name: "iMessage (SSH)",
    version: "1.2.1",
    installedMarker: ".config/systemd/user/openteam-imessage.service",
    refreshCommand: ["python3", "connector/install-host.py", "--computer-container", "{computerContainer}"],
    files: { "connector/install-host.py": "print('installed')", "connector/reader.py": "# reader" },
  };
  const calls: Array<{ url: string; method: string; authorization: string | null }> = [];
  const request = async (input: URL, init: RequestInit) => {
    calls.push({ url: input.pathname, method: init.method!, authorization: new Headers(init.headers).get("authorization") });
    return input.pathname.endsWith("/host-components")
      ? Response.json({ components: [component, { key: "broken", installedMarker: "../escape", refreshCommand: [] }] })
      : Response.json({ restarted: [] });
  };
  const runs: Array<{ command: string; args: readonly string[]; cwd?: string; files: string[] }> = [];
  let status = 0;
  const runner: CommandRunner = {
    run(command: string, args: readonly string[], options: RunOptions = {}) {
      runs.push({
        command,
        args,
        cwd: options.cwd,
        files: ["connector/install-host.py", "connector/reader.py"].filter((file) => existsSync(join(options.cwd!, file))),
      });
      return { status, stdout: "", stderr: status ? "Traceback\nValueError: Expected one private Docker bridge network\n" : "" };
    },
  };
  const project = { run: () => ({ status: 0, stdout: "f00dcafe\n", stderr: "" }) };
  return { paths, home, request, calls, runs, runner, project, fail: () => (status = 1) };
};

test("a host part installed on this machine is refreshed from the update's files, then its plugin reconnects", async () => {
  const { paths, home, request, calls, runs, runner, project } = setup();
  mkdirSync(join(home, ".config/systemd/user"), { recursive: true });
  writeFileSync(join(home, ".config/systemd/user/openteam-imessage.service"), "[Service]");
  const announced: string[] = [];
  const results = await refreshPluginHostComponents(paths, project, runner, {
    home,
    request,
    onRefresh: (name) => announced.push(name),
  });
  expect(results).toEqual([{ key: "imessage-ssh", name: "iMessage (SSH)", outcome: "refreshed" }]);
  expect(announced).toEqual(["iMessage (SSH)"]);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.command).toBe("python3");
  expect(runs[0]!.args).toEqual(["connector/install-host.py", "--computer-container", "f00dcafe"]);
  expect(runs[0]!.files).toEqual(["connector/install-host.py", "connector/reader.py"]);
  expect(existsSync(runs[0]!.cwd!)).toBe(false); // The package copy is removed afterwards.
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    "GET /api/v0/internal/plugins/host-components",
    "POST /api/v0/internal/plugins/imessage-ssh/restart",
  ]);
  expect(calls.every((call) => call.authorization === "Bearer control-secret")).toBe(true);
});

test("parts that were never installed here are left alone", async () => {
  const { paths, home, request, calls, runs, runner, project } = setup();
  expect(await refreshPluginHostComponents(paths, project, runner, { home, request })).toEqual([]);
  expect(runs).toHaveLength(0);
  expect(calls).toHaveLength(1);
});

test("a failed refresh is reported with its cause and does not reconnect the plugin", async () => {
  const { paths, home, request, calls, runner, project, fail } = setup();
  mkdirSync(join(home, ".config/systemd/user"), { recursive: true });
  writeFileSync(join(home, ".config/systemd/user/openteam-imessage.service"), "[Service]");
  fail();
  expect(await refreshPluginHostComponents(paths, project, runner, { home, request })).toEqual([
    {
      key: "imessage-ssh",
      name: "iMessage (SSH)",
      outcome: "failed",
      detail: "ValueError: Expected one private Docker bridge network",
    },
  ]);
  expect(calls.map((call) => call.method)).toEqual(["GET"]);
});

test("a server without host components, or an unreachable one, refreshes nothing", async () => {
  const { paths, home, runner, project } = setup();
  for (const request of [
    async () => new Response("not found", { status: 404 }),
    async () => {
      throw new Error("connection refused");
    },
  ])
    expect(await refreshPluginHostComponents(paths, project, runner, { home, request })).toEqual([]);
  expect(readFileSync(paths.environment, "utf8")).toContain("control-secret");
});
