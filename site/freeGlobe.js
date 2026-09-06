// The token-free engine reuses the cookbook's Three.js geometry and effects.
import maplibregl from 'maplibre-gl';
import { createCustomLayer } from './maplibreCustom';
import { createSpecialLayer } from './specialScenes';
import { translate } from './i18n.js';
import { categoricalColorExpression, gdpFillExpression, stableBucket } from './nativeStyles.js';
export { createCustomLayer } from './maplibreCustom';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./vendor/maplibre-gl.css', import.meta.url).href;
document.head.append(css);
const basemaps = {
  atlas: { light: { space: '#ffffff', ocean: '#f7f7f7', land: '#dddddd', border: '#777777', grid: '#c9c9c9' }, dark: { space: '#192321', ocean: '#172b2a', land: '#29423d', border: '#91b9a9', grid: '#45685f' } },
  midnight: { light: { space: '#ffffff', ocean: '#eeeeee', land: '#c9c9c9', border: '#505050', grid: '#aaaaaa' }, dark: { space: '#0e1722', ocean: '#122335', land: '#203849', border: '#9ab8cb', grid: '#3b5870' } },
  blueprint: { light: { space: '#ffffff', ocean: '#fafafa', land: '#e7e7e7', border: '#666666', grid: '#d0d0d0' }, dark: { space: '#102632', ocean: '#123746', land: '#28535c', border: '#d3d989', grid: '#4d8790' } },
};
const glowPalettes = {
  spectrum: ['#0099ff', '#ff195e'],
  solar: ['#ffd56a', '#ff6b35'], aurora: ['#8df0c7', '#00a6a6'], plasma: ['#ff77bd', '#a857f4'], ice: ['#e8fdff', '#4db9f4'],
};
const nativeLineColors = { cyan: '#13a6bd', coral: '#df5a50', gold: '#d59a2e' };
const nativeCameras = {
  nativePoints: { center: [15, 18], zoom: 1.15 },
  nativeLines: { center: [-34, 39], zoom: 1.65 },
  nativeAreas: { center: [12, 52], zoom: 2.55 },
};
const isNativeScene = value => value === 'nativePoints' || value === 'nativeLines' || value === 'nativeAreas';
const isSpecialScene = value => value === 'satelliteOrbits' || value === 'boundaryWalls';
function airportPointFixture(airports) {
  return { type: 'FeatureCollection', features: airports.map(([ident, name, lon, lat]) => ({
    type: 'Feature',
    properties: { ident, name, color_index: stableBucket(ident) },
    geometry: { type: 'Point', coordinates: [lon, lat] },
  })) };
}
function graticule() {
  const lines = [];
  for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat]));
  for (let lon = -180; lon < 180; lon += 30) lines.push(Array.from({ length: 85 }, (_, i) => [lon, -84 + i * 2]));
  return { type: 'FeatureCollection', features: lines.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) };
}
export function createFreeGlobe(container, { onStatus = () => {} } = {}) {
  let map = null, layer = null, scene = 'nativePoints', theme = 'light', language = 'zh-TW', basemap = 'blueprint';
  let wanted = false, generation = 0, assets = null, camera = null, lastInfo = {}, lastHudAt = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const options = { height: .028, segments: 53, paused, orbitSpeed: 1, orbitAltitudeScale: 1, boundaryWallHeightKm: 500, activeCount: 600, speed: .3, opacity: .7, palette: 'warm', pointSize: .6, pointOpacity: .65, coreBoost: .85, glowPalette: 'plasma', arcPalette: 'plasma', nativePointSize: 4, nativePointOpacity: .82, nativePointPalette: 'spectrum', nativeLineWidth: 2.5, nativeLineOpacity: .84, nativeLineColor: 'cyan', nativeAreaOpacity: .72, nativeAreaPalette: 'blue', nativeAreaBorderWidth: .7 };
  const hud = document.createElement('details');
  hud.className = 'free-custom-hud';
  hud.open = false;
  const summary = document.createElement('summary');
  const stats = document.createElement('p'); stats.className = 'custom-stats';
  const controls = document.createElement('div');
  const heightLabel = document.createElement('label'), segmentsLabel = document.createElement('label');
  const orbitAltitudeLabel = document.createElement('label'), orbitSpeedLabel = document.createElement('label'), boundaryWallHeightLabel = document.createElement('label');
  const activeCountLabel = document.createElement('label'), speedLabel = document.createElement('label'), opacityLabel = document.createElement('label'), paletteLabel = document.createElement('label');
  const pointSizeLabel = document.createElement('label'), pointOpacityLabel = document.createElement('label'), coreBoostLabel = document.createElement('label'), glowPaletteLabel = document.createElement('fieldset'), basemapLabel = document.createElement('label');
  const nativePointSizeLabel = document.createElement('label'), nativePointOpacityLabel = document.createElement('label'), nativePointPaletteLabel = document.createElement('label');
  const nativeLineWidthLabel = document.createElement('label'), nativeLineOpacityLabel = document.createElement('label'), nativeLineColorLabel = document.createElement('label');
  const nativeAreaOpacityLabel = document.createElement('label'), nativeAreaPaletteLabel = document.createElement('label'), nativeAreaBorderWidthLabel = document.createElement('label');
  const heightText = document.createElement('span'), segmentsText = document.createElement('span');
  const orbitAltitudeText = document.createElement('span'), orbitSpeedText = document.createElement('span'), boundaryWallHeightText = document.createElement('span');
  const activeCountText = document.createElement('span'), speedText = document.createElement('span'), opacityText = document.createElement('span'), paletteText = document.createElement('span'), pointSizeText = document.createElement('span'), pointOpacityText = document.createElement('span'), coreBoostText = document.createElement('span'), glowPaletteText = document.createElement('span'), basemapText = document.createElement('span');
  const nativePointSizeText = document.createElement('span'), nativePointOpacityText = document.createElement('span'), nativePointPaletteText = document.createElement('span');
  const nativeLineWidthText = document.createElement('span'), nativeLineOpacityText = document.createElement('span'), nativeLineColorText = document.createElement('span');
  const nativeAreaOpacityText = document.createElement('span'), nativeAreaPaletteText = document.createElement('span'), nativeAreaBorderWidthText = document.createElement('span');
  const height = document.createElement('input'), segments = document.createElement('input');
  const orbitAltitude = document.createElement('input'), orbitSpeed = document.createElement('input'), boundaryWallHeight = document.createElement('input');
  const activeCount = document.createElement('input'), speed = document.createElement('input'), opacity = document.createElement('input'), palette = document.createElement('select'), pointSize = document.createElement('input'), pointOpacity = document.createElement('input'), coreBoost = document.createElement('input'), glowPaletteChoices = document.createElement('div'), basemapSelect = document.createElement('select');
  const nativePointSize = document.createElement('input'), nativePointOpacity = document.createElement('input'), nativePointPalette = document.createElement('select');
  const nativeLineWidth = document.createElement('input'), nativeLineOpacity = document.createElement('input'), nativeLineColor = document.createElement('select');
  const nativeAreaOpacity = document.createElement('input'), nativeAreaPalette = document.createElement('select'), nativeAreaBorderWidth = document.createElement('input');
  Object.assign(height, { type: 'range', min: '0', max: '.08', step: '.002', value: '.028' });
  Object.assign(segments, { type: 'range', min: '2', max: '128', step: '1', value: '53' });
  Object.assign(orbitAltitude, { type: 'range', min: '.5', max: '3', step: '.1', value: '1' });
  Object.assign(orbitSpeed, { type: 'range', min: '.1', max: '4', step: '.1', value: '1' });
  Object.assign(boundaryWallHeight, { type: 'range', min: '50', max: '1500', step: '50', value: '500' });
  Object.assign(activeCount, { type: 'range', min: '100', max: '12000', step: '100', value: '600' });
  Object.assign(speed, { type: 'range', min: '.1', max: '4', step: '.1', value: '.3' });
  Object.assign(opacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.7' });
  Object.assign(pointSize, { type: 'range', min: '.25', max: '3', step: '.05', value: '.6' }); Object.assign(pointOpacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.65' }); Object.assign(coreBoost, { type: 'range', min: '0', max: '1', step: '.05', value: '.85' });
  Object.assign(nativePointSize, { type: 'range', min: '2', max: '12', step: '1', value: '4' }); Object.assign(nativePointOpacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.82' });
  Object.assign(nativeLineWidth, { type: 'range', min: '.5', max: '8', step: '.5', value: '2.5' }); Object.assign(nativeLineOpacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.84' });
  Object.assign(nativeAreaOpacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.72' }); Object.assign(nativeAreaBorderWidth, { type: 'range', min: '0', max: '3', step: '.25', value: '.7' });
  height.id = 'free-arc-height'; segments.id = 'free-arc-segments';
  orbitAltitude.id = 'free-orbit-altitude'; orbitSpeed.id = 'free-orbit-speed'; boundaryWallHeight.id = 'free-boundary-wall-height';
  activeCount.id = 'free-track-count'; speed.id = 'free-track-speed'; opacity.id = 'free-track-opacity'; palette.id = 'free-track-palette';
  pointSize.id = 'free-point-size'; pointOpacity.id = 'free-point-opacity'; coreBoost.id = 'free-core-boost'; glowPaletteChoices.id = 'free-glow-palette'; glowPaletteChoices.className = 'glow-palette-choices'; basemapSelect.id = 'free-basemap';
  nativePointSize.id = 'free-native-point-size'; nativePointOpacity.id = 'free-native-point-opacity'; nativePointPalette.id = 'free-native-point-palette';
  nativeLineWidth.id = 'free-native-line-width'; nativeLineOpacity.id = 'free-native-line-opacity'; nativeLineColor.id = 'free-native-line-color';
  nativeAreaOpacity.id = 'free-native-area-opacity'; nativeAreaPalette.id = 'free-native-area-palette'; nativeAreaBorderWidth.id = 'free-native-area-border-width';
  ['multicolor', 'cool', 'warm'].forEach(value => {
    const option = document.createElement('option'); option.value = value; palette.append(option);
  });
  ['atlas', 'midnight', 'blueprint'].forEach(value => { const option = document.createElement('option'); option.value = value; basemapSelect.append(option); });
  ['spectrum', 'ocean', 'ember'].forEach(value => { const option = document.createElement('option'); option.value = value; nativePointPalette.append(option); });
  ['cyan', 'coral', 'gold'].forEach(value => { const option = document.createElement('option'); option.value = value; nativeLineColor.append(option); });
  ['blue', 'amber', 'plum'].forEach(value => { const option = document.createElement('option'); option.value = value; nativeAreaPalette.append(option); });
  const glowPaletteButtons = Object.keys(glowPalettes).map(value => {
    const button = document.createElement('button'); button.type = 'button'; button.dataset.palette = value; button.className = 'glow-palette-choice';
    button.style.setProperty('--swatch-a', glowPalettes[value][0]); button.style.setProperty('--swatch-b', glowPalettes[value][1]); glowPaletteChoices.append(button); return button;
  });
  heightLabel.append(heightText, height); segmentsLabel.append(segmentsText, segments);
  orbitAltitudeLabel.append(orbitAltitudeText, orbitAltitude); orbitSpeedLabel.append(orbitSpeedText, orbitSpeed); boundaryWallHeightLabel.append(boundaryWallHeightText, boundaryWallHeight);
  activeCountLabel.append(activeCountText, activeCount); speedLabel.append(speedText, speed); opacityLabel.append(opacityText, opacity); paletteLabel.append(paletteText, palette);
  pointSizeLabel.append(pointSizeText, pointSize); pointOpacityLabel.append(pointOpacityText, pointOpacity); coreBoostLabel.append(coreBoostText, coreBoost); glowPaletteLabel.append(glowPaletteText, glowPaletteChoices); basemapLabel.append(basemapText, basemapSelect);
  nativePointSizeLabel.append(nativePointSizeText, nativePointSize); nativePointOpacityLabel.append(nativePointOpacityText, nativePointOpacity); nativePointPaletteLabel.append(nativePointPaletteText, nativePointPalette);
  nativeLineWidthLabel.append(nativeLineWidthText, nativeLineWidth); nativeLineOpacityLabel.append(nativeLineOpacityText, nativeLineOpacity); nativeLineColorLabel.append(nativeLineColorText, nativeLineColor);
  nativeAreaOpacityLabel.append(nativeAreaOpacityText, nativeAreaOpacity); nativeAreaPaletteLabel.append(nativeAreaPaletteText, nativeAreaPalette); nativeAreaBorderWidthLabel.append(nativeAreaBorderWidthText, nativeAreaBorderWidth);
  const play = document.createElement('button'); play.type = 'button'; play.id = 'free-playback';
  controls.className = 'custom-controls';
  controls.append(basemapLabel, heightLabel, segmentsLabel, orbitAltitudeLabel, orbitSpeedLabel, boundaryWallHeightLabel, pointSizeLabel, pointOpacityLabel, coreBoostLabel, glowPaletteLabel, activeCountLabel, speedLabel, opacityLabel, paletteLabel, nativePointSizeLabel, nativePointOpacityLabel, nativePointPaletteLabel, nativeLineWidthLabel, nativeLineOpacityLabel, nativeLineColorLabel, nativeAreaOpacityLabel, nativeAreaPaletteLabel, nativeAreaBorderWidthLabel, play); hud.append(summary, stats, controls);
  function announce(state, reason) {
    container.dataset.state = state;
    const featureCount = isNativeScene(scene) ? assets?.[scene]?.features.length : scene === 'satelliteOrbits' ? 3 : scene === 'boundaryWalls' ? 1 : undefined;
    onStatus({ state, engine: isNativeScene(scene) ? 'maplibre-native' : 'maplibre-custom', airportCount: isSpecialScene(scene) ? undefined : assets?.airports.airports.length, featureCount, dataKind: scene, ...(reason ? { reason } : {}) });
  }
  function renderHud() {
    const zh = language === 'zh-TW';
    const t = (key, values) => translate(language, key, values);
    summary.textContent = t(isNativeScene(scene) ? 'maplibreLayerControls' : 'maplibreControls');
    heightText.textContent = `${t('arcHeight')} · ${options.height.toFixed(3)}`;
    segmentsText.textContent = `${t('samplesPerArc')} · ${options.segments}`;
    orbitAltitudeText.textContent = `${t('orbitAltitudeScale')} · ${options.orbitAltitudeScale.toFixed(1)}×`;
    orbitSpeedText.textContent = `${t('orbitSpeed')} · ${options.orbitSpeed.toFixed(1)}×`;
    boundaryWallHeightText.textContent = `${t('boundaryWallHeight')} · ${options.boundaryWallHeightKm.toFixed(0)} km`;
    activeCountText.textContent = `${t('activeCount')} · ${options.activeCount.toLocaleString()}`;
    speedText.textContent = `${t('trackSpeed')} · ${options.speed.toFixed(1)}×`;
    opacityText.textContent = `${t('trackOpacity')} · ${options.opacity.toFixed(2)}`;
    paletteText.textContent = t('trackPalette');
    basemapText.textContent = t('basemap');
    [...basemapSelect.options].forEach(option => { option.textContent = t(`basemap${option.value[0].toUpperCase()}${option.value.slice(1)}`); }); basemapSelect.value = basemap;
    pointSizeText.textContent = `${t('pointSize')} · ${options.pointSize.toFixed(2)}×`;
    pointOpacityText.textContent = `${t('pointOpacity')} · ${options.pointOpacity.toFixed(2)}`;
    coreBoostText.textContent = `${t('coreBoost')} · ${options.coreBoost.toFixed(2)}`;
    const activeEffectPalette = scene === 'arcs' ? options.arcPalette : options.glowPalette;
    glowPaletteText.textContent = t(scene === 'arcs' ? 'arcPalette' : 'glowPalette');
    glowPaletteButtons.forEach(button => {
      const value = button.dataset.palette; button.textContent = t(`palette${value[0].toUpperCase()}${value.slice(1)}`);
      const active = value === activeEffectPalette; button.classList.toggle('is-active', active); button.setAttribute('aria-pressed', String(active));
    });
    nativePointSizeText.textContent = `${t('nativePointSize')} · ${options.nativePointSize}px`; nativePointOpacityText.textContent = `${t('nativePointOpacity')} · ${options.nativePointOpacity.toFixed(2)}`; nativePointPaletteText.textContent = t('nativePointPalette');
    nativeLineWidthText.textContent = `${t('nativeLineWidth')} · ${options.nativeLineWidth}px`; nativeLineOpacityText.textContent = `${t('nativeLineOpacity')} · ${options.nativeLineOpacity.toFixed(2)}`; nativeLineColorText.textContent = t('nativeLineColor');
    nativeAreaOpacityText.textContent = `${t('nativeAreaOpacity')} · ${options.nativeAreaOpacity.toFixed(2)}`; nativeAreaPaletteText.textContent = t('nativeAreaPalette'); nativeAreaBorderWidthText.textContent = `${t('nativeAreaBorderWidth')} · ${options.nativeAreaBorderWidth.toFixed(2)}px`;
    [...nativePointPalette.options].forEach(option => { option.textContent = t(`nativePalette${option.value[0].toUpperCase()}${option.value.slice(1)}`); }); nativePointPalette.value = options.nativePointPalette;
    [...nativeLineColor.options].forEach(option => { option.textContent = t(`nativeLine${option.value[0].toUpperCase()}${option.value.slice(1)}`); }); nativeLineColor.value = options.nativeLineColor;
    [...nativeAreaPalette.options].forEach(option => { option.textContent = t(`gdpPalette${option.value[0].toUpperCase()}${option.value.slice(1)}`); }); nativeAreaPalette.value = options.nativeAreaPalette;
    [...palette.options].forEach(option => { option.textContent = t(`palette${option.value[0].toUpperCase()}${option.value.slice(1)}`); });
    palette.value = options.palette;
    heightLabel.hidden = segmentsLabel.hidden = scene !== 'arcs';
    orbitAltitudeLabel.hidden = orbitSpeedLabel.hidden = scene !== 'satelliteOrbits';
    boundaryWallHeightLabel.hidden = scene !== 'boundaryWalls';
    pointSizeLabel.hidden = pointOpacityLabel.hidden = coreBoostLabel.hidden = scene !== 'points';
    glowPaletteLabel.hidden = scene !== 'points' && scene !== 'arcs';
    activeCountLabel.hidden = speedLabel.hidden = opacityLabel.hidden = paletteLabel.hidden = scene !== 'tracks';
    nativePointSizeLabel.hidden = nativePointOpacityLabel.hidden = nativePointPaletteLabel.hidden = scene !== 'nativePoints';
    nativeLineWidthLabel.hidden = nativeLineOpacityLabel.hidden = nativeLineColorLabel.hidden = scene !== 'nativeLines';
    nativeAreaOpacityLabel.hidden = nativeAreaPaletteLabel.hidden = nativeAreaBorderWidthLabel.hidden = scene !== 'nativeAreas';
    play.hidden = scene !== 'tracks' && scene !== 'satelliteOrbits';
    play.textContent = paused ? t('play') : t('pause');
    play.setAttribute('aria-pressed', String(paused));
    const info = lastInfo;
    stats.textContent = [
      info.projection ? `${info.projection} · ${Number(info.transition ?? 1).toFixed(2)}` : '',
      scene === 'points' ? `${assets?.airports.airports.length ?? '—'} ${zh ? '個點' : 'points'}` : '',
      scene === 'nativePoints' ? `${assets?.nativePoints.features.length ?? '—'} ${zh ? '個機場點位' : 'airport points'}` : '',
      scene === 'nativeLines' ? `${assets?.nativeLines.features.length ?? '—'} ${zh ? '條大西洋海纜線段' : 'Atlantic cable features'}` : '',
      scene === 'nativeAreas' ? `${assets?.nativeAreas.features.length ?? '—'} ${zh ? '個歐洲國家／地區' : 'European countries / areas'} · GDP 2023` : '',
      scene === 'arcs' ? `${info.arcCount ?? '—'} ${zh ? '條弧線' : 'arcs'} · ${info.vertexCount ?? '—'} vertices` : '',
      scene === 'tracks' ? `${info.activeCount ?? options.activeCount} ${t('trackObjects')} · ${info.drawCalls ?? '—'} ${t('drawCalls')}` : '',
      scene === 'satelliteOrbits' ? `${info.orbitCount ?? 3} ${zh ? '條示意環軌' : 'schematic orbital rings'} · ${info.satelliteCount ?? 3} ${zh ? '個移動標記' : 'moving markers'}` : '',
      scene === 'boundaryWalls' ? `${info.wallSegments ?? 5} ${zh ? '段垂直牆面' : 'vertical wall segments'} · ${info.displayHeightKm ?? 500} km ${zh ? '示意高度' : 'display height'}` : '',
    ].filter(Boolean).join('\n');
  }
  height.addEventListener('input', () => { options.height = +height.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  segments.addEventListener('input', () => { options.segments = +segments.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  orbitAltitude.addEventListener('input', () => { options.orbitAltitudeScale = +orbitAltitude.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  orbitSpeed.addEventListener('input', () => { options.orbitSpeed = +orbitSpeed.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  boundaryWallHeight.addEventListener('input', () => { options.boundaryWallHeightKm = +boundaryWallHeight.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  activeCount.addEventListener('input', () => { options.activeCount = +activeCount.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  speed.addEventListener('input', () => { options.speed = +speed.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  opacity.addEventListener('input', () => { options.opacity = +opacity.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  pointSize.addEventListener('input', () => { options.pointSize = +pointSize.value; layer?.setOptions?.(options); renderHud(); });
  pointOpacity.addEventListener('input', () => { options.pointOpacity = +pointOpacity.value; layer?.setOptions?.(options); renderHud(); });
  coreBoost.addEventListener('input', () => { options.coreBoost = +coreBoost.value; layer?.setOptions?.(options); renderHud(); });
  glowPaletteButtons.forEach(button => button.addEventListener('click', () => {
    if (scene === 'arcs') { options.arcPalette = button.dataset.palette; layer?.setArcPalette?.(options.arcPalette); }
    else { options.glowPalette = button.dataset.palette; layer?.setPointPalette?.(options.glowPalette); }
    renderHud(); map?.triggerRepaint();
  }));
  basemapSelect.addEventListener('change', () => { basemap = basemapSelect.value; applyBasemap(); renderHud(); });
  nativePointSize.addEventListener('input', () => { options.nativePointSize = +nativePointSize.value; applyNativeControls(); renderHud(); });
  nativePointOpacity.addEventListener('input', () => { options.nativePointOpacity = +nativePointOpacity.value; applyNativeControls(); renderHud(); });
  nativePointPalette.addEventListener('change', () => { options.nativePointPalette = nativePointPalette.value; applyNativeControls(); renderHud(); });
  nativeLineWidth.addEventListener('input', () => { options.nativeLineWidth = +nativeLineWidth.value; applyNativeControls(); renderHud(); });
  nativeLineOpacity.addEventListener('input', () => { options.nativeLineOpacity = +nativeLineOpacity.value; applyNativeControls(); renderHud(); });
  nativeLineColor.addEventListener('change', () => { options.nativeLineColor = nativeLineColor.value; applyNativeControls(); renderHud(); });
  nativeAreaOpacity.addEventListener('input', () => { options.nativeAreaOpacity = +nativeAreaOpacity.value; applyNativeControls(); renderHud(); });
  nativeAreaPalette.addEventListener('change', () => { options.nativeAreaPalette = nativeAreaPalette.value; applyNativeControls(); renderHud(); });
  nativeAreaBorderWidth.addEventListener('input', () => { options.nativeAreaBorderWidth = +nativeAreaBorderWidth.value; applyNativeControls(); renderHud(); });
  palette.addEventListener('change', () => { options.palette = palette.value; layer?.setPalette?.(options.palette); renderHud(); map?.triggerRepaint(); });
  play.addEventListener('click', () => { paused = !paused; options.paused = paused; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  async function getAssets() {
    if (assets) return assets;
    const names = ['land.json', 'airports.json', 'data/atlantic-submarine-cables.geojson', 'data/europe-gdp-2023.geojson'];
    const replies = await Promise.all(names.map(name => fetch(new URL(name, document.baseURI))));
    if (replies.some(r => !r.ok)) throw new Error('assets');
    const [land, airports, nativeLines, nativeAreas] = await Promise.all(replies.map(r => r.json()));
    if (!land.features?.length || !airports.airports?.length || !nativeLines.features?.length || !nativeAreas.features?.length) throw new Error('assets');
    return assets = { land, airports, nativePoints: airportPointFixture(airports.airports), nativeLines, nativeAreas };
  }
  function style(data) {
    const p = basemaps[basemap][theme];
    return { version: 8, projection: { type: ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 7, 'mercator'] }, sources: {
      land: { type: 'geojson', data: data.land }, grid: { type: 'geojson', data: graticule() }, 'native-points': { type: 'geojson', data: data.nativePoints }, 'native-lines': { type: 'geojson', data: data.nativeLines, attribution: '© OpenStreetMap contributors · ODbL 1.0' }, 'native-areas': { type: 'geojson', data: data.nativeAreas },
    }, layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': p.ocean } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': p.land } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': p.border, 'line-width': .6 } },
      { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': p.grid, 'line-width': .7, 'line-opacity': .6 } },
      { id: 'native-areas', type: 'fill', source: 'native-areas', paint: { 'fill-color': gdpFillExpression(options.nativeAreaPalette), 'fill-opacity': options.nativeAreaOpacity } },
      { id: 'native-area-borders', type: 'line', source: 'native-areas', paint: { 'line-color': '#ffffff', 'line-opacity': .88, 'line-width': options.nativeAreaBorderWidth } },
      { id: 'native-lines', type: 'line', source: 'native-lines', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': nativeLineColors[options.nativeLineColor], 'line-width': options.nativeLineWidth, 'line-opacity': options.nativeLineOpacity } },
      { id: 'native-points', type: 'circle', source: 'native-points', paint: { 'circle-radius': options.nativePointSize, 'circle-color': categoricalColorExpression('color_index', options.nativePointPalette), 'circle-opacity': options.nativePointOpacity, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } },
    ] };
  }
  function applyScene() {
    if (!map?.isStyleLoaded() || !assets) return;
    if (layer && map.getLayer(layer.id)) map.removeLayer(layer.id);
    lastInfo = {};
    applyNativeControls();
    const view = isNativeScene(scene) ? nativeCameras[scene] : scene === 'boundaryWalls' ? { center: [120.2, 25], zoom: 3.35 } : scene === 'satelliteOrbits' ? { center: [121, 24], zoom: 1.05 } : { center: [20, 20], zoom: Math.log2(Math.max(160, Math.min(container.clientWidth, container.clientHeight) * .82) / (512 / Math.PI)) };
    map.easeTo({ center: view.center, zoom: view.zoom, duration: 550 });
    if (isNativeScene(scene)) { renderHud(); announce('ready'); return; }
    const sceneOptions = scene === 'points' ? options : scene === 'tracks' ? options : { ...options, opacity: .9 };
    const onFrameInfo = info => {
      lastInfo = info;
      if (performance.now() - lastHudAt > 250) { lastHudAt = performance.now(); renderHud(); }
    };
    layer = isSpecialScene(scene)
      ? createSpecialLayer(scene, { theme, boundaryWallHeightKm: options.boundaryWallHeightKm, onFrameInfo })
      : createCustomLayer(scene, { theme, airports: assets.airports, ...sceneOptions, onFrameInfo });
    if (scene === 'satelliteOrbits') layer.setOptions({ paused, orbitSpeed: options.orbitSpeed, orbitAltitudeScale: options.orbitAltitudeScale });
    map.addLayer(layer); renderHud(); announce('ready');
  }
  function applyNativeControls() {
    if (!map?.getLayer('native-points')) return;
    map.setLayoutProperty('native-points', 'visibility', scene === 'nativePoints' ? 'visible' : 'none'); map.setLayoutProperty('native-lines', 'visibility', scene === 'nativeLines' ? 'visible' : 'none'); map.setLayoutProperty('native-areas', 'visibility', scene === 'nativeAreas' ? 'visible' : 'none'); map.setLayoutProperty('native-area-borders', 'visibility', scene === 'nativeAreas' ? 'visible' : 'none');
    map.setPaintProperty('native-points', 'circle-radius', options.nativePointSize); map.setPaintProperty('native-points', 'circle-opacity', options.nativePointOpacity); map.setPaintProperty('native-points', 'circle-color', categoricalColorExpression('color_index', options.nativePointPalette));
    map.setPaintProperty('native-lines', 'line-width', options.nativeLineWidth); map.setPaintProperty('native-lines', 'line-opacity', options.nativeLineOpacity); map.setPaintProperty('native-lines', 'line-color', nativeLineColors[options.nativeLineColor]);
    map.setPaintProperty('native-areas', 'fill-opacity', options.nativeAreaOpacity); map.setPaintProperty('native-areas', 'fill-color', gdpFillExpression(options.nativeAreaPalette)); map.setPaintProperty('native-area-borders', 'line-width', options.nativeAreaBorderWidth);
  }
  function applyBasemap() {
    const p = basemaps[basemap][theme]; container.style.background = p.space;
    if (!map?.getLayer('land')) return;
    for (const [id, property, color] of [['ocean','background-color',p.ocean],['land','fill-color',p.land],['coast','line-color',p.border],['grid','line-color',p.grid]]) map.setPaintProperty(id, property, color);
    map.triggerRepaint();
  }
  function setTheme(value) {
    theme = value === 'dark' ? 'dark' : 'light';
    applyBasemap();
    if (!map?.getLayer('land')) return;
    layer?.setTheme?.(theme); map.triggerRepaint();
  }
  function setLanguage(value) {
    language = value === 'en' ? 'en' : 'zh-TW'; renderHud();
    map?.getCanvas().setAttribute('aria-label', language === 'en' ? 'MapLibre custom globe. Drag to rotate, scroll to zoom.' : 'MapLibre 自訂地球特效；拖曳旋轉，滾輪縮放。');
  }
  async function start() {
    if (wanted) { map?.resize(); return; }
    wanted = true; const current = ++generation; announce('loading');
    try {
      const data = await getAssets();
      if (!wanted || current !== generation) return;
      const next = new maplibregl.Map({ container, style: style(data),
        ...(camera ?? { center: [20,20], zoom: Math.log2(Math.max(160, Math.min(container.clientWidth,container.clientHeight)*.82)/(512/Math.PI)) }),
        minZoom: -.5, maxZoom: 18, renderWorldCopies: false,
        attributionControl: { compact: true, customAttribution: '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · <a href="https://ourairports.com/data/" target="_blank" rel="noreferrer">OurAirports</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a> · <a href="https://data.worldbank.org/indicator/NY.GDP.MKTP.CD" target="_blank" rel="noreferrer">World Bank · CC BY 4.0</a>' },
      });
      map = next; container.append(hud);
      next.on('load', () => { if (next !== map) return; applyScene(); setTheme(theme); setLanguage(language); announce('ready'); });
      next.on('error', () => { if (next === map) announce('error', 'renderer'); });
    } catch { if (current === generation) { wanted = false; announce('error','assets-or-webgl'); } }
  }
  function stop() {
    wanted = false; generation++; hud.remove();
    if (map) { camera = { center: map.getCenter().toArray(), zoom: map.getZoom() }; map.remove(); map = null; layer = null; }
  }
  const observer = new ResizeObserver(() => map?.resize()); observer.observe(container);
  return { start, stop, setTheme, setLanguage,
    setScene(value) { if (scene === value) return; scene = value; hud.open = false; applyScene(); },
    zoomBy(factor) { map?.zoomTo(map.getZoom()+Math.log2(factor), { duration:200 }); },
    destroy() { stop(); observer.disconnect(); },
  };
}
