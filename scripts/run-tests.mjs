// Discovers and runs every *.test.ts file under src/, then relies on
// node:test's built-in reporter (registered as a side effect of importing
// node:test below) to print TAP output and set process.exitCode on failure.
//
// Why this exists instead of `node --test $(find ...)` or
// `find ... -print0 | xargs -0 node --test`:
// Node's own `--test` CLI flag runs every file path it's given (even
// absolute, even explicitly listed, even NUL-delimited via xargs) through
// its internal glob matcher before deciding whether to execute it. Any
// path containing a `[...]` segment - e.g. Next.js dynamic routes like
// `src/app/api/admin/expert-picks/[id]/route.test.ts` - gets silently
// treated as a bracket character class by that matcher and is dropped:
// no error, no test count, nothing. This is not a shell globbing problem
// (fixing the command substitution/word-splitting does not help) - it
// reproduces identically with quoted paths, absolute paths, and NUL-safe
// xargs. Importing each file directly with dynamic import(), rather than
// handing paths to `--test`, sidesteps that matcher entirely.
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import "node:test";

const root = join(import.meta.dirname, "..", "src");

function findTestFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (stats.isFile() && entry.endsWith(".test.ts")) {
      results.push(full);
    }
  }
  return results;
}

const files = findTestFiles(root);
for (const file of files) {
  await import(`file://${file}`);
}
