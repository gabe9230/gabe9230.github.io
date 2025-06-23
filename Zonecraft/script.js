/* ===================== Utility Helpers ======================= */
const rndInt = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a
const rndHex4 = () => rndInt(0, 0xffff).toString(16).padStart(4, '0')
const rndIpv4 = () =>
    `${rndInt(1, 223)}.${rndInt(0, 255)}.${rndInt(0, 255)}.${rndInt(1, 254)}`
const rndIpv6 = () => `2001:db8:${rndHex4()}:${rndHex4()}::${rndHex4()}`
const pick = (arr) => arr[rndInt(0, arr.length - 1)]

// keeps track of all audit entries
const auditLog = []

// metrics used by the dashboard and finalizeRequest()
const metrics = {
    processed: 0,
    errors: 0,
    policyScore: 100,
    escalations: 0,
    errRate: 0,
    saves: 0,
}

const panels = {
    terminal: document.getElementById('terminal'),
    infoPanel: document.getElementById('infoPanel'),
}

/* ======================= Zone builder ======================== */
const ROOT_SERVERS = 'abcdefghijklm'
    .split('')
    .map((l) => `${l}.root-servers.net.`)
const APEX_SOA_TTL = 86400,
    APEX_NS_TTL = 86400,
    APEX_DNSKEY_TTL = 172800,
    ROOT_GLUE_TTL = 3600
const DS_ALGS = [8, 13],
    DS_DIGEST = { 8: 2, 13: 4 }
const SMALL = [300, 600, 900, 1800],
    MED = [3600, 7200, 14400],
    LARGE = [43200, 86400, 172800]
let ZONE_DB = [],
    TLD_COUNT
function todayISO() {
    return new Date().toISOString().slice(0, 10)
}
function serialToday() {
    const d = new Date()
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(
        2,
        '0'
    )}${String(d.getUTCDate()).padStart(2, '0')}00`
}
function showPanel(name, content = '') {
    const panel = panels[name]
    if (!panel) return
    panel.style.display = 'block'
    if (content) panel.textContent = content
}

function buildZone() {
    ZONE_DB = [];
    const seen = new Set();
    function addRecord(r) {
    // include comment fallback so we never drop the snapshot line
    const key = `${r.name||''}|${r.ttl||''}|${r.type||''}|${r.value||r.comment}`;
    if (!seen.has(key)) {
        seen.add(key);
        ZONE_DB.push(r);
    }
    }
    addRecord({ comment: `; ZoneCraft root snapshot ${todayISO()}` })

    const SY1 = [
        'ely',
        'zan',
        'arc',
        'sol',
        'lyn',
        'ora',
        'far',
        'vel',
        'nov',
        'aeg',
        'cer',
        'lum',
        'hyp',
        'xen',
        'kai',
    ]
    const SY2 = [
        'ion',
        'ex',
        'ium',
        'ara',
        'ent',
        'ora',
        'eus',
        'ix',
        'os',
        'al',
        'is',
        'eo',
    ]
    const makeTld = (i) =>
        (
            SY1[i % SY1.length] + SY2[Math.floor(i / SY1.length) % SY2.length]
        )
    TLD_COUNT = rndInt(1400, 1700)
    for (let i = 0; i < TLD_COUNT; i++) {
        const tld = makeTld(i)
        const ns1 = `ns1.nic.${tld}.`,
            ns2 = `ns2.nic.${tld}.`
        const nsTTL = pick(LARGE)
        addRecord({ name: tld, ttl: nsTTL, type: 'NS', value: ns1 })
        addRecord({ name: tld, ttl: nsTTL, type: 'NS', value: ns2 })
        if (Math.random() < 0.8) {
            const alg        = pick(DS_ALGS);             // 8 or 13
            const digestType = DS_DIGEST[alg];            // 2 → SHA-256, 4 → SHA-384
            const dsTTL      = pick(MED);
            const tag        = rndInt(10000, 60000);
            const hexLen = digestType === 2 ? 64 : 96;
            let digest = '';
            while (digest.length < hexLen) digest += rndHex4();
            digest = digest.slice(0, hexLen);
            addRecord({
                name: tld,
                ttl: dsTTL,
                type: 'DS',
                value: `${tag} ${alg} ${digestType} ${digest}`,
            })
        }
        const glueTTL = pick([...SMALL, ...MED])
        ;[ns1, ns2].forEach((ns) => {
            addRecord({
                name: ns,
                ttl: glueTTL,
                type: 'A',
                value: rndIpv4(),
            })
            addRecord({
                name: ns,
                ttl: glueTTL,
                type: 'AAAA',
                value: rndIpv6(),
            })
        })
    }
}

/* ===================== Terminal drawing ====================== */
const LH = 18
const state = {
    lines: [],
    input: '',
    cursor: true,
    history: [],
    histIndex: null,
    lastMatches: [],
}
function fmt(r) {
    return r.comment ? r.comment : `${r.name} ${r.ttl} IN ${r.type} ${r.value}`
}
function pushLine(text) {
    state.lines.push(text)
    const term = document.getElementById('terminal')
    term.textContent = state.lines.join('\n') + '\n> ' + state.input
    term.scrollTop = term.scrollHeight
}

function drawPrompt() {
    const term = document.getElementById('terminal')
    const content =
        state.lines.join('\n') +
        '\n> ' +
        state.input +
        (state.cursor ? '_' : ' ')
    term.textContent = content
    term.scrollTop = term.scrollHeight
}
setInterval(() => {
    state.cursor = !state.cursor
    drawPrompt()
}, 500)

// Policy review
function showMetaData(request) {
    panels.infoPanel.innerHTML = `
      <h3>Metadata for Request ${request.id}</h3>
      <p><strong>Requester:</strong> ${request.user} &lt;${
        request.email
    }&gt;</p>
      <p><strong>Auth Proof:</strong> ${request.auth}</p>
      <p><strong>Type:</strong> ${request.type}</p>
      <p><strong>Rationale:</strong> ${request.rationale}</p>
      <pre>${request.diff.join('\n')}</pre>
      <p><em>Options: approve (y) | deny (n) | escalate (x)</em></p>
    `
}
//Handbook
function showHandbook() {
    panels.infoPanel.innerHTML = `
    <div class="handbook">
        <h2>DNS Operations Handbook &amp; Key Commands</h2>
        <h3>Core Rules</h3>
        <ul>
            <li><strong>Glue Change</strong>: Only use IPv4 from <code>192.0.2.0</code> to <code>192.0.2.255</code> or IPv6 from <code>2001:db8:0000</code> to <code>2001:db8:ffff</code>.</li>
            <li><strong>NS Addition</strong>: You may only add NS entries in ns1 to ns4, never delete existing NS entries.</li>
            <li><strong>DNSKEY Update</strong>: Use algorithm 8 or 13 only; do not alter key tags or flags.</li>
            <li><strong>DS Addition/Update</strong>: Use alg 8 or 13; you may add or update but <em>never remove</em> DS records in daily updates.</li>
            <li><strong>DS Removal</strong>: Disallowed—DS records must remain.</li>
            <li><strong>TTL Adjustment</strong>: New TTLs must follow these ranges:<br>
                • NS: 43200-172800 s<br>
                • DS: 3600-14400 s<br>
                • Glue: 300-7200 s<br>
                • Other records (A/MX/CNAME/TXT): 300-86400 s
            </li>
            <li><strong>SOA Update</strong>: Disallowed in daily pushes—do not change the SOA serial or any SOA fields.</li>
            <li><strong>RRSIG Rotation</strong>: Disallowed in daily pushes—do not modify RRSIG records.</li>
            <li><strong>MX Update</strong>: New MX must point to a valid host in the zone, use priority 0-65535, and follow TTL guidelines.</li>
            <li><strong>A Record Addition</strong>: Added A records must have matching AAAA if needed, use valid public IPs, and follow TTL guidelines.</li>
            <li><strong>CNAME Addition</strong>: No CNAME at zone apex; target must be a valid name and not create loops; TTL per guidelines.</li>
            <li><strong>TXT Record Update</strong>: Text strings must be ≤255 chars; follow TTL guidelines.</li>
            <li>Reject any request that would leave unpaired A/AAAA entries or empty glue records.</li>
            <li>If in doubt <strong>escalate</strong> by pressing <code>x</code>.</li>
        </ul>
        <h3>Key Commands</h3>
        <ul>
            <li><code>y</code> — Approve current request</li>
            <li><code>n</code> — Reject current request</li>
            <li><code>x</code> — Escalate for manual review</li>
            <li><code>next</code> — Load next pending request</li>
            <li><code>metadata</code> — Display full metaData for the active request</li>
            <li><code>grep ___</code> — Search zone records for ____</li>
            <li><code>audit</code> — View recent audit log entries</li>
            <li><code>metrics</code> — View performance &amp; error metrics</li>
            <li><code>clear</code> — Clear the terminal window</li>
            <li><code>logout</code> — End your shift (after processing all requests)</li>
            <li><code>help</code> — Show this commands list</li>
        </ul>
    </div>
    `
}
// runGrep
function runGrep(q) {
    const term = q.toLowerCase();
    const matches = ZONE_DB.filter(r => fmt(r).toLowerCase().includes(term));
    const total   = matches.length;
    const results = matches.slice(0, 50);

    panels.infoPanel.innerHTML = `
      <h3>Search Results for “${term}”</h3>
      <p>Found ${total} matching records (showing up to ${results.length}):</p>
      <ul>
        ${results.map(r => `<li><code>${fmt(r)}</code></li>`).join('')}
      </ul>
    `;
}
// Audit Log
function showInfoAuditLog() {
    const recent = auditLog
        .slice(-10)
        .map((e) => `<li>${e}</li>`)
        .join('')
    document.getElementById('infoPanel').innerHTML = `
      <h3>Audit Log</h3>
      <ul>${recent}</ul>
    `
}
//Metrics
function showMetrics() {
    panels.infoPanel.innerHTML = `
      <h3>Metrics</h3>
      <p>Processed: ${metrics.processed}</p>
      <p>Errors: ${metrics.errors}</p>
      <p>Error Rate: ${metrics.errRate}%</p>
      <p>Employee Score: ${metrics.policyScore}</p>
    `
}
/* ===================== Game State ============================ */
const FOOD_COST = 2,
    RENT_COST = 35
let GAME
function generateRequests() {
    const cnt = 3;
    GAME.queue = [];

    const TYPES = [
        'NS Addition',
        'Glue Change',
        'DNSKEY Update',
        'DS Addition',
        'DS Removal',
        'TTL Adjustment',
        'SOA Update',
        'RRSIG Rotation',
        'MX Update',
        'A Record Addition',
        'CNAME Addition',
        'TXT Record Update',
    ];
    const RATIONALES = [
        'Routine delegation update',
        'Security key rotation',
        'Glue record correction',
        'Record cleanup',
        'Service migration',
        'Infrastructure consolidation',
        'Compliance update',
        'Policy enforcement',
    ];
    const STATUS_TYPES = ['good', 'bad'];

    // make sure we pick only real TLD NS records
    const tldRecords = ZONE_DB.filter(r => r.type === 'NS' && r.name !== '.');
    if (tldRecords.length === 0) return;

    for (let i = 0; i < cnt; i++) {
        let status
        if (Math.random() < 0.65) {
            status = STATUS_TYPES[0]
        } else {
            status = STATUS_TYPES[1]
            
        }
        const tldRec = pick(tldRecords);
        const tld    = tldRec.name;
        const user   = `user${rndInt(1,100)}`;
        const req    = {
            id: rndInt(1000,9999),
            user,
            email: `${user}@example.com`,
            auth:  rndHex4(),
            type:  pick(TYPES),
            rationale: pick(RATIONALES),
            status
        };

        switch (req.type) {
            case 'NS Addition': {
              const ns = status === 'good' ? `ns3.nic.${tld}.` : `ns5.nic.${tld}.`
              const ttl = status === 'good' ? pick(LARGE) : pick(SMALL)                  // TTL too short
              req.description = `Add NS ${ns} to ${tld}`;
              req.diff = [`+ ${tld} ${ttl} IN NS ${ns}`];
              break;
            }
          
            case 'Glue Change': {
              const target = pick(ROOT_SERVERS);
              const oldA    = `- ${target} A    ???`;
              const oldAAAA = `- ${target} AAAA ???`;
              let newA, newAAAA;
              if (status === 'good') {
                newA    = `+ ${target} A    192.0.2.${rndInt(0,255)}`;
                newAAAA = `+ ${target} AAAA ${rndIpv6()}`;
              } else {
                newA    = `+ ${target} A    203.0.113.${rndInt(0,255)}`;
                newAAAA = `+ ${target} AAAA 2001:db9:${rndHex4()}::${rndHex4()}`;
              }
              req.description = `Change glue for ${target}`;
              req.diff = [ oldA, oldAAAA, newA, newAAAA ];
              break;
            }
          
            case 'DNSKEY Update': {
              const oldAlg = pick(DS_ALGS);
              const newAlg = status === 'good' ? pick(DS_ALGS) : pick([1,2,3,4,5,6,7,9,10,11,12]);
              const oldKey = `${rndInt(100,500)} 3 ${oldAlg} oldkey${rndHex4()}`;
              const newKey = `${rndInt(100,500)} 3 ${newAlg} newkey${rndHex4()}`;
              req.description = `Update DNSKEY for ${tld}`;
              req.diff = [
                `- ${tld} DNSKEY ${oldKey}`,
                `+ ${tld} DNSKEY ${newKey}`
              ];
              break;
            }
          
            case 'DS Addition': {
              const alg    = status === 'good' ? pick(DS_ALGS) : pick([1,3,5,6,7,8,9]);
              const digest = status === 'good'
                ? DS_DIGEST[alg]
                : status === 'bad'
                  ? pick([1,3,5,6])
                  : pick([7,8,9]);
              const tag = rndInt(10000,60000);
              const ttl = pick(MED);
              req.description = `Add DS for ${tld}`;
              req.diff = [
                `+ ${tld} ${ttl} IN DS ${tag} ${alg} ${digest} d${rndHex4()}`
              ];
              break;
            }
          
            case 'DS Removal': {
              const tag = rndInt(10000,60000);
              req.description = `Remove DS ${tag} from ${tld}`;
              req.diff = [
                `- ${tld} DS ${tag} 8 2 ...`
              ];
              req.status = 'bad'
              break;
            }
          
            case 'TTL Adjustment': {
              const oldTtl = pick(LARGE);
              const newTtl = status === 'good'
                ? pick(LARGE)
                : status === 'bad'
                  ? rndInt(0,43199)
                  : rndInt(172801,300000);
              req.description = `Change TTL on ${tld}`;
              req.diff = [
                `- ${tld} ${oldTtl}`,
                `+ ${tld} ${newTtl}`
              ];
              break;
            }
          
            case 'SOA Update': {
              // (even "good" SOA updates are disallowed in daily pushes,
              // but we'll simulate anyway)
              const oldSerial = serialToday();
              // bump by one for new serial
              const newSerial = String(Number(oldSerial) + rndInt(-100,100));
              req.description = `Update SOA serial for ${tld}`;
              req.diff = [
                `- ${tld} SOA serial=${oldSerial}`,
                `+ ${tld} SOA serial=${newSerial}`
              ];
              req.status = 'bad'
              break;
            }
          
            case 'RRSIG Rotation': {
              const rrtype = pick(['SOA','NS','DNSKEY','MX']);
              req.description = `Rotate RRSIG for ${rrtype} on ${tld}`;
              req.diff = [
                `- ${tld} RRSIG ${rrtype} oldsig...`,
                `+ ${tld} RRSIG ${rrtype} newsig...`
              ];
              req.status = 'bad'
              break;
            }
          
            case 'MX Update': {
              const oldPri  = rndInt(3,20);
              const newPri  = status === 'good' ? rndInt(21,80) : rndInt(-100,-5);
              req.description = `Update MX for ${tld}`;
              req.diff = [
                `- ${tld} MX ${oldPri} ${tld}`,
                `+ ${tld} MX ${newPri} ${tld}`
              ];
              break;
            }
          
            case 'A Record Addition': {
              const host = status === 'bad'
                ? `badhost.${tld}`
                : `host.${tld}`;
              const ip = status === 'good'
                ? rndIpv4()
                : `203.0.113.${rndInt(1,254)}`;
              const ttl = pick(MED);
              req.description = `Add A record ${host}`;
              req.diff = [
                `+ ${host} ${ttl} IN A ${ip}`
              ];
              break;
            }
          
            case 'CNAME Addition': {
              const alias = `alias.${tld}`;
              const target= status === 'bad'
                ? `ns5.nic.${tld}.`
                : tld + '.';
              const ttl = status === 'good'
                ? pick(MED)
                : pick(SMALL);
              req.description = `Add CNAME ${alias} → ${target}`;
              req.diff = [
                `+ ${alias} ${ttl} IN CNAME ${target}`
              ];
              break;
            }
          
            case 'TXT Record Update': {
              const oldTxt = `"v=spf1 ~all"`;
              const newTxt = status === 'good' ? `"v=spf1 include:new.example.com -all"` : "for (let pass = 1; pass <= passes; pass++) {const currentDepth = Math.min(pass * stepDown, depth);this.comment(`Pass ${pass} at depth ${currentDepth.toFixed(this.decimalPlaces)}`);let offset = 0;while (offset < width/2 - radius && offset < length/2 - radius) {this.rapidMove(startX + radius + offset, startY + radius + offset, this.rapidPlane);";
              req.description = `Update TXT for ${tld}`;
              req.diff = [
                `- ${tld} TXT ${oldTxt}`,
                `+ ${tld} TXT ${newTxt}`
              ];
              break;
            }
          }  // end switch

        GAME.queue.push(req);
    }
}




function resetGame() {
    GAME = {
        day: 1,
        balance: 0,
        food: 9,
        rentDays: 7,
        queue: [],
        awaiting: null,
        correct: 0,
        wrong: 0,
        phase: 'play',
    }
    buildZone()
    generateRequests()
    state.lines = [
        'ZoneCraft • root snapshot',
        `Loaded ${ZONE_DB.length.toLocaleString()} records for ${TLD_COUNT} TLDs`,
        '--- Day 1 --- Balance $0',
    ]
    drawPrompt()
}
/* ===================== Daily cycle =========================== */
function consumeDaily() {
    GAME.food -= 3
    if (GAME.food < 0) {
        pushLine('Out of food! Your family starved. Game restarting…')
        resetGame()
        return false
    }
    GAME.rentDays--
    if (GAME.rentDays === 0) {
        GAME.balance -= RENT_COST
        GAME.rentDays = 7
        pushLine(`Rent auto‑paid ($${RENT_COST}). New balance $${GAME.balance}`)
    }
    return true
}
function nextDay() {
    if (!consumeDaily()) return
    GAME.day++
    GAME.correct = 0
    GAME.wrong = 0
    GAME.phase = 'play'
    generateRequests()
    pushLine(`\n--- Day ${GAME.day} --- Balance $${GAME.balance}`)
}
function endDay() {
    GAME.phase = 'summary'
    pushLine(`\n=== Day ${GAME.day} summary ===`)
    pushLine(`Correct: ${GAME.correct} | Mistakes: ${GAME.wrong}`)
    pushLine(`Balance: $${GAME.balance}`)
    pushLine(`Food: ${GAME.food}`)
    pushLine(`Rent due in ${GAME.rentDays} day(s)`)
    pushLine('buyfood <n> | login')
    metrics.processed += GAME.correct + GAME.wrong
    metrics.errors += GAME.wrong
    metrics.errRate = (
        (metrics.errors / Math.max(metrics.processed, 1)) *
        100
    ).toFixed(1)
    metrics.policyScore =
        100 - metrics.errRate - metrics.escalations * 5 + metrics.saves * 15
}
/* ===================== Command handlers ===================== */
function handleDecision(key) {
    if (!GAME.awaiting) return false
    const status = GAME.awaiting.status

    // Yes/No decisions
    if (key === 'y' || key === 'n') {
        if (key === 'y') {
            if (status === 'good') {
                GAME.balance += 5
                GAME.correct++
                pushLine('Decision correct (+$5)')
            } else if (status === 'bad') {
                GAME.balance -= 30
                GAME.wrong++
                pushLine('Wrong decision (-$30)')
            }
        } else {
            // key === 'n'
            if (status === 'good') {
                GAME.balance -= 30
                GAME.wrong++
                pushLine('Wrong decision (-$30)')
            } else if (status === 'bad') {
                GAME.balance += 5
                GAME.correct++
                pushLine('Decision correct (+$5)')
            }
        }

        GAME.awaiting = null
        if (!GAME.queue.length)
            pushLine('All requests processed. Type logout to end day.')
        return true

        // Escalation
    } else if (key === 'x') {
        // Always mark escalation as correct
        GAME.correct++
        GAME.balance -= 5
        metrics.escalations++
        pushLine("Decision escalated (-$5 for wasting your manager's time)")
        GAME.awaiting = null
        if (!GAME.queue.length)
            pushLine('All requests processed. Type logout to end day.')
        return true
    }

    return false
}

function handleCommand(cmd) {
    const [root, ...rest] = cmd.split(/\s+/)
    panels.terminal.style.display = 'block'
    switch (root) {
        case 'buyfood':
            const num = rest.join(' ').toLowerCase()
            if (num*FOOD_COST <= GAME.balance){
                GAME.balance -= num*FOOD_COST
                GAME.food += num*1
                console.log(num)
                pushLine(`${num} packs of food purchased for $${num*FOOD_COST}. New balance $${GAME.balance}`)
            } else {

            }
        case 'login':
            nextDay()
            break
        case 'help':
            showHandbook()
            break

        case 'count': {
            const total = ZONE_DB.length
            const by = {}
            ZONE_DB.forEach((r) => {
                if (r.type) by[r.type] = (by[r.type] || 0) + 1
            })
            pushLine(`Total ${total}`)
            Object.keys(by)
                .sort()
                .forEach((t) => pushLine(`  ${t}: ${by[t]}`))
            break
        }

        case 'clear':
            state.lines = []
            break

        case 'next': {
            if (GAME.awaiting) {
                pushLine('Decision pending')
                break
            }
            if (!GAME.queue.length) {
                pushLine('No pending requests')
                break
            }
            GAME.awaiting = GAME.queue.shift()
            pushLine(`Request: ${GAME.awaiting.description}`)
            const diffs = Array.isArray(GAME.awaiting.diff) ? GAME.awaiting.diff : []
            diffs.forEach((l) => pushLine(l))
            pushLine('Accept? (y/n/x)')
            break
        }

        case 'logout': {
            if (GAME.awaiting) {
                pushLine('Resolve pending request first')
                break
            }
            if (GAME.queue.length) {
                pushLine('Process all requests before logout')
                break
            }
            endDay()
            break
        }

        case 'grep': {
            const term = rest.join(' ').toLowerCase()
            if (!term) return pushLine('Need search term')
            runGrep(term)
            break
        }
        case 'metadata':
            if (!GAME.awaiting) pushLine('No active request')
            else showMetaData(GAME.awaiting)
            break

        case 'audit':
            showInfoAuditLog()
            break
        case 'metrics':
            showMetrics()
            break
        default:
            pushLine('Unknown command')
    }
}

/* =================== Keyboard handling ====================== */
function handleTyping(e) {
    if (state.input === '' && (e.key === 'y' || e.key === 'n' || e.key === 'x')) {
        if (handleDecision(e.key)) {
            return
        }
    }
    if (e.key === 'Backspace') {
        state.input = state.input.slice(0, -1)
        drawPrompt()
        return
    }
    if (e.key === 'Enter') {
        const cmd = state.input.trim()
        if (cmd) {
            state.lines.push('> ' + cmd)
            handleCommand(cmd)
            state.history.push(cmd)
        }
        state.input = ''
        state.histIndex = null
        drawPrompt()
        return
    }
    if (e.key === 'ArrowUp') {
        if (state.history.length) {
            if (state.histIndex === null)
                state.histIndex = state.history.length - 1
            else state.histIndex = Math.max(0, state.histIndex - 1)
            state.input = state.history[state.histIndex]
            drawPrompt()
        }
        return
    }
    if (e.key === 'ArrowDown') {
        if (state.histIndex !== null) {
            state.histIndex = Math.min(
                state.history.length - 1,
                state.histIndex + 1
            )
            state.input = state.history[state.histIndex] || ''
            drawPrompt()
        }
        return
    }
    if (e.key.length === 1) {
        state.input += e.key
        drawPrompt()
    }
}
addEventListener('keydown', handleTyping)
/* ========================= Boot ============================== */
resetGame()
showHandbook()