/**
 * Lets bare Node run the project's `.ts` sources directly:
 *
 *   node --import ./scripts/register-ts.mjs --test src/lib/**\/*.test.ts
 *
 * tsconfig runs `moduleResolution: "bundler"`, so source files import siblings
 * without an extension (`./provider`) and tsc rejects writing `./provider.ts`.
 * Next's bundler resolves that natively; Node 24 strips types but still needs a
 * real filename, so this appends the extension during resolution.
 *
 * Test plumbing only — nothing in the app depends on it.
 */
import { registerHooks } from 'node:module';
import path from 'node:path';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.{1,2}\//.test(specifier) && path.extname(specifier) === '') {
      for (const ext of ['.ts', '.tsx']) {
        try {
          return nextResolve(`${specifier}${ext}`, context);
        } catch {
          /* try the next extension, then fall through */
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
