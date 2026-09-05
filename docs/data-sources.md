# Bundled data sources

This page records the provenance and limits of the small display fixtures in
`site/data/`. They are not live feeds and must not be used to infer missing
features, current infrastructure status, or legal boundaries.

## North Atlantic submarine communications cables

- File: `site/data/atlantic-submarine-cables.geojson`
- Source: [OpenStreetMap](https://www.openstreetmap.org/) through the
  [Overpass API](https://overpass-api.de/), queried for North Atlantic ways
  tagged `communication=line` with `submarine`, compatible underwater
  `location`, or cable `seamark:type` tags.
- Licence and attribution: [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/);
  © OpenStreetMap contributors.
- Fields: `osm_id`, `name`, `operator`, `source_date`. Missing name/operator
  values remain null.
- Boundary: this is a crowdsourced, incomplete and geometrically generalized
  display extract. It is neither an engineering chart nor a complete cable
  inventory; an empty area does not establish that no cable exists there.

## Europe GDP, 2023

- File: `site/data/europe-gdp-2023.geojson`
- Boundaries: [Natural Earth 1:50m Admin 0 – Countries](https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/),
  public domain. Its map units/boundaries are a de facto cartographic
  representation, not a legal or authoritative boundary statement.
- GDP: [World Bank indicator NY.GDP.MKTP.CD](https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?date=2023&format=json&per_page=400),
  GDP (current US$), licensed [CC BY 4.0](https://datahelpdesk.worldbank.org/knowledgebase/articles/902061-terms-of-use).
- Fields: `iso3`, `name`, `gdp_usd`, `gdp_year`. `gdp_usd: null` means missing
  or unreported, never zero. The fixture retains Natural Earth map units whose
  `CONTINENT` is Europe; some dependencies or disputed units can therefore
  retain null values when no matching World Bank country series exists. Kosovo
  retains Natural Earth's `KOS` unit code and joins World Bank's `XKX` series;
  it is never assigned Serbia's GDP.

Both generator scripts write their source retrieval timestamp into fixture
metadata and fail without writing a replacement fixture if their upstream
source is unavailable.
