import * as THREE from "three";

export default [
  {
    id: "bars",
    name: "3D Bar Chart",
    loc: [120.5421, 24.0735], city: "Changhua",
    tech: "BoxGeometry × N + dynamic scale.z + HSL color gradient",
    desc: "The most basic form of data visualization. Each bar = one value (N periods, N categories), height changes dynamically, color gradients with the value. Can be arranged in a grid to represent matrix data.",
    prompt: "Place <b>[7]</b> side-by-side bars at <b>[location]</b>, width <b>[80m]</b>, spacing <b>[120m]</b>, max height <b>[700m]</b>, color gradient from low (blue) to high (red), values fluctuate over time.",
    params: [
      { id: "count", label: "Count", min: 3, max: 20, step: 1, value: 7 },
      { id: "width", label: "Width (m)", min: 30, max: 300, step: 10, value: 100 },
      { id: "spacing", label: "Spacing ratio", min: 1.0, max: 3.0, step: 0.1, value: 1.6 },
      { id: "maxH", label: "Max height (m)", min: 100, max: 1500, step: 50, value: 800 },
    ],
    build: (group) => {
      const bars = [];
      const baseGeo = new THREE.BoxGeometry(1, 1, 1);
      baseGeo.translate(0, 0, 0.5);
      for (let i = 0; i < 20; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(baseGeo, mat);
        group.add(m);
        bars.push(m);
      }
      group.userData.bars = bars;
    },
    update: (group, dt, t, params, scale) => {
      const w = params.width * scale;
      const spacing = w * params.spacing;
      const maxH = params.maxH * scale;
      const N = Math.round(params.count);
      group.userData.bars.forEach((m, i) => {
        if (i >= N) { m.visible = false; return; }
        m.visible = true;
        const norm = (Math.sin(t * 1.2 + i * 0.5) + 1) / 2;
        const h = (0.2 + 0.8 * norm) * maxH;
        m.scale.set(w * 0.85, w * 0.85, h);
        m.position.x = (i - (N - 1) / 2) * spacing;
        m.material.color.setHSL(0.62 - norm * 0.55, 0.85, 0.55);
      });
    },
  },

  {
    id: "heatmap",
    name: "Heatmap 3D Surface",
    loc: [121.5985, 24.1908], city: "Taroko",
    tech: "High-subdivision PlaneGeometry + per-frame vertex z update + vertex color HSL",
    desc: "Subdivides a plane into a grid; each vertex's height = value, color = height gradient. Simulates heatmaps, elevation, population density, signal strength. This project's temperature wave layer follows the same pattern.",
    prompt: "Lay a <b>[2500×2500m]</b> heatmap surface at <b>[location]</b>, <b>[48×48 subdivisions]</b>, height fluctuates dynamically via noise, color gradient from low (blue) to high (red).",
    params: [
      { id: "size", label: "Extent (m)", min: 500, max: 5000, step: 100, value: 2500 },
      { id: "maxH", label: "Max height (m)", min: 50, max: 1500, step: 50, value: 600 },
      { id: "speed", label: "Wave speed", min: 0, max: 3, step: 0.1, value: 0.5 },
    ],
    build: (group) => {
      const SEG = 48;
      const geo = new THREE.PlaneGeometry(1, 1, SEG, SEG);
      const vcount = (SEG + 1) * (SEG + 1);
      const colors = new Float32Array(vcount * 3);
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.85,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData = { mesh, SEG };
    },
    update: (group, dt, t, params, scale) => {
      const { mesh, SEG } = group.userData;
      const size = params.size * scale;
      const maxH = params.maxH * scale;
      const speed = params.speed;
      mesh.scale.set(size, size, 1);
      const positions = mesh.geometry.attributes.position.array;
      const colors = mesh.geometry.attributes.color.array;
      const vcount = (SEG + 1) * (SEG + 1);
      const tmp = new THREE.Color();
      for (let i = 0; i < vcount; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const n = Math.sin(x * 8 + t * speed) * Math.cos(y * 8 + t * speed * 0.7) +
                  Math.sin(x * 14 + y * 6 - t * speed * 0.5) * 0.5;
        const norm = Math.max(0, Math.min(1, (n + 1.5) / 3));
        positions[i * 3 + 2] = norm * maxH;
        tmp.setHSL(0.62 - norm * 0.55, 0.85, 0.5);
        colors[i * 3] = tmp.r;
        colors[i * 3 + 1] = tmp.g;
        colors[i * 3 + 2] = tmp.b;
      }
      mesh.geometry.attributes.position.needsUpdate = true;
      mesh.geometry.attributes.color.needsUpdate = true;
    },
  },

  {
    id: "pie",
    name: "3D Pie Chart",
    loc: [120.9686, 23.9619], city: "Puli",
    tech: "CylinderGeometry thetaStart/thetaLength sliced into wedges + independent height per wedge",
    desc: "Uses the cylinder's theta parameters to cut wedges that form a pie. Each wedge can have a different height (dual encoding: angle = proportion / height = value).",
    prompt: "Place a <b>[600m]</b> radius pie at <b>[location]</b>, <b>[5]</b> segments (30% 22% 18% 16% 14%), each segment a different color + height extruded by value.",
    params: [
      { id: "radius", label: "Radius (m)", min: 100, max: 1500, step: 25, value: 700 },
      { id: "maxH", label: "Max height (m)", min: 50, max: 800, step: 25, value: 350 },
    ],
    build: (group) => {
      const slices = [
        { ratio: 0.30, color: 0x6cb8ff, height: 0.6 },
        { ratio: 0.22, color: 0xff7eb6, height: 0.45 },
        { ratio: 0.18, color: 0x4cffa6, height: 0.35 },
        { ratio: 0.16, color: 0xffd87a, height: 0.55 },
        { ratio: 0.14, color: 0xa080ff, height: 0.4 },
      ];
      let theta = 0;
      const meshes = [];
      for (const s of slices) {
        const arc = s.ratio * Math.PI * 2;
        const geo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, false, theta, arc);
        geo.translate(0, 0.5, 0);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color: s.color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        meshes.push({ mesh, height: s.height });
        theta += arc;
      }
      group.userData.meshes = meshes;
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const maxH = params.maxH * scale;
      const wobble = 1 + 0.04 * Math.sin(t);
      group.userData.meshes.forEach((m) => {
        m.mesh.scale.set(r * wobble, r * wobble, maxH * m.height);
      });
    },
  },

  {
    id: "polyextrude",
    name: "Block Extrude (Polygon Buildings)",
    loc: [120.6253, 24.3457], city: "Dajia",
    tech: "ExtrudeGeometry on Shape polygons -> simulates buildings/extruded zones (same idea as Mapbox fill-extrusion)",
    desc: "Extrudes 2D polygons (administrative districts, building footprints, commercial zones) into 3D. Same concept as this project's reservoir volume / station light-pillar layers. Multiple blocks combine into a city skyline.",
    prompt: "Lay <b>[6]</b> random rectangular polygons at <b>[location]</b>, each with height <b>[200-700m]</b>, HSL color gradient from low to high, simulating city blocks.",
    params: [
      { id: "count", label: "Block count", min: 2, max: 10, step: 1, value: 6 },
      { id: "size", label: "Extent (m)", min: 200, max: 2500, step: 50, value: 1500 },
      { id: "maxH", label: "Max height (m)", min: 100, max: 1500, step: 50, value: 700 },
    ],
    build: (group) => {
      let seed = 42;
      const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      const blocks = [];
      for (let i = 0; i < 10; i++) {
        const cx = (rand() - 0.5) * 0.7;
        const cy = (rand() - 0.5) * 0.7;
        const w = 0.08 + rand() * 0.12;
        const h = 0.08 + rand() * 0.12;
        const shape = new THREE.Shape();
        shape.moveTo(cx - w, cy - h);
        shape.lineTo(cx + w, cy - h);
        shape.lineTo(cx + w, cy + h);
        shape.lineTo(cx - w, cy + h);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        blocks.push({ mesh, heightFactor: 0.3 + rand() * 0.7 });
      }
      group.userData.blocks = blocks;
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      const maxH = params.maxH * scale;
      const visible = Math.round(params.count);
      group.userData.blocks.forEach((b, i) => {
        if (i >= visible) { b.mesh.visible = false; return; }
        b.mesh.visible = true;
        const wobble = 1 + 0.05 * Math.sin(t * 0.8 + i);
        b.mesh.scale.set(sz, sz, b.heightFactor * maxH * wobble);
        b.mesh.material.color.setHSL(0.55 - b.heightFactor * 0.35, 0.75, 0.55);
      });
    },
  },

  {
    id: "waveform",
    name: "Audio Waveform",
    loc: [120.3043, 23.5755], city: "Beigang",
    tech: "Side-by-side BoxGeometry bars + multi-frequency sin superposition simulating a waveform + HSL color",
    desc: "A row of bars whose height comes from superposed multi-frequency sin waves (simulating an FFT spectrum). Swap in real Web Audio analyser data and it becomes a music visualizer. Expresses sound, vibration, rhythm.",
    prompt: "Arrange <b>[48]</b> thin side-by-side bars at <b>[location]</b>, height from superposed multi-frequency sin waves simulating a waveform, max height <b>[500m]</b>, color gradient with amplitude.",
    params: [
      { id: "count", label: "Count", min: 16, max: 96, step: 4, value: 56 },
      { id: "width", label: "Width (m)", min: 10, max: 200, step: 5, value: 40 },
      { id: "maxH", label: "Max height (m)", min: 100, max: 1500, step: 50, value: 600 },
      { id: "speed", label: "Speed", min: 0.1, max: 5, step: 0.1, value: 1.5 },
    ],
    build: (group) => {
      const N = 96;
      const baseGeo = new THREE.BoxGeometry(1, 1, 1);
      baseGeo.translate(0, 0, 0.5);
      const bars = [];
      for (let i = 0; i < N; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: 0x6cb8ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(baseGeo, mat);
        group.add(m);
        bars.push(m);
      }
      group.userData = { bars, N };
    },
    update: (group, dt, t, params, scale) => {
      const visible = Math.round(params.count);
      const w = params.width * scale;
      const spacing = w * 1.4;
      const maxH = params.maxH * scale;
      const speed = params.speed;
      group.userData.bars.forEach((m, i) => {
        if (i >= visible) { m.visible = false; return; }
        m.visible = true;
        const x = (i - (visible - 1) / 2) / visible;
        const h1 = Math.sin(x * 12 + t * speed * 3) * 0.5;
        const h2 = Math.sin(x * 30 + t * speed * 5) * 0.3;
        const h3 = Math.sin(x * 5 - t * speed * 2) * 0.2;
        const norm = Math.min(1, Math.abs(h1 + h2 + h3));
        const h = (0.05 + norm * 0.95) * maxH;
        m.scale.set(w * 0.7, w * 0.7, h);
        m.position.x = (i - (visible - 1) / 2) * spacing;
        m.material.color.setHSL(0.55 + norm * 0.25, 0.85, 0.55);
      });
    },
  },

  // ── System relationships / Water resources ──

  {
    id: "tank",
    name: "Storage Tank",
    loc: [120.5181, 23.2542], city: "Zengwen Reservoir",
    tech: "Outer wireframe cylinder + inner water-level cylinder (scale.z = fillLevel) + HSL color",
    desc: "A cylindrical container + an inner water-level column + water-level color (low = red, high = green). Expresses reservoir storage volume, oil tanks, battery capacity, or storage-tank progress.",
    prompt: "Erect a <b>[400m]</b> radius, <b>[600m]</b> tall storage tank at <b>[location]</b>, water level auto-cycles from 0-100%, low = red, high = green.",
    params: [
      { id: "radius", label: "Radius (m)", min: 100, max: 1500, step: 25, value: 500 },
      { id: "height", label: "Height (m)", min: 100, max: 1500, step: 25, value: 700 },
      { id: "fillLevel", label: "Water level", min: 0, max: 1, step: 0.05, value: 0.6 },
      { id: "autoFill", label: "Auto", min: 0, max: 1, step: 1, value: 1 },
    ],
    build: (group) => {
      const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
      tankGeo.translate(0, 0.5, 0);
      tankGeo.rotateX(Math.PI / 2);
      const tank = new THREE.Mesh(tankGeo, new THREE.MeshBasicMaterial({
        color: 0x6cb8ff, transparent: true, opacity: 0.12,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      group.add(tank);
      const wire = new THREE.LineSegments(
        new THREE.WireframeGeometry(tankGeo),
        new THREE.LineBasicMaterial({ color: 0x6cb8ff, transparent: true, opacity: 0.6 }),
      );
      group.add(wire);
      const waterGeo = new THREE.CylinderGeometry(0.96, 0.96, 1, 24, 1, false);
      waterGeo.translate(0, 0.5, 0);
      waterGeo.rotateX(Math.PI / 2);
      const water = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({
        color: 0x4cffa6, transparent: true, opacity: 0.7,
        side: THREE.DoubleSide, depthWrite: false,
      }));
      group.add(water);
      group.userData = { tank, wire, water };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const h = params.height * scale;
      const fill = params.autoFill > 0.5 ? (Math.sin(t * 0.3) + 1) / 2 : params.fillLevel;
      group.userData.tank.scale.set(r, r, h);
      group.userData.wire.scale.set(r, r, h);
      group.userData.water.scale.set(r * 0.96, r * 0.96, h * fill);
      group.userData.water.material.color.setHSL(fill * 0.4, 0.85, 0.55);
    },
  },

  {
    id: "vessels",
    name: "Connected Vessels",
    loc: [121.1106, 24.9706], city: "Xinwu",
    tech: "3 side-by-side cylinder tanks + a connecting pipe at the base + water levels each driven by sin but converging toward the mean",
    desc: "Three containers connected at the base; water levels converge toward the mean but with perturbation -- the communicating-vessels principle (Darcy's law). Expresses system equilibrium, cross-region water transfer, energy redistribution.",
    prompt: "Place <b>[3]</b> side-by-side containers at <b>[location]</b>, radius <b>[300m]</b>, height <b>[500m]</b>, connected by a pipe at the base, water levels move together but with perturbation.",
    params: [
      { id: "radius", label: "Radius (m)", min: 80, max: 800, step: 10, value: 320 },
      { id: "height", label: "Height (m)", min: 100, max: 1500, step: 25, value: 600 },
    ],
    build: (group) => {
      const N = 3;
      const tanks = [];
      for (let i = 0; i < N; i++) {
        const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
        tankGeo.translate(0, 0.5, 0);
        tankGeo.rotateX(Math.PI / 2);
        const wire = new THREE.LineSegments(
          new THREE.WireframeGeometry(tankGeo),
          new THREE.LineBasicMaterial({ color: 0x6cb8ff, transparent: true, opacity: 0.5 }),
        );
        group.add(wire);
        const waterGeo = new THREE.CylinderGeometry(0.95, 0.95, 1, 24, 1, false);
        waterGeo.translate(0, 0.5, 0);
        waterGeo.rotateX(Math.PI / 2);
        const water = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({
          color: 0x4cffa6, transparent: true, opacity: 0.7,
          side: THREE.DoubleSide, depthWrite: false,
        }));
        group.add(water);
        let pipe = null;
        if (i < N - 1) {
          const pipeGeo = new THREE.CylinderGeometry(1, 1, 1, 12);
          pipeGeo.rotateZ(Math.PI / 2);
          pipe = new THREE.Mesh(pipeGeo, new THREE.MeshBasicMaterial({
            color: 0x6cb8ff, transparent: true, opacity: 0.5,
          }));
          group.add(pipe);
        }
        tanks.push({ wire, water, pipe });
      }
      group.userData = { tanks, N };
    },
    update: (group, dt, t, params, scale) => {
      const N = group.userData.N;
      const r = params.radius * scale;
      const h = params.height * scale;
      const spacing = r * 3;
      const mean = 0.5 + 0.3 * Math.sin(t * 0.4);
      const levels = [];
      for (let i = 0; i < N; i++) {
        const perturbation = Math.sin(t * 0.8 + i * 1.2) * 0.15;
        levels.push(Math.max(0.05, Math.min(1, mean + perturbation)));
      }
      for (let i = 0; i < N; i++) {
        const tank = group.userData.tanks[i];
        const x = (i - (N - 1) / 2) * spacing;
        tank.wire.position.set(x, 0, 0);
        tank.wire.scale.set(r, r, h);
        tank.water.position.set(x, 0, 0);
        tank.water.scale.set(r * 0.95, r * 0.95, h * levels[i]);
        if (tank.pipe) {
          const xNext = ((i + 1) - (N - 1) / 2) * spacing;
          const pipeMid = (x + xNext) / 2;
          tank.pipe.position.set(pipeMid, 0, h * 0.05);
          tank.pipe.scale.set(spacing - r * 2, r * 0.25, r * 0.25);
        }
      }
    },
  },

  {
    id: "capacityarray",
    name: "Capacity Array",
    loc: [120.8567, 23.8094], city: "Shuili",
    tech: "N side-by-side cylinders + independent sin-driven water level per tank + HSL color (low = red, high = green)",
    desc: "N containers side by side, each showing an independent water level + color-coded alert. Expresses multi-station status (reservoir clusters, tank farms, battery packs, per-branch KPIs).",
    prompt: "Place <b>[8]</b> side-by-side containers at <b>[location]</b>, radius <b>[150m]</b>, height <b>[500m]</b>, each water level fluctuates independently, low = red, high = green.",
    params: [
      { id: "count", label: "Count", min: 3, max: 16, step: 1, value: 8 },
      { id: "radius", label: "Radius (m)", min: 50, max: 400, step: 10, value: 180 },
      { id: "height", label: "Height (m)", min: 100, max: 1200, step: 25, value: 550 },
    ],
    build: (group) => {
      const N = 16;
      const tanks = [];
      for (let i = 0; i < N; i++) {
        const wireGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true);
        wireGeo.translate(0, 0.5, 0);
        wireGeo.rotateX(Math.PI / 2);
        const wire = new THREE.LineSegments(
          new THREE.WireframeGeometry(wireGeo),
          new THREE.LineBasicMaterial({ color: 0x6cb8ff, transparent: true, opacity: 0.5 }),
        );
        group.add(wire);
        const waterGeo = new THREE.CylinderGeometry(0.92, 0.92, 1, 16, 1, false);
        waterGeo.translate(0, 0.5, 0);
        waterGeo.rotateX(Math.PI / 2);
        const water = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.85,
          side: THREE.DoubleSide, depthWrite: false,
        }));
        group.add(water);
        tanks.push({ wire, water });
      }
      group.userData = { tanks, N };
    },
    update: (group, dt, t, params, scale) => {
      const visible = Math.round(params.count);
      const N = group.userData.N;
      const r = params.radius * scale;
      const h = params.height * scale;
      const spacing = r * 2.5;
      for (let i = 0; i < N; i++) {
        const tank = group.userData.tanks[i];
        if (i >= visible) { tank.wire.visible = false; tank.water.visible = false; continue; }
        tank.wire.visible = true;
        tank.water.visible = true;
        const x = (i - (visible - 1) / 2) * spacing;
        const fill = (Math.sin(t * 0.5 + i * 0.7) + 1) / 2;
        tank.wire.position.set(x, 0, 0);
        tank.wire.scale.set(r, r, h);
        tank.water.position.set(x, 0, 0);
        tank.water.scale.set(r * 0.92, r * 0.92, h * fill);
        tank.water.material.color.setHSL(fill * 0.4, 0.85, 0.55);
      }
    },
  },
];
