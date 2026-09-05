import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readFixture = async (name) => JSON.parse(await readFile(new URL(`../data/${name}`, import.meta.url), 'utf8'));

test('Atlantic cable fixture keeps OSM lineage and real line geometry', async () => {
  const data = await readFixture('atlantic-submarine-cables.geojson');
  assert.equal(data.metadata.license, 'ODbL-1.0');
  assert.match(data.metadata.limitations, /incomplete/i);
  assert.ok(data.features.length > 100);
  for (const feature of data.features) {
    assert.equal(feature.geometry.type, 'LineString');
    assert.match(feature.properties.osm_id, /^way\/\d+$/);
    assert.ok(feature.geometry.coordinates.length >= 2);
  }
});

test('Europe GDP fixture keeps missing values as null instead of zero', async () => {
  const data = await readFixture('europe-gdp-2023.geojson');
  assert.equal(data.metadata.indicator, 'World Bank NY.GDP.MKTP.CD (GDP, current US$)');
  assert.match(data.metadata.null_semantics, /not zero/i);
  assert.ok(data.features.length >= 40);
  assert.ok(data.features.some((feature) => feature.properties.gdp_usd === null));
  assert.ok(data.features.some((feature) => Number.isFinite(feature.properties.gdp_usd) && feature.properties.gdp_usd > 0));
  assert.ok(data.features.every((feature) => feature.properties.gdp_year === 2023));
});
