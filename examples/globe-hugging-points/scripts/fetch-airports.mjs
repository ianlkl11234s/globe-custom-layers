#!/usr/bin/env node
// Fetches OurAirports' public-domain airport list and writes a trimmed-down
// public/airports.json for this example.
//
// Data source: https://ourairports.com/data/airports.csv
//   - OurAirports data is public domain. No attribution is legally required,
//     but we credit it in README.md anyway because that's just polite.
//   - We keep only `type === "large_airport"` (the world's major hub airports --
//     small/medium/heliports would be thousands of points and aren't needed to
//     demonstrate globe-hugging).
//   - We keep only the fields this example actually uses: `ident`, `name`,
//     `lon`, `lat`. Nothing else (elevation, ICAO/IATA codes, links, ...) is
//     needed, and dropping it keeps the shipped JSON small.
//
// If the network is unavailable, we fall back to synthetically generated
// points spread evenly over the sphere (a Fibonacci sphere), so the example
// still has *something* to render. Synthetic points are clearly labelled as
// such in the output file's `source` field -- never pretend fake data is real.
//
// Output format is an array-of-arrays (not array-of-objects) purely to keep
// the JSON file small: with ~1200 airports, repeating the four field names in
// every record would nearly double the file size for zero benefit. See the
// `fields` key for the column order.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SOURCE_URL = "https://ourairports.com/data/airports.csv";
const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "airports.json",
);

const FIELDS = ["ident", "name", "lon", "lat"];

/**
 * Minimal RFC4180-ish CSV line splitter. OurAirports quotes every text field,
 * and some names contain commas inside quotes (e.g. `"Ranch, Municipal"`), so
 * a naive `line.split(",")` silently corrupts those rows. This handles quoted
 * fields and doubled-quote escaping (`""` -> `"`), which is all this CSV uses.
 */
function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++; // skip the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(text) {
  // OurAirports rows are one-per-line (no embedded newlines inside quoted
  // fields in this particular dataset), so a plain line split is safe here.
  const lines = text.split("\n").filter((l) => l.length > 0);
  const header = parseCsvLine(lines[0]);
  const col = Object.fromEntries(header.map((name, i) => [name, i]));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const f = parseCsvLine(lines[i]);
    rows.push(f);
  }
  return { col, rows };
}

/** Round to 4 decimal places (~11m precision at the equator) -- plenty for a
 * point that renders as a multi-pixel glow sprite, and it noticeably shrinks
 * the output file versus float64's ~15 significant digits. */
function round4(v) {
  return Math.round(v * 10000) / 10000;
}

async function fetchLargeAirports() {
  const res = await fetch(SOURCE_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${SOURCE_URL}`);
  const text = await res.text();
  const { col, rows } = parseCsv(text);

  const airports = [];
  for (const f of rows) {
    if (f[col.type] !== "large_airport") continue;
    const lon = Number(f[col.longitude_deg]);
    const lat = Number(f[col.latitude_deg]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    airports.push([f[col.ident], f[col.name], round4(lon), round4(lat)]);
  }
  return airports;
}

/**
 * Fibonacci sphere: distributes N points as evenly as possible over a unit
 * sphere using the golden-angle spiral. Used only when the real data source
 * is unreachable -- these are NOT real airports, just placeholder geometry
 * so the example still has points to render.
 */
function syntheticSpherePoints(n) {
  const airports = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2; // 1 -> -1
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lon = (Math.atan2(z, x) * 180) / Math.PI;
    const ident = `SYN${String(i + 1).padStart(4, "0")}`;
    airports.push([ident, `Synthetic Point ${i + 1}`, round4(lon), round4(lat)]);
  }
  return airports;
}

async function main() {
  let airports;
  let source;
  try {
    airports = await fetchLargeAirports();
    if (airports.length === 0) throw new Error("parsed 0 large_airport rows -- source format changed?");
    source = `${SOURCE_URL} (public domain; type === "large_airport")`;
    console.log(`Fetched ${airports.length} large airports from OurAirports.`);
  } catch (err) {
    console.warn(`[fetch-airports] network fetch failed (${err.message}); falling back to synthetic points.`);
    airports = syntheticSpherePoints(500);
    source = "SYNTHETIC -- generated locally (Fibonacci sphere), not real airport data. See fetch-airports.mjs.";
  }

  const out = { source, fields: FIELDS, airports };
  const json = JSON.stringify(out);
  writeFileSync(OUT_PATH, json);
  const kb = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log(`Wrote ${airports.length} rows to ${OUT_PATH} (${kb} KB).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
