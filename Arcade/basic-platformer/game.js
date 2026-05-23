(() => {
    'use strict'

    const canvas = document.getElementById('gameCanvas')
    const ctx = canvas.getContext('2d')
    const resetButton = document.getElementById('resetButton')

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

    const player = {
        x: 80,
        y: 0,
        width: 84,
        height: 70,
        bodyRadius: 26,
        bodyOffsetX: 42,
        bodyOffsetY: 34,
        vx: 0,
        vy: 0,
        speed: 270,
        jumpSpeed: 640,
        grounded: false,
        legs: [],
    }

    const camera = {
        x: 0,
    }

    const platforms = [
        { x: 0, y: 470, width: 2600, height: 70, rise: 0 },
        { x: 620, y: 390, width: 320, height: 24, rise: 105 },
    ]

    const legSegmentLengths = [30, 28, 26]
    const legSegmentThickness = 5
    const legConfigs = [
        { hipX: -20, hipY: -10, restX: -84, bend: -1, lift: 20 },
        { hipX: -9, hipY: 16, restX: -48, bend: 1, lift: 15 },
        { hipX: 9, hipY: 16, restX: 48, bend: -1, lift: 15 },
        { hipX: 20, hipY: -10, restX: 84, bend: 1, lift: 20 },
    ]

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
    const lerp = (a, b, t) => a + (b - a) * t
    const smooth = (t) => t * t * (3 - 2 * t)

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
        resetIfBelowWorld()
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

    function getBodyCenter() {
        return {
            x: player.x + player.bodyOffsetX,
            y: player.y + player.bodyOffsetY,
        }
    }

    function getLegAnchor(leg) {
        const body = getBodyCenter()
        return {
            x: body.x + leg.hipX,
            y: body.y + leg.hipY,
        }
    }

    function getFootRestPosition(leg) {
        const body = getBodyCenter()
        const movementBias = clamp(player.vx / player.speed, -1, 1) * 18
        const x = clamp(body.x + leg.restX + movementBias, 12, world.width - 12)
        const supportY = player.grounded
            ? getFootSupportY(x, body.y)
            : body.y + player.bodyRadius + 30

        return { x, y: supportY }
    }

    function getFootSupportY(x, bodyY) {
        let bestY = platforms[0].y

        for (const platform of platforms) {
            const onPlatformX = x >= platform.x && x <= platform.x + platform.width
            const reachableFromBody = platform.y >= bodyY - 8

            if (onPlatformX && reachableFromBody && platform.y < bestY) {
                bestY = platform.y
            }
        }

        return bestY - 2
    }

    function resetLegs() {
        player.legs = legConfigs.map((config) => {
            const rest = getFootRestPosition(config)
            return {
                ...config,
                target: { ...rest },
                stepFrom: { ...rest },
                stepTo: { ...rest },
                stepProgress: 1,
                stepDuration: 0.15,
            }
        })
    }

    function resetPlayer() {
        player.x = 80
        player.y = platforms[0].y - player.height
        player.vx = 0
        player.vy = 0
        player.grounded = true
        camera.x = 0
        resetLegs()
    }

    function resetIfBelowWorld() {
        if (player.y > world.height + 200) {
            resetPlayer()
        }
    }

    function update(dt) {
        let move = 0
        if (keys.has('KeyA')) move -= 1
        if (keys.has('KeyD')) move += 1

        player.vx = move * player.speed

        if (keys.has('KeyW') && player.grounded) {
            player.vy = -player.jumpSpeed
            player.grounded = false
        }

        if (keys.has('KeyS') && !player.grounded) {
            player.vy += 900 * dt
        }

        player.vy += 1600 * dt
        player.vy = clamp(player.vy, -900, 980)

        movePlayer(player.vx * dt, 0)
        movePlayer(0, player.vy * dt)

        player.x = clamp(player.x, 0, world.width - player.width)
        resetIfBelowWorld()
        updateCamera(dt)
        updateLegs(dt)
    }

    function movePlayer(dx, dy) {
        player.x += dx
        player.y += dy

        if (dy !== 0) {
            player.grounded = false
        }

        for (const platform of platforms) {
            if (!intersects(player, platform)) {
                continue
            }

            if (dx > 0) {
                player.x = platform.x - player.width
                player.vx = 0
            } else if (dx < 0) {
                player.x = platform.x + platform.width
                player.vx = 0
            }

            if (dy > 0) {
                player.y = platform.y - player.height
                player.vy = 0
                player.grounded = true
            } else if (dy < 0) {
                player.y = platform.y + platform.height
                player.vy = 0
            }
        }
    }

    function intersects(a, b) {
        return (
            a.x < b.x + b.width &&
            a.x + a.width > b.x &&
            a.y < b.y + b.height &&
            a.y + a.height > b.y
        )
    }

    function updateCamera(dt) {
        const target = player.x + player.width * 0.5 - view.renderWidth * 0.4
        const maxCamera = Math.max(0, world.width - view.renderWidth)
        camera.x = clamp(lerp(camera.x, target, 1 - Math.exp(-8 * dt)), 0, maxCamera)
    }

    function updateLegs(dt) {
        if (player.legs.length === 0) {
            resetLegs()
        }

        for (const leg of player.legs) {
            const rest = getFootRestPosition(leg)

            if (!player.grounded) {
                leg.stepProgress = 1
                leg.target.x = lerp(leg.target.x, rest.x, 1 - Math.exp(-12 * dt))
                leg.target.y = lerp(leg.target.y, rest.y, 1 - Math.exp(-12 * dt))
                continue
            }

            const targetDistance = Math.hypot(
                rest.x - leg.target.x,
                rest.y - leg.target.y
            )

            if (leg.stepProgress >= 1 && targetDistance > 24) {
                leg.stepFrom = { ...leg.target }
                leg.stepTo = { ...rest }
                leg.stepProgress = 0
            }

            if (leg.stepProgress < 1) {
                leg.stepProgress = Math.min(1, leg.stepProgress + dt / leg.stepDuration)
                const t = smooth(leg.stepProgress)
                leg.target.x = lerp(leg.stepFrom.x, leg.stepTo.x, t)
                leg.target.y =
                    lerp(leg.stepFrom.y, leg.stepTo.y, t) -
                    Math.sin(t * Math.PI) * leg.lift
            } else {
                leg.target.y = lerp(leg.target.y, rest.y, 1 - Math.exp(-18 * dt))
            }
        }
    }

    function solveLegIk(anchor, target, bend) {
        const totalLength = legSegmentLengths.reduce((sum, length) => sum + length, 0)
        const dx = target.x - anchor.x
        const dy = target.y - anchor.y
        const distance = Math.max(0.001, Math.hypot(dx, dy))
        const direction = { x: dx / distance, y: dy / distance }
        const clampedTarget =
            distance > totalLength
                ? {
                      x: anchor.x + direction.x * totalLength,
                      y: anchor.y + direction.y * totalLength,
                  }
                : target
        const normal = { x: -direction.y * bend, y: direction.x * bend }
        const points = [
            { ...anchor },
            {
                x: anchor.x + direction.x * legSegmentLengths[0] + normal.x * 14,
                y: anchor.y + direction.y * legSegmentLengths[0] + normal.y * 14,
            },
            {
                x:
                    anchor.x +
                    direction.x * (legSegmentLengths[0] + legSegmentLengths[1]) +
                    normal.x * 10,
                y:
                    anchor.y +
                    direction.y * (legSegmentLengths[0] + legSegmentLengths[1]) +
                    normal.y * 10,
            },
            { ...clampedTarget },
        ]

        for (let iteration = 0; iteration < 6; iteration += 1) {
            points[3] = { ...clampedTarget }

            for (let i = 2; i >= 0; i -= 1) {
                const next = points[i + 1]
                const current = points[i]
                const vector = normalize(current.x - next.x, current.y - next.y)
                points[i] = {
                    x: next.x + vector.x * legSegmentLengths[i],
                    y: next.y + vector.y * legSegmentLengths[i],
                }
            }

            points[0] = { ...anchor }

            for (let i = 1; i < points.length; i += 1) {
                const previous = points[i - 1]
                const current = points[i]
                const vector = normalize(current.x - previous.x, current.y - previous.y)
                points[i] = {
                    x: previous.x + vector.x * legSegmentLengths[i - 1],
                    y: previous.y + vector.y * legSegmentLengths[i - 1],
                }
            }
        }

        return points
    }

    function normalize(x, y) {
        const length = Math.max(0.001, Math.hypot(x, y))
        return {
            x: x / length,
            y: y / length,
        }
    }

    function draw() {
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
        ctx.clearRect(0, 0, view.renderWidth, view.renderHeight)

        drawSky()
        ctx.save()
        ctx.translate(-camera.x, 0)
        drawPlatforms()
        drawPlayer()
        ctx.restore()
    }

    function drawSky() {
        ctx.fillStyle = '#9ec9ff'
        ctx.fillRect(0, 0, view.renderWidth, view.renderHeight)
    }

    function drawPlatforms() {
        for (const platform of platforms) {
            ctx.fillStyle = platform.height > 30 ? '#40502f' : '#39445b'
            ctx.fillRect(platform.x, platform.y, platform.width, platform.height)
            ctx.fillStyle = platform.height > 30 ? '#627a43' : '#56627b'
            ctx.fillRect(platform.x, platform.y, platform.width, 8)
        }
    }

    function drawPlayer() {
        for (const leg of player.legs) {
            drawLeg(leg)
        }

        const body = getBodyCenter()
        ctx.fillStyle = '#1f2735'
        ctx.beginPath()
        ctx.arc(body.x, body.y, player.bodyRadius, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = '#5df4ff'
        ctx.beginPath()
        ctx.arc(body.x + player.bodyRadius * 0.34, body.y - 5, 5, 0, Math.PI * 2)
        ctx.fill()
    }

    function drawLeg(leg) {
        const anchor = getLegAnchor(leg)
        const joints = solveLegIk(anchor, leg.target, leg.bend)

        for (let i = 0; i < joints.length - 1; i += 1) {
            drawSegment(joints[i], joints[i + 1], legSegmentThickness, '#1f2735')
        }

        ctx.fillStyle = '#5df4ff'
        for (const joint of joints.slice(1, 3)) {
            ctx.fillRect(joint.x - 2, joint.y - 2, 4, 4)
        }
    }

    function drawSegment(a, b, thickness, color) {
        const dx = b.x - a.x
        const dy = b.y - a.y
        const length = Math.hypot(dx, dy)
        const angle = Math.atan2(dy, dx)

        ctx.save()
        ctx.translate(a.x + dx * 0.5, a.y + dy * 0.5)
        ctx.rotate(angle)
        ctx.fillStyle = color
        ctx.fillRect(-length * 0.5, -thickness * 0.5, length, thickness)
        ctx.restore()
    }

    let lastTime = 0
    function frame(time) {
        const now = time / 1000
        const dt = lastTime ? Math.min(now - lastTime, 0.033) : 0
        lastTime = now
        update(dt)
        draw()
        requestAnimationFrame(frame)
    }

    window.addEventListener('keydown', (event) => {
        if (['KeyA', 'KeyD', 'KeyW', 'KeyS'].includes(event.code)) {
            event.preventDefault()
            keys.add(event.code)
        }
    })

    window.addEventListener('keyup', (event) => {
        keys.delete(event.code)
    })

    window.addEventListener('resize', resize)
    resetButton.addEventListener('click', resetPlayer)

    resize()
    resetPlayer()
    requestAnimationFrame(frame)
})()
