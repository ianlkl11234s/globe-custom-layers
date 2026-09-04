import * as THREE from "three";
import mapboxgl from "mapbox-gl";
import { GLOBE_PROJECT_GLSL, lonLatToEcef } from "./globeProject";
import { sampleArc, type ArcRoute, type ArcSample } from "./arcs";

/**
 * A single `THREE.LineSegments` draw call rendering every origin-destination
 * arc as a glowing great-circle line, hugging Mapbox's globe projection and
 * blending back to flat Web Mercator as you zoom in.
 *
 * The whole reason this example exists lives in `rebuildGeometry()` below:
 * this is the "predetermined number of intermediate vertices" recipe.mapbox.md
 * warns you must build yourself -- Mapbox projects vertices, not the segments
 * between them, so a two-point arc is a straight chord through the planet no
 * matter how correct its endpoints are. `segmentsPerArc` (really a VERTEX
 * count -- see arcs.ts's sampleArc docstring) controls exactly how many
 * points get sampled along that chord before it starts looking like a curve.
 */

// Fixed-capacity buffers, per the recipe's "Step 5: watch your buffer
// ceiling" -- this example's 20 hand-picked hubs (see airports.ts) produce
// C(20,2) = 190 routes; 256 leaves comfortable headroom without the buffer
// being unreasonably oversized. MAX_SEGMENTS_PER_ARC matches the "segments
// per arc" slider's own maximum (128) -- see index.html.
const MAX_ARC_COUNT = 256;
const MAX_SEGMENTS_PER_ARC = 128;
// THREE.LineSegments draws every consecutive PAIR of buffer vertices as one
// independent segment (GL_LINES, not GL_LINE_STRIP) -- an arc sampled at N
// vertices needs (N-1) segments, each contributing 2 (shared points are
// repeated, not indexed) buffer vertices.
const MAX_LINE_VERTICES = MAX_ARC_COUNT * (MAX_SEGMENTS_PER_ARC - 1) * 2;

export const DEFAULT_SEGMENTS_PER_ARC = 24;
// Deliberately exaggerated: a real airliner's cruise altitude (~10km) is
// about 0.16% of Earth's radius -- rendered at true scale it would be
// visually indistinguishable from the surface. Like most flight-arc
// visualizations, the height here is a stylistic "read as a flight path" cue,
// not a physical altitude. See README.
export const DEFAULT_ARC_HEIGHT_MERC_Z = 0.02;
export const MAX_ARC_HEIGHT_MERC_Z = 0.08;

// A single fixed accent color/alpha for every arc -- see README's "deliberate
// simplifications" for why this isn't a per-route or user-adjustable value.
// Alpha is kept low deliberately: with 20 hubs fully interconnected, up to 19
// arcs converge on any one hub, and additive blending stacks their alpha --
// a high per-arc value would blow every hub out to solid white.
const ARC_COLOR = "#ffb454";
const ARC_ALPHA = 0.28;

const VERT = /* glsl */ `
${GLOBE_PROJECT_GLSL}

attribute vec3 aEcef; // precomputed at buffer-build time, see rebuildGeometry()

varying float vCull;

void main() {
  float cull;
  // "position" is this vertex's flat-mercator location, INCLUDING the
  // synthetic arc-height baked into its z (see writeVertex) -- globeWorldPosition
  // blends it with aEcef per the current sphere<->flat transition.
  vec3 world = globeWorldPosition(position, aEcef, cull);
  vCull = cull;

  vec4 mvPos = modelViewMatrix * vec4(world, 1.0);
  gl_Position = projectionMatrix * mvPos;
}
`;

const FRAG = /* glsl */ `
precision highp float;

uniform vec3 uColor;
uniform float uAlpha;

varying float vCull;

void main() {
  // vCull multiplies alpha (never a hard discard) so the globe's horizon
  // fades like atmosphere instead of hard-clipping -- see globeProject.ts.
  gl_FragColor = vec4(uColor, uAlpha * vCull);
}
`;

/**
 * Writes one vertex's position + aEcef attributes at buffer index `index`.
 * This is the "static geometry" precomputed-ECEF path from globeProject.ts's
 * Step 1 -- see this example's README for why that's the right call here
 * (arcs don't move frame to frame; only their SHAPE changes, occasionally,
 * when segmentsPerArc/arcHeight sliders move, which is what triggers a call
 * to this function again -- see rebuildGeometry).
 *
 * `mercatorLon` is passed in separately from `sample.lon` rather than
 * recomputed here -- see rebuildGeometry's per-SEGMENT wrap for why the two
 * endpoints of one line segment must resolve their mercator longitude
 * together, not independently.
 */
function writeVertex(
  posAttr: THREE.BufferAttribute,
  ecefAttr: THREE.BufferAttribute,
  index: number,
  sample: ArcSample,
  mercatorLon: number,
) {
  const mc = mapboxgl.MercatorCoordinate.fromLngLat([mercatorLon, sample.lat], 0);
  posAttr.setXYZ(index, mc.x, mc.y, sample.heightMercZ);

  // lonLatToEcef's sin/cos ARE 360-periodic, so the ORIGINAL (possibly
  // unwrapped) sample.lon works here unmodified -- unlike mercator-X above,
  // ECEF doesn't care which "copy" of the longitude it's handed.
  const ecef = lonLatToEcef(sample.lon, sample.lat, sample.heightMercZ);
  ecefAttr.setXYZ(index, ecef.x, ecef.y, ecef.z);
}

/**
 * Maps a longitude to Mapbox's canonical (-180, 180] range. Used as the
 * starting point for each line segment's pair-relative wrap in
 * rebuildGeometry -- see that function for why a plain per-VERTEX wrap
 * (applied independently to every sample) isn't enough on its own.
 */
function wrapLongitude(lon: number): number {
  let wrapped = lon;
  while (wrapped > 180) wrapped -= 360;
  while (wrapped <= -180) wrapped += 360;
  return wrapped;
}

export class ArcsScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private lines: THREE.LineSegments | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private material: THREE.ShaderMaterial | null = null;

  private routes: ArcRoute[] = [];
  // -1 is an intentionally invalid sentinel (real values are >=2 and >=0
  // respectively) so the FIRST setParams() call after setRoutes() always
  // rebuilds, even if it happens to be called with values that equal
  // whatever DEFAULT_SEGMENTS_PER_ARC/DEFAULT_ARC_HEIGHT_MERC_Z are -- a
  // plain "did the field literally change" check would otherwise skip that
  // very first build. See setParams/setRoutes.
  private segmentsPerArc = -1;
  private arcHeightMercZ = -1;
  private lastVertexCount = 0;

  // Scratch objects reused every frame so render()/setGlobe() don't allocate.
  private projScratch = new THREE.Matrix4();
  private invScratch = new THREE.Matrix4();
  private camEcefScratch = new THREE.Vector3();

  get arcCount(): number {
    return this.routes.length;
  }

  get liveVertexCount(): number {
    return this.lastVertexCount;
  }

  init(gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
      antialias: true,
    });
    // Mapbox owns the framebuffer and has already drawn into it this frame;
    // an auto-clearing renderer would wipe the basemap out from under us.
    this.renderer.autoClear = false;
    this.buildMesh();
  }

  private buildMesh() {
    this.geometry = new THREE.BufferGeometry();
    const position = new Float32Array(MAX_LINE_VERTICES * 3);
    const aEcef = new Float32Array(MAX_LINE_VERTICES * 3);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    this.geometry.setAttribute("aEcef", new THREE.BufferAttribute(aEcef, 3));
    this.geometry.setDrawRange(0, 0);
    // Custom layers don't participate in Mapbox's frustum culling, and a
    // finite bounding sphere computed from mercator-space positions would be
    // meaningless once points are projected onto/around a globe.
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(ARC_COLOR) },
        uAlpha: { value: ARC_ALPHA },
        uGlobeToMerc: { value: new THREE.Matrix4() },
        uTransition: { value: 1 }, // 1 = flat mercator until the first setGlobe() call
        uCameraEcef: { value: new THREE.Vector3() },
      },
      transparent: true,
      // Mapbox has already drawn a SOLID, depth-writing sphere into the
      // shared framebuffer by the time this layer's render() runs -- depth
      // testing against it would silently clip these lines away, near side
      // and far side alike. See globeProject.ts / recipe Step 3.
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending, // arcs converging on a hub add up -> a bright node, "for free"
    });

    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false; // see boundingSphere note above
    this.scene.add(this.lines);
  }

  /**
   * Stores the route list this scene draws arcs for. Deliberately does NOT
   * rebuild the GPU buffers itself -- the caller (arcLayer.ts) always follows
   * this with a `setParams()` call using the current slider values, and
   * rebuilding here too would just be immediately redone. Resets the
   * segments/height sentinels so that following setParams() call is
   * guaranteed to actually rebuild (see this class's field docstrings).
   */
  setRoutes(routes: ArcRoute[]) {
    if (routes.length > MAX_ARC_COUNT) {
      console.warn(
        `[ArcsScene] ${routes.length} routes exceeds MAX_ARC_COUNT=${MAX_ARC_COUNT}; clamping. ` +
          `Raise MAX_ARC_COUNT if you need more hubs.`,
      );
    }
    this.routes = routes.slice(0, MAX_ARC_COUNT);
    this.segmentsPerArc = -1;
    this.arcHeightMercZ = -1;
  }

  /**
   * Sets this frame's "segments per arc" and "arc height" slider values,
   * rebuilding the GPU buffers from scratch if either actually changed.
   *
   * Rebuilding means re-running `sampleArc` (slerp + a trig call per sample)
   * for every route, every time either slider moves -- not just once at load.
   * For this example's ~190 arcs at up to 128 vertices each, that is at most
   * a few hundred thousand trig calls, comfortably sub-millisecond on any
   * modern machine. A version that separates "resample the great-circle path
   * geographically" (only needs to happen once, ever, per route) from
   * "recompute height and re-derive ECEF/mercator" (needs to happen on every
   * arcHeight change) would avoid redoing the slerp itself on a pure height
   * change -- see README's "deliberate simplifications" for why this example
   * doesn't bother.
   */
  setParams(segmentsPerArc: number, arcHeightMercZ: number) {
    const clampedSegments = Math.max(2, Math.min(MAX_SEGMENTS_PER_ARC, Math.round(segmentsPerArc)));
    const clampedHeight = Math.max(0, Math.min(MAX_ARC_HEIGHT_MERC_Z, arcHeightMercZ));
    if (clampedSegments === this.segmentsPerArc && clampedHeight === this.arcHeightMercZ) return;

    this.segmentsPerArc = clampedSegments;
    this.arcHeightMercZ = clampedHeight;
    this.rebuildGeometry();
  }

  private rebuildGeometry() {
    if (!this.geometry || this.routes.length === 0) return;
    const posAttr = this.geometry.getAttribute("position") as THREE.BufferAttribute;
    const ecefAttr = this.geometry.getAttribute("aEcef") as THREE.BufferAttribute;

    let vi = 0; // next free vertex slot in the LineSegments buffer
    routeLoop: for (const route of this.routes) {
      const samples = sampleArc(route.origin, route.dest, this.segmentsPerArc, this.arcHeightMercZ);
      for (let i = 0; i < samples.length - 1; i++) {
        if (vi + 2 > MAX_LINE_VERTICES) {
          console.warn(
            `[ArcsScene] hit MAX_LINE_VERTICES=${MAX_LINE_VERTICES} ` +
              `(routes=${this.routes.length}, segmentsPerArc=${this.segmentsPerArc}); remaining arcs truncated.`,
          );
          break routeLoop;
        }

        const s0 = samples[i]!;
        const s1 = samples[i + 1]!;
        // Resolve this ONE segment's pair of mercator longitudes together,
        // not independently. sampleArc's samples[].lon is already a globally
        // continuous sequence (see arcs.ts's unwrapLongitude), so s1.lon - s0.lon
        // is always the true, small step between adjacent samples -- even for
        // the one segment of an antimeridian-crossing arc where s1.lon itself
        // is far outside (-180, 180]. Anchoring s1's mercator-X to s0's,
        // rather than independently wrapping each into (-180, 180], keeps
        // that one segment's two endpoints on the SAME side of the antimeridian
        // instead of opposite edges of mercator space -- which, left
        // independent, draws a line spanning nearly the entire flat map (see
        // README's "Deliberate simplifications"). mapboxgl.LngLat accepts an
        // out-of-canonical-range longitude by design (its own docs construct
        // one from 286.0251 deg and only wrap() it on request), so lon1
        // landing a hair outside (-180, 180] here is expected, not a bug.
        const lon0 = wrapLongitude(s0.lon);
        const lon1 = lon0 + (s1.lon - s0.lon);
        writeVertex(posAttr, ecefAttr, vi++, s0, lon0);
        writeVertex(posAttr, ecefAttr, vi++, s1, lon1);
      }
    }

    posAttr.needsUpdate = true;
    ecefAttr.needsUpdate = true;
    this.geometry.setDrawRange(0, vi);
    this.lastVertexCount = vi;
  }

  /**
   * Feeds this frame's globe parameters into the shader. See
   * glowPointsScene.ts (examples/01-points-on-globe) for the full
   * docstring on why matrix + camera are bundled into one call -- this is
   * the identical pattern.
   */
  setGlobe(globeToMerc: number[] | null, transition: number, cameraMerc: { x: number; y: number; z: number } | null) {
    if (!this.material) return;
    const globeToMercUniform = this.material.uniforms.uGlobeToMerc!.value as THREE.Matrix4;

    if (!globeToMerc || globeToMerc.length < 16) {
      globeToMercUniform.identity();
      this.material.uniforms.uTransition!.value = 1;
      return;
    }

    globeToMercUniform.fromArray(globeToMerc);
    this.material.uniforms.uTransition!.value = Math.max(0, Math.min(1, transition));

    if (cameraMerc) {
      this.invScratch.copy(globeToMercUniform).invert();
      this.camEcefScratch.set(cameraMerc.x, cameraMerc.y, cameraMerc.z).applyMatrix4(this.invScratch);
      (this.material.uniforms.uCameraEcef!.value as THREE.Vector3).copy(this.camEcefScratch);
    }
  }

  /** Renders one frame. `matrix` is whatever Mapbox's render() received as its projection matrix. */
  render(matrix: number[]) {
    if (!this.material) return;

    // Custom layers share a single GL context with Mapbox's own renderer, so
    // GL state must be left exactly as found -- resetState() before AND after.
    this.renderer.resetState();
    this.camera.projectionMatrix = this.projScratch.fromArray(matrix);
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  dispose() {
    if (this.lines) this.scene.remove(this.lines);
    this.geometry?.dispose();
    this.material?.dispose();
    this.renderer?.dispose();
  }
}
