/**
 * worker.js — worker skill update and wage computation.
 *
 * Skill is in [0, 1] per tech. Output multiplier on a recipe is
 * 0.5 + 1.5 * avg_skill_in_tech across assigned workers, clamped to [0.5, 2.0].
 * Wage scales with the worker's max skill across all techs.
 */

const BASE_WAGE = 5;
const LEARNING_RATE = 0.001;

function wage(worker, baseWage = BASE_WAGE) {
    let max = 0;
    for (const v of Object.values(worker.skill || {})) if (v > max) max = v;
    return baseWage * (1 + 2 * max);
}

function gainSkill(worker, techId, rate = LEARNING_RATE) {
    const cur = worker.skill[techId] || 0;
    worker.skill[techId] = cur + rate * (1 - cur);
}

function outputMultiplier(workers, techId) {
    if (!workers.length) return 0;
    let sum = 0;
    for (const w of workers) sum += (w.skill && w.skill[techId]) || 0;
    const avg = sum / workers.length;
    return Math.max(0.5, Math.min(2.0, 0.5 + 1.5 * avg));
}

function newWorker(id) {
    return { id, skill: {}, assigned: null };
}

module.exports = { wage, gainSkill, outputMultiplier, newWorker, BASE_WAGE, LEARNING_RATE };
