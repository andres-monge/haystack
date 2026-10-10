import dotenv from "dotenv";
import { loadConfigFromEnv } from "../src/config/config.js";
import { getDateString } from "../src/server/image-rotation.js";
import { CodexStoryWriter } from "../src/story/codex-writer.js";
import { DailyStoryPreparer } from "../src/story/prepare-story.js";
import { StoryStore } from "../src/story/story-store.js";
import { exportTrailer } from "../src/story/trailer-export.js";

dotenv.config({path:".env.local",quiet:true});
async function main(): Promise<void> {
  const args=process.argv.slice(2);
  if (args.some(arg=>!["--retry","--export"].includes(arg)) || new Set(args).size!==args.length || args.length>1) {
    throw new Error("Usage: npm run story:prepare -- [--retry | --export]");
  }
  const config=loadConfigFromEnv();
  if (!config.imageDir || !config.schedulerLocation) throw new Error("Daily preparation requires artwork and scheduler location configuration");
  const store=new StoryStore(config.story.stateDir);
  const now=new Date();
  const date=getDateString(now,config.schedulerLocation.timezone);
  const ready=args.includes("--export")
    ? await store.load(date)
    : await new DailyStoryPreparer({
      store,stateDir:config.story.stateDir,
      writer:new CodexStoryWriter({executable:config.story.codexPath}),
      imageDir:config.imageDir,location:config.schedulerLocation,
      activeStart:config.activeStart,activeEnd:config.activeEnd,
    }).prepare({now,retryFailed:args.includes("--retry")});
  if (!ready) throw new Error("Today's story is unavailable; inspect local failure state and use --retry explicitly");
  console.log(`Ready story: ${ready.story.id} (${ready.story.date})`);
  if (config.story.trailerDir) {
    await exportTrailer(store,date,config.story.trailerDir);
    console.log("Dated public trailer exported");
  } else if (args.includes("--export")) throw new Error("HAYSTACK_TRAILER_DIR is required for export");
}
main().catch(()=>{console.error("Daily story operation failed; check local configuration/failure state. No automatic retry was attempted.");process.exitCode=1;});
