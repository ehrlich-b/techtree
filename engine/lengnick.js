#!/usr/bin/env node
/**
 * lengnick.js — minimal Lengnick (2013) baseline ABM, self-contained.
 *
 * One consumption good, F firms, H households. Households are both workers
 * and consumers. Firms adjust prices stochastically from an inventory band;
 * wages from hiring success. Households shop bounded-search over a saved
 * vendor list and apply for jobs at firms with the best wage they sample.
 *
 * Goal is a sanity check: do the literature's stability mechanisms produce
 * a stable economy in this codebase, on a reduced surface? If yes, port
 * them into the main engine. If no, the bug is something deeper.
 *
 * Ref: Lengnick, M. (2013) "Agent-based macroeconomics: A baseline model."
 *      Journal of Economic Behavior & Organization 86, 102-120.
 */

const DEFAULTS = {
    F: 100,                    // firms
    H: 1000,                   // households
    PROD_PER_EMP: 3,           // units produced per employee per tick

    INV_TARGET_LOW: 0.25,      // lower band (× smoothed demand)
    INV_TARGET_HIGH: 1.0,      // upper band

    PRICE_ADJ_PROB: 0.75,      // Calvo θ — probability of price change being implemented
    PRICE_ADJ_MAX: 0.02,       // ϑ — max ±2% per adjustment
    PRICE_MARKUP_LO: 1.025,    // ϕ  — price floor = 1.025 × marginal cost
    PRICE_MARKUP_HI: 1.15,     // ϕ̄ — price ceiling = 1.15 × marginal cost (inflation anchor)

    WAGE_ADJ_MAX: 0.019,       // δ — max ±1.9% per adjustment
    WAGE_DOWN_GAMMA: 24,       // γ — months of consecutive full employment required to cut wage
    WAGE_FLOOR: 0.05,

    VENDOR_LIST: 7,            // households remember this many firms
    JOB_SEARCH: 5,             // sample size when looking for work
    SHOP_TRIPS: 1,             // shopping visits per period

    SEARCH_FAIL_PROB: 0.25,    // replace a vendor after a stockout
    SEARCH_CHEAPER_PROB: 0.25, // try a new vendor at random

    ALPHA: 0.9,                // consumption = wealth^alpha (Lengnick)

    INIT_PRICE: 1.0,
    INIT_WAGE: 1.0,
    INIT_CASH_FIRM: 100,
    INIT_CASH_HH: 50,
    INIT_EMP_PER_FIRM: 10,     // bootstrap to ~full employment at H/F

    DEMAND_EMA: 0.1,           // slower smoothing so transient zero-sale ticks don't collapse the band
    MIN_DEMAND: 5,             // floor on smoothed demand → keeps band non-degenerate
    MIN_EMPLOYEES: 1,          // skeleton crew — never fire to zero

    RESERVE_MONTHS: 6,         // firm holds N×monthly-wage-bill as reserve; excess pays dividend

    SEED: 42,
};

// Mulberry32 PRNG — deterministic.
function makeRng(seed) {
    let a = seed | 0;
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function init(p, rng) {
    const firms = [];
    for (let i = 0; i < p.F; i++) {
        firms.push({
            id: i,
            cash: p.INIT_CASH_FIRM,
            inv: 0,
            price: p.INIT_PRICE,
            wage: p.INIT_WAGE,
            employees: new Set(),
            demand: (p.H * p.PROD_PER_EMP) / p.F, // ~per-firm steady-state guess
            hadVacancy: false,
            bankruptcies: 0,
        });
    }
    const hh = [];
    for (let i = 0; i < p.H; i++) {
        hh.push({
            id: i,
            cash: p.INIT_CASH_HH,
            employerId: null,
            wage: 0,
            vendors: pickN(rng, p.F, p.VENDOR_LIST),
        });
    }
    // Pre-seed employment so the first tick has wage flow.
    const initEmp = Math.min(p.INIT_EMP_PER_FIRM, Math.floor(p.H / p.F));
    let nextHh = 0;
    for (const f of firms) {
        for (let k = 0; k < initEmp; k++) {
            const h = hh[nextHh++];
            f.employees.add(h.id);
            h.employerId = f.id;
            h.wage = f.wage;
        }
    }
    return {
        firms, hh, tick: 0,
        voidCash: 0,
        totalProduced: 0,
        totalSold: 0,
        bankruptcies: 0,
    };
}

function pickN(rng, max, n) {
    const out = [];
    const used = new Set();
    while (out.length < n && used.size < max) {
        const idx = Math.floor(rng() * max);
        if (used.has(idx)) continue;
        used.add(idx);
        out.push(idx);
    }
    return out;
}

function step(state, p, rng) {
    const { firms, hh } = state;
    state.tick++;

    // ── Phase 1: firms pay wages, then produce ──────────────────────────
    for (const f of firms) {
        // Pay what we can; layoff any worker we can't cover.
        if (f.employees.size > 0) {
            const need = f.wage * f.employees.size;
            if (f.cash < need) {
                const canAfford = Math.max(0, Math.floor(f.cash / Math.max(f.wage, 0.01)));
                const empArr = [...f.employees];
                for (let k = canAfford; k < empArr.length; k++) {
                    const wid = empArr[k];
                    f.employees.delete(wid);
                    hh[wid].employerId = null;
                    hh[wid].wage = 0;
                }
            }
            for (const wid of f.employees) {
                f.cash -= f.wage;
                hh[wid].cash += f.wage;
            }
        }
        const produced = f.employees.size * p.PROD_PER_EMP;
        f.inv += produced;
        state.totalProduced += produced;
    }

    // ── Phase 2: households shop ────────────────────────────────────────
    const periodDemand = new Float64Array(p.F);
    let periodSold = 0;

    for (const h of hh) {
        const wealth = Math.max(h.cash, 0);
        // Lengnick consumption: spend wealth^alpha, capped at wealth.
        let budget = Math.min(Math.pow(wealth, p.ALPHA), wealth);

        for (let trip = 0; trip < p.SHOP_TRIPS; trip++) {
            if (budget <= 0) break;

            // Pick cheapest stocked vendor from saved list.
            let chosen = -1;
            let chosenPrice = Infinity;
            for (const fid of h.vendors) {
                const f = firms[fid];
                if (f.inv <= 0) continue;
                if (f.price < chosenPrice) {
                    chosenPrice = f.price;
                    chosen = fid;
                }
            }
            if (chosen < 0) {
                // All saved vendors stocked out → maybe try a new one next time.
                if (rng() < p.SEARCH_FAIL_PROB) {
                    const newId = Math.floor(rng() * p.F);
                    h.vendors[Math.floor(rng() * h.vendors.length)] = newId;
                }
                break;
            }

            const f = firms[chosen];
            const want = budget / f.price;
            const got = Math.min(want, f.inv);
            const spent = got * f.price;
            h.cash -= spent;
            f.cash += spent;
            f.inv -= got;
            budget -= spent;
            periodDemand[chosen] += got;
            periodSold += got;

            // Bounded vendor search: occasionally swap in a random firm.
            if (rng() < p.SEARCH_CHEAPER_PROB) {
                const newId = Math.floor(rng() * p.F);
                if (!h.vendors.includes(newId)) {
                    h.vendors[Math.floor(rng() * h.vendors.length)] = newId;
                }
            }
        }
    }
    state.totalSold += periodSold;

    // ── Phase 3: firms update demand, price, wage, headcount target ─────
    for (const f of firms) {
        f.demand = (1 - p.DEMAND_EMA) * f.demand + p.DEMAND_EMA * periodDemand[f.id];
        if (f.demand < p.MIN_DEMAND) f.demand = p.MIN_DEMAND;

        const lo = p.INV_TARGET_LOW * f.demand;
        const hi = p.INV_TARGET_HIGH * f.demand;
        const mc = f.wage / p.PROD_PER_EMP;
        const priceCeil = p.PRICE_MARKUP_HI * mc;
        const priceFloor = p.PRICE_MARKUP_LO * mc;

        // Price adjustment with hard cost-anchored bounds (Lengnick eqs 8-10).
        if (rng() < p.PRICE_ADJ_PROB) {
            if (f.inv < lo && f.price < priceCeil) {
                f.price *= 1 + rng() * p.PRICE_ADJ_MAX;
                if (f.price > priceCeil) f.price = priceCeil;
            } else if (f.inv > hi && f.price > priceFloor) {
                f.price *= 1 - rng() * p.PRICE_ADJ_MAX;
                if (f.price < priceFloor) f.price = priceFloor;
            }
        }
        // Snap into bounds if cost shifted out from under us.
        if (f.price < priceFloor) f.price = priceFloor;
        if (f.price > priceCeil) f.price = priceCeil;

        // Wage adjustment — full-employment streak required for cuts.
        if (f.hadVacancy) {
            f.fullEmpStreak = 0;
            f.wage *= 1 + rng() * p.WAGE_ADJ_MAX;
        } else {
            f.fullEmpStreak = (f.fullEmpStreak || 0) + 1;
            if (f.fullEmpStreak >= p.WAGE_DOWN_GAMMA) {
                f.wage *= 1 - rng() * p.WAGE_ADJ_MAX;
                f.fullEmpStreak = 0;
            }
        }
        if (f.wage < p.WAGE_FLOOR) f.wage = p.WAGE_FLOOR;

        const cur = f.employees.size;

        // Lengnick headcount rule: inventory direction drives hiring/firing.
        // Overstocked → fire one (but keep skeleton crew).
        // Understocked → post vacancy.
        if (f.inv > hi && cur > p.MIN_EMPLOYEES) {
            const empArr = [...f.employees];
            const wid = empArr[empArr.length - 1];
            f.employees.delete(wid);
            hh[wid].employerId = null;
            hh[wid].wage = 0;
            f.hadVacancy = false;
        } else if (f.inv < lo) {
            f.hadVacancy = true;
        } else {
            f.hadVacancy = false;
        }
    }

    // ── Phase 4: unemployed households apply for jobs ───────────────────
    for (const h of hh) {
        if (h.employerId !== null) continue;
        let best = null;
        let bestWage = -1;
        for (let k = 0; k < p.JOB_SEARCH; k++) {
            const fid = Math.floor(rng() * p.F);
            const f = firms[fid];
            if (!f.hadVacancy) continue;
            if (f.wage > bestWage) { bestWage = f.wage; best = f; }
        }
        if (best) {
            best.employees.add(h.id);
            h.employerId = best.id;
            h.wage = best.wage;
            const targetEmp = Math.ceil(best.demand / p.PROD_PER_EMP);
            if (best.employees.size >= targetEmp) best.hadVacancy = false;
        }
    }

    // ── Phase 4b: dividends — firms above reserve pay out excess to households ──
    // Lengnick's money-recycle mechanism. Without this, firms hoard cash
    // and demand collapses (Mark-0 "bad economy" trap).
    let dividendPool = 0;
    for (const f of firms) {
        const monthlyBill = f.wage * f.employees.size;
        const reserve = monthlyBill * p.RESERVE_MONTHS;
        if (f.cash > reserve) {
            const excess = f.cash - reserve;
            f.cash -= excess;
            dividendPool += excess;
        }
    }
    if (dividendPool > 0) {
        const perHh = dividendPool / p.H;
        for (const h of hh) h.cash += perHh;
    }

    // ── Phase 5: bankruptcy / respawn ────────────────────────────────────
    for (const f of firms) {
        if (f.cash >= 0) continue;
        // Free workers, absorb deficit into voidCash, respawn in place.
        for (const wid of f.employees) {
            hh[wid].employerId = null;
            hh[wid].wage = 0;
        }
        state.voidCash += f.cash; // negative
        f.employees.clear();

        // Respawn at median price/wage of survivors.
        const alive = firms.filter(x => x.id !== f.id && x.cash >= 0);
        const medPrice = median(alive.map(x => x.price)) || p.INIT_PRICE;
        const medWage = median(alive.map(x => x.wage)) || p.INIT_WAGE;
        state.voidCash -= p.INIT_CASH_FIRM;
        f.cash = p.INIT_CASH_FIRM;
        f.inv = 0;
        f.price = medPrice;
        f.wage = medWage;
        f.demand = (p.H * p.PROD_PER_EMP) / p.F * 0.5;
        f.hadVacancy = false;
        f.bankruptcies++;
        state.bankruptcies++;
    }
}

function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
}

function avg(arr) {
    if (!arr.length) return 0;
    let s = 0;
    for (const x of arr) s += x;
    return s / arr.length;
}

function snapshot(state, p) {
    const { firms, hh } = state;
    const employed = hh.reduce((n, h) => n + (h.employerId !== null ? 1 : 0), 0);
    const fCash = firms.reduce((s, f) => s + f.cash, 0);
    const hCash = hh.reduce((s, h) => s + h.cash, 0);
    const inv = firms.reduce((s, f) => s + f.inv, 0);
    const prices = firms.map(f => f.price);
    const wages = firms.map(f => f.wage);
    return {
        tick: state.tick,
        unempPct: ((p.H - employed) / p.H) * 100,
        avgPrice: avg(prices),
        priceMin: Math.min(...prices),
        priceMax: Math.max(...prices),
        avgWage: avg(wages),
        avgInv: inv / p.F,
        firmCash: fCash,
        hhCash: hCash,
        moneyTotal: fCash + hCash + state.voidCash,
        voidCash: state.voidCash,
        bankruptcies: state.bankruptcies,
    };
}

function run(opts = {}) {
    const p = { ...DEFAULTS, ...opts };
    const rng = makeRng(p.SEED);
    const state = init(p, rng);
    const ticks = opts.ticks || 50000;
    const every = opts.every || 1000;

    const snapshots = [snapshot(state, p)];
    for (let t = 0; t < ticks; t++) {
        step(state, p, rng);
        if ((t + 1) % every === 0) snapshots.push(snapshot(state, p));
    }
    return { state, params: p, snapshots };
}

module.exports = { run, init, step, snapshot, DEFAULTS };

if (require.main === module) {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        const k = args[i];
        if (k === '--ticks') opts.ticks = parseInt(args[++i]);
        else if (k === '--every') opts.every = parseInt(args[++i]);
        else if (k === '--seed') opts.SEED = parseInt(args[++i]);
        else if (k === '--firms') opts.F = parseInt(args[++i]);
        else if (k === '--households') opts.H = parseInt(args[++i]);
    }

    const t0 = Date.now();
    const { snapshots, state, params } = run(opts);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const ticks = opts.ticks || 50000;
    console.log(`Lengnick smoke — F=${params.F} H=${params.H} ticks=${ticks} seed=${params.SEED}`);
    console.log(`Ran in ${elapsed}s\n`);
    console.log('tick      unemp%   avgPrice  priceMin  priceMax   avgWage   avgInv  firmCash    hhCash  money±   bnkr');
    const initMoney = snapshots[0].moneyTotal;
    for (const s of snapshots) {
        const moneyDelta = ((s.moneyTotal - initMoney) / initMoney * 100).toFixed(1);
        console.log(
            String(s.tick).padStart(6) + ' ' +
            s.unempPct.toFixed(1).padStart(8) + ' ' +
            s.avgPrice.toFixed(3).padStart(9) + ' ' +
            s.priceMin.toFixed(3).padStart(9) + ' ' +
            s.priceMax.toFixed(3).padStart(9) + ' ' +
            s.avgWage.toFixed(3).padStart(9) + ' ' +
            s.avgInv.toFixed(1).padStart(8) + ' ' +
            s.firmCash.toFixed(0).padStart(9) + ' ' +
            s.hhCash.toFixed(0).padStart(9) + ' ' +
            (moneyDelta + '%').padStart(8) + ' ' +
            String(s.bankruptcies).padStart(6)
        );
    }
    const last = snapshots[snapshots.length - 1];
    console.log(`\nFinal: unemployment=${last.unempPct.toFixed(1)}%  ` +
                `price=${last.avgPrice.toFixed(3)}  wage=${last.avgWage.toFixed(3)}  ` +
                `inv/firm=${last.avgInv.toFixed(1)}  bankruptcies=${last.bankruptcies}`);
    console.log(`Total produced: ${state.totalProduced.toFixed(0)}, sold: ${state.totalSold.toFixed(0)}`);
}
