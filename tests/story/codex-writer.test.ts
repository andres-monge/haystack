import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CodexStoryWriter, writerEnvironment } from "../../src/story/codex-writer.js";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, {recursive:true,force:true}); });
function fixture(script: string) {
  const dir = mkdtempSync(join(tmpdir(), "haystack-writer-")); dirs.push(dir);
  const executable = join(dir, "codex");
  writeFileSync(executable, `#!/usr/bin/env node\n${script}`); chmodSync(executable, 0o755);
  return { dir, executable };
}
const request = { prompt: "write a story", imagePath: "/tmp/art.png", schema: {type:"object"} };
describe("local subscription writer", () => {
  it("retains only runtime and supported login context", () => {
    const env = writerEnvironment({HOME:"/tmp/home",CODEX_HOME:"/tmp/auth",PATH:"/bin",LANG:"en_US.UTF-8",OPENAI_API_KEY:"secret",XAI_API_KEY:"secret",GOOGLE_API_KEY:"secret",SLACK_TOKEN:"secret",NODE_OPTIONS:"unsafe"});
    expect(env).toEqual({HOME:"/tmp/home",CODEX_HOME:"/tmp/auth",PATH:"/bin",LANG:"en_US.UTF-8"});
  });
  it("uses explicit model/effort and no inherited config, connectors or hooks", async () => {
    const { executable } = fixture(`const fs = require('node:fs'); const a = process.argv.slice(2); const output = a[a.indexOf('-o')+1]; fs.writeFileSync(output,JSON.stringify({argv:a,env:Object.keys(process.env)}));`);
    const result = await new CodexStoryWriter({executable}).write(request) as {argv:string[];env:string[]};
    expect(result.argv).toContain("gpt-6.1-sol");
    expect(result.argv).toContain('model_reasoning_effort="medium"');
    expect(result.argv).toContain("--ignore-user-config");
    expect(result.argv).toContain("--ephemeral");
    expect(result.argv).toContain("read-only");
    expect(result.argv).toContain("features.hooks=false");
    expect(result.argv).toContain("features.apps=false");
    expect(result.argv).toContain("features.plugins=false");
    expect(result.argv).toContain("--output-schema");
    expect(result.env).not.toContain("OPENAI_API_KEY");
  });
  it.each([
    ["process.exit(9)", "writer_exit"],
    ["const fs=require('node:fs');const a=process.argv;fs.writeFileSync(a[a.indexOf('-o')+1],'{broken')", "writer_json"],
    ["setInterval(()=>{},1000)", "writer_timeout"],
    ["process.stdout.write('x'.repeat(2048));setInterval(()=>{},1000)", "writer_output_limit"],
  ])("rejects unsuccessful child: %s", async (script, code) => {
    const {executable} = fixture(script);
    await expect(new CodexStoryWriter({executable,timeoutMs:code === "writer_timeout" ? 150 : 2500,maxOutputBytes:1024}).write(request)).rejects.toThrow(code);
  });
  it("rejects relative executable without spawning", async () => {
    await expect(new CodexStoryWriter({executable:"codex"}).write(request)).rejects.toThrow(/absolute/);
  });
  it("uses the fallback model when the primary reports capacity across stderr chunks", async () => {
    const {executable} = fixture(`const fs=require('node:fs');const a=process.argv;const model=a[a.indexOf('--model')+1];if(model==='gpt-6.1-sol'){process.stderr.write('ERROR: Selected model is at ');setTimeout(()=>{process.stderr.write('capacity. Please try a different model.');},20);setInterval(()=>{},1000);}else{fs.writeFileSync(a[a.indexOf('-o')+1],JSON.stringify({model}));}`);
    await expect(new CodexStoryWriter({executable,timeoutMs:2000}).write(request)).resolves.toEqual({model:'gpt-6-sol'});
  });
  it("reports capacity safely when both models are unavailable", async () => {
    const {executable} = fixture(`process.stderr.write('ERROR: Selected model is at capacity. secret credential');process.exit(1);`);
    await expect(new CodexStoryWriter({executable}).write(request)).rejects.toThrow(/^writer_capacity$/);
  });
  it("does not retry unrelated writer errors", async () => {
    const {dir,executable} = fixture(`const fs=require('node:fs');const path=require('node:path');fs.appendFileSync(path.join(__dirname,'attempts'),'x');process.stderr.write('ERROR: Unauthorized secret credential');process.exit(1);`);
    await expect(new CodexStoryWriter({executable}).write(request)).rejects.toThrow(/^writer_exit$/);
    expect(readFileSync(join(dir,'attempts'),'utf8')).toBe('x');
  });
  it("reserves time for fallback when the primary hangs", async () => {
    const {executable} = fixture(`const fs=require('node:fs');const a=process.argv;const model=a[a.indexOf('--model')+1];if(model==='gpt-6.1-sol'){setInterval(()=>{},1000);}else{fs.writeFileSync(a[a.indexOf('-o')+1],JSON.stringify({model}));}`);
    await expect(new CodexStoryWriter({executable,timeoutMs:2000}).write(request)).resolves.toEqual({model:'gpt-6-sol'});
  });
  it("shares the time limit across both stalled models", async () => {
    const {executable}=fixture(`setInterval(()=>{},1000);`);
    const started=Date.now();
    await expect(new CodexStoryWriter({executable,timeoutMs:1200}).write(request)).rejects.toThrow('writer_timeout');
    expect(Date.now()-started).toBeLessThan(1800);
  });
  it("shares the captured output limit across capacity and fallback attempts", async () => {
    const {executable}=fixture(`const fs=require('node:fs');const a=process.argv;if(a[a.indexOf('--model')+1]==='gpt-6.1-sol'){process.stderr.write('ERROR: Selected model is at capacity.');process.exit(1);}else{process.stdout.write('x'.repeat(80));fs.writeFileSync(a[a.indexOf('-o')+1],'{}');}`);
    await expect(new CodexStoryWriter({executable,maxOutputBytes:100,timeoutMs:2000}).write(request)).rejects.toThrow('writer_output_limit');
  });
});
