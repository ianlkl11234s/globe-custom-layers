import * as THREE from "three";

export default [
  {
    id: "skirt",
    name: "Skirt Sway (Vertex Wave)",
    loc: [120.8214, 24.5602], city: "Miaoli",
    tech: "Cylinder + vertex shader uses sin(z + time) for horizontal displacement",
    desc: "In the vertex shader, each vertex gets a horizontal offset based on \"height + time\" → the whole shape sways like a jellyfish / sea anemone / curtain in the wind. Displacement amplitude is adjustable.",
    prompt: "Erect a <b>[pink]</b> cylinder at <b>[location]</b> (400m tall, 100m radius), top stays still while the bottom sways up to 30m, like a swaying jellyfish.",
    params: [
      { id: "height", label: "Height (m)", min: 100, max: 1200, step: 20, value: 500 },
      { id: "radius", label: "Radius (m)", min: 30, max: 400, step: 10, value: 120 },
      { id: "amp", label: "Sway (m)", min: 0, max: 100, step: 1, value: 40 },
    ],
    build: (group) => {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 32, 32, true);
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAmp: { value: 0.05 },
          uColor: { value: new THREE.Color(0xff7eb6) },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uAmp;
          varying float vH;
          void main() {
            vH = position.z; // 0 = base -> 1 = top
            // Base doesn't move (vH=0), top would be max (vH=1) -- but inverted: for a "skirt" effect the top stays still and the bottom sways
            float wave = (1.0 - vH) * uAmp;
            float dx = sin(uTime * 2.0 + vH * 6.0) * wave;
            float dy = cos(uTime * 2.0 + vH * 6.0) * wave;
            vec3 p = position + vec3(dx, dy, 0.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying float vH;
          void main() {
            float a = mix(0.7, 0.15, vH); // fades at top, denser at bottom
            gl_FragColor = vec4(uColor, a);
          }
        `,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      m.scale.set(params.radius * scale, params.radius * scale, params.height * scale);
      m.material.uniforms.uTime.value = t;
      // Sway amount is passed in as a fraction of radius (the wave in the shader is relative to a unit cylinder)
      m.material.uniforms.uAmp.value = params.amp / Math.max(params.radius, 1);
    },
  },

  {
    id: "flow",
    name: "Flowing Gradient",
    loc: [120.5300, 23.7000], city: "Yunlin",
    tech: "Cylinder + fragment shader uses uv.y - time for upward-flowing color bands",
    desc: "Uses sin/sawtooth in the fragment shader to create color bands, with uv offset over time → looks like flowing energy. The same technique can flow horizontally to represent \"data transfer\".",
    prompt: "Erect a <b>[600m]</b> tall cylinder at <b>[location]</b>, with <b>[3]</b> upward-flowing <b>[blue-purple gradient]</b> color bands inside, moving one body-length per second.",
    params: [
      { id: "height", label: "Height (m)", min: 200, max: 1500, step: 50, value: 700 },
      { id: "radius", label: "Radius (m)", min: 30, max: 300, step: 5, value: 80 },
      { id: "speed", label: "Flow speed", min: 0, max: 3, step: 0.1, value: 0.6 },
      { id: "bands", label: "Bands", min: 1, max: 8, step: 1, value: 3 },
    ],
    build: (group) => {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uSpeed: { value: 0.6 }, uBands: { value: 3 },
          uColorA: { value: new THREE.Color(0x4366ff) },
          uColorB: { value: new THREE.Color(0xc44dff) },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform float uTime;
          uniform float uSpeed;
          uniform float uBands;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          void main() {
            float y = vUv.y - uTime * uSpeed;
            float wave = sin(y * uBands * 6.2831);
            float band = smoothstep(0.0, 1.0, wave);
            vec3 col = mix(uColorA, uColorB, band);
            float a = (0.3 + 0.5 * band) * (1.0 - vUv.y * 0.6); // fades more toward the top
            gl_FragColor = vec4(col, a);
          }
        `,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      m.scale.set(params.radius * scale, params.radius * scale, params.height * scale);
      m.material.uniforms.uTime.value = t;
      m.material.uniforms.uSpeed.value = params.speed;
      m.material.uniforms.uBands.value = params.bands;
    },
  },

  {
    id: "aurora",
    name: "Aurora Ribbon",
    loc: [120.9577, 23.4727], city: "Yushan",
    tech: "High-altitude PlaneGeometry + vertex shader sine wave + UV-scrolling color bands",
    desc: "A long plane floats high in the sky; the vertex shader makes it ripple like a curtain, while gradient color + UV scrolling in the fragment shader = aurora. Change the colors for clouds, haze fronts, or sound waves.",
    prompt: "Lay a <b>[green-purple]</b> ribbon <b>[3500m]</b> long and <b>[700m]</b> tall at <b>[2200m]</b> altitude above <b>[location]</b>, rippling side to side + colors scrolling vertically, additive blending.",
    params: [
      { id: "altitude", label: "Altitude (m)", min: 500, max: 5000, step: 100, value: 2200 },
      { id: "length", label: "Length (m)", min: 500, max: 8000, step: 100, value: 3500 },
      { id: "height", label: "Curtain height (m)", min: 100, max: 2000, step: 50, value: 700 },
      { id: "amp", label: "Wave amplitude", min: 0, max: 0.5, step: 0.01, value: 0.18 },
    ],
    build: (group) => {
      const geo = new THREE.PlaneGeometry(1, 1, 64, 16);
      geo.rotateX(Math.PI / 2); // stand it up: original +Y -> +Z
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uAmp: { value: 0.18 },
          uColorA: { value: new THREE.Color(0x4cffa6) },
          uColorB: { value: new THREE.Color(0xa080ff) },
        },
        vertexShader: `
          uniform float uTime; uniform float uAmp;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            // wave Y along the X (uv.x) direction (drifts north-south)
            p.y += sin(uv.x * 6.2831 * 2.0 + uTime * 1.5) * uAmp;
            p.y += cos(uv.x * 6.2831 * 3.5 + uTime * 0.8) * uAmp * 0.4;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          void main() {
            float scroll = vUv.y + uTime * 0.25;
            float band = sin(scroll * 6.2831) * 0.5 + 0.5;
            vec3 col = mix(uColorA, uColorB, band);
            float edgeFade = pow(sin(vUv.x * 3.14159), 0.5) * pow(1.0 - vUv.y, 0.5);
            gl_FragColor = vec4(col, edgeFade * 0.75);
          }
        `,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      m.scale.set(params.length * scale, 1, params.height * scale);
      m.position.z = params.altitude * scale + (params.height * scale) / 2;
      m.material.uniforms.uTime.value = t;
      m.material.uniforms.uAmp.value = params.amp;
    },
  },

  {
    id: "flag",
    name: "Flag Wave",
    loc: [120.3956, 23.1244], city: "Erliao",
    tech: "Cylinder flagpole + PlaneGeometry flag cloth + vertex shader sin displacement growing with uv.x",
    desc: "A pole plus a flag cloth that ripples in the wind. The vertex shader keeps uv.x=0 (the pole edge) still while uv.x=1 (the free edge) sways the most = a realistic waving-flag feel.",
    prompt: "Erect a <b>[400m]</b> tall flagpole at <b>[location]</b> with a <b>[300m×200m]</b> <b>[red]</b> flag cloth, the free edge swaying widely in the wind.",
    params: [
      { id: "poleHeight", label: "Pole height (m)", min: 100, max: 1500, step: 25, value: 500 },
      { id: "flagW", label: "Flag width (m)", min: 100, max: 800, step: 25, value: 350 },
      { id: "flagH", label: "Flag height (m)", min: 50, max: 500, step: 10, value: 220 },
      { id: "wind", label: "Wind", min: 0, max: 0.5, step: 0.02, value: 0.18 },
    ],
    build: (group) => {
      const poleGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true);
      poleGeo.translate(0, 0.5, 0);
      poleGeo.rotateX(Math.PI / 2);
      const pole = new THREE.Mesh(poleGeo, new THREE.MeshBasicMaterial({
        color: 0xaaaaaa, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      }));
      group.add(pole);

      const flagGeo = new THREE.PlaneGeometry(1, 1, 32, 16);
      flagGeo.rotateX(Math.PI / 2);
      const flagMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uWind: { value: 0.15 },
          uColor: { value: new THREE.Color(0xff5b6e) },
        },
        vertexShader: `
          uniform float uTime;
          uniform float uWind;
          varying vec2 vUv;
          void main() {
            vUv = uv;
            vec3 p = position;
            float wave = uv.x * uWind;
            p.y += sin(uTime * 4.0 + uv.x * 6.0) * wave;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec2 vUv;
          void main() { gl_FragColor = vec4(uColor, 0.92); }
        `,
        transparent: true, side: THREE.DoubleSide,
      });
      const flag = new THREE.Mesh(flagGeo, flagMat);
      group.add(flag);
      group.userData = { pole, flag };
    },
    update: (group, dt, t, params, scale) => {
      const ph = params.poleHeight * scale;
      const fw = params.flagW * scale;
      const fh = params.flagH * scale;
      group.userData.pole.scale.set(scale * 8, scale * 8, ph);
      group.userData.flag.position.set(fw / 2, 0, ph - fh / 2);
      group.userData.flag.scale.set(fw, 1, fh);
      group.userData.flag.material.uniforms.uTime.value = t;
      group.userData.flag.material.uniforms.uWind.value = params.wind;
    },
  },
];
