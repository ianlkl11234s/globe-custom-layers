import * as THREE from "three";

export default [
  {
    id: "ripple",
    name: "Ripple",
    loc: [121.6044, 23.9871], city: "Hualien",
    tech: "Layered RingGeometry, radius grows over time while opacity fades",
    desc: "Four rings expand with staggered timing, each growing from small to large and fading from bright to transparent, simulating a water ripple or radar pulse. Great for expressing \"an event just happened.\"",
    prompt: "At <b>[location]</b>, emit a <b>[yellow]</b> ripple every <b>[1.5s]</b>, expanding to a max radius of <b>[800m]</b> while fading out.",
    params: [
      { id: "maxR", label: "Max (m)", min: 200, max: 3000, step: 50, value: 1000 },
      { id: "period", label: "Period (s)", min: 0.5, max: 5, step: 0.1, value: 1.8 },
      { id: "rings", label: "Rings", min: 1, max: 8, step: 1, value: 4 },
    ],
    build: (group) => {
      // Pre-build 8 rings; show the first N based on params
      const rings = [];
      for (let i = 0; i < 8; i++) {
        const geo = new THREE.RingGeometry(0.99, 1.0, 64);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xffd56c, transparent: true, opacity: 0.8,
          side: THREE.DoubleSide, depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        rings.push(mesh);
      }
      group.userData.rings = rings;
    },
    update: (group, dt, t, params, scale) => {
      const max = params.maxR * scale;
      const N = Math.round(params.rings);
      const period = params.period;
      group.userData.rings.forEach((m, i) => {
        if (i >= N) { m.visible = false; return; }
        m.visible = true;
        const phase = ((t / period) + i / N) % 1;
        const r = max * phase;
        const w = max * 0.04 * (1 + phase * 4); // larger rings get thicker
        m.scale.set(r, r, 1);
        // line width simulated via scale: ring outer 1, inner 0.99 -> width = 0.01 * scale
        m.material.opacity = 1.0 - phase;
      });
    },
  },

  {
    id: "radar",
    name: "Radar Sweep",
    loc: [121.7572, 24.7042], city: "Yilan",
    tech: "Fan-shaped ShapeGeometry + rotation + gradient alpha",
    desc: "Uses the Shape API to draw a fan/wedge shape, rotating it to simulate a radar sweep arm. Add ring gradations for a complete radar UI. Expresses \"under surveillance\" or \"scanning.\"",
    prompt: "Place a <b>[600m]</b> radius <b>[green]</b> radar at <b>[location]</b>, sweep arm width <b>[30°]</b>, one full sweep every <b>[3s]</b>, with three graduation rings.",
    params: [
      { id: "radius", label: "Radius (m)", min: 200, max: 2000, step: 50, value: 800 },
      { id: "speed", label: "Speed", min: 0.1, max: 3, step: 0.1, value: 1.0 },
      { id: "angle", label: "Arc angle (°)", min: 10, max: 90, step: 5, value: 30 },
    ],
    build: (group) => {
      // three graduation rings
      const ringMat = new THREE.LineBasicMaterial({ color: 0x4cffa6, transparent: true, opacity: 0.4 });
      const rings = [];
      for (let i = 1; i <= 3; i++) {
        const pts = [];
        const segments = 64;
        for (let s = 0; s <= segments; s++) {
          const a = (s / segments) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * (i / 3), Math.sin(a) * (i / 3), 0));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const line = new THREE.Line(geo, ringMat);
        group.add(line);
        rings.push(line);
      }
      // crosshair
      const crossMat = new THREE.LineBasicMaterial({ color: 0x4cffa6, transparent: true, opacity: 0.4 });
      const crossGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1, 0, 0), new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0),
      ]);
      const cross = new THREE.LineSegments(crossGeo, crossMat);
      group.add(cross);

      // sweep arm (Shape with linear gradient via vertex colors)
      const sweepMat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 1.0,
        side: THREE.DoubleSide, depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sweepMesh = new THREE.Mesh(new THREE.BufferGeometry(), sweepMat);
      group.add(sweepMesh);

      group.userData = { rings, cross, sweepMesh };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      for (const ring of group.userData.rings) ring.scale.set(r, r, r);
      group.userData.cross.scale.set(r, r, r);

      // rebuild sweep geometry (simple approach: rebuild the small triangle fan every frame)
      const angleDeg = params.angle;
      const angleRad = (angleDeg * Math.PI) / 180;
      const baseAngle = (t * params.speed) % (Math.PI * 2);
      const segments = 16;

      const positions = [];
      const colors = [];
      // center point
      positions.push(0, 0, 0); colors.push(0.3, 1.0, 0.65, 0.8);
      // points along the arc (from baseAngle to baseAngle + angleRad)
      for (let i = 0; i <= segments; i++) {
        const a = baseAngle + (i / segments) * angleRad;
        positions.push(Math.cos(a), Math.sin(a), 0);
        const fade = 1 - (i / segments);
        colors.push(0.3, 1.0, 0.65, fade * 0.8);
      }
      const indices = [];
      for (let i = 1; i <= segments; i++) indices.push(0, i, i + 1);

      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
      geo.setIndex(indices);
      group.userData.sweepMesh.geometry.dispose();
      group.userData.sweepMesh.geometry = geo;
      group.userData.sweepMesh.scale.set(r, r, r);
    },
  },

  {
    id: "ring",
    name: "Rotating Ring",
    loc: [120.2127, 23.0011], city: "Tainan",
    tech: "TorusGeometry + continuous rotation + layered stacking",
    desc: "Torus is donut-shaped geometry. Tilt + rotation = planetary rings, energy fields, Saturn's rings. Stacking three rings rotating on different axes gives a strong sci-fi feel.",
    prompt: "Place three <b>[400m]</b> radius <b>[gold]</b> rings at <b>[location]</b>, each rotating on a different axis simultaneously, with additive blending.",
    params: [
      { id: "radius", label: "Radius (m)", min: 100, max: 1500, step: 25, value: 500 },
      { id: "thickness", label: "Thickness", min: 0.005, max: 0.1, step: 0.005, value: 0.025 },
      { id: "speed", label: "Rotation speed", min: 0, max: 5, step: 0.1, value: 1.5 },
    ],
    build: (group) => {
      const colors = [0xffd87a, 0xff9966, 0xa8e0ff];
      const rings = [];
      for (let i = 0; i < 3; i++) {
        const geo = new THREE.TorusGeometry(1, 0.025, 12, 64);
        const mat = new THREE.MeshBasicMaterial({
          color: colors[i], transparent: true, opacity: 0.7,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        rings.push(mesh);
      }
      group.userData.rings = rings;
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      group.userData.rings.forEach((m, i) => {
        m.scale.set(r, r, r);
        m.geometry.dispose();
        m.geometry = new THREE.TorusGeometry(1, params.thickness, 12, 64);
        // rotate on three different axes
        if (i === 0) { m.rotation.x = t * params.speed; m.rotation.y = 0.3; }
        if (i === 1) { m.rotation.y = t * params.speed * 0.7; m.rotation.x = 0.6; }
        if (i === 2) { m.rotation.z = t * params.speed * 0.5; m.rotation.x = 1.2; }
        // lift slightly off the ground
        m.position.z = r * 0.5;
      });
    },
  },

  {
    id: "lightning",
    name: "Lightning Strike",
    loc: [120.8005, 23.5083], city: "Alishan",
    tech: "Dynamic zigzag Line + random regeneration + brief alpha decay",
    desc: "A zigzag line from sky to ground, each segment randomly offset; brightness flashes on suddenly then fades quickly, striking again at random intervals. Expresses a lightning strike, sudden event, warning, or attack.",
    prompt: "Strike <b>[white]</b> lightning at <b>[location]</b> from <b>[1500m]</b> altitude down to the ground, averaging once every <b>[1.5s]</b> (randomly jittered), with a zigzag amplitude of <b>[120m]</b>.",
    params: [
      { id: "altitude", label: "Start height (m)", min: 500, max: 3000, step: 100, value: 1500 },
      { id: "interval", label: "Interval (s)", min: 0.3, max: 5, step: 0.1, value: 1.5 },
      { id: "jitter", label: "Zigzag (m)", min: 20, max: 500, step: 10, value: 150 },
    ],
    build: (group) => {
      const N = 5;
      const bolts = [];
      for (let i = 0; i < N; i++) {
        const positions = new Float32Array(40 * 3);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const line = new THREE.Line(geo, mat);
        group.add(line);
        bolts.push({ line, nextStrike: 0, endTime: 0, active: false });
      }
      group.userData.bolts = bolts;
    },
    update: (group, dt, t, params, scale) => {
      const altMC = params.altitude * scale;
      const jitterMC = params.jitter * scale;
      const interval = params.interval;
      const FLASH_DUR = 0.18;
      group.userData.bolts.forEach((b, i) => {
        if (b.nextStrike === 0) b.nextStrike = t + Math.random() * interval + i * 0.13;
        if (t >= b.nextStrike && !b.active) {
          b.active = true;
          b.endTime = t + FLASH_DUR;
          b.nextStrike = t + interval * (0.5 + Math.random());
          const segments = 10 + Math.floor(Math.random() * 6);
          const positions = b.line.geometry.attributes.position.array;
          let idx = 0;
          for (let s = 0; s <= segments; s++) {
            const ratio = s / segments;
            const z = altMC * (1 - ratio);
            const x = (ratio < 1 && ratio > 0 ? (Math.random() - 0.5) * jitterMC : 0);
            const y = (ratio < 1 && ratio > 0 ? (Math.random() - 0.5) * jitterMC : 0);
            positions[idx++] = x;
            positions[idx++] = y;
            positions[idx++] = z;
          }
          b.line.geometry.setDrawRange(0, segments + 1);
          b.line.geometry.attributes.position.needsUpdate = true;
          b.line.material.opacity = 1;
        }
        if (b.active) {
          const remain = (b.endTime - t) / FLASH_DUR;
          b.line.material.opacity = Math.max(0, remain);
          if (t > b.endTime) { b.active = false; b.line.material.opacity = 0; }
        }
      });
    },
  },

  {
    id: "countdown",
    name: "Countdown Ring",
    loc: [121.1444, 22.7583], city: "Taitung",
    tech: "TorusGeometry + dynamic thetaLength clipping + HSL color shifting from green to red",
    desc: "The torus continuously shrinks from 360° to 0°, looking like a progress ring running in reverse. Expresses a countdown, remaining capacity, cooldown, or progress. The color gradient makes it more intuitive.",
    prompt: "Place a <b>[500m]</b> radius, <b>[60m]</b> thick countdown ring at <b>[location]</b>, cycling from full to empty every <b>[10s]</b>, color shifting from green through yellow to red.",
    params: [
      { id: "radius", label: "Radius (m)", min: 100, max: 1500, step: 25, value: 600 },
      { id: "thickness", label: "Thickness (m)", min: 10, max: 300, step: 5, value: 80 },
      { id: "period", label: "Period (s)", min: 2, max: 30, step: 1, value: 10 },
    ],
    build: (group) => {
      const geo = new THREE.TorusGeometry(1, 0.05, 16, 96);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x4cffa6, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData = { mesh, lastTheta: -1, lastT: -1 };
    },
    update: (group, dt, t, params, scale) => {
      const period = params.period;
      const phase = (t % period) / period;
      const remaining = 1 - phase;
      const thetaLen = Math.max(0.001, remaining * Math.PI * 2);
      const thicknessRatio = params.thickness / params.radius;

      // rebuild geometry: thetaLength changed by more than 0.03 rad, or thickness changed
      if (Math.abs(thetaLen - group.userData.lastTheta) > 0.03 ||
          Math.abs(thicknessRatio - group.userData.lastT) > 1e-4) {
        group.userData.lastTheta = thetaLen;
        group.userData.lastT = thicknessRatio;
        group.userData.mesh.geometry.dispose();
        group.userData.mesh.geometry = new THREE.TorusGeometry(1, thicknessRatio, 16, 96, thetaLen);
      }
      const r = params.radius * scale;
      group.userData.mesh.scale.set(r, r, r);
      // lift slightly off the ground
      group.userData.mesh.position.z = params.thickness * scale;
      const hue = remaining * 0.35; // 0 = red -> 0.35 = green
      group.userData.mesh.material.color.setHSL(hue, 0.85, 0.55);
    },
  },

  {
    id: "shockwave",
    name: "Shockwave",
    loc: [121.3700, 24.9300], city: "Sanxia",
    tech: "Central vertical burst pillar + ground-spreading ring, regenerating in sync on a fixed period",
    desc: "More dramatic than a ripple: a pillar shoots up instantly, then a ring bursts outward from its base. Expresses an explosion, warning, energy release, or epicenter.",
    prompt: "At <b>[location]</b>, burst once every <b>[3s]</b>: a <b>[500m]</b> tall pink pillar shoots up from the center, with a ring simultaneously expanding to a <b>[1500m]</b> radius.",
    params: [
      { id: "period", label: "Period (s)", min: 1, max: 8, step: 0.5, value: 3 },
      { id: "radius", label: "Ring radius (m)", min: 300, max: 4000, step: 100, value: 1800 },
      { id: "height", label: "Pillar height (m)", min: 100, max: 2000, step: 50, value: 700 },
    ],
    build: (group) => {
      const pillarGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true);
      pillarGeo.translate(0, 0.5, 0);
      pillarGeo.rotateX(Math.PI / 2);
      const pillar = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({
        color: 0xff7eb6, transparent: true, opacity: 1, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      group.add(pillar);
      const ringGeo = new THREE.RingGeometry(0.97, 1.0, 64);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
        color: 0xff7eb6, transparent: true, opacity: 1, side: THREE.DoubleSide,
        depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      group.add(ring);
      group.userData = { pillar, ring, lastBurst: -10 };
    },
    update: (group, dt, t, params, scale) => {
      if (t - group.userData.lastBurst >= params.period) {
        group.userData.lastBurst = t;
      }
      const phase = (t - group.userData.lastBurst) / params.period;
      const maxR = params.radius * scale;
      const maxH = params.height * scale;
      const pillarP = Math.min(1, phase / 0.25);
      const pw = maxR * 0.18 * (1 - pillarP * 0.4);
      group.userData.pillar.scale.set(pw, pw, maxH * pillarP);
      group.userData.pillar.material.opacity = (1 - pillarP) * 0.95;
      const r = maxR * phase;
      group.userData.ring.scale.set(r, r, 1);
      group.userData.ring.material.opacity = (1 - phase) * 0.95;
    },
  },

  {
    id: "contour",
    name: "Contour Lines",
    loc: [121.0734, 25.0367], city: "Guanyin",
    tech: "Layered concentric Lines + radius expanding over time + Z-axis lift + HSL color gradient tied to height",
    desc: "8 circles expand with staggered timing, each rising as it expands, with color shifting from yellow to green. Visualizes contour maps, sound wave propagation, or radio coverage.",
    prompt: "At <b>[location]</b>, continuously emit <b>[8]</b> contour rings, expanding to a max radius of <b>[1500m]</b> while rising to <b>[300m]</b>, color fading from yellow to green.",
    params: [
      { id: "maxR", label: "Max (m)", min: 200, max: 4000, step: 100, value: 1800 },
      { id: "maxH", label: "Lift (m)", min: 0, max: 1000, step: 25, value: 350 },
      { id: "period", label: "Period (s)", min: 1, max: 8, step: 0.2, value: 3.0 },
    ],
    build: (group) => {
      const N = 8;
      const rings = [];
      for (let i = 0; i < N; i++) {
        const points = [];
        const segs = 64;
        for (let s = 0; s <= segs; s++) {
          const a = (s / segs) * Math.PI * 2;
          points.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(points);
        const mat = new THREE.LineBasicMaterial({
          color: 0xffd87a, transparent: true, opacity: 0.7,
          blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(geo, mat);
        group.add(line);
        rings.push(line);
      }
      group.userData = { rings, N };
    },
    update: (group, dt, t, params, scale) => {
      const max = params.maxR * scale;
      const maxH = params.maxH * scale;
      const period = params.period;
      const N = group.userData.N;
      group.userData.rings.forEach((line, i) => {
        const phase = ((t / period) + i / N) % 1;
        const r = max * phase;
        line.scale.set(r, r, 1);
        line.position.z = phase * maxH;
        line.material.color.setHSL(0.15 + phase * 0.25, 0.85, 0.55);
        line.material.opacity = 0.85 * (1 - phase * 0.5);
      });
    },
  },

  {
    id: "highlight",
    name: "Selection Ring",
    loc: [120.7858, 23.8294], city: "Jiji",
    tech: "Central pulsing target sphere + 3 asymmetric RingGeometry rings rotating in opposite directions",
    desc: "A breathing glow sphere at the center plus three gapped rings rotating in opposite directions = an \"I'm here!\" marker. Expresses target selection, a warning, tracking lock, or a highlighted point of interest.",
    prompt: "Place a <b>[300m]</b> radius selection marker at <b>[location]</b>: a <b>[white]</b> pulsing sphere at the center plus three <b>[pink]</b> gapped rings rotating in opposite directions.",
    params: [
      { id: "radius", label: "Radius (m)", min: 100, max: 2000, step: 25, value: 400 },
      { id: "targetSize", label: "Target size", min: 50, max: 500, step: 10, value: 150 },
    ],
    build: (group) => {
      const target = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      group.add(target);
      const rings = [];
      for (let i = 0; i < 3; i++) {
        const geo = new THREE.RingGeometry(0.99 - i * 0.005, 1.0 + i * 0.01, 32, 1, 0, Math.PI * 1.5);
        const mat = new THREE.MeshBasicMaterial({
          color: 0xff7eb6, transparent: true, opacity: 0.75,
          side: THREE.DoubleSide, depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        rings.push(mesh);
      }
      group.userData = { target, rings };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const ts = params.targetSize * scale * 0.5;
      const pulse = 1 + 0.25 * Math.sin(t * 4);
      const tsP = ts * pulse;
      group.userData.target.scale.set(tsP, tsP, tsP);
      group.userData.target.position.z = ts;
      group.userData.rings.forEach((m, i) => {
        const ringR = r * (1 + i * 0.12);
        m.scale.set(ringR, ringR, ringR);
        m.position.z = ts * 0.1;
        m.rotation.z = t * (i % 2 === 0 ? 1.5 : -1.0) * (1 + i * 0.3);
      });
    },
  },

  {
    id: "rainbow",
    name: "Rainbow Arch",
    loc: [120.3712, 22.3402], city: "Xiaoliuqiu",
    tech: "TorusGeometry with thetaLength=π (half circle) + multiple layers of different colors and radii stacked together",
    desc: "A half-circle ring forms an arch. 6 layers of different colors and radii = a rainbow arch. Can be changed to a single color, thickened, or animated flying past to become a takeoff trajectory, a magpie bridge, or a ribbon streamer.",
    prompt: "Erect a <b>[1500m]</b> radius rainbow arch at <b>[location]</b> (six layers: red, orange, yellow, green, blue, purple), the half-circle arcing upward over the ground.",
    params: [
      { id: "radius", label: "Radius (m)", min: 300, max: 4000, step: 100, value: 1800 },
      { id: "thickness", label: "Thickness", min: 0.005, max: 0.06, step: 0.005, value: 0.02 },
    ],
    build: (group) => {
      const colors = [0xff5b6e, 0xffa86c, 0xffd54f, 0x4cffa6, 0x6cb8ff, 0xa080ff];
      const tori = [];
      for (let i = 0; i < colors.length; i++) {
        const ratio = 1 - (i / colors.length) * 0.06;
        const geo = new THREE.TorusGeometry(ratio, 0.02, 8, 64, Math.PI);
        geo.rotateX(Math.PI / 2);
        const mat = new THREE.MeshBasicMaterial({
          color: colors[i], transparent: true, opacity: 0.92,
        });
        const mesh = new THREE.Mesh(geo, mat);
        group.add(mesh);
        tori.push({ mesh, ratio });
      }
      group.userData = { tori, lastT: -1 };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const thick = params.thickness;
      if (Math.abs(thick - group.userData.lastT) > 1e-4) {
        group.userData.lastT = thick;
        for (const item of group.userData.tori) {
          item.mesh.geometry.dispose();
          const newGeo = new THREE.TorusGeometry(item.ratio, thick, 8, 64, Math.PI);
          newGeo.rotateX(Math.PI / 2);
          item.mesh.geometry = newGeo;
        }
      }
      for (const item of group.userData.tori) {
        item.mesh.scale.set(r, r, r);
      }
    },
  },

  // ── System relations / water resources ──

  {
    id: "hydrocycle",
    name: "Hydro Cycle",
    loc: [120.4072, 23.2186], city: "Wushantou Reservoir",
    tech: "4 nodes (cloud/rain/lake/evaporation) + connecting lines + a light particle looping along the path",
    desc: "Cloud -> rain -> lake -> evaporation -> cloud, a light particle loops through the 4-stage cycle. Expresses a natural cycle, life cycle, closed-loop process, or subscription renewal.",
    prompt: "Lay out a <b>[1500m]</b> wide water cycle at <b>[location]</b>: cloud (top) -> rain (right) -> lake (bottom) -> evaporation (left), with <b>[8]</b> light particles looping around.",
    params: [
      { id: "size", label: "Extent (m)", min: 300, max: 4000, step: 100, value: 1800 },
      { id: "nodeSize", label: "Node size (m)", min: 50, max: 500, step: 25, value: 250 },
      { id: "speed", label: "Flow speed", min: 0.05, max: 2, step: 0.05, value: 0.5 },
    ],
    build: (group) => {
      const nodes = [
        { pos: new THREE.Vector3(0, 0, 1), color: 0xffffff },        // cloud (top)
        { pos: new THREE.Vector3(0.7, 0, 0.05), color: 0x6cb8ff },   // rain (bottom-right)
        { pos: new THREE.Vector3(0, 0, 0.05), color: 0x4cffa6 },     // lake (bottom-center)
        { pos: new THREE.Vector3(-0.7, 0, 0.5), color: 0xa080ff },   // evaporation (left)
      ];
      const nodeMeshes = [];
      for (const n of nodes) {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            color: n.color, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(m);
        nodeMeshes.push(m);
      }
      const conns = [];
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i].pos;
        const b = nodes[(i + 1) % nodes.length].pos;
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
          color: 0x6cf6ff, transparent: true, opacity: 0.4,
        }));
        group.add(line);
        conns.push({ line, a, b });
      }
      const PARTICLES = 8;
      const flows = [];
      for (let i = 0; i < PARTICLES; i++) {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 0),
          new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(m);
        flows.push({ mesh: m, offset: i / PARTICLES });
      }
      group.userData = { nodes, nodeMeshes, conns, flows };
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      const ns = params.nodeSize * scale * 0.5;
      const ds = params.nodeSize * scale * 0.25;
      group.userData.nodeMeshes.forEach((m, i) => {
        const n = group.userData.nodes[i];
        m.position.set(n.pos.x * sz, n.pos.y * sz, n.pos.z * sz);
        m.scale.set(ns, ns, ns);
      });
      for (const c of group.userData.conns) {
        const arr = c.line.geometry.attributes.position.array;
        arr[0] = c.a.x * sz; arr[1] = c.a.y * sz; arr[2] = c.a.z * sz;
        arr[3] = c.b.x * sz; arr[4] = c.b.y * sz; arr[5] = c.b.z * sz;
        c.line.geometry.attributes.position.needsUpdate = true;
      }
      const N = group.userData.nodes.length;
      for (const f of group.userData.flows) {
        const phase = ((t * params.speed * 0.2) + f.offset) % 1;
        const segIdx = Math.floor(phase * N);
        const segPhase = (phase * N) % 1;
        const a = group.userData.nodes[segIdx].pos;
        const b = group.userData.nodes[(segIdx + 1) % N].pos;
        f.mesh.position.set(
          (a.x + (b.x - a.x) * segPhase) * sz,
          (a.y + (b.y - a.y) * segPhase) * sz,
          (a.z + (b.z - a.z) * segPhase) * sz,
        );
        f.mesh.scale.set(ds, ds, ds);
      }
    },
  },

  {
    id: "flood",
    name: "Flood Spread",
    loc: [120.4250, 23.4181], city: "Bazhang River",
    tech: "Disc radius expansion + Z-axis rise + bright edge ring, regenerating on a fixed period",
    desc: "A disc-shaped water surface expands outward and rises upward at the same time, with a bright ring at its edge. Expresses a flooded area, spreading impact, infection propagation, or coverage growth.",
    prompt: "At <b>[location]</b>, flood once every <b>[5s]</b>: the water surface expands from 0 to <b>[2000m]</b>, water level simultaneously rising from 0 to <b>[200m]</b>, with a bright edge ring.",
    params: [
      { id: "maxR", label: "Max (m)", min: 300, max: 5000, step: 100, value: 2500 },
      { id: "maxRise", label: "Water level (m)", min: 50, max: 800, step: 25, value: 250 },
      { id: "period", label: "Period (s)", min: 2, max: 12, step: 0.5, value: 5 },
    ],
    build: (group) => {
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(1, 64),
        new THREE.MeshBasicMaterial({
          color: 0x6cb8ff, transparent: true, opacity: 0.4,
          side: THREE.DoubleSide, depthWrite: false,
        }),
      );
      group.add(disc);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.98, 1.0, 64),
        new THREE.MeshBasicMaterial({
          color: 0x6cb8ff, transparent: true, opacity: 1,
          side: THREE.DoubleSide, depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      group.add(ring);
      group.userData = { disc, ring, lastBurst: -10 };
    },
    update: (group, dt, t, params, scale) => {
      if (t - group.userData.lastBurst >= params.period) {
        group.userData.lastBurst = t;
      }
      const phase = (t - group.userData.lastBurst) / params.period;
      const r = params.maxR * scale * phase;
      const z = params.maxRise * scale * phase;
      group.userData.disc.scale.set(r, r, 1);
      group.userData.disc.position.z = z;
      group.userData.disc.material.opacity = 0.45 * (1 - phase * 0.5);
      group.userData.ring.scale.set(r, r, 1);
      group.userData.ring.position.z = z;
      group.userData.ring.material.opacity = 0.95 * (1 - phase * 0.6);
    },
  },

  {
    id: "feedback",
    name: "Feedback Loop",
    loc: [120.7794, 22.1989], city: "Mudan Reservoir",
    tech: "5 nodes arranged in a circle + slightly curved TubeGeometry connections + a light particle looping around",
    desc: "5 nodes linked in a ring, with a looping light particle expressing positive/negative feedback, a dependency cycle, subscription renewal, or process reflux. Change the node count to represent a different order of relationship.",
    prompt: "Lay out a <b>[1200m]</b> wide feedback loop at <b>[location]</b>, <b>[5]</b> nodes in a ring, <b>[6]</b> light particles looping clockwise.",
    params: [
      { id: "radius", label: "Extent (m)", min: 300, max: 3000, step: 50, value: 1300 },
      { id: "nodeSize", label: "Node size (m)", min: 50, max: 400, step: 10, value: 180 },
      { id: "speed", label: "Flow speed", min: 0.05, max: 2, step: 0.05, value: 0.6 },
    ],
    build: (group) => {
      const N = 5;
      const nodes = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 - Math.PI / 2;
        nodes.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
      }
      const colors = [0x6cb8ff, 0xff7eb6, 0x4cffa6, 0xffd87a, 0xa080ff];
      const nodeMeshes = [];
      for (let i = 0; i < N; i++) {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            color: colors[i], transparent: true, opacity: 0.92,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(m);
        nodeMeshes.push(m);
      }
      const conns = [];
      for (let i = 0; i < N; i++) {
        const a = nodes[i];
        const b = nodes[(i + 1) % N];
        const midOut = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
        midOut.multiplyScalar(1.25);
        const curve = new THREE.QuadraticBezierCurve3(a, midOut, b);
        const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.015, 8, false);
        const mesh = new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({
          color: 0x6cf6ff, transparent: true, opacity: 0.55,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        group.add(mesh);
        conns.push({ mesh, curve });
      }
      const PARTICLES = 6;
      const flows = [];
      for (let i = 0; i < PARTICLES; i++) {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 0),
          new THREE.MeshBasicMaterial({
            color: 0xffffff, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(m);
        flows.push({ mesh: m, offset: i / PARTICLES });
      }
      group.userData = { nodes, nodeMeshes, conns, flows, N };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const ns = params.nodeSize * scale * 0.5;
      const ds = params.nodeSize * scale * 0.25;
      const N = group.userData.N;
      for (let i = 0; i < N; i++) {
        const n = group.userData.nodes[i];
        const m = group.userData.nodeMeshes[i];
        m.position.set(n.x * r, n.y * r, ns);
        m.scale.set(ns, ns, ns);
      }
      for (const c of group.userData.conns) {
        c.mesh.scale.set(r, r, r);
        c.mesh.position.z = ns;
      }
      for (const f of group.userData.flows) {
        const phase = ((t * params.speed * 0.15) + f.offset) % 1;
        const segIdx = Math.floor(phase * N);
        const segPhase = (phase * N) % 1;
        const c = group.userData.conns[segIdx];
        const pt = c.curve.getPointAt(segPhase);
        f.mesh.position.set(pt.x * r, pt.y * r, ns);
        f.mesh.scale.set(ds, ds, ds);
      }
    },
  },
];
