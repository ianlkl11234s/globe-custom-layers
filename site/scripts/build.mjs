import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const siteRoot = resolve(projectRoot, "site");
const outputRoot = resolve(siteRoot, "dist");
const emptyEnvDir = await mkdtemp(join(tmpdir(), "gcl-empty-env-"));
const examples = [
  ["00-native-vs-custom", "native-vs-custom.png"],
  ["01-points-on-globe", "points-globe.png"],
  ["02-arcs-on-globe", "arcs-globe.png"],
  ["05-mass-trajectories", "tracks-globe.png"],
];
const priorToken = process.env.VITE_MAPBOX_TOKEN;

try {
  // Empty process env plus an empty envDir prevents a local example .env from
  // being read or baked into a distributable iframe bundle.
  process.env.VITE_MAPBOX_TOKEN = "";
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  await Promise.all([
    cp(join(siteRoot, "index.html"), join(outputRoot, "index.html")),
    cp(join(siteRoot, "styles.css"), join(outputRoot, "styles.css")),
    cp(join(siteRoot, "app.js"), join(outputRoot, "app.js")),
    cp(join(siteRoot, "i18n.js"), join(outputRoot, "i18n.js")),
    cp(join(siteRoot, "bridgeState.js"), join(outputRoot, "bridgeState.js")),
    cp(join(siteRoot, "land.json"), join(outputRoot, "land.json")),
    cp(join(siteRoot, "airports.json"), join(outputRoot, "airports.json")),
    mkdir(join(outputRoot, "previews"), { recursive: true }),
  ]);
  await mkdir(join(outputRoot, "vendor"), { recursive: true });
  await Promise.all([
    cp(join(siteRoot, "node_modules/maplibre-gl/dist/maplibre-gl.js"), join(outputRoot, "vendor/maplibre-gl.js")),
    cp(join(siteRoot, "node_modules/maplibre-gl/dist/maplibre-gl.css"), join(outputRoot, "vendor/maplibre-gl.css")),
    cp(join(siteRoot, "node_modules/maplibre-gl/LICENSE.txt"), join(outputRoot, "vendor/maplibre-LICENSE.txt")),
  ]);

  // Bundle the token-free custom renderer while sharing the original scene
  // source. Replace its coordinate-only Mapbox import with MapLibre math.
  const sharedExample = join(projectRoot, "examples/01-points-on-globe");
  const { build: buildFree } = await import(pathToFileURL(join(sharedExample, "node_modules/vite/dist/node/index.js")).href);
  await buildFree({
    root: siteRoot, envDir: emptyEnvDir, base: "./", logLevel: "warn",
    resolve: { alias: {
      "mapbox-gl": join(siteRoot, "mapboxMathCompat.ts"),
      "three": join(sharedExample, "node_modules/three/build/three.module.js"),
    } },
    build: { outDir: outputRoot, emptyOutDir: false, copyPublicDir: false,
      lib: { entry: join(siteRoot, "freeGlobe.js"), formats: ["es"], fileName: () => "freeGlobe.js" },
    },
  });

  for (const [name, previewName] of examples) {
    const exampleRoot = join(projectRoot, "examples", name);
    await cp(join(exampleRoot, "screenshots", "globe.png"), join(outputRoot, "previews", previewName));
    const viteModule = pathToFileURL(join(exampleRoot, "node_modules", "vite", "dist", "node", "index.js")).href;
    const { build } = await import(viteModule);
    await build({
      root: exampleRoot,
      envDir: emptyEnvDir,
      base: "./",
      logLevel: "warn",
      plugins: name === "05-mass-trajectories" ? [] : [{
        name: "field-guide-relative-airport-fixture",
        transform(code, id) {
          if (!id.endsWith("/src/airports.ts")) return null;
          return { code: code.replace('fetch("/airports.json")', 'fetch("./airports.json")'), map: null };
        },
      }],
      build: { outDir: join(outputRoot, "examples", name), emptyOutDir: false },
    });
  }
} finally {
  if (priorToken === undefined) delete process.env.VITE_MAPBOX_TOKEN;
  else process.env.VITE_MAPBOX_TOKEN = priorToken;
  await rm(emptyEnvDir, { recursive: true, force: true });
}
