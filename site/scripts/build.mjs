import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "../..");
const siteRoot = resolve(projectRoot, "site");
const outputRoot = resolve(siteRoot, "dist");
const emptyEnvDir = await mkdtemp(join(tmpdir(), "gcl-empty-env-"));
const manifest = JSON.parse(await readFile(join(projectRoot, "examples/manifest.json"), "utf8"));
const manifestExamples = new Map(manifest.examples.map((example) => [example.id, example]));
const sceneCatalog = manifest.siteScenes.map((scene) => {
  const example = manifestExamples.get(scene.exampleId);
  if (!example) throw new Error(`Unknown site scene example: ${scene.exampleId}`);
  return {
    ...scene,
    path: example.path.replace(/^examples\//, "").replace(/\/$/, ""),
    recipe: example.readFirst,
    status: example.status,
    data: example.data,
  };
});
const previewByExample = new Map([
  ["00-native-vs-custom", "native-vs-custom.png"],
  ["01-points-on-globe", "points-globe.png"],
  ["02-arcs-on-globe", "arcs-globe.png"],
  ["05-mass-trajectories", "tracks-globe.png"],
]);
const examples = sceneCatalog.map((scene) => [scene.exampleId, previewByExample.get(scene.exampleId) ?? null]);
const priorToken = process.env.VITE_MAPBOX_TOKEN;
const fontFaces = [
  ["@ibm/plex-sans-tc/fonts/split/woff2/hinted", ["IBMPlexSansTC-Regular", "IBMPlexSansTC-Medium", "IBMPlexSansTC-SemiBold"]],
  ["@ibm/plex-sans/fonts/split/woff2", ["IBMPlexSans-Regular", "IBMPlexSans-Medium", "IBMPlexSans-SemiBold"]],
  ["@ibm/plex-mono/fonts/split/woff2", ["IBMPlexMono-Regular", "IBMPlexMono-Medium"]],
];

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
    cp(join(siteRoot, "assets"), join(outputRoot, "assets"), { recursive: true }),
    cp(join(siteRoot, "data"), join(outputRoot, "data"), { recursive: true }),
    mkdir(join(outputRoot, "previews"), { recursive: true }),
  ]);
  await writeFile(
    join(outputRoot, "sceneCatalog.js"),
    `// Generated from examples/manifest.json by site/scripts/build.mjs.\nexport const sceneCatalog = ${JSON.stringify(sceneCatalog, null, 2)};\n`,
  );
  await mkdir(join(outputRoot, "vendor"), { recursive: true });
  const fontOutput = join(outputRoot, "fonts");
  await mkdir(fontOutput, { recursive: true });
  let fontCss = "/* IBM Plex OFL-1.1 · generated from pinned npm packages */\n";
  for (const [packagePath, faces] of fontFaces) {
    const sourceRoot = join(siteRoot, "node_modules", packagePath);
    const entries = await readdir(sourceRoot);
    for (const face of faces) {
      const css = await readFile(join(sourceRoot, `${face}.css`), "utf8");
      fontCss += `${css.replaceAll("font-style: normal;", "font-style: normal;\n\tfont-display: swap;")}\n`;
      const files = entries.filter((name) => name.startsWith(`${face}-`) && name.endsWith(".woff2"));
      await Promise.all(files.map((name) => cp(join(sourceRoot, name), join(fontOutput, name))));
    }
  }
  await writeFile(join(fontOutput, "plex.css"), fontCss);
  await Promise.all([
    cp(join(siteRoot, "node_modules/@ibm/plex-sans-tc/LICENSE.txt"), join(fontOutput, "IBMPlexSansTC-LICENSE.txt")),
    cp(join(siteRoot, "node_modules/@ibm/plex-sans/LICENSE.txt"), join(fontOutput, "IBMPlexSans-LICENSE.txt")),
    cp(join(siteRoot, "node_modules/@ibm/plex-mono/LICENSE.txt"), join(fontOutput, "IBMPlexMono-LICENSE.txt")),
  ]);
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
    if (previewName) await cp(join(exampleRoot, "screenshots", "globe.png"), join(outputRoot, "previews", previewName));
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
