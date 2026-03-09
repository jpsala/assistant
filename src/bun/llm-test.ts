/**
 * Quick streaming test — run with: bun src/bun/llm-test.ts
 */
import { streamCompletion, PROVIDER_CONFIGS } from "./llm";

const API_KEY = process.env.OPENROUTER_KEY ?? "";
const MODEL = "anthropic/claude-haiku-4-5";

if (!API_KEY) {
  console.error("Set OPENROUTER_KEY env var");
  process.exit(1);
}

console.log(`Testing streaming with ${MODEL} via openrouter...\n`);
process.stdout.write("Response: ");

await streamCompletion(
  {
    provider: "openrouter",
    model: MODEL,
    apiKey: API_KEY,
    messages: [{ role: "user", content: "Say hello in exactly 10 words." }],
    maxTokens: 50,
  },
  {
    onToken: (tok) => process.stdout.write(tok),
    onDone: (full) => {
      console.log("\n\n✅ Done. Total chars:", full.length);
      process.exit(0);
    },
    onError: (e) => {
      console.error("\n❌ Error:", e.message);
      process.exit(1);
    },
  }
);
