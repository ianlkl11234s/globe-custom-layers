import * as THREE from "three";

export default [
  {
    id: "particles",
    name: "Particle Fountain",
    loc: [120.4866, 22.6700], city: "Pingtung",
    tech: "Points + BufferGeometry with dynamic position updates / respawn",
    desc: "Each particle has its own speed and lifecycle; when it reaches the top or burns out it respawns at the bottom. Change the direction and it becomes rain, or scatter it in all directions for a firework explosion.",
    prompt: "At <b>[location]</b>, shoot up <b>[300]</b> upward <b>[yellow-green]</b> light particles, max height <b>[400m]</b>, fading out and respawning at the top.",
    params: [
      { id: "count", label: "Count", min: 50, max: 1000, step: 50, value: 300 },
      { id: "height", label: "Height (m)", min: 100, max: 1500, step: 20, value: 500 },
      { id: "size", label: "Size", min: 1, max: 30, step: 1, value: 8 },
    ],
    build: (group) => {
      // Using 3 separate mesh sphere instances isn't practical; use InstancedMesh or Points instead
      // Points inside a Mapbox custom layer default to 1px in GL, so a custom shader would be needed
      // Simple version: InstancedMesh + small sphere
      const N = 1000;
      const sphereGeo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xb6ff5b, transparent: true, opacity: 1.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(sphereGeo, mat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

      // Random initial state
      const states = new Array(N).fill(0).map(() => ({
        life: Math.random(),         // 0-1 (0 = bottom, 1 = top)
        speed: 0.3 + Math.random() * 0.7,
        offsetX: (Math.random() - 0.5) * 0.3,
        offsetY: (Math.random() - 0.5) * 0.3,
        spread: Math.random() * 0.15,
      }));

      group.add(inst);
      group.userData = { inst, states, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, states } = group.userData;
      const visible = Math.round(params.count);
      const h = params.height * scale;
      const size = params.size * scale;
      const dummy = new THREE.Object3D();

      for (let i = 0; i < states.length; i++) {
        const s = states[i];
        if (i < visible) {
          s.life += dt * 0.4 * s.speed;
          if (s.life > 1) s.life -= 1;
          const z = s.life * h;
          // Spread slightly outward while rising
          const spreadFactor = s.life * s.spread * h * 0.5;
          dummy.position.set(s.offsetX * h * 0.05 + Math.cos(i) * spreadFactor, s.offsetY * h * 0.05 + Math.sin(i) * spreadFactor, z);
          // Smaller the higher it goes
          const ss = size * (1 - s.life * 0.5);
          dummy.scale.set(ss, ss, ss);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        } else {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
        }
      }
      inst.count = states.length;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "firework",
    name: "Firework Burst",
    loc: [120.7964, 21.9466], city: "Kenting",
    tech: "InstancedMesh particles + random spherical direction + gravity + synchronized batch respawn",
    desc: "Particles burst from a single point in all directions at once, then gravity pulls them down. The whole batch respawns every few seconds for continuous fireworks. Change the color for different festival / alert effects.",
    prompt: "At <b>[location]</b>, <b>[500m]</b> up in the sky, every <b>[2s]</b> burst <b>[150]</b> particles outward in all directions + fall under gravity, fading out within 1.5s, random color each time.",
    params: [
      { id: "count", label: "Count", min: 30, max: 300, step: 10, value: 150 },
      { id: "speed", label: "Speed", min: 100, max: 1000, step: 25, value: 350 },
      { id: "altitude", label: "Center (m)", min: 100, max: 2000, step: 50, value: 600 },
      { id: "interval", label: "Interval (s)", min: 0.5, max: 5, step: 0.1, value: 2.0 },
    ],
    build: (group) => {
      const N = 300;
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const dirs = [];
      for (let i = 0; i < N; i++) {
        const theta = Math.acos(2 * Math.random() - 1);
        const phi = Math.random() * Math.PI * 2;
        dirs.push({
          x: Math.sin(theta) * Math.cos(phi),
          y: Math.sin(theta) * Math.sin(phi),
          z: Math.abs(Math.cos(theta)) * 0.6 + 0.4, // biased upward
        });
      }
      group.add(inst);
      group.userData = { inst, mat, dirs, N, lastBurst: -10 };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, mat, dirs, N } = group.userData;
      const visible = Math.round(params.count);
      const speed = params.speed * scale;
      const alt = params.altitude * scale;
      const interval = params.interval;
      const G = -200 * scale;
      const LIFETIME = 1.5;
      if (t - group.userData.lastBurst >= interval) {
        group.userData.lastBurst = t;
        mat.color.setHSL(Math.random(), 0.95, 0.6);
      }
      const life = t - group.userData.lastBurst;
      const fade = Math.max(0, 1 - life / LIFETIME);
      mat.opacity = fade;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        if (i >= visible) {
          dummy.scale.set(0, 0, 0);
          dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix);
          continue;
        }
        const d = dirs[i];
        dummy.position.set(
          d.x * speed * life,
          d.y * speed * life,
          alt + d.z * speed * life + 0.5 * G * life * life,
        );
        const sz = scale * 60 * fade;
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "ballistic",
    name: "Ballistic Motion",
    loc: [121.9550, 24.8329], city: "Guishan Island",
    tech: "Sphere + physics integration (v += g*dt; pos += v*dt) + respawn on landing",
    desc: "Multiple balls launch at random initial velocity and trace a parabola under gravity. Can express fountain droplets, ballistic trajectories, projectiles, or falling leaves. Reverse gravity for a buoyancy effect.",
    prompt: "At <b>[location]</b>, launch <b>[20]</b> balls at <b>[350m/s]</b> initial speed, random horizontal direction, 30-45 deg elevation angle, gravity <b>[200m/s2]</b>, respawning on landing.",
    params: [
      { id: "count", label: "Count", min: 5, max: 50, step: 1, value: 20 },
      { id: "speed", label: "Initial Speed", min: 100, max: 800, step: 25, value: 400 },
      { id: "size", label: "Diameter (m)", min: 30, max: 300, step: 10, value: 100 },
    ],
    build: (group) => {
      const balls = [];
      for (let i = 0; i < 50; i++) {
        const og = new THREE.Group();
        const layers = [];
        const colors = [new THREE.Color(1,1,1), new THREE.Color(1, 0.85, 0.5)];
        for (let j = 0; j < 2; j++) {
          const geo = new THREE.IcosahedronGeometry(1, 1);
          const mat = new THREE.MeshBasicMaterial({
            color: colors[j], transparent: true, opacity: j === 0 ? 1 : 0.5,
            blending: THREE.AdditiveBlending, depthWrite: false,
          });
          const m = new THREE.Mesh(geo, mat);
          og.add(m);
          layers.push({ mesh: m, ratio: j === 0 ? 0.4 : 1.0 });
        }
        og.userData.layers = layers;
        group.add(og);
        balls.push({ orb: og, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: false });
      }
      group.userData.balls = balls;
    },
    update: (group, dt, t, params, scale) => {
      const visible = Math.round(params.count);
      const initSpeed = params.speed * scale;
      const sz = params.size * scale * 0.5;
      const G = -200 * scale;
      group.userData.balls.forEach((b, i) => {
        if (i >= visible) { b.orb.visible = false; return; }
        b.orb.visible = true;
        if (!b.alive || b.z < 0) {
          b.alive = true;
          b.x = 0; b.y = 0; b.z = 0;
          const angle = Math.random() * Math.PI * 2;
          const elev = Math.PI * 0.30 + Math.random() * Math.PI * 0.18;
          const horiz = Math.cos(elev) * initSpeed;
          b.vx = Math.cos(angle) * horiz;
          b.vy = Math.sin(angle) * horiz;
          b.vz = Math.sin(elev) * initSpeed;
        }
        b.vz += G * dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.z += b.vz * dt;
        b.orb.position.set(b.x, b.y, Math.max(0, b.z));
        for (const { mesh, ratio } of b.orb.userData.layers) {
          const s = sz * ratio;
          mesh.scale.set(s, s, s);
        }
      });
    },
  },

  {
    id: "tornado",
    name: "Tornado",
    loc: [121.5394, 22.0556], city: "Lanyu",
    tech: "InstancedMesh particles + (cos, sin, z) spiral coordinates + radius linearly varying with height",
    desc: "Particles are distributed on a spiral cylinder surface, rotating quickly around the center while slowly rising. The radius varying with height determines the shape (funnel / spindle / cylinder). Change the density for a sandstorm / typhoon.",
    prompt: "At <b>[location]</b>, spin up a <b>[250]</b>-particle tornado, <b>[1000m]</b> tall, <b>[100m]</b> base diameter and <b>[350m]</b> top diameter, <b>[1.2 rev]</b> per second.",
    params: [
      { id: "count", label: "Count", min: 50, max: 500, step: 10, value: 250 },
      { id: "height", label: "Height (m)", min: 200, max: 2000, step: 50, value: 1000 },
      { id: "rBottom", label: "Base Diameter (m)", min: 30, max: 500, step: 10, value: 100 },
      { id: "rTop", label: "Top Diameter (m)", min: 30, max: 800, step: 10, value: 350 },
      { id: "spin", label: "Rev/s", min: 0.1, max: 4, step: 0.1, value: 1.2 },
    ],
    build: (group) => {
      const N = 500;
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xcccccc, transparent: true, opacity: 0.55, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const states = [];
      for (let i = 0; i < N; i++) {
        states.push({
          u: i / N,
          phase: Math.random() * Math.PI * 2,
          rJitter: 0.7 + Math.random() * 0.6,
          zOffset: Math.random(),
        });
      }
      group.add(inst);
      group.userData = { inst, states, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, states, N } = group.userData;
      const visible = Math.round(params.count);
      const h = params.height * scale;
      const rB = params.rBottom * scale;
      const rT = params.rTop * scale;
      const omega = params.spin * Math.PI * 2;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        const s = states[i];
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const u = (s.u + s.zOffset + t * 0.04) % 1;
        const z = u * h;
        const r = (rB + (rT - rB) * u) * s.rJitter;
        const a = s.phase + omega * t * (1 - u * 0.3);
        dummy.position.set(Math.cos(a) * r, Math.sin(a) * r, z);
        const sz = scale * (15 + 12 * u);
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "meteor",
    name: "Meteor Trail",
    loc: [121.2700, 24.1333], city: "Hehuanshan",
    tech: "A head glow sphere + a shrinking trail of glow spheres behind it + parabolic trajectory + respawn on landing",
    desc: "The head streaks diagonally while glow spheres are laid down along its history behind it. Set gravity to 0 for a bullet / missile; change the head color for a comet. An earlier version of this project's ship blips used a similar structure.",
    prompt: "At <b>[location]</b>, launch a <b>[white]</b> meteor from <b>[1500m]</b> altitude, <b>[25]</b> trail particles shrinking and fading, respawning on landing.",
    params: [
      { id: "speed", label: "Initial Speed", min: 100, max: 1500, step: 50, value: 700 },
      { id: "trailCount", label: "Trail Count", min: 5, max: 40, step: 1, value: 25 },
      { id: "headSize", label: "Head Diameter (m)", min: 50, max: 500, step: 10, value: 180 },
    ],
    build: (group) => {
      const head = new THREE.Group();
      const layers = [];
      const colors = [new THREE.Color(1,1,1), new THREE.Color(1, 0.85, 0.55)];
      for (let j = 0; j < 2; j++) {
        const geo = new THREE.IcosahedronGeometry(1, 1);
        const mat = new THREE.MeshBasicMaterial({
          color: colors[j], transparent: true, opacity: j === 0 ? 1 : 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const m = new THREE.Mesh(geo, mat);
        head.add(m);
        layers.push({ mesh: m, ratio: j === 0 ? 0.4 : 1.0 });
      }
      head.userData.layers = layers;
      group.add(head);
      const trail = [];
      for (let i = 0; i < 40; i++) {
        const geo = new THREE.IcosahedronGeometry(1, 0);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(1, 0.85, 0.55), transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const m = new THREE.Mesh(geo, mat);
        group.add(m);
        trail.push(m);
      }
      group.userData = { head, trail, history: [], x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, alive: false };
    },
    update: (group, dt, t, params, scale) => {
      const u = group.userData;
      const initSpeed = params.speed * scale;
      const G = -300 * scale;
      if (!u.alive || u.z < 0) {
        u.alive = true;
        u.x = -1500 * scale; u.y = 0; u.z = 1500 * scale;
        u.vx = initSpeed * 0.7; u.vy = 0; u.vz = -initSpeed * 0.3;
        u.history.length = 0;
      }
      u.vz += G * dt;
      u.x += u.vx * dt; u.y += u.vy * dt; u.z += u.vz * dt;
      u.history.unshift({ x: u.x, y: u.y, z: u.z });
      if (u.history.length > 40) u.history.length = 40;
      const headSize = params.headSize * scale * 0.5;
      u.head.position.set(u.x, u.y, Math.max(0, u.z));
      for (const { mesh, ratio } of u.head.userData.layers) {
        const s = headSize * ratio;
        mesh.scale.set(s, s, s);
      }
      const tailN = Math.round(params.trailCount);
      u.trail.forEach((m, i) => {
        if (i >= tailN || !u.history[i + 1]) { m.visible = false; return; }
        m.visible = true;
        const p = u.history[i + 1];
        m.position.set(p.x, p.y, Math.max(0, p.z));
        const fade = 1 - (i / tailN);
        const s = headSize * 0.6 * fade;
        m.scale.set(s, s, s);
        m.material.opacity = fade * 0.8;
      });
    },
  },

  {
    id: "galaxy",
    name: "Spiral Galaxy",
    loc: [120.4344, 24.0517], city: "Lukang",
    tech: "InstancedMesh particles distributed across 4 logarithmic spiral arms + differential rotation (fast inside, slow outside)",
    desc: "Particles are distributed on spiral arms, rotating faster on the inside and slower on the outside, forming a galactic swirl. Change the arm count for different galaxy types (2, 3, 4 arms). Add a glowing center sphere for a black hole.",
    prompt: "At <b>[location]</b>, float a <b>[2000m]</b>-wide <b>[800]</b>-particle spiral galaxy with <b>[4]</b> spiral arms, rotating faster inside and slower outside.",
    params: [
      { id: "count", label: "Count", min: 100, max: 1500, step: 50, value: 800 },
      { id: "radius", label: "Range (m)", min: 500, max: 4000, step: 100, value: 2000 },
      { id: "spin", label: "Rotation Speed", min: 0, max: 2, step: 0.05, value: 0.5 },
      { id: "dotSize", label: "Particle Size (m)", min: 5, max: 60, step: 1, value: 20 },
    ],
    build: (group) => {
      const N = 1500;
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const ARMS = 4;
      const parts = [];
      for (let i = 0; i < N; i++) {
        const arm = Math.floor(Math.random() * ARMS);
        const u = Math.random();
        const armOffset = (arm / ARMS) * Math.PI * 2;
        const angle = armOffset + u * 2.5;
        const r = 0.1 + u * 0.9;
        parts.push({
          r, angle,
          jitterX: (Math.random() - 0.5) * 0.06,
          jitterY: (Math.random() - 0.5) * 0.06,
          jitterZ: (Math.random() - 0.5) * 0.04,
          size: 0.4 + Math.random() * 1.5,
        });
      }
      group.add(inst);
      group.userData = { inst, parts, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, parts, N } = group.userData;
      const visible = Math.round(params.count);
      const r = params.radius * scale;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const p = parts[i];
        const angle = p.angle + t * params.spin * (1 / (p.r + 0.3));
        const x = Math.cos(angle) * p.r * r + p.jitterX * r;
        const y = Math.sin(angle) * p.r * r + p.jitterY * r;
        const z = p.jitterZ * r + 100 * scale;
        dummy.position.set(x, y, z);
        const sz = p.size * params.dotSize * scale;
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "snow",
    name: "Falling Particles (Snow / Rain)",
    loc: [121.5430, 24.4970], city: "Taipingshan",
    tech: "InstancedMesh particles fall continuously + respawn at the top after hitting the ground + sine-wave wind offset",
    desc: "Particles fall continuously from above and respawn at the top once they hit the ground. Change the color for rain, snow, ash, cherry blossom petals, or confetti. Wind is a sine-wave lateral sway.",
    prompt: "At <b>[location]</b>, <b>[1500m]</b> altitude within a <b>[2000m]</b> range, continuously drop <b>[600]</b> white snowflakes with a light side wind sway, respawning after landing.",
    params: [
      { id: "count", label: "Count", min: 100, max: 1500, step: 50, value: 700 },
      { id: "spread", label: "Range (m)", min: 500, max: 4000, step: 100, value: 2200 },
      { id: "altitude", label: "Altitude (m)", min: 500, max: 3500, step: 100, value: 1800 },
      { id: "speed", label: "Fall Speed", min: 0.05, max: 1.5, step: 0.05, value: 0.35 },
      { id: "wind", label: "Wind", min: 0, max: 1, step: 0.05, value: 0.25 },
    ],
    build: (group) => {
      const N = 1500;
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const states = [];
      for (let i = 0; i < N; i++) {
        states.push({
          x: (Math.random() - 0.5),
          y: (Math.random() - 0.5),
          z: Math.random(),
          phase: Math.random() * Math.PI * 2,
          speed: 0.5 + Math.random() * 0.7,
          size: 0.5 + Math.random() * 0.6,
        });
      }
      group.add(inst);
      group.userData = { inst, states, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, states, N } = group.userData;
      const visible = Math.round(params.count);
      const spread = params.spread * scale;
      const altMax = params.altitude * scale;
      const fall = params.speed;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const s = states[i];
        s.z -= fall * s.speed * dt;
        if (s.z < 0) s.z = 1;
        const wind = Math.sin(t * 0.3 + s.phase) * params.wind * 0.3;
        const x = (s.x + wind) * spread;
        const y = s.y * spread;
        const z = s.z * altMax;
        dummy.position.set(x, y, z);
        const sz = scale * 25 * s.size;
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "confetti",
    name: "Confetti",
    loc: [121.7733, 24.8237], city: "Jiaoxi",
    tech: "Multiple PlaneGeometry pieces each with their own color + independent rotation axes + gravity fall",
    desc: "Colored small planes fall while spinning on their own axes -- party confetti. Feels more 'floaty' than snow because a flat plane has area affected by wind. Expresses celebration, reward, or festivity.",
    prompt: "At <b>[location]</b>, <b>[1000m]</b> altitude, drift <b>[120]</b> colored rectangular confetti pieces within range, slowly spinning + drifting with the wind, respawning on landing.",
    params: [
      { id: "count", label: "Pieces", min: 30, max: 250, step: 10, value: 120 },
      { id: "spread", label: "Range (m)", min: 300, max: 3000, step: 100, value: 1500 },
      { id: "altitude", label: "Altitude (m)", min: 300, max: 2500, step: 100, value: 1300 },
    ],
    build: (group) => {
      const N = 250;
      const geo = new THREE.PlaneGeometry(1, 0.6);
      const palette = [0xff5b8a, 0x6cb8ff, 0xffd54f, 0x4cffa6, 0xff7eb6, 0xa080ff, 0xffa86c];
      const pieces = [];
      for (let i = 0; i < N; i++) {
        const mat = new THREE.MeshBasicMaterial({
          color: palette[i % palette.length],
          transparent: true, opacity: 0.95, side: THREE.DoubleSide,
        });
        const m = new THREE.Mesh(geo, mat);
        group.add(m);
        pieces.push({
          mesh: m,
          x: (Math.random() - 0.5),
          y: (Math.random() - 0.5),
          z: Math.random(),
          speed: 0.3 + Math.random() * 0.4,
          wobblePhase: Math.random() * Math.PI * 2,
          rotSpeedX: 0.5 + Math.random() * 2,
          rotSpeedY: 0.5 + Math.random() * 2,
        });
      }
      group.userData = { pieces, N };
    },
    update: (group, dt, t, params, scale) => {
      const visible = Math.round(params.count);
      const spread = params.spread * scale;
      const altMax = params.altitude * scale;
      group.userData.pieces.forEach((p, i) => {
        if (i >= visible) { p.mesh.visible = false; return; }
        p.mesh.visible = true;
        p.z -= p.speed * 0.15 * dt;
        if (p.z < 0) p.z = 1;
        const wobble = Math.sin(t * 0.8 + p.wobblePhase) * 0.05;
        p.mesh.position.set((p.x + wobble) * spread, p.y * spread, p.z * altMax);
        const sz = scale * 60;
        p.mesh.scale.set(sz, sz, 1);
        p.mesh.rotation.x = t * p.rotSpeedX;
        p.mesh.rotation.y = t * p.rotSpeedY;
      });
    },
  },

  {
    id: "vortex",
    name: "Black Hole Vortex",
    loc: [119.5000, 23.3582], city: "Wang'an",
    tech: "Dark center sphere + outer particles spiral inward + respawn at the outer edge on reaching the center",
    desc: "Particles spiral inward from the outer edge, get pulled into the center, then respawn at the edge -- black hole / vortex / drain. Dark center sphere + surrounding particles speed up as they approach it.",
    prompt: "At <b>[location]</b>, build a black hole with a <b>[1500m]</b> radius, <b>[400]</b> <b>[pink]</b> particles spiraling inward, dark core <b>[200m]</b>.",
    params: [
      { id: "count", label: "Count", min: 100, max: 800, step: 25, value: 450 },
      { id: "radius", label: "Range (m)", min: 500, max: 4000, step: 100, value: 1800 },
      { id: "coreSize", label: "Core (m)", min: 50, max: 600, step: 25, value: 250 },
      { id: "speed", label: "Suction Speed", min: 0.05, max: 1.5, step: 0.05, value: 0.3 },
    ],
    build: (group) => {
      const blackGeo = new THREE.SphereGeometry(1, 24, 16);
      const black = new THREE.Mesh(blackGeo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
      group.add(black);
      const N = 800;
      const geo = new THREE.IcosahedronGeometry(1, 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff7eb6, transparent: true, opacity: 0.85,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(geo, mat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const parts = [];
      for (let i = 0; i < N; i++) {
        parts.push({
          r0: 0.7 + Math.random() * 0.5,
          angle: Math.random() * Math.PI * 2,
          life: Math.random(),
        });
      }
      group.add(inst);
      group.userData = { inst, parts, N, black };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, parts, N, black } = group.userData;
      const visible = Math.round(params.count);
      const r = params.radius * scale;
      const cs = params.coreSize * scale;
      const speed = params.speed;
      black.scale.set(cs, cs, cs);
      black.position.z = cs;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const p = parts[i];
        p.life += dt * speed;
        if (p.life > 1) {
          p.life = 0;
          p.angle = Math.random() * Math.PI * 2;
          p.r0 = 0.7 + Math.random() * 0.5;
        }
        const currentR = p.r0 * (1 - p.life) * r;
        const currentAngle = p.angle + p.life * 8 + t * 0.5;
        dummy.position.set(Math.cos(currentAngle) * currentR, Math.sin(currentAngle) * currentR, cs * 0.5);
        const sz = scale * 35 * (1 - p.life * 0.4);
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "firework2",
    name: "Multi-stage Firework (Rise + Burst)",
    loc: [120.2900, 22.6122], city: "Cijin",
    tech: "Stage 1: rocket + trail rising; Stage 2: burst particles + gravity fall",
    desc: "More realistic than a single explosion: the rocket rises first -> bursts at the peak -> particles fall and fade -> relaunches with a new color. A complete lifecycle -- a festival fireworks show.",
    prompt: "At <b>[location]</b>, every <b>[3s]</b> cycle: rocket rises to <b>[800m]</b> (with trail) -> bursts into <b>[150]</b> particles -> fades out over 1.5s, random color each time.",
    params: [
      { id: "count", label: "Count", min: 30, max: 300, step: 10, value: 150 },
      { id: "speed", label: "Burst Speed", min: 100, max: 800, step: 25, value: 350 },
      { id: "peak", label: "Peak Height (m)", min: 200, max: 2500, step: 50, value: 900 },
      { id: "period", label: "Period (s)", min: 1.5, max: 8, step: 0.2, value: 3.5 },
    ],
    build: (group) => {
      const rocket = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 1,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
      );
      group.add(rocket);
      const trail = [];
      for (let i = 0; i < 15; i++) {
        const m = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1, 0),
          new THREE.MeshBasicMaterial({
            color: 0xffaa44, transparent: true, opacity: 0.6,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
        );
        group.add(m);
        trail.push(m);
      }
      const N = 300;
      const burstMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 1,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const inst = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), burstMat, N);
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const dirs = [];
      for (let i = 0; i < N; i++) {
        const theta = Math.acos(2 * Math.random() - 1);
        const phi = Math.random() * Math.PI * 2;
        dirs.push({
          x: Math.sin(theta) * Math.cos(phi),
          y: Math.sin(theta) * Math.sin(phi),
          z: Math.abs(Math.cos(theta)) * 0.5 + 0.5,
        });
      }
      group.add(inst);
      group.userData = { rocket, trail, inst, mat: burstMat, dirs, N, history: [], cycleStart: -10 };
    },
    update: (group, dt, t, params, scale) => {
      const u = group.userData;
      const cycle = params.period;
      const riseTime = cycle * 0.4;
      const burstDur = cycle * 0.6;
      const peak = params.peak * scale;
      if (t - u.cycleStart >= cycle) {
        u.cycleStart = t;
        u.mat.color.setHSL(Math.random(), 0.95, 0.6);
        u.history.length = 0;
      }
      const phase = t - u.cycleStart;
      const dummy = new THREE.Object3D();
      if (phase < riseTime) {
        u.rocket.visible = true;
        const rp = phase / riseTime;
        const z = peak * rp;
        u.rocket.position.set(0, 0, z);
        const sz = 35 * scale;
        u.rocket.scale.set(sz, sz, sz);
        u.history.unshift({ z });
        if (u.history.length > 15) u.history.length = 15;
        u.trail.forEach((m, i) => {
          if (!u.history[i + 1]) { m.visible = false; return; }
          m.visible = true;
          m.position.set(0, 0, u.history[i + 1].z);
          const fade = 1 - i / 15;
          const s = 28 * scale * fade;
          m.scale.set(s, s, s);
          m.material.opacity = fade * 0.8;
        });
        for (let i = 0; i < u.N; i++) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          u.inst.setMatrixAt(i, dummy.matrix);
        }
      } else {
        u.rocket.visible = false;
        u.trail.forEach((m) => (m.visible = false));
        const elapsed = phase - riseTime;
        const fade = Math.max(0, 1 - elapsed / burstDur);
        u.mat.opacity = fade;
        const speed = params.speed * scale;
        const G = -200 * scale;
        const visible = Math.round(params.count);
        for (let i = 0; i < u.N; i++) {
          if (i >= visible) {
            dummy.scale.set(0, 0, 0); dummy.updateMatrix();
            u.inst.setMatrixAt(i, dummy.matrix); continue;
          }
          const d = u.dirs[i];
          dummy.position.set(
            d.x * speed * elapsed,
            d.y * speed * elapsed,
            peak + d.z * speed * elapsed + 0.5 * G * elapsed * elapsed,
          );
          const sz = scale * 50 * fade;
          dummy.scale.set(sz, sz, sz);
          dummy.updateMatrix();
          u.inst.setMatrixAt(i, dummy.matrix);
        }
      }
      u.inst.count = u.N;
      u.inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "waterfall",
    name: "Waterfall",
    loc: [121.5512, 24.8625], city: "Wulai",
    tech: "InstancedMesh particles + accelerating fall (life-squared simulates gravity) + spreads wider going down",
    desc: "Particles fall continuously from a narrow region at the top, accelerating and spreading wider as they go down -- a waterfall. Change the color for lava or a mineral flow. The width parameter controls the volume of water.",
    prompt: "At <b>[location]</b>, drop <b>[500]</b> pale blue particles from <b>[1500m]</b> altitude, narrow at the top spreading out to <b>[600m]</b> wide at the bottom.",
    params: [
      { id: "count", label: "Count", min: 100, max: 1000, step: 25, value: 600 },
      { id: "width", label: "Width (m)", min: 50, max: 800, step: 25, value: 250 },
      { id: "height", label: "Height (m)", min: 300, max: 2500, step: 50, value: 1500 },
    ],
    build: (group) => {
      const N = 1000;
      const inst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        new THREE.MeshBasicMaterial({
          color: 0x9cdcff, transparent: true, opacity: 0.7,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
        N,
      );
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const states = [];
      for (let i = 0; i < N; i++) {
        states.push({
          x0: (Math.random() - 0.5) * 0.3,
          y0: (Math.random() - 0.5) * 0.05,
          life: Math.random(),
          speed: 0.4 + Math.random() * 0.5,
        });
      }
      group.add(inst);
      group.userData = { inst, states, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, states, N } = group.userData;
      const visible = Math.round(params.count);
      const w = params.width * scale;
      const h = params.height * scale;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const s = states[i];
        s.life += dt * s.speed * 0.5;
        if (s.life > 1) s.life = 0;
        const fall = s.life * s.life;
        const x = s.x0 * w * (1 + fall * 4);
        const y = s.y0 * w * (1 + fall * 2);
        const z = h * (1 - s.life);
        dummy.position.set(x, y, z);
        const sz = scale * 28;
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  {
    id: "starfield",
    name: "Star Field",
    loc: [120.6829, 23.9760], city: "Caotun",
    tech: "InstancedMesh distributed randomly over an upper hemisphere + sine-wave twinkle sizing",
    desc: "Random star points covering the sky overhead + a twinkle effect. Add an angular offset to see a Milky Way band. Switch to a lower hemisphere for bioluminescent sea creatures.",
    prompt: "At <b>[location]</b>, overhead scatter <b>[1200]</b> star points over a <b>[3000m radius]</b> hemisphere, each twinkling.",
    params: [
      { id: "count", label: "Star Count", min: 200, max: 1500, step: 50, value: 1200 },
      { id: "radius", label: "Radius (m)", min: 500, max: 5000, step: 100, value: 3500 },
    ],
    build: (group) => {
      const N = 1500;
      const inst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        new THREE.MeshBasicMaterial({
          color: 0xffffff, transparent: true, opacity: 0.8,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
        N,
      );
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const stars = [];
      for (let i = 0; i < N; i++) {
        const theta = Math.acos(Math.random());
        const phi = Math.random() * Math.PI * 2;
        stars.push({
          x: Math.sin(theta) * Math.cos(phi),
          y: Math.sin(theta) * Math.sin(phi),
          z: Math.cos(theta),
          twinkle: Math.random() * Math.PI * 2,
          size: 0.3 + Math.random() * 1.4,
        });
      }
      group.add(inst);
      group.userData = { inst, stars, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, stars, N } = group.userData;
      const visible = Math.round(params.count);
      const r = params.radius * scale;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const s = stars[i];
        dummy.position.set(s.x * r, s.y * r, s.z * r);
        const tw = 0.4 + 0.6 * Math.sin(t * 2 + s.twinkle);
        const sz = scale * 25 * s.size * tw;
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },

  // -- System Relations / Water Resources --

  {
    id: "cascade",
    name: "Cascade Release",
    loc: [121.0181, 23.8597], city: "Wujie",
    tech: "3-tier disc platforms + 3 InstancedMesh particle streams (each with a slight parabolic arc)",
    desc: "Water releases tier by tier from a 3-tier reservoir, top to bottom, with particles falling between each tier. Expresses cascading reservoirs, upstream/downstream relationships, cascading processing, or a waterfall pipeline.",
    prompt: "At <b>[location]</b>, lay out a <b>[3]</b>-tier cascade, each tier <b>[400m]</b> radius and <b>[200m]</b> tier height, particles falling tier by tier from top to bottom.",
    params: [
      { id: "radius", label: "Tier Radius (m)", min: 100, max: 1500, step: 25, value: 500 },
      { id: "tierHeight", label: "Tier Height (m)", min: 50, max: 800, step: 25, value: 250 },
    ],
    build: (group) => {
      const TIERS = 3;
      const tiers = [];
      for (let i = 0; i < TIERS; i++) {
        const geo = new THREE.CylinderGeometry(1, 1, 0.05, 32);
        geo.translate(0, 0.025, 0);
        geo.rotateX(Math.PI / 2);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          color: 0x6cb8ff, transparent: true, opacity: 0.4,
          side: THREE.DoubleSide, depthWrite: false,
        }));
        group.add(m);
        tiers.push(m);
      }
      const streams = [];
      for (let i = 0; i < TIERS; i++) {
        const N = 60;
        const inst = new THREE.InstancedMesh(
          new THREE.IcosahedronGeometry(1, 0),
          new THREE.MeshBasicMaterial({
            color: 0x9cdcff, transparent: true, opacity: 0.7,
            blending: THREE.AdditiveBlending, depthWrite: false,
          }),
          N,
        );
        inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        const states = [];
        for (let j = 0; j < N; j++) {
          states.push({
            x0: (Math.random() - 0.5) * 0.2,
            y0: (Math.random() - 0.5) * 0.05,
            life: Math.random(),
          });
        }
        group.add(inst);
        streams.push({ inst, states, N });
      }
      group.userData = { tiers, streams };
    },
    update: (group, dt, t, params, scale) => {
      const r = params.radius * scale;
      const tierH = params.tierHeight * scale;
      const TIERS = 3;
      const offset = r * 0.7;
      for (let i = 0; i < TIERS; i++) {
        const tier = group.userData.tiers[i];
        const x = (i - 1) * offset;
        const z = (TIERS - 1 - i) * tierH;
        tier.position.set(x, 0, z);
        tier.scale.set(r * (1 - i * 0.15), r * (1 - i * 0.15), 1);
      }
      const dummy = new THREE.Object3D();
      for (let s = 0; s < group.userData.streams.length; s++) {
        const stream = group.userData.streams[s];
        const fromX = (s - 1) * offset;
        const fromZ = (TIERS - 1 - s) * tierH;
        const toX = s * offset;
        const toZ = (TIERS - 2 - s) * tierH;
        for (let i = 0; i < stream.N; i++) {
          const st = stream.states[i];
          st.life += dt * 0.7;
          if (st.life > 1) st.life = 0;
          const phase = st.life;
          const x = fromX + (toX - fromX) * phase + st.x0 * r * 0.2;
          const z = fromZ + (toZ - fromZ) * phase - phase * (1 - phase) * tierH * 0.4;
          const y = st.y0 * r * 0.2;
          dummy.position.set(x, y, Math.max(0, z));
          const sz = scale * 25;
          dummy.scale.set(sz, sz, sz);
          dummy.updateMatrix();
          stream.inst.setMatrixAt(i, dummy.matrix);
        }
        stream.inst.count = stream.N;
        stream.inst.instanceMatrix.needsUpdate = true;
      }
    },
  },

  {
    id: "evap",
    name: "Evaporation Rise",
    loc: [120.8236, 24.4444], city: "Liyutan Reservoir",
    tech: "InstancedMesh particles rising slowly from a wide base + slight lateral drift + growing bigger going up",
    desc: "Particles rise slowly from a wide base surface with a slight drift -- water surface evaporation / heat dissipation / a scent drifting. Reverse of falling snow, more diffuse than a tornado, slower and softer than a fountain.",
    prompt: "At <b>[location]</b>, from a <b>[1500m]</b> wide base surface, slowly rise <b>[200]</b> fine particles up to <b>[800m]</b> high, fading and growing bigger the higher they go.",
    params: [
      { id: "count", label: "Count", min: 50, max: 400, step: 10, value: 200 },
      { id: "baseRadius", label: "Base Radius (m)", min: 200, max: 3000, step: 100, value: 1500 },
      { id: "maxHeight", label: "Height (m)", min: 200, max: 2500, step: 50, value: 800 },
      { id: "rise", label: "Rise Speed", min: 0.1, max: 2, step: 0.1, value: 0.6 },
    ],
    build: (group) => {
      const N = 400;
      const inst = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 0),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0.85, 0.92, 0.95),
          transparent: true, opacity: 0.5,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }),
        N,
      );
      inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const states = [];
      for (let i = 0; i < N; i++) {
        states.push({
          x0: (Math.random() - 0.5) * 2,
          y0: (Math.random() - 0.5) * 2,
          life: Math.random(),
          speed: 0.3 + Math.random() * 0.4,
          driftPhase: Math.random() * Math.PI * 2,
        });
      }
      group.add(inst);
      group.userData = { inst, states, N };
    },
    update: (group, dt, t, params, scale) => {
      const { inst, states, N } = group.userData;
      const visible = Math.round(params.count);
      const baseR = params.baseRadius * scale;
      const maxH = params.maxHeight * scale;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < N; i++) {
        if (i >= visible) {
          dummy.scale.set(0, 0, 0); dummy.updateMatrix();
          inst.setMatrixAt(i, dummy.matrix); continue;
        }
        const s = states[i];
        s.life += dt * params.rise * s.speed * 0.2;
        if (s.life > 1) s.life = 0;
        const drift = Math.sin(t * 0.3 + s.driftPhase) * 0.3;
        const x = s.x0 * baseR * (1 + s.life * 0.3) + drift * baseR * 0.1;
        const y = s.y0 * baseR * (1 + s.life * 0.3);
        const z = s.life * maxH;
        dummy.position.set(x, y, z);
        const sz = scale * 28 * (0.5 + s.life * 0.6);
        dummy.scale.set(sz, sz, sz);
        dummy.updateMatrix();
        inst.setMatrixAt(i, dummy.matrix);
      }
      inst.count = N;
      inst.instanceMatrix.needsUpdate = true;
    },
  },
];
