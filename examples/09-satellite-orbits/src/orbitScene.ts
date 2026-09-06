import * as THREE from "three";
import { SCHEMATIC_ORBITS, orbitPointAt, sampleOrbit, type SchematicOrbit } from "./orbitMath";

const VERT = `attribute vec3 aEcef; uniform mat4 uGlobeToMerc; uniform float uTransition; uniform vec3 uCameraEcef; varying float vCull; void main(){ vec3 globeMerc=(uGlobeToMerc*vec4(aEcef,1.)).xyz; vec3 world=mix(globeMerc,position,uTransition); vec3 direction=normalize(aEcef); vec3 surface=direction*1303.7972938088067; vec3 toCamera=normalize(uCameraEcef-surface); vCull=mix(smoothstep(-.08,.02,dot(direction,toCamera)),1.,uTransition); gl_Position=projectionMatrix*modelViewMatrix*vec4(world,1.); }`;
const LINE_FRAG = `precision highp float; uniform vec3 uColor; uniform float uOpacity; varying float vCull; void main(){ gl_FragColor=vec4(uColor,uOpacity*vCull); }`;
const SAT_VERT = `attribute vec3 aEcef; uniform mat4 uGlobeToMerc; uniform float uTransition; uniform vec3 uCameraEcef; uniform float uPixelRatio; uniform float uTime; varying float vCull; varying float vPulse; void main(){ vec3 globeMerc=(uGlobeToMerc*vec4(aEcef,1.)).xyz; vec3 world=mix(globeMerc,position,uTransition); vec3 direction=normalize(aEcef); vec3 surface=direction*1303.7972938088067; vec3 toCamera=normalize(uCameraEcef-surface); vCull=mix(smoothstep(-.08,.02,dot(direction,toCamera)),1.,uTransition); vPulse=.82+.18*sin(uTime*3.+aEcef.x*.01); gl_PointSize=18.*uPixelRatio*vPulse; gl_Position=projectionMatrix*modelViewMatrix*vec4(world,1.); }`;
const SAT_FRAG = `precision highp float; uniform vec3 uColor; varying float vCull; varying float vPulse; void main(){ float d=length(gl_PointCoord-.5)*2.; if(d>1.) discard; float core=smoothstep(.28,0.,d); float glow=smoothstep(1.,.18,d)*.48; gl_FragColor=vec4(mix(uColor,vec3(1.),core),(core+glow)*vCull); }`;

export class OrbitScene {
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private satelliteGeometry: THREE.BufferGeometry | null = null;
  private satelliteMaterial: THREE.ShaderMaterial | null = null;
  private satellitePoints: THREE.Points | null = null;
  private orbitResources: Array<{ orbit: SchematicOrbit; line: THREE.Line; geometry: THREE.BufferGeometry; material: THREE.ShaderMaterial }> = [];
  private shellAltitudeScale = 1;
  private projection = new THREE.Matrix4(); private inverse = new THREE.Matrix4(); private cameraEcef = new THREE.Vector3();

  init(gl: WebGL2RenderingContext) { this.renderer = new THREE.WebGLRenderer({ canvas: gl.canvas as HTMLCanvasElement, context: gl, antialias: true }); this.renderer.autoClear = false; this.buildOrbits(); this.buildSatellites(); }
  private uniforms(color: string, opacity = 1) { return { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity }, uGlobeToMerc: { value: new THREE.Matrix4() }, uTransition: { value: 1 }, uCameraEcef: { value: new THREE.Vector3() } }; }
  private buildOrbits() {
    for (const orbit of SCHEMATIC_ORBITS) {
      const points = sampleOrbit(orbit); const position = new Float32Array(points.length * 3); const ecef = new Float32Array(points.length * 3);
      points.forEach((point, index) => { position.set(point.mercator, index * 3); ecef.set(point.ecef, index * 3); });
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(position, 3)); geometry.setAttribute("aEcef", new THREE.BufferAttribute(ecef, 3)); geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
      const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: LINE_FRAG, uniforms: this.uniforms(orbit.color, .82), transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
      const line = new THREE.Line(geometry, material); line.frustumCulled = false; this.scene.add(line); this.orbitResources.push({ orbit, line, geometry, material });
    }
  }
  private buildSatellites() {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SCHEMATIC_ORBITS.length * 3), 3)); geometry.setAttribute("aEcef", new THREE.BufferAttribute(new Float32Array(SCHEMATIC_ORBITS.length * 3), 3)); geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Infinity);
    const material = new THREE.ShaderMaterial({ vertexShader: SAT_VERT, fragmentShader: SAT_FRAG, uniforms: { ...this.uniforms("#ffffff"), uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) }, uTime: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.satelliteGeometry = geometry; this.satelliteMaterial = material; this.satellitePoints = new THREE.Points(geometry, material); this.satellitePoints.frustumCulled = false; this.scene.add(this.satellitePoints);
  }
  setFrame(matrix: number[], globeMatrix: number[] | null, transition: number, cameraMerc: { x: number; y: number; z: number } | null, simSec: number, altitudeScale: number) {
    this.camera.projectionMatrix.fromArray(matrix);
    if (globeMatrix && cameraMerc) { this.projection.fromArray(globeMatrix); this.inverse.copy(this.projection).invert(); this.cameraEcef.set(cameraMerc.x, cameraMerc.y, cameraMerc.z).applyMatrix4(this.inverse); } else { this.projection.identity(); this.cameraEcef.set(0, 0, 0); transition = 1; }
    if (altitudeScale !== this.shellAltitudeScale) { this.shellAltitudeScale = altitudeScale; for (const resource of this.orbitResources) { const positions = resource.geometry.getAttribute("position") as THREE.BufferAttribute; const ecefs = resource.geometry.getAttribute("aEcef") as THREE.BufferAttribute; sampleOrbit(resource.orbit, 180, altitudeScale).forEach((point, index) => { positions.setXYZ(index, ...point.mercator); ecefs.setXYZ(index, ...point.ecef); }); positions.needsUpdate = true; ecefs.needsUpdate = true; } }
    for (const { material } of this.orbitResources) { material.uniforms.uGlobeToMerc.value.copy(this.projection); material.uniforms.uTransition.value = transition; material.uniforms.uCameraEcef.value.copy(this.cameraEcef); }
    if (this.satelliteGeometry && this.satelliteMaterial) { const positions = this.satelliteGeometry.getAttribute("position") as THREE.BufferAttribute; const ecefs = this.satelliteGeometry.getAttribute("aEcef") as THREE.BufferAttribute; SCHEMATIC_ORBITS.forEach((orbit, index) => { const point = orbitPointAt(orbit, simSec / orbit.periodSec * 360, altitudeScale); positions.setXYZ(index, ...point.mercator); ecefs.setXYZ(index, ...point.ecef); }); positions.needsUpdate = true; ecefs.needsUpdate = true; this.satelliteMaterial.uniforms.uGlobeToMerc.value.copy(this.projection); this.satelliteMaterial.uniforms.uTransition.value = transition; this.satelliteMaterial.uniforms.uCameraEcef.value.copy(this.cameraEcef); this.satelliteMaterial.uniforms.uTime.value = simSec; }
  }
  render() { this.renderer.resetState(); this.renderer.render(this.scene, this.camera); this.renderer.resetState(); }
  dispose() { for (const resource of this.orbitResources) { this.scene.remove(resource.line); resource.geometry.dispose(); resource.material.dispose(); } this.orbitResources = []; if (this.satellitePoints) this.scene.remove(this.satellitePoints); this.satelliteGeometry?.dispose(); this.satelliteMaterial?.dispose(); this.renderer?.dispose(); }
}
