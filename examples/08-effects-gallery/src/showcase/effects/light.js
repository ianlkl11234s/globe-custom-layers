import * as THREE from "three";

export default [
  {
    id: "beam",
    name: "Light Beam / Laser",
    loc: [120.3014, 22.6273], city: "Kaohsiung",
    tech: "Cylinder + custom fragment shader for a vertical gradient + additive blending",
    desc: "A thin cylinder + a gradient that fades from bottom to top + AdditiveBlending = a cyberpunk light beam. Stack two layers (a thin core + an outer halo) for extra texture.",
    prompt: "Shoot a <b>[800m]</b> tall, <b>[15m]</b> radius <b>[cyan]</b> light beam up from <b>[location]</b>, fading from dense at the bottom to faint at the top, additive blending, with a wider, fainter halo layer around it.",
    params: [
      { id: "height", label: "Height (m)", min: 200, max: 3000, step: 50, value: 1200 },
      { id: "radius", label: "Radius (m)", min: 5, max: 100, step: 1, value: 25 },
      { id: "intensity", label: "Intensity", min: 0.1, max: 3.0, step: 0.1, value: 1.5 },
    ],
    build: (group) => {
      const beamShader = (intensity, ringMult) => new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0x6cf6ff) },
          uIntensity: { value: intensity },
          uRing: { value: ringMult },
        },
        vertexShader: `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          uniform float uIntensity;
          uniform float uRing;
          varying vec2 vUv;
          void main() {
            float topFade = pow(1.0 - vUv.y, 1.5);            // faint at top, dense at bottom
            float edgeFade = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.0); // faint at edges
            float a = topFade * edgeFade * uIntensity * uRing;
            gl_FragColor = vec4(uColor, a);
          }
        `,
        transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });

      // Core: thin
      const coreGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
      coreGeo.translate(0, 0.5, 0);
      coreGeo.rotateX(Math.PI / 2);
      const core = new THREE.Mesh(coreGeo, beamShader(1.0, 1.0));
      group.add(core);

      // Halo: wide
      const haloGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
      haloGeo.translate(0, 0.5, 0);
      haloGeo.rotateX(Math.PI / 2);
      const halo = new THREE.Mesh(haloGeo, beamShader(0.4, 0.6));
      group.add(halo);

      group.userData.core = core;
      group.userData.halo = halo;
    },
    update: (group, dt, t, params, scale) => {
      const { core, halo } = group.userData;
      core.scale.set(params.radius * scale, params.radius * scale, params.height * scale);
      halo.scale.set(params.radius * 3 * scale, params.radius * 3 * scale, params.height * scale);
      core.material.uniforms.uIntensity.value = params.intensity;
      halo.material.uniforms.uIntensity.value = params.intensity * 0.4;
    },
  },

  {
    id: "lightcone",
    name: "Volumetric Light Cone / God Rays",
    loc: [121.2900, 24.8800], city: "Daxi",
    tech: "Multiple LineSegments rays from an apex point to a base circle + a semi-transparent cone shell",
    desc: "Countless rays shooting down from a point in the sky to the ground + a semi-transparent cone shell = god rays, a spotlight, or a UFO beam. The rays can rotate and pulse.",
    prompt: "From a point <b>[1200m]</b> above <b>[location]</b>, shoot <b>[20]</b> <b>[pale yellow]</b> rays down onto a ground circle of <b>[600m]</b> radius, the whole thing rotating slowly.",
    params: [
      { id: "radius", label: "Base radius (m)", min: 100, max: 2000, step: 50, value: 700 },
      { id: "height", label: "Height (m)", min: 200, max: 3000, step: 100, value: 1200 },
      { id: "spin", label: "Spin", min: 0, max: 3, step: 0.1, value: 0.4 },
    ],
    build: (group) => {
      const positions = [];
      const N = 24;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        positions.push(0, 0, 1);
        positions.push(Math.cos(a), Math.sin(a), 0);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const lineMat = new THREE.LineBasicMaterial({
        color: 0xfff0a0, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending,
      });
      const lines = new THREE.LineSegments(lineGeo, lineMat);
      group.add(lines);

      const coneGeo = new THREE.ConeGeometry(1, 1, 32, 1, true);
      coneGeo.rotateX(-Math.PI / 2);
      coneGeo.translate(0, 0, 0.5);
      const coneMat = new THREE.MeshBasicMaterial({
        color: 0xfff0a0, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      });
      const cone = new THREE.Mesh(coneGeo, coneMat);
      group.add(cone);
      group.userData = { lines, cone };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const h = params.height * scale;
      group.userData.lines.scale.set(r, r, h);
      group.userData.cone.scale.set(r, r, h);
      group.userData.lines.rotation.z = t * params.spin;
      const pulse = 0.5 + 0.4 * Math.sin(t * 2);
      group.userData.lines.material.opacity = 0.4 + 0.4 * pulse;
    },
  },

  {
    id: "neon",
    name: "Neon Path",
    loc: [121.8714, 24.5839], city: "Nanfang'ao",
    tech: "TubeGeometry along a CatmullRom curve + a thin inner / wide outer dual-layer AdditiveBlending + breathing pulse",
    desc: "A curved tube = a neon sign, a glowing wire, or a light-beam trail. A white inner core + a pink outer halo layered together give a strong glow. Change the curve path for a different shape.",
    prompt: "Draw a <b>[pink]</b> neon curved tube spanning <b>[1500m]</b> at <b>[location]</b>, white inner core with a pink outer halo, pulsing once every <b>[0.3s]</b>.",
    params: [
      { id: "size", label: "Extent (m)", min: 200, max: 3000, step: 100, value: 1500 },
      { id: "haloR", label: "Halo radius", min: 0.02, max: 0.15, step: 0.005, value: 0.06 },
    ],
    build: (group) => {
      const points = [
        new THREE.Vector3(-1, 0, 0.1),
        new THREE.Vector3(-0.5, 0.7, 0.4),
        new THREE.Vector3(0.5, -0.5, 0.5),
        new THREE.Vector3(1, 0.3, 0.2),
      ];
      const curve = new THREE.CatmullRomCurve3(points);
      const coreGeo = new THREE.TubeGeometry(curve, 64, 0.012, 8, false);
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      group.add(core);
      const haloGeo = new THREE.TubeGeometry(curve, 64, 0.06, 8, false);
      const halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
        color: 0xff5b9e, transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      group.add(halo);
      group.userData = { core, halo, curve, lastHaloR: -1 };
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      group.userData.core.scale.set(sz, sz, sz);
      group.userData.halo.scale.set(sz, sz, sz);
      if (Math.abs(params.haloR - group.userData.lastHaloR) > 1e-4) {
        group.userData.lastHaloR = params.haloR;
        group.userData.halo.geometry.dispose();
        group.userData.halo.geometry = new THREE.TubeGeometry(group.userData.curve, 64, params.haloR, 8, false);
      }
      const pulse = 0.6 + 0.4 * Math.sin(t * 3);
      group.userData.core.material.opacity = pulse;
      group.userData.halo.material.opacity = pulse * 0.5;
    },
  },
];
