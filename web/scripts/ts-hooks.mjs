// Lets plain Node run the web app's server modules (`@/` imports, extensionless
// `.ts` paths) for scripts like keeper-once.mjs. Node strips the TS types itself.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), SRC).href;
  if ((specifier.startsWith(".") || specifier.startsWith("file:")) && !/\.[cm]?[jt]sx?$/.test(specifier)) {
    const base = new URL(specifier, context.parentURL).href;
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      if (existsSync(fileURLToPath(base + ext))) return next(base + ext, context);
    }
  }
  return next(specifier, context);
}
