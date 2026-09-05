import * as THREE from "three";

export default [
  {
    id: "text",
    name: "3D Text Label (Canvas Texture)",
    loc: [120.9131, 23.8569], city: "Sun Moon Lake",
    tech: "Draw text on canvas -> CanvasTexture -> Plane (ground label)",
    desc: "Draw any text on a browser canvas -> use it as a texture on a plane -> it becomes a map label. Swap the text, change colors, add a background, add emoji. Simpler than TextGeometry, and any font works.",
    prompt: "Lay an <b>[800m]</b> long label at <b>[location]</b>, reading <b>[\"Sun Moon Lake\"]</b>, <b>[white text on a dark background]</b> + pink border, flat on the ground, visible from above.",
    params: [
      { id: "size", label: "Size (m)", min: 100, max: 3000, step: 50, value: 1000 },
      { id: "lift", label: "Lift (m)", min: 0, max: 800, step: 10, value: 80 },
    ],
    build: (group) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 256;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "rgba(15, 20, 28, 0.85)";
      ctx.fillRect(0, 0, 1024, 256);
      ctx.fillStyle = "#6cb8ff";
      ctx.font = "bold 130px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("✨ Sun Moon Lake ✨", 512, 128);
      ctx.strokeStyle = "#ff7eb6";
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, 1008, 240);
      const tex = new THREE.CanvasTexture(canvas);
      tex.minFilter = THREE.LinearFilter;
      const geo = new THREE.PlaneGeometry(1, 0.25);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      const sz = params.size * scale;
      m.scale.set(sz, sz, sz);
      m.position.z = params.lift * scale;
    },
  },

  {
    id: "dna",
    name: "DNA Double Helix",
    loc: [118.3171, 24.4321], city: "Kinmen",
    tech: "TubeGeometry following a CatmullRomCurve3 helix + short base-pair lines in between",
    desc: "Two symmetric helices with base pairs in between. Expresses genetics, intertwining, double-strand structure. Drop to 1 strand for a spring, change the pitch for a staircase, change the radius for a cable.",
    prompt: "Erect a <b>[1000m]</b> tall, <b>[200m]</b> radius double helix at <b>[location]</b>, <b>[5 turns]</b>, one base pair every 0.25 turn, the whole thing slowly rotating around the Z axis.",
    params: [
      { id: "height", label: "Height (m)", min: 200, max: 2500, step: 50, value: 1200 },
      { id: "radius", label: "Radius (m)", min: 50, max: 500, step: 10, value: 250 },
      { id: "turns", label: "Turns", min: 2, max: 10, step: 0.5, value: 5 },
    ],
    build: (group) => {
      const inner = new THREE.Group();
      group.add(inner);
      const rebuild = (h, r, turns) => {
        while (inner.children.length) {
          const c = inner.children[0];
          inner.remove(c);
          c.geometry?.dispose();
          c.material?.dispose();
        }
        const SEGMENTS = Math.floor(turns * 32);
        for (let strand = 0; strand < 2; strand++) {
          const phase = strand * Math.PI;
          const points = [];
          for (let i = 0; i <= SEGMENTS; i++) {
            const u = i / SEGMENTS;
            const a = u * turns * Math.PI * 2 + phase;
            points.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, u * h));
          }
          const curve = new THREE.CatmullRomCurve3(points);
          const tubeGeo = new THREE.TubeGeometry(curve, SEGMENTS, r * 0.06, 8, false);
          const tubeMat = new THREE.MeshBasicMaterial({
            color: strand === 0 ? 0x6cb8ff : 0xff7eb6,
            transparent: true, opacity: 0.92,
          });
          inner.add(new THREE.Mesh(tubeGeo, tubeMat));
        }
        const pairCount = Math.floor(turns * 4);
        for (let i = 0; i <= pairCount; i++) {
          const u = i / pairCount;
          const a = u * turns * Math.PI * 2;
          const p1 = new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, u * h);
          const p2 = new THREE.Vector3(Math.cos(a + Math.PI) * r, Math.sin(a + Math.PI) * r, u * h);
          const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
          const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
          inner.add(new THREE.Line(lineGeo, lineMat));
        }
      };
      group.userData = { inner, rebuild, lastH: -1, lastR: -1, lastT: -1 };
    },
    update: (group, dt, t, params, scale) => {
      const h = params.height * scale;
      const r = params.radius * scale;
      const turns = params.turns;
      const u = group.userData;
      if (Math.abs(h - u.lastH) > scale * 30 ||
          Math.abs(r - u.lastR) > scale * 5 ||
          Math.abs(turns - u.lastT) > 0.3) {
        u.lastH = h; u.lastR = r; u.lastT = turns;
        u.rebuild(h, r, turns);
      }
      u.inner.rotation.z = t * 0.4;
    },
  },

  {
    id: "scangrid",
    name: "Ground Scan Grid",
    loc: [120.0867, 23.1481], city: "Qigu",
    tech: "Wireframe grid via LineSegments + one animated sweep LineSegments",
    desc: "Cyberpunk-style base: a ground grid plus a beam sweeping from one side to the other. Add more sweeps with different phases. Expresses area monitoring, AI scanning, map construction, tactical overlays.",
    prompt: "Lay a <b>[2500m]</b> square grid at <b>[location]</b> (<b>[12x12 cells]</b>), a <b>[cyan]</b> beam sweeping from south to north every <b>[3 seconds]</b>.",
    params: [
      { id: "size", label: "Side length (m)", min: 500, max: 5000, step: 100, value: 2500 },
      { id: "divisions", label: "Divisions", min: 5, max: 30, step: 1, value: 12 },
      { id: "period", label: "Period (s)", min: 1, max: 8, step: 0.5, value: 3 },
    ],
    build: (group) => {
      const inner = new THREE.Group();
      group.add(inner);
      const sweepGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.5, 0, 0.001), new THREE.Vector3(0.5, 0, 0.001),
      ]);
      const sweepMat = new THREE.LineBasicMaterial({
        color: 0x6cf6ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending,
      });
      const sweep = new THREE.Line(sweepGeo, sweepMat);
      inner.add(sweep);
      group.userData = { inner, sweep, lastDiv: -1 };
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      const div = Math.round(params.divisions);
      const inner = group.userData.inner;
      const sweep = group.userData.sweep;
      if (div !== group.userData.lastDiv) {
        group.userData.lastDiv = div;
        for (let i = inner.children.length - 1; i >= 0; i--) {
          const c = inner.children[i];
          if (c === sweep) continue;
          inner.remove(c);
          c.geometry.dispose();
          c.material.dispose();
        }
        const positions = [];
        for (let i = 0; i <= div; i++) {
          const u = i / div - 0.5;
          positions.push(-0.5, u, 0); positions.push(0.5, u, 0);
          positions.push(u, -0.5, 0); positions.push(u, 0.5, 0);
        }
        const gridGeo = new THREE.BufferGeometry();
        gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        const gridMat = new THREE.LineBasicMaterial({
          color: 0x6cf6ff, transparent: true, opacity: 0.25, depthWrite: false,
        });
        const grid = new THREE.LineSegments(gridGeo, gridMat);
        inner.add(grid);
      }
      inner.scale.set(sz, sz, 1);
      const phase = (t % params.period) / params.period;
      sweep.position.y = phase - 0.5;
      sweep.material.opacity = 1 - Math.abs(phase - 0.5) * 0.6;
    },
  },

  {
    id: "shield",
    name: "Energy Shield",
    loc: [121.2300, 24.3833], city: "Snow Mountain",
    tech: "IcosahedronGeometry detail=2 + semi-transparent fill + wireframe overlay",
    desc: "A triangulated sphere = an energy shield / satellite dish / abstract geometric sculpture. Wireframe pulsing + rotation = sci-fi. Change detail for a denser mesh.",
    prompt: "Cover <b>[location]</b> with a <b>[600m]</b> radius <b>[green]</b> energy shield, triangulated wireframe + semi-transparent fill, slowly rotating around the Z axis with a pulsing wireframe.",
    params: [
      { id: "radius", label: "Radius (m)", min: 200, max: 2500, step: 50, value: 800 },
      { id: "spin", label: "Spin", min: 0, max: 2, step: 0.05, value: 0.3 },
    ],
    build: (group) => {
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4cffa6, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      const wireGeo = new THREE.WireframeGeometry(geo);
      const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({
        color: 0x4cffa6, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending,
      }));
      group.add(wire);
      group.userData = { mesh, wire };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      [group.userData.mesh, group.userData.wire].forEach((m) => {
        m.scale.set(r, r, r);
        m.position.z = r * 0.7;
        m.rotation.z = t * params.spin;
      });
      const pulse = 0.5 + 0.4 * Math.sin(t * 2);
      group.userData.wire.material.opacity = 0.35 + 0.45 * pulse;
    },
  },

  {
    id: "hexgrid",
    name: "Hex Grid Wave",
    loc: [121.1303, 22.9133], city: "Luye",
    tech: "Hexagon LineLoop x N tiling a disc + distance+time driven per-cell opacity wave",
    desc: "A hexagonal grid array tiles the ground, with opacity following sin(distance - time) outward from the center = expanding waves. Expresses area analysis, sensor networks, energy fields.",
    prompt: "Lay a <b>[2500m]</b> hex grid array over <b>[location]</b>, opacity rippling outward from the center in waves, <b>[1 wave per second]</b>.",
    params: [
      { id: "size", label: "Range (m)", min: 500, max: 5000, step: 100, value: 2800 },
      { id: "speed", label: "Wave speed", min: 0.5, max: 5, step: 0.1, value: 2.0 },
    ],
    build: (group) => {
      const SIZE = 6;
      const HEX_R = 1.0;
      const points = [];
      for (let i = 0; i <= 6; i++) {
        const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
        points.push(new THREE.Vector3(Math.cos(a) * HEX_R, Math.sin(a) * HEX_R, 0));
      }
      const cells = [];
      for (let q = -SIZE; q <= SIZE; q++) {
        for (let r = -SIZE; r <= SIZE; r++) {
          const cx = HEX_R * Math.sqrt(3) * (q + r / 2);
          const cy = HEX_R * 1.5 * r;
          const dist = Math.sqrt(cx * cx + cy * cy);
          if (dist > SIZE * HEX_R * 1.5) continue;
          const geo = new THREE.BufferGeometry().setFromPoints(points);
          const mat = new THREE.LineBasicMaterial({
            color: 0x6cf6ff, transparent: true, opacity: 0.3,
            blending: THREE.AdditiveBlending,
          });
          const line = new THREE.Line(geo, mat);
          line.position.set(cx, cy, 0.001);
          group.add(line);
          cells.push({ line, dist, baseX: cx, baseY: cy });
        }
      }
      group.userData = { cells };
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale / 9; // SIZE*HEX_R*sqrt(3) ≈ 9
      for (const c of group.userData.cells) {
        c.line.position.set(c.baseX * sz, c.baseY * sz, 0.001);
        c.line.scale.set(sz, sz, sz);
        const wave = Math.sin(c.dist * 0.7 - t * params.speed) * 0.5 + 0.5;
        c.line.material.opacity = 0.1 + wave * 0.7;
      }
    },
  },

  {
    id: "glitch",
    name: "Glitch Art",
    loc: [121.5611, 25.1872], city: "Qixing Mountain",
    tech: "Sliced BoxGeometry x N stacked + periodic random XY offset + multi-color",
    desc: "Slice a cube into 12 horizontal layers, each periodically offset at random = VHS glitch / signal interference. A must-have for cyber/synthwave/vaporwave styles.",
    prompt: "Erect a <b>[400m]</b> cube at <b>[location]</b>, sliced into <b>[12 layers]</b>, 8 random-offset bursts per second at intensity <b>[2]</b>, alternating three colors.",
    params: [
      { id: "size", label: "Side length (m)", min: 100, max: 1500, step: 25, value: 500 },
      { id: "intensity", label: "Offset", min: 0.5, max: 5, step: 0.1, value: 2.0 },
    ],
    build: (group) => {
      const SLICES = 12;
      const slices = [];
      const colors = [0xff7eb6, 0x6cb8ff, 0xffd87a];
      for (let i = 0; i < SLICES; i++) {
        const geo = new THREE.BoxGeometry(1, 1, 1 / SLICES);
        const mat = new THREE.MeshBasicMaterial({
          color: colors[i % colors.length], transparent: true, opacity: 0.8,
          side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(geo, mat);
        group.add(m);
        slices.push(m);
      }
      group.userData = { slices, SLICES };
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      const SLICES = group.userData.SLICES;
      const burst = Math.sin(t * 8) > 0.5 ? params.intensity : 0;
      for (let i = 0; i < SLICES; i++) {
        const m = group.userData.slices[i];
        m.scale.set(sz, sz, sz);
        const offsetX = (Math.random() - 0.5) * burst * sz * 0.1;
        const offsetY = (Math.random() - 0.5) * burst * sz * 0.1;
        const baseZ = (i / SLICES + 0.5 / SLICES) * sz;
        m.position.set(offsetX, offsetY, baseZ);
      }
    },
  },

  {
    id: "checker",
    name: "Floating Checker Tiles",
    loc: [120.5414, 22.8997], city: "Meinong",
    tech: "8x8 PlaneGeometry black/white tiles + Z height driven by sin(r+c+t)",
    desc: "A checkerboard ground where each tile's Z rises and falls with sin over time = a rhythmic floating array. Expresses synchronized motion, matrix data, beat visualization.",
    prompt: "Lay an <b>[8x8 checkerboard]</b> at <b>[location]</b> (total side <b>[2000m]</b>), each tile's Z floating with sin, up to <b>[300m]</b> high.",
    params: [
      { id: "size", label: "Side length (m)", min: 500, max: 4000, step: 100, value: 2000 },
      { id: "maxLift", label: "Float height (m)", min: 50, max: 800, step: 25, value: 300 },
    ],
    build: (group) => {
      const N = 8;
      const tiles = [];
      const geo = new THREE.PlaneGeometry(1, 1);
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const isBlack = (r + c) % 2 === 0;
          const mat = new THREE.MeshBasicMaterial({
            color: isBlack ? 0x222831 : 0xffffff,
            transparent: true, opacity: 0.85, side: THREE.DoubleSide,
          });
          const m = new THREE.Mesh(geo, mat);
          group.add(m);
          tiles.push({ mesh: m, r, c });
        }
      }
      group.userData = { tiles, N };
    },
    update: (group, dt, t, params, scale) => {
      const N = group.userData.N;
      const sz = params.size * scale / N;
      const maxLift = params.maxLift * scale;
      for (const item of group.userData.tiles) {
        const x = (item.c - (N - 1) / 2) * sz * 1.05;
        const y = (item.r - (N - 1) / 2) * sz * 1.05;
        const z = Math.sin(t * 1.5 + item.r * 0.5 + item.c * 0.5) * maxLift;
        item.mesh.position.set(x, y, z);
        item.mesh.scale.set(sz, sz, 1);
      }
    },
  },

  {
    id: "orbit",
    name: "Orbiting Satellites",
    loc: [121.6817, 25.2050], city: "Wanli",
    tech: "Center sphere + 5 satellites each on a tilted orbit + visible orbit rings",
    desc: "A central body with multiple satellites orbiting at different tilt angles = a planetary system, satellite cluster, or atomic model. Change the speed ratio to alter angular momentum.",
    prompt: "Place a <b>[1000m]</b> wide satellite system at <b>[location]</b>: a central <b>[300m]</b> blue body + <b>[5]</b> yellow satellites orbiting at different tilt angles.",
    params: [
      { id: "radius", label: "Range (m)", min: 300, max: 3000, step: 50, value: 1200 },
      { id: "coreSize", label: "Core (m)", min: 50, max: 600, step: 10, value: 300 },
      { id: "satSize", label: "Satellite (m)", min: 20, max: 300, step: 5, value: 100 },
    ],
    build: (group) => {
      const center = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 2),
        new THREE.MeshBasicMaterial({
          color: 0x6cb8ff, transparent: true, opacity: 0.92,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      group.add(center);
      const SATS = 5;
      const sats = [];
      for (let i = 0; i < SATS; i++) {
        const sat = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            color: 0xffd87a, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(sat);
        const ringPoints = [];
        const segs = 64;
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          ringPoints.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
        }
        const ring = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(ringPoints),
          new THREE.LineBasicMaterial({ color: 0xffd87a, transparent: true, opacity: 0.25 }),
        );
        const tiltX = (i / SATS) * Math.PI * 0.7;
        const tiltY = i * 0.7;
        ring.rotation.x = tiltX;
        ring.rotation.y = tiltY;
        group.add(ring);
        sats.push({
          sat, ring,
          orbitRadius: 0.4 + i * 0.13,
          speed: 1 + i * 0.4,
          phase: Math.random() * Math.PI * 2,
          tiltX, tiltY,
        });
      }
      group.userData = { center, sats };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const cs = params.coreSize * scale;
      const ss = params.satSize * scale * 0.5;
      group.userData.center.scale.set(cs, cs, cs);
      group.userData.center.position.z = r * 0.6;
      for (const s of group.userData.sats) {
        const orbitR = r * s.orbitRadius;
        s.ring.scale.set(orbitR, orbitR, orbitR);
        s.ring.position.z = r * 0.6;
        const a = t * s.speed + s.phase;
        let x = Math.cos(a) * orbitR, y = Math.sin(a) * orbitR, z = 0;
        // tiltX (rotate around X)
        const cy = y * Math.cos(s.tiltX) - z * Math.sin(s.tiltX);
        const cz = y * Math.sin(s.tiltX) + z * Math.cos(s.tiltX);
        y = cy; z = cz;
        // tiltY (rotate around Y)
        const dx = x * Math.cos(s.tiltY) + z * Math.sin(s.tiltY);
        const dz = -x * Math.sin(s.tiltY) + z * Math.cos(s.tiltY);
        x = dx; z = dz;
        s.sat.position.set(x, y, z + r * 0.6);
        s.sat.scale.set(ss, ss, ss);
      }
    },
  },

  // ── System Relations / Water Resources ──

  {
    id: "drought",
    name: "Drought Cracks",
    loc: [121.0044, 24.7322], city: "Baoshan Reservoir",
    tech: "Radiating crack lines via random walk from center (with branches) + pulsing center warning ring + severity-driven HSL",
    desc: "Irregular cracks (with branches) radiating from the center, with a pulsing red ring at the center. Expresses drought, cracking ground, a warning zone, or a worsening affected area.",
    prompt: "Lay a <b>[1500m]</b> drought-crack warning over <b>[location]</b> (8 main cracks radiating from the center + random branches), a pulsing red ring at the center, severity 0-1 controls the severity.",
    params: [
      { id: "size", label: "Range (m)", min: 300, max: 4000, step: 100, value: 1800 },
      { id: "severity", label: "Severity", min: 0, max: 1, step: 0.05, value: 0.7 },
    ],
    build: (group) => {
      const cracks = [];
      for (let i = 0; i < 8; i++) {
        const points = [];
        const startA = (i / 8) * Math.PI * 2;
        let x = 0, y = 0;
        points.push(new THREE.Vector3(0, 0, 0.001));
        let angle = startA;
        for (let s = 0; s < 12; s++) {
          const stepLen = 0.1;
          angle += (Math.random() - 0.5) * 0.5;
          x += Math.cos(angle) * stepLen;
          y += Math.sin(angle) * stepLen;
          points.push(new THREE.Vector3(x, y, 0.001));
          if (Math.random() < 0.3) {
            let bx = x, by = y;
            let ba = angle + (Math.random() - 0.5) * 1.5;
            const bp = [new THREE.Vector3(x, y, 0.001)];
            for (let bs = 0; bs < 4; bs++) {
              ba += (Math.random() - 0.5) * 0.5;
              bx += Math.cos(ba) * stepLen * 0.7;
              by += Math.sin(ba) * stepLen * 0.7;
              bp.push(new THREE.Vector3(bx, by, 0.001));
            }
            cracks.push(bp);
          }
        }
        cracks.push(points);
      }
      const meshes = [];
      for (const path of cracks) {
        const geo = new THREE.BufferGeometry().setFromPoints(path);
        const mat = new THREE.LineBasicMaterial({
          color: 0xffd87a, transparent: true, opacity: 0.6,
          blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(geo, mat);
        group.add(line);
        meshes.push(line);
      }
      const center = new THREE.Mesh(
        new THREE.RingGeometry(0.05, 0.06, 32),
        new THREE.MeshBasicMaterial({
          color: 0xff7e6c, transparent: true, opacity: 1,
          side: THREE.DoubleSide, depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      group.add(center);
      group.userData = { meshes, center };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.size * scale;
      for (const m of group.userData.meshes) {
        m.scale.set(r, r, 1);
      }
      const pulse = (Math.sin(t * 4) + 1) / 2;
      const cs = r * (0.5 + pulse * 1.0);
      group.userData.center.scale.set(cs, cs, 1);
      group.userData.center.material.opacity = 0.3 + 0.7 * pulse;
      const sev = params.severity;
      group.userData.center.material.color.setHSL(0.05 - sev * 0.05, 0.9, 0.55);
      for (const m of group.userData.meshes) {
        m.material.color.setHSL(0.12 - sev * 0.1, 0.85, 0.55);
      }
    },
  },
];
