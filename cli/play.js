#!/usr/bin/env node
/**
 * play.js — interactive REPL.
 *
 * Loads data, inits or resumes state, exposes commands for hiring/firing
 * workers, building/demolishing structures, assigning workers to slots,
 * posting market orders, researching tech, and advancing ticks.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { loadData } = require('../engine/load.js');
const { validate } = require('../engine/schema.js');
const { initState, save, load, catchUp } = require('../engine/state.js');
const { tick } = require('../engine/tick.js');
const { fairPrice } = require('../engine/market.js');
const { newWorker } = require('../engine/worker.js');

const SAVE_PATH = path.join(__dirname, '..', 'save.json');
const PLAYER = 'player';
const PLAYER_COMMANDS = new Set([
    'hire', 'fire', 'workers', 'build', 'demolish',
    'assign', 'unassign', 'set-price', 'set-bid', 'research', 'tech',
]);

function assignedWorkerIds(actor) {
    const ids = new Set();
    for (const b of actor.buildings) {
        for (const slot of b.slots) {
            if (slot) for (const id of slot.workerIds) ids.add(id);
        }
    }
    return ids;
}

function idleWorkers(actor) {
    const assigned = assignedWorkerIds(actor);
    return actor.workers.filter(w => !assigned.has(w.id));
}

function status(state, data) {
    const p = state.actors[PLAYER];
    if (!p) return 'no player actor';
    const lines = [];
    lines.push(`tick ${state.tick}   cash $${p.cash.toFixed(0)}`);

    const inv = Object.entries(p.inventory)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}:${v}`)
        .join(' ') || '(empty)';
    lines.push(`inventory: ${inv}`);

    const idle = idleWorkers(p).length;
    lines.push(`workers: ${p.workers.length} (${idle} idle, ${p.workers.length - idle} assigned)`);

    if (p.buildings.length === 0) {
        lines.push('buildings: (none)');
    } else {
        lines.push('buildings:');
        p.buildings.forEach((b, i) => {
            const slotStr = b.slots.map((s, sIdx) => {
                if (!s) return `[${sIdx}: idle]`;
                const pct = Math.floor(s.progress * 100);
                return `[${sIdx}: ${s.recipe} ${pct}%]`;
            }).join(' ');
            lines.push(`  ${i}: ${b.type} ${slotStr}`);
        });
    }

    const tech = Array.from(p.researched).join(', ') || '(none)';
    lines.push(`tech: ${tech}`);
    return lines.join('\n');
}

function prices(data) {
    const fp = fairPrice(data);
    return Object.entries(fp)
        .sort((a, b) => a[1] - b[1])
        .map(([id, p]) => `  ${id.padEnd(20)} $${p.toFixed(2)}`)
        .join('\n');
}

function market(state, data) {
    const p = state.actors[PLAYER];
    const fp = fairPrice(data);
    const items = Object.keys(data.items || {}).sort();
    const lines = [];
    lines.push('  item            fair      last    your-ask');
    for (const id of items) {
        const fair = fp[id] || 0;
        const hist = (state.marketHistory && state.marketHistory[id]) || [];
        const last = hist.length ? hist[hist.length - 1].price : null;
        const ask = p && p.priceBook[id];
        const fairStr = `$${fair.toFixed(2)}`;
        const lastStr = last !== null ? `$${last.toFixed(2)}` : '-';
        const askStr = ask !== undefined ? `$${ask.toFixed(2)}` : '-';
        lines.push(`  ${id.padEnd(14)}  ${fairStr.padStart(7)}  ${lastStr.padStart(7)}  ${askStr}`);
    }
    if (p && p.pendingBids.length) {
        lines.push('');
        lines.push('pending bids (one-shot, fire next tick):');
        for (const b of p.pendingBids) lines.push(`  ${b.item}: ${b.qty} @ $${b.price.toFixed(2)}`);
    }
    return lines.join('\n');
}

function help() {
    return [
        'commands:',
        '  status                          show player state',
        '  workers                         list workers and their assignments',
        '  prices                          fair price for each item',
        '  market                          fair / last trade / your-ask per item',
        '  tech                            researched / in-progress / available',
        '  tick [n]                        advance n ticks (default 1)',
        '  hire [n]                        hire n workers (default 1)',
        '  fire <worker-id>                fire a worker (auto-unassigns)',
        '  build <type>                    construct a building (debits inventory)',
        '  demolish <bldg-idx>             demolish a building (no refund yet)',
        '  assign <bldg> <slot> <recipe>   assign idle workers to a slot',
        '  unassign <bldg> <slot>          clear a slot and free its workers',
        '  set-price <item> <price>        sell <item> at <price>; 0 to clear',
        '  set-bid <item> <price> <qty>    queue a one-shot bid',
        '  research <tech>                 start researching a tech',
        '  save                            save to ./save.json',
        '  reset                           discard save, re-init from data',
        '  help                            show this',
        '  quit                            exit',
    ].join('\n');
}

function cmdHire(actor, args) {
    const n = Math.max(1, parseInt(args[0] || '1', 10));
    for (let i = 0; i < n; i++) {
        actor.workers.push(newWorker(`${actor.id}-w${actor.workerCounter++}`));
    }
    return `hired ${n}; total ${actor.workers.length}`;
}

function cmdAssign(actor, data, args) {
    const [bIdxRaw, sIdxRaw, recipeId] = args;
    const bIdx = parseInt(bIdxRaw, 10);
    const sIdx = parseInt(sIdxRaw, 10);
    if (isNaN(bIdx) || isNaN(sIdx) || !recipeId) return 'usage: assign <bldg-idx> <slot-idx> <recipe>';
    const bldg = actor.buildings[bIdx];
    if (!bldg) return `no building at index ${bIdx}`;
    if (sIdx < 0 || sIdx >= bldg.slots.length) return `bldg ${bIdx} (${bldg.type}) has no slot ${sIdx}`;
    if (bldg.slots[sIdx]) return `slot ${sIdx} of ${bldg.type} already running ${bldg.slots[sIdx].recipe}; unassign first`;
    const recipe = (data.recipes || {})[recipeId];
    if (!recipe) return `unknown recipe '${recipeId}'`;
    if (recipe.building !== bldg.type) return `recipe '${recipeId}' runs in ${recipe.building}, not ${bldg.type}`;
    if (recipe.tech && !actor.researched.has(recipe.tech)) return `recipe '${recipeId}' needs tech '${recipe.tech}'`;
    const idle = idleWorkers(actor);
    const need = recipe.workers || 0;
    if (idle.length < need) return `need ${need} idle workers, have ${idle.length}`;
    bldg.slots[sIdx] = {
        recipe: recipeId,
        progress: 0,
        workerIds: idle.slice(0, need).map(w => w.id),
    };
    return `assigned ${need} workers to ${bldg.type}#${sIdx} running ${recipeId}`;
}

function cmdUnassign(actor, args) {
    const [bIdxRaw, sIdxRaw] = args;
    const bIdx = parseInt(bIdxRaw, 10);
    const sIdx = parseInt(sIdxRaw, 10);
    if (isNaN(bIdx) || isNaN(sIdx)) return 'usage: unassign <bldg-idx> <slot-idx>';
    const bldg = actor.buildings[bIdx];
    if (!bldg) return `no building at index ${bIdx}`;
    if (!bldg.slots[sIdx]) return `slot ${sIdx} already idle`;
    const recipe = bldg.slots[sIdx].recipe;
    bldg.slots[sIdx] = null;
    return `unassigned ${bldg.type}#${sIdx} (was ${recipe})`;
}

function cmdSetPrice(actor, data, args) {
    const [item, priceRaw] = args;
    if (!item || priceRaw === undefined) return 'usage: set-price <item> <price>';
    if (!(data.items || {})[item]) return `unknown item '${item}'`;
    const price = parseFloat(priceRaw);
    if (isNaN(price) || price < 0) return `invalid price '${priceRaw}'`;
    if (price === 0) {
        delete actor.priceBook[item];
        return `cleared sell-price for ${item}`;
    }
    actor.priceBook[item] = price;
    return `selling ${item} at $${price.toFixed(2)}/unit`;
}

function cmdSetBid(actor, data, args) {
    const [item, priceRaw, qtyRaw] = args;
    if (!item || priceRaw === undefined || qtyRaw === undefined) return 'usage: set-bid <item> <price> <qty>';
    if (!(data.items || {})[item]) return `unknown item '${item}'`;
    const price = parseFloat(priceRaw);
    const qty = parseInt(qtyRaw, 10);
    if (isNaN(price) || price <= 0) return `invalid price '${priceRaw}'`;
    if (isNaN(qty) || qty <= 0) return `invalid qty '${qtyRaw}'`;
    actor.pendingBids.push({ item, price, qty });
    return `queued bid: ${qty} ${item} @ $${price.toFixed(2)}`;
}

function workersList(actor) {
    if (!actor.workers.length) return '(no workers)';
    const placement = {};
    actor.buildings.forEach((b, bi) => {
        b.slots.forEach((slot, si) => {
            if (!slot) return;
            for (const id of slot.workerIds) placement[id] = `${b.type}#${si} (${slot.recipe})`;
        });
    });
    const lines = [];
    for (const w of actor.workers) {
        const top = Object.entries(w.skill || {}).reduce(
            (m, [k, v]) => (v > m[1] ? [k, v] : m),
            ['', 0]
        );
        const skillStr = top[0] ? `${top[0]}:${top[1].toFixed(2)}` : '-';
        const where = placement[w.id] || 'idle';
        lines.push(`  ${w.id.padEnd(12)}  ${where.padEnd(28)}  ${skillStr}`);
    }
    return lines.join('\n');
}

function cmdFire(actor, args) {
    const [workerId] = args;
    if (!workerId) return 'usage: fire <worker-id>';
    const idx = actor.workers.findIndex(w => w.id === workerId);
    if (idx === -1) return `no worker '${workerId}'`;
    let unassigned = 0;
    for (const b of actor.buildings) {
        for (const slot of b.slots) {
            if (!slot) continue;
            const before = slot.workerIds.length;
            slot.workerIds = slot.workerIds.filter(id => id !== workerId);
            unassigned += before - slot.workerIds.length;
        }
    }
    actor.workers.splice(idx, 1);
    return unassigned
        ? `fired ${workerId} (was assigned; slot may now idle until refilled)`
        : `fired ${workerId}`;
}

function cmdBuild(actor, data, args) {
    const [type] = args;
    if (!type) return 'usage: build <building-type>';
    const def = (data.buildings || {})[type];
    if (!def) return `unknown building type '${type}'`;
    const construction = def.construction || {};
    for (const [item, amt] of Object.entries(construction)) {
        const have = actor.inventory[item] || 0;
        if (have < amt) return `need ${amt} ${item}, have ${have}`;
    }
    for (const [item, amt] of Object.entries(construction)) {
        actor.inventory[item] -= amt;
    }
    const numSlots = def.slots || 1;
    const idx = actor.buildingCounter++;
    actor.buildings.push({
        id: `${actor.id}-${type}-${idx}`,
        type,
        slots: Array(numSlots).fill(null),
    });
    return `built ${type} (idx ${actor.buildings.length - 1}, ${numSlots} slot${numSlots === 1 ? '' : 's'})`;
}

function cmdDemolish(actor, args) {
    const [bIdxRaw] = args;
    const bIdx = parseInt(bIdxRaw, 10);
    if (isNaN(bIdx)) return 'usage: demolish <bldg-idx>';
    const bldg = actor.buildings[bIdx];
    if (!bldg) return `no building at index ${bIdx}`;
    let freed = 0;
    for (const slot of bldg.slots) {
        if (slot) freed += slot.workerIds.length;
    }
    actor.buildings.splice(bIdx, 1);
    return `demolished ${bldg.type}${freed ? ` (freed ${freed} workers)` : ''}`;
}

function cmdResearch(actor, data, args) {
    const [techId] = args;
    if (!techId) return 'usage: research <tech>';
    const def = (data.tech || {})[techId];
    if (!def) return `unknown tech '${techId}'`;
    if (actor.researched.has(techId)) return `already researched '${techId}'`;
    if (actor.researchInProgress) {
        return `already researching '${actor.researchInProgress.tech}' (${actor.researchInProgress.progress}/${(data.tech[actor.researchInProgress.tech] || {}).research_cost || 0})`;
    }
    for (const p of def.prereqs || []) {
        if (!actor.researched.has(p)) return `missing prereq '${p}'`;
    }
    actor.researchInProgress = { tech: techId, progress: 0 };
    return `started research: ${techId} (cost ${def.research_cost})`;
}

function cmdTech(actor, data) {
    const tech = data.tech || {};
    const lines = [];
    const done = Array.from(actor.researched).sort();
    lines.push(`researched: ${done.length ? done.join(', ') : '(none)'}`);
    if (actor.researchInProgress) {
        const rip = actor.researchInProgress;
        const cost = (tech[rip.tech] || {}).research_cost || 0;
        lines.push(`in progress: ${rip.tech} (${rip.progress}/${cost})`);
    } else {
        lines.push('in progress: (none)');
    }
    const available = [];
    for (const [id, t] of Object.entries(tech)) {
        if (actor.researched.has(id)) continue;
        if (actor.researchInProgress && actor.researchInProgress.tech === id) continue;
        const ok = (t.prereqs || []).every(p => actor.researched.has(p));
        if (ok) available.push({ id, cost: t.research_cost || 0 });
    }
    available.sort((a, b) => a.cost - b.cost);
    if (available.length) {
        lines.push('available:');
        for (const a of available) lines.push(`  ${a.id} (cost ${a.cost})`);
    } else {
        lines.push('available: (none — research more prereqs)');
    }
    return lines.join('\n');
}

function main() {
    const dataDir = process.argv[2] || path.join(__dirname, '..', 'data');
    const data = loadData(dataDir);
    const errs = validate(data);
    if (errs.length) {
        console.error('data validation failed:');
        for (const e of errs) console.error(`  - ${e}`);
        process.exit(1);
    }

    let state;
    if (fs.existsSync(SAVE_PATH)) {
        state = load(SAVE_PATH);
        const wasAlive = !!state.actors[PLAYER];
        const elapsed = Math.floor((Date.now() - state.lastTickAt) / 1000);
        if (elapsed > 0) {
            const ran = catchUp(state, data, elapsed, tick);
            let msg = `resumed; caught up ${ran} ticks`;
            if (wasAlive && !state.actors[PLAYER]) msg += ' (player went bankrupt)';
            console.log(msg);
        } else {
            console.log('resumed');
        }
    } else {
        state = initState(data);
        console.log('new game');
    }
    console.log(status(state, data));

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
    rl.prompt();
    rl.on('line', line => {
        const player = state.actors[PLAYER];
        const [cmd, ...args] = line.trim().split(/\s+/);
        if (!player && PLAYER_COMMANDS.has(cmd)) {
            console.log("bankrupt — no player actor. 'reset' to start over or 'quit'.");
            rl.prompt();
            return;
        }
        switch (cmd) {
            case '':
                break;
            case 'status':
                console.log(status(state, data));
                break;
            case 'prices':
                console.log(prices(data));
                break;
            case 'market':
                console.log(market(state, data));
                break;
            case 'tick': {
                const n = parseInt(args[0] || '1', 10);
                const wasAlive = !!player;
                for (let i = 0; i < n; i++) tick(state, data);
                if (wasAlive && !state.actors[PLAYER]) {
                    console.log('*** BANKRUPT *** player liquidated.');
                }
                console.log(status(state, data));
                break;
            }
            case 'hire':
                console.log(cmdHire(player, args));
                break;
            case 'fire':
                console.log(cmdFire(player, args));
                break;
            case 'workers':
                console.log(workersList(player));
                break;
            case 'build':
                console.log(cmdBuild(player, data, args));
                break;
            case 'demolish':
                console.log(cmdDemolish(player, args));
                break;
            case 'assign':
                console.log(cmdAssign(player, data, args));
                break;
            case 'unassign':
                console.log(cmdUnassign(player, args));
                break;
            case 'set-price':
                console.log(cmdSetPrice(player, data, args));
                break;
            case 'set-bid':
                console.log(cmdSetBid(player, data, args));
                break;
            case 'research':
                console.log(cmdResearch(player, data, args));
                break;
            case 'tech':
                console.log(cmdTech(player, data));
                break;
            case 'save':
                save(state, SAVE_PATH);
                console.log(`saved to ${SAVE_PATH}`);
                break;
            case 'reset':
                if (fs.existsSync(SAVE_PATH)) fs.unlinkSync(SAVE_PATH);
                state = initState(data);
                console.log('reset');
                break;
            case 'help':
                console.log(help());
                break;
            case 'quit':
            case 'exit':
                rl.close();
                return;
            default:
                console.log(`unknown command: ${cmd} (try 'help')`);
        }
        rl.prompt();
    });
    rl.on('close', () => {
        save(state, SAVE_PATH);
        console.log(`\nsaved to ${SAVE_PATH}`);
        process.exit(0);
    });
}

if (require.main === module) main();
