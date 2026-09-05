import * as THREE from "three";

export default [
  {
    id: "smoke",
    name: "Volumetric Smoke",
    loc: [120.2535, 23.7531], city: "Mailiao",
    tech: "Multiple soft-edged sphere cluster + random jitter + slow upward drift + grows larger and fades with altitude",
    desc: "10-15 semi-transparent spheres stacked together and drifting -> simulates smoke / cloud / pollution spread. Much cheaper than true volumetric rendering, but visually good enough. Change the color to turn it into cloud, fire, or haze.",
    prompt: "Emit <b>[12]</b> soft spheres of radius <b>[350m]</b> in <b>[grayish-white]</b> at <b>[location]</b>, slowly drifting upward + slight jitter + fading with altitude, normal blend opacity 0.18.",
    params: [
      { id: "count", label: "Count", min: 3, max: 25, step: 1, value: 12 },
      { id: "size", label: "Diameter (m)", min: 100, max: 1000, step: 25, value: 400 },
      { id: "rise", label: "Rise", min: 0, max: 1.0, step: 0.05, value: 0.3 },
      { id: "spread", label: "Spread", min: 0.5, max: 5.0, step: 0.1, value: 2.0 },
    ],
    build: (group) => {
      const puffs = [];
      for (let i = 0; i < 25; i++) {
        const geo = new THREE.IcosahedronGeometry(1, 2);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0.85, 0.85, 0.9),
          transparent: true, opacity: 0.18,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(geo, mat);
        group.add(m);
        puffs.push({
          mesh: m, seed: Math.random() * 100, phaseOffset: Math.random(),
          baseX: (Math.random() - 0.5), baseY: (Math.random() - 0.5),
        });
      }
      group.userData.puffs = puffs;
    },
    update: (group, dt, t, params, scale) => {
      const visible = Math.round(params.count);
      const sz = params.size * scale;
      const spread = params.spread;
      const rise = params.rise;
      group.userData.puffs.forEach((p, i) => {
        if (i >= visible) { p.mesh.visible = false; return; }
        p.mesh.visible = true;
        const life = ((t * rise * 0.3) + p.phaseOffset) % 1;
        const x = p.baseX * sz * spread + Math.sin(t * 0.5 + p.seed) * sz * 0.2;
        const y = p.baseY * sz * spread + Math.cos(t * 0.6 + p.seed) * sz * 0.2;
        const z = life * sz * 5;
        p.mesh.position.set(x, y, z);
        const grow = 1 + life * 1.5;
        const s = sz * grow;
        p.mesh.scale.set(s, s, s);
        p.mesh.material.opacity = 0.28 * (1 - life);
      });
    },
  },

  {
    id: "noisecloud",
    name: "Noise Cluster",
    loc: [121.4985, 22.6667], city: "Green Island",
    tech: "InstancedMesh spheres + positions driven by sin/cos noise function + slow drift",
    desc: "Noise functions determine each sphere's position -> an irregular cloud mass. Change the seed for different shapes. The same technique works for nebulae, flame peripheries, or fog fields.",
    prompt: "Scatter <b>[250]</b> small spheres of diameter <b>[80m]</b> at <b>[600m]</b> altitude above <b>[location]</b>, positions driven by noise, the whole cluster drifting slowly.",
    params: [
      { id: "count", label: "Count", min: 50, max: 500, step: 10, value: 250 },
      { id: "spread", label: "Range (m)", min: 200, max: 2500, step: 50, value: 1000 },
      { id: "altitude", label: "Altitude (m)", min: 0, max: 2000, step: 50, value: 600 },
      { id: "drift", label: "Drift speed", min: 0, max: 2, step: 0.05, value: 0.3 },
    ],
    build: (group) => {
      const N = 500;
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.7, 0.85, 1.0),
        transparent: true, opacity: 0.45,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const seeds = [];
      for (let i = 0; i < N; i++) {
        seeds.push({
          a: Math.random() * 100, b: Math.random() * 100, c: Math.random() * 100,
          size: 0.5 + Math.random() * 1.0,
        });
      }
      group.add(inst);
      group.userData = { inst, seeds, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, seeds, N } = group.userData;
      const visible = Math.round(params.count);
      const spread = params.spread * scale;
      const alt = params.altitude * scale;
      const tt = t * params.drift;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        const s = seeds[i];
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const x = Math.sin(s.a + tt) * Math.cos(s.b + tt * 0.7) * spread;
        const y = Math.sin(s.b + tt * 1.1) * Math.cos(s.c + tt * 0.9) * spread;
        const z = alt + Math.sin(s.c + tt * 0.5) * spread * 0.4;
        dummy.position.set(x, y, z);
        const sz = scale * 80 * s.size;
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "fog",
    name: "Low Fog Layer",
    loc: [121.7388, 25.0260], city: "Pingxi",
    tech: "Flattened soft-edged sphere cluster + slow low-altitude drift (thinner and closer to the ground than smoke)",
    desc: "Thin fog hugging the ground, flattened spheres scattered over a large area. Weaker than smoke, lower than cloud. Conveys morning mist, low-level haze, or a mysterious atmosphere.",
    prompt: "Lay a thin fog layer over a <b>[3000m]</b> range at <b>[200m]</b> altitude above <b>[location]</b>, <b>[20]</b> flattened soft spheres scattered, drifting slowly.",
    params: [
      { id: "count", label: "Count", min: 5, max: 30, step: 1, value: 18 },
      { id: "spread", label: "Range (m)", min: 500, max: 5000, step: 100, value: 2800 },
      { id: "altitude", label: "Altitude (m)", min: 50, max: 800, step: 25, value: 250 },
      { id: "size", label: "Diameter (m)", min: 200, max: 1500, step: 50, value: 800 },
    ],
    build: (group) => {
      const N = 30;
      const puffs = [];
      for (let i = 0; i < N; i++) {
        const geo = new THREE.IcosahedronGeometry(1, 2);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(0.85, 0.88, 0.92),
          transparent: true, opacity: 0.13,
          depthWrite: false, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(geo, mat);
        group.add(m);
        puffs.push({
          mesh: m,
          baseX: (Math.random() - 0.5),
          baseY: (Math.random() - 0.5),
          baseZ: 0.2 + Math.random() * 0.5,
          seed: Math.random() * 100,
          size: 0.7 + Math.random() * 0.8,
        });
      }
      group.userData = { puffs };
    },
    update: (group, dt, t, params, scale) => {
      const spread = params.spread * scale;
      const altitude = params.altitude * scale;
      const visible = Math.round(params.count);
      group.userData.puffs.forEach((p, i) => {
        if (i >= visible) { p.mesh.visible = false; return; }
        p.mesh.visible = true;
        const drift = t * 0.08;
        const x = p.baseX * spread + Math.sin(drift + p.seed) * spread * 0.08;
        const y = p.baseY * spread + Math.cos(drift + p.seed * 1.3) * spread * 0.08;
        const z = altitude * (0.4 + p.baseZ * 0.6);
        p.mesh.position.set(x, y, z);
        const sz = params.size * scale * p.size;
        p.mesh.scale.set(sz, sz, sz * 0.35); // flattened
      });
    },
  },
];
