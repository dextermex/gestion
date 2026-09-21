// Refreshes the vendored copy of Morada's schema (e2e/db/morada) from a
// checkout of dextermex/morada. The end-to-end job builds its throwaway
// database from that copy plus this repository's supabase/applied files, so
// the schema under test is the one production was built with.
//
//   node e2e/db/sync-morada-schema.mjs [path-to-morada-checkout]
//
// Run it when Morada's supabase/migrations change, and commit the result.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(process.argv[2] ?? path.join(here, "../../../morada"));
const migrations = path.join(source, "supabase/migrations");
if (!existsSync(migrations)) {
  console.error(`No supabase/migrations under ${source}. Pass the path to a dextermex/morada checkout.`);
  process.exit(1);
}
const target = path.join(here, "morada");
rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) cpSync(path.join(migrations, f), path.join(target, f));
let commit = "unknown";
try {
  commit = execSync("git rev-parse --short HEAD", { cwd: source, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
} catch {
  /* not a git checkout: the manifest says so */
}
writeFileSync(
  path.join(target, "MANIFEST.md"),
  `# Morada schema, vendored for the end-to-end database\n\n` +
    `Copied from dextermex/morada \`supabase/migrations\` at commit \`${commit}\` on ${new Date().toISOString().slice(0, 10)} ` +
    `by \`e2e/db/sync-morada-schema.mjs\`.\n\n` +
    `These files are applied to a throwaway local Supabase in CI, before this repository's \`supabase/applied\` files, ` +
    `because the \`gestion\` schema delegates identity and permissions to Morada's \`public.agencies\`, \`public.crm_members\` ` +
    `and \`public.gestion_onboard\`. They are never applied to production from here.\n\n` +
    files.map((f) => `- ${f}`).join("\n") +
    "\n",
);
console.log(`${files.length} files copied from ${source} (${commit})`);
