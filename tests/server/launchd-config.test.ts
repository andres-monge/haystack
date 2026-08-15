import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function repoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
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

  it("tells the operator to reinstall and verify the installed plist", () => {
    const installer = repoFile("scripts/launchd-install.sh");
    const guidance = repoFile("AGENTS.md");

    expect(installer).toContain("--max-time 660");
    expect(installer).toContain("no curl transport retries");
    expect(installer).toContain("~/Library/LaunchAgents/com.haystack.hourly.plist");
    expect(guidance).toContain("./scripts/launchd-install.sh");
    expect(guidance).toContain("660 seconds");
    expect(guidance).toContain("does not cancel server work");
  });
});
