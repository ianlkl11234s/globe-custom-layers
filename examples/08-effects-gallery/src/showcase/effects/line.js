import * as THREE from "three";

export default [
  {
    id: "flowline",
    name: "Flow Line",
    loc: [121.7390, 25.1276], city: "Keelung -> Su-ao", isLine: true,
    lineEnd: [121.8536, 24.5946],
    tech: "Line geometry + glowing orbs moving along the line (position = lerp between start and end)",
    desc: "Draws a geographic line with several glowing orbs moving along it to express \"data/logistics flow\". Density, speed, and direction are all adjustable. The train blips in this project use this exact pattern.",
    prompt: "Draw a <b>[cyan]</b> line from <b>[Keelung]</b> to <b>[Su-ao]</b>, with <b>[5]</b> glowing orbs continuously flowing from start to end at <b>[1/8 of the full length per second]</b>.",
    params: [
      { id: "count", label: "Orb count", min: 1, max: 20, step: 1, value: 6 },
      { id: "speed", label: "Speed", min: 0.05, max: 1.0, step: 0.05, value: 0.2 },
      { id: "size", label: "Orb diameter (m)", min: 50, max: 800, step: 25, value: 200 },
    ],
    build: (group, params, ctx) => {
      // Use ctx.lineStartMC, ctx.lineEndMC, ctx.lineScale (both ends are already mercator coordinates)
      // This effect's group is NOT centered via fromLngLat -- group.position stays (0,0,0)
      // We place the line endpoints directly inside the group
      const a = ctx.lineStartMC;
      const b = ctx.lineEndMC;

      // The line
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z),
      ]);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x6cf6ff, transparent: true, opacity: 0.5 });
      const line = new THREE.Line(lineGeo, lineMat);
      group.add(line);

      // The orbs (multiple small orbs)
      const orbs = [];
      for (let i = 0; i < 20; i++) {
        const orbGroup = new THREE.Group();
        const colors = [new THREE.Color(1,1,1), new THREE.Color(0.42, 0.96, 1)];
        for (let j = 0; j < 2; j++) {
          const geo = new THREE.IcosahedronGeometry(1, 1);
          const mat = new THREE.MeshBasicMaterial({
            color: colors[j], transparent: true, opacity: j === 0 ? 1 : 0.4,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const mesh = new THREE.Mesh(geo, mat);
          orbGroup.add(mesh);
          orbGroup.userData.layers = orbGroup.userData.layers || [];
          orbGroup.userData.layers.push({ mesh, ratio: j === 0 ? 0.4 : 1.0 });
        }
        group.add(orbGroup);
        orbs.push(orbGroup);
      }

      group.userData = { a, b, orbs, scale: ctx.lineScale };
    },
    update: (group, dt, t, params, scale) => {
      // Orb position: t/totalTime lands in [0,1)
      const { a, b, orbs } = group.userData;
      const meterScale = group.userData.scale;
      const visible = Math.round(params.count);
      const sz = params.size * meterScale * 0.5;
      orbs.forEach((orb, i) => {
        if (i >= visible) { orb.visible = false; return; }
        orb.visible = true;
        const phase = ((t * params.speed) + i / visible) % 1;
        const x = a.x + (b.x - a.x) * phase;
        const y = a.y + (b.y - a.y) * phase;
        const z = a.z + (b.z - a.z) * phase;
        orb.position.set(x, y, z);
        for (const { mesh, ratio } of orb.userData.layers) {
          const s = sz * ratio;
          mesh.scale.set(s, s, s);
        }
      });
    },
  },

  {
    id: "arc",
    name: "OD Arc (Bezier Arc)",
    loc: [121.5654, 25.0330], lineEnd: [119.5667, 23.5667],
    city: "Taipei <-> Penghu", isArc: true,
    tech: "QuadraticBezierCurve3 + glowing orbs along the line (visualizes an O->D pair)",
    desc: "Connects two points with a parabolic arc, arc height scaled by distance. Flights, logistics, money flow, and social connections all use this pattern. Stack multiple arcs to form an O-D matrix.",
    prompt: "Draw a <b>[pink]</b> parabolic arc from <b>[point A]</b> to <b>[point B]</b> (arc height = 30% of distance), with <b>[4]</b> glowing orbs continuously flowing from A to B.",
    params: [
      { id: "arcHeight", label: "Arc height ratio", min: 0.05, max: 1.0, step: 0.05, value: 0.30 },
      { id: "speed", label: "Speed", min: 0.05, max: 1.0, step: 0.05, value: 0.25 },
      { id: "count", label: "Orb count", min: 1, max: 12, step: 1, value: 4 },
      { id: "size", label: "Orb diameter (m)", min: 100, max: 1500, step: 50, value: 500 },
    ],
    build: (group, params, ctx) => {
      const a = new THREE.Vector3(ctx.startMC.x, ctx.startMC.y, ctx.startMC.z);
      const b = new THREE.Vector3(ctx.endMC.x, ctx.endMC.y, ctx.endMC.z);
      const dist = ctx.distance;
      const arcZ = dist * params.arcHeight;
      const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, arcZ);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const points = curve.getPoints(64);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
      const lineMat = new THREE.LineBasicMaterial({ color: 0xff7eb6, transparent: true, opacity: 0.55 });
      const line = new THREE.Line(lineGeo, lineMat);
      group.add(line);

      const orbs = [];
      for (let i = 0; i < 12; i++) {
        const orbGroup = new THREE.Group();
        const layers = [];
        const colors = [new THREE.Color(1,1,1), new THREE.Color(1, 0.5, 0.71)];
        for (let j = 0; j < 2; j++) {
          const geo = new THREE.IcosahedronGeometry(1, 1);
          const mat = new THREE.MeshBasicMaterial({
            color: colors[j], transparent: true, opacity: j === 0 ? 1 : 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const m = new THREE.Mesh(geo, mat);
          orbGroup.add(m);
          layers.push({ mesh: m, ratio: j === 0 ? 0.4 : 1.0 });
        }
        orbGroup.userData.layers = layers;
        group.add(orbGroup);
        orbs.push(orbGroup);
      }

      group.userData = { a, b, dist, curve, line, orbs, scale: ctx.scale, lastArcH: params.arcHeight };
    },
    update: (group, dt, t, params, scale) => {
      const { a, b, dist, orbs, scale: meterScale } = group.userData;

      // Rebuild the curve + line only when the arc height changes
      if (Math.abs(group.userData.lastArcH - params.arcHeight) > 1e-4) {
        group.userData.lastArcH = params.arcHeight;
        const arcZ = dist * params.arcHeight;
        const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, arcZ);
        group.userData.curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        const pts = group.userData.curve.getPoints(64);
        group.userData.line.geometry.dispose();
        group.userData.line.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      }

      const curve = group.userData.curve;
      const visible = Math.round(params.count);
      const sz = params.size * meterScale * 0.5;
      orbs.forEach((orb, i) => {
        if (i >= visible) { orb.visible = false; return; }
        orb.visible = true;
        const phase = ((t * params.speed) + i / visible) % 1;
        const pt = curve.getPointAt(phase);
        orb.position.copy(pt);
        for (const { mesh, ratio } of orb.userData.layers) {
          const s = sz * ratio;
          mesh.scale.set(s, s, s);
        }
      });
    },
  },

  {
    id: "network",
    name: "Network Web",
    loc: [120.9675, 24.8138], city: "Hsinchu",
    tech: "Node orbs + all-pairs connecting lines + pulses propagating along the edges (graph network)",
    desc: "Multiple nodes connected to each other, with pulses traveling along the edges to represent information/logistics/communication flow. Node count, edge density, and propagation speed are all adjustable. Used for social graphs, local networks, or blockchain nodes.",
    prompt: "Lay out <b>[7]</b> nodes at <b>[location]</b> (hexagon + center), fully connect every pair, and have <b>[14]</b> white pulses propagate along the edges at random speeds.",
    params: [
      { id: "radius", label: "Radius (m)", min: 200, max: 3500, step: 100, value: 1200 },
      { id: "nodeSize", label: "Node (m)", min: 50, max: 500, step: 25, value: 180 },
      { id: "pulseCount", label: "Pulses", min: 0, max: 30, step: 1, value: 14 },
      { id: "speed", label: "Speed", min: 0.05, max: 1.5, step: 0.05, value: 0.4 },
    ],
    build: (group) => {
      const ANGLES = 6;
      const anchors = [];
      for (let i = 0; i < ANGLES; i++) {
        const a = (i / ANGLES) * Math.PI * 2;
        anchors.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
      }
      anchors.push(new THREE.Vector3(0, 0, 0));

      const makeOrb = (coreColor) => {
        const og = new THREE.Group();
        const layers = [];
        const colors = [new THREE.Color(1,1,1), coreColor];
        for (let j = 0; j < 2; j++) {
          const geo = new THREE.IcosahedronGeometry(1, 1);
          const mat = new THREE.MeshBasicMaterial({
            color: colors[j], transparent: true, opacity: j === 0 ? 1 : 0.45,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const m = new THREE.Mesh(geo, mat);
          og.add(m);
          layers.push({ mesh: m, ratio: j === 0 ? 0.4 : 1.0 });
        }
        og.userData.layers = layers;
        return og;
      };

      const nodes = anchors.map((base) => {
        const orb = makeOrb(new THREE.Color(0.42, 0.96, 1));
        group.add(orb);
        return { orb, base };
      });

      const edges = [];
      for (let i = 0; i < anchors.length; i++) {
        for (let j = i + 1; j < anchors.length; j++) {
          const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
          const mat = new THREE.LineBasicMaterial({ color: 0x6cf6ff, transparent: true, opacity: 0.22 });
          const line = new THREE.Line(geo, mat);
          group.add(line);
          edges.push({ line, ai: i, bi: j });
        }
      }

      const pulses = [];
      for (let p = 0; p < 30; p++) {
        const orb = makeOrb(new THREE.Color(0.7, 1.0, 0.85));
        group.add(orb);
        pulses.push({ orb, edgeIdx: p % edges.length, offset: Math.random(), speed: 0.5 + Math.random() * 1.5 });
      }
      group.userData = { nodes, edges, pulses };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const ns = params.nodeSize * scale;
      const ps = params.nodeSize * 0.45 * scale;

      for (const n of group.userData.nodes) {
        n.orb.position.set(n.base.x * r, n.base.y * r, n.base.z * r);
        for (const { mesh, ratio } of n.orb.userData.layers) {
          const s = ns * ratio;
          mesh.scale.set(s, s, s);
        }
      }
      for (const e of group.userData.edges) {
        const a = group.userData.nodes[e.ai].orb.position;
        const b = group.userData.nodes[e.bi].orb.position;
        const arr = e.line.geometry.attributes.position.array;
        arr[0] = a.x; arr[1] = a.y; arr[2] = a.z;
        arr[3] = b.x; arr[4] = b.y; arr[5] = b.z;
        e.line.geometry.attributes.position.needsUpdate = true;
      }
      const visible = Math.round(params.pulseCount);
      group.userData.pulses.forEach((p, i) => {
        if (i >= visible) { p.orb.visible = false; return; }
        p.orb.visible = true;
        const e = group.userData.edges[p.edgeIdx];
        const a = group.userData.nodes[e.ai].orb.position;
        const b = group.userData.nodes[e.bi].orb.position;
        const phase = ((t * params.speed * p.speed) + p.offset) % 1;
        p.orb.position.set(
          a.x + (b.x - a.x) * phase,
          a.y + (b.y - a.y) * phase,
          a.z + (b.z - a.z) * phase,
        );
        for (const { mesh, ratio } of p.orb.userData.layers) {
          const s = ps * ratio;
          mesh.scale.set(s, s, s);
        }
      });
    },
  },

  {
    id: "linechart",
    name: "3D Line Chart",
    loc: [120.4825, 22.8825], city: "Qishan",
    tech: "BufferGeometry polyline + small marker orb per node + Z-height driven by sin",
    desc: "12 data points connected into a polyline, with a marker orb at each point. Z height is animated with sin to simulate a time series. Swap in a real data array and this becomes a time-series chart.",
    prompt: "Draw a <b>[12-point]</b> polyline at <b>[location]</b> (total length <b>[2000m]</b>), with <b>[yellow]</b> markers at each point, Z height animating to simulate a time series.",
    params: [
      { id: "length", label: "Length (m)", min: 500, max: 4000, step: 100, value: 2200 },
      { id: "maxH", label: "Height (m)", min: 50, max: 1000, step: 25, value: 500 },
      { id: "markerSize", label: "Marker diameter (m)", min: 20, max: 200, step: 5, value: 60 },
    ],
    build: (group) => {
      const N = 12;
      const positions = new Float32Array(N * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
        color: 0x6cb8ff, transparent: true, opacity: 0.85,
      }));
      group.add(line);
      const markers = [];
      const sphereGeo = new THREE.IcosahedronGeometry(1, 1);
      for (let i = 0; i < N; i++) {
        const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({
          color: 0xffd87a, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        group.add(m);
        markers.push(m);
      }
      group.userData = { line, markers, N };
    },
    update: (group, dt, t, params, scale) => {
      const N = group.userData.N;
      const length = params.length * scale;
      const maxH = params.maxH * scale;
      const sz = params.markerSize * scale * 0.5;
      const positions = group.userData.line.geometry.attributes.position.array;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1) - 0.5;
        const x = u * length;
        const y = 0;
        const z = ((Math.sin(t * 0.5 + i * 0.7) + 1) / 2) * maxH + sz;
        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;
        group.userData.markers[i].position.set(x, y, z);
        group.userData.markers[i].scale.set(sz, sz, sz);
      }
      group.userData.line.geometry.attributes.position.needsUpdate = true;
    },
  },

  // -- System relations / water resources --

  {
    id: "watershed",
    name: "Watershed Tree",
    loc: [121.5891, 24.9011], city: "Feitsui Reservoir",
    tech: "Recursively generated tree structure (4 directions x 3 levels) + pulses flowing from the branches toward the center",
    desc: "A central trunk splits into multiple layers of branches, with pulses flowing from the leaf tips toward the center -- expressing watershed convergence, neural signaling, or signal aggregation. Adjust depth/branches to change the branching density.",
    prompt: "Lay out a watershed tree spanning <b>[1500m]</b> at <b>[location]</b>, with <b>[4 directions]</b> each recursing <b>[3 levels]</b> of branches, pulses flowing from the leaf tips back to the center, plus a pulsing core.",
    params: [
      { id: "size", label: "Span (m)", min: 300, max: 4000, step: 100, value: 1800 },
      { id: "speed", label: "Flow speed", min: 0.05, max: 1.0, step: 0.05, value: 0.3 },
      { id: "coreSize", label: "Core (m)", min: 50, max: 500, step: 25, value: 250 },
      { id: "dotSize", label: "Dot diameter (m)", min: 20, max: 200, step: 5, value: 70 },
    ],
    build: (group) => {
      const segments = [];
      const recurse = (p, dir, depth, length) => {
        if (depth >= 3) return;
        const branches = 2 + Math.floor(Math.random() * 2);
        for (let i = 0; i < branches; i++) {
          const angle = ((i + 0.5) / branches - 0.5) * 1.0 + dir;
          const childLen = length * 0.6;
          const child = new THREE.Vector3(
            p.x + Math.cos(angle) * childLen,
            p.y + Math.sin(angle) * childLen,
            0,
          );
          segments.push({ parent: p, child });
          recurse(child, angle, depth + 1, childLen);
        }
      };
      const center = new THREE.Vector3(0, 0, 0);
      for (let i = 0; i < 4; i++) recurse(center, (i / 4) * Math.PI * 2, 0, 0.4);

      const positions = [];
      for (const s of segments) {
        positions.push(s.parent.x, s.parent.y, s.parent.z);
        positions.push(s.child.x, s.child.y, s.child.z);
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
        color: 0x6cb8ff, transparent: true, opacity: 0.55,
      }));
      group.add(lines);

      const centerOrb = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x6cb8ff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      group.add(centerOrb);

      const flows = [];
      for (const s of segments) {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 0),
          new THREE.MeshBasicMaterial({
            color: 0x6cf6ff, transparent: true, opacity: 1,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(m);
        flows.push({ mesh: m, parent: s.parent, child: s.child, phase: Math.random() });
      }
      group.userData = { lines, centerOrb, flows };
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      group.userData.lines.scale.set(sz, sz, sz);
      const cs = params.coreSize * scale * 0.5;
      const pulse = 1 + 0.25 * Math.sin(t * 3);
      group.userData.centerOrb.scale.set(cs * pulse, cs * pulse, cs * pulse);
      group.userData.centerOrb.position.z = cs * 0.5;
      const ds = params.dotSize * scale * 0.5;
      for (const f of group.userData.flows) {
        f.phase = (f.phase + dt * params.speed) % 1;
        const x = f.child.x + (f.parent.x - f.child.x) * f.phase;
        const y = f.child.y + (f.parent.y - f.child.y) * f.phase;
        f.mesh.position.set(x * sz, y * sz, ds * 0.5);
        f.mesh.scale.set(ds, ds, ds);
      }
    },
  },

  {
    id: "sankey",
    name: "Sankey Flow Ribbon",
    loc: [121.2569, 24.8137], lineEnd: [121.0734, 25.0367],
    city: "Shimen -> Taoyuan", isArc: true,
    tech: "QuadraticBezierCurve3 + TubeGeometry (thickness = flow volume) + shader-animated scrolling stripes",
    desc: "A thick tube between two points, where tube thickness represents flow volume and surface stripes scroll toward the destination -- a \"scaled flow\" of material/water/capital. The 3D version of a Sankey diagram.",
    prompt: "Draw a <b>[200m]</b> thick <b>[cyan]</b> flow ribbon from <b>[A]</b> to <b>[B]</b>, surface stripes scrolling toward the destination, arc height at 20% of distance.",
    params: [
      { id: "width", label: "Tube diameter (m)", min: 30, max: 600, step: 10, value: 220 },
      { id: "speed", label: "Flow speed", min: 0.05, max: 2.0, step: 0.05, value: 0.5 },
    ],
    build: (group, params, ctx) => {
      const a = new THREE.Vector3(ctx.startMC.x, ctx.startMC.y, ctx.startMC.z);
      const b = new THREE.Vector3(ctx.endMC.x, ctx.endMC.y, ctx.endMC.z);
      const arcZ = ctx.distance * 0.2;
      const mid = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2, arcZ);
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tubeGeo = new THREE.TubeGeometry(curve, 64, ctx.scale * params.width * 0.5, 12, false);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uColorA: { value: new THREE.Color(0x6cb8ff) },
          uColorB: { value: new THREE.Color(0xffffff) },
        },
        vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform float uTime;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          varying vec2 vUv;
          void main() {
            float stripe = sin((vUv.y - uTime * 0.5) * 6.2831 * 6.0);
            float band = smoothstep(0.0, 1.0, stripe);
            vec3 col = mix(uColorA, uColorB, band);
            gl_FragColor = vec4(col, 0.55 + band * 0.25);
          }
        `,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(tubeGeo, mat);
      group.add(mesh);
      group.userData = { mesh, curve, scale: ctx.scale, lastWidth: params.width };
    },
    update: (group, dt, t, params, scale) => {
      const meterScale = group.userData.scale;
      if (Math.abs(params.width - group.userData.lastWidth) > 1) {
        group.userData.lastWidth = params.width;
        group.userData.mesh.geometry.dispose();
        group.userData.mesh.geometry = new THREE.TubeGeometry(group.userData.curve, 64, meterScale * params.width * 0.5, 12, false);
      }
      group.userData.mesh.material.uniforms.uTime.value = t * params.speed;
    },
  },

  {
    id: "converge",
    name: "Multi-Source Converge",
    loc: [121.6500, 24.6800], city: "Lanyang Plain",
    tech: "6 outer nodes + a central core + pulses propagating inward along the lines",
    desc: "Multiple outer sources (6 nodes) converging into a central core, with pulses moving from the periphery toward the center plus a pulsing core. Used for watershed convergence, resource aggregation, or community consolidation.",
    prompt: "Build <b>[6]</b> outer source nodes around a center at <b>[location]</b> spanning <b>[1500m]</b>, with <b>[3]</b> pulses continuously flowing inward along each radial line.",
    params: [
      { id: "radius", label: "Radius (m)", min: 300, max: 3500, step: 100, value: 1500 },
      { id: "coreSize", label: "Core (m)", min: 50, max: 500, step: 25, value: 250 },
      { id: "sourceSize", label: "Source (m)", min: 30, max: 300, step: 10, value: 130 },
      { id: "speed", label: "Flow speed", min: 0.05, max: 1.5, step: 0.05, value: 0.3 },
    ],
    build: (group) => {
      const ARMS = 6;
      const sources = [];
      for (let i = 0; i < ARMS; i++) {
        const a = (i / ARMS) * Math.PI * 2;
        sources.push(new THREE.Vector3(Math.cos(a), Math.sin(a), 0));
      }
      const center = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x6cb8ff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      group.add(center);
      const arms = [];
      for (const s of sources) {
        const orb = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 1),
          new THREE.MeshBasicMaterial({
            color: 0x4cffa6, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(orb);
        const lineGeo = new THREE.BufferGeometry().setFromPoints([s, new THREE.Vector3(0, 0, 0)]);
        const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({
          color: 0x6cf6ff, transparent: true, opacity: 0.3,
        }));
        group.add(line);
        const dots = [];
        for (let i = 0; i < 3; i++) {
          const d = new THREE.Mesh(
            new THREE.IcosahedronGeometry(1, 0),
            new THREE.MeshBasicMaterial({
              color: 0xffffff, transparent: true, opacity: 1,
              blending: THREE.AdditiveBlending, depthWrite: false,
            }),
          );
          group.add(d);
          dots.push({ mesh: d, offset: i / 3 });
        }
        arms.push({ source: s, orb, line, dots });
      }
      group.userData = { center, arms };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const cs = params.coreSize * scale * 0.5;
      const ss = params.sourceSize * scale * 0.5;
      const ds = params.coreSize * scale * 0.18;
      const pulse = 1 + 0.25 * Math.sin(t * 3);
      group.userData.center.scale.set(cs * pulse, cs * pulse, cs * pulse);
      group.userData.center.position.z = ss * 0.4;
      for (const arm of group.userData.arms) {
        arm.orb.position.set(arm.source.x * r, arm.source.y * r, ss * 0.4);
        arm.orb.scale.set(ss, ss, ss);
        const arr = arm.line.geometry.attributes.position.array;
        arr[0] = arm.source.x * r; arr[1] = arm.source.y * r; arr[2] = ss * 0.4;
        arr[3] = 0; arr[4] = 0; arr[5] = ss * 0.4;
        arm.line.geometry.attributes.position.needsUpdate = true;
        for (const d of arm.dots) {
          const phase = ((t * params.speed) + d.offset) % 1;
          const k = 1 - phase;
          d.mesh.position.set(arm.source.x * r * k, arm.source.y * r * k, ss * 0.4);
          d.mesh.scale.set(ds, ds, ds);
        }
      }
    },
  },
];
