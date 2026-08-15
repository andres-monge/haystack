import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function repoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function writeExecutable(path: string, contents: string): void {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

function createInstallerFixture(hourlyPlist: string): {
  bootstrapState: string;
  home: string;
  installScript: string;
  tempRoot: string;
  trace: string;
} {
  const tempRoot = mkdtempSync(resolve(tmpdir(), "haystack-launchd-test-"));
  temporaryDirectories.push(tempRoot);

  const project = resolve(tempRoot, "project");
  const home = resolve(tempRoot, "home");
  const fakeBin = resolve(tempRoot, "bin");
  const bootstrapState = resolve(tempRoot, "bootstrap-attempted");
  const trace = resolve(tempRoot, "commands.log");
  mkdirSync(resolve(project, "scripts"), { recursive: true });
  mkdirSync(resolve(project, "launchd"), { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  const installScript = resolve(project, "scripts/launchd-install.sh");
  writeExecutable(installScript, repoFile("scripts/launchd-install.sh"));
  writeExecutable(resolve(project, "scripts/start-server.sh"), "#!/bin/sh\n");
  writeFileSync(
    resolve(project, "launchd/com.haystack.server.plist"),
    repoFile("launchd/com.haystack.server.plist"),
  );
  writeFileSync(
    resolve(project, "launchd/com.haystack.hourly.plist"),
    hourlyPlist,
  );
  writeFileSync(
    resolve(project, "launchd/haystack.newsyslog.conf"),
    repoFile("launchd/haystack.newsyslog.conf"),
  );

  writeExecutable(
    resolve(fakeBin, "plutil"),
    [
      "#!/bin/sh",
      'printf "plutil %s\\n" "$*" >> "$TRACE_FILE"',
      'grep -q "<plist" "$2"',
      "",
    ].join("\n"),
  );
  writeExecutable(
    resolve(fakeBin, "launchctl"),
    [
      "#!/bin/sh",
      'printf "launchctl %s\\n" "$*" >> "$TRACE_FILE"',
      'if [ "${FAIL_FIRST_BOOTSTRAP:-0}" = "1" ] && [ "$1" = "bootstrap" ] && [ ! -e "$BOOTSTRAP_STATE" ]; then',
      '  : > "$BOOTSTRAP_STATE"',
      '  echo "localized transient launchd teardown" >&2',
      "  exit 5",
      "fi",
      "",
    ].join("\n"),
  );
  writeExecutable(resolve(fakeBin, "sudo"), "#!/bin/sh\nexit 1\n");

  return { bootstrapState, home, installScript, tempRoot, trace };
}

function runInstaller(
  fixture: ReturnType<typeof createInstallerFixture>,
  extraEnv: NodeJS.ProcessEnv = {},
) {
  return spawnSync(fixture.installScript, [], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: `${resolve(fixture.tempRoot, "bin")}:${process.env.PATH ?? ""}`,
      TMPDIR: resolve(fixture.tempRoot, "tmp"),
      TRACE_FILE: fixture.trace,
      BOOTSTRAP_STATE: fixture.bootstrapState,
      ...extraEnv,
    },
  });
}

function installerTemporaryDirectories(tempRoot: string): string[] {
  return readdirSync(resolve(tempRoot, "tmp"), { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("haystack-launchd."),
    )
    .map((entry) => entry.name);
}

describe("launchd hourly backup trigger", () => {
  it("waits 660 seconds without curl transport retries", () => {
    const plist = repoFile("launchd/com.haystack.hourly.plist");

    expect(plist).toMatch(
      /<string>--max-time<\/string>\s*<string>660<\/string>/,
    );
    expect(plist).not.toMatch(
      /<string>--retry(?:-delay|-connrefused)?<\/string>/,
    );
  });

  it("validates rendered plists before touching launchd", () => {
    const fixture = createInstallerFixture(
      repoFile("launchd/com.haystack.hourly.plist"),
    );
    mkdirSync(resolve(fixture.tempRoot, "tmp"));

    const result = runInstaller(fixture);
    const commands = readFileSync(fixture.trace, "utf8").trim().split("\n");

    expect(result.status, result.stderr).toBe(0);
    expect(commands.slice(0, 2)).toEqual([
      expect.stringMatching(/^plutil -lint .*com\.haystack\.server\.plist$/),
      expect.stringMatching(/^plutil -lint .*com\.haystack\.hourly\.plist$/),
    ]);
    expect(commands[2]).toMatch(/^launchctl bootout /);
    expect(
      readFileSync(
        resolve(
          fixture.home,
          "Library/LaunchAgents/com.haystack.hourly.plist",
        ),
        "utf8",
      ),
    ).toContain("<string>660</string>");
    expect(installerTemporaryDirectories(fixture.tempRoot)).toEqual([]);
  });

  it("retries a transient launchd teardown race without reinstalling files", () => {
    const fixture = createInstallerFixture(
      repoFile("launchd/com.haystack.hourly.plist"),
    );
    mkdirSync(resolve(fixture.tempRoot, "tmp"));

    const result = runInstaller(fixture, { FAIL_FIRST_BOOTSTRAP: "1" });
    const commands = readFileSync(fixture.trace, "utf8").trim().split("\n");
    const bootstrapCommands = commands.filter(command =>
      command.startsWith("launchctl bootstrap "));

    expect(result.status, result.stderr).toBe(0);
    expect(bootstrapCommands).toHaveLength(3);
    expect(bootstrapCommands[0]).toContain("com.haystack.server.plist");
    expect(bootstrapCommands[1]).toContain("com.haystack.server.plist");
    expect(bootstrapCommands[2]).toContain("com.haystack.hourly.plist");
    expect(installerTemporaryDirectories(fixture.tempRoot)).toEqual([]);
  });

  it.each([
    {
      invalidHourly: "not a plist",
      name: "the plist is malformed",
    },
    {
      invalidHourly: repoFile("launchd/com.haystack.hourly.plist").replace(
        "<string>660</string>",
        "<string>120</string>",
      ),
      name: "the timeout is unsafe",
    },
    {
      invalidHourly: repoFile("launchd/com.haystack.hourly.plist").replace(
        "<string>-s</string>",
        [
          "<string>-s</string>",
          "<string>--retry</string>",
          "<string>1</string>",
        ].join("\n        "),
      ),
      name: "curl retries are enabled",
    },
  ])("leaves installed jobs untouched when $name", ({ invalidHourly }) => {
    const fixture = createInstallerFixture(invalidHourly);
    const installedDirectory = resolve(fixture.home, "Library/LaunchAgents");
    const installedServer = resolve(
      installedDirectory,
      "com.haystack.server.plist",
    );
    const installedHourly = resolve(
      installedDirectory,
      "com.haystack.hourly.plist",
    );
    mkdirSync(installedDirectory, { recursive: true });
    mkdirSync(resolve(fixture.tempRoot, "tmp"));
    writeFileSync(installedServer, "existing server");
    writeFileSync(installedHourly, "existing hourly");

    const result = runInstaller(fixture);
    const commands = readFileSync(fixture.trace, "utf8");

    expect(result.status).not.toBe(0);
    expect(commands).not.toContain("launchctl");
    expect(readFileSync(installedServer, "utf8")).toBe("existing server");
    expect(readFileSync(installedHourly, "utf8")).toBe("existing hourly");
    expect(installerTemporaryDirectories(fixture.tempRoot)).toEqual([]);
  });

  it("tells the operator to reinstall after template changes", () => {
    const guidance = repoFile("AGENTS.md");

    expect(guidance).toContain("./scripts/launchd-install.sh");
    expect(guidance).toContain("660 seconds");
    expect(guidance).toContain("does not cancel server work");
  });
});
