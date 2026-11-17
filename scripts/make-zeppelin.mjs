/**
 * Builds public/models/zeppelin.glb: a low-poly airship in Greenfield's colours, from three.js primitives.
 * Run with `node scripts/make-zeppelin.mjs` after changing it; the .glb is committed so the app needs nothing else.
 * Units are metres, nose toward +X. Built Y-up, then turned Z-up at the end: Mappedin reads model Z as up. About 34 m long, a third of a real blimp.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const L = 34; // envelope length
const R = 5.2; // envelope max radius

const COLORS = {
  envelope: [0.96, 0.97, 0.98],
  band: [0.06, 0.48, 0.33], // #0f7a55, the Greenfield green used across the app
  accent: [0.98, 0.78, 0.2],
  fin: [0.06, 0.48, 0.33],
  gondola: [0.17, 0.19, 0.24],
  window: [0.62, 0.82, 0.98],
  prop: [0.35, 0.37, 0.42],
};

/** Envelope radius at s in [0,1], tail (0) to nose (1): blunt nose, long taper to the tail. */
const radius = (s) => {
  const t = s < 0.62 ? Math.pow(s / 0.62, 0.85) : Math.sqrt(Math.max(0, 1 - Math.pow((s - 0.62) / 0.38, 2)));
  return R * Math.sin((t * Math.PI) / 2) ** 0.9;
};

/** One slice of the envelope, from s0 to s1, as a lathe along +X. */
function envelope(s0, s1, steps = 24) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const s = s0 + ((s1 - s0) * i) / steps;
    pts.push(new THREE.Vector2(Math.max(0.0001, radius(s)), s * L - L / 2));
  }
  const g = new THREE.LatheGeometry(pts, 32);
  g.rotateZ(-Math.PI / 2); // lathe axis Y -> X, s=1 at +X
  return g;
}

function fin(angle) {
  const shape = new THREE.Shape();
  // In the fin's own plane: x along the ship, y outward from the hull.
  shape.moveTo(0, 0);
  shape.lineTo(5.6, 0);
  shape.lineTo(2.2, 4.4);
  shape.lineTo(-0.6, 4.6);
  shape.lineTo(0, 0);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.35, bevelEnabled: false });
  g.translate(-L / 2 + 0.6, 1.2, -0.175);
  g.rotateX(angle);
  return g;
}

const parts = { envelope: [], band: [], accent: [], fin: [], gondola: [], window: [], prop: [] };
parts.envelope.push(envelope(0, 0.44), envelope(0.58, 1));
parts.band.push(envelope(0.44, 0.47), envelope(0.55, 0.58));
parts.accent.push(envelope(0.47, 0.55));
for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) parts.fin.push(fin(a));

// Gondola under the hull, a little ahead of the middle, with a window strip and two engines.
const gondola = new THREE.CapsuleGeometry(1.1, 5.5, 6, 16);
gondola.rotateZ(Math.PI / 2);
gondola.translate(2.5, -R - 0.6, 0);
parts.gondola.push(gondola);
const strut = new THREE.BoxGeometry(4, 1.2, 0.8);
strut.translate(2.5, -R + 0.3, 0);
parts.gondola.push(strut);
for (const z of [-1.12, 1.12]) {
  const win = new THREE.BoxGeometry(4.6, 0.55, 0.06);
  win.translate(2.7, -R - 0.45, z);
  parts.window.push(win);
}
for (const z of [-2.6, 2.6]) {
  const pod = new THREE.CylinderGeometry(0.45, 0.6, 2.2, 12);
  pod.rotateZ(Math.PI / 2);
  pod.translate(0.6, -R - 0.4, z);
  parts.gondola.push(pod);
  const arm = new THREE.BoxGeometry(0.4, 0.25, 1.5);
  arm.translate(0.8, -R - 0.4, z * 0.7);
  parts.gondola.push(arm);
  // Propeller as a flat cross behind the pod (static: the motion that matters is the ship's).
  for (const r of [0, Math.PI / 2]) {
    const blade = new THREE.BoxGeometry(0.08, 1.8, 0.22);
    blade.rotateX(r + Math.PI / 4);
    blade.translate(-0.6, -R - 0.4, z);
    parts.prop.push(blade);
  }
}

// --- Minimal GLB writer: one mesh, one primitive per colour. ---
const chunks = [];
let byteLength = 0;
const bufferViews = [];
const accessors = [];
function addView(typed, target) {
  const pad = (4 - (byteLength % 4)) % 4;
  if (pad) {
    chunks.push(new Uint8Array(pad));
    byteLength += pad;
  }
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: typed.byteLength, target });
  chunks.push(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
  byteLength += typed.byteLength;
  return bufferViews.length - 1;
}
function addAccessor(typed, type, componentType, target, minmax) {
  const view = addView(typed, target);
  const size = type === 'VEC3' ? 3 : 1;
  const acc = { bufferView: view, componentType, count: typed.length / size, type };
  if (minmax) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < typed.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], typed[i + k]);
      max[k] = Math.max(max[k], typed[i + k]);
    }
    Object.assign(acc, { min, max });
  }
  accessors.push(acc);
  return accessors.length - 1;
}

const materials = [];
const primitives = [];
for (const [name, list] of Object.entries(parts)) {
  if (!list.length) continue;
  const g = mergeGeometries(list.map((x) => (x.index ? x.toNonIndexed() : x)), false);
  g.rotateX(Math.PI / 2); // Y-up -> Z-up (gondola down, nose still +X)
  g.computeVertexNormals();
  const pos = new Float32Array(g.attributes.position.array);
  const nor = new Float32Array(g.attributes.normal.array);
  const idx = new Uint32Array(pos.length / 3).map((_, i) => i);
  materials.push({
    name,
    pbrMetallicRoughness: { baseColorFactor: [...COLORS[name], 1], metallicFactor: name === 'prop' ? 0.4 : 0, roughnessFactor: name === 'window' ? 0.2 : 0.65 },
    doubleSided: name === 'fin' || name === 'prop',
  });
  primitives.push({
    attributes: { POSITION: addAccessor(pos, 'VEC3', 5126, 34962, true), NORMAL: addAccessor(nor, 'VEC3', 5126, 34962) },
    indices: addAccessor(idx, 'SCALAR', 5125, 34963),
    material: materials.length - 1,
  });
}

const json = {
  asset: { version: '2.0', generator: 'greenfield make-zeppelin.mjs' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'zeppelin', mesh: 0 }],
  meshes: [{ name: 'zeppelin', primitives }],
  materials,
  accessors,
  bufferViews,
  buffers: [{ byteLength }],
};

const bin = new Uint8Array(byteLength + ((4 - (byteLength % 4)) % 4));
let o = 0;
for (const c of chunks) {
  bin.set(c, o);
  o += c.byteLength;
}
let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
const jpad = (4 - (jsonBytes.length % 4)) % 4;
jsonBytes = new Uint8Array([...jsonBytes, ...new Array(jpad).fill(0x20)]);
const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
const out = new Uint8Array(total);
const dv = new DataView(out.buffer);
dv.setUint32(0, 0x46546c67, true); // 'glTF'
dv.setUint32(4, 2, true);
dv.setUint32(8, total, true);
dv.setUint32(12, jsonBytes.length, true);
dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
out.set(jsonBytes, 20);
const b = 20 + jsonBytes.length;
dv.setUint32(b, bin.length, true);
dv.setUint32(b + 4, 0x004e4942, true); // 'BIN\0'
out.set(bin, b + 8);

mkdirSync(new URL('../public/models/', import.meta.url), { recursive: true });
writeFileSync(new URL('../public/models/zeppelin.glb', import.meta.url), out);
console.log(`zeppelin.glb: ${(total / 1024).toFixed(0)} KB, ${primitives.length} primitives`);
