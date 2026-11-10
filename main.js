import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import GUI from 'lil-gui';

const MODELO = './casa.glb';      // archivo por defecto (junto a index.html)
const PREFIJO = 'foco';           // objetos de luz que empiezan con este nombre
const MAX_LUCES_REALES = 6;       // luces reales que iluminan la fachada
const MOVIL = matchMedia('(pointer: coarse)').matches || innerWidth < 700;

// ---------- Escena base ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const CALIDAD = { baja: 0.75, media: 1, alta: Math.min(devicePixelRatio, 2) };
renderer.setPixelRatio(MOVIL ? 0.85 : CALIDAD.media);   // en celular arranca más ligero
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const glx = renderer.getContext(), dbg = glx.getExtension('WEBGL_debug_renderer_info');
const GPU = dbg ? glx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'GPU desconocida';
const stats = Object.assign(document.createElement('div'), {});
stats.style.cssText = 'position:fixed;right:max(12px,env(safe-area-inset-right));bottom:max(12px,env(safe-area-inset-bottom));font:12px/1.4 system-ui;color:#9aa6bd;text-align:right;pointer-events:none;max-width:60vw';
document.body.appendChild(stats);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05070d);
scene.fog = new THREE.FogExp2(0x05070d, 0.02);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
camera.position.set(9, 4, 12);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = true; controls.screenSpacePanning = true;
controls.maxPolarAngle = Math.PI * 0.495;

const hemi = new THREE.HemisphereLight(0x405080, 0x0a0a12, 0.25);
const luna = new THREE.DirectionalLight(0x9db4ff, 1.8);
luna.castShadow = true;
luna.shadow.mapSize.set(1024, 1024);
luna.shadow.bias = -0.0004;
luna.shadow.normalBias = 0.08;
scene.add(hemi, luna, luna.target);
const sol = { centro: new THREE.Vector3(), r: 20 };
function aplicarLuna() {
  const az = THREE.MathUtils.degToRad(params.azimut), el = THREE.MathUtils.degToRad(params.elevacion);
  const d = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
  luna.position.copy(sol.centro).addScaledVector(d, sol.r * 1.5);
  luna.target.position.copy(sol.centro);
  const c = luna.shadow.camera, h = sol.r * 0.55;
  c.left = -h; c.right = h; c.top = h; c.bottom = -h; c.near = 0.5; c.far = sol.r * 4;
  c.updateProjectionMatrix();
  luna.color.set(params.colorLuna); luna.intensity = params.luna; luna.castShadow = params.sombras;
}

const suelo = new THREE.Mesh(new THREE.CircleGeometry(80, 48),
  new THREE.MeshStandardMaterial({ color: 0x0c1018, roughness: 1 }));
suelo.rotation.x = -Math.PI / 2;
scene.add(suelo);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.9, 0.6, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const world = new THREE.Group();   // modelo actual
const fx = new THREE.Group();      // focos, halos, luces reales
scene.add(world, fx);

// ---------- Halos (1 draw call) ----------
const haloMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uPx: { value: 500 }, uSize: { value: 0.9 } },
  vertexShader: `
    attribute vec3 aCol; varying vec3 vC; uniform float uPx, uSize;
    void main(){ vC = aCol; vec4 mv = modelViewMatrix*vec4(position,1.);
      gl_PointSize = uSize*uPx/-mv.z; gl_Position = projectionMatrix*mv; }`,
  fragmentShader: `
    varying vec3 vC;
    void main(){ float d = length(gl_PointCoord-.5)*2.; float a = pow(max(1.-d,0.),2.6);
      gl_FragColor = vec4(vC, a*.6); }`
});

// ---------- Patrones ----------
const PATRONES = ['fijo', 'parpadeo', 'pulso', 'secuencia', 'arcoiris'];
const tmp = new THREE.Color();
function nivel(g, i, t) {
  const n = g.idx.length, s = g.vel;
  switch (g.patron) {
    case 'parpadeo':  return Math.sin(t * s * 6) > 0 ? 1 : 0.06;
    case 'pulso':     return 0.55 + 0.45 * Math.sin(t * s * 3);
    case 'secuencia': { const ph = (((t * s * 0.5 - i / n) % 1) + 1) % 1; return ph < 0.25 ? 1 : 0.08; }
    default:          return 1;
  }
}

// ---------- Extracción de luces ----------
let grupos = [], bulbs, halos, haloCol, gui, reales = [];
const params = { bloom: 0.9, exposicion: 1, ambiente: 0.25, luna: 1.8, colorLuna: '#9db4ff', azimut: 70, elevacion: 45, sombras: true, calidad: 'media', autoCalidad: true, bloomOn: true, halo: 0.9, brillo: 3, lucesReales: true, luzFachada: 15 };

function limpiar() {
  [...world.children].forEach(o => world.remove(o));
  [...fx.children].forEach(o => { o.geometry?.dispose(); fx.remove(o); });
  grupos = []; reales = [];
  gui?.destroy();
}

function usarModelo(root) {
  limpiar();
  const luces = [];
  root.traverse(o => { if (o.isLight) luces.push(o); });   // incluye el Sol de Blender, que llega con intensidad enorme
  const dl = luces.find(l => l.isDirectionalLight);
  if (dl) {   // usa la dirección del Sol de Blender como punto de partida
    const q = new THREE.Quaternion(); dl.getWorldQuaternion(q);
    const v = new THREE.Vector3(0, 0, -1).applyQuaternion(q).negate();   // hacia la luz
    params.azimut = Math.round(THREE.MathUtils.radToDeg(Math.atan2(v.x, v.z)));
    params.elevacion = Math.round(THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.asin(v.y)), 10, 80));
  }
  root.traverse(o => {
    if (!o.isMesh) return;
    o.receiveShadow = true; o.castShadow = true;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    ms.forEach((m, i) => {
      if (m.transmission > 0 || /cristal|glass|vidrio/i.test(m.name)) {   // vidrio barato: sin transmisión, no proyecta sombra
        ms[i] = new THREE.MeshStandardMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.25, roughness: 0.1, depthWrite: false });
        o.castShadow = false;
      }
    });
    o.material = Array.isArray(o.material) ? ms : ms[0];
  });
  const datos = luces.filter(l => l.isPointLight || l.isSpotLight).map(l => {
    const p = new THREE.Vector3(); l.getWorldPosition(p);
    return { nombre: l.name, pos: p, color: l.color.clone() };
  });
  luces.forEach(l => l.removeFromParent());       // fuera luces reales del glTF
  world.add(root);

  const filtrados = datos.filter(d => d.nombre.startsWith(PREFIJO));
  const lista = filtrados.length ? filtrados : datos;
  const mapa = new Map();
  lista.forEach(d => {
    const g = d.nombre.startsWith(PREFIJO) ? (d.nombre.split(/[_.]/)[1] || 'todos') : (d.nombre.replace(/[._ ]?\d+$/, '') || 'luces');   // foco_techo_01 -> techo; Spot.001 -> Spot
    if (!mapa.has(g)) mapa.set(g, { nombre: g, idx: [], patron: 'fijo', vel: 1, inten: 1, color: '#' + d.color.getHexString() });
    const gr = mapa.get(g); gr.idx.push(d); 
  });
  grupos = [...mapa.values()];

  const total = lista.length;
  if (total) {
    bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.06, 10, 8),
      new THREE.MeshBasicMaterial(), total);
    const posArr = new Float32Array(total * 3);
    let k = 0;
    grupos.forEach(g => g.idx.forEach(d => {
      d.k = k; bulbs.setMatrixAt(k, new THREE.Matrix4().setPosition(d.pos));
      d.pos.toArray(posArr, k * 3); k++;
    }));
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    haloCol = new THREE.BufferAttribute(new Float32Array(total * 3), 3);
    hg.setAttribute('aCol', haloCol);
    halos = new THREE.Points(hg, haloMat);
    halos.frustumCulled = false;
    fx.add(bulbs, halos);
    // luces reales: una por foco si son pocas; si no, una por grupo (en su centro)
    const pocas = lista.length <= MAX_LUCES_REALES;
    const fuentes = pocas
      ? lista.map(d => ({ g: grupos.find(x => x.idx.includes(d)), ds: [d], pos: d.pos }))
      : grupos.map(g => { const c = new THREE.Vector3(); g.idx.forEach(d => c.add(d.pos)); return { g, ds: g.idx, pos: c.divideScalar(g.idx.length) }; });
    fuentes.slice(0, MAX_LUCES_REALES).forEach(f => {
      const L = new THREE.PointLight(0xffffff, 0, 16, 2); L.position.copy(f.pos);
      fx.add(L); reales.push({ ...f, L });
    });
  }

  // encuadrar cámara
  const box = new THREE.Box3().setFromObject(root);
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length();
  if (isFinite(r) && r > 0) {
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(0.7, 0.35, 1).multiplyScalar(r * 0.9));
    controls.minDistance = r * 0.12; controls.maxDistance = r * 3;
    suelo.position.y = box.min.y - 0.01; suelo.receiveShadow = true;
    sol.centro.copy(c); sol.r = r;
    scene.fog.density = 0.6 / Math.max(r * 3, 1);
  }
  aplicarLuna();
  armarGUI();
  msg(total ? `${total} focos en ${grupos.length} grupos` : 'No encontré luces (usa Point/Spot con nombre foco_grupo_01)');
}

function armarGUI() {
  gui = new GUI({ title: 'Iluminación', width: Math.min(260, innerWidth - 24) });
  gui.add(params, 'bloom', 0, 2, 0.05).name('Resplandor').onChange(v => bloom.strength = v);
  gui.add(params, 'halo', 0, 3, 0.05).name('Tamaño halo').onChange(v => haloMat.uniforms.uSize.value = v);
  gui.add(params, 'brillo', 0.5, 8, 0.1).name('Brillo focos');
  gui.add(params, 'exposicion', 0.3, 2.5, 0.05).name('Exposición').onChange(v => renderer.toneMappingExposure = v);
  gui.add(params, 'ambiente', 0, 1, 0.01).name('Luz ambiente').onChange(v => hemi.intensity = v);
  const fl = gui.addFolder('Luna / sol');
  fl.add(params, 'luna', 0, 6, 0.1).name('Intensidad').onChange(aplicarLuna);
  fl.addColor(params, 'colorLuna').name('Color').onChange(aplicarLuna);
  fl.add(params, 'azimut', -180, 180, 1).name('Dirección').onChange(aplicarLuna);
  fl.add(params, 'elevacion', 5, 85, 1).name('Altura').onChange(aplicarLuna);
  fl.add(params, 'sombras').name('Sombras').onChange(aplicarLuna);
  gui.add(params, 'calidad', Object.keys(CALIDAD)).name('Calidad').onChange(v => {
    params.autoCalidad = false; setRatio(CALIDAD[v]);
  });
  gui.add(params, 'autoCalidad').name('Calidad automática');
  gui.add(params, 'bloomOn').name('Resplandor (bloom)').onChange(v => bloom.enabled = v);
  gui.add(params, 'lucesReales').name('Luz sobre fachada');
  gui.add(params, 'luzFachada', 0, 60, 0.5).name('Fuerza luz fachada');
  grupos.forEach(g => {
    const f = gui.addFolder(`${g.nombre} (${g.idx.length})`); f.close();
    f.add(g, 'patron', PATRONES).name('Patrón');
    f.addColor(g, 'color').name('Color');
    f.add(g, 'inten', 0, 2, 0.05).name('Intensidad');
    f.add(g, 'vel', 0.2, 4, 0.1).name('Velocidad');
  });
  if (innerWidth < 700) gui.close();
}

// ---------- Animación ----------
const col = new THREE.Color();
function animar(t) {
  grupos.forEach(g => {
    let suma = 0;
    g.idx.forEach((d, i) => {
      const f = nivel(g, i, t) * g.inten;
      suma += f; d.f = f;
      if (g.patron === 'arcoiris') col.setHSL(((t * g.vel * 0.1 + i / g.idx.length) % 1), 1, 0.55);
      else col.set(g.color);
      d.rgb = (d.rgb || new THREE.Color()).copy(col);
      tmp.copy(col).multiplyScalar(f * params.brillo);
      bulbs.setColorAt(d.k, tmp);
      haloCol.setXYZ(d.k, tmp.r * .35, tmp.g * .35, tmp.b * .35);
    });
    g.media = suma / g.idx.length; g.col = col.clone();
  });
  if (bulbs) { bulbs.instanceColor.needsUpdate = true; haloCol.needsUpdate = true; }
  reales.forEach(({ g, ds, L }) => {
    let f = 0; ds.forEach(d => f += d.f); f /= ds.length;
    L.color.set(g.patron === 'arcoiris' ? ds[0].rgb : g.color);
    L.intensity = params.lucesReales ? f * params.luzFachada : 0;
  });
}

// ---------- Carga ----------
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
async function cargarURL(url) {
  msg('Cargando modelo…');
  const gltf = await loader.loadAsync(url);
  usarModelo(gltf.scene);
}
function casaDemo() {
  const g = new THREE.Group();
  const m = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const cuerpo = new THREE.Mesh(new THREE.BoxGeometry(8, 3.5, 5), m(0xb8b2a6)); cuerpo.position.y = 1.75;
  const techo = new THREE.Mesh(new THREE.ConeGeometry(6, 2, 4), m(0x4a2f2a)); techo.rotation.y = Math.PI / 4; techo.position.y = 4.5; techo.scale.z = 0.7;
  const puerta = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.1), m(0x2b1b14)); puerta.position.set(0, 1.1, 2.55);
  g.add(cuerpo, techo, puerta);
  for (let i = 0; i < 12; i++) { const l = new THREE.PointLight(0xffd9a0); l.name = `foco_techo_${i}`; l.position.set(-4 + i * 0.73, 3.55, 2.6); g.add(l); }
  for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0x66aaff); l.name = `foco_puerta_${i}`; const a = (i / 7) * Math.PI; l.position.set(Math.cos(a) * 0.9, 1.4 + Math.sin(a) * 1.1, 2.62); g.add(l); }
  return g;
}
const msgEl = document.getElementById('msg');
function msg(t) { msgEl.textContent = t + (MOVIL ? ' · 1 dedo gira, 2 dedos acercan' : ''); }

const fileEl = document.getElementById('file');
document.getElementById('pick').onclick = () => fileEl.click();
fileEl.onchange = () => fileEl.files[0] && cargarURL(URL.createObjectURL(fileEl.files[0])).catch(e => msg('Error: ' + e.message));
const dropEl = document.getElementById('drop');
addEventListener('dragover', e => { e.preventDefault(); dropEl.style.display = 'grid'; });
addEventListener('dragleave', e => { if (!e.relatedTarget) dropEl.style.display = 'none'; });
addEventListener('drop', e => {
  e.preventDefault(); dropEl.style.display = 'none';
  const f = e.dataTransfer.files[0]; if (f) cargarURL(URL.createObjectURL(f)).catch(er => msg('Error: ' + er.message));
});

function setRatio(v) { renderer.setPixelRatio(v); composer.setPixelRatio(v); ajustar(); }
function ajustar() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h); composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  haloMat.uniforms.uPx.value = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}
addEventListener('resize', ajustar);
addEventListener('orientationchange', () => setTimeout(ajustar, 200));
screen.orientation?.addEventListener?.('change', () => setTimeout(ajustar, 200));
ajustar();

let nf = 0, t0 = performance.now(), bajos = 0;
renderer.setAnimationLoop(t => {
  controls.update(); animar(t / 1000); composer.render();
  if (++nf === 60) {
    const ahora = performance.now(), fps = 60000 / (ahora - t0); nf = 0; t0 = ahora;
    const i = renderer.info.render;
    // si va por debajo de 40 fps de forma sostenida, baja la resolución (mínimo 0.5)
    bajos = fps < 40 ? bajos + 1 : 0;
    if (params.autoCalidad && bajos >= 2 && renderer.getPixelRatio() > 0.5) { setRatio(Math.max(0.5, renderer.getPixelRatio() * 0.8)); bajos = 0; }
    stats.innerHTML = MOVIL ? `${fps.toFixed(0)} fps` : `${fps.toFixed(0)} fps · res ${renderer.getPixelRatio().toFixed(2)} · ${i.calls} draws · ${(i.triangles / 1000).toFixed(0)}k tris<br>${GPU}`;
  }
});

try { await cargarURL(MODELO); }
catch { usarModelo(casaDemo()); msg('Mostrando casa de ejemplo. Pon tu casa.glb junto a index.html o arrástralo aquí.'); }