//Global Constants
const canvas = document.getElementById("c")
const ctx = canvas.getContext("2d")
const Width = canvas.width; const Height = canvas.height;
const ParticleCount = 500
const DistanceScale = 5000;
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
const Deuterium = {
    Protons: 1,
    Neutrons: 1,
    EShell0: 1,
    EShell1: 0,
    EShell2: 0,
    X: Math.random() * Width,
    Y: Math.random() * Height,
    VX: 0,
    VY: 0,
}
const Tritium = {
    Protons: 1,
    Neutrons: 2,
    EShell0: 1,
    EShell1: 0,
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
//Startup Functions
function populate() {
    ParticleArr.length = 0;
    for (let i = 0; i < ParticleCount; i++) {
        const r = Math.random();
        let base;
        if (r < 0.5) base = Hydrogen;
        else if (r < 0.85) base = Deuterium;
        else base = Tritium;

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
        clampVel(index,3)
        index.X += index.VX
        index.Y += index.VY
    })
    ParticleArr = ParticleArr.filter(p =>
		p.X >= 0 && p.X <= Width && p.Y >= 0 && p.Y <= Height
	);
}
function clampVel(p, vmax = 8) {
	if (p.VX >  vmax) p.VX =  vmax; else if (p.VX < -vmax) p.VX = -vmax;
	if (p.VY >  vmax) p.VY =  vmax; else if (p.VY < -vmax) p.VY = -vmax;
}
function electrostatic(a, b, dt = 1, k = 1000, softening = 1) {
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

    const F = k * q1 * q2 / r2;

    a.VX += (F / m1) * ux * dt;
    a.VY += (F / m1) * uy * dt;
    b.VX -= (F / m2) * ux * dt;
    b.VY -= (F / m2) * uy * dt;
}

function strongNuclear(a, b, dt = 1, g_attr = 8e5, r0 = 3, coreR = 0.2, g_core = 2e7, soft = 0.25) {
    const s = DistanceScale;
    const dx = (b.X - a.X) * s;
    const dy = (b.Y - a.Y) * s;
    const r2 = dx * dx + dy * dy + (soft * s) * (soft * s);
    const r = Math.sqrt(r2);
    if (!isFinite(r) || r === 0) return;
    const ux = dx / r, uy = dy / r;

    const Na = getMass(a), Nb = getMass(b);
    if (Na <= 0 || Nb <= 0) return;

    const r0s = r0 * s;
    const coreRs = coreR * s;

    const F_attr = -g_attr * (Na * Nb) * Math.exp(-r / r0s) / r2;

    let F_rep = 0;
    if (r < coreRs) {
        const x = (coreRs - r) / coreRs;   // 0..1
        F_rep = g_core * (x ** 4);
    }

    const F = F_attr + F_rep;

    const m1 = Math.max(1e-6, Na);
    const m2 = Math.max(1e-6, Nb);

    a.VX += (F / m1) * ux * dt;
    a.VY += (F / m1) * uy * dt;
    b.VX -= (F / m2) * ux * dt;
    b.VY -= (F / m2) * uy * dt;
}

function weakNuclear(a, b, dt = 1, g = 5e2, r0 = 2, soft = 0.25) {
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
function edgeRepulsion(p, dt = 1, kWall = 5e6, soft = 1) {
	const s  = DistanceScale;
	const m  = Math.max(1e-6, getMass(p));

	const dL = p.X;              // to left   (x = 0)
	const dR = Width  - p.X;     // to right  (x = Width)
	const dT = p.Y;              // to top    (y = 0)
	const dB = Height - p.Y;     // to bottom (y = Height)

	const FL = kWall / ( (dL*s)*(dL*s) + (soft*s)*(soft*s) ); // +x
	const FR = kWall / ( (dR*s)*(dR*s) + (soft*s)*(soft*s) ); // -x
	const FT = kWall / ( (dT*s)*(dT*s) + (soft*s)*(soft*s) ); // +y
	const FB = kWall / ( (dB*s)*(dB*s) + (soft*s)*(soft*s) ); // -y

	p.VX += ( (dL>0 ?  FL : 0) - (dR>0 ? FR : 0) ) * (dt / m);
	p.VY += ( (dT>0 ?  FT : 0) - (dB>0 ? FB : 0) ) * (dt / m);
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
        drawCircle(index.X, index.Y, getMass(index), "#ff6b6b")
    })
}
function loop() {
    accumulateForces()
    move()
    draw()
}
function Startup() {
    populate()
    setInterval(loop, 25)
}
Startup()