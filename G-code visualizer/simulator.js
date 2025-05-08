let stockMesh, stockMaterial, currentScene;

window.initStock = function(scene, config = {}) {
  const {
    stockWidth = 100,
    stockHeight = 20,
    stockDepth = 100,
    stockColor = 0x888888
  } = config;

  currentScene = scene;

  const geometry = new THREE.BoxGeometry(stockWidth, stockHeight, stockDepth);
  stockMaterial = new THREE.MeshPhongMaterial({ color: stockColor });
  stockMesh = new THREE.Mesh(geometry, stockMaterial);

  // Position the stock so the bottom is at Y=0
  stockMesh.position.set(stockWidth / 2, stockHeight / 2, stockDepth / 2);
  scene.add(stockMesh);
};

window.simulateCutPaths = function(paths, config = {}) {
  const {
    toolRadius = 2,
    cutDepth = 0.5
  } = config;

  if (!stockMesh || !currentScene) return;
  let stockCSG = CSG.fromMesh(stockMesh);

  for (const path of paths) {
    if (path.type !== 'cut') continue;

    const from = path.from;
    const to = path.to;

    const vector = new THREE.Vector3(
      to.x - from.x,
      to.y - from.y,
      to.z - from.z
    );
    const distance = vector.length();
    const direction = vector.clone().normalize();

    // Create a cylinder to represent the cutting volume
    const cutterGeometry = new THREE.CylinderGeometry(
      toolRadius, toolRadius,
      distance + 0.01, // tiny extension to ensure clean subtraction
      12
    );
    const cutter = new THREE.Mesh(cutterGeometry, stockMaterial.clone());

    // Position the cutter at midpoint
    const mid = new THREE.Vector3(
      (from.x + to.x) / 2,
      (from.y + to.y) / 2,
      (from.z + to.z) / 2
    );
    cutter.position.copy(mid);

    // Orient cutter along path
    cutter.lookAt(to.x, to.y, to.z);
    cutter.rotateX(Math.PI / 2); // align cylinder axis to path

    const cutterCSG = CSG.fromMesh(cutter);
    stockCSG = stockCSG.subtract(cutterCSG);
  }

  const newMesh = CSG.toMesh(stockCSG, stockMesh.matrix, stockMaterial);
  currentScene.remove(stockMesh);
  stockMesh = newMesh;
  currentScene.add(stockMesh);
};
