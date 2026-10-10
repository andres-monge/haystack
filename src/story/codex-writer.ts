import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface WriterRequest { prompt: string; imagePath: string; schema: unknown }
export interface StoryWriter { write(request: WriterRequest): Promise<unknown> }
export interface CodexWriterOptions {
  executable: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

/** Allowlist runtime/login context. Never inherit provider keys or loader hooks. */
export function writerEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const key of ["HOME", "CODEX_HOME", "PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR"]) {
    if (env[key] !== undefined) clean[key] = env[key];
  }
  return clean;
}

export class CodexStoryWriter implements StoryWriter {
  constructor(private readonly options: CodexWriterOptions) {}

  async write(request: WriterRequest): Promise<unknown> {
    const { executable } = this.options;
    if (!path.isAbsolute(executable)) throw new Error("Codex executable must be absolute");
    fs.accessSync(executable, fs.constants.X_OK);
    if (!fs.statSync(executable).isFile()) throw new Error("Codex executable must be a file");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "haystack-story-writer-"));
    const limit = this.options.maxOutputBytes ?? 1024 * 1024;
    const output = path.join(dir, "response.json");
    const schema = path.join(dir, "schema.json");
    fs.writeFileSync(schema, JSON.stringify(request.schema), { mode: 0o600 });
    const argv = [
      "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
      "--skip-git-repo-check", "--sandbox", "read-only",
      "--model", "gpt-6.1-sol", "-c", 'model_reasoning_effort="medium"',
      "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
      "-c", "features.skip_host_skill_discovery=true",
      ...["apps", "hooks", "plugins", "remote_plugin", "shell_tool", "unified_exec", "skill_search", "skill_mcp_dependency_install"]
        .flatMap(feature => ["-c", `features.${feature}=false`]),
      "-C", dir, "--image", request.imagePath,
      "--output-schema", schema, "-o", output, "--color", "never", "-",
    ];
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, argv, {
          cwd: dir, env: writerEnvironment(this.options.env), shell: false,
          stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
        });
        let count = 0;
        let failure: string | undefined;
        const terminate = (code: string) => {
          if (failure) return;
          failure = code;
          try {
            if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch { /* child may already have exited */ }
        };
        const timer = setTimeout(() => terminate("writer_timeout"), this.options.timeoutMs ?? 300_000);
        const capture = (chunk: Buffer) => {
          count += chunk.length;
          if (count > limit) terminate("writer_output_limit");
        };
        child.stdout.on("data", capture);
        child.stderr.on("data", capture);
        child.stdin.on("error", () => { /* exit/error handler owns outcome */ });
        child.once("error", () => { clearTimeout(timer); reject(new Error("writer_spawn")); });
        child.once("close", code => {
          clearTimeout(timer);
          if (failure || code !== 0) reject(new Error(failure ?? "writer_exit"));
          else resolve();
        });
        child.stdin.end(request.prompt);
      });
      if (fs.statSync(output).size > limit) throw new Error("writer_output_limit");
      try { return JSON.parse(fs.readFileSync(output, "utf8")) as unknown; }
      catch { throw new Error("writer_json"); }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
