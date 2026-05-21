(function () {
    "use strict";

    const SOURCE_ASSET_BASE = "assets/moonfloof";
    const WORLD = { width: 520, height: 780 };
    const SOURCE_WIDTH = 640;
    const SCALE = WORLD.width / SOURCE_WIDTH;
    const WALL_PAD = 64 * SCALE;
    const LOSE_Y = 84 * (WORLD.height / 960);
    const DROP_COOLDOWN = 520;
    const FIXED_STEP = 1000 / 60;
    const GRAVITY_SCALE = 0.0014375;
    const STORAGE_KEY = "gabriel-suika-clone-best";
    const POINTS_STORAGE_KEY = "gabriel-suika-clone-points";
    const LEGACY_META_STORAGE_KEY = "gabriel-suika-clone-meta";
    const SCORE_TO_POINTS_RATE = 10;
    const JIGGLE_COST = 100;
    const REMOVE_COST = 50;
    const FRUIT_COLLISION_SIDES = 64;
    const FRUIT_FRICTION = 0.0042;
    const FRUIT_RESTITUTION = 0.15;
    const FRUIT_FRICTION_AIR = 0.0007;
    const FRUIT_ANGULAR_FRICTION_AIR = FRUIT_FRICTION_AIR * 1.4;
    const FRUIT_EXTRA_ANGULAR_DAMPING = FRUIT_ANGULAR_FRICTION_AIR - FRUIT_FRICTION_AIR;

    const sourceRadii = [24, 32, 40, 56, 64, 72, 84, 96, 128, 160, 192];
    const sourceScores = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 66];
    const fruitNames = [
        "Level 1",
        "Level 2",
        "Level 3",
        "Level 4",
        "Level 5",
        "Level 6",
        "Level 7",
        "Level 8",
        "Level 9",
        "Level 10",
        "Level 11"
    ];

    const fruits = sourceRadii.map((radius, index) => ({
        radius: Math.round(radius * SCALE),
        score: sourceScores[index],
        name: fruitNames[index],
        imagePath: `${SOURCE_ASSET_BASE}/img/circle${index}.png`,
        soundPath: `${SOURCE_ASSET_BASE}/pop${index}.mp3`
    }));

    const dom = {
        gameCanvas: document.getElementById("gameCanvas"),
        ambientCanvas: document.getElementById("ambientCanvas"),
        nextCanvas: document.getElementById("nextCanvas"),
        score: document.getElementById("scoreValue"),
        best: document.getElementById("bestValue"),
        largest: document.getElementById("largestValue"),
        points: document.getElementById("pointsValue"),
        status: document.getElementById("canvasStatus"),
        restartButton: document.getElementById("restartButton"),
        restartTop: document.getElementById("restartTop"),
        jiggleButton: document.getElementById("jiggleButton"),
        removeButton: document.getElementById("removeButton"),
        abilityStatus: document.getElementById("abilityStatus"),
        boardFrame: document.querySelector(".board-frame")
    };

    const ctx = dom.gameCanvas.getContext("2d");
    const nextCtx = dom.nextCanvas.getContext("2d");
    const assetImages = fruits.map((fruit) => loadImage(fruit.imagePath));
    const popImage = loadImage(`${SOURCE_ASSET_BASE}/img/pop.png`);
    const sounds = {
        click: createAudio(`${SOURCE_ASSET_BASE}/click.mp3`, 0.24),
        pops: fruits.map((fruit) => createAudio(fruit.soundPath, 0.3))
    };

    let MatterApi;
    let Engine;
    let Composite;
    let Bodies;
    let Body;
    let Events;
    let Sleeping;

    let engine;
    let score = 0;
    let bestScore = readBestScore();
    let pointBalance = readPointBalance();
    let unconvertedScore = 0;
    let largestLevel = -1;
    let currentLevel = 0;
    let nextLevel = 0;
    let dropX = WORLD.width / 2;
    let nextDropAt = 0;
    let gameOver = false;
    let dangerSince = null;
    let lastFrameTime = 0;
    let accumulator = 0;
    let gameDpr = 1;
    let nextDpr = 1;
    let activeAbility = null;
    let touchDropPointerId = null;

    const activeFruits = new Set();
    const pendingMerges = [];
    const popEffects = [];

    function loadImage(src) {
        const image = new Image();
        image.decoding = "async";
        image.src = src;
        return image;
    }

    function createAudio(src, volume) {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = volume;
        return audio;
    }

    function playAudio(audio) {
        if (!audio) return;

        try {
            audio.currentTime = 0;
            const playback = audio.play();
            if (playback && typeof playback.catch === "function") {
                playback.catch(function () {});
            }
        } catch (error) {
            // Browser audio policies can reject playback before a user gesture.
        }
    }

    function clamp(value, min, max) {
        return Math.min(Math.max(value, min), max);
    }

    function randomDropLevel() {
        return Math.floor(Math.random() * 5);
    }

    function readBestScore() {
        try {
            return Number(localStorage.getItem(STORAGE_KEY)) || 0;
        } catch (error) {
            return 0;
        }
    }

    function saveBestScore() {
        if (score <= bestScore) return;

        bestScore = score;
        try {
            localStorage.setItem(STORAGE_KEY, String(bestScore));
        } catch (error) {
            // Local files and private windows can block storage.
        }
    }

    function init() {
        startAmbientCanvas();

        MatterApi = window.Matter;
        if (!MatterApi) {
            showStatus("Matter.js could not load. Check your network connection and reload the page.");
            drawUnavailableBoard();
            return;
        }

        ({ Engine, Composite, Bodies, Body, Events, Sleeping } = MatterApi);
        engine = Engine.create({ enableSleeping: true });
        engine.gravity.y = 1;
        engine.gravity.scale = GRAVITY_SCALE;

        Events.on(engine, "collisionStart", onCollisionStart);

        resizeGameCanvas();
        resizeNextCanvas();
        bindInput();
        resetGame();
        requestAnimationFrame(frame);
    }

    function showStatus(message) {
        dom.status.textContent = message;
        dom.status.hidden = false;
    }

    function drawUnavailableBoard() {
        resizeGameCanvas();
        ctx.clearRect(0, 0, WORLD.width, WORLD.height);
        drawBoardBase();
    }

    function bindInput() {
        dom.gameCanvas.addEventListener("pointermove", function (event) {
            if (activeAbility === "remove") return;
            if (event.pointerType === "touch" && touchDropPointerId !== event.pointerId) return;

            setDropX(clientToWorldX(event.clientX));
        });

        dom.gameCanvas.addEventListener("pointerdown", function (event) {
            const point = clientToWorldPoint(event.clientX, event.clientY);

            event.preventDefault();
            if (activeAbility === "remove") {
                removeFruitAt(point.x, point.y);
                return;
            }

            setDropX(point.x);
            if (event.pointerType === "touch") {
                touchDropPointerId = event.pointerId;
                if (dom.gameCanvas.setPointerCapture) {
                    dom.gameCanvas.setPointerCapture(event.pointerId);
                }
                return;
            }

            dropFruit();
        }, { passive: false });

        dom.gameCanvas.addEventListener("pointerup", function (event) {
            if (event.pointerType !== "touch" || touchDropPointerId !== event.pointerId) return;

            event.preventDefault();
            touchDropPointerId = null;
            setDropX(clientToWorldX(event.clientX));
            dropFruit();
            if (dom.gameCanvas.hasPointerCapture && dom.gameCanvas.hasPointerCapture(event.pointerId)) {
                dom.gameCanvas.releasePointerCapture(event.pointerId);
            }
        }, { passive: false });

        dom.gameCanvas.addEventListener("pointercancel", function (event) {
            if (event.pointerId === touchDropPointerId) {
                touchDropPointerId = null;
            }
        });

        window.addEventListener("keydown", function (event) {
            if (event.key === "ArrowLeft") {
                event.preventDefault();
                setDropX(dropX - 26);
            } else if (event.key === "ArrowRight") {
                event.preventDefault();
                setDropX(dropX + 26);
            } else if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                dropFruit();
            } else if (event.key.toLowerCase() === "r") {
                resetGame();
            } else if (event.key === "Escape") {
                activeAbility = null;
                updateHud();
            }
        });

        dom.restartButton.addEventListener("click", resetGame);
        dom.restartTop.addEventListener("click", resetGame);
        dom.jiggleButton.addEventListener("click", jiggleBoard);
        dom.removeButton.addEventListener("click", toggleRemoveAbility);

        window.addEventListener("resize", function () {
            resizeGameCanvas();
            resizeNextCanvas();
            drawNextFruit();
        });
    }

    function clientToWorldX(clientX) {
        const rect = dom.gameCanvas.getBoundingClientRect();
        return ((clientX - rect.left) / rect.width) * WORLD.width;
    }

    function clientToWorldPoint(clientX, clientY) {
        const rect = dom.gameCanvas.getBoundingClientRect();
        return {
            x: ((clientX - rect.left) / rect.width) * WORLD.width,
            y: ((clientY - rect.top) / rect.height) * WORLD.height
        };
    }

    function setDropX(x) {
        const radius = fruits[currentLevel].radius;
        dropX = clamp(x, radius + 6, WORLD.width - radius - 6);
    }

    function resizeGameCanvas() {
        gameDpr = Math.min(window.devicePixelRatio || 1, 2);
        dom.gameCanvas.width = Math.round(WORLD.width * gameDpr);
        dom.gameCanvas.height = Math.round(WORLD.height * gameDpr);
        ctx.setTransform(gameDpr, 0, 0, gameDpr, 0, 0);
    }

    function resizeNextCanvas() {
        nextDpr = Math.min(window.devicePixelRatio || 1, 2);
        const size = 96;
        dom.nextCanvas.width = Math.round(size * nextDpr);
        dom.nextCanvas.height = Math.round(size * nextDpr);
        nextCtx.setTransform(nextDpr, 0, 0, nextDpr, 0, 0);
    }

    function resetGame() {
        if (!engine) return;

        Composite.clear(engine.world, false);
        Engine.clear(engine);

        activeFruits.clear();
        pendingMerges.length = 0;
        popEffects.length = 0;
        score = 0;
        unconvertedScore = 0;
        largestLevel = -1;
        gameOver = false;
        dangerSince = null;
        accumulator = 0;
        activeAbility = null;
        nextDropAt = performance.now() + 180;
        currentLevel = randomDropLevel();
        nextLevel = randomDropLevel();
        dropX = WORLD.width / 2;
        setDropX(dropX);

        createBounds();
        updateHud();
        drawNextFruit();
    }

    function createBounds() {
        const wallOptions = {
            isStatic: true,
            label: "wall",
            friction: 0.006,
            frictionStatic: 0.006,
            frictionAir: 0,
            restitution: 0.1
        };

        Composite.add(engine.world, [
            Bodies.rectangle(-WALL_PAD / 2, WORLD.height / 2, WALL_PAD, WORLD.height * 2, wallOptions),
            Bodies.rectangle(WORLD.width + WALL_PAD / 2, WORLD.height / 2, WALL_PAD, WORLD.height * 2, wallOptions),
            Bodies.rectangle(WORLD.width / 2, WORLD.height + WALL_PAD / 2, WORLD.width + WALL_PAD * 2, WALL_PAD, wallOptions)
        ]);
    }

    function updateHud() {
        saveBestScore();
        if (activeAbility === "remove" && !canRemove()) {
            activeAbility = null;
        }

        dom.score.textContent = String(score);
        dom.best.textContent = String(bestScore);
        dom.largest.textContent = largestLevel >= 0 ? fruits[largestLevel].name : "-";
        dom.points.textContent = String(pointBalance);
        dom.jiggleButton.disabled = !canJiggle();
        dom.removeButton.disabled = !canRemove();
        dom.removeButton.classList.toggle("is-active", activeAbility === "remove");
        dom.gameCanvas.classList.toggle("is-removing", activeAbility === "remove");

        if (activeAbility === "remove") {
            dom.abilityStatus.textContent = `Remove armed | ${pointBalance} Points`;
        } else if (pointBalance >= JIGGLE_COST) {
            dom.abilityStatus.textContent = `Jiggle ${JIGGLE_COST} Points | Remove ${REMOVE_COST} Points`;
        } else if (pointBalance >= REMOVE_COST) {
            dom.abilityStatus.textContent = `Need ${JIGGLE_COST - pointBalance} more for Jiggle | Remove ${REMOVE_COST} Points`;
        } else {
            dom.abilityStatus.textContent = `Need ${REMOVE_COST - pointBalance} more for Remove`;
        }
    }

    function dropFruit() {
        const now = performance.now();
        if (gameOver || now < nextDropAt) return;

        const radius = fruits[currentLevel].radius;
        const x = clamp(dropX, radius + 6, WORLD.width - radius - 6);
        const y = Math.max(radius + 8, LOSE_Y - 8);

        addFruit(currentLevel, x, y);
        playAudio(sounds.click);

        currentLevel = nextLevel;
        nextLevel = randomDropLevel();
        setDropX(dropX);
        nextDropAt = now + DROP_COOLDOWN;
        drawNextFruit();
        updateHud();
    }

    function readPointBalance() {
        try {
            const currentValue = localStorage.getItem(POINTS_STORAGE_KEY);
            if (currentValue !== null) {
                return Math.max(0, Number(currentValue) || 0);
            }

            const legacyValue = localStorage.getItem(LEGACY_META_STORAGE_KEY);
            if (legacyValue !== null) {
                const migratedValue = Math.max(0, Number(legacyValue) || 0);
                localStorage.setItem(POINTS_STORAGE_KEY, String(migratedValue));
                localStorage.removeItem(LEGACY_META_STORAGE_KEY);
                return migratedValue;
            }

            return 0;
        } catch (error) {
            return 0;
        }
    }

    function savePointBalance() {
        try {
            localStorage.setItem(POINTS_STORAGE_KEY, String(pointBalance));
        } catch (error) {
            // Local files and private windows can block storage.
        }
    }

    function addScore(points) {
        score += points;
        unconvertedScore += points;

        const earnedPoints = Math.floor(unconvertedScore / SCORE_TO_POINTS_RATE);
        if (earnedPoints > 0) {
            pointBalance += earnedPoints;
            unconvertedScore -= earnedPoints * SCORE_TO_POINTS_RATE;
            savePointBalance();
        }
    }

    function removeScore(points) {
        score = Math.max(0, score - points);
        unconvertedScore = Math.max(0, unconvertedScore - points);
    }

    function canJiggle() {
        return !gameOver && pointBalance >= JIGGLE_COST && activeFruits.size > 0;
    }

    function canRemove() {
        return !gameOver && pointBalance >= REMOVE_COST && activeFruits.size > 0;
    }

    function jiggleBoard() {
        if (!canJiggle()) {
            updateHud();
            return;
        }

        pointBalance -= JIGGLE_COST;
        savePointBalance();
        activeAbility = null;

        activeFruits.forEach(function (body) {
            const data = getFruitData(body);
            if (!data || body.plugin.mergeLocked) return;

            const direction = body.position.x < WORLD.width / 2 ? 1 : -1;
            const horizontalVelocity = clamp(
                body.velocity.x + direction * (1.9 + Math.random() * 1.5),
                -7,
                7
            );
            const upwardVelocity = Math.max(
                -8.5,
                Math.min(body.velocity.y - 3.2, -5.4 - Math.random() * 1.4)
            );
            const randomNudge = (Math.random() - 0.5) * body.mass * 0.0014;

            Body.setVelocity(body, { x: horizontalVelocity, y: upwardVelocity });
            Body.applyForce(body, body.position, {
                x: direction * body.mass * 0.004 + randomNudge,
                y: -body.mass * 0.0026
            });
            Body.setAngularVelocity(body, body.angularVelocity + direction * 0.16);
        });

        dangerSince = null;
        dom.boardFrame.classList.remove("is-jiggling");
        void dom.boardFrame.offsetWidth;
        dom.boardFrame.classList.add("is-jiggling");
        playAudio(sounds.click);
        updateHud();
    }

    function toggleRemoveAbility() {
        if (!canRemove()) {
            activeAbility = null;
            updateHud();
            return;
        }

        activeAbility = activeAbility === "remove" ? null : "remove";
        updateHud();
    }

    function removeFruitAt(x, y) {
        if (!canRemove()) {
            activeAbility = null;
            updateHud();
            return;
        }

        const body = findFruitAt(x, y);
        if (!body) {
            updateHud();
            return;
        }

        const data = getFruitData(body);
        if (!data) return;

        pointBalance -= REMOVE_COST;
        savePointBalance();
        removeScore(fruits[data.level].score);
        spawnPop(body.position.x, body.position.y, data.radius);
        playAudio(sounds.pops[data.level]);
        removeFruit(body);
        wakeAllFruitPhysics();
        activeAbility = null;
        dangerSince = null;
        updateHud();
    }

    function findFruitAt(x, y) {
        let selectedBody = null;
        let selectedDistance = Infinity;

        activeFruits.forEach(function (body) {
            const data = getFruitData(body);
            if (!data || body.plugin.mergeLocked) return;

            const distance = Math.hypot(body.position.x - x, body.position.y - y);
            const touchPadding = Math.max(10, Math.min(22, data.radius * 0.35));
            if (distance <= data.radius + touchPadding && distance < selectedDistance) {
                selectedBody = body;
                selectedDistance = distance;
            }
        });

        return selectedBody;
    }

    function addFruit(level, x, y) {
        const fruit = fruits[level];
        const body = Bodies.circle(x, y, fruit.radius, {
            label: "fruit",
            friction: FRUIT_FRICTION,
            frictionStatic: 0.006,
            frictionAir: FRUIT_FRICTION_AIR,
            restitution: FRUIT_RESTITUTION,
            density: 0.001,
            slop: 0.03
        }, FRUIT_COLLISION_SIDES);

        body.plugin.fruit = {
            level,
            radius: fruit.radius,
            bornAt: performance.now()
        };
        body.plugin.mergeLocked = false;

        activeFruits.add(body);
        Composite.add(engine.world, body);
        return body;
    }

    function onCollisionStart(event) {
        for (const pair of event.pairs) {
            const bodyA = pair.bodyA;
            const bodyB = pair.bodyB;
            const fruitA = getFruitData(bodyA);
            const fruitB = getFruitData(bodyB);

            if (!fruitA || !fruitB) continue;
            if (fruitA.level !== fruitB.level) continue;
            if (fruitA.level >= fruits.length - 1) continue;
            if (bodyA.plugin.mergeLocked || bodyB.plugin.mergeLocked) continue;

            bodyA.plugin.mergeLocked = true;
            bodyB.plugin.mergeLocked = true;
            pendingMerges.push({ bodyA, bodyB, level: fruitA.level });
        }
    }

    function getFruitData(body) {
        if (!activeFruits.has(body)) return null;
        return body.plugin && body.plugin.fruit ? body.plugin.fruit : null;
    }

    function processMerges() {
        if (pendingMerges.length === 0) return;

        const merges = pendingMerges.splice(0, pendingMerges.length);
        for (const merge of merges) {
            const bodyA = merge.bodyA;
            const bodyB = merge.bodyB;
            if (!activeFruits.has(bodyA) || !activeFruits.has(bodyB)) continue;

            const dataA = getFruitData(bodyA);
            const dataB = getFruitData(bodyB);
            if (!dataA || !dataB || dataA.level !== dataB.level) continue;

            const next = dataA.level + 1;
            if (next >= fruits.length) continue;

            const mass = bodyA.mass + bodyB.mass;
            const x = (bodyA.position.x * bodyA.mass + bodyB.position.x * bodyB.mass) / mass;
            const y = (bodyA.position.y * bodyA.mass + bodyB.position.y * bodyB.mass) / mass;
            const vx = (bodyA.velocity.x * bodyA.mass + bodyB.velocity.x * bodyB.mass) / mass;
            const vy = (bodyA.velocity.y * bodyA.mass + bodyB.velocity.y * bodyB.mass) / mass;
            const nextRadius = fruits[next].radius;

            removeFruit(bodyA);
            removeFruit(bodyB);

            const merged = addFruit(
                next,
                clamp(x, nextRadius + 6, WORLD.width - nextRadius - 6),
                clamp(y, nextRadius + 6, WORLD.height - nextRadius - 6)
            );
            Body.setVelocity(merged, { x: vx * 0.6, y: vy * 0.6 });

            addScore(fruits[dataA.level].score);
            largestLevel = Math.max(largestLevel, next);
            spawnPop(x, y, nextRadius);
            playAudio(sounds.pops[dataA.level]);
            wakeAllFruitPhysics();
            updateHud();
            drawNextFruit();
        }
    }

    function removeFruit(body) {
        activeFruits.delete(body);
        Composite.remove(engine.world, body);
    }

    function wakeAllFruitPhysics() {
        activeFruits.forEach(function (body) {
            const data = getFruitData(body);
            if (!data) return;

            if (Sleeping) {
                Sleeping.set(body, false);
            } else {
                body.isSleeping = false;
            }

            Body.applyForce(body, body.position, {
                x: 0,
                y: body.mass * 0.00008
            });
        });
    }

    function spawnPop(x, y, radius) {
        popEffects.push({
            x,
            y,
            radius,
            bornAt: performance.now(),
            duration: 170
        });
    }

    function updateGameOver(now) {
        if (gameOver) return;

        let isDangerous = false;
        activeFruits.forEach(function (body) {
            const data = getFruitData(body);
            if (!data || body.plugin.mergeLocked) return;

            const age = now - data.bornAt;
            const top = body.position.y - data.radius;
            if (age > 1200 && top < LOSE_Y && body.speed < 1.4) {
                isDangerous = true;
            }
        });

        if (isDangerous) {
            if (dangerSince === null) dangerSince = now;
            if (now - dangerSince > 1500) endGame();
        } else {
            dangerSince = null;
        }
    }

    function endGame() {
        gameOver = true;
        saveBestScore();
        updateHud();
    }

    function applyFruitAngularFriction(delta) {
        const damping = Math.max(0, 1 - FRUIT_EXTRA_ANGULAR_DAMPING * (delta / FIXED_STEP));

        activeFruits.forEach(function (body) {
            const data = getFruitData(body);
            if (!data || body.isSleeping) return;

            Body.setAngularVelocity(body, body.angularVelocity * damping);
        });
    }

    function frame(now) {
        if (!lastFrameTime) lastFrameTime = now;
        const elapsed = Math.min(now - lastFrameTime, 80);
        lastFrameTime = now;

        if (!gameOver) {
            accumulator += elapsed;
            while (accumulator >= FIXED_STEP) {
                Engine.update(engine, FIXED_STEP);
                applyFruitAngularFriction(FIXED_STEP);
                processMerges();
                accumulator -= FIXED_STEP;
            }
            updateGameOver(now);
        }

        draw(now);
        requestAnimationFrame(frame);
    }

    function draw(now) {
        ctx.clearRect(0, 0, WORLD.width, WORLD.height);
        drawBoardBase();
        drawDropPreview(now);
        drawFruits();
        drawPopEffects(now);
        drawGameOverOverlay();
    }

    function drawBoardBase() {
        const boardGradient = ctx.createLinearGradient(0, 0, 0, WORLD.height);
        boardGradient.addColorStop(0, "#101010");
        boardGradient.addColorStop(1, "#050505");
        ctx.fillStyle = boardGradient;
        ctx.fillRect(0, 0, WORLD.width, WORLD.height);

        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.045)";
        ctx.lineWidth = 1;
        for (let y = 52; y < WORLD.height; y += 52) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(WORLD.width, y);
            ctx.stroke();
        }
        for (let x = 52; x < WORLD.width; x += 52) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, WORLD.height);
            ctx.stroke();
        }

        ctx.strokeStyle = "rgba(255, 107, 107, 0.65)";
        ctx.setLineDash([8, 10]);
        ctx.beginPath();
        ctx.moveTo(0, LOSE_Y);
        ctx.lineTo(WORLD.width, LOSE_Y);
        ctx.stroke();
        ctx.restore();

        ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, WORLD.width - 2, WORLD.height - 2);
    }

    function drawDropPreview(now) {
        if (gameOver || activeAbility === "remove") return;

        const fruit = fruits[currentLevel];
        const canDrop = now >= nextDropAt;
        const y = Math.max(fruit.radius + 8, LOSE_Y - 8);

        ctx.save();
        ctx.globalAlpha = canDrop ? 0.82 : 0.35;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 10]);
        ctx.beginPath();
        ctx.moveTo(dropX, y + fruit.radius + 8);
        ctx.lineTo(dropX, WORLD.height - 12);
        ctx.stroke();
        drawFruitImage(currentLevel, dropX, y, fruit.radius, 0);
        ctx.restore();
    }

    function drawFruits() {
        activeFruits.forEach(function (body) {
            const data = getFruitData(body);
            if (!data) return;

            drawFruitImage(data.level, body.position.x, body.position.y, data.radius, body.angle);
        });
    }

    function drawFruitImage(level, x, y, radius, angle) {
        const image = assetImages[level];

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);
        ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
        ctx.shadowBlur = 12;
        ctx.shadowOffsetY = 6;

        if (image.complete && image.naturalWidth > 0) {
            ctx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
        }

        ctx.restore();
    }

    function drawPopEffects(now) {
        for (let index = popEffects.length - 1; index >= 0; index -= 1) {
            const pop = popEffects[index];
            const progress = (now - pop.bornAt) / pop.duration;

            if (progress >= 1) {
                popEffects.splice(index, 1);
                continue;
            }

            const size = pop.radius * (1.9 + progress * 0.35);
            ctx.save();
            ctx.globalAlpha = 1 - progress;
            ctx.translate(pop.x, pop.y);
            ctx.rotate(progress * Math.PI);

            if (popImage.complete && popImage.naturalWidth > 0) {
                ctx.drawImage(popImage, -size / 2, -size / 2, size, size);
            }

            ctx.restore();
        }
    }

    function drawGameOverOverlay() {
        if (!gameOver) return;

        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.68)";
        ctx.fillRect(0, 0, WORLD.width, WORLD.height);

        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.font = '700 42px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText("Game Over", WORLD.width / 2, WORLD.height / 2 - 20);

        ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
        ctx.font = '500 20px "Helvetica Neue", Arial, sans-serif';
        ctx.fillText(`Score ${score}`, WORLD.width / 2, WORLD.height / 2 + 18);
        ctx.restore();
    }

    function drawNextFruit() {
        nextCtx.clearRect(0, 0, 96, 96);
        const fruit = fruits[nextLevel];
        const image = assetImages[nextLevel];
        const radius = Math.min(38, fruit.radius * 0.78);

        nextCtx.save();
        nextCtx.translate(48, 48);
        nextCtx.shadowColor = "rgba(0, 0, 0, 0.25)";
        nextCtx.shadowBlur = 10;
        nextCtx.shadowOffsetY = 4;

        if (image.complete && image.naturalWidth > 0) {
            nextCtx.drawImage(image, -radius, -radius, radius * 2, radius * 2);
        } else {
            image.addEventListener("load", drawNextFruit, { once: true });
        }

        nextCtx.restore();
    }

    function startAmbientCanvas() {
        const canvas = dom.ambientCanvas;
        const ambientCtx = canvas.getContext("2d");
        let dpr = 1;
        let width = 0;
        let height = 0;
        let particles = [];
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        function resize() {
            dpr = Math.min(window.devicePixelRatio || 1, 2);
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            ambientCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

            const count = Math.max(80, Math.min(180, Math.floor((width * height) / 10500)));
            particles = Array.from({ length: count }, function () {
                const speed = 0.08 + Math.random() * 0.28;
                const angle = Math.random() * Math.PI * 2;
                return {
                    x: Math.random() * width,
                    y: Math.random() * height,
                    radius: 0.7 + Math.random() * 2.2,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    alpha: 0.12 + Math.random() * 0.22
                };
            });
        }

        function tick() {
            ambientCtx.clearRect(0, 0, width, height);
            ambientCtx.fillStyle = "rgba(0, 0, 0, 0.36)";
            ambientCtx.fillRect(0, 0, width, height);

            for (const particle of particles) {
                if (!reducedMotion) {
                    particle.x += particle.vx;
                    particle.y += particle.vy;
                    if (particle.x < -10) particle.x = width + 10;
                    if (particle.x > width + 10) particle.x = -10;
                    if (particle.y < -10) particle.y = height + 10;
                    if (particle.y > height + 10) particle.y = -10;
                }

                ambientCtx.beginPath();
                ambientCtx.fillStyle = `rgba(255, 107, 107, ${particle.alpha})`;
                ambientCtx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
                ambientCtx.fill();
            }

            requestAnimationFrame(tick);
        }

        resize();
        window.addEventListener("resize", resize);
        requestAnimationFrame(tick);
    }

    window.addEventListener("DOMContentLoaded", init);
}());
