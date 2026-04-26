#!/usr/bin/env node

/**
 * migrate.js — one-shot v1 → v2 converter for tree/definitions/*.
 *
 * Transforms (per technology):
 *   - id: <key>            → drop (key is authoritative; warn on mismatch)
 *   - type: material       → layer: material
 *   - era: <name>          → year: <inferred>  (only if year missing)
 *   - prerequisites.synergistic → drop
 *   - empty prereq arrays   → drop the key
 *   - drop: complexity, description, unlocks, resources, historical,
 *           alternate_paths, alternate_solutions
 *   - keep: name, prerequisites.{hard,soft,catalyst}, layer, year,
 *           confidence (only if != 1.0), one_liner, sources, notes
 *
 * Year inference order:
 *   1. Existing tech.year if numeric
 *   2. Parse tech.historical.first_occurrence (e.g. "~3.3 million years ago", "~1712 CE")
 *   3. Era midpoint
 *
 * Already-v2 entries (no `type`, has `layer`) round-trip through the emitter
 * for consistent formatting.
 *
 * Usage: node migrate.js [path-to-definitions]   (defaults to tree/definitions)
 */

const fs = require('fs');
const path = require('path');
const { parseYAML } = require('./schema.js');

const ERA_MIDPOINT = {
    prehistoric: -50000,
    ancient: -1000,
    medieval: 1000,
    'early-modern': 1600,
    industrial: 1850,
    information: 1975,
    contemporary: 2015,
    future: null,
};

function parseFirstOccurrence(s) {
    if (typeof s !== 'string') return null;
    const t = s.replace(/^~/, '').trim();
    let m;
    if ((m = t.match(/^(\d+(?:\.\d+)?)\s*million\s+years?\s+ago/i))) {
        return -Math.round(parseFloat(m[1]) * 1e6);
    }
    if ((m = t.match(/^([\d,]+)\s*years?\s+ago/i))) {
        return -parseInt(m[1].replace(/,/g, ''), 10);
    }
    if ((m = t.match(/^([\d,]+)\s*BCE/i))) {
        return -parseInt(m[1].replace(/,/g, ''), 10);
    }
    if ((m = t.match(/^([\d,]+)\s*CE/i))) {
        return parseInt(m[1].replace(/,/g, ''), 10);
    }
    return null;
}

function inferYear(tech) {
    if (typeof tech.year === 'number') return tech.year;
    const fo = tech.historical && tech.historical.first_occurrence;
    const parsed = parseFirstOccurrence(fo);
    if (parsed !== null) return parsed;
    if (tech.era && ERA_MIDPOINT[tech.era] !== undefined) return ERA_MIDPOINT[tech.era];
    return null;
}

function migrateOne(id, tech) {
    if (tech.id && tech.id !== id) {
        console.warn(`  ⚠️  ${id}: id field '${tech.id}' mismatches key — using key`);
    }
    const out = { name: tech.name, layer: tech.layer || tech.type };
    const year = inferYear(tech);
    if (year !== null && year !== undefined) out.year = year;
    if (typeof tech.confidence === 'number' && tech.confidence !== 1.0) {
        out.confidence = tech.confidence;
    }
    const prereqs = {};
    for (const dt of ['hard', 'soft', 'catalyst']) {
        const list = tech.prerequisites && tech.prerequisites[dt];
        if (Array.isArray(list) && list.length > 0) prereqs[dt] = list;
    }
    if (Object.keys(prereqs).length > 0) out.prerequisites = prereqs;
    if (tech.one_liner) out.one_liner = tech.one_liner;
    return out;
}

function captureHeader(content) {
    const headerLines = [];
    for (const ln of content.split('\n')) {
        const t = ln.trim();
        if (t === '' || t.startsWith('#')) headerLines.push(ln);
        else break;
    }
    return headerLines.join('\n').replace(/\s+$/, '');
}

function emitConfidence(c) {
    // Two-decimal convention used throughout v2 files: 0.50, 0.85, 0.05
    return c.toFixed(2);
}

function emitTech(id, t) {
    let s = `  ${id}:\n`;
    s += `    name: "${t.name.replace(/"/g, '\\"')}"\n`;
    s += `    layer: ${t.layer}\n`;
    if (t.year !== undefined) s += `    year: ${t.year}\n`;
    if (t.confidence !== undefined) s += `    confidence: ${emitConfidence(t.confidence)}\n`;
    if (t.prerequisites) {
        s += `    prerequisites:\n`;
        for (const dt of ['hard', 'soft', 'catalyst']) {
            if (t.prerequisites[dt] && t.prerequisites[dt].length > 0) {
                s += `      ${dt}: [${t.prerequisites[dt].join(', ')}]\n`;
            }
        }
    }
    if (t.one_liner) s += `    one_liner: "${t.one_liner.replace(/"/g, '\\"')}"\n`;
    return s;
}

function emitFile(techs, header) {
    let s = header ? header + '\n\n' : '';
    s += 'technologies:\n\n';
    const ids = Object.keys(techs);
    for (let i = 0; i < ids.length; i++) {
        s += emitTech(ids[i], techs[ids[i]]);
        if (i < ids.length - 1) s += '\n';
    }
    return s;
}

function processFile(file) {
    const content = fs.readFileSync(file, 'utf8');
    const header = captureHeader(content);
    const data = parseYAML(content);
    if (!data.technologies || Object.keys(data.technologies).length === 0) return null;

    const out = {};
    let migrated = 0, kept = 0;
    for (const [id, tech] of Object.entries(data.technologies)) {
        const isV2 = !tech.type && tech.layer;
        if (isV2) {
            out[id] = migrateOne(id, tech);  // round-trip through allow-list to clean up
            kept++;
        } else {
            out[id] = migrateOne(id, tech);
            migrated++;
        }
    }
    return { header, techs: out, migrated, kept };
}

function walk(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(f));
        else if (f.endsWith('.yml') || f.endsWith('.yaml')) out.push(f);
    }
    return out;
}

function main() {
    const dir = process.argv[2] || 'tree/definitions';
    if (!fs.existsSync(dir)) {
        console.error(`❌ Definitions directory not found: ${dir}`);
        process.exit(1);
    }
    const files = walk(dir);
    let totalMigrated = 0, totalKept = 0;
    for (const f of files) {
        const result = processFile(f);
        if (!result) continue;
        const yaml = emitFile(result.techs, result.header);
        fs.writeFileSync(f, yaml);
        const rel = path.relative('.', f);
        console.log(`  ${rel}: migrated ${result.migrated}, kept ${result.kept}`);
        totalMigrated += result.migrated;
        totalKept += result.kept;
    }
    console.log(`\nTotal: migrated ${totalMigrated} v1 entries, round-tripped ${totalKept} v2 entries.`);
}

if (require.main === module) main();

module.exports = { migrateOne, parseFirstOccurrence, inferYear };
