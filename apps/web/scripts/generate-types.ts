/**
 * Generate TypeScript types from the OpenAPI contract into lib/api-client/generated/.
 *
 * The contract in packages/contracts is the source of truth for the api <-> web boundary; we never
 * hand-write types that mirror the API DTOs. Run after any contract change:
 *
 *   pnpm contracts:types
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
// The contract lives in the monorepo's shared contracts package (the source of truth).
const CONTRACT = resolve(repoRoot, "..", "..", "packages", "contracts", "openapi.yaml");
const OUT = resolve(repoRoot, "lib", "api-client", "generated", "schema.d.ts");

const HEADER = `/**
 * GENERATED FILE — do not edit by hand.
 * Source: packages/contracts/openapi.yaml
 * Regenerate: pnpm contracts:types
 */

`;

async function main() {
  const ast = await openapiTS(new URL(`file://${CONTRACT}`));
  writeFileSync(OUT, HEADER + astToString(ast), "utf8");
  console.log(`generate-types: wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
