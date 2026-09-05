// The token-free engine reuses the cookbook's Three.js geometry and effects.
import maplibregl from 'maplibre-gl';
import { createCustomLayer } from './maplibreCustom';
import { translate } from './i18n.js';
export { createCustomLayer } from './maplibreCustom';

const css = document.createElement('link');
css.rel = 'stylesheet';
css.href = new URL('./vendor/maplibre-gl.css', import.meta.url).href;
document.head.append(css);
const palettes = {
  light: { space: '#fafcfb', ocean: '#eff6f5', land: '#dce9e6', border: '#a3c3bd', grid: '#bfd7d1' },
  dark: { space: '#202020', ocean: '#262626', land: '#383838', border: '#626262', grid: '#484848' },
};
function graticule() {
  const lines = [];
  for (let lat = -60; lat <= 60; lat += 30) lines.push(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat]));
  for (let lon = -180; lon < 180; lon += 30) lines.push(Array.from({ length: 85 }, (_, i) => [lon, -84 + i * 2]));
  return { type: 'FeatureCollection', features: lines.map(coordinates => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) };
}
export function createFreeGlobe(container, { onStatus = () => {} } = {}) {
  let map = null, layer = null, scene = 'points', theme = 'light', language = 'zh-TW';
  let wanted = false, generation = 0, assets = null, camera = null, lastInfo = {}, lastHudAt = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const options = { height: .02, segments: 24, paused, activeCount: 1500, speed: 1, opacity: .9, palette: 'multicolor' };
  const hud = document.createElement('details');
  hud.className = 'free-custom-hud';
  hud.open = container.clientWidth > 520;
  const summary = document.createElement('summary');
  const stats = document.createElement('p'); stats.className = 'custom-stats';
  const controls = document.createElement('div');
  const heightLabel = document.createElement('label'), segmentsLabel = document.createElement('label');
  const activeCountLabel = document.createElement('label'), speedLabel = document.createElement('label'), opacityLabel = document.createElement('label'), paletteLabel = document.createElement('label');
  const heightText = document.createElement('span'), segmentsText = document.createElement('span');
  const activeCountText = document.createElement('span'), speedText = document.createElement('span'), opacityText = document.createElement('span'), paletteText = document.createElement('span');
  const height = document.createElement('input'), segments = document.createElement('input');
  const activeCount = document.createElement('input'), speed = document.createElement('input'), opacity = document.createElement('input'), palette = document.createElement('select');
  Object.assign(height, { type: 'range', min: '0', max: '.08', step: '.002', value: '.02' });
  Object.assign(segments, { type: 'range', min: '2', max: '128', step: '1', value: '24' });
  Object.assign(activeCount, { type: 'range', min: '100', max: '12000', step: '100', value: '1500' });
  Object.assign(speed, { type: 'range', min: '.1', max: '4', step: '.1', value: '1' });
  Object.assign(opacity, { type: 'range', min: '.1', max: '1', step: '.05', value: '.9' });
  height.id = 'free-arc-height'; segments.id = 'free-arc-segments';
  activeCount.id = 'free-track-count'; speed.id = 'free-track-speed'; opacity.id = 'free-track-opacity'; palette.id = 'free-track-palette';
  ['multicolor', 'cool', 'warm'].forEach(value => {
    const option = document.createElement('option'); option.value = value; palette.append(option);
  });
  heightLabel.append(heightText, height); segmentsLabel.append(segmentsText, segments);
  activeCountLabel.append(activeCountText, activeCount); speedLabel.append(speedText, speed); opacityLabel.append(opacityText, opacity); paletteLabel.append(paletteText, palette);
  const play = document.createElement('button'); play.type = 'button'; play.id = 'free-playback';
  controls.className = 'custom-controls';
  controls.append(heightLabel, segmentsLabel, activeCountLabel, speedLabel, opacityLabel, paletteLabel, play); hud.append(summary, stats, controls);
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
    [...palette.options].forEach(option => { option.textContent = t(`palette${option.value[0].toUpperCase()}${option.value.slice(1)}`); });
    palette.value = options.palette;
    heightLabel.hidden = segmentsLabel.hidden = scene !== 'arcs';
    activeCountLabel.hidden = speedLabel.hidden = opacityLabel.hidden = paletteLabel.hidden = scene !== 'tracks';
    play.hidden = scene !== 'tracks';
    play.textContent = paused ? t('play') : t('pause');
    play.setAttribute('aria-pressed', String(paused));
    const info = lastInfo;
    stats.textContent = [
      info.projection ? `${info.projection} · ${Number(info.transition ?? 1).toFixed(2)}` : '',
      scene === 'points' ? `${assets?.airports.airports.length ?? '—'} ${zh ? '個點' : 'points'}` : '',
      scene === 'arcs' ? `${info.arcCount ?? '—'} ${zh ? '條弧線' : 'arcs'} · ${info.vertexCount ?? '—'} vertices` : '',
      scene === 'tracks' ? `${info.activeCount ?? options.activeCount} ${t('trackObjects')} · ${info.drawCalls ?? '—'} ${t('drawCalls')}` : '',
    ].filter(Boolean).join('\n');
  }
  height.addEventListener('input', () => { options.height = +height.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  segments.addEventListener('input', () => { options.segments = +segments.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  activeCount.addEventListener('input', () => { options.activeCount = +activeCount.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  speed.addEventListener('input', () => { options.speed = +speed.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  opacity.addEventListener('input', () => { options.opacity = +opacity.value; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  palette.addEventListener('change', () => { options.palette = palette.value; layer?.setPalette?.(options.palette); renderHud(); map?.triggerRepaint(); });
  play.addEventListener('click', () => { paused = !paused; options.paused = paused; layer?.setOptions?.(options); renderHud(); map?.triggerRepaint(); });
  async function getAssets() {
    if (assets) return assets;
    const replies = await Promise.all(['land.json', 'airports.json'].map(name => fetch(new URL(`./${name}`, import.meta.url))));
    if (replies.some(r => !r.ok)) throw new Error('assets');
    const [land, airports] = await Promise.all(replies.map(r => r.json()));
    if (!land.features?.length || !airports.airports?.length) throw new Error('assets');
    return assets = { land, airports };
  }
  function style(data) {
    const p = palettes[theme];
    return { version: 8, projection: { type: ['interpolate', ['linear'], ['zoom'], 5, 'vertical-perspective', 7, 'mercator'] }, sources: {
      land: { type: 'geojson', data: data.land }, grid: { type: 'geojson', data: graticule() },
    }, layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': p.ocean } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': p.land } },
      { id: 'coast', type: 'line', source: 'land', paint: { 'line-color': p.border, 'line-width': .6 } },
      { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': p.grid, 'line-width': .7, 'line-opacity': .6 } },
    ] };
  }
  function applyScene() {
    if (!map?.isStyleLoaded() || !assets) return;
    if (layer && map.getLayer(layer.id)) map.removeLayer(layer.id);
    lastInfo = {};
    const sceneOptions = scene === 'tracks' ? options : { ...options, opacity: .9 };
    layer = createCustomLayer(scene, { theme, airports: assets.airports, ...sceneOptions, onFrameInfo(info) {
      lastInfo = info;
      if (performance.now() - lastHudAt > 250) { lastHudAt = performance.now(); renderHud(); }
    } });
    map.addLayer(layer); renderHud();
  }
  function setTheme(value) {
    theme = value === 'dark' ? 'dark' : 'light';
    const p = palettes[theme]; container.style.background = p.space;
    if (!map?.getLayer('land')) return;
    for (const [id, property, color] of [['ocean','background-color',p.ocean],['land','fill-color',p.land],['coast','line-color',p.border],['grid','line-color',p.grid]]) map.setPaintProperty(id, property, color);
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
    setScene(value) { if (scene === value) return; scene = value; applyScene(); },
    zoomBy(factor) { map?.zoomTo(map.getZoom()+Math.log2(factor), { duration:200 }); },
    destroy() { stop(); observer.disconnect(); },
  };
}
