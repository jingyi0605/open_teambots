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

const internal = (paths: InstallationPaths, path: string, method: "GET" | "POST", request: Request) =>
  request(new URL(`/api/v0/internal/plugins${path}`, healthUrl(paths)), {
    method,
    headers: {
      authorization: `Bearer ${parseEnvironment(readFileSync(paths.environment, "utf8")).get("OPENTEAM_CONTROL_TOKEN") ?? ""}`,
    },
    redirect: "error",
    signal: AbortSignal.timeout(method === "POST" ? 120_000 : 15_000),
  });

/**
 * Refresh plugin parts that an administrator installed on this machine (for example a bridge that keeps SSH keys
 * here), using the files the updated server ships, then restart that plugin's connections so they pick up its tools.
 * Parts that were never installed here are left alone. A failure is reported, never rolled into the update itself.
 */
export const refreshPluginHostComponents = async (
  paths: InstallationPaths,
  project: Pick<ComposeProject, "run">,
  runner: CommandRunner,
  options: { home?: string; request?: Request; onRefresh?: (name: string) => void } = {}
): Promise<HostRefreshResult[]> => {
  const request = options.request ?? ((input, init) => fetch(input, init));
  const response = await internal(paths, "/host-components", "GET", request).catch(() => null);
  if (!response?.ok) return []; // Servers before this release have no host components to offer.
  const body = (await response.json().catch(() => null)) as { components?: unknown } | null;
  const components = Array.isArray(body?.components) ? body.components.filter(component) : [];
  const home = options.home ?? homedir();
  const results: HostRefreshResult[] = [];
  for (const item of components) {
    if (!existsSync(join(home, item.installedMarker))) continue;
    options.onRefresh?.(item.name);
    const directory = mkdtempSync(join(tmpdir(), "openteam-plugin-host-"));
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
      const result = runner.run(command!, args, { cwd: directory, timeoutMs: 180_000 });
      if (result.status !== 0)
        throw new Error(lastLine(result.stderr) || lastLine(result.stdout) || `exit status ${result.status}`);
      await internal(paths, `/${encodeURIComponent(item.key)}/restart`, "POST", request).catch(() => null);
      results.push({ key: item.key, name: item.name, outcome: "refreshed" });
    } catch (error) {
      results.push({
        key: item.key,
        name: item.name,
        outcome: "failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
  return results;
};
