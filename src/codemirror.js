'use strict';
/**
 * Langage CodeMirror 6 de Linked-Data Python.
 *
 * CodeMirror 6 colore soit avec un analyseur Lezer (arbre), soit avec un
 * `StreamParser` (flux, un jeton à la fois). C'est le second qui est retenu :
 * la doctrine de la fiche ldpy/021 est de ne rien redécrire du langage hôte,
 * et `@codemirror/legacy-modes/mode/python` est un mode de flux — on lui
 * délègue donc, caractère pour caractère, tout ce qui n'est pas un îlot. Un
 * `parseMixed` Lezer donnerait un arbre plus fin, mais exigerait d'écrire une
 * grammaire Lezer des îlots : une CINQUIÈME description du lexique, ce que la
 * fiche interdit.
 *
 * Ce qui distingue ce moteur des trois autres : il n'a pas de table de motifs
 * mais un ÉTAT. Un `s{ … }` contient des accolades qui sont des groupes
 * SPARQL, un `g{ … }` des accolades qui sont des interpolations Python : une
 * pile de contextes tranche là où les moteurs déclaratifs doivent deviner.
 *
 * usage :
 *     import { StreamLanguage } from '@codemirror/language';
 *     import { ldpy } from 'linked-data-python-highlight/codemirror';
 *     const ldpyLanguage = StreamLanguage.define(ldpy);
 */

const I = require('./islands');

// --------------------------------------------------------------- les jetons
//
// Noms de jetons rendus par l'analyseur, et leur étiquette Lezer. Les noms
// sont préfixés `ldpy` : tout ce qui ne l'est pas vient du mode Python
// délégué, ce dont le test de conformité se sert pour savoir qui a coloré
// quoi. Les rôles sont ceux de src/islands.js.
const ROLE_TOKEN = {
    'sigil': 'ldpySigil',
    'island.punct': 'ldpyIslandPunct',
    'interp.punct': 'ldpyInterpPunct',
    'directive': 'ldpyDirective',
    'modifier': 'ldpyModifier',
    'iriref': 'ldpyIri',
    'pname.prefix': 'ldpyPnamePrefix',
    'pname.sep': 'ldpyPnameSep',
    'pname.local': 'ldpyPnameLocal',
    'bnode.punct': 'ldpyBnodePunct',
    'bnode.name': 'ldpyBnodeName',
    'var': 'ldpyVar',
    'langtag.punct': 'ldpyLangtagPunct',
    'langtag': 'ldpyLangtag',
    'datatype.punct': 'ldpyDatatypePunct',
    'keyword.a': 'ldpyKeywordA',
    'keyword.sparql': 'ldpyKeywordSparql',
    'number': 'ldpyNumber',
    'boolean': 'ldpyBoolean',
    'string': 'ldpyString',
    'comment': 'ldpyComment',
    'triple.sep': 'ldpyTripleSep',
    'bnode.bracket': 'ldpyBracket',
    'invalid': 'ldpyInvalid',
};

/** Rôle -> nom de jeton. Lève sur un rôle inconnu : la table doit couvrir
 *  src/islands.js, et un oubli doit se voir au premier appel. */
function tok(role) {
    const name = ROLE_TOKEN[role];
    if (!name) { throw new Error(`rôle inconnu : ${role}`); }
    return name;
}

/**
 * `tokenTable` à passer à `StreamLanguage.define` : nom de jeton -> étiquette
 * de `@lezer/highlight`. Séparée du parseur pour que `@lezer/highlight` reste
 * une dépendance de l'APPELANT — on ne l'importe pas ici.
 */
function tokenTable(tags) {
    const t = {
        'sigil': tags.keyword,
        'island.punct': tags.bracket,
        'interp.punct': tags.brace || tags.bracket,
        'directive': tags.keyword,
        'modifier': tags.modifier,
        'iriref': tags.url,
        'pname.prefix': tags.namespace,
        'pname.sep': tags.punctuation,
        'pname.local': tags.propertyName,
        'bnode.punct': tags.punctuation,
        'bnode.name': tags.labelName,
        'var': tags.variableName,
        'langtag.punct': tags.punctuation,
        'langtag': tags.annotation || tags.meta,
        'datatype.punct': tags.punctuation,
        'keyword.a': tags.keyword,
        'keyword.sparql': tags.keyword,
        'number': tags.number,
        'boolean': tags.bool,
        'string': tags.string,
        'comment': tags.comment,
        'triple.sep': tags.separator,
        'bnode.bracket': tags.bracket,
        'invalid': tags.invalid,
    };
    const out = {};
    for (const [role, tag] of Object.entries(t)) { out[tok(role)] = tag; }
    return out;
}

// ------------------------------------------------------------- les scanners
//
// Les regex de src/islands.js sont ancrées (`y`) et appliquées à la LIGNE
// entière avec `lastIndex` sur la position courante : les gardes de contexte
// de la fiche 002 sont des lookbehind intra-ligne, elles voient donc bien ce
// qui précède.

function sticky(source) {
    return new RegExp(source, 'y');
}

const RE = {
    directive: sticky(String.raw`@(prefix|base)\b`),
    contextDecl: sticky(String.raw`(?:(global|nonlocal)\s+)?@(graph|bindings)\b`),
    forBindings: sticky(String.raw`@bindings\b(?:\s+as\s+[A-Za-z_]\w*)?`),
    addRemove: sticky(String.raw`[+-]\{`),
    braceIsland: sticky(String.raw`([gmsef?])\{`),
    iriIsland: sticky(`([fe])<(?=(?:${I.A.iriTemplateChar})*>)`),
    iriref: sticky(I.IRIREF),
    // hors îlot : partie locale stricte, garde de la fiche 002
    pnameStrict: sticky(`(${I.A.prefix})(:)(${I.A.localStrict})`),
    bnodeStrict: sticky(`(_:)(${I.A.bnodeLabel})`),
    importPrefix: sticky(`(${I.A.prefixDotted})?(:)(?=\\s*[,)\\n#]|\\s+as\\b|\\s*$)`),
    langtag: sticky(`@(${I.A.langtag})`),
    datatype: sticky(String.raw`\^\^`),
    // dans un îlot
    pnameLoose: sticky(`(${I.A.prefix})?(:)(${I.A.localLoose})?`),
    variable: sticky(I.VARIABLE),
    number: sticky(String.raw`[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?`),
    boolean: sticky(String.raw`(?:true|false)\b`),
    rdfType: sticky(String.raw`a(?![\w:])`),
    sparqlKeyword: sticky(`(?:${I.SPARQL_KEYWORDS_CI})\\b`),
    sparqlFunction: sticky(`(?:${I.SPARQL_FUNCTIONS_CI})(?=\\s*\\()`),
    word: sticky(String.raw`[A-Za-z_]\w*`),
};

/** Les gardes de contexte, appliquées à la ligne jusqu'à `pos`. */
const GUARD = {
    operand: new RegExp(`${I.OPERAND}$`),
    strict: new RegExp(`${I.STRICT}$`),
    args: new RegExp(`${I.ARGS_FLAT}$`),
    defParams: new RegExp(`${I.NOT_IN_DEF_PARAMS}$`),
    importLine: new RegExp(`${I.IMPORT_CONTEXT}$`),
    afterQuote: new RegExp(`["']$`),
};

function at(re, line, pos) {
    re.lastIndex = pos;
    return re.exec(line);
}

/** Le contexte AVANT `pos` autorise-t-il un opérande (R1) ? */
function operandHere(line, pos) {
    return GUARD.operand.test(line.slice(0, pos).replace(/\s+$/, ''));
}

/**
 * Le contexte autorise-t-il un nom préfixé collé (fiche 002) ?
 *
 * Là où les moteurs déclaratifs doivent écrire des gardes en lookbehind
 * (`SUBSCRIPT_OPEN`, `NOT_IN_DEF_PARAMS`), l'analyseur de flux a un état : il
 * SAIT dans quelle sorte de crochet il se trouve. Un dict/ensemble
 * (`{a:b, ex:v}`) et un indice (`d[i:j]`) sont du Python valide, où rien ne
 * doit être pris pour un terme.
 */
function termHere(line, pos, brackets) {
    const inner = brackets[brackets.length - 1];
    if (inner === '{' || inner === 's') { return false; }
    if (!GUARD.defParams.test(line.slice(0, pos))) { return false; }
    const before = line.slice(0, pos).replace(/[ \t]+$/, '');
    return GUARD.strict.test(before) || GUARD.args.test(before);
}

// ------------------------------------------------------------------- l'état

function frame(kind) {
    return { kind, depth: 0 };
}

/** Un `g{ }` ne contient pas d'accolade Turtle : toute accolade y est une
 *  interpolation. Un `s{ }` en contient (les groupes SPARQL) : on les
 *  compte, et l'îlot se ferme sur celle qui ramène à zéro. */
const GRAPH_KINDS = new Set(['graph', 'decl']);

// ------------------------------------------------------------- le tokenizer

/**
 * Construit le `StreamParser`.
 *
 * @param {object} [opts]
 * @param {object} [opts.python] mode de flux Python de CodeMirror. Par défaut
 *   `@codemirror/legacy-modes/mode/python`, dépendance de l'appelant.
 */
function build(opts = {}) {
    const python = opts.python || requirePython();

    function startState(indentUnit) {
        return { py: python.startState(indentUnit), stack: [], brackets: [] };
    }

    function copyState(state) {
        return {
            py: python.copyState ? python.copyState(state.py)
                : JSON.parse(JSON.stringify(state.py)),
            stack: state.stack.map((f) => ({ ...f })),
            brackets: state.brackets.slice(),
        };
    }

    /** Un littéral RDF dans un îlot : la chaîne, puis `@lang` ou `^^type`. */
    function rdfString(stream) {
        const quote = stream.next();
        const triple = stream.match(quote + quote, true);
        while (!stream.eol()) {
            if (stream.peek() === '\\') { stream.next(); stream.next(); continue; }
            if (stream.peek() === quote) {
                stream.next();
                if (!triple) { return tok('string'); }
                if (stream.match(quote + quote, true)) { return tok('string'); }
                continue;
            }
            stream.next();
        }
        return tok('string');
    }

    /** Le suffixe RDF d'une chaîne : `@fr`, `^^xsd:integer`. */
    function suffix(stream, line, pos) {
        if (at(RE.langtag, line, pos)) {
            stream.next();                       // @
            stream.match(RE.langtag.source.slice(1).replace(/^\(|\)$/g, ''), true)
                || stream.match(/[A-Za-z]+(?:-[A-Za-z0-9]+)*/, true);
            return tok('langtag');
        }
        if (at(RE.datatype, line, pos)) {
            stream.next(); stream.next();
            return tok('datatype.punct');
        }
        return null;
    }

    /** Le corps d'un îlot RDF : Turtle à variables, ou SPARQL. */
    function islandToken(stream, state, f) {
        const line = stream.string;
        const pos = stream.pos;
        const c = stream.peek();

        if (c === '#') { stream.skipToEnd(); return tok('comment'); }
        if (c === '"' || c === "'") { return rdfString(stream); }

        if (c === '}') {
            stream.next();
            if (GRAPH_KINDS.has(f.kind) || f.depth === 0) {
                state.stack.pop();
                return tok('island.punct');
            }
            f.depth--;
            return tok('bnode.bracket');
        }
        if (c === '{') {
            stream.next();
            if (GRAPH_KINDS.has(f.kind)) {       // interpolation Python
                state.stack.push(frame('interp'));
                return tok('interp.punct');
            }
            f.depth++;                            // groupe SPARQL
            return tok('bnode.bracket');
        }

        let m = at(RE.braceIsland, line, pos);
        if (m) {
            stream.pos = pos + m[0].length;
            state.stack.push(frame(
                m[1] === 'g' || m[1] === 'm' ? 'graph'
                    : m[1] === 's' || m[1] === 'e' ? 'sparql' : 'interp'));
            return tok('sigil');
        }
        m = at(RE.iriIsland, line, pos);
        if (m) {
            stream.pos = pos + m[0].length;
            state.stack.push(frame('iri'));
            return tok('sigil');
        }
        if (c === '<' && at(RE.iriref, line, pos)) {
            stream.pos = pos + at(RE.iriref, line, pos)[0].length;
            return tok('iriref');
        }
        m = at(RE.variable, line, pos);
        if (m) { stream.pos = pos + m[0].length; return tok('var'); }

        const suf = suffix(stream, line, pos);
        if (suf) { return suf; }

        if (f.kind === 'sparql') {
            m = at(RE.sparqlFunction, line, pos)
                || at(RE.sparqlKeyword, line, pos);
            if (m) { stream.pos = pos + m[0].length; return tok('keyword.sparql'); }
        }
        m = at(RE.bnodeStrict, line, pos);
        if (m) { stream.pos = pos + m[0].length; return tok('bnode.name'); }
        m = at(RE.pnameLoose, line, pos);
        if (m && m[0] !== '') {
            stream.pos = pos + m[0].length;
            return tok('pname.local');
        }
        m = at(RE.boolean, line, pos);
        if (m) { stream.pos = pos + m[0].length; return tok('boolean'); }
        m = at(RE.number, line, pos);
        if (m) { stream.pos = pos + m[0].length; return tok('number'); }
        if (at(RE.rdfType, line, pos)) { stream.next(); return tok('keyword.a'); }
        m = at(RE.word, line, pos);
        if (m) { stream.pos = pos + m[0].length; return tok('pname.local'); }
        if (';,.'.includes(c)) { stream.next(); return tok('triple.sep'); }
        if ('[]()'.includes(c)) { stream.next(); return tok('bnode.bracket'); }
        stream.next();
        return tok('invalid');
    }

    /** Un gabarit d'IRI `f<…>` / `e<…>` : texte, interpolations, puis `>`. */
    function iriToken(stream, state) {
        const c = stream.peek();
        if (c === '>') { stream.next(); state.stack.pop(); return tok('island.punct'); }
        if (c === '{') {
            stream.next();
            state.stack.push(frame('interp'));
            return tok('interp.punct');
        }
        while (!stream.eol() && stream.peek() !== '>' && stream.peek() !== '{') {
            stream.next();
        }
        return tok('iriref');
    }

    /** Une déclaration `@prefix … .` ou `@graph as g` : jusqu'à la fin de la
     *  ligne logique — sa grammaire est close, rien n'y déborde. */
    function declToken(stream, state, f) {
        if (stream.eol()) { state.stack.pop(); return null; }
        const line = stream.string;
        const pos = stream.pos;
        const m = at(RE.word, line, pos);
        if (m && (m[0] === 'as' || m[0] === 'global' || m[0] === 'nonlocal')
            && !at(RE.pnameLoose, line, pos + m[0].length)) {
            stream.pos = pos + m[0].length;
            return tok('modifier');
        }
        const t = islandToken(stream, state, f);
        // une déclaration se termine sur le '.' de Turtle
        if (t === tok('triple.sep') && stream.string[stream.pos - 1] === '.') {
            state.stack.pop();
        }
        return t;
    }

    /** Une interpolation `{ … }` : du Python, délégué — sauf les accolades,
     *  qu'il faut compter nous-mêmes pour savoir laquelle referme l'îlot. */
    function interpToken(stream, state, f) {
        const c = stream.peek();
        if (c === '}') {
            stream.next();
            if (f.depth === 0) { state.stack.pop(); return tok('interp.punct'); }
            f.depth--;
            return null;
        }
        if (c === '{') { stream.next(); f.depth++; return null; }
        return python.token(stream, state.py);
    }

    /** Hors îlot : on tente les déclencheurs, puis on délègue à Python. */
    function pythonToken(stream, state) {
        const line = stream.string;
        const pos = stream.pos;
        const c = stream.peek();
        const bol = /^\s*$/.test(line.slice(0, pos));

        if (c === '@') {
            let m = at(RE.directive, line, pos);
            if (m && bol) {
                stream.pos = pos + m[0].length;
                state.stack.push(frame('decl'));
                return tok('directive');
            }
            m = at(RE.contextDecl, line, pos);
            if (m && bol) {
                stream.pos = pos + m[0].length;
                state.stack.push(frame('decl'));
                return tok('directive');
            }
            // `for @bindings [as b] in …` (fiche 017)
            m = at(RE.forBindings, line, pos);
            if (m && /\bfor\s+$/.test(line.slice(0, pos))) {
                stream.pos = pos + m[0].length;
                return tok('directive');
            }
        }

        // `+{ … }` / `-{ … }` en tête de ligne logique
        if ((c === '+' || c === '-') && bol && at(RE.addRemove, line, pos)) {
            stream.pos = pos + 2;
            state.stack.push(frame('graph'));
            return tok('sigil');
        }

        // suffixe RDF d'une chaîne Python : `"chat"@fr`, `"5"^^xsd:integer`
        if ((c === '@' || c === '^') && GUARD.afterQuote.test(line.slice(0, pos))) {
            const suf = suffix(stream, line, pos);
            if (suf) { return suf; }
        }

        const m = at(RE.braceIsland, line, pos);
        if (m) {
            stream.pos = pos + m[0].length;
            state.stack.push(frame(
                m[1] === 'g' || m[1] === 'm' ? 'graph'
                    : m[1] === 's' || m[1] === 'e' ? 'sparql' : 'interp'));
            return tok('sigil');
        }
        if ((c === 'f' || c === 'e') && operandHere(line, pos)) {
            const iri = at(RE.iriIsland, line, pos);
            if (iri) {
                stream.pos = pos + iri[0].length;
                state.stack.push(frame('iri'));
                return tok('sigil');
            }
        }
        if (c === '<' && operandHere(line, pos)) {
            const iri = at(RE.iriref, line, pos);
            if (iri) { stream.pos = pos + iri[0].length; return tok('iriref'); }
        }
        // nom préfixé et nœud anonyme hors îlot : gardes strictes
        if (termHere(line, pos, state.brackets)) {
            const bn = at(RE.bnodeStrict, line, pos);
            if (bn) { stream.pos = pos + bn[0].length; return tok('bnode.name'); }
            const pn = at(RE.pnameStrict, line, pos);
            if (pn) { stream.pos = pos + pn[0].length; return tok('pname.local'); }
        }
        // import de préfixes : `from m import a, brick:, unit: as u:`
        if (GUARD.importLine.test(line.slice(0, pos))) {
            const ip = at(RE.importPrefix, line, pos);
            if (ip && ip[0] !== '') {
                stream.pos = pos + ip[0].length;
                return tok('pname.prefix');
            }
        }
        // les crochets restent à Python, mais on note leur SORTE au passage :
        // un `[` qui suit un opérande complet est un indice, pas une liste.
        if ('([{'.includes(c)) {
            state.brackets.push(
                c === '[' && /[\w\])}"']\s*$/.test(line.slice(0, pos))
                    ? 's' : c);
        } else if (')]}'.includes(c)) {
            state.brackets.pop();
        }
        return python.token(stream, state.py);
    }

    return {
        name: 'ldpy',
        startState,
        copyState,
        token(stream, state) {
            // une déclaration tient sur UNE ligne logique : sa portée se ferme
            // à la ligne suivante, que le flux n'atteint pas par la fin de la
            // précédente (l'éditeur cesse d'appeler `token` en fin de ligne).
            if (stream.sol()) { closeDeclarations(state); }
            if (stream.sol() && !state.stack.length && stream.eatSpace()) {
                return null;
            }
            const f = state.stack[state.stack.length - 1];
            if (!f) { return pythonToken(stream, state); }
            if (f.kind === 'interp') { return interpToken(stream, state, f); }
            if (stream.eatSpace()) { return null; }
            if (f.kind === 'iri') { return iriToken(stream, state); }
            if (f.kind === 'decl') { return declToken(stream, state, f); }
            return islandToken(stream, state, f);
        },
        blankLine(state) {
            closeDeclarations(state);
        },
        indent(state, textAfter, cx) {
            return state.stack.length ? null
                : (python.indent ? python.indent(state.py, textAfter, cx) : null);
        },
        languageData: {
            commentTokens: { line: '#' },
            indentOnInput: /^\s*([}\]]|else:|elif |except |finally:)$/,
        },
    };
}

/** Referme les déclarations restées ouvertes en fin de ligne. */
function closeDeclarations(state) {
    while (state.stack.length
        && state.stack[state.stack.length - 1].kind === 'decl') {
        state.stack.pop();
    }
}

function requirePython() {
    try {
        return require('@codemirror/legacy-modes/mode/python').python;
    } catch (e) {
        throw new Error(
            'le langage CodeMirror de ldpy délègue le Python à ' +
            '@codemirror/legacy-modes/mode/python — l\'installer, ou passer ' +
            'un mode par build({ python })');
    }
}

module.exports = { build, tokenTable, ROLE_TOKEN, get ldpy() { return build(); } };
