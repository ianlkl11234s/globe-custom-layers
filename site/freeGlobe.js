// The token-free engine reuses the cookbook's Three.js geometry and effects.
import maplibregl from 'maplibre-gl';
import { createCustomLayer } from './maplibreCustom';
import { translate } from './i18n.js';
export { createCustomLayer } from './maplibreCustom';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./vendor/maplibre-gl.css', import.meta.url).href;
document.head.append(css);
const basemaps = {
  atlas: { light: { space: '#f7f8f4', ocean: '#e4efec', land: '#cbded5', border: '#5f8179', grid: '#aac5bd' }, dark: { space: '#192321', ocean: '#172b2a', land: '#29423d', border: '#91b9a9', grid: '#45685f' } },
  midnight: { light: { space: '#eef2f5', ocean: '#cddbe5', land: '#aebec9', border: '#314957', grid: '#879fac' }, dark: { space: '#0e1722', ocean: '#122335', land: '#203849', border: '#9ab8cb', grid: '#3b5870' } },
  blueprint: { light: { space: '#f2f5ed', ocean: '#dce8e6', land: '#e1e5c9', border: '#294e62', grid: '#7ca6b6' }, dark: { space: '#102632', ocean: '#123746', land: '#28535c', border: '#d3d989', grid: '#4d8790' } },
};
const glowPalettes = {
  solar: ['#ffd56a', '#ff6b35'], aurora: ['#8df0c7', '#00a6a6'], plasma: ['#ff77bd', '#a857f4'], ice: ['#e8fdff', '#4db9f4'],
};
function graticule() {
  const lines = [];
  for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat]));
  for (let lon = -180; lon < 180; lon += 30) lines.push(Array.from({ length: 85 }, (_, i) => [lon, -84 + i * 2]));
  return { type: 'FeatureCollection', features: lines.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) };
}
export function createFreeGlobe(container, { onStatus = () => {} } = {}) {
  let map = null, layer = null, scene = 'basics', theme = 'light', language = 'zh-TW', basemap = 'atlas';
  let wanted = false, generation = 0, assets = null, camera = null, lastInfo = {}, lastHudAt = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const options = { height: .02, segments: 24, paused, activeCount: 1500, speed: 1, opacity: .9, palette: 'multicolor', pointSize: 1, pointOpacity: .9, coreBoost: .7, glowPalette: 'aurora', nativePointSize: 5, nativeLineWidth: 2, nativeAreaOpacity: .28, nativePoints: true, nativeLines: true, nativeAreas: true };
  const hud = document.createElement('details');
  hud.className = 'free-custom-hud';
  hud.open = false;
  const summary = document.createElement('summary');
  const stats = document.createElement('p'); stats.className = 'custom-stats';
  const controls = document.createElement('div');
  const heightLabel = document.createElement('label'), segmentsLabel = document.createElement('label');
  const activeCountLabel = document.createElement('label'), speedLabel = document.createElement('label'), opacityLabel = document.createElement('label'), paletteLabel = document.createElement('label');
  const pointSizeLabel = document.createElement('label'), pointOpacityLabel = document.createElement('label'), coreBoostLabel = document.createElement('label'), glowPaletteLabel = document.createElement('label'), basemapLabel = document.createElement('label');
  const nativePointsLabel = document.createElement('label'), nativeLinesLabel = document.createElement('label'), nativeAreasLabel = document.createElement('label'), nativePointSizeLabel = document.createElement('label'), nativeLineWidthLabel = document.createElement('label'), nativeAreaOpacityLabel = document.createElement('label');
  const heightText = document.createElement('span'), segmentsText = document.createElement('span');
  const activeCountText = document.createElement('span'), speedText = document.createElement('span'), opacityText = document.createElement('span'), paletteText = document.createElement('span'), pointSizeText = document.createElement('span'), pointOpacityText = document.createElement('span'), coreBoostText = document.createElement('span'), glowPaletteText = document.createElement('span'), basemapText = document.createElement('span'), nativePointSizeText = document.createElement('span'), nativeLineWidthText = document.createElement('span'), nativeAreaOpacityText = document.createElement('span');
  const height = document.createElement('input'), segments = document.createElement('input');
  const activeCount = document.createElement('input'), speed = document.createElement('input'), opacity = document.createElement('input'), palette = document.createElement('select'), pointSize = document.createElement('input'), pointOpacity = document.createElement('input'), coreBoost = document.createElement('input'), glowPalette = document.createElement('select'), basemapSelect = document.createElement('select'), nativePointSize = document.createElement('input'), nativeLineWidth = document.createElement('input'), nativeAreaOpacity = document.createElement('input'), nativePoints = document.createElement('input'), nativeLines = document.createElement('input'), nativeAreas = document.createElement('input');
  Object.assign(height, { type: 'range', min: '0', max: '.08', step: '.002', value: '.02' });
  Object.assign(segments, { type: 'range', min: '2', max: '128', step: '1', value: '24' });
  Object.assign(activeCount, { type: 'range', min: '100', max: '12000', step: '100', value: '1500' });
  Object.assign(speed, { type: 'range', min: '.1', max: '4', step: '.1', value: '1' });
  Object.assign(opacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.9' });
  Object.assign(pointSize, { type: 'range', min: '.25', max: '3', step: '.05', value: '1' }); Object.assign(pointOpacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.9' }); Object.assign(coreBoost, { type: 'range', min: '0', max: '1', step: '.05', value: '.7' });
  Object.assign(nativePointSize, { type: 'range', min: '2', max: '14', step: '1', value: '5' }); Object.assign(nativeLineWidth, { type: 'range', min: '1', max: '8', step: '.5', value: '2' }); Object.assign(nativeAreaOpacity, { type: 'range', min: '.05', max: '.85', step: '.05', value: '.28' });
  [nativePoints, nativeLines, nativeAreas].forEach(input => Object.assign(input, { type: 'checkbox', checked: true }));
  height.id = 'free-arc-height'; segments.id = 'free-arc-segments';
  activeCount.id = 'free-track-count'; speed.id = 'free-track-speed'; opacity.id = 'free-track-opacity'; palette.id = 'free-track-palette';
  pointSize.id = 'free-point-size'; pointOpacity.id = 'free-point-opacity'; coreBoost.id = 'free-core-boost'; glowPalette.id = 'free-glow-palette'; basemapSelect.id = 'free-basemap';
  ['multicolor', 'cool', 'warm'].forEach(value => {
    const option = document.createElement('option'); option.value = value; palette.append(option);
  });
  ['atlas', 'midnight', 'blueprint'].forEach(value => { const option = document.createElement('option'); option.value = value; basemapSelect.append(option); });
  Object.keys(glowPalettes).forEach(value => { const option = document.createElement('option'); option.value = value; glowPalette.append(option); });
  heightLabel.append(heightText, height); segmentsLabel.append(segmentsText, segments);
  activeCountLabel.append(activeCountText, activeCount); speedLabel.append(speedText, speed); opacityLabel.append(opacityText, opacity); paletteLabel.append(paletteText, palette);
  pointSizeLabel.append(pointSizeText, pointSize); pointOpacityLabel.append(pointOpacityText, pointOpacity); coreBoostLabel.append(coreBoostText, coreBoost); glowPaletteLabel.append(glowPaletteText, glowPalette); basemapLabel.append(basemapText, basemapSelect);
  nativePointsLabel.append(nativePoints, document.createTextNode(' ')); nativeLinesLabel.append(nativeLines, document.createTextNode(' ')); nativeAreasLabel.append(nativeAreas, document.createTextNode(' ')); nativePointSizeLabel.append(nativePointSizeText, nativePointSize); nativeLineWidthLabel.append(nativeLineWidthText, nativeLineWidth); nativeAreaOpacityLabel.append(nativeAreaOpacityText, nativeAreaOpacity);
  const play = document.createElement('button'); play.type = 'button'; play.id = 'free-playback';
  controls.className = 'custom-controls';
  controls.append(basemapLabel, heightLabel, segmentsLabel, pointSizeLabel, pointOpacityLabel, coreBoostLabel, glowPaletteLabel, activeCountLabel, speedLabel, opacityLabel, paletteLabel, nativePointsLabel, nativeLinesLabel, nativeAreasLabel, nativePointSizeLabel, nativeLineWidthLabel, nativeAreaOpacityLabel, play); hud.append(summary, stats, controls);
  function announce(state, reason) {
    container.dataset.state = state;
    onStatus({ state, engine: 'maplibre-custom', airportCount: assets?.airports.airports.length, ...(reason ? { reason } : {}) });
  }
  function renderHud() {
    const zh = language === 'zh-TW';
    const t = (key, values) => translate(language, key, values);
    summary.textContent = t('maplibreControls');
    heightText.textContent = `${t('arcHeight')} · ${options.height.toFixed(3)}`;
    segmentsText.textContent = `${t('samplesPerArc')} · ${options.segments}`;
    activeCountText.textContent = `${t('activeCount')} · ${options.activeCount.toLocaleString()}`;
    speedText.textContent = `${t('trackSpeed')} · ${options.speed.toFixed(1)}×`;
    opacityText.textContent = `${t('trackOpacity')} · ${options.opacity.toFixed(2)}`;
    paletteText.textContent = t('trackPalette');
    basemapText.textContent = t('basemap');
    [...basemapSelect.options].forEach(option => { option.textContent = t(`basemap${option.value[0].toUpperCase()}${option.value.slice(1)}`); }); basemapSelect.value = basemap;
    pointSizeText.textContent = `${t('pointSize')} · ${options.pointSize.toFixed(2)}×`;
    pointOpacityText.textContent = `${t('pointOpacity')} · ${options.pointOpacity.toFixed(2)}`;
    coreBoostText.textContent = `${t('coreBoost')} · ${options.coreBoost.toFixed(2)}`;
    glowPaletteText.textContent = t('glowPalette');
    [...glowPalette.options].forEach(option => { option.textContent = t(`palette${option.value[0].toUpperCase()}${option.value.slice(1)}`); }); glowPalette.value = options.glowPalette;
    nativePointsLabel.lastChild.textContent = ` ${t('pointVisible')}`; nativeLinesLabel.lastChild.textContent = ` ${t('lineVisible')}`; nativeAreasLabel.lastChild.textContent = ` ${t('areaVisible')}`;
    nativePointSizeText.textContent = `${t('nativePointSize')} · ${options.nativePointSize}px`; nativeLineWidthText.textContent = `${t('nativeLineWidth')} · ${options.nativeLineWidth}px`; nativeAreaOpacityText.textContent = `${t('nativeAreaOpacity')} · ${options.nativeAreaOpacity.toFixed(2)}`;
    [...palette.options].forEach(option => { option.textContent = t(`palette${option.value[0].toUpperCase()}${option.value.slice(1)}`); });
    palette.value = options.palette;
    heightLabel.hidden = segmentsLabel.hidden = scene !== 'arcs';
    pointSizeLabel.hidden = pointOpacityLabel.hidden = coreBoostLabel.hidden = glowPaletteLabel.hidden = scene !== 'points';
    activeCountLabel.hidden = speedLabel.hidden = opacityLabel.hidden = paletteLabel.hidden = scene !== 'tracks';
    nativePointsLabel.hidden = nativeLinesLabel.hidden = nativeAreasLabel.hidden = nativePointSizeLabel.hidden = nativeLineWidthLabel.hidden = nativeAreaOpacityLabel.hidden = scene !== 'basics';
    play.hidden = scene !== 'tracks';
    play.textContent = paused ? t('play') : t('pause');
    play.setAttribute('aria-pressed', String(paused));
    const info = lastInfo;
    stats.textContent = [
      info.projection ? `${info.projection} · ${Number(info.transition ?? 1).toFixed(2)}` : '',
      scene === 'points' ? `${assets?.airports.airports.length ?? '—'} ${zh ? '個點' : 'points'}` : '',
      scene === 'basics' ? `${zh ? '原生點・線・面圖層' : 'native point · line · polygon layers'}` : '',
      scene === 'arcs' ? `${info.arcCount ?? '—'} ${zh ? '條弧線' : 'arcs'} · ${info.vertexCount ?? '—'} vertices` : '',
      scene === 'tracks' ? `${info.activeCount ?? options.activeCount} ${t('trackObjects')} · ${info.drawCalls ?? '—'} ${t('drawCalls')}` : '',
    ].filter(Boolean).join('\n');
  }
  height.addEventListener('input', () => { options.height = +height.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  segments.addEventListener('input', () => { options.segments = +segments.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  activeCount.addEventListener('input', () => { options.activeCount = +activeCount.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  speed.addEventListener('input', () => { options.speed = +speed.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  opacity.addEventListener('input', () => { options.opacity = +opacity.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  pointSize.addEventListener('input', () => { options.pointSize = +pointSize.value; layer?.setOptions?.(options); renderHud(); });
  pointOpacity.addEventListener('input', () => { options.pointOpacity = +pointOpacity.value; layer?.setOptions?.(options); renderHud(); });
  coreBoost.addEventListener('input', () => { options.coreBoost = +coreBoost.value; layer?.setOptions?.(options); renderHud(); });
  glowPalette.addEventListener('change', () => { options.glowPalette = glowPalette.value; layer?.setPointPalette?.(options.glowPalette); renderHud(); });
  basemapSelect.addEventListener('change', () => { basemap = basemapSelect.value; applyBasemap(); renderHud(); });
  nativePoints.addEventListener('change', () => { options.nativePoints = nativePoints.checked; applyNativeControls(); });
  nativeLines.addEventListener('change', () => { options.nativeLines = nativeLines.checked; applyNativeControls(); });
  nativeAreas.addEventListener('change', () => { options.nativeAreas = nativeAreas.checked; applyNativeControls(); });
  nativePointSize.addEventListener('input', () => { options.nativePointSize = +nativePointSize.value; applyNativeControls(); renderHud(); });
  nativeLineWidth.addEventListener('input', () => { options.nativeLineWidth = +nativeLineWidth.value; applyNativeControls(); renderHud(); });
  nativeAreaOpacity.addEventListener('input', () => { options.nativeAreaOpacity = +nativeAreaOpacity.value; applyNativeControls(); renderHud(); });
  palette.addEventListener('change', () => { options.palette = palette.value; layer?.setPalette?.(options.palette); renderHud(); map?.triggerRepaint(); });
  play.addEventListener('click', () => { paused = !paused; options.paused = paused; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  async function getAssets() {
    if (assets) return assets;
    const replies = await Promise.all(['land.json', 'airports.json'].map(name => fetch(new URL(`./${name}`, import.meta.url))));
    if (replies.some(r => !r.ok)) throw new Error('assets');
    const [land, airports] = await Promise.all(replies.map(r => r.json()));
    if (!land.features?.length || !airports.airports?.length) throw new Error('assets');
    const airportFeatures = airports.airports.map(([ident, name, lon, lat]) => ({ type: 'Feature', properties: { ident, name }, geometry: { type: 'Point', coordinates: [lon, lat] } }));
    const basicsLine = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-12, 4], [18, 31], [42, -5]] } };
    const basicsArea = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[8, -6], [42, -6], [42, 21], [8, 21], [8, -6]]] } };
    return assets = { land, airports, airportFeatures: { type: 'FeatureCollection', features: airportFeatures }, basicsLine, basicsArea };
  }
  function style(data) {
    const p = basemaps[basemap][theme];
    return { version: 8, projection: { type: ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 7, 'mercator'] }, sources: {
      land: { type: 'geojson', data: data.land }, grid: { type: 'geojson', data: graticule() }, 'native-airports': { type: 'geojson', data: data.airportFeatures }, 'native-route': { type: 'geojson', data: data.basicsLine }, 'native-area': { type: 'geojson', data: data.basicsArea },
    }, layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': p.ocean } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': p.land } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': p.border, 'line-width': .6 } },
      { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': p.grid, 'line-width': .7, 'line-opacity': .6 } },
      { id: 'native-area', type: 'fill', source: 'native-area', paint: { 'fill-color': '#d8af45', 'fill-opacity': options.nativeAreaOpacity } },
      { id: 'native-route', type: 'line', source: 'native-route', paint: { 'line-color': '#c84a37', 'line-width': options.nativeLineWidth, 'line-opacity': .9 } },
      { id: 'native-airports', type: 'circle', source: 'native-airports', paint: { 'circle-radius': options.nativePointSize, 'circle-color': '#1f7e83', 'circle-opacity': .78, 'circle-stroke-color': '#f8f5df', 'circle-stroke-width': 1 } },
    ] };
  }
  function applyScene() {
    if (!map?.isStyleLoaded() || !assets) return;
    if (layer && map.getLayer(layer.id)) map.removeLayer(layer.id);
    lastInfo = {};
    applyNativeControls();
    if (scene === 'basics') { renderHud(); return; }
    const sceneOptions = scene === 'points' ? options : scene === 'tracks' ? options : { ...options, opacity: .9 };
    layer = createCustomLayer(scene, { theme, airports: assets.airports, ...sceneOptions, onFrameInfo(info) {
      lastInfo = info;
      if (performance.now() - lastHudAt > 250) { lastHudAt = performance.now(); renderHud(); }
    } });
    map.addLayer(layer); renderHud();
  }
  function applyNativeControls() {
    if (!map?.getLayer('native-airports')) return;
    const active = scene === 'basics';
    map.setLayoutProperty('native-airports', 'visibility', active && options.nativePoints ? 'visible' : 'none'); map.setLayoutProperty('native-route', 'visibility', active && options.nativeLines ? 'visible' : 'none'); map.setLayoutProperty('native-area', 'visibility', active && options.nativeAreas ? 'visible' : 'none');
    map.setPaintProperty('native-airports', 'circle-radius', options.nativePointSize); map.setPaintProperty('native-route', 'line-width', options.nativeLineWidth); map.setPaintProperty('native-area', 'fill-opacity', options.nativeAreaOpacity);
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
        minZoom: -.5, maxZoom: 12, renderWorldCopies: false,
        attributionControl: { compact: true, customAttribution: '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a> · <a href="https://ourairports.com/data/" target="_blank" rel="noreferrer">OurAirports</a>' },
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
