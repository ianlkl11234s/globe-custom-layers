export const POINT_PALETTES = {
  spectrum: ['#1687d9', '#e14662', '#efb63f', '#7859b8', '#14a89f'],
  ocean: ['#164e78', '#237aa5', '#39a4bd', '#78c7ce', '#b7e1df'],
  ember: ['#9c2f2f', '#d4553f', '#ee7f42', '#f2b85b', '#f6d98a'],
};

export const GDP_PALETTES = {
  blue: ['#e8f1f5', '#bfd8e4', '#80b5cc', '#3d89ad', '#155675'],
  amber: ['#fff1cf', '#f3d78e', '#dfa84e', '#b8722f', '#77411f'],
  plum: ['#f0e8f2', '#d6bedc', '#b48abb', '#865c91', '#56355f'],
};

const GDP_BREAKS = [50_000_000_000, 250_000_000_000, 1_000_000_000_000, 3_000_000_000_000];

export function categoricalColorExpression(property, paletteName = 'spectrum') {
  const colors = POINT_PALETTES[paletteName] ?? POINT_PALETTES.spectrum;
  const choices = colors.flatMap((color, index) => [index, color]);
  return ['match', ['get', property], ...choices, colors[0]];
}

export function gdpFillExpression(paletteName = 'blue') {
  const colors = GDP_PALETTES[paletteName] ?? GDP_PALETTES.blue;
  return [
    'step',
    ['coalesce', ['get', 'gdp_usd'], -1],
    '#c9c9c9',
    0,
    colors[0],
    GDP_BREAKS[0],
    colors[1],
    GDP_BREAKS[1],
    colors[2],
    GDP_BREAKS[2],
    colors[3],
    GDP_BREAKS[3],
    colors[4],
  ];
}

export function stableBucket(value, bucketCount = POINT_PALETTES.spectrum.length) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % bucketCount;
}
