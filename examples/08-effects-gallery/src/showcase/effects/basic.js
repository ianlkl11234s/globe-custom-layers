import * as THREE from "three";

export default [
  {
    id: "orb",
    name: "Glow Orb",
    loc: [121.5654, 25.0330], city: "Taipei",
    tech: "Layered IcosahedronGeometry + AdditiveBlending + breathing pulse",
    desc: "Three stacked spheres: a white core and two colored outer shells, opacity oscillating with sin(t). This is the same pattern used for ship/flight/train blips across Mini Taiwan Pulse.",
    prompt: "Place a <b>[250m]</b> diameter <b>[#6cb8ff]</b> glow orb at <b>[location]</b>, three layers (white core, blue shells), breathing pulse every <b>[2s]</b>.",
    params: [
      { id: "size", label: "Diameter (m)", min: 50, max: 800, step: 10, value: 250 },
      { id: "speed", label: "Pulse", min: 0, max: 5, step: 0.1, value: 2.0 },
    ],
    build: (group, params) => {
      const layers = [];
      const colors = [new THREE.Color(1,1,1), new THREE.Color(0.42, 0.72, 1), new THREE.Color(0.42, 0.72, 1)];
      const ratios = [0.4, 1.0, 2.0];
      const opacities = [1.0, 0.5, 0.15];
      for (let i = 0; i < 3; i++) {
        const geo = new THREE.IcosahedronGeometry(1, 2);
        const mat = new THREE.MeshBasicMaterial({
          color: colors[i], transparent: true, opacity: opacities[i],
          blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
        });
        mat.userData.baseOpacity = opacities[i];
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.ratio = ratios[i];
        group.add(mesh);
        layers.push(mesh);
      }
      group.userData.layers = layers;
    },
    update: (group, dt, t, params, scale) => {
      const half = (params.size * 0.5) * scale;
      for (const m of group.userData.layers) {
        const s = half * m.userData.ratio;
        m.scale.set(s, s, s);
        const pulse = 1 + Math.sin(t * params.speed) * 0.18;
        m.material.opacity = m.material.userData.baseOpacity * pulse;
      }
    },
  },

  {
    id: "cylinder",
    name: "Cylinder",
    loc: [121.4628, 25.0125], city: "New Taipei",
    tech: "CylinderGeometry + semi-transparent MeshBasicMaterial",
    desc: "The most basic 3D cylinder. Uniform height = signal tower; wide base, narrow top = lighthouse; base only = flat disc. Set topRadius to 0 to turn it into a cone.",
    prompt: "Erect a <b>[400m]</b> tall, <b>[60m]</b> radius <b>[pale green]</b> cylinder at <b>[location]</b>, semi-transparent (<b>opacity 0.5</b>), static.",
    params: [
      { id: "height", label: "Height (m)", min: 50, max: 1500, step: 10, value: 500 },
      { id: "radius", label: "Radius (m)", min: 10, max: 300, step: 5, value: 80 },
      { id: "opacity", label: "Opacity", min: 0.05, max: 1.0, step: 0.05, value: 0.5 },
    ],
    build: (group) => {
      const geo = new THREE.CylinderGeometry(1, 1, 1, 32);
      geo.translate(0, 0.5, 0); // align base to origin
      geo.rotateX(Math.PI / 2); // Y axis -> Z axis (Mapbox "up")
      const mat = new THREE.MeshBasicMaterial({
        color: 0x7fffa8, transparent: true, opacity: 0.5,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      m.scale.set(params.radius * scale, params.radius * scale, params.height * scale);
      m.material.opacity = params.opacity;
    },
  },

  {
    id: "cone",
    name: "Cone / Signal Tower",
    loc: [121.3010, 24.9930], city: "Taoyuan",
    tech: "ConeGeometry -- flipped, it reads as a funnel / radar coverage cone",
    desc: "ConeGeometry is CylinderGeometry with topRadius=0. Can express: a signal tower (tip up), radar coverage (tip down), or an umbrella-shaped range.",
    prompt: "Place an inverted (tip-down) <b>[300m]</b> tall, <b>[400m]</b> base-diameter <b>[orange-red]</b> cone at <b>[location]</b> to represent radar coverage, semi-transparent at 0.3.",
    params: [
      { id: "height", label: "Height (m)", min: 100, max: 1500, step: 20, value: 500 },
      { id: "radius", label: "Base radius (m)", min: 50, max: 800, step: 10, value: 300 },
      { id: "flip", label: "Tip down", min: 0, max: 1, step: 1, value: 0 },
    ],
    build: (group) => {
      const geo = new THREE.ConeGeometry(1, 1, 32, 1, true);
      geo.translate(0, 0.5, 0);
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff8866, transparent: true, opacity: 0.45,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      m.scale.set(params.radius * scale, params.radius * scale, params.height * scale);
      if (params.flip > 0.5) {
        m.rotation.x = Math.PI;
        m.position.z = params.height * scale;
      } else {
        m.rotation.x = 0;
        m.position.z = 0;
      }
    },
  },

  {
    id: "dome",
    name: "Dome / Half-sphere",
    loc: [120.6736, 24.1477], city: "Taichung",
    tech: "SphereGeometry with a phiStart/phiLength cutoff",
    desc: "Cutting a SphereGeometry's angle range in half makes a dome -- useful for stadiums, shields, or a zone of influence. Coloring the inside (BackSide) gives a planetarium-ceiling look.",
    prompt: "Build a <b>[700m]</b> radius <b>[purple]</b> half-dome at <b>[location]</b>, 0.25 opacity, double-sided so the inner structure is visible.",
    params: [
      { id: "radius", label: "Radius (m)", min: 100, max: 2000, step: 50, value: 700 },
      { id: "opacity", label: "Opacity", min: 0.05, max: 1.0, step: 0.05, value: 0.3 },
      { id: "wire", label: "Wireframe", min: 0, max: 1, step: 1, value: 1 },
    ],
    build: (group) => {
      const geo = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
      geo.rotateX(-Math.PI / 2); // opening faces down, dome faces +Z
      const mat = new THREE.MeshBasicMaterial({
        color: 0xb087ff, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      const wireGeo = new THREE.WireframeGeometry(geo);
      const wireMat = new THREE.LineBasicMaterial({ color: 0xb087ff, transparent: true, opacity: 0.5 });
      const wire = new THREE.LineSegments(wireGeo, wireMat);
      group.add(wire);

      group.userData.mesh = mesh;
      group.userData.wire = wire;
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      group.userData.mesh.scale.set(r, r, r);
      group.userData.wire.scale.set(r, r, r);
      group.userData.mesh.material.opacity = params.opacity;
      group.userData.wire.visible = params.wire > 0.5;
    },
  },

  {
    id: "heart",
    name: "Heart (Custom Shape Extrude)",
    loc: [120.4540, 23.4793], city: "Chiayi",
    tech: "THREE.Shape + bezierCurveTo draws a 2D heart -> ExtrudeGeometry gives it depth",
    desc: "The Shape API can draw any 2D outline (heart, star, logo, an administrative-boundary silhouette), then ExtrudeGeometry pushes it into 3D. Good fit for special locations, holidays, or brand markers.",
    prompt: "Float a <b>[red]</b> heart (Shape + Extrude, <b>80m</b> thick) <b>[600m]</b> above <b>[location]</b>, slowly spinning around the Z axis with a breathing pulse.",
    params: [
      { id: "size", label: "Size (m)", min: 100, max: 1500, step: 50, value: 600 },
      { id: "altitude", label: "Altitude (m)", min: 0, max: 2000, step: 50, value: 700 },
      { id: "spin", label: "Spin", min: 0, max: 3, step: 0.1, value: 0.6 },
    ],
    build: (group) => {
      const shape = new THREE.Shape();
      const x = 0, y = 0;
      shape.moveTo(x + 0.25, y + 0.25);
      shape.bezierCurveTo(x + 0.25, y + 0.25, x + 0.20, y, x, y);
      shape.bezierCurveTo(x - 0.30, y, x - 0.30, y + 0.35, x - 0.30, y + 0.35);
      shape.bezierCurveTo(x - 0.30, y + 0.55, x - 0.10, y + 0.77, x + 0.25, y + 0.95);
      shape.bezierCurveTo(x + 0.60, y + 0.77, x + 0.80, y + 0.55, x + 0.80, y + 0.35);
      shape.bezierCurveTo(x + 0.80, y + 0.35, x + 0.80, y, x + 0.50, y);
      shape.bezierCurveTo(x + 0.35, y, x + 0.25, y + 0.25, x + 0.25, y + 0.25);
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.18, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2,
      });
      geo.center();
      geo.rotateX(Math.PI / 2); // stand it upright
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff5b8a, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      const sz = params.size * scale;
      const pulse = 1 + 0.08 * Math.sin(t * 2);
      m.scale.set(sz * pulse, sz * pulse, sz * pulse);
      m.position.z = params.altitude * scale + sz * 0.5;
      m.rotation.z = t * params.spin;
    },
  },

  {
    id: "star",
    name: "Five-pointed Star (Extrude)",
    loc: [119.9525, 26.1496], city: "Matsu",
    tech: "10 alternating Vector2 points form a Shape, then ExtrudeGeometry",
    desc: "10 points alternating between an outer and inner radius make a five-pointed star. Change the point count for an eight- or twelve-pointed star; change the outer/inner ratio for skinnier or fatter points. Good for ratings, favorites, or hot POIs.",
    prompt: "Float a <b>[yellow]</b> five-pointed star (outer radius 700m, inner radius 280m) above <b>[location]</b>, slow spin with a breathing pulse.",
    params: [
      { id: "size", label: "Outer radius (m)", min: 100, max: 1500, step: 50, value: 700 },
      { id: "altitude", label: "Altitude (m)", min: 0, max: 2000, step: 50, value: 600 },
      { id: "spin", label: "Spin", min: 0, max: 3, step: 0.1, value: 0.5 },
    ],
    build: (group) => {
      const shape = new THREE.Shape();
      const points = 5, outer = 1.0, inner = 0.4;
      for (let i = 0; i < points * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
      }
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: 0.2, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2,
      });
      geo.center();
      geo.rotateX(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd54f, transparent: true, opacity: 0.95, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      group.userData.mesh = mesh;
    },
    update: (group, dt, t, params, scale) => {
      const m = group.userData.mesh;
      const sz = params.size * scale;
      const pulse = 1 + 0.06 * Math.sin(t * 2.5);
      m.scale.set(sz * pulse, sz * pulse, sz * pulse);
      m.position.z = params.altitude * scale + sz * 0.5;
      m.rotation.z = t * params.spin;
    },
  },

  {
    id: "pin",
    name: "3D Pin Marker (Google Maps style)",
    loc: [121.4406, 25.1699], city: "Tamsui",
    tech: "An inverted Cone + a Sphere (head) + a white dot, the whole thing can bounce",
    desc: "The classic map marker: a sphere on top, a pointed cone at the bottom, and a white dot in the center. Instantly recognizable from Google Maps / Apple Maps. Add a bounce to signal 'new notification'.",
    prompt: "Plant a <b>[red]</b> pin (<b>300m</b> tall) at <b>[location]</b>, pointed tip touching the ground, sphere head with a white center dot, bouncing once per second.",
    params: [
      { id: "size", label: "Size (m)", min: 50, max: 1000, step: 10, value: 250 },
      { id: "bounce", label: "Bounce", min: 0, max: 1, step: 1, value: 1 },
    ],
    build: (group) => {
      const matRed = new THREE.MeshBasicMaterial({ color: 0xff5b6e, transparent: true, opacity: 0.92, side: THREE.DoubleSide });
      const coneGeo = new THREE.ConeGeometry(0.45, 0.7, 24, 1, true);
      coneGeo.rotateX(-Math.PI / 2);
      coneGeo.translate(0, 0, 0.35);
      const cone = new THREE.Mesh(coneGeo, matRed);
      const sphereGeo = new THREE.SphereGeometry(0.5, 24, 16);
      sphereGeo.translate(0, 0, 0.95);
      const sphere = new THREE.Mesh(sphereGeo, matRed);
      const dotGeo = new THREE.SphereGeometry(0.18, 12, 8);
      dotGeo.translate(0, 0, 0.95);
      const dot = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      group.add(cone); group.add(sphere); group.add(dot);
      group.userData.meshes = [cone, sphere, dot];
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      const lift = params.bounce > 0.5 ? Math.abs(Math.sin(t * 2.5)) * sz * 0.4 : 0;
      for (const m of group.userData.meshes) {
        m.scale.set(sz, sz, sz);
        m.position.z = lift;
      }
    },
  },

  {
    id: "crystal",
    name: "Crystal (Polyhedron)",
    loc: [120.7500, 24.3833], city: "Sanyi",
    tech: "Octahedron / Dodecahedron / Icosahedron + a wireframe overlay + dual-axis rotation",
    desc: "A built-in polyhedron plus a wireframe overlay reads as a crystal / gem / abstract logo. Swap `shape` to switch face count. The dual-axis rotation lets you see every face.",
    prompt: "Float a <b>[light blue]</b> octahedron (radius <b>300m</b>) at <b>400m</b> altitude above <b>[location]</b>, translucent white wireframe inside, slow rotation on both X and Y axes.",
    params: [
      { id: "size", label: "Radius (m)", min: 100, max: 1500, step: 25, value: 400 },
      { id: "altitude", label: "Altitude (m)", min: 0, max: 2000, step: 50, value: 500 },
      { id: "shape", label: "Shape", min: 0, max: 3, step: 1, value: 0 },
      { id: "spinX", label: "Spin X", min: 0, max: 2, step: 0.1, value: 0.5 },
      { id: "spinY", label: "Spin Y", min: 0, max: 2, step: 0.1, value: 0.3 },
    ],
    build: (group) => {
      const geo = new THREE.OctahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x6cb8ff, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);
      const wireGeo = new THREE.WireframeGeometry(geo);
      const wire = new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85,
      }));
      group.add(wire);
      group.userData = { mesh, wire, lastShape: 0 };
    },
    update: (group, dt, t, params, scale) => {
      const sz = params.size * scale;
      const z = params.altitude * scale + sz;
      [group.userData.mesh, group.userData.wire].forEach((m) => {
        m.scale.set(sz, sz, sz);
        m.position.z = z;
        m.rotation.x = t * params.spinX;
        m.rotation.y = t * params.spinY;
      });
      const shape = Math.round(params.shape);
      if (shape !== group.userData.lastShape) {
        group.userData.lastShape = shape;
        const newGeo = shape === 0 ? new THREE.OctahedronGeometry(1, 0) :
                       shape === 1 ? new THREE.DodecahedronGeometry(1, 0) :
                       shape === 2 ? new THREE.IcosahedronGeometry(1, 0) :
                       new THREE.TetrahedronGeometry(1, 0);
        group.userData.mesh.geometry.dispose();
        group.userData.mesh.geometry = newGeo;
        group.userData.wire.geometry.dispose();
        group.userData.wire.geometry = new THREE.WireframeGeometry(newGeo);
      }
    },
  },
];
