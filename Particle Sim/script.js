//Global Constants
const canvas = document.getElementById("c")
const ctx = canvas.getContext("2d")
canvas.width = window.innerWidth * 0.8
canvas.height = window.innerHeight * 0.8
const Width = canvas.width; const Height = canvas.height;
const ParticleCount = 500
const DistanceScale = 0.01;
const Hydrogen = {
    Protons: 1,
    Neutrons: 0,
    EShell0: 1,
    EShell1: 0,
    EShell2: 0,
    X: Math.random() * Width,
    Y: Math.random() * Height,
    VX: 0,
    VY: 0,
}
const Helium = {
    Protons: 3,
    Neutrons: 4,
    EShell0: 2,
    EShell1: 0,
    EShell2: 0,
    X: Math.random() * Width,
    Y: Math.random() * Height,
    VX: 0,
    VY: 0,
}
const Lithium = {
    Protons: 3,
    Neutrons: 4,
    EShell0: 2,
    EShell1: 1,
    EShell2: 0,
    X: Math.random() * Width,
    Y: Math.random() * Height,
    VX: 0,
    VY: 0,
}
//Global Variables
let ParticleArr = []

//Helper Functions
function getCharge(p) {
    return p.Protons - p.EShell0 - p.EShell1 - p.EShell2
}
function getMass(p) {
    return p.Protons + p.Neutrons
}
function drawCircle(x, y, r, c) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fillStyle = c;
    ctx.fill();
}
function fuseInto(a, b) {
    // mass-weighted momentum & position (toy mass = nucleons)
    const m1 = Math.max(1e-6, getMass(a));
    const m2 = Math.max(1e-6, getMass(b));
    const mt = m1 + m2;

    a.VX = (a.VX * m1 + b.VX * m2) / mt;
    a.VY = (a.VY * m1 + b.VY * m2) / mt;
    a.X = (a.X * m1 + b.X * m2) / mt;
    a.Y = (a.Y * m1 + b.Y * m2) / mt;

    // Sum nucleons & electrons
    a.Protons += b.Protons;
    a.Neutrons += b.Neutrons;
    a.EShell0 += b.EShell0;
    a.EShell1 += b.EShell1;
    a.EShell2 += b.EShell2;

    // Decide & eject neutrons (after combining)
    const nEject = neutronsToEject(a.Protons, a.Neutrons);
    ejectNeutrons(a, nEject, /*kick=*/3.0);
}

// Spawn a free neutron particle
function createNeutron(x, y, vx = 0, vy = 0) {
    return {
        Protons: 0, Neutrons: 1,
        EShell0: 0, EShell1: 0, EShell2: 0,
        X: x, Y: y, VX: vx, VY: vy
    };
}

// Decide how many neutrons to eject from the fusion product (toy rule)
// - If combined nucleons >= 6 → try to eject 2
// - Else if combined nucleons >= 4 → eject 1
// - Else → 0
function neutronsToEject(totalP, totalN) {
    const A = totalP + totalN;
    let n = (A >= 6) ? 2 : (A >= 4 ? 1 : 0);
    n = Math.min(n, totalN); // can’t eject more than you have
    return n;
}

// Eject 'count' neutrons; apply opposite recoil to conserve momentum (approximately)
function ejectNeutrons(product, count, kick = 3.0) {
    if (count <= 0) return;

    const mProd = Math.max(1e-6, getMass(product));
    let recoilVX = 0, recoilVY = 0;

    for (let k = 0; k < count; k++) {
        // random direction
        const theta = Math.random() * 2 * Math.PI;
        const nvx = Math.cos(theta) * kick;
        const nvy = Math.sin(theta) * kick;

        // slight position offset to avoid overlapping arcs
        const off = 0.2; // fm (since 1 px == 1 fm)
        const nx = product.X + Math.cos(theta) * off;
        const ny = product.Y + Math.sin(theta) * off;

        ParticleArr.push(createNeutron(nx, ny, nvx, nvy));

        // recoil accumulates opposite to ejected neutron
        recoilVX -= nvx;
        recoilVY -= nvy;
    }

    // Apply recoil scaled by neutron mass / product mass (toy: mn = 1)
    product.VX += recoilVX / mProd;
    product.VY += recoilVY / mProd;

    // Remove the ejected neutrons from the nucleus
    product.Neutrons = Math.max(0, product.Neutrons - count);
}

//Startup Functions
function populate() {
    ParticleArr.length = 0;
    for (let i = 0; i < ParticleCount; i++) {
        const r = Math.random();
        let base;
        if (r < 0.5) base = Hydrogen;
        else if (r < 0.85) base = Helium;
        else base = Lithium;

        // make a fresh particle with its own random position & zero velocity
        ParticleArr.push({
            ...base,
            X: Math.random() * Width,
            Y: Math.random() * Height,
            VX: 0,
            VY: 0
        });
    }
}
//Loop Functions
function move() {
    ParticleArr.forEach(function (index) {
        clampVel(index, 3)
        index.X += index.VX
        index.Y += index.VY
    })
    ParticleArr = ParticleArr.filter(p =>
        p.X >= 0 && p.X <= Width && p.Y >= 0 && p.Y <= Height
    );
}
function clampVel(p, vmax = 8) {
    if (p.VX > vmax) p.VX = vmax; else if (p.VX < -vmax) p.VX = -vmax;
    if (p.VY > vmax) p.VY = vmax; else if (p.VY < -vmax) p.VY = -vmax;
}
function electrostatic(a, b, dt = 1, k = 1000, softening = 0.3) {
    const s = DistanceScale;
    const dx = (b.X - a.X) * s;
    const dy = (b.Y - a.Y) * s;

    const r2 = dx * dx + dy * dy + (softening * s) * (softening * s);
    const r = Math.sqrt(r2);
    if (!isFinite(r) || r === 0) return;
    const ux = dx / r, uy = dy / r;

    const q1 = getCharge(a), q2 = getCharge(b);
    const m1 = Math.max(1e-6, getMass(a));
    const m2 = Math.max(1e-6, getMass(b));

    const F = k * q1 * -q2 / r2;

    a.VX += (F / m1) * ux * dt;
    a.VY += (F / m1) * uy * dt;
    b.VX -= (F / m2) * ux * dt;
    b.VY -= (F / m2) * uy * dt;
}
function fusionPass(fusionR = 0.5) {
    const s = (typeof DistanceScale !== 'undefined') ? DistanceScale : 1;
    const thresh2 = (fusionR * s) * (fusionR * s);
    const removed = new Set();

    for (let i = 0; i < ParticleArr.length; i++) {
        if (removed.has(i)) continue;
        const a = ParticleArr[i];

        for (let j = i + 1; j < ParticleArr.length; j++) {
            if (removed.has(j)) continue;
            const b = ParticleArr[j];

            const dx = (b.X - a.X) * s;
            const dy = (b.Y - a.Y) * s;
            if (dx * dx + dy * dy <= thresh2) {
                // survivor = heavier (ties -> a)
                const mA = getMass(a), mB = getMass(b);
                if (mA >= mB) {
                    fuseInto(a, b);   // b -> a
                    removed.add(j);
                } else {
                    fuseInto(b, a);   // a -> b
                    removed.add(i);
                    break;            // i consumed; go to next i
                }
            }
        }
    }

    if (removed.size) {
        ParticleArr = ParticleArr.filter((_, idx) => !removed.has(idx));
    }
}
function strongNuclear(
    a, b,
    dt = 1,
    g_attr = 1e6,
    r0    = 1.0,     // fm
    coreR = 0.5,     // fm
    g_core = 5e4,    // smaller than g_attr so it’s net-attractive outside core
    soft  = 0.1  
) {
    // Use DistanceScale if defined; else 1
    const s = (typeof DistanceScale !== 'undefined') ? DistanceScale : 1;

    // Geometry
    const dx = (b.X - a.X) * s;
    const dy = (b.Y - a.Y) * s;
    const r2 = dx * dx + dy * dy + (soft * s) * (soft * s);
    const r = Math.sqrt(r2);
    if (!isFinite(r) || r === 0) return;

    const ux = dx / r;
    const uy = dy / r;

    // "Mass" here = nucleon count; skip non-physical
    const Na = Math.max(1e-6, getMass(a));
    const Nb = Math.max(1e-6, getMass(b));

    // Scale length params with the distance scale
    const r0s = r0 * s;
    const coreRs = coreR * s;

    // Attractive Yukawa magnitude (always positive)
    let Fmag = g_attr * (Na * Nb) * Math.exp(-r / r0s) / r2;

    // Hard-core repulsion: subtract when inside core
    if (r < coreRs) {
        const x = (coreRs - r) / coreRs; // 0..1
        Fmag -= g_core * (x ** 4);
    }

    // Apply: Fmag > 0 => attraction along +ux for a and -ux for b
    const ax = (Fmag / Na) * ux;
    const ay = (Fmag / Na) * uy;
    const bx = -(Fmag / Nb) * ux;
    const by = -(Fmag / Nb) * uy;

    a.VX += ax * dt; a.VY += ay * dt;
    b.VX += bx * dt; b.VY += by * dt;
}
function weakNuclear(a, b, dt = 1, g = 5, r0 = 0.5, soft = 0.1) {
    const s = DistanceScale;
    const dx = (b.X - a.X) * s;
    const dy = (b.Y - a.Y) * s;
    const r2 = dx * dx + dy * dy + (soft * s) * (soft * s);
    const r = Math.sqrt(r2);
    if (!isFinite(r) || r === 0) return;
    const ux = dx / r, uy = dy / r;

    const pnWeight = (a.Protons * b.Neutrons + a.Neutrons * b.Protons);

    const r0s = r0 * s;
    const F = -g * pnWeight * Math.exp(-r / r0s) / r2;

    const m1 = Math.max(1e-6, getMass(a));
    const m2 = Math.max(1e-6, getMass(b));

    a.VX += (F / m1) * ux * dt;
    a.VY += (F / m1) * uy * dt;
    b.VX -= (F / m2) * ux * dt;
    b.VY -= (F / m2) * uy * dt;
}
function edgeRepulsion(p, dt = 1, kWall = 1e2, soft = 0.5) {
    kWall = kWall * Math.max(1, Math.abs(getCharge(p)))
    const s = DistanceScale;
    const m = Math.max(1e-6, getMass(p));

    const dL = p.X;              // to left   (x = 0)
    const dR = Width - p.X;     // to right  (x = Width)
    const dT = p.Y;              // to top    (y = 0)
    const dB = Height - p.Y;     // to bottom (y = Height)

    const FL = kWall / ((dL * s) * (dL * s) + (soft * s) * (soft * s)); // +x
    const FR = kWall / ((dR * s) * (dR * s) + (soft * s) * (soft * s)); // -x
    const FT = kWall / ((dT * s) * (dT * s) + (soft * s) * (soft * s)); // +y
    const FB = kWall / ((dB * s) * (dB * s) + (soft * s) * (soft * s)); // -y

    p.VX += ((dL > 0 ? FL : 0) - (dR > 0 ? FR : 0)) * (dt / m);
    p.VY += ((dT > 0 ? FT : 0) - (dB > 0 ? FB : 0)) * (dt / m);
}


function accumulateForces(dt = 1) {
    for (let i = 0; i < ParticleArr.length; i++) {
        for (let j = i + 1; j < ParticleArr.length; j++) {
            electrostatic(ParticleArr[i], ParticleArr[j], dt);
            weakNuclear(ParticleArr[i], ParticleArr[j], dt);
            strongNuclear(ParticleArr[i], ParticleArr[j], dt);
        }
    }
    for (let i = 0; i < ParticleArr.length; i++) {
        edgeRepulsion(ParticleArr[i], dt);
    }
}
function draw() {
    ctx.clearRect(0, 0, Width, Height)
    ctx.fillStyle = 'black'
    ctx.fillRect(0, 0, Width, Height)
    ParticleArr.forEach(function (index) {
        drawCircle(index.X, index.Y, Math.max(getMass(index) / 3, 0.5), "#ff6b6b")
    })
}
function loop() {
    accumulateForces()
    move()
    fusionPass(0.5)
    draw()
}
function Startup() {
    populate()
    setInterval(loop, 25)
}
Startup()