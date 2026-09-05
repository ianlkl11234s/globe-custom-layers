#!/usr/bin/env python3
"""Fetch and compact an OSM-derived North Atlantic cable display fixture."""
from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "site/data/atlantic-submarine-cables.geojson"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
# North Atlantic and directly connected shelf seas; this is an overview extent.
BBOX = "35,-85,70,20"
QUERY = (
    "[out:json][timeout:120];("
    f'way["communication"="line"]["submarine"]({BBOX});'
    f'way["communication"="line"]["location"="submarine"]({BBOX});'
    f'way["communication"="line"]["location"="underwater"]({BBOX});'
    f'way["communication"="line"]["seamark:type"~"cable"]({BBOX});'
    ");out tags geom;"
)

def perpendicular_distance(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    return abs(dy * point[0] - dx * point[1] - end[0] * point[1] + end[1] * point[0]) / math.hypot(dx, dy)

def simplify(points, tolerance_degrees=0.015):
    """Ramer-Douglas-Peucker: preserves line endpoints, never creates points."""
    if len(points) < 3:
        return points
    max_distance, split_at = -1.0, 0
    for index in range(1, len(points) - 1):
        distance = perpendicular_distance(points[index], points[0], points[-1])
        if distance > max_distance:
            max_distance, split_at = distance, index
    if max_distance <= tolerance_degrees:
        return [points[0], points[-1]]
    return simplify(points[: split_at + 1], tolerance_degrees)[:-1] + simplify(points[split_at:], tolerance_degrees)

def main():
    try:
        request = Request(
            OVERPASS_URL,
            data=urlencode({"data": QUERY}).encode(),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "User-Agent": "globe-custom-layers-fixture-builder/1.0 (public display extract)",
            },
        )
        with urlopen(request, timeout=180) as response:
            payload = json.load(response)
    except Exception as error:
        print(f"Overpass fetch failed; no output written: {error}", file=sys.stderr)
        return 1
    retrieved_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    features = []
    for element in payload.get("elements", []):
        coordinates = [[node["lon"], node["lat"]] for node in element.get("geometry", [])]
        # Do not replace a degenerate way with a fabricated point or centroid.
        if len(coordinates) < 2:
            continue
        tags = element.get("tags", {})
        features.append({"type": "Feature", "properties": {
            "osm_id": f"way/{element['id']}", "name": tags.get("name"),
            "operator": tags.get("operator"), "source_date": retrieved_at,
        }, "geometry": {"type": "LineString", "coordinates": simplify(coordinates)}})
    if not features:
        print("Overpass returned no renderable cable ways; no output written.", file=sys.stderr)
        return 1
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = {"type": "FeatureCollection", "name": "atlantic-submarine-cables", "metadata": {
        "source": "OpenStreetMap via Overpass API", "query": QUERY, "retrieved_at": retrieved_at,
        "license": "ODbL-1.0", "attribution": "© OpenStreetMap contributors",
        "scope": "North Atlantic communications-cable display extract",
        "limitations": "Crowdsourced and incomplete; generalized display geometry only, not an engineering chart or cable inventory.",
    }, "features": features}
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"wrote {len(features)} ways to {OUTPUT}")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
