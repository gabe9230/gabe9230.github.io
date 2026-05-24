(() => {
    'use strict'

    const canvas = document.getElementById('gameCanvas')
    const ctx = canvas.getContext('2d')
    const resetButton = document.getElementById('resetButton')

    if (!window.Matter) {
        ctx.fillStyle = '#111319'
        ctx.fillRect(0, 0, canvas.width || 640, canvas.height || 360)
        ctx.fillStyle = '#f5f7fb'
        ctx.font = '20px Arial'
        ctx.fillText('Matter.js failed to load.', 24, 42)
        return
    }

    const { Bodies, Body, Composite, Engine, Vector } = window.Matter

    const keys = new Set()

    // Change these layout values here; HTML attributes and CSS variables are derived from them.
    const view = {
        width: 1280,
        height: 720,
        minWidth: 320,
        minHeight: 300,
        shellPadding: 16,
        compactShellPadding: 10,
        shellGap: 12,
        headerGap: 12,
        buttonMinHeight: 40,
        buttonPaddingX: 18,
        canvasMinHeight: 360,
        compactCanvasMinHeight: 340,
        canvasBorderRadius: 6,
        compactBreakpoint: 560,
        renderWidth: 1280,
        renderHeight: 720,
        dpr: 1,
    }

    const world = {
        width: 2600,
        height: 540,
    }

    const camera = {
        x: 0,
    }

    const platforms = [
        { x: 0, y: 470, width: 2600, height: 70, rise: 0 },
        { x: 620, y: 390, width: 320, height: 24, rise: 105 },
    ]

    const spiderConfig = {
        bodyRadius: 28,
        bodyDensity: 0.003,
        stanceHeight: 92,
        legThickness: 6,
        footRadius: 4,
        segmentLengths: [48, 44, 40],
        maxHipTorque: 2.6,
        maxKneeTorque: 1.9,
        maxAnkleTorque: 1.3,
        torqueForceScale: 4.4,
        supportSpring: 0.009,
        supportDamping: 0.013,
        moveForce: 0.0038,
        maxSpeed: 5.4,
        jumpForce: 0.08,
    }

    const legConfigs = [
        { hip: { x: -25, y: -10 }, restX: -122, bend: -1, upperClearance: 62, lowerClearance: 36 },
        { hip: { x: -13, y: 18 }, restX: -72, bend: 1, upperClearance: 42, lowerClearance: 25 },
        { hip: { x: 13, y: 18 }, restX: 72, bend: -1, upperClearance: 42, lowerClearance: 25 },
        { hip: { x: 25, y: -10 }, restX: 122, bend: 1, upperClearance: 62, lowerClearance: 36 },
    ]

    let engine = null
    let terrainBodies = []
    let spiderBody = null
    let legs = []
    let lastTime = 0
    let jumpCooldown = 0
    let grounded = false

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
    const lerp = (a, b, t) => a + (b - a) * t

    function applyViewVariables() {
        const root = document.documentElement.style
        const vars = {
            '--view-width': `${view.width}px`,
            '--view-height': `${view.height}px`,
            '--view-aspect-ratio': `${view.width} / ${view.height}`,
            '--shell-padding': `${view.shellPadding}px`,
            '--compact-shell-padding': `${view.compactShellPadding}px`,
            '--shell-gap': `${view.shellGap}px`,
            '--header-gap': `${view.headerGap}px`,
            '--button-min-height': `${view.buttonMinHeight}px`,
            '--button-padding-x': `${view.buttonPaddingX}px`,
            '--canvas-min-height': `${view.canvasMinHeight}px`,
            '--compact-canvas-min-height': `${view.compactCanvasMinHeight}px`,
            '--canvas-border-radius': `${view.canvasBorderRadius}px`,
        }

        for (const [name, value] of Object.entries(vars)) {
            root.setProperty(name, value)
        }

        document.body.classList.toggle(
            'is-compact',
            window.innerWidth <= view.compactBreakpoint
        )
        canvas.setAttribute('width', String(view.width))
        canvas.setAttribute('height', String(view.height))
    }

    function resize() {
        applyViewVariables()
        const rect = canvas.getBoundingClientRect()
        view.renderWidth = Math.max(view.minWidth, rect.width)
        view.renderHeight = Math.max(view.minHeight, rect.height)
        view.dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(view.renderWidth * view.dpr)
        canvas.height = Math.round(view.renderHeight * view.dpr)
        world.height = view.renderHeight
        layoutPlatforms()
    }

    function layoutPlatforms() {
        const ground = platforms[0]
        const groundY = world.height - ground.height
        ground.y = groundY
        ground.width = world.width

        for (const platform of platforms.slice(1)) {
            platform.y = clamp(groundY - platform.rise, 86, groundY - platform.height - 12)
        }
    }

    function setupPhysics() {
        engine = Engine.create({
            enableSleeping: false,
            positionIterations: 10,
            velocityIterations: 8,
        })
        engine.gravity.y = 1.15
        engine.gravity.scale = 0.001

        terrainBodies = platforms.map((platform) =>
            Bodies.rectangle(
                platform.x + platform.width * 0.5,
                platform.y + platform.height * 0.5,
                platform.width,
                platform.height,
                {
                    isStatic: true,
                    friction: 1,
                    label: 'terrain',
                }
            )
        )

        spiderBody = Bodies.circle(
            160,
            platforms[0].y - spiderConfig.stanceHeight,
            spiderConfig.bodyRadius,
            {
                density: spiderConfig.bodyDensity,
                friction: 0.9,
                frictionAir: 0.03,
                restitution: 0,
                label: 'spider-body',
            }
        )

        legs = legConfigs.map((config) => ({
            ...config,
            foot: { x: 160 + config.restX, y: platforms[0].y },
            points: [],
            contact: false,
            maxSupport: 0,
        }))

        Composite.add(engine.world, [...terrainBodies, spiderBody])
        updateLegGeometry(1 / 60)
        updateCamera(1)
    }

    function resetPhysics() {
        setupPhysics()
        lastTime = 0
        jumpCooldown = 0
    }

    function update(dt) {
        if (!engine || !spiderBody) {
            return
        }

        jumpCooldown = Math.max(0, jumpCooldown - dt)
        updateLegGeometry(dt)
        applyInputForces()
        applyLimitedLegSupport()
        Engine.update(engine, dt * 1000)
        updateGrounded()
        updateCamera(dt)
    }

    function updateLegGeometry(dt) {
        for (const leg of legs) {
            const hip = getHipWorld(leg)
            const movementBias = clamp(spiderBody.velocity.x / spiderConfig.maxSpeed, -1, 1) * 18
            const desiredX = clamp(spiderBody.position.x + leg.restX + movementBias, 12, world.width - 12)
            const terrainY = findTerrainTop(desiredX, hip.y)
            const reachableFoot = terrainY
                ? { x: desiredX, y: terrainY - spiderConfig.footRadius }
                : { x: desiredX, y: spiderBody.position.y + spiderConfig.bodyRadius + 48 }
            const targetDistance = Math.hypot(reachableFoot.x - hip.x, reachableFoot.y - hip.y)
            const maxReach = spiderConfig.segmentLengths.reduce((sum, length) => sum + length, 0)
            const canReach = targetDistance <= maxReach + 4

            leg.contact = Boolean(terrainY && canReach)

            const followRate = leg.contact ? 1 - Math.exp(-18 * dt) : 1 - Math.exp(-10 * dt)
            leg.foot.x = lerp(leg.foot.x, reachableFoot.x, followRate)
            leg.foot.y = lerp(leg.foot.y, reachableFoot.y, followRate)

            leg.points = solveLegIk(hip, leg.foot, leg)
            leg.maxSupport = leg.contact ? calculateMaxSupport(leg) : 0
        }
    }

    function getHipWorld(leg) {
        const local = Vector.rotate(leg.hip, spiderBody.angle)
        return {
            x: spiderBody.position.x + local.x,
            y: spiderBody.position.y + local.y,
        }
    }

    function findTerrainTop(x, hipY) {
        let bestY = null
        const maxDrop = spiderConfig.segmentLengths.reduce((sum, length) => sum + length, 0) + 20

        for (const platform of platforms) {
            const withinX = x >= platform.x && x <= platform.x + platform.width
            const belowHip = platform.y >= hipY - 22
            const reachableY = platform.y <= hipY + maxDrop

            if (withinX && belowHip && reachableY && (bestY === null || platform.y < bestY)) {
                bestY = platform.y
            }
        }

        return bestY
    }

    function calculateMaxSupport(leg) {
        const [hip, knee, ankle, foot] = leg.points
        const hipLever = Math.max(18, Math.abs(foot.x - hip.x))
        const kneeLever = Math.max(14, Math.abs(foot.x - knee.x))
        const ankleLever = Math.max(10, Math.abs(foot.x - ankle.x))

        return Math.min(
            (spiderConfig.maxHipTorque * spiderConfig.torqueForceScale) / hipLever,
            (spiderConfig.maxKneeTorque * spiderConfig.torqueForceScale) / kneeLever,
            (spiderConfig.maxAnkleTorque * spiderConfig.torqueForceScale) / ankleLever
        )
    }

    function solveLegIk(hip, foot, leg) {
        const lengths = spiderConfig.segmentLengths
        const totalLength = lengths.reduce((sum, length) => sum + length, 0)
        const dx = foot.x - hip.x
        const dy = foot.y - hip.y
        const distance = Math.max(0.001, Math.hypot(dx, dy))
        const direction = { x: dx / distance, y: dy / distance }
        const target =
            distance > totalLength
                ? {
                      x: hip.x + direction.x * totalLength,
                      y: hip.y + direction.y * totalLength,
                  }
                : foot
        const normal = { x: -direction.y * leg.bend, y: direction.x * leg.bend }
        const points = [
            { ...hip },
            {
                x: hip.x + direction.x * lengths[0] + normal.x * 18,
                y: hip.y + direction.y * lengths[0] + normal.y * 18,
            },
            {
                x: hip.x + direction.x * (lengths[0] + lengths[1]) + normal.x * 15,
                y: hip.y + direction.y * (lengths[0] + lengths[1]) + normal.y * 15,
            },
            { ...target },
        ]

        for (let iteration = 0; iteration < 8; iteration += 1) {
            keepJointsUp(points, target, leg)
            points[3] = { ...target }

            for (let i = 2; i >= 0; i -= 1) {
                const next = points[i + 1]
                const current = points[i]
                const vector = normalize(current.x - next.x, current.y - next.y)
                points[i] = {
                    x: next.x + vector.x * lengths[i],
                    y: next.y + vector.y * lengths[i],
                }
            }

            points[0] = { ...hip }

            for (let i = 1; i < points.length; i += 1) {
                const previous = points[i - 1]
                const current = points[i]
                const vector = normalize(current.x - previous.x, current.y - previous.y)
                points[i] = {
                    x: previous.x + vector.x * lengths[i - 1],
                    y: previous.y + vector.y * lengths[i - 1],
                }
            }
        }

        keepJointsUp(points, target, leg)
        return points
    }

    function keepJointsUp(points, foot, leg) {
        points[1].y = Math.min(points[1].y, foot.y - leg.upperClearance)
        points[2].y = Math.min(points[2].y, foot.y - leg.lowerClearance)
    }

    function normalize(x, y) {
        const length = Math.max(0.001, Math.hypot(x, y))
        return {
            x: x / length,
            y: y / length,
        }
    }

    function applyInputForces() {
        let move = 0
        if (keys.has('KeyA')) move -= 1
        if (keys.has('KeyD')) move += 1

        if (move !== 0) {
            const velocityError = move * spiderConfig.maxSpeed - spiderBody.velocity.x
            const forceX = clamp(velocityError * 0.0009, -spiderConfig.moveForce, spiderConfig.moveForce)
            Body.applyForce(spiderBody, spiderBody.position, { x: forceX, y: 0 })
        }

        if (keys.has('KeyW') && grounded && jumpCooldown <= 0) {
            Body.applyForce(spiderBody, spiderBody.position, {
                x: 0,
                y: -spiderConfig.jumpForce,
            })
            jumpCooldown = 0.24
        }

        if (keys.has('KeyS')) {
            Body.applyForce(spiderBody, spiderBody.position, { x: 0, y: 0.012 })
        }
    }

    function applyLimitedLegSupport() {
        const contactLegs = legs.filter((leg) => leg.contact && leg.maxSupport > 0)

        if (contactLegs.length === 0) {
            return
        }

        const footY = contactLegs.reduce((sum, leg) => sum + leg.foot.y, 0) / contactLegs.length
        const desiredBodyY = footY - spiderConfig.stanceHeight
        const heightError = spiderBody.position.y - desiredBodyY
        const supportRequest =
            heightError * spiderConfig.supportSpring +
            Math.max(0, spiderBody.velocity.y) * spiderConfig.supportDamping
        const totalAvailable = contactLegs.reduce((sum, leg) => sum + leg.maxSupport, 0)
        const totalSupport = clamp(supportRequest, 0, totalAvailable)

        if (totalSupport <= 0) {
            return
        }

        for (const leg of contactLegs) {
            const share = totalSupport * (leg.maxSupport / totalAvailable)
            Body.applyForce(
                spiderBody,
                { x: leg.foot.x, y: spiderBody.position.y },
                { x: 0, y: -share }
            )
        }
    }

    function updateGrounded() {
        grounded =
            legs.some((leg) => leg.contact) ||
            platforms.some((platform) => circleTouchesPlatform(spiderBody, platform))
    }

    function circleTouchesPlatform(circle, platform) {
        const x = clamp(circle.position.x, platform.x, platform.x + platform.width)
        const y = clamp(circle.position.y, platform.y, platform.y + platform.height)
        return Math.hypot(circle.position.x - x, circle.position.y - y) <= spiderConfig.bodyRadius + 1
    }

    function updateCamera(dt) {
        const target = spiderBody.position.x - view.renderWidth * 0.38
        const maxCamera = Math.max(0, world.width - view.renderWidth)
        camera.x = clamp(lerp(camera.x, target, 1 - Math.exp(-8 * dt)), 0, maxCamera)
    }

    function draw() {
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
        ctx.clearRect(0, 0, view.renderWidth, view.renderHeight)

        drawSky()
        ctx.save()
        ctx.translate(-camera.x, 0)
        drawPlatforms()
        drawSpider()
        ctx.restore()
    }

    function drawSky() {
        ctx.fillStyle = '#9ec9ff'
        ctx.fillRect(0, 0, view.renderWidth, view.renderHeight)
    }

    function drawPlatforms() {
        for (const body of terrainBodies) {
            const height = body.bounds.max.y - body.bounds.min.y
            drawVertices(body.vertices, height > 30 ? '#40502f' : '#39445b')
            ctx.fillStyle = height > 30 ? '#627a43' : '#56627b'
            ctx.fillRect(body.bounds.min.x, body.bounds.min.y, body.bounds.max.x - body.bounds.min.x, 8)
        }
    }

    function drawSpider() {
        for (const leg of legs) {
            drawLeg(leg)
        }

        ctx.fillStyle = '#1f2735'
        ctx.beginPath()
        ctx.arc(
            spiderBody.position.x,
            spiderBody.position.y,
            spiderConfig.bodyRadius,
            0,
            Math.PI * 2
        )
        ctx.fill()

        ctx.fillStyle = '#5df4ff'
        ctx.beginPath()
        ctx.arc(
            spiderBody.position.x + Math.cos(spiderBody.angle) * 9,
            spiderBody.position.y - 6,
            5,
            0,
            Math.PI * 2
        )
        ctx.fill()
    }

    function drawLeg(leg) {
        for (let i = 0; i < leg.points.length - 1; i += 1) {
            drawSegmentCollider(leg.points[i], leg.points[i + 1])
        }

        ctx.fillStyle = '#5df4ff'
        for (const joint of leg.points.slice(1, 3)) {
            ctx.fillRect(joint.x - 2, joint.y - 2, 4, 4)
        }

        ctx.beginPath()
        ctx.arc(leg.foot.x, leg.foot.y, spiderConfig.footRadius, 0, Math.PI * 2)
        ctx.fill()
    }

    function drawSegmentCollider(a, b) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const length = Math.hypot(dx, dy)
        const angle = Math.atan2(dy, dx)

        ctx.save()
        ctx.translate(a.x + dx * 0.5, a.y + dy * 0.5)
        ctx.rotate(angle)
        ctx.fillStyle = '#1f2735'
        ctx.fillRect(
            -length * 0.5,
            -spiderConfig.legThickness * 0.5,
            length,
            spiderConfig.legThickness
        )
        ctx.restore()
    }

    function drawVertices(vertices, color) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.moveTo(vertices[0].x, vertices[0].y)
        for (const vertex of vertices.slice(1)) {
            ctx.lineTo(vertex.x, vertex.y)
        }
        ctx.closePath()
        ctx.fill()
    }

    let resizeTimer = 0
    window.addEventListener('resize', () => {
        window.clearTimeout(resizeTimer)
        resizeTimer = window.setTimeout(() => {
            resize()
            resetPhysics()
        }, 120)
    })

    window.addEventListener('keydown', (event) => {
        if (['KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(event.code)) {
            event.preventDefault()
            keys.add(event.code)
        }
    })

    window.addEventListener('keyup', (event) => {
        keys.delete(event.code)
    })

    resetButton.addEventListener('click', resetPhysics)

    function frame(time) {
        const now = time / 1000
        const dt = lastTime ? Math.min(now - lastTime, 0.033) : 1 / 60
        lastTime = now
        update(dt)
        draw()
        requestAnimationFrame(frame)
    }

    resize()
    resetPhysics()
    requestAnimationFrame(frame)
})()
