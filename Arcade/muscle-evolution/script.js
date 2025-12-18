"use strict";

(() => {
    // ---------- DOM references ----------
    const canvas = document.getElementById("world");
    const ctx = canvas.getContext("2d");
    const miniMap = document.getElementById("mini-map");
    const miniCtx = miniMap ? miniMap.getContext("2d") : null;

    const modeButtons = {
        add: document.getElementById("mode-add"),
        connect: document.getElementById("mode-connect"),
        connectBone: document.getElementById("mode-bone"),
        anchor: document.getElementById("mode-anchor"),
        delete: document.getElementById("mode-delete"),
    };

    const clearButton = document.getElementById("clear-build");
    const runButton = document.getElementById("run-evolution");
    const stopButton = document.getElementById("stop-evolution");
    const exportButton = document.getElementById("export-creature");
    const importButton = document.getElementById("import-creature");
    const toggleGhostsButton = document.getElementById("toggle-ghosts");

    const nodeCountEl = document.getElementById("node-count");
    const muscleCountEl = document.getElementById("muscle-count");
    const bestDistanceEl = document.getElementById("best-distance");
    const generationEl = document.getElementById("generation");
    const activeModeEl = document.getElementById("active-mode");
    const statusLine = document.getElementById("status-line");
    const logEl = document.getElementById("log");

    // ---------- Builder state ----------
    const MAX_NODES = 20;
    const DESIGN_NODE_RADIUS = 14;
    const BUILD_AREA = { left: -220, right: 220, top: -160, bottom: 160 };
    const BUILD_MARGIN = 18;
    const BUILDER_MARGIN = 30;
    const SIM_SCALE = 0.2;
    const SIM_NODE_RADIUS = DESIGN_NODE_RADIUS * SIM_SCALE;
    const FRAMES_PER_STEP = 10; // 10% speed
    const MUSCLE_SCREEN_WIDTH = 6;
    const NODE_SCREEN_RADIUS = MUSCLE_SCREEN_WIDTH;
    const COURSE_LENGTH = 1200;
    const COURSE_MIN_Y = 200;
    const COURSE_MAX_Y = 460;
    const BUILDER_ZOOM = 2.6;
    const RUN_ZOOM = canvas.width / COURSE_LENGTH;
    const DEFAULT_CAMERA_X = (BUILD_AREA.left + BUILD_AREA.right) / 2;
    const DEFAULT_CAMERA_Y = (BUILD_AREA.top + BUILD_AREA.bottom) / 2;
    const RUN_CAMERA_Y = (COURSE_MIN_Y + COURSE_MAX_Y) / 2;
    const ZOOM_LERP = 0.12;

    const builder = {
        nodes: [],
        links: [],
        mode: "add",
        dragging: null,
        dragOffset: { x: 0, y: 0 },
        pendingConnection: null,
        hoverNode: null,
        isDraggingCanvas: false,
    };

    const view = {
        zoom: BUILDER_ZOOM,
        targetZoom: BUILDER_ZOOM,
        cameraX: DEFAULT_CAMERA_X,
        cameraY: DEFAULT_CAMERA_Y,
        mode: "build",
    };

    // ---------- Evolution state ----------
    const evolution = {
        running: false,
        stopRequested: false,
        bestDistance: 0,
        generation: 0,
        populationSize: 50,
        maxGenerations: 28,
        latestLog: [],
    };

    const uiState = {
        showAllGhosts: false,
    };

    // ---------- Utility helpers ----------
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const randBetween = (min, max) => min + Math.random() * (max - min);
    const randChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

    function worldToScreen(x, y, customView = view) {
        return {
            x: (x - customView.cameraX) * customView.zoom + canvas.width / 2,
            y: (y - customView.cameraY) * customView.zoom + canvas.height / 2,
        };
    }

    function screenToWorld(x, y, customView = view) {
        return {
            x: (x - canvas.width / 2) / customView.zoom + customView.cameraX,
            y: (y - canvas.height / 2) / customView.zoom + customView.cameraY,
        };
    }

    function updateViewZoom(customView = view) {
        const delta = customView.targetZoom - customView.zoom;
        if (Math.abs(delta) < 0.0005) {
            customView.zoom = customView.targetZoom;
        } else {
            customView.zoom += delta * ZOOM_LERP;
        }
    }

    function getMuscleScreenWidth() {
        return MUSCLE_SCREEN_WIDTH;
    }

    const clampBuildX = (x) =>
        clamp(x, BUILD_AREA.left + BUILD_MARGIN, BUILD_AREA.right - BUILD_MARGIN);
    const clampBuildY = (y) =>
        clamp(y, BUILD_AREA.top + BUILD_MARGIN, BUILD_AREA.bottom - BUILD_MARGIN);

    

    function drawTerrainForView(context, customView = view, wipe = true) {
        if (wipe) {
            const grad = context.createLinearGradient(0, 0, 0, canvas.height);
            grad.addColorStop(0, "#0e1726");
            grad.addColorStop(0.6, "#080b12");
            grad.addColorStop(1, "#05070d");
            context.fillStyle = grad;
            context.fillRect(0, 0, canvas.width, canvas.height);
        }
        const step = Math.max(6, Math.round(18 / customView.zoom));
        context.beginPath();
        context.moveTo(0, canvas.height);
        for (let sx = 0; sx <= canvas.width + step; sx += step) {
            const wx = screenToWorld(sx, 0, customView).x;
            const wy = getTerrainHeight(wx);
            const screen = worldToScreen(wx, wy, customView);
            context.lineTo(sx, screen.y);
        }
        context.lineTo(canvas.width, canvas.height);
        context.closePath();
        const groundGrad = context.createLinearGradient(
            0,
            canvas.height - 120,
            0,
            canvas.height
        );
        groundGrad.addColorStop(0, "rgba(46, 57, 78, 0.9)");
        groundGrad.addColorStop(1, "rgba(18, 24, 36, 0.95)");
        context.fillStyle = groundGrad;
        context.fill();
        context.strokeStyle = "rgba(255, 255, 255, 0.08)";
        context.lineWidth = 2;
        context.stroke();
    }

    function drawMiniMap(individuals = null) {
        if (!miniCtx) return;
        const width = miniMap.width;
        const height = miniMap.height;
        miniCtx.clearRect(0, 0, width, height);
        miniCtx.fillStyle = "rgba(6, 8, 18, 0.85)";
        miniCtx.fillRect(0, 0, width, height);
        const scaleX = width / COURSE_LENGTH;
        const scaleY = height / (COURSE_MAX_Y - COURSE_MIN_Y);
        miniCtx.beginPath();
        miniCtx.moveTo(0, height);
        for (let x = 0; x <= COURSE_LENGTH; x += 6) {
            const y = getTerrainHeight(x);
            const mapY = clamp((y - COURSE_MIN_Y) * scaleY, 0, height);
            miniCtx.lineTo(x * scaleX, mapY);
        }
        miniCtx.lineTo(width, height);
        miniCtx.lineTo(0, height);
        miniCtx.closePath();
        miniCtx.fillStyle = "rgba(255, 107, 107, 0.24)";
        miniCtx.fill();
        miniCtx.strokeStyle = "rgba(255, 255, 255, 0.22)";
        miniCtx.lineWidth = 1;
        miniCtx.stroke();

        const viewWidthWorld = canvas.width / view.zoom;
        const viewHeightWorld = canvas.height / view.zoom;
        const leftWorld = view.cameraX - viewWidthWorld / 2;
        const rightWorld = view.cameraX + viewWidthWorld / 2;
        const topWorld = view.cameraY - viewHeightWorld / 2;
        const bottomWorld = view.cameraY + viewHeightWorld / 2;
        const rectX = Math.min(leftWorld, rightWorld) * scaleX;
        const rectWidth = Math.abs(rightWorld - leftWorld) * scaleX;
        const topMap = clamp((topWorld - COURSE_MIN_Y) * scaleY, 0, height);
        const bottomMap = clamp((bottomWorld - COURSE_MIN_Y) * scaleY, 0, height);
        const rectY = Math.min(topMap, bottomMap);
        const rectHeight = Math.abs(bottomMap - topMap);
        const clampedWidth = Math.min(rectWidth, width);
        const clampedHeight = Math.min(rectHeight, height);
        const maxX = Math.max(0, width - clampedWidth);
        const maxY = Math.max(0, height - clampedHeight);
        const clampedX = clamp(rectX, 0, maxX);
        const clampedY = clamp(rectY, 0, maxY);
        miniCtx.strokeStyle = "rgba(255, 255, 255, 0.75)";
        miniCtx.strokeRect(clampedX, clampedY, clampedWidth, clampedHeight);

        if (individuals && individuals.length) {
            individuals.forEach((ind, idx) => {
                const cx =
                    ind.nodes.reduce((acc, n) => acc + n.x, 0) / ind.nodes.length;
                const cy =
                    ind.nodes.reduce((acc, n) => acc + n.y, 0) / ind.nodes.length;
                const mapX = cx * scaleX;
                const mapY = clamp((cy - COURSE_MIN_Y) * scaleY, 0, height);
                miniCtx.beginPath();
                miniCtx.fillStyle =
                    idx === 0
                        ? "rgba(129, 242, 157, 0.95)"
                        : "rgba(129, 242, 157, 0.45)";
                miniCtx.arc(mapX, mapY, idx === 0 ? 5 : 3, 0, Math.PI * 2);
                miniCtx.fill();
            });
            miniCtx.globalAlpha = 1;
        }
    }

    function addLog(message) {
        const entry = document.createElement("div");
        entry.className = "log-entry";
        entry.innerHTML = message;
        logEl.appendChild(entry);
        logEl.scrollTop = logEl.scrollHeight;
        evolution.latestLog.push(message);
        if (evolution.latestLog.length > 50) evolution.latestLog.shift();
    }

    function updateCounts() {
        const muscleCount = builder.links.filter((link) => link.type === "muscle").length;
        nodeCountEl.textContent = String(builder.nodes.length);
        muscleCountEl.textContent = String(muscleCount);
    }

    function setStatus(text) {
        statusLine.textContent = text;
    }

    function setMode(mode) {
        builder.mode = mode;
        activeModeEl.textContent = mode === "add"
            ? "Add Node"
            : mode === "connect"
                ? "Connect Muscle"
                : mode === "connectBone"
                    ? "Connect Bone"
                    : mode === "anchor"
                        ? "Toggle Anchor"
                        : "Delete Node";
        Object.entries(modeButtons).forEach(([key, btn]) => {
            if (key === mode) btn.classList.add("active-mode");
            else btn.classList.remove("active-mode");
        });
        if (mode !== "connect" && mode !== "connectBone") builder.pendingConnection = null;
        drawBuilder();
    }

    function updateGhostToggleUI() {
        if (!toggleGhostsButton) return;
        toggleGhostsButton.textContent = uiState.showAllGhosts
            ? "Show Top Only"
            : "Show All Ghosts";
        toggleGhostsButton.classList.toggle("active-mode", uiState.showAllGhosts);
        toggleGhostsButton.setAttribute("aria-pressed", uiState.showAllGhosts ? "true" : "false");
    }

    function blueprintFromBuilder() {
        if (builder.nodes.length < 2) {
            addLog("<strong>Need at least two nodes</strong> before running evolution.");
            return null;
        }
        const muscleLinks = builder.links.filter((link) => link.type === "muscle");
        const boneLinks = builder.links.filter((link) => link.type === "bone");
        if (muscleLinks.length < 1) {
            addLog("<strong>Connect nodes with muscles</strong> so the controller has something to drive.");
            return null;
        }
        if (builder.nodes.length > MAX_NODES) {
            addLog(`Limit the creature to ${MAX_NODES} nodes (current: ${builder.nodes.length}).`);
            return null;
        }
        const nodes = builder.nodes.map((n) => ({
            x: n.x,
            y: n.y,
            fixed: !!n.fixed,
        }));
        const muscles = muscleLinks.map((m) => ({
            a: m.a,
            b: m.b,
            rest: m.rest,
        }));
        const bones = boneLinks.map((m) => ({
            a: m.a,
            b: m.b,
            rest: m.rest,
        }));

        return {
            nodes,
            muscles,
            bones,
            links: builder.links.map((link) => ({ ...link })),
            count: builder.nodes.length,
            muscleCount: muscleLinks.length,
            bounds: {
                minX: Math.min(...builder.nodes.map((n) => n.x)),
                maxX: Math.max(...builder.nodes.map((n) => n.x)),
                minY: Math.min(...builder.nodes.map((n) => n.y)),
                maxY: Math.max(...builder.nodes.map((n) => n.y)),
            },
        };
    }

    // ---------- Builder manipulation ----------
    function addNodeAt(x, y) {
        if (builder.nodes.length >= MAX_NODES) {
            addLog(`Node limit reached (${MAX_NODES}). Delete or reuse existing nodes.`);
            return;
        }
        builder.nodes.push({
            x: clampBuildX(x),
            y: clampBuildY(y),
            fixed: false,
        });
        updateCounts();
        drawBuilder();
    }

    function removeNodeAt(index) {
        if (index < 0 || index >= builder.nodes.length) return;
        builder.nodes.splice(index, 1);
        builder.links = builder.links
            .filter((link) => link.a !== index && link.b !== index)
            .map((link) => ({
                ...link,
                a: link.a > index ? link.a - 1 : link.a,
                b: link.b > index ? link.b - 1 : link.b,
            }));
        updateCounts();
        drawBuilder();
    }

    function addLinkBetween(aIndex, bIndex, type) {
        if (aIndex === bIndex) return;
        const duplicate = builder.links.some(
            (link) =>
                link.type === type &&
                ((link.a === aIndex && link.b === bIndex) ||
                    (link.a === bIndex && link.b === aIndex))
        );
        if (duplicate) {
            addLog("Those nodes already share that connection type.");
            return;
        }
        const a = builder.nodes[aIndex];
        const b = builder.nodes[bIndex];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const rest = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        builder.links.push({ a: aIndex, b: bIndex, rest, type });
        updateCounts();
        drawBuilder();
    }

    function addMuscleBetween(aIndex, bIndex) {
        addLinkBetween(aIndex, bIndex, "muscle");
    }

    function addBoneBetween(aIndex, bIndex) {
        addLinkBetween(aIndex, bIndex, "bone");
    }

    function toggleAnchorFor(index) {
        const node = builder.nodes[index];
        if (!node) return;
        node.fixed = !node.fixed;
        drawBuilder();
    }

    function nodeAtScreenPosition(sx, sy) {
        for (let i = builder.nodes.length - 1; i >= 0; i--) {
            const node = builder.nodes[i];
            const screen = worldToScreen(node.x, node.y);
            const dx = sx - screen.x;
            const dy = sy - screen.y;
            if (Math.hypot(dx, dy) <= NODE_SCREEN_RADIUS) {
                return i;
            }
        }
        return null;
    }

    function drawBuilder() {
        if (view.mode !== "run") {
            view.mode = "build";
            view.targetZoom = BUILDER_ZOOM;
            view.zoom = BUILDER_ZOOM;
            view.cameraX = DEFAULT_CAMERA_X;
            view.cameraY = DEFAULT_CAMERA_Y;
        }
        drawTerrainForView(ctx, view, true);

        const muscles = builder.links.filter((link) => link.type === "muscle");
        const bones = builder.links.filter((link) => link.type === "bone");

        const topLeft = worldToScreen(BUILD_AREA.left, BUILD_AREA.top);
        const bottomRight = worldToScreen(BUILD_AREA.right, BUILD_AREA.bottom);
        const rectX = Math.min(topLeft.x, bottomRight.x);
        const rectY = Math.min(topLeft.y, bottomRight.y);
        const rectW = Math.abs(bottomRight.x - topLeft.x);
        const rectH = Math.abs(bottomRight.y - topLeft.y);
        ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
        ctx.fillRect(rectX, rectY, rectW, rectH);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(rectX, rectY, rectW, rectH);

        ctx.lineWidth = MUSCLE_SCREEN_WIDTH + 2;
        bones.forEach((link) => {
            const aScreen = worldToScreen(builder.nodes[link.a].x, builder.nodes[link.a].y);
            const bScreen = worldToScreen(builder.nodes[link.b].x, builder.nodes[link.b].y);
            const boneHighlight =
                builder.pendingConnection !== null &&
                (link.a === builder.pendingConnection || link.b === builder.pendingConnection);
            ctx.strokeStyle = boneHighlight ? "rgba(255, 214, 102, 0.85)" : "rgba(86, 156, 230, 0.85)";
            ctx.beginPath();
            ctx.moveTo(aScreen.x, aScreen.y);
            ctx.lineTo(bScreen.x, bScreen.y);
            ctx.stroke();
        });

        ctx.lineWidth = MUSCLE_SCREEN_WIDTH;
        muscles.forEach((link) => {
            const aScreen = worldToScreen(builder.nodes[link.a].x, builder.nodes[link.a].y);
            const bScreen = worldToScreen(builder.nodes[link.b].x, builder.nodes[link.b].y);
            const highlight =
                builder.pendingConnection !== null &&
                (link.a === builder.pendingConnection || link.b === builder.pendingConnection);
            ctx.strokeStyle = highlight ? "rgba(255, 214, 102, 0.85)" : "rgba(255, 107, 107, 0.78)";
            ctx.beginPath();
            ctx.moveTo(aScreen.x, aScreen.y);
            ctx.lineTo(bScreen.x, bScreen.y);
            ctx.stroke();
        });

        builder.nodes.forEach((node, index) => {
            const screen = worldToScreen(node.x, node.y);
            ctx.beginPath();
            ctx.fillStyle = node.fixed ? "rgba(102, 178, 255, 0.9)" : "rgba(129, 242, 157, 0.9)";
            ctx.strokeStyle =
                builder.pendingConnection === index
                    ? "rgba(255, 214, 102, 0.9)"
                    : node.fixed
                        ? "rgba(86, 156, 230, 1)"
                        : "rgba(78, 208, 132, 1)";
            const radius = NODE_SCREEN_RADIUS;
            ctx.lineWidth = builder.hoverNode === index ? 4 : 2;
            ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "rgba(10, 15, 22, 0.85)";
            const labelSize = Math.max(10, NODE_SCREEN_RADIUS * 1.6);
            ctx.font = `${labelSize}px 'Helvetica Neue', Arial`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(index + 1), screen.x, screen.y);
        });
        drawMiniMap();
    }

    function resetBuilder() {
        builder.nodes = [];
        builder.links = [];
        builder.pendingConnection = null;
        builder.dragging = null;
        builder.dragOffset = { x: 0, y: 0 };
        builder.hoverNode = null;
        builder.isDraggingCanvas = false;
        updateCounts();
        bestDistanceEl.textContent = "0.00 m";
        generationEl.textContent = "-";
        setStatus("Awaiting design...");
        view.mode = "build";
        view.targetZoom = BUILDER_ZOOM;
        view.zoom = BUILDER_ZOOM;
        view.cameraX = DEFAULT_CAMERA_X;
        view.cameraY = DEFAULT_CAMERA_Y;
        drawBuilder();
    }

    // ---------- Canvas event handlers ----------
    let isPointerDown = false;

    canvas.addEventListener("pointerdown", (event) => {
        canvas.setPointerCapture(event.pointerId);
        isPointerDown = true;
        const { x: sx, y: sy } = pointerToCanvas(event);
        const worldPos = screenToWorld(sx, sy);
        const nodeIndex = nodeAtScreenPosition(sx, sy);

        if (event.button === 2) {
            builder.isDraggingCanvas = true;
            builder.dragOffset.x = sx;
            builder.dragOffset.y = sy;
            return;
        }

        if (builder.mode === "add" && nodeIndex === null) {
            addNodeAt(worldPos.x, worldPos.y);
            return;
        }

        if (nodeIndex !== null) {
            if (builder.mode === "connect" || builder.mode === "connectBone") {
                if (builder.pendingConnection === null) {
                    builder.pendingConnection = nodeIndex;
                } else if (builder.pendingConnection !== nodeIndex) {
                    if (builder.mode === "connect") addMuscleBetween(builder.pendingConnection, nodeIndex);
                    else addBoneBetween(builder.pendingConnection, nodeIndex);
                    builder.pendingConnection = null;
                }
                drawBuilder();
                return;
            }
            if (builder.mode === "delete") {
                removeNodeAt(nodeIndex);
                return;
            }
            if (builder.mode === "anchor") {
                toggleAnchorFor(nodeIndex);
                return;
            }
            builder.dragging = nodeIndex;
            builder.dragOffset.x = worldPos.x - builder.nodes[nodeIndex].x;
            builder.dragOffset.y = worldPos.y - builder.nodes[nodeIndex].y;
        } else {
            builder.dragging = null;
        }
    });

    canvas.addEventListener("pointermove", (event) => {
        const { x: sx, y: sy } = pointerToCanvas(event);
        const worldPos = screenToWorld(sx, sy);
        if (builder.isDraggingCanvas) {
            return;
        }
        if (builder.dragging !== null && isPointerDown) {
            const node = builder.nodes[builder.dragging];
            node.x = clampBuildX(worldPos.x - builder.dragOffset.x);
            node.y = clampBuildY(worldPos.y - builder.dragOffset.y);
            drawBuilder();
            return;
        }
        builder.hoverNode = nodeAtScreenPosition(sx, sy);
        drawBuilder();
    });

    canvas.addEventListener("pointerup", (event) => {
        canvas.releasePointerCapture(event.pointerId);
        isPointerDown = false;
        builder.dragging = null;
        builder.isDraggingCanvas = false;
        drawBuilder();
    });

    canvas.addEventListener("dblclick", (event) => {
        const { x, y } = pointerToCanvas(event);
        const nodeIndex = nodeAtScreenPosition(x, y);
        if (nodeIndex !== null) {
            toggleAnchorFor(nodeIndex);
            addLog(`Node ${nodeIndex + 1} ${builder.nodes[nodeIndex].fixed ? "anchored" : "released"}.`);
        }
    });

    canvas.addEventListener("contextmenu", (event) => {
        event.preventDefault();
    });

    function pointerToCanvas(event) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - rect.left),
            y: (event.clientY - rect.top),
        };
    }

    // ---------- Button wiring ----------
    modeButtons.add.addEventListener("click", () => setMode("add"));
    modeButtons.connect.addEventListener("click", () => setMode("connect"));
    if (modeButtons.connectBone) {
        modeButtons.connectBone.addEventListener("click", () => setMode("connectBone"));
    }
    modeButtons.anchor.addEventListener("click", () => setMode("anchor"));
    modeButtons.delete.addEventListener("click", () => setMode("delete"));
    clearButton.addEventListener("click", resetBuilder);
    if (toggleGhostsButton) {
        toggleGhostsButton.addEventListener("click", () => {
            uiState.showAllGhosts = !uiState.showAllGhosts;
            updateGhostToggleUI();
            addLog(
                uiState.showAllGhosts
                    ? "Ghost mode on: showing top 50 genomes with low opacity."
                    : "Ghost mode off: showing only the top performer."
            );
        });
    }

    // ---------- Export / Import ----------
    exportButton.addEventListener("click", async () => {
        const blueprint = blueprintFromBuilder();
        if (!blueprint) return;
        const payload = JSON.stringify(blueprint);
        try {
            await navigator.clipboard.writeText(payload);
            addLog("Blueprint copied to clipboard.");
        } catch {
            addLog("Clipboard blocked. JSON opened in prompt - copy it manually.");
            window.prompt("Creature blueprint JSON:", payload);
        }
    });

    importButton.addEventListener("click", () => {
        const text = window.prompt("Paste blueprint JSON:");
        if (!text) return;
        try {
            const data = JSON.parse(text);
            if (!Array.isArray(data.nodes)) {
                throw new Error("Invalid blueprint.");
            }
            resetBuilder();
            data.nodes.slice(0, MAX_NODES).forEach((n) => {
                builder.nodes.push({
                    x: clampBuildX(n.x ?? DEFAULT_CAMERA_X),
                    y: clampBuildY(n.y ?? DEFAULT_CAMERA_Y),
                    fixed: !!n.fixed,
                });
            });

            const importedLinks = [];
            const linksArray = Array.isArray(data.links) ? data.links : [];
            if (linksArray.length) {
                linksArray.forEach((link) => {
                    if (
                        typeof link.a === "number" &&
                        typeof link.b === "number" &&
                        typeof link.rest === "number" &&
                        typeof link.type === "string"
                    ) {
                        if (link.a < builder.nodes.length && link.b < builder.nodes.length) {
                            importedLinks.push({
                                a: link.a,
                                b: link.b,
                                rest: link.rest,
                                type: link.type === "bone" ? "bone" : "muscle",
                            });
                        }
                    }
                });
            } else {
                const muscles = Array.isArray(data.muscles) ? data.muscles : [];
                muscles.forEach((m) => {
                    if (typeof m.a === "number" && typeof m.b === "number" && typeof m.rest === "number") {
                        if (m.a < builder.nodes.length && m.b < builder.nodes.length) {
                            importedLinks.push({ a: m.a, b: m.b, rest: m.rest, type: "muscle" });
                        }
                    }
                });

                const bones = Array.isArray(data.bones) ? data.bones : [];
                bones.forEach((m) => {
                    if (typeof m.a === "number" && typeof m.b === "number" && typeof m.rest === "number") {
                        if (m.a < builder.nodes.length && m.b < builder.nodes.length) {
                            importedLinks.push({ a: m.a, b: m.b, rest: m.rest, type: "bone" });
                        }
                    }
                });
            }

            builder.links = importedLinks;
            updateCounts();
            drawBuilder();
            addLog("Blueprint imported.");
        } catch (err) {
            addLog(`Import failed: ${err.message}`);
        }
    });

    // ---------- Evolution engine ----------
    const PIXELS_PER_METER = 90;
    const SIM_DURATION = 16; // seconds
    const DT = 0.018;
    const CONTROL_INTERVAL = 5; // steps
    const GRAVITY = 820;
    const STIFFNESS = 240;
    const BONE_STIFFNESS = STIFFNESS * 8;
    const CONTRACT_RATIO = 0.6;
    const RELAX_RATIO = 1.12;
    const DAMPING = 0.985;
    const GROUND_FRICTION = 0.82;
    const MAX_SENSOR_NODES = 8;
    const FEATURES_PER_NODE = 4; // x, y, vx, vy

    function randomNormal() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    function createGenome(inputSize, hiddenSize, outputSize) {
        const w1 = new Float32Array(hiddenSize * inputSize);
        const b1 = new Float32Array(hiddenSize);
        const w2 = new Float32Array(outputSize * hiddenSize);
        const b2 = new Float32Array(outputSize);
        const scale1 = Math.sqrt(2 / inputSize);
        const scale2 = Math.sqrt(2 / hiddenSize);
        for (let i = 0; i < w1.length; i++) w1[i] = randomNormal() * scale1;
        for (let i = 0; i < w2.length; i++) w2[i] = randomNormal() * scale2;
        for (let i = 0; i < b1.length; i++) b1[i] = 0;
        for (let i = 0; i < b2.length; i++) b2[i] = 0;
        return { inputSize, hiddenSize, outputSize, w1, b1, w2, b2 };
    }

    function cloneGenome(genome) {
        return {
            inputSize: genome.inputSize,
            hiddenSize: genome.hiddenSize,
            outputSize: genome.outputSize,
            w1: new Float32Array(genome.w1),
            b1: new Float32Array(genome.b1),
            w2: new Float32Array(genome.w2),
            b2: new Float32Array(genome.b2),
        };
    }

    function mutateGenome(genome, amount) {
        const mutated = cloneGenome(genome);
        const noiseScale1 = amount / Math.sqrt(mutated.inputSize);
        const noiseScale2 = amount / Math.sqrt(mutated.hiddenSize);
        for (let i = 0; i < mutated.w1.length; i++) {
            if (Math.random() < 0.9) mutated.w1[i] += randomNormal() * noiseScale1;
        }
        for (let i = 0; i < mutated.w2.length; i++) {
            if (Math.random() < 0.9) mutated.w2[i] += randomNormal() * noiseScale2;
        }
        for (let i = 0; i < mutated.b1.length; i++) {
            if (Math.random() < 0.7) mutated.b1[i] += randomNormal() * amount * 0.25;
        }
        for (let i = 0; i < mutated.b2.length; i++) {
            if (Math.random() < 0.7) mutated.b2[i] += randomNormal() * amount * 0.25;
        }
        return mutated;
    }

    function forwardNetwork(genome, inputs, hiddenBuffer) {
        const { inputSize, hiddenSize, outputSize, w1, b1, w2, b2 } = genome;
        for (let h = 0; h < hiddenSize; h++) {
            let sum = b1[h];
            for (let i = 0; i < inputSize; i++) {
                sum += w1[h * inputSize + i] * inputs[i];
            }
            hiddenBuffer[h] = Math.tanh(sum);
        }
        const outputs = new Array(outputSize);
        for (let o = 0; o < outputSize; o++) {
            let sum = b2[o];
            for (let h = 0; h < hiddenSize; h++) {
                sum += w2[o * hiddenSize + h] * hiddenBuffer[h];
            }
            outputs[o] = 1 / (1 + Math.exp(-sum));
        }
        return outputs;
    }

    function instantiateCreature(blueprint) {
        const bounds = blueprint.bounds || {
            minX: Math.min(...blueprint.nodes.map((n) => n.x)),
            maxX: Math.max(...blueprint.nodes.map((n) => n.x)),
            minY: Math.min(...blueprint.nodes.map((n) => n.y)),
            maxY: Math.max(...blueprint.nodes.map((n) => n.y)),
        };
        const spawnX = 140;
        const groundY = getTerrainHeight(spawnX) - 4;
        const nodes = blueprint.nodes.map((n) => ({
            x: spawnX + (n.x - bounds.minX) * SIM_SCALE,
            y: groundY - (bounds.maxY - n.y) * SIM_SCALE,
            vx: 0,
            vy: 0,
            fixed: !!n.fixed,
        }));
        const muscles = (blueprint.muscles || []).map((m) => ({
            a: m.a,
            b: m.b,
            rest: m.rest * SIM_SCALE,
            contracted: false,
        }));
        const bones = (blueprint.bones || []).map((m) => ({
            a: m.a,
            b: m.b,
            rest: m.rest * SIM_SCALE,
        }));
        return { nodes, muscles, bones };
    }

    function getTerrainHeight(x) {
        if (x < 260) return 440;
        if (x < 640) {
            const t = (x - 260) / 380;
            return 440 - t * 180;
        }
        const ripple = Math.sin((x - 640) / 160) * 22;
        return 260 + ripple;
    }

    function simulateBlueprint(blueprint, genome, options) {
        const creature = instantiateCreature(blueprint);
        const { nodes, muscles, bones } = creature;
        const hidden = new Float32Array(genome.hiddenSize);
        const inputs = new Float32Array(genome.inputSize);
        const maxSteps = Math.floor(SIM_DURATION / DT);
        let controlStep = 0;
        let bestX = nodes.reduce((acc, n) => acc + n.x, 0) / nodes.length;
        const startX = bestX;
        let penalty = 0;

        for (let step = 0; step < maxSteps; step++) {
            const time = step * DT;
            if (controlStep === 0) {
                fillInputs(inputs, nodes, time, startX);
                const outputs = forwardNetwork(genome, inputs, hidden);
                for (let i = 0; i < muscles.length; i++) {
                    muscles[i].contracted = outputs[i] > 0.5;
                }
            }
            controlStep = (controlStep + 1) % CONTROL_INTERVAL;
            physicsStep(nodes, muscles, bones);

            const averageX = nodes.reduce((acc, n) => acc + n.x, 0) / nodes.length;
            if (averageX > bestX) bestX = averageX;

            // penalty for losing contact (prevent flying)
            const contacts = nodes.filter((n) => Math.abs(n.y - getTerrainHeight(n.x)) < 2);
            if (!contacts.length) penalty += 0.002;
        }
        const distanceMeters = (bestX - startX) / PIXELS_PER_METER;
        const stability = Math.max(0, 1 - penalty);
        return {
            distance: distanceMeters * stability,
            rawDistance: distanceMeters,
            stability,
        };
    }

    function fillInputs(inputs, nodes, time, originX) {
        inputs.fill(0);
        const span = Math.min(nodes.length, MAX_SENSOR_NODES);
        for (let i = 0; i < span; i++) {
            const idx = i * FEATURES_PER_NODE;
            const node = nodes[i];
            inputs[idx] = (node.x - originX) / 400;
            inputs[idx + 1] = (node.y - getTerrainHeight(node.x)) / 220;
            inputs[idx + 2] = node.vx / 220;
            inputs[idx + 3] = node.vy / 220;
        }
        const centerX = nodes.reduce((acc, n) => acc + n.x, 0) / nodes.length;
        const centerY = nodes.reduce((acc, n) => acc + n.y, 0) / nodes.length;
        const terrainSlope = (getTerrainHeight(centerX + 4) - getTerrainHeight(centerX - 4)) / 8;
        const offset = span * FEATURES_PER_NODE;
        inputs[offset] = Math.sin(time * 2);
        inputs[offset + 1] = Math.cos(time * 2);
        inputs[offset + 2] = terrainSlope;
        inputs[offset + 3] = (centerY - getTerrainHeight(centerX)) / 200;
        inputs[offset + 4] = 1; // bias
    }

    function physicsStep(nodes, muscles, bones = []) {
        // Reset acceleration
        const ax = new Array(nodes.length).fill(0);
        const ay = new Array(nodes.length).fill(GRAVITY);

        // Muscle forces
        muscles.forEach((m) => {
            const a = nodes[m.a];
            const b = nodes[m.b];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 1e-6;
            const target = m.rest * (m.contracted ? CONTRACT_RATIO : RELAX_RATIO);
            const stretch = dist - target;
            const force = (stretch / dist) * STIFFNESS;
            const fx = dx * force;
            const fy = dy * force;
            if (!a.fixed) {
                ax[m.a] += fx;
                ay[m.a] += fy;
            }
            if (!b.fixed) {
                ax[m.b] -= fx;
                ay[m.b] -= fy;
            }
        });

        (bones || []).forEach((m) => {
            const a = nodes[m.a];
            const b = nodes[m.b];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.hypot(dx, dy) || 1e-6;
            const stretch = dist - m.rest;
            const force = (stretch / dist) * BONE_STIFFNESS;
            const fx = dx * force;
            const fy = dy * force;
            if (!a.fixed) {
                ax[m.a] += fx;
                ay[m.a] += fy;
            }
            if (!b.fixed) {
                ax[m.b] -= fx;
                ay[m.b] -= fy;
            }
        });

        // Integrate motion
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (node.fixed) continue;
            node.vx = (node.vx + ax[i] * DT) * DAMPING;
            node.vy = (node.vy + ay[i] * DT) * DAMPING;
            node.x += node.vx * DT;
            node.y += node.vy * DT;

            const terrainY = getTerrainHeight(node.x);
            if (node.y > terrainY) {
                node.y = terrainY;
                if (node.vy > 0) node.vy = 0;
                node.vx *= GROUND_FRICTION;
            }
            if (node.x < 40) {
                node.x = 40;
                node.vx = Math.max(0, node.vx);
            }
        }
    }

    function breedNextGeneration(scored, populationSize, mutationAmount) {
        const next = [];
        scored.sort((a, b) => b.score.distance - a.score.distance);
        const elites = Math.max(2, Math.round(populationSize * 0.15));
        for (let i = 0; i < elites; i++) {
            next.push(scored[i].genome);
        }
        while (next.length < populationSize) {
            const parent = randChoice(scored.slice(0, Math.max(elites * 2, 6)));
            const mutated = mutateGenome(parent.genome, mutationAmount);
            next.push(mutated);
        }
        return next;
    }

    function evaluatePopulation(blueprint, population) {
        const scored = [];
        const start = performance.now();
        for (const genome of population) {
            const score = simulateBlueprint(blueprint, genome);
            scored.push({ genome, score });
        }
        const elapsed = performance.now() - start;
        return { scored, elapsed };
    }

    function updateStats(distance, generation) {
        evolution.bestDistance = Math.max(evolution.bestDistance, distance);
        bestDistanceEl.textContent = `${evolution.bestDistance.toFixed(2)} m`;
        generationEl.textContent = String(generation);
    }

    function runEvolutionLoop(blueprint) {
        evolution.running = true;
        evolution.stopRequested = false;
        evolution.bestDistance = 0;
        evolution.generation = 0;
        const inputSize = FEATURES_PER_NODE * MAX_SENSOR_NODES + 5;
        const hiddenSize = Math.max(12, Math.round(blueprint.muscleCount * 1.5));
        const outputSize = blueprint.muscleCount;
        let population = Array.from({ length: evolution.populationSize }, () =>
            createGenome(inputSize, hiddenSize, outputSize));

        const loop = async () => {
            if (evolution.stopRequested) {
                evolution.running = false;
                setStatus("Evolution stopped.");
                addLog("Evolution paused by user.");
                drawBuilder();
                return;
            }
            if (evolution.generation >= evolution.maxGenerations) {
                evolution.running = false;
                setStatus("Reached generation cap. You can run again to continue evolving.");
                addLog("Generation cap reached. Adjust design or run again for more training.");
                drawBuilder();
                return;
            }
            evolution.generation += 1;
            setStatus(`Evaluating generation ${evolution.generation}...`);
            await new Promise((resolve) => setTimeout(resolve, 12));
            const { scored, elapsed } = evaluatePopulation(blueprint, population);
            scored.sort((a, b) => b.score.distance - a.score.distance);
            const best = scored[0];
            updateStats(best.score.distance, evolution.generation);
            addLog(`Gen ${evolution.generation}: best ${best.score.distance.toFixed(2)} m (stability ${best.score.stability.toFixed(2)}). Eval time ${elapsed.toFixed(0)} ms.`);

            await visualizeGeneration(blueprint, scored);
            if (evolution.stopRequested) {
                evolution.running = false;
                setStatus("Evolution stopped.");
                addLog("Evolution paused by user.");
                drawBuilder();
                return;
            }
            population = breedNextGeneration(scored, evolution.populationSize, 0.45);
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    async function visualizeGeneration(blueprint, scored) {
        if (!scored.length) return;
        const showAll = uiState.showAllGhosts;
        const limit = Math.min(scored.length, showAll ? 50 : 1);
        const selection = scored.slice(0, limit);
        setStatus(showAll ? `Visualising top ${limit} genomes...` : "Visualising best genome...");
        const individuals = selection.map(({ genome }) => {
            const creature = instantiateCreature(blueprint);
            const nodes = creature.nodes;
            const centerX = nodes.reduce((acc, n) => acc + n.x, 0) / nodes.length;
            return {
                genome,
                nodes,
                muscles: creature.muscles,
                bones: creature.bones,
                hidden: new Float32Array(genome.hiddenSize),
                inputs: new Float32Array(genome.inputSize),
                controlCountdown: 0,
                startX: centerX,
            };
        });
        view.mode = "run";
        view.targetZoom = RUN_ZOOM;
        view.cameraX = COURSE_LENGTH / 2;
        view.cameraY = RUN_CAMERA_Y;

        const maxSteps = Math.floor(SIM_DURATION / DT);
        const alpha = showAll ? 1 / 50 : 1;
        let step = 0;
        let frameCount = 0;

        return new Promise((resolve) => {
            const animate = () => {
                if (evolution.stopRequested || step >= maxSteps) {
                    drawMiniMap(individuals);
                    resolve();
                    return;
                }
                if (frameCount % FRAMES_PER_STEP === 0) {
                    const simTime = step * DT;
                    individuals.forEach((ind) => {
                        if (ind.controlCountdown <= 0) {
                            fillInputs(ind.inputs, ind.nodes, simTime, ind.startX);
                            const outputs = forwardNetwork(ind.genome, ind.inputs, ind.hidden);
                            for (let i = 0; i < ind.muscles.length; i++) {
                                ind.muscles[i].contracted = outputs[i] > 0.5;
                            }
                            ind.controlCountdown = CONTROL_INTERVAL;
                        }
                        physicsStep(ind.nodes, ind.muscles, ind.bones || []);
                        ind.controlCountdown -= 1;
                    });
                    step += 1;
                }
                renderIndividuals(individuals, alpha, showAll);
                frameCount += 1;
                requestAnimationFrame(animate);
            };
            animate();
        });
    }

    function renderIndividuals(individuals, alpha, showAll) {
        updateViewZoom();
        drawTerrainForView(ctx, view, true);
        ctx.save();
        ctx.globalAlpha = alpha;
        const muscleWidth = getMuscleScreenWidth();
        ctx.lineWidth = muscleWidth + 2;
        individuals.forEach((ind) => {
            const bones = ind.bones || [];
            bones.forEach((m) => {
                const aScreen = worldToScreen(ind.nodes[m.a].x, ind.nodes[m.a].y);
                const bScreen = worldToScreen(ind.nodes[m.b].x, ind.nodes[m.b].y);
                ctx.strokeStyle = "rgba(86, 156, 230, 0.8)";
                ctx.beginPath();
                ctx.moveTo(aScreen.x, aScreen.y);
                ctx.lineTo(bScreen.x, bScreen.y);
                ctx.stroke();
            });
        });

        ctx.lineWidth = muscleWidth;
        individuals.forEach((ind) => {
            ind.muscles.forEach((m) => {
                const aScreen = worldToScreen(ind.nodes[m.a].x, ind.nodes[m.a].y);
                const bScreen = worldToScreen(ind.nodes[m.b].x, ind.nodes[m.b].y);
                ctx.strokeStyle = m.contracted
                    ? "rgba(255, 180, 105, 0.85)"
                    : showAll
                        ? "rgba(255, 107, 107, 0.35)"
                        : "rgba(255, 107, 107, 0.65)";
                ctx.beginPath();
                ctx.moveTo(aScreen.x, aScreen.y);
                ctx.lineTo(bScreen.x, bScreen.y);
                ctx.stroke();
            });
        });
        individuals.forEach((ind) => {
            ind.nodes.forEach((node) => {
                const screen = worldToScreen(node.x, node.y);
                ctx.beginPath();
                ctx.fillStyle = node.fixed ? "rgba(102, 178, 255, 0.95)" : "rgba(129, 242, 157, 0.95)";
                ctx.strokeStyle = node.fixed ? "rgba(86, 156, 230, 1)" : "rgba(78, 208, 132, 1)";
                ctx.lineWidth = showAll ? 1 : 2;
                const radius = muscleWidth;
                ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            });
        });
        ctx.restore();
        drawMiniMap(individuals);
    }

    // ---------- Run / stop ----------
    runButton.addEventListener("click", () => {
        if (evolution.running) {
            addLog("Evolution already running. Hit stop if you want to rebuild.");
            return;
        }
        const blueprint = blueprintFromBuilder();
        if (!blueprint) return;
        view.mode = "run";
        view.targetZoom = RUN_ZOOM;
        view.cameraX = COURSE_LENGTH / 2;
        view.cameraY = RUN_CAMERA_Y;
        drawMiniMap();
        renderIndividuals([], 1, uiState.showAllGhosts);
        setStatus("Spawning population...");
        addLog(`Launching evolution with ${blueprint.count} nodes and ${blueprint.muscleCount} muscles.`);
        runEvolutionLoop(blueprint);
    });

    stopButton.addEventListener("click", () => {
        if (!evolution.running) {
            addLog("No evolution in progress.");
            return;
        }
        evolution.stopRequested = true;
        setStatus("Stopping after current generation...");
        addLog("Stop requested. Finishing current evaluation.");
    });

    // ---------- Init ----------
    updateCounts();
    drawBuilder();
    addLog("Ready. Add nodes, connect muscles or bones, then run evolution.");
    updateGhostToggleUI();
    setMode("add");

})();




































