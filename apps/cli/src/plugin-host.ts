import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";
import { type InstallationPaths, parseEnvironment } from "./config";
import type { ComposeProject } from "./docker";
import { healthUrl } from "./health";
import type { CommandRunner } from "./process";

/** A plugin part installed on this machine, outside the containers, as the updated server ships it. */
export interface PluginHostComponent {
  key: string;
  name: string;
  version: string;
  installedMarker: string;
  refreshCommand: string[];
  files: Record<string, string>;
}

export interface HostRefreshResult {
  key: string;
  name: string;
  outcome: "refreshed" | "failed";
  detail?: string;
}

type Request = (input: URL, init: RequestInit) => Promise<Response>;

const relativePath = (value: unknown): value is string =>
  typeof value === "string" &&
  !!value &&
  !value.startsWith("/") &&
  normalize(value) === value &&
  !value.split("/").some((part) => !part || part === "." || part === "..");

const component = (value: unknown): value is PluginHostComponent => {
  const item = value as Partial<PluginHostComponent> | null;
  return (
    !!item &&
    typeof item.key === "string" &&
    typeof item.name === "string" &&
    relativePath(item.installedMarker) &&
    Array.isArray(item.refreshCommand) &&
    item.refreshCommand.length > 0 &&
    item.refreshCommand.every((part) => typeof part === "string" && part.length > 0) &&
    !!item.files &&
    typeof item.files === "object" &&
    Object.entries(item.files).every(([path, content]) => relativePath(path) && typeof content === "string")
  );
};

const lastLine = (text: string): string =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 300) ?? "";

const internal = (paths: InstallationPaths, path: string, request: Request, body?: unknown) =>
  request(new URL(`/api/v0/internal/plugins${path}`, healthUrl(paths)), {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${parseEnvironment(readFileSync(paths.environment, "utf8")).get("OPENTEAM_CONTROL_TOKEN") ?? ""}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    signal: AbortSignal.timeout(body === undefined ? 15_000 : 120_000),
  });

/**
 * Refresh plugin parts that an administrator installed on this machine (for example a bridge that keeps SSH keys
 * here), using the files the updated server ships, then restart that plugin's connections so they pick up its tools.
 * Parts that were never installed here are left alone. Each outcome is reported to the server, which shows it in the
 * plugin's activity; a failure never rolls back the update itself.
 */
export const refreshPluginHostComponents = async (
  paths: InstallationPaths,
  project: Pick<ComposeProject, "run">,
  runner: CommandRunner,
  options: { home?: string; request?: Request; onRefresh?: (name: string) => void } = {}
): Promise<HostRefreshResult[]> => {
  const request = options.request ?? ((input, init) => fetch(input, init));
  const response = await internal(paths, "/host-components", request).catch(() => null);
  if (!response?.ok) return []; // Servers before this release have no host components to offer.
  const body = (await response.json().catch(() => null)) as { components?: unknown } | null;
  const components = Array.isArray(body?.components) ? body.components.filter(component) : [];
  const home = options.home ?? homedir();
  const results: HostRefreshResult[] = [];
  for (const item of components) {
    if (!existsSync(join(home, item.installedMarker))) continue;
    options.onRefresh?.(item.name);
    const directory = mkdtempSync(join(tmpdir(), "openteam-plugin-host-"));
    let result: HostRefreshResult;
    try {
      for (const [path, content] of Object.entries(item.files)) {
        mkdirSync(dirname(join(directory, path)), { recursive: true, mode: 0o700 });
        writeFileSync(join(directory, path), content, { mode: 0o600 });
      }
      const container = project.run(["ps", "--quiet", "computer"]).stdout.trim().split("\n")[0]?.trim();
      if (!container) throw new Error("the computer container is not running");
      const [command, ...args] = item.refreshCommand.map((part) =>
        part.replaceAll("{computerContainer}", container)
      );
      const run = runner.run(command!, args, { cwd: directory, timeoutMs: 180_000 });
      if (run.status !== 0)
        throw new Error(lastLine(run.stderr) || lastLine(run.stdout) || `exit status ${run.status}`);
      result = { key: item.key, name: item.name, outcome: "refreshed" };
    } catch (error) {
      result = {
        key: item.key,
        name: item.name,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    await internal(paths, `/${encodeURIComponent(item.key)}/host-refresh`, request, {
      refreshed: result.outcome === "refreshed",
      ...(result.detail ? { detail: result.detail } : {}),
    }).catch(() => null);
    results.push(result);
  }
  return results;
};
