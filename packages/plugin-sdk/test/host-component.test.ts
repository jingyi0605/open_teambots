import { expect, test } from "bun:test";
import { createPluginTemplate, parsePluginDefinition } from "../src";
import { exportPackageArchive, importPackageArchive } from "../src/archive";

const withHost = (host: unknown) => ({ ...createPluginTemplate("hybrid", "host-example"), host });

test("a host component names its install marker and refresh command, and survives packaging", () => {
  const host = {
    installedMarker: ".config/systemd/user/example.service",
    refreshCommand: ["python3", "connector/install-host.py", "--computer-container", "{computerContainer}"],
  };
  const definition = parsePluginDefinition(withHost(host));
  expect(definition.host?.refreshCommand.at(-1)).toBe("{computerContainer}");
  expect(importPackageArchive(exportPackageArchive(definition)).definition.host).toEqual(host);
});

test("host components reject markers outside the home folder and unknown placeholders", () => {
  for (const host of [
    { installedMarker: "/etc/passwd", refreshCommand: ["true"] },
    { installedMarker: "../outside", refreshCommand: ["true"] },
    { installedMarker: ".config//double", refreshCommand: ["true"] },
    { installedMarker: ".config/example", refreshCommand: [] },
    { installedMarker: ".config/example", refreshCommand: ["python3", ""] },
    { installedMarker: ".config/example", refreshCommand: ["sh", "-c", "{home}/run"] },
    "python3 install-host.py",
  ])
    expect(() => parsePluginDefinition(withHost(host))).toThrow(/host component/);
});
