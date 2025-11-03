const BACKGROUND_COLOR = 0x111111;
const RAPID_COLOR = 0x3ba1ff;
const CUT_COLOR = 0xff5533;
const STOCK_COLOR = 0x888888;
const TOOL_DEFAULT_DIAMETER = 0.25;
const MAX_VOXELS_PER_AXIS = 1024;
const MIN_VOXELS_PER_AXIS = 1;
const MAX_TOTAL_VOXELS = 16000000;
const FINE_VOXEL_SIZE_MM = 1;
const COARSE_VOXEL_SIZE_MM = 5;
const FINE_MARGIN_MM = 6;

function createEmptyBounds() {
    return {
        minX: Infinity,
        maxX: -Infinity,
        minY: Infinity,
        maxY: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity
    };
}

function expandBounds(bounds, point) {
    if (!Number.isFinite(bounds.minX)) {
        bounds.minX = bounds.maxX = point.x;
        bounds.minY = bounds.maxY = point.y;
        bounds.minZ = bounds.maxZ = point.z;
        return;
    }
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxY = Math.max(bounds.maxY, point.y);
    bounds.minZ = Math.min(bounds.minZ, point.z);
    bounds.maxZ = Math.max(bounds.maxZ, point.z);
}

function expandBoundsWithRadius(bounds, point, radius) {
    const r = Math.max(0, radius);
    if (!Number.isFinite(bounds.minX)) {
        bounds.minX = point.x - r;
        bounds.maxX = point.x + r;
        bounds.minY = point.y - r;
        bounds.maxY = point.y + r;
        return;
    }
    bounds.minX = Math.min(bounds.minX, point.x - r);
    bounds.maxX = Math.max(bounds.maxX, point.x + r);
    bounds.minY = Math.min(bounds.minY, point.y - r);
    bounds.maxY = Math.max(bounds.maxY, point.y + r);
    bounds.minZ = Math.min(bounds.minZ, point.z - r);
    bounds.maxZ = Math.max(bounds.maxZ, point.z + r);
}

function boundsValid(bounds) {
    return Number.isFinite(bounds.minX) &&
        Number.isFinite(bounds.maxX) &&
        Number.isFinite(bounds.minY) &&
        Number.isFinite(bounds.maxY) &&
        Number.isFinite(bounds.minZ) &&
        Number.isFinite(bounds.maxZ);
}

function boundsCenter(bounds) {
    return {
        x: (bounds.minX + bounds.maxX) * 0.5,
        y: (bounds.minY + bounds.maxY) * 0.5,
        z: (bounds.minZ + bounds.maxZ) * 0.5
    };
}

function boundsDimensions(bounds) {
    return {
        x: bounds.maxX - bounds.minX,
        y: bounds.maxY - bounds.minY,
        z: bounds.maxZ - bounds.minZ
    };
}

function gcodeToWorldVector3(point) {
    return new THREE.Vector3(point.x, point.z, point.y);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function clearGroup(group) {
    const children = [...group.children];
    for (const child of children) {
        group.remove(child);
        disposeChild(child);
    }
}

function disposeChild(child) {
    if (child.children && child.children.length) {
        clearGroup(child);
    }
    if (child.geometry && typeof child.geometry.dispose === 'function') {
        child.geometry.dispose();
    }
    if (Array.isArray(child.material)) {
        for (const material of child.material) {
            disposeMaterial(material);
        }
    } else if (child.material) {
        disposeMaterial(child.material);
    }
    if (child.texture && typeof child.texture.dispose === 'function') {
        child.texture.dispose();
    }
}

function disposeMaterial(material) {
    if (material.map && typeof material.map.dispose === 'function') {
        material.map.dispose();
    }
    if (typeof material.dispose === 'function') {
        material.dispose();
    }
}

class VoxelStock {
    constructor(bounds, resolution) {
        this.bounds = bounds;
        this.resolution = {
            x: Math.max(1, Math.floor(resolution.x)),
            y: Math.max(1, Math.floor(resolution.y)),
            z: Math.max(1, Math.floor(resolution.z))
        };

        const size = boundsDimensions(bounds);
        this.size = {
            x: size.x > 0 ? size.x : 1,
            y: size.y > 0 ? size.y : 1,
            z: size.z > 0 ? size.z : 1
        };

        this.cellSize = {
            x: this.size.x / this.resolution.x,
            y: this.size.y / this.resolution.y,
            z: this.size.z / this.resolution.z
        };

        this.cellDiagonal = Math.sqrt(
            this.cellSize.x * this.cellSize.x +
            this.cellSize.y * this.cellSize.y +
            this.cellSize.z * this.cellSize.z
        );

        const total = this.resolution.x * this.resolution.y * this.resolution.z;
        this.data = new Uint8Array(total);
        this.data.fill(1);
    }

    index(ix, iy, iz) {
        return ix + this.resolution.x * (iy + this.resolution.y * iz);
    }

    voxelCenter(ix, iy, iz) {
        return {
            x: this.bounds.minX + (ix + 0.5) * this.cellSize.x,
            y: this.bounds.minY + (iy + 0.5) * this.cellSize.y,
            z: this.bounds.minZ + (iz + 0.5) * this.cellSize.z
        };
    }

    carveSegment(start, end, radius) {
        if (!(radius > 0)) {
            return;
        }

        const dirX = end.x - start.x;
        const dirY = end.y - start.y;
        const dirZ = end.z - start.z;
        const lengthSq = dirX * dirX + dirY * dirY + dirZ * dirZ;

        if (lengthSq < 1e-12) {
            this.carveSphereAtPoint(start, radius);
            return;
        }

        const radiusPad = radius + this.cellDiagonal * 0.5;
        const radiusPadSq = radiusPad * radiusPad;

        const minX = Math.min(start.x, end.x) - radiusPad;
        const maxX = Math.max(start.x, end.x) + radiusPad;
        const minY = Math.min(start.y, end.y) - radiusPad;
        const maxY = Math.max(start.y, end.y) + radiusPad;
        const minZ = Math.min(start.z, end.z) - radiusPad;
        const maxZ = Math.max(start.z, end.z) + radiusPad;

        const ixMin = clamp(Math.floor((minX - this.bounds.minX) / this.cellSize.x), 0, this.resolution.x - 1);
        const ixMax = clamp(Math.floor((maxX - this.bounds.minX) / this.cellSize.x), 0, this.resolution.x - 1);
        const iyMin = clamp(Math.floor((minY - this.bounds.minY) / this.cellSize.y), 0, this.resolution.y - 1);
        const iyMax = clamp(Math.floor((maxY - this.bounds.minY) / this.cellSize.y), 0, this.resolution.y - 1);
        const izMin = clamp(Math.floor((minZ - this.bounds.minZ) / this.cellSize.z), 0, this.resolution.z - 1);
        const izMax = clamp(Math.floor((maxZ - this.bounds.minZ) / this.cellSize.z), 0, this.resolution.z - 1);

        const lengthInv = 1 / lengthSq;

        for (let iz = izMin; iz <= izMax; iz++) {
            const centerZ = this.bounds.minZ + (iz + 0.5) * this.cellSize.z;
            for (let iy = iyMin; iy <= iyMax; iy++) {
                const centerY = this.bounds.minY + (iy + 0.5) * this.cellSize.y;
                for (let ix = ixMin; ix <= ixMax; ix++) {
                    const idx = this.index(ix, iy, iz);
                    if (this.data[idx] === 0) continue;

                    const centerX = this.bounds.minX + (ix + 0.5) * this.cellSize.x;

                    const toStartX = centerX - start.x;
                    const toStartY = centerY - start.y;
                    const toStartZ = centerZ - start.z;

                    const projection = (toStartX * dirX + toStartY * dirY + toStartZ * dirZ) * lengthInv;
                    const t = clamp(projection, 0, 1);

                    const closestX = start.x + dirX * t;
                    const closestY = start.y + dirY * t;
                    const closestZ = start.z + dirZ * t;

                    const diffX = centerX - closestX;
                    const diffY = centerY - closestY;
                    const diffZ = centerZ - closestZ;
                    const distSq = diffX * diffX + diffY * diffY + diffZ * diffZ;

                    if (distSq <= radiusPadSq) {
                        this.data[idx] = 0;
                    }
                }
            }
        }
    }

    carveSphereAtPoint(center, radius) {
        const radiusPad = radius + this.cellDiagonal * 0.5;
        const radiusPadSq = radiusPad * radiusPad;

        const minX = clamp(Math.floor((center.x - radiusPad - this.bounds.minX) / this.cellSize.x), 0, this.resolution.x - 1);
        const maxX = clamp(Math.floor((center.x + radiusPad - this.bounds.minX) / this.cellSize.x), 0, this.resolution.x - 1);
        const minY = clamp(Math.floor((center.y - radiusPad - this.bounds.minY) / this.cellSize.y), 0, this.resolution.y - 1);
        const maxY = clamp(Math.floor((center.y + radiusPad - this.bounds.minY) / this.cellSize.y), 0, this.resolution.y - 1);
        const minZ = clamp(Math.floor((center.z - radiusPad - this.bounds.minZ) / this.cellSize.z), 0, this.resolution.z - 1);
        const maxZ = clamp(Math.floor((center.z + radiusPad - this.bounds.minZ) / this.cellSize.z), 0, this.resolution.z - 1);

        for (let iz = minZ; iz <= maxZ; iz++) {
            const centerZ = this.bounds.minZ + (iz + 0.5) * this.cellSize.z;
            for (let iy = minY; iy <= maxY; iy++) {
                const centerY = this.bounds.minY + (iy + 0.5) * this.cellSize.y;
                for (let ix = minX; ix <= maxX; ix++) {
                    const idx = this.index(ix, iy, iz);
                    if (this.data[idx] === 0) continue;

                    const centerX = this.bounds.minX + (ix + 0.5) * this.cellSize.x;

                    const dx = centerX - center.x;
                    const dy = centerY - center.y;
                    const dz = centerZ - center.z;
                    const distSq = dx * dx + dy * dy + dz * dz;

                    if (distSq <= radiusPadSq) {
                        this.data[idx] = 0;
                    }
                }
            }
        }
    }

    clearRegion(region) {
        const ixMin = clamp(Math.floor((region.minX - this.bounds.minX) / this.cellSize.x), 0, this.resolution.x - 1);
        const ixMax = clamp(Math.floor((region.maxX - this.bounds.minX) / this.cellSize.x), 0, this.resolution.x - 1);
        const iyMin = clamp(Math.floor((region.minY - this.bounds.minY) / this.cellSize.y), 0, this.resolution.y - 1);
        const iyMax = clamp(Math.floor((region.maxY - this.bounds.minY) / this.cellSize.y), 0, this.resolution.y - 1);
        const izMin = clamp(Math.floor((region.minZ - this.bounds.minZ) / this.cellSize.z), 0, this.resolution.z - 1);
        const izMax = clamp(Math.floor((region.maxZ - this.bounds.minZ) / this.cellSize.z), 0, this.resolution.z - 1);

        if (ixMax < ixMin || iyMax < iyMin || izMax < izMin) return;

        for (let iz = izMin; iz <= izMax; iz++) {
            for (let iy = iyMin; iy <= iyMax; iy++) {
                for (let ix = ixMin; ix <= ixMax; ix++) {
                    const idx = this.index(ix, iy, iz);
                    this.data[idx] = 0;
                }
            }
        }
    }

    isFilled(ix, iy, iz) {
        if (ix < 0 || iy < 0 || iz < 0) return false;
        if (ix >= this.resolution.x || iy >= this.resolution.y || iz >= this.resolution.z) return false;
        return this.data[this.index(ix, iy, iz)] !== 0;
    }

    buildMesh(color = STOCK_COLOR, opacity = 0.85) {
        const positions = [];
        const normals = [];
        const indices = [];

        const hx = this.cellSize.x * 0.5;
        const hy = this.cellSize.y * 0.5;
        const hz = this.cellSize.z * 0.5;

        const pushFace = (cornerList, normal) => {
            const worldNormal = {
                x: normal.x,
                y: normal.z,
                z: normal.y
            };

            for (const corner of cornerList) {
                const world = gcodeToWorldVector3(corner);
                positions.push(world.x, world.y, world.z);
                normals.push(worldNormal.x, worldNormal.y, worldNormal.z);
            }

            const base = (positions.length / 3) - 4;
            indices.push(
                base,
                base + 1,
                base + 2,
                base,
                base + 2,
                base + 3
            );
        };

        for (let iz = 0; iz < this.resolution.z; iz++) {
            for (let iy = 0; iy < this.resolution.y; iy++) {
                for (let ix = 0; ix < this.resolution.x; ix++) {
                    if (!this.isFilled(ix, iy, iz)) continue;

                    const center = this.voxelCenter(ix, iy, iz);
                    const minX = center.x - hx;
                    const maxX = center.x + hx;
                    const minY = center.y - hy;
                    const maxY = center.y + hy;
                    const minZ = center.z - hz;
                    const maxZ = center.z + hz;

                    if (!this.isFilled(ix + 1, iy, iz)) {
                        pushFace([
                            { x: maxX, y: minY, z: minZ },
                            { x: maxX, y: minY, z: maxZ },
                            { x: maxX, y: maxY, z: maxZ },
                            { x: maxX, y: maxY, z: minZ }
                        ], { x: 1, y: 0, z: 0 });
                    }
                    if (!this.isFilled(ix - 1, iy, iz)) {
                        pushFace([
                            { x: minX, y: minY, z: maxZ },
                            { x: minX, y: minY, z: minZ },
                            { x: minX, y: maxY, z: minZ },
                            { x: minX, y: maxY, z: maxZ }
                        ], { x: -1, y: 0, z: 0 });
                    }
                    if (!this.isFilled(ix, iy + 1, iz)) {
                        pushFace([
                            { x: minX, y: maxY, z: minZ },
                            { x: maxX, y: maxY, z: minZ },
                            { x: maxX, y: maxY, z: maxZ },
                            { x: minX, y: maxY, z: maxZ }
                        ], { x: 0, y: 1, z: 0 });
                    }
                    if (!this.isFilled(ix, iy - 1, iz)) {
                        pushFace([
                            { x: minX, y: minY, z: maxZ },
                            { x: maxX, y: minY, z: maxZ },
                            { x: maxX, y: minY, z: minZ },
                            { x: minX, y: minY, z: minZ }
                        ], { x: 0, y: -1, z: 0 });
                    }
                    if (!this.isFilled(ix, iy, iz + 1)) {
                        pushFace([
                            { x: minX, y: minY, z: maxZ },
                            { x: minX, y: maxY, z: maxZ },
                            { x: maxX, y: maxY, z: maxZ },
                            { x: maxX, y: minY, z: maxZ }
                        ], { x: 0, y: 0, z: 1 });
                    }
                    if (!this.isFilled(ix, iy, iz - 1)) {
                        pushFace([
                            { x: maxX, y: minY, z: minZ },
                            { x: maxX, y: maxY, z: minZ },
                            { x: minX, y: maxY, z: minZ },
                            { x: minX, y: minY, z: minZ }
                        ], { x: 0, y: 0, z: -1 });
                    }
                }
            }
        }

        if (indices.length === 0) {
            return null;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setIndex(indices);
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const material = new THREE.MeshStandardMaterial({
            color,
            transparent: opacity < 1,
            opacity,
            metalness: 0.05,
            roughness: 0.9
        });

        return new THREE.Mesh(geometry, material);
    }
}

class GCodeViewer {
    constructor(container) {
        this.container = container;

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio || 1);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setClearColor(BACKGROUND_COLOR, 1);
        container.appendChild(this.renderer.domElement);

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(BACKGROUND_COLOR);

        this.camera = new THREE.PerspectiveCamera(
            60,
            window.innerWidth / window.innerHeight,
            0.1,
            5000
        );
        this.camera.position.set(150, 150, 150);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.target.set(0, 0, 0);

        const ambient = new THREE.AmbientLight(0xffffff, 0.45);
        const keyLight = new THREE.DirectionalLight(0xffffff, 0.75);
        keyLight.position.set(120, 200, 90);
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
        fillLight.position.set(-80, 150, -120);
        this.scene.add(ambient, keyLight, fillLight);

        const grid = new THREE.GridHelper(400, 40, 0x555555, 0x333333);
        grid.material.transparent = true;
        grid.material.opacity = 0.25;
        this.scene.add(grid);

        const axes = new THREE.AxesHelper(50);
        axes.material.depthTest = false;
        axes.renderOrder = 1;
        this.scene.add(axes);

        this.stockGroup = new THREE.Group();
        this.scene.add(this.stockGroup);

        this.pathGroup = new THREE.Group();
        this.scene.add(this.pathGroup);

        this.toolHead = new THREE.Mesh(
            new THREE.SphereGeometry(1.5, 18, 12),
            new THREE.MeshBasicMaterial({ color: 0xffff3f })
        );
        this.toolHead.visible = false;
        this.scene.add(this.toolHead);

        this.paths = [];
        this.tools = new Map();
        this.currentTool = 1;
        this.toolDiameter = TOOL_DEFAULT_DIAMETER;
        this.isMetric = true;
        this.stockBuffer = 1.0;
        this.stockZBuffer = 0.5;

        this.bounds = createEmptyBounds();
        this.stockBounds = createEmptyBounds();
        this.coarseStock = null;
        this.fineStock = null;

        this.animate = this.animate.bind(this);
        this.onResize = this.onResize.bind(this);

        window.addEventListener('resize', this.onResize);
        this.animate();
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(this.animate);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    resetView() {
        if (boundsValid(this.bounds)) {
            const center = boundsCenter(this.bounds);
            const dimensions = boundsDimensions(this.bounds);
            const maxSize = Math.max(dimensions.x, dimensions.y, dimensions.z);
            const distance = Math.max(100, maxSize * 2.25);
            const worldCenter = gcodeToWorldVector3(center);
            this.controls.target.copy(worldCenter);
            this.camera.position.set(
                worldCenter.x + distance,
                worldCenter.y + distance * 0.9,
                worldCenter.z + distance
            );
        } else {
            this.controls.target.set(0, 0, 0);
            this.camera.position.set(150, 150, 150);
        }
        this.controls.update();
    }

    parseGCode(gcode) {
        this.paths = [];
        this.tools.clear();
        this.currentTool = 1;
        this.toolDiameter = TOOL_DEFAULT_DIAMETER;
        this.isMetric = true;
        this.bounds = createEmptyBounds();
        this.stockBounds = createEmptyBounds();
        this.coarseStock = null;
        this.fineStock = null;

        let absoluteMode = true;
        let currentPos = { x: 0, y: 0, z: 0 };

        expandBounds(this.bounds, currentPos);
        expandBoundsWithRadius(this.stockBounds, currentPos, this.toolDiameter * 0.5);

        const lines = gcode.split(/\r?\n/);

        for (const rawLine of lines) {
            this.parseToolInfo(rawLine);

            const cleaned = rawLine.replace(/;.*|\(.*?\)/g, '').trim().toUpperCase();
            if (!cleaned) continue;

            if (cleaned.includes('G20')) this.isMetric = false;
            if (cleaned.includes('G21')) this.isMetric = true;
            if (cleaned.includes('G90')) absoluteMode = true;
            if (cleaned.includes('G91')) absoluteMode = false;

            const toolMatch = cleaned.match(/\bT(\d+)\b/);
            if (toolMatch) {
                const toolNumber = parseInt(toolMatch[1], 10);
                if (!Number.isNaN(toolNumber)) {
                    this.currentTool = toolNumber;
                    const toolInfo = this.tools.get(toolNumber);
                    if (toolInfo && toolInfo.diameter > 0) {
                        this.toolDiameter = toolInfo.diameter;
                    }
                }
            }

            const motionMatch = cleaned.match(/\bG0?0\b|\bG0?1\b|\bG2\b|\bG3\b/);
            let motionCode = null;
            if (motionMatch) {
                const rawCode = motionMatch[0];
                motionCode = rawCode === 'G00' ? 'G0' :
                    rawCode === 'G01' ? 'G1' : rawCode;
            }

            const x = this.extractCoord(cleaned, 'X');
            const y = this.extractCoord(cleaned, 'Y');
            const z = this.extractCoord(cleaned, 'Z');
            const i = this.extractCoord(cleaned, 'I');
            const j = this.extractCoord(cleaned, 'J');
            const k = this.extractCoord(cleaned, 'K');

            const nextPos = {
                x: x !== null ? (absoluteMode ? x : currentPos.x + x) : currentPos.x,
                y: y !== null ? (absoluteMode ? y : currentPos.y + y) : currentPos.y,
                z: z !== null ? (absoluteMode ? z : currentPos.z + z) : currentPos.z
            };

            expandBounds(this.bounds, nextPos);

            if (!motionCode) {
                currentPos = nextPos;
                continue;
            }

            if (motionCode === 'G0') {
                this.paths.push({
                    type: 'rapid',
                    from: { ...currentPos },
                    to: { ...nextPos },
                    toolDiameter: this.toolDiameter
                });
            } else if (motionCode === 'G1') {
                this.paths.push({
                    type: 'cut',
                    from: { ...currentPos },
                    to: { ...nextPos },
                    toolDiameter: this.toolDiameter
                });
                expandBoundsWithRadius(this.stockBounds, currentPos, this.toolDiameter * 0.5);
                expandBoundsWithRadius(this.stockBounds, nextPos, this.toolDiameter * 0.5);
            } else if (motionCode === 'G2' || motionCode === 'G3') {
                const clockwise = motionCode === 'G2';
                const center = {
                    x: currentPos.x + (i ?? 0),
                    y: currentPos.y + (j ?? 0),
                    z: currentPos.z + (k ?? 0)
                };

                const endPos = { ...nextPos };
                if (x === null && y === null) {
                    endPos.x = currentPos.x;
                    endPos.y = currentPos.y;
                }

                const arcPoints = this.calculateArcPoints(
                    currentPos,
                    endPos,
                    center,
                    clockwise
                );

                if (arcPoints.length > 1) {
                    for (let idx = 0; idx < arcPoints.length - 1; idx++) {
                        const from = arcPoints[idx];
                        const to = arcPoints[idx + 1];
                        this.paths.push({
                            type: 'cut',
                            from,
                            to,
                            toolDiameter: this.toolDiameter
                        });
                        expandBoundsWithRadius(this.stockBounds, from, this.toolDiameter * 0.5);
                        expandBoundsWithRadius(this.stockBounds, to, this.toolDiameter * 0.5);
                        expandBounds(this.bounds, from);
                        expandBounds(this.bounds, to);
                    }
                }
            }

            currentPos = nextPos;
        }

        this.updateSceneAfterParsing(currentPos);
    }

    updateSceneAfterParsing(finalPos) {
        clearGroup(this.pathGroup);
        clearGroup(this.stockGroup);
        this.toolHead.visible = false;

        if (!this.paths.length) {
            this.resetView();
            return;
        }

        this.buildToolPaths();

        const coarseEnvelope = this.createCoarseEnvelope();
        const coarseResolution = this.estimateVoxelResolution(coarseEnvelope, this.getCoarseVoxelSize());
        this.coarseStock = new VoxelStock(coarseEnvelope, coarseResolution);

        const hasCuts = this.paths.some((path) => path.type === 'cut');
        let fineEnvelope = null;
        let includeCoarseMesh = true;

        if (hasCuts) {
            fineEnvelope = this.createFineEnvelope(coarseEnvelope);
            const fineResolution = this.estimateVoxelResolution(fineEnvelope, this.getFineVoxelSize());
            this.fineStock = new VoxelStock(fineEnvelope, fineResolution);

            const fineDistinct =
                fineEnvelope.minX > coarseEnvelope.minX ||
                fineEnvelope.maxX < coarseEnvelope.maxX ||
                fineEnvelope.minY > coarseEnvelope.minY ||
                fineEnvelope.maxY < coarseEnvelope.maxY ||
                fineEnvelope.minZ > coarseEnvelope.minZ ||
                fineEnvelope.maxZ < coarseEnvelope.maxZ;

            if (fineDistinct) {
                this.coarseStock.clearRegion(fineEnvelope);
            } else {
                includeCoarseMesh = false;
            }

            for (const path of this.paths) {
                if (path.type !== 'cut') continue;
                this.fineStock.carveSegment(
                    path.from,
                    path.to,
                    (path.toolDiameter ?? this.toolDiameter) * 0.5
                );
            }

            const fineMesh = this.fineStock.buildMesh(STOCK_COLOR, 0.9);
            if (fineMesh) {
                this.stockGroup.add(fineMesh);
            }

            const fineOutline = this.buildStockOutline(fineEnvelope, 0xff8844, 0.18);
            if (fineOutline) {
                this.stockGroup.add(fineOutline);
            }
        }

        if (includeCoarseMesh) {
            const coarseOpacity = hasCuts ? 0.35 : 0.55;
            const coarseMesh = this.coarseStock.buildMesh(STOCK_COLOR, coarseOpacity);
            if (coarseMesh) {
                this.stockGroup.add(coarseMesh);
            }
        }

        const coarseOutline = this.buildStockOutline(coarseEnvelope, 0x555555, 0.12);
        if (coarseOutline) {
            this.stockGroup.add(coarseOutline);
        }

        if (finalPos) {
            const worldPos = gcodeToWorldVector3(finalPos);
            this.toolHead.position.copy(worldPos);
            this.toolHead.visible = true;
        }

        this.resetView();
    }

    buildToolPaths() {
        if (!this.paths.length) return;

        const positions = [];
        const colors = [];

        const rapidColor = new THREE.Color(RAPID_COLOR);
        const cutColor = new THREE.Color(CUT_COLOR);

        for (const path of this.paths) {
            const start = gcodeToWorldVector3(path.from);
            const end = gcodeToWorldVector3(path.to);
            positions.push(
                start.x, start.y, start.z,
                end.x, end.y, end.z
            );

            const color = path.type === 'cut' ? cutColor : rapidColor;
            colors.push(
                color.r, color.g, color.b,
                color.r, color.g, color.b
            );
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute(
            'position',
            new THREE.Float32BufferAttribute(positions, 3)
        );
        geometry.setAttribute(
            'color',
            new THREE.Float32BufferAttribute(colors, 3)
        );

        const material = new THREE.LineBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.95
        });

        const segments = new THREE.LineSegments(geometry, material);
        this.pathGroup.add(segments);
    }

    buildStockOutline(bounds, color = 0x777777, opacity = 0.2) {
        if (!boundsValid(bounds)) return null;
        const minWorld = gcodeToWorldVector3({
            x: bounds.minX,
            y: bounds.minY,
            z: bounds.minZ
        });
        const maxWorld = gcodeToWorldVector3({
            x: bounds.maxX,
            y: bounds.maxY,
            z: bounds.maxZ
        });

        const box = new THREE.Box3(minWorld, maxWorld);
        const helper = new THREE.Box3Helper(box, color);
        if (Array.isArray(helper.material)) {
            helper.material.forEach((mat) => {
                mat.transparent = true;
                mat.opacity = opacity;
                mat.depthTest = false;
            });
        } else if (helper.material) {
            helper.material.transparent = true;
            helper.material.opacity = opacity;
            helper.material.depthTest = false;
        }
        helper.renderOrder = 2;
        return helper;
    }

    createCoarseEnvelope() {
        const base = boundsValid(this.bounds) ? this.bounds : {
            minX: -this.stockBuffer,
            maxX: this.stockBuffer,
            minY: -this.stockBuffer,
            maxY: this.stockBuffer,
            minZ: -this.stockZBuffer,
            maxZ: this.stockZBuffer
        };

        const xyBuffer = Math.max(this.stockBuffer, this.getCoarseVoxelSize() * 2);
        const zBuffer = Math.max(this.stockZBuffer, this.getCoarseVoxelSize() * 2);

        return {
            minX: base.minX - xyBuffer,
            maxX: base.maxX + xyBuffer,
            minY: base.minY - xyBuffer,
            maxY: base.maxY + xyBuffer,
            minZ: base.minZ - zBuffer,
            maxZ: base.maxZ + zBuffer
        };
    }

    createFineEnvelope(coarseEnvelope) {
        if (!boundsValid(this.stockBounds)) {
            return { ...coarseEnvelope };
        }

        const margin = this.getFineMargin();

        const result = {
            minX: Math.max(coarseEnvelope.minX, this.stockBounds.minX - margin),
            maxX: Math.min(coarseEnvelope.maxX, this.stockBounds.maxX + margin),
            minY: Math.max(coarseEnvelope.minY, this.stockBounds.minY - margin),
            maxY: Math.min(coarseEnvelope.maxY, this.stockBounds.maxY + margin),
            minZ: Math.max(coarseEnvelope.minZ, this.stockBounds.minZ - margin),
            maxZ: Math.min(coarseEnvelope.maxZ, this.stockBounds.maxZ + margin)
        };

        if (result.minX >= result.maxX ||
            result.minY >= result.maxY ||
            result.minZ >= result.maxZ) {
            return { ...coarseEnvelope };
        }

        return result;
    }

    estimateVoxelResolution(bounds, targetSize) {
        if (!(targetSize > 0)) targetSize = 1;
        const dimensions = boundsDimensions(bounds);

        const requested = {
            x: dimensions.x > 0 ? Math.ceil(dimensions.x / targetSize) : 1,
            y: dimensions.y > 0 ? Math.ceil(dimensions.y / targetSize) : 1,
            z: dimensions.z > 0 ? Math.ceil(dimensions.z / targetSize) : 1
        };

        let resolution = {
            x: clamp(requested.x, MIN_VOXELS_PER_AXIS, MAX_VOXELS_PER_AXIS),
            y: clamp(requested.y, MIN_VOXELS_PER_AXIS, MAX_VOXELS_PER_AXIS),
            z: clamp(requested.z, MIN_VOXELS_PER_AXIS, MAX_VOXELS_PER_AXIS)
        };

        let total = resolution.x * resolution.y * resolution.z;
        if (total > MAX_TOTAL_VOXELS) {
            const scale = Math.cbrt(total / MAX_TOTAL_VOXELS);
            resolution = {
                x: clamp(Math.max(1, Math.round(resolution.x / scale)), MIN_VOXELS_PER_AXIS, MAX_VOXELS_PER_AXIS),
                y: clamp(Math.max(1, Math.round(resolution.y / scale)), MIN_VOXELS_PER_AXIS, MAX_VOXELS_PER_AXIS),
                z: clamp(Math.max(1, Math.round(resolution.z / scale)), MIN_VOXELS_PER_AXIS, MAX_VOXELS_PER_AXIS)
            };
        }

        return resolution;
    }

    getFineVoxelSize() {
        return this.isMetric ? FINE_VOXEL_SIZE_MM : (FINE_VOXEL_SIZE_MM / 25.4);
    }

    getCoarseVoxelSize() {
        return this.isMetric ? COARSE_VOXEL_SIZE_MM : (COARSE_VOXEL_SIZE_MM / 25.4);
    }

    getFineMargin() {
        const toolPad = Math.max(this.toolDiameter, this.getFineVoxelSize() * 4);
        const baseMargin = this.isMetric ? FINE_MARGIN_MM : (FINE_MARGIN_MM / 25.4);
        return Math.max(toolPad, baseMargin);
    }

    parseToolInfo(line) {
        const toolMatch = line.match(/\(TOOL:\s*T?(\d+)?\s+((\d+(\.\d+)?|\d+\/\d+))\s+([A-Z]+)/i);
        if (!toolMatch) return;

        const toolNum = parseInt(toolMatch[1] || '1', 10);
        const dimStr = toolMatch[2].trim();
        const description = toolMatch[5].trim();

        const diameter = this.parseDimension(dimStr);
        if (Number.isFinite(diameter) && diameter > 0) {
            this.tools.set(toolNum, {
                diameter,
                description
            });
        }
    }

    extractCoord(line, axis) {
        const match = line.match(new RegExp(`${axis}(-?\\d*\\.?\\d+)`));
        return match ? parseFloat(match[1]) : null;
    }

    parseDimension(dimStr) {
        if (dimStr.includes('/')) {
            const [num, denom] = dimStr.split('/');
            const numerator = parseFloat(num);
            const denominator = parseFloat(denom);
            if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
                return NaN;
            }
            return numerator / denominator;
        }
        return parseFloat(dimStr);
    }

    calculateArcPoints(start, end, center, clockwise) {
        const radius = Math.hypot(start.x - center.x, start.y - center.y);
        if (!(radius > 0)) {
            return [start, end];
        }

        let startAngle = Math.atan2(start.y - center.y, start.x - center.x);
        let endAngle = Math.atan2(end.y - center.y, end.x - center.x);

        if (clockwise && endAngle >= startAngle) {
            endAngle -= Math.PI * 2;
        } else if (!clockwise && endAngle <= startAngle) {
            endAngle += Math.PI * 2;
        }

        const angleDiff = endAngle - startAngle;
        const arcLength = Math.abs(angleDiff) * radius;
        const segments = clamp(Math.ceil(arcLength / Math.max(radius * 0.25, 0.5)), 12, 90);

        const points = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const angle = startAngle + angleDiff * t;
            points.push({
                x: center.x + radius * Math.cos(angle),
                y: center.y + radius * Math.sin(angle),
                z: start.z + (end.z - start.z) * t
            });
        }

        points[0] = { ...start };
        points[points.length - 1] = { ...end };
        return points;
    }
}

const viewer = new GCodeViewer(document.body);

function showLoading(show) {
    const controls = document.getElementById('controls');
    if (!controls) return;
    let loading = document.getElementById('loading');
    if (show) {
        if (!loading) {
            loading = document.createElement('div');
            loading.id = 'loading';
            loading.textContent = 'Processing G-code...';
            loading.style.color = '#fff';
            loading.style.marginLeft = '10px';
            controls.appendChild(loading);
        }
    } else if (loading) {
        loading.remove();
    }
}

const fileInput = document.getElementById('fileInput');
if (fileInput) {
    fileInput.addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        showLoading(true);
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                viewer.parseGCode(e.target?.result || '');
            } catch (error) {
                console.error('Error processing G-code:', error);
                alert('Error processing G-code file. See console for details.');
            } finally {
                showLoading(false);
            }
        };
        reader.onerror = () => {
            alert('Error reading file');
            showLoading(false);
        };
        reader.readAsText(file);
    });
}

const resetButton = document.getElementById('resetViewBtn');
if (resetButton) {
    resetButton.addEventListener('click', () => {
        viewer.resetView();
    });
}
