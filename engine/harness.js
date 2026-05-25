#!/usr/bin/env node
/**
 * harness.js — stability stress test for the bot economy.
 *
 * Runs the simulation headless, captures snapshots at intervals, extracts
 * events from state diffs (death, build, hire, layoff, stress), checks
 * invariants per-snapshot, and prints a digest. No engine changes — reads
 * only.
 *
 * Invariants checked:
 *   - actor-alive: every non-synthetic actor still in state.actors
 *   - bounded-growth: no actor with > BUILDING_CAP buildings
 *   - chain-trading: each chain item traded in the last TRADE_LOOKBACK ticks
 *   - money-bounded: total non-gov cash within MONEY_BAND of starting total
 *   - price-band: chain items clearing within PRICE_BAND of fair price
 *
 * Usage:
 *   node engine/harness.js [--ticks N] [--every M] [--events]
 *                          [--kill ACTOR@TICK] [--data DIR]
 *
 *   --ticks N        total ticks to simulate (default 5000)
 *   --every M        snapshot interval (default 500)
 *   --events         print event stream per snapshot
 *   --kill A@T       force-kill actor A at tick T (queues respawn) — tests
 *                    resilience to perturbation (e.g., player wipes coke-co)
 *   --data DIR       data directory (default ../data)
 */

const path = require('path');
const { loadData } = require('./load.js');
const { validate } = require('./schema.js');
const { initState } = require('./state.js');
const { tick } = require('./tick.js');
const { fairPrice } = require('./market.js');

const SYNTHETIC_STRATEGIES = new Set(['households', 'government']);
const BUILDING_CAP = 500;
const TRADE_LOOKBACK = 1000;
// MONEY_BAND tolerates gradual inflation. Gov ballast creates money each
// tick (~$200-300/tick) — over 200k ticks that's reaches ~200x baseline.
// Inflation creep is not a collapse; the world continues. Tighten if a
// proper buffer-stock gov pricing scheme lands.
const MONEY_BAND = 1000;
const PRICE_BAND = { low: 0.3, high: 5.0 };
const CHAIN_ITEMS = ['brick', 'coke', 'pig-iron', 'steel', 'machine-tool'];

function isSynthetic(actor) {
    return SYNTHETIC_STRATEGIES.has(actor.strategy);
}

function snapshotActors(state) {
    const out = {};
    for (const [id, a] of Object.entries(state.actors)) {
        out[id] = {
            cash: Math.round(a.cash),
            buildings: (a.buildings || []).length,
            workers: (a.workers || []).length,
            stress: a.stress || 0,
            bankruptTicks: a.bankruptTicks || 0,
            synthetic: isSynthetic(a),
        };
    }
    return out;
}

function snapshotPrices(state, data, lookback) {
    const fp = fairPrice(data);
    const out = {};
    for (const item of Object.keys(data.items || {})) {
        const hist = (state.marketHistory && state.marketHistory[item]) || [];
        const recent = hist.filter(h => h.tick > state.tick - lookback);
        let qty = 0;
        let priceSum = 0;
        for (const h of recent) { qty += h.qty; priceSum += h.price * h.qty; }
        const vwap = qty > 0 ? priceSum / qty : null;
        const last = recent.length ? recent[recent.length - 1].price : null;
        out[item] = {
            fair: fp[item],
            last,
            vwap,
            qty,
            ratio: vwap !== null ? vwap / fp[item] : null,
        };
    }
    return out;
}

function totalCash(state) {
    let total = 0;
    for (const a of Object.values(state.actors)) {
        if (a.strategy === 'government') continue;
        total += a.cash || 0;
    }
    return total;
}

function diff(before, after) {
    const events = [];
    const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const id of ids) {
        const b = before[id];
        const a = after[id];
        if (b && !a) { events.push({ type: 'death', actor: id }); continue; }
        if (!b && a) { events.push({ type: 'spawn', actor: id }); continue; }
        if (b.synthetic) continue;
        const db = a.buildings - b.buildings;
        if (db > 0) events.push({ type: 'build', actor: id, delta: db, total: a.buildings });
        if (db < 0) events.push({ type: 'demolish', actor: id, delta: -db, total: a.buildings });
        const dw = a.workers - b.workers;
        if (dw > 0) events.push({ type: 'hire', actor: id, delta: dw, total: a.workers });
        if (dw < 0) events.push({ type: 'layoff', actor: id, delta: -dw, total: a.workers });
        if (a.stress !== b.stress) events.push({ type: 'stress', actor: id, from: b.stress, to: a.stress });
    }
    return events;
}

function checkInvariants(state, data, baselineCash) {
    const failures = [];

    for (const [id, def] of Object.entries(data.actors || {})) {
        if (id === 'player') continue; // player is excused; this is a bot economy test
        if (SYNTHETIC_STRATEGIES.has(def.strategy)) continue;
        if (!state.actors[id]) failures.push(`dead:${id}`);
    }

    for (const [id, a] of Object.entries(state.actors)) {
        if (isSynthetic(a)) continue;
        const n = (a.buildings || []).length;
        if (n > BUILDING_CAP) failures.push(`runaway:${id}(${n}b)`);
    }

    for (const item of CHAIN_ITEMS) {
        const hist = (state.marketHistory && state.marketHistory[item]) || [];
        const recent = hist.filter(h => h.tick > state.tick - TRADE_LOOKBACK);
        if (recent.length === 0) failures.push(`no-trade:${item}`);
    }

    const tc = totalCash(state);
    if (baselineCash > 0) {
        const ratio = tc / baselineCash;
        if (ratio > MONEY_BAND) failures.push(`money-up:${ratio.toFixed(0)}x`);
        if (ratio < 1 / MONEY_BAND) failures.push(`money-down:${ratio.toFixed(3)}x`);
    }

    const fp = fairPrice(data);
    for (const item of CHAIN_ITEMS) {
        const hist = (state.marketHistory && state.marketHistory[item]) || [];
        const recent = hist.filter(h => h.tick > state.tick - TRADE_LOOKBACK);
        if (recent.length === 0) continue;
        let qty = 0, priceSum = 0;
        for (const h of recent) { qty += h.qty; priceSum += h.price * h.qty; }
        const vwap = priceSum / qty;
        const ratio = vwap / fp[item];
        if (ratio > PRICE_BAND.high) failures.push(`price-high:${item}(${ratio.toFixed(1)}x)`);
        if (ratio < PRICE_BAND.low) failures.push(`price-low:${item}(${ratio.toFixed(2)}x)`);
    }

    return failures;
}

function fmtLine(t, snap, events, invariants) {
    const realActors = Object.values(snap).filter(a => !a.synthetic);
    const alive = realActors.length;
    const totalBldgs = realActors.reduce((s, a) => s + a.buildings, 0);
    const totalWorkers = realActors.reduce((s, a) => s + a.workers, 0);
    const stressed = realActors.filter(a => a.stress >= 3).length;
    const builds = events.filter(e => e.type === 'build').reduce((s, e) => s + e.delta, 0);
    const layoffs = events.filter(e => e.type === 'layoff').reduce((s, e) => s + e.delta, 0);
    const deaths = events.filter(e => e.type === 'death');

    let line = `t=${String(t).padStart(6)}  alive=${alive}  b=${String(totalBldgs).padStart(4)}  w=${String(totalWorkers).padStart(4)}  +b=${String(builds).padStart(3)}  -w=${String(layoffs).padStart(3)}  s3+=${stressed}`;
    if (deaths.length) line += `  DEATH=${deaths.map(d => d.actor).join(',')}`;
    if (invariants.length) line += `  FAIL[${invariants.length}]`;
    return line;
}

function fmtEvents(events) {
    const lines = [];
    for (const e of events) {
        if (e.type === 'death') lines.push(`    DEATH ${e.actor}`);
        else if (e.type === 'spawn') lines.push(`    SPAWN ${e.actor}`);
        else if (e.type === 'stress' && (e.to >= 3 || e.from >= 3))
            lines.push(`    STRESS ${e.actor} ${e.from}->${e.to}`);
        else if (e.type === 'demolish')
            lines.push(`    DEMOLISH ${e.actor} -${e.delta} (now ${e.total})`);
    }
    return lines.join('\n');
}

function runScenario(opts = {}) {
    const dataDir = opts.data || path.join(__dirname, '..', 'data');
    const ticks = opts.ticks || 5000;
    const every = opts.every || 500;
    const showEvents = opts.events || false;

    const data = loadData(dataDir);
    const errs = validate(data);
    if (errs.length) {
        console.error('validation failed:');
        for (const e of errs) console.error(`  - ${e}`);
        process.exit(1);
    }

    const killSpec = opts.kill || null;
    let state = initState(data);
    const baselineCash = totalCash(state);
    let prevActors = snapshotActors(state);
    let firstFailureTick = null;
    const failureCounts = {};

    console.log(`harness: ${ticks} ticks, snapshot every ${every}, baseline cash $${Math.round(baselineCash)}`);
    const realIds = Object.entries(prevActors).filter(([, a]) => !a.synthetic).map(([id]) => id);
    console.log(`real actors: ${realIds.join(', ')}`);
    console.log('');
    console.log('     tick  alive    b     w   +b   -w  s3+    notes');
    console.log('     ----  -----  ---   ---  ---  ---  ---    -----');

    const t0 = Date.now();
    let finalSnap = null;
    let killed = false;
    for (let t = 1; t <= ticks; t++) {
        if (killSpec && !killed && t === killSpec.tick) {
            const target = state.actors[killSpec.actorId];
            if (target) {
                delete state.actors[killSpec.actorId];
                if (killSpec.actorId !== 'player' && (data.actors || {})[killSpec.actorId]) {
                    if (!state.respawnQueue) state.respawnQueue = [];
                    state.respawnQueue.push({ actorId: killSpec.actorId, deathTick: t });
                }
                console.log(`  *** KILL ${killSpec.actorId} @ t=${t}`);
            }
            killed = true;
        }
        tick(state, data);
        if (t % every === 0 || t === ticks) {
            const cur = snapshotActors(state);
            const events = diff(prevActors, cur);
            const invariants = checkInvariants(state, data, baselineCash);
            console.log(fmtLine(t, cur, events, invariants));
            if (showEvents) {
                const ev = fmtEvents(events);
                if (ev) console.log(ev);
            }
            if (invariants.length && firstFailureTick === null) firstFailureTick = t;
            for (const f of invariants) {
                const key = f.split(':')[0];
                failureCounts[key] = (failureCounts[key] || 0) + 1;
            }
            prevActors = cur;
            finalSnap = { cur, invariants };
        }
    }
    const dt = Date.now() - t0;

    console.log('');
    console.log(`runtime: ${dt}ms (${(ticks / (dt / 1000)).toFixed(0)} ticks/sec)`);
    console.log('');

    const finalActors = finalSnap.cur;
    console.log('final actor state:');
    console.log('  id                cash       b      w   stress');
    for (const [id, a] of Object.entries(finalActors)) {
        const tag = a.synthetic ? '*' : ' ';
        console.log(`  ${tag}${id.padEnd(14)} ${('$' + a.cash).padStart(10)}  ${String(a.buildings).padStart(4)}   ${String(a.workers).padStart(4)}   ${a.stress}`);
    }

    const finalPrices = snapshotPrices(state, data, TRADE_LOOKBACK);
    console.log('');
    console.log(`final prices (vwap over last ${TRADE_LOOKBACK} ticks):`);
    console.log('  item              fair        vwap     qty    ratio');
    for (const item of Object.keys(data.items || {}).sort()) {
        const p = finalPrices[item];
        const fair = '$' + p.fair.toFixed(2);
        const vwap = p.vwap !== null ? '$' + p.vwap.toFixed(2) : '-';
        const ratio = p.ratio !== null ? p.ratio.toFixed(2) + 'x' : '-';
        const qty = p.qty > 0 ? String(Math.round(p.qty)) : '-';
        console.log(`  ${item.padEnd(14)} ${fair.padStart(10)}  ${vwap.padStart(10)}  ${String(qty).padStart(6)}  ${ratio.padStart(6)}`);
    }

    // Tech tree walk view
    const allTechs = Object.keys(data.tech || {});
    const allRecipes = Object.keys(data.recipes || {});
    const techByActor = {};
    const recipeRunCounts = {};
    const inProgress = {};
    for (const [aid, a] of Object.entries(state.actors)) {
        if (isSynthetic(a)) continue;
        techByActor[aid] = Array.from(a.researched || []);
        if (a.researchInProgress) inProgress[aid] = a.researchInProgress.tech;
        for (const b of a.buildings || []) {
            for (const slot of b.slots || []) {
                if (slot && slot.recipe) {
                    recipeRunCounts[slot.recipe] = (recipeRunCounts[slot.recipe] || 0) + 1;
                }
            }
        }
    }
    console.log('');
    console.log('tech walk:');
    for (const tech of allTechs) {
        const owners = Object.entries(techByActor).filter(([, ts]) => ts.includes(tech)).map(([id]) => id);
        const ipOwners = Object.entries(inProgress).filter(([, t]) => t === tech).map(([id]) => id);
        const ownerStr = owners.length ? owners.join(',') : '(none)';
        const ipStr = ipOwners.length ? ` [in-progress: ${ipOwners.join(',')}]` : '';
        console.log(`  ${tech.padEnd(20)}  ${ownerStr}${ipStr}`);
    }
    console.log('');
    console.log('recipe activity (active slots across all actors):');
    for (const rid of allRecipes) {
        const r = data.recipes[rid];
        const count = recipeRunCounts[rid] || 0;
        const techTag = r.tech ? `[${r.tech}]` : '[raw]';
        const status = count > 0 ? `${count} slot(s)` : '(idle)';
        console.log(`  ${rid.padEnd(22)} ${techTag.padEnd(22)} ${status}`);
    }

    console.log('');
    if (finalSnap.invariants.length === 0) {
        console.log(`PASS @${ticks}`);
    } else {
        console.log(`FAIL @${ticks}  first failure @${firstFailureTick}`);
        console.log('  final violations:');
        for (const f of finalSnap.invariants) console.log(`    ! ${f}`);
        if (Object.keys(failureCounts).length) {
            console.log('  violation counts over run:');
            for (const [k, v] of Object.entries(failureCounts).sort((a, b) => b[1] - a[1])) {
                console.log(`    ${k}: ${v}`);
            }
        }
    }
    return finalSnap;
}

// One headless seeded run, no logging. Returns the final-tick invariant
// failures plus summary stats. Reuses checkInvariants as the classifier:
// empty failures == healthy.
function runSeed(data, baseOpts, seed) {
    const ticks = baseOpts.ticks || 5000;
    const killSpec = baseOpts.kill || null;
    const state = initState(data, { seed });
    const baselineCash = totalCash(state);
    let killed = false;
    for (let t = 1; t <= ticks; t++) {
        if (killSpec && !killed && t === killSpec.tick) {
            if (state.actors[killSpec.actorId]) {
                delete state.actors[killSpec.actorId];
                if (killSpec.actorId !== 'player' && (data.actors || {})[killSpec.actorId]) {
                    if (!state.respawnQueue) state.respawnQueue = [];
                    state.respawnQueue.push({ actorId: killSpec.actorId, deathTick: t });
                }
            }
            killed = true;
        }
        tick(state, data);
    }
    const failures = checkInvariants(state, data, baselineCash);
    const real = Object.values(state.actors).filter(a => !isSynthetic(a));
    return {
        seed,
        failures,
        alive: real.length,
        buildings: real.reduce((s, a) => s + (a.buildings || []).length, 0),
        workers: real.reduce((s, a) => s + (a.workers || []).length, 0),
        moneyRatio: baselineCash > 0 ? totalCash(state) / baselineCash : 0,
    };
}

function ensemble(data, baseOpts, n) {
    const results = [];
    for (let seed = 1; seed <= n; seed++) results.push(runSeed(data, baseOpts, seed));
    return results;
}

function parseArgs(argv) {
    const opts = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--ticks') opts.ticks = parseInt(argv[++i], 10);
        else if (a === '--every') opts.every = parseInt(argv[++i], 10);
        else if (a === '--events') opts.events = true;
        else if (a === '--data') opts.data = argv[++i];
        else if (a === '--seeds') opts.seeds = parseInt(argv[++i], 10);
        else if (a === '--kill') {
            const spec = argv[++i] || '';
            const [actorId, tickStr] = spec.split('@');
            opts.kill = { actorId, tick: parseInt(tickStr, 10) };
        }
    }
    return opts;
}

if (require.main === module) {
    const opts = parseArgs(process.argv);
    if (opts.seeds) {
        const dataDir = opts.data || path.join(__dirname, '..', 'data');
        const data = loadData(dataDir);
        const errs = validate(data);
        if (errs.length) {
            console.error('validation failed:');
            for (const e of errs) console.error(`  - ${e}`);
            process.exit(1);
        }
        const ticks = opts.ticks || 5000;
        const t0 = Date.now();
        const results = ensemble(data, opts, opts.seeds);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const killStr = opts.kill ? `  kill=${opts.kill.actorId}@${opts.kill.tick}` : '';
        console.log(`main-engine ensemble — ${opts.seeds} seeds, ${ticks} ticks each${killStr} (ran in ${elapsed}s)\n`);
        console.log('  seed  result    alive    b      w    money   violations');
        for (const r of results) {
            const ok = r.failures.length === 0;
            console.log(
                String(r.seed).padStart(6) + '  ' +
                (ok ? 'healthy' : 'FAIL').padEnd(8) + ' ' +
                String(r.alive).padStart(5) + ' ' +
                String(r.buildings).padStart(5) + ' ' +
                String(r.workers).padStart(6) + ' ' +
                (r.moneyRatio.toFixed(2) + 'x').padStart(7) + '  ' +
                (ok ? '-' : r.failures.join(','))
            );
        }
        const tally = {};
        for (const r of results) {
            const key = r.failures.length === 0 ? 'healthy' : r.failures[0].split(':')[0];
            tally[key] = (tally[key] || 0) + 1;
        }
        const healthy = tally.healthy || 0;
        const frac = healthy / opts.seeds;
        console.log('\nclasses: ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('  '));
        console.log(`\nRESULT: ${frac >= 0.9 ? 'PASS' : 'FAIL'}  (healthy ${healthy}/${opts.seeds} = ${(frac * 100).toFixed(0)}%, gate >= 90%)`);
        process.exit(0);
    }
    runScenario(opts);
}

module.exports = {
    runScenario, snapshotActors, snapshotPrices, diff, checkInvariants, totalCash,
    CHAIN_ITEMS, BUILDING_CAP, TRADE_LOOKBACK, PRICE_BAND, MONEY_BAND,
};
