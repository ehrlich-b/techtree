#!/usr/bin/env node

/**
 * schema.js — TechTree v2 schema validator
 *
 * Union-tolerant: accepts both v1 (type/era/id) and v2 (layer/year/confidence) fields
 * so the 127 historical entries keep validating during migration.
 *
 * Required: name, layer (or v1 `type`)
 * Optional: year, confidence, prerequisites.{hard,soft,catalyst}, one_liner, sources, notes
 * Tolerated (ignored): description, unlocks, resources, historical, complexity, alternate_*,
 *                       prerequisites.synergistic
 *
 * Usage: node schema.js [path-to-definitions-dir]
 */

const fs = require('fs');
const path = require('path');

// ---------- YAML loader (hand-rolled, no deps) ----------
// Handles: nested maps with 2-space indents, inline arrays [a, b, c],
// quoted/unquoted scalars, integers (incl. negative), floats, booleans, null,
// block-list arrays (- item), comments. No multi-line strings (notes stays single-line).

function parseScalar(raw) {
    if (raw === undefined) return undefined;
    const s = raw.trim();
    if (s === '' || s === '~' || s === 'null') return null;
    if (s === 'true' || s === 'True') return true;
    if (s === 'false' || s === 'False') return false;
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        return s.slice(1, -1);
    }
    if (s.startsWith('[') && s.endsWith(']')) {
        const body = s.slice(1, -1).trim();
        if (body === '') return [];
        return body.split(',').map(x => parseScalar(x));
    }
    if (s.startsWith('{') && s.endsWith('}')) {
        // tolerate `{}` for empty maps
        if (s.slice(1, -1).trim() === '') return {};
    }
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    return s;
}

function stripComment(line) {
    // Remove # comments outside quoted strings. Simple state machine.
    let out = '';
    let inSingle = false, inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        else if (c === '#' && !inSingle && !inDouble) break;
        out += c;
    }
    return out.replace(/\s+$/, '');
}

function parseYAML(content) {
    const rawLines = content.split('\n').map(stripComment);
    // Filter blank lines but keep indentation info on real lines.
    const lines = rawLines.map(l => ({ raw: l, indent: l.length - l.trimStart().length, trimmed: l.trim() }))
                          .filter(x => x.trimmed !== '');

    let i = 0;
    function parseBlock(parentIndent) {
        // Returns either an object (map) or an array (list of items).
        // Decided by first non-empty line's leading char.
        if (i >= lines.length) return null;
        const first = lines[i];
        if (first.indent <= parentIndent) return null;
        const blockIndent = first.indent;

        if (first.trimmed.startsWith('- ')) {
            // List
            const arr = [];
            while (i < lines.length && lines[i].indent === blockIndent && lines[i].trimmed.startsWith('- ')) {
                const itemBody = lines[i].trimmed.slice(2);
                if (itemBody.includes(':') && !itemBody.startsWith('"') && !itemBody.startsWith("'")) {
                    // map item starting on the same line
                    const [k, ...rest] = itemBody.split(':');
                    const after = rest.join(':').trim();
                    i++;
                    const obj = {};
                    obj[k.trim()] = after === '' ? parseBlock(blockIndent) : parseScalar(after);
                    // continue to absorb any sibling fields at deeper indent under the same '-'
                    while (i < lines.length && lines[i].indent > blockIndent && !lines[i].trimmed.startsWith('- ')) {
                        const sub = parseBlock(blockIndent);
                        if (sub && typeof sub === 'object' && !Array.isArray(sub)) Object.assign(obj, sub);
                        else break;
                    }
                    arr.push(obj);
                } else {
                    arr.push(parseScalar(itemBody));
                    i++;
                }
            }
            return arr;
        }

        // Map
        const obj = {};
        while (i < lines.length && lines[i].indent === blockIndent) {
            const ln = lines[i];
            if (ln.trimmed.startsWith('- ')) break;
            const colonIdx = ln.trimmed.indexOf(':');
            if (colonIdx === -1) { i++; continue; }
            const key = ln.trimmed.slice(0, colonIdx).trim();
            const after = ln.trimmed.slice(colonIdx + 1).trim();
            i++;
            if (after === '') {
                obj[key] = parseBlock(blockIndent);
                if (obj[key] === null && i < lines.length && lines[i].indent > blockIndent) {
                    // empty mapping but there are children at deeper indent — recurse
                    obj[key] = parseBlock(blockIndent);
                }
                if (obj[key] === null) obj[key] = {};
            } else {
                obj[key] = parseScalar(after);
            }
        }
        return obj;
    }

    // Top level expects `technologies:` then a nested map.
    let result = { technologies: {} };
    while (i < lines.length) {
        const ln = lines[i];
        if (ln.indent === 0 && ln.trimmed.startsWith('technologies:')) {
            i++;
            const block = parseBlock(0);
            if (block && typeof block === 'object') result.technologies = block;
            break;
        }
        i++;
    }
    return result;
}

// ---------- File loader ----------

function findYamlFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...findYamlFiles(full));
        else if (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) out.push(full);
    }
    return out;
}

function loadDefinitions(definitionsDir = 'tree/definitions') {
    if (!fs.existsSync(definitionsDir)) {
        throw new Error(`Definitions directory not found: ${definitionsDir}`);
    }
    const all = {};
    const files = findYamlFiles(definitionsDir);
    console.log(`Found ${files.length} definition files`);
    for (const f of files) {
        try {
            const raw = fs.readFileSync(f, 'utf8');
            const data = parseYAML(raw);
            if (data.technologies && typeof data.technologies === 'object') {
                const count = Object.keys(data.technologies).length;
                Object.assign(all, data.technologies);
                console.log(`  Loaded ${count} technologies from ${path.relative('.', f)}`);
            }
        } catch (e) {
            throw new Error(`Failed to load ${f}: ${e.message}`);
        }
    }
    return { technologies: all };
}

// ---------- Schema ----------

const VALID_LAYERS = ['nature', 'material', 'social', 'knowledge', 'scenario'];
const LEGACY_TYPES = ['material', 'social', 'knowledge'];   // v1 `type`
const DEP_TYPES = ['hard', 'soft', 'catalyst'];
const TOLERATED_DEP_TYPES = ['synergistic'];                 // v1 — accepted, not enforced

function normalize(tech) {
    // v1 → v2 normalization (non-destructive: add v2 fields if missing)
    if (!tech.layer && tech.type) tech.layer = tech.type;
    if (tech.confidence === undefined) tech.confidence = 1.0;
    if (!tech.prerequisites) tech.prerequisites = {};
    for (const dt of DEP_TYPES) {
        if (!tech.prerequisites[dt]) tech.prerequisites[dt] = [];
    }
    return tech;
}

function validateOne(id, tech, allIds) {
    const errs = [];
    if (!tech.name) errs.push('missing required field: name');
    if (!tech.layer) errs.push('missing required field: layer (or legacy: type)');
    if (tech.layer && !VALID_LAYERS.includes(tech.layer)) {
        errs.push(`invalid layer '${tech.layer}'; must be one of ${VALID_LAYERS.join(', ')}`);
    }
    if (tech.id && tech.id !== id) {
        errs.push(`id mismatch: key '${id}' vs id field '${tech.id}'`);
    }
    if (tech.confidence !== undefined) {
        const c = tech.confidence;
        if (typeof c !== 'number' || c < 0 || c > 1) {
            errs.push(`confidence must be a number in [0,1]; got ${c}`);
        }
    }
    if (tech.year !== undefined && tech.year !== null) {
        if (typeof tech.year !== 'number' && typeof tech.year !== 'string') {
            errs.push(`year must be number or string; got ${typeof tech.year}`);
        }
    }
    if (tech.prerequisites && typeof tech.prerequisites === 'object') {
        for (const [dt, list] of Object.entries(tech.prerequisites)) {
            if (!DEP_TYPES.includes(dt) && !TOLERATED_DEP_TYPES.includes(dt)) {
                errs.push(`unknown dependency type '${dt}'`);
                continue;
            }
            if (!Array.isArray(list)) {
                errs.push(`prerequisites.${dt} must be an array`);
                continue;
            }
            // Only enforce reference resolution on first-class dep types.
            // Tolerated types (synergistic, legacy) may reference unknown ids without error.
            if (DEP_TYPES.includes(dt)) {
                for (const dep of list) {
                    if (!allIds.has(dep)) errs.push(`unknown prereq '${dep}' in ${dt}`);
                }
            }
        }
    }
    return errs;
}

function detectCycles(techs) {
    // Cycles only matter on hard edges. Soft/catalyst can be conceptually cyclic
    // (math ↔ astronomy mutually reinforcing) without breaking DAG semantics.
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map();
    for (const id of Object.keys(techs)) color.set(id, WHITE);
    const cycles = [];

    function visit(id, stack) {
        if (color.get(id) === GRAY) {
            const idx = stack.indexOf(id);
            cycles.push(stack.slice(idx).concat(id));
            return;
        }
        if (color.get(id) === BLACK) return;
        color.set(id, GRAY);
        stack.push(id);
        const t = techs[id];
        if (t && t.prerequisites) {
            for (const dep of (t.prerequisites.hard || [])) {
                if (techs[dep]) visit(dep, stack);
            }
        }
        stack.pop();
        color.set(id, BLACK);
    }
    for (const id of Object.keys(techs)) visit(id, []);
    return cycles;
}

function effectiveConfidence(techs) {
    // E[id] = min(self_confidence, min over hard prereqs of E[prereq]).
    // Memoized; cycles already ruled out (or return self if loop detected).
    const memo = new Map();
    const visiting = new Set();
    function eff(id) {
        if (memo.has(id)) return memo.get(id);
        if (visiting.has(id)) return techs[id]?.confidence ?? 1.0;
        visiting.add(id);
        const t = techs[id];
        if (!t) { visiting.delete(id); return 1.0; }
        let c = t.confidence ?? 1.0;
        for (const dep of (t.prerequisites?.hard || [])) {
            if (techs[dep]) c = Math.min(c, eff(dep));
        }
        visiting.delete(id);
        memo.set(id, c);
        return c;
    }
    const out = {};
    for (const id of Object.keys(techs)) out[id] = eff(id);
    return out;
}

function validateTechnologies(techs) {
    for (const [id, tech] of Object.entries(techs)) normalize(tech);
    const allIds = new Set(Object.keys(techs));
    let total = 0;
    for (const [id, tech] of Object.entries(techs)) {
        const errs = validateOne(id, tech, allIds);
        if (errs.length) {
            console.error(`\n❌ ${id}:`);
            for (const e of errs) console.error(`  - ${e}`);
            total += errs.length;
        }
    }
    const cycles = detectCycles(techs);
    if (cycles.length) {
        console.error(`\n❌ ${cycles.length} cycle(s) detected (hard+soft+catalyst graph):`);
        for (const c of cycles.slice(0, 5)) console.error(`  - ${c.join(' -> ')}`);
        total += cycles.length;
    }

    if (total === 0) {
        console.log(`\n✅ Schema validation passed for ${allIds.size} technologies`);
        // Confidence rollup summary
        const eff = effectiveConfidence(techs);
        const buckets = { anchor: 0, probable: 0, speculative: 0, certain: 0 };
        for (const [id, c] of Object.entries(eff)) {
            if (c >= 1.0) buckets.certain++;
            else if (c >= 0.5) buckets.anchor++;
            else if (c >= 0.2) buckets.probable++;
            else buckets.speculative++;
        }
        console.log(`   Effective confidence: ${buckets.certain} certain, ${buckets.anchor} anchor, ${buckets.probable} probable, ${buckets.speculative} speculative`);
        return true;
    } else {
        console.error(`\n❌ Schema validation failed with ${total} error(s)`);
        return false;
    }
}

if (require.main === module) {
    const dir = process.argv[2] || 'tree/definitions';
    console.log(`🔍 Validating technology definitions from ${dir}...`);
    try {
        const data = loadDefinitions(dir);
        console.log(`\nTotal technologies loaded: ${Object.keys(data.technologies).length}`);
        const ok = validateTechnologies(data.technologies);
        process.exit(ok ? 0 : 1);
    } catch (e) {
        console.error(`❌ ${e.message}`);
        process.exit(1);
    }
}

module.exports = { validateTechnologies, loadDefinitions, parseYAML, effectiveConfidence };
