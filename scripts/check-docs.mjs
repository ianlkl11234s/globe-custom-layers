import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

function fail(message) {
  errors.push(message);
}

function walk(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function relativeTarget(raw) {
  let target = raw.trim();
  if (target.startsWith("<") && target.includes(">")) {
    target = target.slice(1, target.indexOf(">"));
  } else {
    target = target.split(/\s+/, 1)[0];
  }
  if (!target || target.startsWith("#") || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) {
    return null;
  }
  return target.split(/[?#]/, 1)[0];
}

function checkMarkdownLinks() {
  const files = walk(root).filter((file) => path.basename(file) === "llms.txt" || file.endsWith(".md"));
  const inline = /!?\[[^\]]*\]\(([^)\n]+)\)/g;
  const reference = /^\s*\[[^\]]+\]:\s*(\S+)/gm;
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const matcher of [inline, reference]) {
      for (const match of text.matchAll(matcher)) {
        const target = relativeTarget(match[1]);
        if (!target) continue;
        const resolved = path.resolve(path.dirname(file), target);
        if (!fs.existsSync(resolved)) {
          fail(`${path.relative(root, file)}: missing relative target ${target}`);
        }
      }
    }
  }
}

function checkManifest() {
  const manifestPath = path.join(root, "examples/manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`examples/manifest.json: invalid JSON (${error.message})`);
    return;
  }

  if (!Array.isArray(manifest.examples)) {
    fail("examples/manifest.json: examples must be an array");
    return;
  }
  const ids = new Set();
  let testTotal = 0;
  for (const [index, example] of manifest.examples.entries()) {
    const label = `examples[${index}]`;
    if (!example || typeof example !== "object") {
      fail(`${label}: entry must be an object`);
      continue;
    }
    if (typeof example.id !== "string" || !example.id) fail(`${label}: missing id`);
    else if (ids.has(example.id)) fail(`${label}: duplicate id ${example.id}`);
    else ids.add(example.id);
    for (const field of ["path", "readFirst", "screenshot"]) {
      if (typeof example[field] !== "string" || !example[field]) {
        fail(`${label}: missing ${field}`);
      } else {
        const target = example[field].split(/[?#]/, 1)[0];
        if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(target) || !fs.existsSync(path.resolve(root, target))) {
          fail(`${label}: missing ${field} target ${example[field]}`);
        }
      }
    }
    if (!Array.isArray(example.implements) || example.implements.length === 0) {
      fail(`${label}: implements must be a non-empty array`);
    } else {
      for (const target of example.implements) {
        if (typeof target !== "string" || !fs.existsSync(path.resolve(root, target.split(/[?#]/, 1)[0]))) {
          fail(`${label}: missing implements target ${target}`);
        }
      }
    }
    if (!Number.isInteger(example.tests) || example.tests < 0) fail(`${label}: tests must be a non-negative integer`);
    else testTotal += example.tests;
  }
  if (!Array.isArray(manifest.siteScenes) || manifest.siteScenes.length === 0) {
    fail("examples/manifest.json: siteScenes must be a non-empty array");
  } else {
    const sceneIds = new Set();
    for (const [index, scene] of manifest.siteScenes.entries()) {
      const label = `siteScenes[${index}]`;
      if (typeof scene.sceneId !== "string" || !scene.sceneId) fail(`${label}: missing sceneId`);
      else if (sceneIds.has(scene.sceneId)) fail(`${label}: duplicate sceneId ${scene.sceneId}`);
      else sceneIds.add(scene.sceneId);
      if (!ids.has(scene.exampleId)) fail(`${label}: unknown exampleId ${scene.exampleId}`);
      if (!['native', 'custom'].includes(scene.kind)) fail(`${label}: kind must be native or custom`);
      if (typeof scene.component !== "string" || !scene.component) fail(`${label}: missing component`);
      if (typeof scene.mapLibreImplementation !== "string" || !fs.existsSync(path.resolve(root, scene.mapLibreImplementation))) {
        fail(`${label}: missing mapLibreImplementation ${scene.mapLibreImplementation}`);
      }
      for (const files of Object.values(scene.requiredFiles ?? {})) {
        if (!Array.isArray(files) || files.length === 0) fail(`${label}: requiredFiles entries must be non-empty arrays`);
        else for (const target of files) {
          if (typeof target !== "string" || !fs.existsSync(path.resolve(root, target))) fail(`${label}: missing required file ${target}`);
        }
      }
      if (scene.inputContract) {
        if (!Array.isArray(scene.inputContract.accepted) || scene.inputContract.accepted.length === 0) fail(`${label}: inputContract.accepted must be non-empty`);
        if (!scene.acceptance?.en || !scene.acceptance?.['zh-TW']) fail(`${label}: localized acceptance is required with an input contract`);
      }
    }
  }
  if (!manifest.totals || manifest.totals.examples !== manifest.examples.length) {
    fail(`manifest totals.examples=${manifest.totals?.examples} but found ${manifest.examples.length}`);
  }
  if (!manifest.totals || manifest.totals.tests !== testTotal) {
    fail(`manifest totals.tests=${manifest.totals?.tests} but sum is ${testTotal}`);
  }
}

checkMarkdownLinks();
checkManifest();

if (errors.length) {
  console.error(`Documentation checks failed (${errors.length}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Documentation checks passed: relative links and examples/manifest.json are consistent.");
}
