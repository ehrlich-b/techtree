#!/usr/bin/env node
/**
 * lengnick2.js — 2-sector Lengnick: producer + manufacturer chain.
 *
 * Tests whether the baseline stability mechanisms generalize across a
 * supply chain. One intermediate good (input) and one final good
 * (widget). Producers make input from labor only; manufacturers turn
 * input + labor into widget; households consume widget.
 *
 * Money flows: wages (firms → households), inputs (manufacturer →
 * producer), widgets (household → manufacturer), dividends (firms →
 * households uniformly).
 *
 * Same rule shape as lengnick.js — Lengnick (2013) decision rules with
 * cost-anchored price bounds, inventory-band hiring, γ-month wage damping,
 * bounded shopping search.
 */

const DEFAULTS = {
    F_P: 50,                   // producer firms
    F_M: 50,                   // manufacturer firms
    H: 1000,

    P_OUTPUT_PER_EMP: 6,       // producer productivity
    M_OUTPUT_PER_EMP: 3,       // manufacturer productivity
    INPUTS_PER_WIDGET: 1,

    INV_TARGET_LOW: 0.25,
    INV_TARGET_HIGH: 1.0,
    PRICE_ADJ_PROB: 0.75,
    PRICE_ADJ_MAX: 0.02,
    PRICE_MARKUP_LO: 1.025,
    PRICE_MARKUP_HI: 1.15,
    WAGE_ADJ_MAX: 0.019,
    WAGE_DOWN_GAMMA: 24,
    WAGE_FLOOR: 0.05,

    VENDOR_LIST: 7,
    INPUT_VENDOR_LIST: 5,
    JOB_SEARCH: 5,             // β — firms visited per month while unemployed
    PI_EMPLOYED_SEARCH: 0,     // π — disabled: with chain coupling, even π=0.1 creates a wage spiral
    RES_WAGE_CUT: 0.9,         // unemployed → reservation wage decays 10%/period
    SEARCH_FAIL_PROB: 0.25,
    SEARCH_CHEAPER_PROB: 0.25,

    ALPHA: 0.9,

    INPUT_BUFFER: 2.0,         // manufacturer target inputInv = inputsPerWidget × demand × this

    INIT_PRICE_INPUT: 0.2,
    INIT_PRICE_WIDGET: 1.0,
    INIT_WAGE: 1.0,
    INIT_CASH_FIRM: 100,
    INIT_CASH_HH: 50,
    INIT_EMP_PRODUCER: 7,
    INIT_EMP_MFR: 13,

    DEMAND_EMA: 0.1,
    MIN_DEMAND: 5,
    MIN_EMPLOYEES: 1,
    RESERVE_MONTHS: 6,

    // Market-clearing price discovery (heavier mechanism under test). When
    // on, price moves proportional to the inventory gap with an open ceiling,
    // so excess demand is rationed by a price spike instead of an unfillable
    // stockout (the wage-spiral trigger). Default off = bare Lengnick bounds.
    PRICE_CLEARING: false,
    PRICE_CLEAR_GAIN: 0.2,     // proportional price move/tick toward clearing
    PRICE_RELAX: 0.02,         // in-band pull back toward cost floor (anchor)
    PRICE_CEIL_MULT: 50,       // safety ceiling (× mc) under clearing

    // Working-capital credit (SFC-style): firms borrow to cover payroll
    // instead of shedding labor on a transient cash dip; repaid from revenue.
    // Loans create money (tracked in bankCredit) and net out of moneyTotal.
    CREDIT_ENABLE: false,
    CREDIT_MONTHS: 12,         // max loan = N × current wage bill
    CREDIT_BUFFER_MONTHS: 1,   // keep N × wage bill before repaying debt

    SEED: 42,
};

function makeRng(seed) {
    let a = seed | 0;
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function pickN(rng, max, n, offset = 0) {
    const out = [];
    const used = new Set();
    while (out.length < n && used.size < max) {
        const idx = Math.floor(rng() * max);
        if (used.has(idx)) continue;
        used.add(idx);
        out.push(idx + offset);
    }
    return out;
}

function init(p, rng) {
    const firms = [];
    // [0 .. F_P-1] are producers; [F_P .. F_P+F_M-1] are manufacturers.
    for (let i = 0; i < p.F_P; i++) {
        firms.push({
            id: i,
            sector: 'P',
            cash: p.INIT_CASH_FIRM,
            outputInv: 0,
            inputInv: 0,
            price: p.INIT_PRICE_INPUT,
            wage: p.INIT_WAGE,
            employees: new Set(),
            demand: (p.F_M * p.INIT_EMP_MFR * p.M_OUTPUT_PER_EMP * p.INPUTS_PER_WIDGET) / p.F_P,
            hadVacancy: false,
            fullEmpStreak: 0,
            inputVendors: [],
            bankruptcies: 0,
        });
    }
    for (let i = 0; i < p.F_M; i++) {
        firms.push({
            id: p.F_P + i,
            sector: 'M',
            cash: p.INIT_CASH_FIRM,
            outputInv: 0,
            inputInv: 0,
            price: p.INIT_PRICE_WIDGET,
            wage: p.INIT_WAGE,
            employees: new Set(),
            demand: (p.H * 0.5) / p.F_M,
            hadVacancy: false,
            fullEmpStreak: 0,
            inputVendors: pickN(rng, p.F_P, p.INPUT_VENDOR_LIST),
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
            reservationWage: p.INIT_WAGE,
            vendors: pickN(rng, p.F_M, p.VENDOR_LIST, p.F_P),
        });
    }

    // Bootstrap employment — fill producers first, then manufacturers.
    let next = 0;
    for (const f of firms) {
        const target = f.sector === 'P' ? p.INIT_EMP_PRODUCER : p.INIT_EMP_MFR;
        for (let k = 0; k < target && next < p.H; k++) {
            const h = hh[next++];
            f.employees.add(h.id);
            h.employerId = f.id;
            h.wage = f.wage;
        }
    }

    return {
        firms, hh, tick: 0,
        voidCash: 0,
        bankCredit: 0,
        totalProduced: { input: 0, widget: 0 },
        totalSold: { input: 0, widget: 0 },
        bankruptcies: 0,
        F_P: p.F_P,
        F_M: p.F_M,
    };
}

function step(state, p, rng) {
    const { firms, hh } = state;
    state.tick++;

    // ── Phase A: firms pay wages ────────────────────────────────────────
    for (const f of firms) {
        if (f.employees.size === 0) continue;
        const need = f.wage * f.employees.size;
        // Working-capital credit: borrow to cover payroll before shedding
        // labor, so a transient cash dip doesn't cascade into layoffs.
        if (p.CREDIT_ENABLE && f.cash < need) {
            const limit = p.CREDIT_MONTHS * need;
            const borrow = Math.min(need - f.cash, Math.max(0, limit - (f.debt || 0)));
            if (borrow > 0) { f.cash += borrow; f.debt = (f.debt || 0) + borrow; state.bankCredit += borrow; }
        }
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

    // ── Phase B: producers produce input from labor alone ───────────────
    for (const f of firms) {
        if (f.sector !== 'P') continue;
        const produced = f.employees.size * p.P_OUTPUT_PER_EMP;
        f.outputInv += produced;
        state.totalProduced.input += produced;
    }

    // ── Phase C: manufacturers shop for inputs from producers ───────────
    const periodInputDemand = new Float64Array(p.F_P);
    for (const f of firms) {
        if (f.sector !== 'M') continue;
        const targetInputInv = f.demand * p.INPUTS_PER_WIDGET * p.INPUT_BUFFER;
        // Inputs are an operating cost like wages — don't gate behind the
        // dividend reserve; manufacturers must keep buying to keep producing.
        const cashAvail = Math.max(0, f.cash);
        const want = Math.max(0, targetInputInv - f.inputInv);

        if (want <= 0 || cashAvail <= 0) continue;

        let budget = cashAvail;
        let stillWant = want;
        const tries = Math.min(p.INPUT_VENDOR_LIST, f.inputVendors.length);
        for (let t = 0; t < tries; t++) {
            if (stillWant <= 0 || budget <= 0) break;
            // Cheapest producer with stock from saved list
            let chosen = -1;
            let chosenPrice = Infinity;
            for (const fid of f.inputVendors) {
                const v = firms[fid];
                if (v.outputInv <= 0) continue;
                if (v.price < chosenPrice) {
                    chosenPrice = v.price;
                    chosen = fid;
                }
            }
            if (chosen < 0) {
                if (rng() < p.SEARCH_FAIL_PROB) {
                    const newId = Math.floor(rng() * p.F_P);
                    f.inputVendors[Math.floor(rng() * f.inputVendors.length)] = newId;
                }
                break;
            }
            const v = firms[chosen];
            const want2 = Math.min(stillWant, budget / v.price);
            const got = Math.min(want2, v.outputInv);
            const spent = got * v.price;
            f.cash -= spent;
            v.cash += spent;
            v.outputInv -= got;
            f.inputInv += got;
            budget -= spent;
            stillWant -= got;
            periodInputDemand[chosen] += got;
            state.totalSold.input += got;

            if (rng() < p.SEARCH_CHEAPER_PROB) {
                const newId = Math.floor(rng() * p.F_P);
                if (!f.inputVendors.includes(newId)) {
                    f.inputVendors[Math.floor(rng() * f.inputVendors.length)] = newId;
                }
                break; // one swap per period
            }
        }
    }

    // ── Phase D: manufacturers produce widgets (labor ∧ inputs) ─────────
    for (const f of firms) {
        if (f.sector !== 'M') continue;
        const laborCap = f.employees.size * p.M_OUTPUT_PER_EMP;
        const inputCap = Math.floor(f.inputInv / p.INPUTS_PER_WIDGET);
        const produced = Math.min(laborCap, inputCap);
        f.outputInv += produced;
        f.inputInv -= produced * p.INPUTS_PER_WIDGET;
        f.lastProduced = produced;
        f.laborUtilization = laborCap > 0 ? produced / laborCap : 1;
        state.totalProduced.widget += produced;
    }

    // ── Phase E: households shop for widgets ────────────────────────────
    const periodWidgetDemand = new Float64Array(p.F_M);
    for (const h of hh) {
        const wealth = Math.max(h.cash, 0);
        let budget = Math.min(Math.pow(wealth, p.ALPHA), wealth);
        if (budget <= 0) continue;

        // Cheapest stocked manufacturer
        let chosen = -1;
        let chosenPrice = Infinity;
        for (const fid of h.vendors) {
            const f = firms[fid];
            if (f.outputInv <= 0) continue;
            if (f.price < chosenPrice) {
                chosenPrice = f.price;
                chosen = fid;
            }
        }
        if (chosen < 0) {
            if (rng() < p.SEARCH_FAIL_PROB) {
                const newId = p.F_P + Math.floor(rng() * p.F_M);
                h.vendors[Math.floor(rng() * h.vendors.length)] = newId;
            }
            continue;
        }
        const f = firms[chosen];
        const want = budget / f.price;
        const got = Math.min(want, f.outputInv);
        const spent = got * f.price;
        h.cash -= spent;
        f.cash += spent;
        f.outputInv -= got;
        periodWidgetDemand[chosen - p.F_P] += got;
        state.totalSold.widget += got;

        if (rng() < p.SEARCH_CHEAPER_PROB) {
            const newId = p.F_P + Math.floor(rng() * p.F_M);
            if (!h.vendors.includes(newId)) {
                h.vendors[Math.floor(rng() * h.vendors.length)] = newId;
            }
        }
    }

    // ── Phase F: update demand / price / wage / headcount ───────────────
    for (const f of firms) {
        const newDemand = f.sector === 'P' ? periodInputDemand[f.id] : periodWidgetDemand[f.id - p.F_P];
        f.demand = (1 - p.DEMAND_EMA) * f.demand + p.DEMAND_EMA * newDemand;
        if (f.demand < p.MIN_DEMAND) f.demand = p.MIN_DEMAND;

        const lo = p.INV_TARGET_LOW * f.demand;
        const hi = p.INV_TARGET_HIGH * f.demand;

        // Marginal cost: P uses only labor; M uses labor + inputs.
        let mc;
        if (f.sector === 'P') {
            mc = f.wage / p.P_OUTPUT_PER_EMP;
        } else {
            // recent input cost = best-known input price (avg of vendor prices)
            let inputCost = p.INIT_PRICE_INPUT;
            if (f.inputVendors.length > 0) {
                let s = 0, n = 0;
                for (const fid of f.inputVendors) { s += firms[fid].price; n++; }
                if (n > 0) inputCost = s / n;
            }
            mc = (f.wage / p.M_OUTPUT_PER_EMP) + inputCost * p.INPUTS_PER_WIDGET;
        }
        const priceFloor = p.PRICE_MARKUP_LO * mc;
        const priceCeil = (p.PRICE_CLEARING ? p.PRICE_CEIL_MULT : p.PRICE_MARKUP_HI) * mc;

        if (p.PRICE_CLEARING) {
            // Move price proportional to the inventory gap: shortage (inv<lo)
            // raises price to ration demand down to supply; glut lowers it.
            if (rng() < p.PRICE_ADJ_PROB) {
                if (f.outputInv < lo) {
                    const shortage = Math.min((lo - f.outputInv) / Math.max(lo, 1e-9), 1);
                    f.price *= 1 + p.PRICE_CLEAR_GAIN * shortage;
                } else if (f.outputInv > hi) {
                    const glut = Math.min((f.outputInv - hi) / Math.max(hi, 1e-9), 1);
                    f.price *= 1 - p.PRICE_CLEAR_GAIN * glut;
                } else {
                    // in-band: relax toward cost floor — nominal anchor that
                    // stops prices ratcheting up when the market is balanced.
                    f.price += (priceFloor - f.price) * p.PRICE_RELAX;
                }
            }
        } else if (rng() < p.PRICE_ADJ_PROB) {
            if (f.outputInv < lo && f.price < priceCeil) {
                f.price *= 1 + rng() * p.PRICE_ADJ_MAX;
                if (f.price > priceCeil) f.price = priceCeil;
            } else if (f.outputInv > hi && f.price > priceFloor) {
                f.price *= 1 - rng() * p.PRICE_ADJ_MAX;
                if (f.price < priceFloor) f.price = priceFloor;
            }
        }
        if (f.price < priceFloor) f.price = priceFloor;
        if (f.price > priceCeil) f.price = priceCeil;

        // Wage adjustment
        if (f.hadVacancy) {
            f.fullEmpStreak = 0;
            f.wage *= 1 + rng() * p.WAGE_ADJ_MAX;
        } else {
            f.fullEmpStreak++;
            if (f.fullEmpStreak >= p.WAGE_DOWN_GAMMA) {
                f.wage *= 1 - rng() * p.WAGE_ADJ_MAX;
                f.fullEmpStreak = 0;
            }
        }
        if (f.wage < p.WAGE_FLOOR) f.wage = p.WAGE_FLOOR;

        // Headcount: original Lengnick inventory-direction rule, augmented
        // with input-starvation suppression for manufacturers.
        const cur = f.employees.size;
        const inputStarved = f.sector === 'M' && (f.laborUtilization || 1) < 0.7;
        if ((f.outputInv > hi || inputStarved) && cur > p.MIN_EMPLOYEES) {
            const empArr = [...f.employees];
            const wid = empArr[empArr.length - 1];
            f.employees.delete(wid);
            hh[wid].employerId = null;
            hh[wid].wage = 0;
            f.hadVacancy = false;
        } else if (f.outputInv < lo && !inputStarved) {
            f.hadVacancy = true;
        } else {
            f.hadVacancy = false;
        }
    }

    // ── Phase G: job search ─────────────────────────────────────────────
    // Unemployed: visit β firms, take best.
    // Employed: visit 1 firm with probability π (or 1 if unsatisfied), switch if higher wage.
    function clearVacancyIfFull(f) {
        const opEmp = f.sector === 'P' ? p.P_OUTPUT_PER_EMP : p.M_OUTPUT_PER_EMP;
        const tgt = Math.max(p.MIN_EMPLOYEES, Math.ceil(f.demand / opEmp));
        if (f.employees.size >= tgt) f.hadVacancy = false;
    }

    for (const h of hh) {
        if (h.employerId === null) {
            let best = null;
            let bestWage = -1;
            for (let k = 0; k < p.JOB_SEARCH; k++) {
                const fid = Math.floor(rng() * firms.length);
                const f = firms[fid];
                if (!f.hadVacancy) continue;
                if (f.wage > bestWage) { bestWage = f.wage; best = f; }
            }
            if (best) {
                best.employees.add(h.id);
                h.employerId = best.id;
                h.wage = best.wage;
                clearVacancyIfFull(best);
            }
        } else {
            const satisfied = h.wage >= h.reservationWage;
            const probe = satisfied ? p.PI_EMPLOYED_SEARCH : 1.0;
            if (rng() < probe) {
                const fid = Math.floor(rng() * firms.length);
                const f = firms[fid];
                if (f.id !== h.employerId && f.hadVacancy && f.wage > h.wage) {
                    const old = firms[h.employerId];
                    old.employees.delete(h.id);
                    f.employees.add(h.id);
                    h.employerId = f.id;
                    h.wage = f.wage;
                    clearVacancyIfFull(f);
                }
            }
        }
    }

    // Reservation wage update: ratchet up to actual labor income, decay 10% if unemployed.
    for (const h of hh) {
        if (h.employerId !== null) {
            if (h.wage > h.reservationWage) h.reservationWage = h.wage;
        } else {
            h.reservationWage *= p.RES_WAGE_CUT;
            if (h.reservationWage < p.WAGE_FLOOR) h.reservationWage = p.WAGE_FLOOR;
        }
    }

    // ── Phase H: debt service, then dividends ───────────────────────────
    // Repay loans from cash above a 1-month operating buffer before paying
    // dividends — repayment destroys the money the loan created.
    if (p.CREDIT_ENABLE) {
        for (const f of firms) {
            if ((f.debt || 0) <= 0) continue;
            const buffer = p.CREDIT_BUFFER_MONTHS * f.wage * f.employees.size;
            const free = f.cash - buffer;
            if (free > 0) {
                const repay = Math.min(f.debt, free);
                f.cash -= repay; f.debt -= repay; state.bankCredit -= repay;
            }
        }
    }
    let pool = 0;
    for (const f of firms) {
        const bill = f.wage * f.employees.size;
        const reserve = bill * p.RESERVE_MONTHS;
        if (f.cash > reserve) {
            const excess = f.cash - reserve;
            f.cash -= excess;
            pool += excess;
        }
    }
    if (pool > 0) {
        const perHh = pool / p.H;
        for (const h of hh) h.cash += perHh;
    }

    // ── Phase I: bankruptcy / respawn ───────────────────────────────────
    for (const f of firms) {
        if (f.cash >= 0) continue;
        for (const wid of f.employees) {
            hh[wid].employerId = null;
            hh[wid].wage = 0;
        }
        state.voidCash += f.cash;
        // Write off unpaid loan: bank eats the loss (kept money-neutral).
        if (f.debt) { state.voidCash -= f.debt; state.bankCredit -= f.debt; f.debt = 0; }
        f.employees.clear();

        // Reset to median of same-sector survivors.
        const peers = firms.filter(x => x.id !== f.id && x.sector === f.sector && x.cash >= 0);
        const medPrice = median(peers.map(x => x.price)) ||
            (f.sector === 'P' ? p.INIT_PRICE_INPUT : p.INIT_PRICE_WIDGET);
        const medWage = median(peers.map(x => x.wage)) || p.INIT_WAGE;
        state.voidCash -= p.INIT_CASH_FIRM;
        f.cash = p.INIT_CASH_FIRM;
        f.outputInv = 0;
        f.inputInv = 0;
        f.price = medPrice;
        f.wage = medWage;
        f.hadVacancy = false;
        f.fullEmpStreak = 0;
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
    const producers = firms.filter(f => f.sector === 'P');
    const mfrs = firms.filter(f => f.sector === 'M');
    const empP = producers.reduce((s, f) => s + f.employees.size, 0);
    const empM = mfrs.reduce((s, f) => s + f.employees.size, 0);
    const fCash = firms.reduce((s, f) => s + f.cash, 0);
    const hCash = hh.reduce((s, h) => s + h.cash, 0);
    return {
        tick: state.tick,
        unempPct: ((p.H - employed) / p.H) * 100,
        empP, empM,
        pPriceAvg: avg(producers.map(f => f.price)),
        mPriceAvg: avg(mfrs.map(f => f.price)),
        pWageAvg: avg(producers.map(f => f.wage)),
        mWageAvg: avg(mfrs.map(f => f.wage)),
        pInvAvg: avg(producers.map(f => f.outputInv)),
        mInvAvg: avg(mfrs.map(f => f.outputInv)),
        mInputInvAvg: avg(mfrs.map(f => f.inputInv)),
        moneyTotal: fCash + hCash + state.voidCash - (state.bankCredit || 0),
        firmCash: fCash,
        hhCash: hCash,
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

// ── Health gate ─────────────────────────────────────────────────────────
// "2-sector stable" = both sectors alive, frictional (not collapsed, not
// overheated) unemployment, cost-anchored prices that haven't exploded, and
// conserved money. Mirrors the 1-sector success criteria (unemp 3.5-7.4%,
// stable prices, money conserved) with slack for the extra sector.
const GATE = {
    UNEMP_LO: 2,        // below → overheated (persistent vacancies, wage-spiral risk)
    UNEMP_HI: 15,       // above → demand-collapse / depression
    PRICE_MAX: 1e4,     // above (or non-finite) → hyperinflation
    MONEY_PCT: 10,      // |money drift| above → accounting leak
};

function classify(s, initMoney) {
    const moneyPct = Math.abs((s.moneyTotal - initMoney) / initMoney * 100);
    if (!isFinite(s.mPriceAvg) || !isFinite(s.pPriceAvg) ||
        s.mPriceAvg > GATE.PRICE_MAX || s.pPriceAvg > GATE.PRICE_MAX) return 'hyperinflation';
    if (moneyPct > GATE.MONEY_PCT) return 'money-leak';
    if (s.empP <= 0 || s.empM <= 0) return 'sector-dead';
    if (s.unempPct > GATE.UNEMP_HI) return 'depression';
    if (s.unempPct < GATE.UNEMP_LO) return 'overheated';
    return 'healthy';
}

function ensemble(n, opts = {}) {
    const ticks = opts.ticks || 50000;
    const results = [];
    for (let seed = 1; seed <= n; seed++) {
        const { snapshots } = run({ ...opts, SEED: seed, ticks });
        const last = snapshots[snapshots.length - 1];
        const initMoney = snapshots[0].moneyTotal;
        results.push({
            seed, last,
            klass: classify(last, initMoney),
            moneyPct: (last.moneyTotal - initMoney) / initMoney * 100,
        });
    }
    return results;
}

module.exports = { run, init, step, snapshot, classify, ensemble, GATE, DEFAULTS };

if (require.main === module) {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i++) {
        const k = args[i];
        if (k === '--ticks') opts.ticks = parseInt(args[++i]);
        else if (k === '--every') opts.every = parseInt(args[++i]);
        else if (k === '--seed') opts.SEED = parseInt(args[++i]);
        else if (k === '--ensemble') opts.ensemble = parseInt(args[++i]);
    }

    if (opts.ensemble) {
        const t0 = Date.now();
        const results = ensemble(opts.ensemble, opts);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
        const ticks = opts.ticks || 50000;
        console.log(`Lengnick-2 ensemble — ${opts.ensemble} seeds, ${ticks} ticks each (ran in ${elapsed}s)\n`);
        console.log('  seed  class            unemp%   pPrice   mPrice   bnkr   money%');
        for (const r of results) {
            console.log(
                String(r.seed).padStart(6) + '  ' +
                r.klass.padEnd(15) + ' ' +
                r.last.unempPct.toFixed(1).padStart(7) + ' ' +
                r.last.pPriceAvg.toFixed(3).padStart(8) + ' ' +
                r.last.mPriceAvg.toFixed(3).padStart(8) + ' ' +
                String(r.last.bankruptcies).padStart(6) + ' ' +
                r.moneyPct.toFixed(1).padStart(7)
            );
        }
        const tally = {};
        for (const r of results) tally[r.klass] = (tally[r.klass] || 0) + 1;
        const unemps = results.map(r => r.last.unempPct).sort((a, b) => a - b);
        const med = unemps[Math.floor(unemps.length / 2)];
        const healthy = tally.healthy || 0;
        console.log('\nclasses: ' + Object.entries(tally).map(([k, v]) => `${k} ${v}`).join('  '));
        console.log(`unemp%: min ${unemps[0].toFixed(1)}  median ${med.toFixed(1)}  max ${unemps[unemps.length - 1].toFixed(1)}`);
        const frac = healthy / opts.ensemble;
        console.log(`\nRESULT: ${frac >= 0.9 ? 'PASS' : 'FAIL'}  (healthy ${healthy}/${opts.ensemble} = ${(frac * 100).toFixed(0)}%, gate ≥ 90%)`);
        process.exit(0);
    }

    const t0 = Date.now();
    const { snapshots, state, params } = run(opts);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

    const ticks = opts.ticks || 50000;
    console.log(`Lengnick-2 smoke — F_P=${params.F_P} F_M=${params.F_M} H=${params.H} ticks=${ticks} seed=${params.SEED}`);
    console.log(`Ran in ${elapsed}s\n`);
    console.log('tick    unemp%  empP empM  pPrice  mPrice   pWage   mWage  pInv  mInv mInIn  money%   bnkr');
    const initMoney = snapshots[0].moneyTotal;
    for (const s of snapshots) {
        const moneyDelta = ((s.moneyTotal - initMoney) / initMoney * 100).toFixed(1);
        console.log(
            String(s.tick).padStart(6) + ' ' +
            s.unempPct.toFixed(1).padStart(7) + ' ' +
            String(s.empP).padStart(5) + ' ' +
            String(s.empM).padStart(4) + ' ' +
            s.pPriceAvg.toFixed(3).padStart(7) + ' ' +
            s.mPriceAvg.toFixed(3).padStart(7) + ' ' +
            s.pWageAvg.toFixed(2).padStart(7) + ' ' +
            s.mWageAvg.toFixed(2).padStart(7) + ' ' +
            s.pInvAvg.toFixed(0).padStart(5) + ' ' +
            s.mInvAvg.toFixed(0).padStart(5) + ' ' +
            s.mInputInvAvg.toFixed(0).padStart(5) + ' ' +
            (moneyDelta + '%').padStart(7) + ' ' +
            String(s.bankruptcies).padStart(6)
        );
    }
    const last = snapshots[snapshots.length - 1];
    console.log(`\nFinal: unemployment=${last.unempPct.toFixed(1)}%  ` +
                `pPrice=${last.pPriceAvg.toFixed(3)} mPrice=${last.mPriceAvg.toFixed(3)}  ` +
                `bankruptcies=${last.bankruptcies}`);
    console.log(`Total input produced: ${state.totalProduced.input.toFixed(0)}, sold: ${state.totalSold.input.toFixed(0)}`);
    console.log(`Total widget produced: ${state.totalProduced.widget.toFixed(0)}, sold: ${state.totalSold.widget.toFixed(0)}`);
}
