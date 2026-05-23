(() => {
    'use strict'

    const canvas = document.getElementById('gameCanvas')
    const ctx = canvas.getContext('2d')
    const resetButton = document.getElementById('resetButton')

    const keys = new Set()
    const view = {
        width: 960,
        height: 540,
        dpr: 1,
    }

    const world = {
        width: 2600,
        height: 540,
    }

    const player = {
        x: 80,
        y: 0,
        width: 34,
        height: 52,
        vx: 0,
        vy: 0,
        speed: 270,
        jumpSpeed: 640,
        grounded: false,
    }

    const camera = {
        x: 0,
    }

    const platforms = [
        { x: 0, y: 470, width: 2600, height: 70, rise: 0 },
        { x: 620, y: 390, width: 320, height: 24, rise: 105 },
    ]

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
    const lerp = (a, b, t) => a + (b - a) * t

    function resize() {
        const rect = canvas.getBoundingClientRect()
        view.width = Math.max(320, rect.width)
        view.height = Math.max(300, rect.height)
        view.dpr = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.round(view.width * view.dpr)
        canvas.height = Math.round(view.height * view.dpr)
        world.height = view.height
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

    function resetPlayer() {
        player.x = 80
        player.y = platforms[0].y - player.height
        player.vx = 0
        player.vy = 0
        player.grounded = false
        camera.x = 0
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
        const target = player.x + player.width * 0.5 - view.width * 0.4
        const maxCamera = Math.max(0, world.width - view.width)
        camera.x = clamp(lerp(camera.x, target, 1 - Math.exp(-8 * dt)), 0, maxCamera)
    }

    function draw() {
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0)
        ctx.clearRect(0, 0, view.width, view.height)

        drawSky()
        ctx.save()
        ctx.translate(-camera.x, 0)
        drawPlatforms()
        drawPlayer()
        ctx.restore()
    }

    function drawSky() {
        ctx.fillStyle = '#9ec9ff'
        ctx.fillRect(0, 0, view.width, view.height)
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
        ctx.fillStyle = '#1f2735'
        ctx.fillRect(player.x, player.y, player.width, player.height)
        ctx.fillStyle = '#5df4ff'
        ctx.fillRect(player.x + 8, player.y + 10, player.width - 16, 12)
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
