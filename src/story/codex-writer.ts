import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface WriterRequest { prompt: string; imagePath: string; schema: unknown }
export interface StoryWriter { write(request: WriterRequest): Promise<unknown> }
type WriterFailureCode = "writer_capacity" | "writer_timeout" | "writer_output_limit" | "writer_spawn" | "writer_exit" | "writer_json" | "writer_output_missing";
export class StoryWriterError extends Error {
  constructor(readonly code: WriterFailureCode) { super(code); this.name = "StoryWriterError"; }
}
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
    const timeoutMs = this.options.timeoutMs ?? 600_000;
    const deadline = Date.now() + timeoutMs;
    let count = 0;
    const models = ["gpt-6.1-sol", "gpt-6-sol"];
    try {
      for (const model of models) {
        if (count > limit) throw new StoryWriterError("writer_output_limit");
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new StoryWriterError("writer_timeout");
        fs.rmSync(output, { force: true });
        const argv = [
          "exec", "--ignore-user-config", "--ignore-rules", "--ephemeral",
          "--skip-git-repo-check", "--sandbox", "read-only",
          "--model", model, "-c", 'model_reasoning_effort="medium"',
          "-c", 'web_search="disabled"', "-c", "project_doc_max_bytes=0",
          "-c", "features.skip_host_skill_discovery=true",
          ...["apps", "hooks", "plugins", "remote_plugin", "shell_tool", "unified_exec", "skill_search", "skill_mcp_dependency_install"]
            .flatMap(feature => ["-c", `features.${feature}=false`]),
          "-C", dir, "--image", request.imagePath,
          "--output-schema", schema, "-o", output, "--color", "never", "-",
        ];
        const attemptStarted = Date.now();
        console.log(`[${new Date().toISOString()}] Story writer started: ${model}`);
        try {
          await new Promise<void>((resolve, reject) => {
            const child = spawn(executable, argv, {
              cwd: dir, env: writerEnvironment(this.options.env), shell: false,
              stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
            });
            let failure: WriterFailureCode | undefined;
            let stderrTail = "";
            let diagnostic: "none" | "transport" | "rate_limit" | "authentication" = "none";
            const terminate = (code: WriterFailureCode) => {
              if (failure) return;
              failure = code;
              try {
                if (process.platform !== "win32" && child.pid) process.kill(-child.pid, "SIGKILL");
                else child.kill("SIGKILL");
              } catch { /* child may already have exited */ }
            };
            // Reserve half the total budget for recovery when the primary stalls.
            const attemptMs = model === models[0] ? Math.min(remainingMs, timeoutMs / 2) : remainingMs;
            const timer = setTimeout(() => terminate("writer_timeout"), attemptMs);
            const capture = (chunk: Buffer) => {
              count += chunk.length;
              if (count > limit) terminate("writer_output_limit");
            };
            child.stdout.on("data", capture);
            child.stderr.on("data", (chunk: Buffer) => {
              capture(chunk);
              // Retain only a bounded in-memory window; never expose raw child diagnostics.
              const text = stderrTail + chunk.toString();
              if (/ERROR:\s*Selected model is at capacity/i.test(text)) terminate("writer_capacity");
              if (/reconnect|stream.*disconnect|connection.*(?:failed|closed)|request.*(?:failed|timed out)/i.test(text)) diagnostic = "transport";
              if (/rate.?limit|too many requests|usage limit/i.test(text)) diagnostic = "rate_limit";
              if (/unauthorized|authentication.*failed|token.*expired/i.test(text)) diagnostic = "authentication";
              stderrTail = text.slice(-1024);
            });
            child.stdin.on("error", () => { /* exit/error handler owns outcome */ });
            child.once("error", () => { clearTimeout(timer); reject(new StoryWriterError("writer_spawn")); });
            child.once("close", code => {
              clearTimeout(timer);
              console.log(`[${new Date().toISOString()}] Story writer attempt: ${JSON.stringify({ model, durationMs: Date.now() - attemptStarted, outcome: failure ?? (code === 0 ? "completed" : "writer_exit"), exitCode: code, diagnostic })}`);
              if (failure || code !== 0) reject(new StoryWriterError(failure ?? "writer_exit"));
              else resolve();
            });
            child.stdin.end(request.prompt);
          });
        } catch (error) {
          if (error instanceof StoryWriterError && (error.code === "writer_capacity" || error.code === "writer_timeout") && model !== models.at(-1)) {
            console.warn(`[${new Date().toISOString()}] Story writer model ${model} failed: ${error.code}; trying ${models.at(-1)}`);
            continue;
          }
          throw error;
        }
        if (!fs.existsSync(output)) throw new StoryWriterError("writer_output_missing");
        if (fs.statSync(output).size > limit) throw new StoryWriterError("writer_output_limit");
        try { return JSON.parse(fs.readFileSync(output, "utf8")) as unknown; }
        catch { throw new StoryWriterError("writer_json"); }
      }
      throw new StoryWriterError("writer_capacity");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}
