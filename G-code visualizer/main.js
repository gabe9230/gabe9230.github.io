const canvas = document.getElementById('viewerCanvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

const camera = new THREE.PerspectiveCamera(45, canvas.width / canvas.height, 1, 1000);
camera.position.set(150, 150, 150);
camera.lookAt(0, 0, 0);

// Controls
const controls = controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

// Lighting
const ambient = new THREE.AmbientLight(0x404040);
const dir = new THREE.DirectionalLight(0xffffff, 1);
dir.position.set(100, 200, 100);
scene.add(ambient, dir);

// Handle canvas resize
function resizeRenderer() {
  const h = window.innerHeight - document.getElementById('controls').offsetHeight;
  canvas.width = window.innerWidth;
  canvas.height = h;
  renderer.setSize(canvas.width, canvas.height);
  camera.aspect = canvas.width / canvas.height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer();

// Init stock
window.resetView = function() {
  while (scene.children.length > 0) scene.remove(scene.children[0]);
  scene.add(ambient, dir);
  initStock(scene, {
    stockWidth: 100,
    stockHeight: 20,
    stockDepth: 100,
    stockColor: 0x888888
  });
  controls.reset();
};
resetView();

// Render loop
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// G-code load and simulate
document.getElementById('gcodeInput').addEventListener('change', async function (e) {
  const file = e.target.files[0];
  if (!file) return;
  const text = await file.text();
  const paths = parseGCode(text);
  simulateCutPaths(paths, {
    toolRadius: 2,
    cutDepth: 0.5
  });
});
