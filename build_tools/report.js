#!/usr/bin/env node

/**
 * report.js — confidence-aware view of the tech tree.
 *
 * Prints scenarios and dependent tech grouped by effective confidence band.
 * Useful for "show me the future" without rendering a graph.
 *
 * Usage: node report.js [path-to-definitions]
 */

const { loadDefinitions, effectiveConfidence } = require('./schema.js');

function band(c) {
    if (c >= 1.0) return 'certain';
    if (c >= 0.5) return 'anchor';
    if (c >= 0.2) return 'probable';
    return 'speculative';
}

function fmtYear(y) {
    if (y === undefined || y === null) return '—';
    if (typeof y === 'number') return y < 0 ? `${-y} BCE` : `${y}`;
    return String(y);
}

function main() {
    const dir = process.argv[2] || 'tree/definitions';
    const data = loadDefinitions(dir);
    const techs = data.technologies;
    const eff = effectiveConfidence(techs);

    // Layer + band breakdown for the future window (year >= 2026 or layer=scenario).
    const futureIds = Object.keys(techs).filter(id => {
        const t = techs[id];
        if (t.layer === 'scenario') return true;
        if (typeof t.year === 'number' && t.year >= 2026) return true;
        return false;
    });

    const groups = { anchor: [], probable: [], speculative: [] };
    for (const id of futureIds) {
        const c = eff[id];
        const b = band(c);
        if (b === 'certain') continue;     // historical-confidence futures shouldn't happen, skip
        groups[b].push({ id, c, t: techs[id] });
    }
    for (const k of Object.keys(groups)) {
        groups[k].sort((a, b) => (a.t.year ?? 9999) - (b.t.year ?? 9999));
    }

    function printBand(label, list) {
        if (!list.length) return;
        console.log(`\n=== ${label.toUpperCase()} (${list.length}) ===`);
        for (const e of list) {
            const tag = e.t.layer === 'scenario' ? '[scenario]' : `[${e.t.layer}]`;
            const yr = fmtYear(e.t.year).padStart(6);
            const cf = e.c.toFixed(2);
            console.log(`  ${yr}  c=${cf}  ${tag.padEnd(11)} ${e.id}`);
            if (e.t.one_liner) console.log(`              ${e.t.one_liner}`);
        }
    }

    console.log(`Future-window tech (year ≥ 2026 or layer=scenario), grouped by effective confidence.\n`);
    console.log(`Effective confidence = min(self, min over hard prereqs of effective).`);
    console.log(`Bands: anchor ≥ 0.50, probable 0.20–0.49, speculative < 0.20.`);

    printBand('anchor — main timeline plans around these', groups.anchor);
    printBand('probable — design-relevant if they fire', groups.probable);
    printBand('speculative — side branches', groups.speculative);

    // Scenarios & their downstream impact
    console.log(`\n=== SCENARIO REACH ===`);
    const scenarioIds = Object.keys(techs).filter(id => techs[id].layer === 'scenario');
    const downstream = new Map(scenarioIds.map(id => [id, []]));
    for (const id of Object.keys(techs)) {
        const t = techs[id];
        if (t.layer === 'scenario') continue;
        for (const dep of (t.prerequisites?.hard || [])) {
            if (downstream.has(dep)) downstream.get(dep).push(id);
        }
    }
    const ordered = scenarioIds.sort((a, b) => (techs[b].confidence ?? 1) - (techs[a].confidence ?? 1));
    for (const id of ordered) {
        const t = techs[id];
        const d = downstream.get(id);
        const cf = (t.confidence ?? 1).toFixed(2);
        console.log(`  c=${cf}  ${id}  →  ${d.length === 0 ? '(no direct downstream tech)' : d.join(', ')}`);
    }
}

if (require.main === module) main();
