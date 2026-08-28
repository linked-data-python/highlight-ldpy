#!/usr/bin/env node
/**
 * Tests de linked-data-python-highlight (npm test).
 *
 * 1. PARITÉ  — un fichier Python pur reçoit exactement les mêmes jetons en
 *    ldpy qu'en python, dans chaque backend. C'est l'invariant de la fiche
 *    ldpy/002 : ldpy n'étend Python que là où Python est illégal.
 * 2. GOLDEN  — la coloration des îlots, figée fichier par fichier.
 * 3. CONFORMITÉ AU TRANSPILEUR — sur une fixture qui transpile, la
 *    LanguageMap dit où sont les îlots ; aucun backend ne doit en colorer
 *    ailleurs, ni en manquer un. Le transpileur est l'arbitre, comme il l'est
 *    déjà pour le lexer Pygments (qui, lui, le LIT).
 * 4. REGEX   — toute expression de src/islands.js compile sous V8 ET sous
 *    Oniguruma : c'est la condition pour qu'elle serve les trois moteurs.
 */
'use strict';
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures');
const I = require('../src/islands');
let failures = 0;
const fail = (m) => { failures++; console.error(`ÉCHEC  ${m}`); };
const ok = (m) => console.log(`ok     ${m}`);
const skip = (m) => console.log(`passé  ${m}`);
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// ------------------------------------------------------------- backends

const hljs = require('highlight.js');
const hljsLdpy = require('../src/highlightjs');
hljs.registerLanguage('ldpy', hljsLdpy);
hljs.registerLanguage('ldpy-probe', hljsLdpy.withScopes(hljsLdpy.sentinelScopes()));

const Prism = require('prismjs');
require('prismjs/components/prism-python');
require('prismjs/components/prism-turtle');
require('prismjs/components/prism-sparql');
const prismLdpy = require('../src/prism');
prismLdpy(Prism);

const tm = require('./lib/textmate');
const { charScopes: hljsScopes } = require('./lib/hljs-tokens');
const { leaves, charTypes, ldpyChars } = require('./lib/prism-tokens');

const PURE = ['pure_basics.py', 'pure_pitfalls.py'];

// -------------------------------------------------------------- 1. parité

function checkParity() {
    for (const f of PURE) {
        const src = read(f);
        const a = hljs.highlight(src, { language: 'python' }).value;
        const b = hljs.highlight(src, { language: 'ldpy' }).value;
        if (a !== b) {
            const la = a.split('\n'); const lb = b.split('\n');
            const i = la.findIndex((l, n) => l !== lb[n]);
            fail(`parité highlight.js ${f}, ligne ${i + 1}\n       python : ${la[i]}\n       ldpy   : ${lb[i]}`);
        } else ok(`parité highlight.js : ${f}`);
    }
    for (const f of PURE) {
        const src = read(f);
        const a = charTypes(Prism, Prism.languages.python, src);
        const b = charTypes(Prism, Prism.languages.ldpy, src);
        const i = a.findIndex((t, n) => t !== b[n]);
        if (i >= 0) {
            fail(`parité Prism ${f}, ligne ${src.slice(0, i).split('\n').length} : ` +
                `${JSON.stringify(src[i])} python=${a[i]} ldpy=${b[i]}`);
        } else ok(`parité Prism : ${f}`);
    }
}

// -------------------------------------------------------------- 2. golden

function goldenText(name, pairs) {
    const out = [`# ${name}`];
    let prev = null;
    pairs.forEach(([ch, type], i) => {
        const t = type || '-';
        if (t !== prev) { out.push(`${i} ${JSON.stringify(ch)} ${t}`); prev = t; }
    });
    return out.join('\n') + '\n';
}

function checkGolden(name, file, pairs) {
    const p = path.join(FIX, file);
    const fresh = goldenText(name, pairs);
    if (process.env.UPDATE_GOLDEN) {
        fs.writeFileSync(p, fresh);
        ok(`golden ${name} régénéré (UPDATE_GOLDEN)`);
        return;
    }
    if (!fs.existsSync(p)) { fail(`golden ${name} absent — UPDATE_GOLDEN=1 npm test`); return; }
    const old = fs.readFileSync(p, 'utf8');
    if (old === fresh) { ok(`golden ${name}`); return; }
    const a = old.split('\n'); const b = fresh.split('\n');
    const i = a.findIndex((l, n) => l !== b[n]);
    fail(`golden ${name}, première divergence :\n       attendu : ${a[i]}\n       obtenu  : ${b[i]}`);
}

function checkGoldens() {
    const src = read('islands.ldpy');
    const hs = hljsScopes(hljs.highlight(src, { language: 'ldpy' }).value);
    checkGolden('highlight.js', 'islands.hljs.golden.txt',
        [...src].map((c, i) => [c, hs[i]]));
    const pt = charTypes(Prism, Prism.languages.ldpy, src);
    checkGolden('Prism', 'islands.prism.golden.txt',
        [...src].map((c, i) => [c, pt[i]]));
}

// ----------------------------------------- 3. conformité au transpileur

/** Les segments d'îlot vus par le transpileur, en offsets absolus. */
function islandsFromTranspiler(file) {
    const candidates = [process.env.LDPY_PYTHON,
        path.join(os.homedir(), '.venvs', 'ldpy', 'bin', 'python'),
        'python3'].filter(Boolean);
    const script = `
import json, sys
from ldpy.transpiler import transpile
src = open(sys.argv[1], encoding='utf-8').read()
offs, n = [0], 0
for line in src.split('\\n'):
    n += len(line) + 1
    offs.append(n)
def pos(l, c):
    return min(offs[l] + c, len(src)) if l < len(offs) else len(src)
segs = [{'kind': s.kind, 'start': pos(s.src[0], s.src[1]), 'end': pos(s.src[2], s.src[3])}
        for s in transpile(src, '<c>').map.segments
        if s.src is not None and s.kind.startswith('island:')]
print(json.dumps(segs))
`;
    for (const py of candidates) {
        try {
            const out = cp.execFileSync(py, ['-c', script, file],
                { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
            return JSON.parse(out);
        } catch (e) { /* interpréteur suivant */ }
    }
    return null;
}

/** Sortes d'îlot que le transpileur déclare mais qui n'ont aucun lexème
 *  propre à colorer : `for-bindings-close` est le `:` du `for`, qui est celui
 *  de Python. */
const STRUCTURAL = new Set(['island:for-bindings-close']);

/** Divergences CONNUES entre les backends et le transpileur, tolérées le
 *  temps qu'elles soient corrigées. Chacune doit être observée : si elle
 *  disparaît, le test le dit, pour qu'on retire l'exemption.
 *
 *  `_:label` en position de terme (hors îlot) : la fiche ldpy/002 le prévoit
 *  et les quatre backends le colorent, mais le TRANSPILEUR ne le reconnaît
 *  pas — il recopie `bn = _:station` tel quel, et le module émis ne compile
 *  pas (`SyntaxError`), sans qu'aucune erreur ldpy ne soit levée. Le pname
 *  voisin (`pn = ex:Sensor`), lui, est bien traité. C'est donc le transpileur
 *  qu'il faut corriger, pas la coloration. */
const DIVERGENCES = [
    // le groupe 1 délimite la région tolérée
    { re: /(?:=|[(,])\s*(_:\w+)/g, seen: false,
      why: '`_:label` en position de terme — non transpilé (défaut de ldpy)' },
];

/** Les caractères couverts par une divergence connue. */
function exemptChars(src) {
    const exempt = new Array(src.length).fill(false);
    for (const d of DIVERGENCES) {
        d.re.lastIndex = 0;
        for (let m; (m = d.re.exec(src)) !== null;) {
            const start = m.index + m[0].indexOf(m[1]);
            for (let i = start; i < start + m[1].length; i++) exempt[i] = true;
            d.seen = true;
        }
    }
    return exempt;
}

async function checkConformance() {
    const file = path.join(FIX, 'conformance.ldpy');
    const segs = islandsFromTranspiler(file);
    if (!segs) {
        skip('conformité au transpileur — aucun Python avec ldpy trouvé ' +
             '(LDPY_PYTHON=… npm test pour le désigner)');
        return;
    }
    const src = fs.readFileSync(file, 'utf8');
    const island = new Array(src.length).fill(false);
    for (const s of segs) for (let i = s.start; i < s.end; i++) island[i] = true;
    const exempt = exemptChars(src);

    const tmScopes = await tm.charScopes(src);
    const backends = {
        TextMate: [...src].map((c, i) => /\.ldpy\b/.test(tmScopes[i] || '')),
        'highlight.js': (() => {
            const sc = hljsScopes(hljs.highlight(src, { language: 'ldpy-probe' }).value);
            return [...src].map((c, i) => /(^|\s)ldpy-/.test(sc[i] || ''));
        })(),
        Prism: ldpyChars(Prism.tokenize(src, Prism.languages.ldpy)),
    };

    for (const [name, marks] of Object.entries(backends)) {
        if (marks.length !== src.length) {
            fail(`conformité ${name} : ${marks.length} caractères pour ${src.length}`);
            continue;
        }
        // (a) rien de coloré ldpy HORS d'un îlot du transpileur — sauf les
        //     divergences recensées ci-dessus, qui sont des bogues connus.
        const outside = [];
        for (let i = 0; i < src.length; i++) {
            if (!marks[i] || island[i] || exempt[i] || /\s/.test(src[i])) continue;
            outside.push(i);
        }
        if (outside.length) {
            const i = outside[0];
            fail(`conformité ${name} : ${JSON.stringify(src.slice(i, i + 12))} ligne ` +
                `${src.slice(0, i).split('\n').length} colorié en ldpy, ` +
                'hors de tout îlot du transpileur');
            continue;
        }
        // (b) aucun îlot manqué : au moins un de ses caractères non blancs est
        //     marqué. Pas TOUS : dans `"chat"@fr` la chaîne est une chaîne
        //     Python, colorée par l'hôte — seul le suffixe `@fr` appartient à
        //     ldpy (R2) ; de même le `for` de `for @bindings … in`.
        const missed = segs.find((s) => {
            if (STRUCTURAL.has(s.kind)) return false;
            for (let i = s.start; i < s.end; i++) {
                if (marks[i] && !/\s/.test(src[i])) return false;
            }
            return true;
        });
        if (missed) {
            fail(`conformité ${name} : îlot ${missed.kind} ligne ` +
                `${src.slice(0, missed.start).split('\n').length} non reconnu ` +
                `(${JSON.stringify(src.slice(missed.start, missed.end).slice(0, 40))})`);
            continue;
        }
        ok(`conformité au transpileur : ${name} (${segs.length} îlots)`);
    }

    for (const d of DIVERGENCES) {
        if (d.seen) console.log(`       divergence connue tolérée : ${d.why}`);
        else fail(`divergence « ${d.why} » plus observée — retirer l'exemption ` +
                  'de DIVERGENCES dans test/run.js');
    }
}

// --------------------------------------------------------------- 4. regex

async function checkRegexes() {
    const oniguruma = require('vscode-oniguruma');
    const wasm = fs.readFileSync(
        path.join(require.resolve('vscode-oniguruma'), '..', 'onig.wasm')).buffer;
    await oniguruma.loadWASM(wasm).catch(() => {});
    let bad = 0; let n = 0;
    const sources = [];
    for (const [k, v] of Object.entries(I)) {
        if (typeof v === 'string' && /[\\[({*+?|]/.test(v)) sources.push([k, v]);
    }
    for (const [k, v] of Object.entries(I.A)) sources.push([`A.${k}`, v]);
    for (const d of I.TURTLE_DIRECTIVES) sources.push([`guard:${d.keyword}`, d.guard]);
    for (const [name, src] of sources) {
        n++;
        try { new RegExp(src); } catch (e) { bad++; fail(`regex ${name} refusée par V8 : ${e.message}`); continue; }
        try { new oniguruma.OnigScanner([src]); } catch (e) {
            bad++; fail(`regex ${name} refusée par Oniguruma : ${e.message}`);
        }
    }
    if (!bad) ok(`${n} expressions de src/islands.js compilent sous V8 et Oniguruma`);
}

// ------------------------------------------------------------------ main

(async () => {
    checkParity();
    checkGoldens();
    await checkConformance();
    await checkRegexes();
    console.log(failures ? `\n${failures} échec(s).` : '\nTout est vert.');
    process.exit(failures ? 1 : 0);
})();
