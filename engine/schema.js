#!/usr/bin/env node
/**
 * schema.js — TechTree data validator.
 *
 * Verifies every cross-reference resolves and the tech DAG has no cycles.
 *
 * Usage: node engine/schema.js [data-dir]
 */

const path = require('path');
const { loadData } = require('./load.js');

const ID_RE = /^[a-z][a-z0-9-]*$/;

function validate(data) {
    const errs = [];
    const items = data.items || {};
    const recipes = data.recipes || {};
    const tech = data.tech || {};
    const buildings = data.buildings || {};
    const actors = data.actors || {};

    function checkId(kind, id) {
        if (!ID_RE.test(id)) errs.push(`${kind} id '${id}' must match ${ID_RE}`);
    }

    function checkRef(kind, parent, field, ref, registry, registryName) {
        if (registry[ref] === undefined) {
            errs.push(`${kind} '${parent}'.${field} references unknown ${registryName} '${ref}'`);
        }
    }

    // Items
    for (const [id, item] of Object.entries(items)) {
        checkId('item', id);
        if (!item.name) errs.push(`item '${id}' missing name`);
        if (!item.era) errs.push(`item '${id}' missing era`);
        if (item.tier === undefined) errs.push(`item '${id}' missing tier`);
    }

    // Tech
    for (const [id, t] of Object.entries(tech)) {
        checkId('tech', id);
        if (!t.name) errs.push(`tech '${id}' missing name`);
        if (t.research_cost === undefined) errs.push(`tech '${id}' missing research_cost`);
        for (const p of t.prereqs || []) checkRef('tech', id, 'prereqs', p, tech, 'tech');
    }

    // Buildings
    for (const [id, b] of Object.entries(buildings)) {
        checkId('building', id);
        if (!b.name) errs.push(`building '${id}' missing name`);
        if (b.slots === undefined) errs.push(`building '${id}' missing slots`);
        for (const item of Object.keys(b.construction || {})) {
            checkRef('building', id, 'construction', item, items, 'item');
        }
    }

    // Recipes
    for (const [id, r] of Object.entries(recipes)) {
        checkId('recipe', id);
        if (!r.name) errs.push(`recipe '${id}' missing name`);
        if (!r.building) errs.push(`recipe '${id}' missing building`);
        else checkRef('recipe', id, 'building', r.building, buildings, 'building');
        if (r.tech !== undefined) checkRef('recipe', id, 'tech', r.tech, tech, 'tech');
        if (!r.outputs || Object.keys(r.outputs).length === 0) {
            errs.push(`recipe '${id}' must produce at least one output`);
        }
        for (const item of Object.keys(r.inputs || {})) {
            checkRef('recipe', id, 'inputs', item, items, 'item');
        }
        for (const item of Object.keys(r.outputs || {})) {
            checkRef('recipe', id, 'outputs', item, items, 'item');
        }
        if (r.seconds === undefined) errs.push(`recipe '${id}' missing seconds`);
        if (r.workers === undefined) errs.push(`recipe '${id}' missing workers`);
    }

    // Actors
    for (const [id, a] of Object.entries(actors)) {
        checkId('actor', id);
        if (a.cash === undefined) errs.push(`actor '${id}' missing cash`);
        for (const item of Object.keys(a.starting_inventory || {})) {
            checkRef('actor', id, 'starting_inventory', item, items, 'item');
        }
        for (const b of a.starting_buildings || []) {
            checkRef('actor', id, 'starting_buildings', b, buildings, 'building');
        }
        for (const t of a.starting_tech || []) {
            checkRef('actor', id, 'starting_tech', t, tech, 'tech');
        }
        if (a.starting_workers !== undefined) {
            const w = a.starting_workers;
            if (typeof w !== 'number' || !Number.isInteger(w) || w < 0) {
                errs.push(`actor '${id}'.starting_workers must be a non-negative integer`);
            }
        }
        const startingBldgSet = new Set(a.starting_buildings || []);
        const startingTechSet = new Set(a.starting_tech || []);
        for (const [bldg, recipeId] of Object.entries(a.starting_assignments || {})) {
            if (!startingBldgSet.has(bldg)) {
                errs.push(`actor '${id}'.starting_assignments references building '${bldg}' not in starting_buildings`);
                continue;
            }
            const r = recipes[recipeId];
            if (!r) {
                errs.push(`actor '${id}'.starting_assignments recipe '${recipeId}' not found`);
                continue;
            }
            if (r.building !== bldg) {
                errs.push(`actor '${id}'.starting_assignments recipe '${recipeId}' runs in '${r.building}', not '${bldg}'`);
            }
            if (r.tech && !startingTechSet.has(r.tech)) {
                errs.push(`actor '${id}'.starting_assignments recipe '${recipeId}' needs tech '${r.tech}'`);
            }
        }
    }

    // Tech DAG cycles
    const cycle = findCycle(tech, t => (tech[t] && tech[t].prereqs) || []);
    if (cycle) errs.push(`tech DAG has cycle: ${cycle.join(' -> ')}`);

    // Productive-items rule: every item is either a recipe output or has a recipe path that produces it.
    // (Decorative-only items are forbidden.)
    const produced = new Set();
    for (const r of Object.values(recipes)) {
        for (const out of Object.keys(r.outputs || {})) produced.add(out);
    }
    for (const id of Object.keys(items)) {
        if (!produced.has(id)) errs.push(`item '${id}' has no recipe that produces it`);
    }

    return errs;
}

function findCycle(nodes, edges) {
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = {};
    for (const n of Object.keys(nodes)) color[n] = WHITE;
    const stack = [];
    function dfs(n) {
        color[n] = GRAY;
        stack.push(n);
        for (const nb of edges(n)) {
            if (color[nb] === GRAY) {
                const start = stack.indexOf(nb);
                return stack.slice(start).concat([nb]);
            }
            if (color[nb] === WHITE) {
                const found = dfs(nb);
                if (found) return found;
            }
        }
        color[n] = BLACK;
        stack.pop();
        return null;
    }
    for (const n of Object.keys(nodes)) {
        if (color[n] === WHITE) {
            const found = dfs(n);
            if (found) return found;
        }
    }
    return null;
}

function summary(data) {
    return {
        items: Object.keys(data.items || {}).length,
        recipes: Object.keys(data.recipes || {}).length,
        tech: Object.keys(data.tech || {}).length,
        buildings: Object.keys(data.buildings || {}).length,
        actors: Object.keys(data.actors || {}).length,
    };
}

if (require.main === module) {
    const dir = process.argv[2] || path.join(__dirname, '..', 'data');
    let data;
    try {
        data = loadData(dir);
    } catch (e) {
        console.error(`load failed: ${e.message}`);
        process.exit(1);
    }
    const errs = validate(data);
    const s = summary(data);
    console.log(`Loaded: ${s.items} items, ${s.recipes} recipes, ${s.tech} tech, ${s.buildings} buildings, ${s.actors} actors`);
    if (errs.length === 0) {
        console.log('OK');
        process.exit(0);
    }
    console.error(`${errs.length} error(s):`);
    for (const e of errs) console.error(`  - ${e}`);
    process.exit(1);
}

module.exports = { validate, summary };
