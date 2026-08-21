import {
  cp,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
try {
  process.loadEnvFile(join(root, ".env"));
} catch {
  /* CI and production packaging may provide the real environment directly. */
}
const source = resolve(root, ".next/standalone");
const sourcePackage = JSON.parse(
  await readFile(join(source, "package.json"), "utf8"),
);
const target = await mkdtemp(join(tmpdir(), "liara-copilot-standalone-"));

// pnpm's relative links are part of the standalone module layout. Preserve the
// link text verbatim: fs.cp's default turns them into absolute links back to the
// build checkout, while dereferencing them breaks Node's pnpm resolution path.
await cp(source, target, {
  recursive: true,
  dereference: false,
  verbatimSymlinks: true,
});
await cp(resolve(root, ".next/static"), join(target, ".next/static"), {
  recursive: true,
});
await cp(resolve(root, "public"), join(target, "public"), { recursive: true });

// Next copies dotenv files into standalone output. Runtime secrets are provided
// by Liara, so delete every supported dotenv variant before this directory can
// become a Docker build context.
const dotenvNames = (await readdir(target)).filter(
  (name) => name === ".env" || name.startsWith(".env."),
);
await Promise.all(dotenvNames.map((name) => rm(join(target, name), { force: true })));

// Next 16's file tracer currently keeps only the CJS helper files even though
// its runtime resolves the ESM exports. Replace that partial traced package with
// the complete package from this lockfile-controlled installation.
const installedModules = resolve(root, "node_modules");
const swcHelpers = await realpath(
  join(installedModules, ".pnpm/node_modules/@swc/helpers"),
);
const tracedSwcHelpers = join(
  target,
  "node_modules",
  relative(installedModules, swcHelpers),
);
await rm(tracedSwcHelpers, { recursive: true, force: true });
await cp(swcHelpers, tracedSwcHelpers, { recursive: true, dereference: true });

// Keep the documentation corpus explicit. Output tracing normally includes it,
// but copying it here makes the deploy artifact deterministic if tracing changes.
await rm(join(target, "data/docs"), { recursive: true, force: true });
await cp(resolve(root, "data/docs"), join(target, "data/docs"), {
  recursive: true,
});

// Semantic retrieval is a generated deployment artifact. Copy it explicitly
// instead of relying on Next's output tracer, and fail closed when an operator
// enables the feature without building the matching index first.
const vectorSource = resolve(
  root,
  process.env.DOCS_VECTORS_PATH ?? "data/docs-vectors.json",
);
const vectorTarget = join(target, "data/docs-vectors.json");
await rm(vectorTarget, { force: true });
try {
  await cp(vectorSource, vectorTarget);
} catch (error) {
  if (
    process.env.ENABLE_SEMANTIC_RAG === "true" &&
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    throw new Error(
      `ENABLE_SEMANTIC_RAG=true but ${vectorSource} is missing. Run node scripts/build-docs-index.mjs first.`,
    );
  }
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

// Liara CLI deliberately ignores a directory named node_modules. The traced
// standalone runtime is already complete, so keep it under a deployment-only
// name and let CommonJS resolve it through NODE_PATH.
await rename(join(target, "node_modules"), join(target, "runtime_modules"));
// Liara's source uploader ignores `.next`; Docker restores this deployment-only
// name to the layout expected by Next's standalone server.
await rename(join(target, ".next"), join(target, "next_runtime"));

await writeFile(
  join(target, "package.json"),
  `${JSON.stringify({
    name: `${sourcePackage.name ?? "liara-copilot"}-standalone`,
    version: sourcePackage.version ?? "0.1.0",
    private: true,
    scripts: {
      start: "NODE_PATH=./runtime_modules node server.js",
    },
  }, null, 2)}\n`,
);

await writeFile(
  join(target, "liara.docker.json"),
  `${JSON.stringify({
    port: 3000,
    docker: { mirror: false },
    build: { location: "germany" },
    healthCheck: {
      command:
        "CMD node -e \"fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\"",
      interval: 30_000,
      timeout: 10_000,
      retries: 2,
      startPeriod: 3_000,
    },
  }, null, 2)}\n`,
);

await writeFile(
  join(target, "Dockerfile"),
  `FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 NODE_PATH=/app/runtime_modules
COPY runtime_modules ./runtime_modules
COPY next_runtime ./.next
COPY data ./data
COPY public ./public
COPY server.js ./server.js
EXPOSE 3000
CMD ["node", "server.js"]
`,
);

await writeFile(
  join(target, ".dockerignore"),
  ".env*\npackage.json\nliara.docker.json\n",
);

// Liara's uploader ignores every directory named `node_modules`, including the
// nested pnpm directories inside our renamed runtime tree. The final negation
// is intentional: it restores only this traced, secret-free dependency tree.
await writeFile(
  join(target, ".liaraignore"),
  ".env*\npackage.json\nliara.docker.json\n!runtime_modules/**\n",
);

console.log(target);
