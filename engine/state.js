/**
 * state.js — runtime state init and persistence.
 *
 * Runtime state is everything that changes during play: each actor's cash,
 * inventory, hired workers (with per-tech skill), constructed buildings (with
 * recipe assignments and progress), researched tech, price book, market
 * history. Source data (data/*.yml) does not change during play.
 */

const fs = require('fs');
const { newWorker } = require('./worker.js');

function createActor(data, id) {
    const def = (data.actors || {})[id];
    if (!def) return null;
    const buildings = data.buildings || {};
    const builtBuildings = (def.starting_buildings || []).map((bid, i) => {
        const bdef = buildings[bid] || {};
        const numSlots = bdef.slots || 1;
        return {
            id: `${id}-${bid}-${i}`,
            type: bid,
            slots: Array(numSlots).fill(null),
        };
    });
    const workers = [];
    const startingWorkers = def.starting_workers || 0;
    for (let i = 0; i < startingWorkers; i++) workers.push(newWorker(`${id}-w${i}`));
    const actor = {
        id,
        cash: def.cash || 0,
        inventory: { ...(def.starting_inventory || {}) },
        workers,
        workerCounter: startingWorkers,
        buildings: builtBuildings,
        buildingCounter: builtBuildings.length,
        researched: new Set(def.starting_tech || []),
        researchInProgress: null,
        priceBook: {},
        priceBelief: {},
        pendingBids: [],
        strategy: def.strategy || null,
        growthBuilding: def.growth_building || null,
        bankruptTicks: 0,
        stress: 0,
        evictionServed: false,
    };
    applyStartingAssignments(actor, def.starting_assignments || {}, data);
    return actor;
}

function initState(data, opts = {}) {
    const tickRateMs = opts.tickRateMs || 1000;
    const actors = {};
    for (const [id, def] of Object.entries(data.actors || {})) {
        // Actors with start_tick > 0 enter the world later via the spawn
        // queue (see entryQueue in tick.js). This staggers the appearance
        // of higher-tier specialists — engineering-co won't show up until
        // mid-game, creating visible tech-era progression.
        if ((def.start_tick || 0) > 0) continue;
        actors[id] = createActor(data, id);
    }
    return {
        tick: 0,
        tickRateMs,
        startedAt: Date.now(),
        lastTickAt: Date.now(),
        actors,
        marketHistory: {},
        respawnQueue: [],
    };
}

function applyStartingAssignments(actor, assignments, data) {
    const recipes = data.recipes || {};
    const idleQueue = [...actor.workers];
    for (const [bldgType, recipeId] of Object.entries(assignments)) {
        const recipe = recipes[recipeId];
        if (!recipe) continue;
        const bldg = actor.buildings.find(b => b.type === bldgType && b.slots[0] === null);
        if (!bldg) continue;
        const need = recipe.workers || 0;
        if (idleQueue.length < need) continue;
        const workerIds = idleQueue.splice(0, need).map(w => w.id);
        bldg.slots[0] = { recipe: recipeId, progress: 0, workerIds };
    }
}

function save(state, filePath) {
    const serializable = {
        ...state,
        actors: Object.fromEntries(
            Object.entries(state.actors).map(([id, a]) => [
                id,
                { ...a, researched: Array.from(a.researched) },
            ])
        ),
    };
    fs.writeFileSync(filePath, JSON.stringify(serializable, null, 2));
}

function load(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!raw.marketHistory) raw.marketHistory = {};
    if (!raw.respawnQueue) raw.respawnQueue = [];
    for (const a of Object.values(raw.actors || {})) {
        a.researched = new Set(a.researched);
        if (!a.priceBook) a.priceBook = {};
        if (!a.priceBelief) a.priceBelief = {};
        if (!a.pendingBids) a.pendingBids = [];
        if (a.buildingCounter === undefined) a.buildingCounter = (a.buildings || []).length;
    }
    return raw;
}

function catchUp(state, data, elapsedSeconds, tickFn) {
    const cap = 24 * 60 * 60;
    const ticks = Math.min(Math.floor(elapsedSeconds), cap);
    for (let n = 0; n < ticks; n++) tickFn(state, data);
    return ticks;
}

module.exports = { initState, createActor, save, load, catchUp };
