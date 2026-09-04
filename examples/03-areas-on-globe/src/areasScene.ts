import * as THREE from "three";
import mapboxgl from "mapbox-gl";
import { lonLatToEcef, mercatorToGlobe, type Vec3 } from "./globeProject";
import { bboxOutline, geodesicCircle, triangulateFan, type LonLat } from "./shapes";

/**
 * Renders a handful of fixed demo shapes -- three geodesic circles at
 * different latitudes, one lat/lon bounding box -- as a filled mesh + an
 * outline loop each, hugging Mapbox's globe projection.
 *
 * Architectural choice, contrasted with the companion `01-points-on-globe`
 * example: that example does the sphere<->flat blend and the backface cull
 * ON THE GPU, in a GLSL vertex/fragment shader (`GLOBE_PROJECT_GLSL`), which
 * is the right call for thousands of points redrawn every frame. This
 * example instead calls `mercatorToGlobe()` -- the plain JS half of the same
 * math -- ON THE CPU, once per boundary vertex per frame, and writes the
 * result straight into a `THREE.MeshBasicMaterial` / `THREE.LineBasicMaterial`
 * geometry's position + vertex-color attributes. No custom shader anywhere
 * in this file.
 *
 * That trade only makes sense because this example's vertex counts are tiny
 * (a few hundred, not thousands) -- the point of THIS example is subdivision
 * and triangulation, not shader tricks, so keeping the render path to
 * "plain Three.js materials" keeps the spotlight there. See the README's
 * "Deliberate simplifications" section.
 *
 * Per-vertex backface culling still happens (`mercatorToGlobe`'s `cull`
 * return value), it's just written into the vertex-color alpha channel
 * instead of a fragment shader varying. This relies on a genuine, undocumented-
 * but-real Three.js feature: a `color` BufferAttribute with itemSize 4 (not 3)
 * makes Three.js define `USE_COLOR_ALPHA` and multiply the vertex color's
 * alpha into the material's opacity automatically -- see
 * `node_modules/three/build/three.module.js`, search `vertexAlphas`. No
 * `onBeforeCompile`, no custom fragment shader required.
 */

export type ShapeMode = "circles" | "bbox" | "both";

interface ShapeDef {
  id: string;
  kind: "circle" | "bbox";
  colorHex: number;
  center?: LonLat; // circle only
  sw?: LonLat; // bbox only
  ne?: LonLat; // bbox only
}

// Three circles at the SAME radius, at equator / mid-latitude / near-polar
// centers -- this is the example's headline image (see task requirement 4):
// "500km" looks like a completely different size and shape on screen
// depending on where on the globe it sits, even though every one of these
// is geometrically identical (same angular radius around its own center).
const CIRCLE_DEFS: ShapeDef[] = [
  { id: "circle-equator", kind: "circle", center: { lon: 0, lat: 0 }, colorHex: 0x4fc3f7 },
  { id: "circle-midlat", kind: "circle", center: { lon: 20, lat: 45 }, colorHex: 0xffb74d },
  { id: "circle-polar", kind: "circle", center: { lon: 60, lat: 85 }, colorHex: 0xef5350 },
];

// One large box, deliberately wide (40 x 25 degrees) so the "straight edges
// are chords" problem in requirement 1 is obvious even at low segment counts.
const BBOX_DEFS: ShapeDef[] = [
  { id: "bbox-demo", kind: "bbox", sw: { lon: -10, lat: -5 }, ne: { lon: 30, lat: 20 }, colorHex: 0xab47bc },
];

const FILL_ALPHA = 0.35;
const OUTLINE_ALPHA = 0.9;

interface Shape {
  def: ShapeDef;
  vertexCount: number;
  // Precomputed ONCE per rebuild (segments/radius change), not per frame --
  // same "Step 1" discipline as 01-points-on-globe, just applied to a
  // polygon boundary instead of a point cloud.
  mercPositions: Float32Array; // vertexCount * 3
  ecefPositions: Float32Array; // vertexCount * 3
  fillMesh: THREE.Mesh;
  fillGeometry: THREE.BufferGeometry;
  outlineLine: THREE.LineLoop;
  outlineGeometry: THREE.BufferGeometry;
}

export class AreasScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();

  private circleGroup = new THREE.Group();
  private bboxGroup = new THREE.Group();
  private shapes: Shape[] = [];

  private projScratch = new THREE.Matrix4();
  private invScratch = new THREE.Matrix4();
  private camEcefScratch = new THREE.Vector3();

  // Step 2's shader early-out ("uTransition >= 1.0 costs nothing extra"),
  // reproduced on the CPU: once we've written the fully-flat positions once,
  // re-running the same per-vertex loop every frame while nothing changes
  // would be pure waste. Reset to false whenever transition drops back below
  // 1 (globe re-entering the blend) or the geometry is rebuilt.
  private flatApplied = false;

  init(gl: WebGL2RenderingContext) {
    this.renderer = new THREE.WebGLRenderer({
      canvas: gl.canvas as HTMLCanvasElement,
      context: gl,
      antialias: true,
    });
    // Mapbox owns the framebuffer and has already drawn into it this frame;
    // an auto-clearing renderer would wipe the basemap out from under us.
    this.renderer.autoClear = false;

    this.scene.add(this.circleGroup);
    this.scene.add(this.bboxGroup);
  }

  /**
   * (Re)builds every demo shape's geometry from scratch at the given
   * segment count / circle radius. Called once at startup and again
   * whenever the segments or radius slider changes -- NOT every frame.
   * Unlike `01-points-on-globe`' fixed-capacity point buffers (sized for a
   * dataset that's loaded once and never resized), this example's shapes are
   * a handful of small convex polygons rebuilt only on user interaction, so
   * a full dispose-and-recreate is simpler than maintaining a capacity
   * ceiling and is still imperceptibly cheap.
   */
  rebuild(segments: number, radiusKm: number) {
    for (const shape of this.shapes) {
      shape.fillMesh.parent?.remove(shape.fillMesh);
      shape.outlineLine.parent?.remove(shape.outlineLine);
      shape.fillGeometry.dispose();
      (shape.fillMesh.material as THREE.Material).dispose();
      shape.outlineGeometry.dispose();
      (shape.outlineLine.material as THREE.Material).dispose();
    }
    this.shapes = [];
    this.flatApplied = false;

    for (const def of [...CIRCLE_DEFS, ...BBOX_DEFS]) {
      const boundary =
        def.kind === "circle"
          ? geodesicCircle(def.center!, radiusKm, Math.max(1, segments))
          : bboxOutline(def.sw!, def.ne!, Math.max(1, segments));
      const shape = this.buildShape(def, boundary);
      this.shapes.push(shape);
      const group = def.kind === "circle" ? this.circleGroup : this.bboxGroup;
      group.add(shape.fillMesh);
      group.add(shape.outlineLine);
    }
  }

  private buildShape(def: ShapeDef, boundary: LonLat[]): Shape {
    const n = boundary.length;
    const mercPositions = new Float32Array(n * 3);
    const ecefPositions = new Float32Array(n * 3);
    const color = new THREE.Color(def.colorHex);

    const fillPosition = new Float32Array(n * 3);
    const fillColor = new Float32Array(n * 4);
    const outlinePosition = new Float32Array(n * 3);
    const outlineColor = new Float32Array(n * 4);

    for (let i = 0; i < n; i++) {
      const p = boundary[i]!;
      const mc = mapboxgl.MercatorCoordinate.fromLngLat([p.lon, p.lat], 0);
      const ecef = lonLatToEcef(p.lon, p.lat, mc.z);

      mercPositions[i * 3] = mc.x;
      mercPositions[i * 3 + 1] = mc.y;
      mercPositions[i * 3 + 2] = mc.z;
      ecefPositions[i * 3] = ecef.x;
      ecefPositions[i * 3 + 1] = ecef.y;
      ecefPositions[i * 3 + 2] = ecef.z;

      // Initialize to the flat mercator position so the shape is never
      // garbage before the first setGlobe() call.
      fillPosition[i * 3] = mc.x;
      fillPosition[i * 3 + 1] = mc.y;
      fillPosition[i * 3 + 2] = mc.z;
      outlinePosition[i * 3] = mc.x;
      outlinePosition[i * 3 + 1] = mc.y;
      outlinePosition[i * 3 + 2] = mc.z;

      fillColor[i * 4] = color.r;
      fillColor[i * 4 + 1] = color.g;
      fillColor[i * 4 + 2] = color.b;
      fillColor[i * 4 + 3] = FILL_ALPHA;
      outlineColor[i * 4] = color.r;
      outlineColor[i * 4 + 1] = color.g;
      outlineColor[i * 4 + 2] = color.b;
      outlineColor[i * 4 + 3] = OUTLINE_ALPHA;
    }

    const fillGeometry = new THREE.BufferGeometry();
    fillGeometry.setAttribute("position", new THREE.BufferAttribute(fillPosition, 3));
    // itemSize 4 (NOT 3) is what makes Three.js honor per-vertex alpha -- see
    // this file's class docstring.
    fillGeometry.setAttribute("color", new THREE.BufferAttribute(fillColor, 4));
    fillGeometry.setIndex(triangulateFan(n));
    // Custom layers don't participate in Mapbox's frustum culling, and a
    // bounding sphere computed from mercator-space positions is meaningless
    // once points are projected onto/around a globe.
    fillGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    const fillMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      // Fan-triangulated winding isn't guaranteed to face the camera from
      // every angle a rotating globe can present; per-vertex alpha (the
      // `cull` factor above) already handles far-side visibility, so there's
      // no reason to ALSO lose the near side to backface culling.
      side: THREE.DoubleSide,
      // Recipe Step 3: Mapbox has already drawn a solid, depth-writing
      // sphere into the shared framebuffer by the time this layer runs.
      depthTest: false,
      depthWrite: false,
    });
    const fillMesh = new THREE.Mesh(fillGeometry, fillMaterial);
    fillMesh.frustumCulled = false;

    const outlineGeometry = new THREE.BufferGeometry();
    outlineGeometry.setAttribute("position", new THREE.BufferAttribute(outlinePosition, 3));
    outlineGeometry.setAttribute("color", new THREE.BufferAttribute(outlineColor, 4));
    outlineGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);

    const outlineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    // THREE.LineLoop, not THREE.Line -- it closes the loop back to vertex 0
    // for free, so the boundary array doesn't need a duplicated last point.
    const outlineLine = new THREE.LineLoop(outlineGeometry, outlineMaterial);
    outlineLine.frustumCulled = false;

    return {
      def,
      vertexCount: n,
      mercPositions,
      ecefPositions,
      fillMesh,
      fillGeometry,
      outlineLine,
      outlineGeometry,
    };
  }

  setShapeMode(mode: ShapeMode) {
    this.circleGroup.visible = mode === "circles" || mode === "both";
    this.bboxGroup.visible = mode === "bbox" || mode === "both";
  }

  /**
   * Feeds this frame's globe parameters into every shape's boundary
   * vertices, exactly mirroring what `GLOBE_PROJECT_GLSL` would do per
   * vertex on the GPU -- just run here, in JS, once per vertex per frame.
   * Pass `globeToMerc: null` for the mercator-only fallback (matches
   * glowLayer.ts's convention in the companion example).
   */
  setGlobe(globeToMerc: number[] | null, transition: number, cameraMerc: Vec3 | null) {
    const hasMatrix = !!globeToMerc && globeToMerc.length >= 16;
    const effectiveTransition = hasMatrix ? Math.max(0, Math.min(1, transition)) : 1;

    if (effectiveTransition >= 1) {
      if (this.flatApplied) return; // CPU-side echo of the shader's early-out
      this.applyToAllShapes(null, 1, null);
      this.flatApplied = true;
      return;
    }
    this.flatApplied = false;

    let cameraEcef: Vec3 | null = null;
    if (hasMatrix && cameraMerc) {
      // Load the matrix, THEN invert it -- see globeProject.ts's setGlobe
      // docstring in the companion example for why the order matters.
      this.invScratch.fromArray(globeToMerc!).invert();
      this.camEcefScratch.set(cameraMerc.x, cameraMerc.y, cameraMerc.z).applyMatrix4(this.invScratch);
      cameraEcef = { x: this.camEcefScratch.x, y: this.camEcefScratch.y, z: this.camEcefScratch.z };
    }

    this.applyToAllShapes(hasMatrix ? globeToMerc : null, effectiveTransition, cameraEcef);
  }

  private applyToAllShapes(globeToMerc: number[] | null, transition: number, cameraEcef: Vec3 | null) {
    for (const shape of this.shapes) {
      const fillPos = shape.fillGeometry.getAttribute("position") as THREE.BufferAttribute;
      const fillCol = shape.fillGeometry.getAttribute("color") as THREE.BufferAttribute;
      const outPos = shape.outlineGeometry.getAttribute("position") as THREE.BufferAttribute;
      const outCol = shape.outlineGeometry.getAttribute("color") as THREE.BufferAttribute;

      for (let i = 0; i < shape.vertexCount; i++) {
        const mercPos: Vec3 = {
          x: shape.mercPositions[i * 3]!,
          y: shape.mercPositions[i * 3 + 1]!,
          z: shape.mercPositions[i * 3 + 2]!,
        };
        const ecef: Vec3 = {
          x: shape.ecefPositions[i * 3]!,
          y: shape.ecefPositions[i * 3 + 1]!,
          z: shape.ecefPositions[i * 3 + 2]!,
        };
        const result = mercatorToGlobe(mercPos, ecef, globeToMerc, transition, cameraEcef);

        fillPos.setXYZ(i, result.x, result.y, result.z);
        fillCol.setW(i, FILL_ALPHA * result.cull);
        outPos.setXYZ(i, result.x, result.y, result.z);
        outCol.setW(i, OUTLINE_ALPHA * result.cull);
      }

      fillPos.needsUpdate = true;
      fillCol.needsUpdate = true;
      outPos.needsUpdate = true;
      outCol.needsUpdate = true;
    }
  }

  /** Renders one frame. `matrix` is whatever Mapbox's render() received as its projection matrix. */
  render(matrix: number[]) {
    // Custom layers share a single GL context with Mapbox's own renderer, so
    // GL state must be left exactly as found -- resetState() before AND
    // after, or Mapbox's next draw call inherits our state.
    this.renderer.resetState();
    this.camera.projectionMatrix = this.projScratch.fromArray(matrix);
    this.renderer.render(this.scene, this.camera);
    this.renderer.resetState();
  }

  dispose() {
    for (const shape of this.shapes) {
      shape.fillGeometry.dispose();
      (shape.fillMesh.material as THREE.Material).dispose();
      shape.outlineGeometry.dispose();
      (shape.outlineLine.material as THREE.Material).dispose();
    }
    this.shapes = [];
    this.renderer?.dispose();
  }
}
