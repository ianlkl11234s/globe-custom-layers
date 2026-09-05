#!/usr/bin/env python3
"""Join Natural Earth 1:50m European map units to World Bank 2023 GDP."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "site/data/europe-gdp-2023.geojson"
NE_URL = "https://naturalearth.s3.amazonaws.com/50m_cultural/ne_50m_admin_0_countries.zip"
WB_URL = "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?date=2023&format=json&per_page=400"
WB_ISO3_OVERRIDES = {"KOS": "XKX"}  # World Bank's Kosovo aggregate code.

def map_unit_iso3(properties):
    """Prefer NE's unit code; fall back without assigning Kosovo Serbia's GDP."""
    for key in ("ISO_A3", "ISO_A3_EH", "GU_A3"):
        value = properties.get(key)
        if value and value != "-99":
            return value
    return None

def main():
    temp_dir = Path(tempfile.mkdtemp(prefix="globe-gdp-"))
    try:
        try:
            with urlopen(NE_URL, timeout=180) as response:
                archive = temp_dir / "countries.zip"
                archive.write_bytes(response.read())
            with zipfile.ZipFile(archive) as zipped:
                zipped.extractall(temp_dir / "ne")
            shapefile = next((temp_dir / "ne").glob("*.shp"))
            geojson = temp_dir / "countries.geojson"
            subprocess.run(["ogr2ogr", "-f", "GeoJSON", str(geojson), str(shapefile)], check=True)
            countries = json.loads(geojson.read_text())
            with urlopen(WB_URL, timeout=180) as response:
                wb_payload = json.load(response)
        except Exception as error:
            print(f"Natural Earth or World Bank fetch/convert failed; no output written: {error}", file=sys.stderr)
            return 1
        if not isinstance(wb_payload, list) or len(wb_payload) < 2:
            print("World Bank response has an unexpected shape; no output written.", file=sys.stderr)
            return 1
        gdp_by_iso3 = {row.get("countryiso3code"): row.get("value") for row in wb_payload[1] if row.get("countryiso3code")}
        retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        features = []
        for feature in countries.get("features", []):
            properties = feature.get("properties", {})
            if properties.get("CONTINENT") != "Europe":
                continue
            iso3 = map_unit_iso3(properties)
            if not iso3:
                continue
            features.append({"type": "Feature", "properties": {
                "iso3": iso3, "name": properties.get("ADMIN"),
                "gdp_usd": gdp_by_iso3.get(WB_ISO3_OVERRIDES.get(iso3, iso3)), "gdp_year": 2023,
            }, "geometry": feature.get("geometry")})
        if not features:
            print("Natural Earth returned no European map units; no output written.", file=sys.stderr)
            return 1
        OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        document = {"type": "FeatureCollection", "name": "europe-gdp-2023", "metadata": {
            "boundaries_source": "Natural Earth 1:50m Admin 0 – Countries", "boundaries_url": NE_URL,
            "boundaries_license": "public domain",
            "boundary_semantics": "Natural Earth de facto boundary/map-unit representation; not a legal or authoritative boundary statement.",
            "indicator": "World Bank NY.GDP.MKTP.CD (GDP, current US$)", "indicator_url": WB_URL,
            "indicator_license": "CC BY 4.0", "retrieved_at": retrieved_at,
            "null_semantics": "A null gdp_usd is missing/not reported data and is not zero.",
        }, "features": features}
        OUTPUT.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n")
        missing = sum(f["properties"]["gdp_usd"] is None for f in features)
        print(f"wrote {len(features)} European map units ({missing} GDP null) to {OUTPUT}")
        return 0
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

if __name__ == "__main__":
    raise SystemExit(main())
