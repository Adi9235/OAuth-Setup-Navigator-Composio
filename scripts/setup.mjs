// First-run helper — same on Windows, macOS and Linux (plain Node, no dependencies).
//   npm run setup
// Checks the Node version, creates .env from .env.example if missing, and prints next steps.
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
let problems = 0;

console.log("\nOAuth Setup Navigator — setup check\n");

// 1. Node version (Next.js 15 + deps need Node 22+)
const major = Number(process.versions.node.split(".")[0]);
if (major >= 22) ok(`Node ${process.versions.node}`);
else {
  problems++;
  warn(`Node ${process.versions.node} found — Node 22 or newer is required (https://nodejs.org, or \`nvm use\`).`);
}

// 2. Dependencies
if (existsSync(join(root, "node_modules", "next"))) ok("Dependencies installed");
else {
  problems++;
  warn("Dependencies missing — run: npm install");
}

// 3. .env
const envPath = join(root, ".env");
if (!existsSync(envPath)) {
  copyFileSync(join(root, ".env.example"), envPath);
  ok("Created .env from .env.example");
} else ok(".env exists (left unchanged)");

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.trim().replace(/^(['"])(.*)\1$/, "$2")]),
);

if (!env.DATABASE_URL) {
  problems++;
  warn("DATABASE_URL is empty in .env — add a Postgres URL (see below).");
} else if (env.DATABASE_URL.includes("localhost")) {
  ok("DATABASE_URL points to local Postgres (start it with: docker compose up -d)");
} else ok("DATABASE_URL is set");

const llmKey = (env.LLM_PROVIDER || "groq") === "anthropic" ? "ANTHROPIC_API_KEY" : "GROQ_API_KEY";
if (env[llmKey] && env.TAVILY_API_KEY) ok(`Server API keys set (${llmKey}, TAVILY_API_KEY)`);
else ok("No server API keys — that's fine: enter your own on the in-app API keys page");

console.log(`
Next steps:
  1. Database: either
       - Docker:  docker compose up -d        (uses the default DATABASE_URL), or
       - Neon:    paste your connection string into DATABASE_URL in .env
  2. npm run db:migrate          create the tables
  3. npm run build
  4. npm start                   then open http://localhost:3000
  5. In the app: API keys (key icon) -> choose Groq or Claude, paste keys, Test connection, Save
  Optional: npm run db:seed      generate the five seed guides (uses API credits)
`);

process.exitCode = problems ? 1 : 0;
