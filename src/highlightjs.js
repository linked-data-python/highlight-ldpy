'use strict';
/**
 * Grammaire highlight.js de Linked-Data Python.
 *
 * highlight.js embarque 193 langages, dont Python — mais NI Turtle NI SPARQL.
 * La délégation intégrale que fait le lexer Pygments (fiche 021) n'y est donc
 * pas possible ; ce qui l'est, et que ce module fait :
 *
 *  - **Python vient de highlight.js**, tel quel. La grammaire est bâtie sur
 *    `hljs.getLanguage('python').rawDefinition()` : mêmes mots-clés, mêmes
 *    modes (chaînes, f-strings, décorateurs, nombres…), simplement précédés
 *    des modes d'îlot. Un fichier Python pur est donc coloré exactement comme
 *    en `.py` — c'est un test (test/parity-hljs.js), pas une intention.
 *  - **Les règles d'îlot viennent de src/islands.js**, comme celles de la
 *    grammaire TextMate et de Prism : une seule spécification.
 *
 * usage :
 *     const hljs = require('highlight.js');
 *     hljs.registerLanguage('ldpy', require('linked-data-python-highlight/highlightjs'));
 *     hljs.highlight(code, { language: 'ldpy' });
 */

const I = require('./islands');

/** Rôles (src/islands.js) → portées highlight.js.
 *  Uniquement des portées que TOUS les thèmes colorent : la coloration marche
 *  sans feuille de style supplémentaire. `punctuation` n'est pas coloré par
 *  la plupart des thèmes, ce qui est l'effet voulu pour les délimiteurs. */
const SCOPE = {
    'sigil': 'keyword',
    'island.punct': 'punctuation',
    'interp.punct': 'punctuation',
    'directive': 'meta',
    'modifier': 'keyword',
    'iriref': 'symbol',
    'pname.prefix': 'type',
    'pname.sep': 'punctuation',
    'pname.local': 'title',
    'bnode.punct': 'punctuation',
    'bnode.name': 'symbol',
    'var': 'variable',
    'langtag.punct': 'punctuation',
    'langtag': 'built_in',
    'datatype.punct': 'punctuation',
    'keyword.a': 'keyword',
    'keyword.sparql': 'keyword',
    'number': 'number',
    'boolean': 'literal',
    'string': 'string',
    'comment': 'comment',
    'triple.sep': 'punctuation',
    'bnode.bracket': 'punctuation',
    'invalid': 'deletion',
};

/** `\bg` pour une lettre, `\?` pour le sigil `?` (où `\b` ne veut rien dire). */
const sigilRe = (letter) =>
    letter === '?' ? String.raw`\?` : String.raw`\b${letter}`;

function build(hljs, scopes) {
    const S = (role) => scopes[role];
    const lang = hljs.getLanguage('python');
    if (!lang) {
        throw new Error(
            "highlight.js : enregistrer 'python' avant 'ldpy' — la grammaire ldpy " +
            'est bâtie sur la définition Python officielle.');
    }
    const py = lang.rawDefinition();

    // ------------------------------------------------------------ Python
    //
    // Le Python de highlight.js, réutilisé tel quel partout où ldpy dit
    // « ici, une expression Python » : interpolations et corps de f{…}/?{…}.

    const pyBrace = { begin: /\{/, end: /\}/, contains: [] };
    pyBrace.contains = ['self', ...py.contains];
    /** Contenu d'une région Python : les modes officiels, plus l'équilibrage
     *  des accolades pour qu'un dict littéral ne referme pas l'îlot. */
    const PYTHON_INSIDE = { keywords: py.keywords, contains: [pyBrace, ...py.contains] };

    /** `{ expr }` : on repasse en Python. */
    const interpolation = {
        begin: /\{/, end: /\}/,
        beginScope: S('interp.punct'), endScope: S('interp.punct'),
        ...PYTHON_INSIDE,
    };

    // ------------------------------------------------------- termes RDF

    const comment = hljs.COMMENT(/#/, /$/);

    const string = {
        scope: S('string'),
        variants: [
            { begin: /"""/, end: /"""/ },
            { begin: /'''/, end: /'''/ },
            { begin: /"/, end: /"|$/, illegal: /\n/ },
            { begin: /'/, end: /'|$/, illegal: /\n/ },
        ],
    };

    /** `"…"@fr` et `"…"^^xsd:int`, collés à la chaîne (R2). */
    const literalSuffix = [
        {
            begin: [I.AFTER_QUOTE + '@', I.A.langtag],
            beginScope: { 1: S('langtag.punct'), 2: S('langtag') },
        },
        {
            begin: [I.AFTER_QUOTE + String.raw`\^\^`, `(?:${I.A.prefix})?`, ':',
                `(?:${I.A.localLoose})?`],
            beginScope: {
                1: S('datatype.punct'), 2: S('pname.prefix'),
                3: S('pname.sep'), 4: S('pname.local'),
            },
        },
        {
            begin: [I.AFTER_QUOTE + String.raw`\^\^`, IRIREF_ANY()],
            beginScope: { 1: S('datatype.punct'), 2: S('iriref') },
        },
    ];

    function IRIREF_ANY() { return I.IRIREF; }

    const iriref = { scope: S('iriref'), begin: I.IRIREF };

    const bnode = {
        begin: [/_:/, `(?:${I.A.bnodeLabel})`],
        beginScope: { 1: S('bnode.punct'), 2: S('bnode.name') },
    };

    const pnameLoose = {
        begin: [`(?:${I.A.prefix})?`, ':', `(?:${I.A.localLoose})?`],
        beginScope: {
            1: S('pname.prefix'), 2: S('pname.sep'), 3: S('pname.local'),
        },
    };

    const variable = { scope: S('var'), begin: I.VARIABLE };
    const number = { scope: S('number'), begin: I.NUMBER };
    const boolean = { scope: S('boolean'), begin: I.BOOLEAN };
    const rdfType = { scope: S('keyword.a'), begin: I.RDF_TYPE };

    /** `f<…>` / `e<…>` : gabarit d'IRI, interpolations comprises. */
    function iriTemplate(letter, { operandGuard }) {
        return {
            begin: operandGuard
                ? [I.OPERAND + String.raw`\s*`, sigilRe(letter), '<' + I.IRI_CLOSES]
                : [sigilRe(letter), '<' + I.IRI_CLOSES],
            beginScope: operandGuard
                ? { 2: S('sigil'), 3: S('island.punct') }
                : { 1: S('sigil'), 2: S('island.punct') },
            end: />/,
            endScope: S('island.punct'),
            scope: S('iriref'),
            contains: [interpolation],
        };
    }

    // ------------------------------------------------------------- îlots

    /** Corps d'un `g{…}` / `m{…}` / `+{…}` / `-{…}` : du Turtle à variables. */
    const graphInside = [];
    /** Corps d'un `s{…}` / `e{…}` : du SPARQL. */
    const sparqlInside = [];

    function braceIsland(letter, contains) {
        return {
            begin: [sigilRe(letter), /\{/],
            beginScope: { 1: S('sigil'), 2: S('island.punct') },
            end: /\}/,
            endScope: S('island.punct'),
            contains,
        };
    }

    const CONTENTS = {
        graph: graphInside, sparql: sparqlInside, python: [interpolation],
    };
    const brace = Object.fromEntries(I.BRACE_ISLANDS.map(
        (b) => [b.letter, braceIsland(b.letter, CONTENTS[b.content])]));
    // f{ … } / ?{ … } : le corps est une expression Python.
    for (const letter of ['f', '?']) {
        Object.assign(brace[letter], PYTHON_INSIDE, {
            contains: [pyBrace, ...py.contains],
        });
    }

    const nestedIslands = [
        brace['e'], brace['f'], brace['?'],
        iriTemplate('f', { operandGuard: false }),
        iriTemplate('e', { operandGuard: false }),
    ];

    graphInside.push(
        comment, ...nestedIslands, interpolation, iriref, bnode, variable,
        string, ...literalSuffix, rdfType, boolean, number, pnameLoose,
        { scope: S('triple.sep'), begin: /[;,.]/ },
        { scope: S('bnode.bracket'), begin: /[[\]()]/ });

    // Une accolade dans un s{…} : interpolation Python si elle ne contient ni
    // variable ni mot-clé de groupe, sinon groupe SPARQL. Heuristique — le
    // transpileur, lui, tranche en compilant (fiche 015) ; hors de lui,
    // aucun moteur déclaratif ne peut faire mieux.
    const NOT_A_GROUP = String.raw`(?![^{}]*[?$])(?![^{}]*\b(?:` +
        I.SPARQL_GROUP_MARKERS_CI + String.raw`)\b)(?=[^{}]*\})`;
    const sparqlGroup = {
        begin: /\{/, end: /\}/,
        beginScope: S('island.punct'), endScope: S('island.punct'),
        contains: sparqlInside,
    };
    sparqlInside.push(
        comment,
        { ...interpolation, begin: new RegExp(String.raw`\{` + NOT_A_GROUP) },
        { scope: S('keyword.sparql'),
          begin: String.raw`\b(?:` + I.SPARQL_KEYWORDS_CI + String.raw`)\b` },
        { scope: 'built_in',
          begin: String.raw`\b(?:` + I.SPARQL_FUNCTIONS_CI + String.raw`)\b(?=\s*\()` },
        ...nestedIslands, variable, iriref, string, ...literalSuffix,
        number, pnameLoose, sparqlGroup,
        { scope: S('triple.sep'), begin: /[;,.]/ },
        { scope: S('bnode.bracket'), begin: /[()]/ });

    // --------------------------------------------- déclarations en tête

    /** `@prefix ex: <…> .` et `@base <…> .` — Turtle dans du Python. */
    const turtleDirectives = I.TURTLE_DIRECTIVES.map((d) => ({
        begin: new RegExp(String.raw`^\s*@${d.keyword}\b` + d.guard),
        beginScope: S('directive'),
        end: /$/,
        contains: [
            comment,
            iriTemplate('f', { operandGuard: false }),
            {
                begin: [`(?:${I.A.prefixDotted})?`, ':'],
                beginScope: { 1: S('pname.prefix'), 2: S('pname.sep') },
            },
            iriref,
            { scope: S('triple.sep'), begin: /\./ },
        ],
    }));

    /** `@graph … as g`, `@bindings …`, avec `global`/`nonlocal` (fiche 018). */
    const contextDecls = I.CONTEXT_DECLS.map((k) => ({
        begin: [String.raw`^\s*`, `(?:${I.MODIFIER_WORDS})?`, String.raw`\s*`,
            `@${k}` + I.CONTEXT_GUARD],
        beginScope: { 2: S('modifier'), 4: S('directive') },
        end: /$/,
        keywords: { keyword: 'as' },
        contains: [comment, iriTemplate('f', { operandGuard: false }), iriref,
            pnameLoose, ...py.contains],
    }));

    /** `+{ … }` / `-{ … }` en tête de ligne logique (fiche 014). */
    const addRemove = {
        begin: [/^\s*/, /[+-]/, /\{/],
        beginScope: { 2: S('sigil'), 3: S('island.punct') },
        end: /\}/,
        endScope: S('island.punct'),
        contains: graphInside,
    };

    /** `for @bindings [as b] in …` (fiche 017). Deux variantes, la plus
     *  longue d'abord : highlight.js retient la première déclarée à position
     *  égale, et `for @bindings` préfixe `for @bindings as b`. */
    const forBindings = [
        {
            begin: [/(?<=\bfor\s)\s*/, /@bindings\b/, /\s+/, /as/, /\s+/,
                new RegExp(I.A.prefix)],
            beginScope: {
                2: S('directive'), 4: S('modifier'), 6: 'variable',
            },
        },
        {
            begin: [/(?<=\bfor\s)\s*/, /@bindings\b/],
            beginScope: { 2: S('directive') },
        },
    ];

    /** `as EX` d'une déclaration de préfixe (fiche 027). */
    const prefixAs = {
        begin: [/(?<=>)\s+/, /as/, /\s+/, new RegExp(I.A.prefix)],
        beginScope: { 2: S('modifier'), 4: 'variable' },
    };

    /** `from m import brick:, unit: as u:` (fiche 013). */
    const importPrefix = {
        begin: [I.IMPORT_CONTEXT + `(?:${I.A.prefixDotted})?`,
            ':' + String.raw`(?=\s*[,)\n#]|\s+as\b|\s*$)`],
        beginScope: { 1: S('pname.prefix'), 2: S('pname.sep') },
    };

    // ------------------------------------------------------- assemblage
    //
    // TextMate borne les pname/bnode en INJECTANT les règles dans les motifs
    // de MagicPython (`function-arguments`, `list`, `round-braces`) et en
    // privant les autres d'une chaîne `#expression-nop`. highlight.js n'a pas
    // de point d'injection : la même frontière se retrouve ici en modes de
    // groupement explicites.
    //
    //   ( … )   [ …liste… ]   -> `NAME:NAME` invalide en Python : pname admis
    //   d[ … ]   { … }        -> slice et paire de dict : pname INTERDIT
    //
    // Sans cela, `d[i:j]`, `{a:b}` et `annc:int` se coloreraient en RDF, et
    // la parité Python pur tomberait (c'est un test, pas une intention).

    /** pname/bnode sous une garde donnée ; bnode d'abord — `_:x` satisfait
     *  aussi le motif d'un pname. */
    const terms = (guard) => [
        {
            begin: [guard + String.raw`\s*`, '_:', `(?:${I.A.bnodeLabel})`],
            beginScope: { 2: S('bnode.punct'), 3: S('bnode.name') },
        },
        {
            begin: [guard + String.raw`\s*`, `(?:${I.A.prefix})`, ':',
                `(?:${I.A.localStrict})`],
            beginScope: {
                2: S('pname.prefix'), 3: S('pname.sep'), 4: S('pname.local'),
            },
        },
    ];

    /** Les îlots qui valent partout, pname/bnode exclus. */
    const islandModes = [
        addRemove, ...forBindings, prefixAs, importPrefix,
        brace['g'], brace['m'], brace['s'], brace['e'], brace['f'], brace['?'],
        iriTemplate('f', { operandGuard: true }),
        iriTemplate('e', { operandGuard: true }),
        { begin: [I.OPERAND + String.raw`\s*`, I.IRIREF], beginScope: { 2: S('iriref') } },
        variable,
        ...literalSuffix,
    ];

    const groups = [];
    /** `keywords` n'est pas hérité en highlight.js : chaque mode de
     *  groupement doit re-déclarer ceux de Python, sinon `for`/`in` d'une
     *  compréhension cessent d'être colorés et la parité tombe. */
    function group(begin, end, { pnames }) {
        const m = {
            begin, end, keywords: py.keywords,
            contains: [...islandModes, ...(pnames ? terms(I.ARGS) : []),
                ...groups, ...py.contains],
        };
        return m;
    }

    // Déclarés dans cet ordre : la souscription doit être reconnue AVANT le
    // littéral de liste, les deux commençant par `[`.
    groups.push(
        group(new RegExp(I.SUBSCRIPT_OPEN), /\]/, { pnames: false }),   // d[i:j]
        group(/\[/, /\]/, { pnames: true }),                           // [ex:a]
        group(/\(/, /\)/, { pnames: true }),                           // f(ex:a)
        group(/\{/, /\}/, { pnames: false }));                         // {a:b}

    return {
        name: 'Linked-Data Python',
        aliases: ['ldpy', 'linked-data-python'],
        unicodeRegex: py.unicodeRegex,
        keywords: py.keywords,
        // Python interdit `?` ; ldpy en fait un sigil (`?{ }`, `?v`).
        illegal: /(<\/)|=>/,
        contains: [
            ...turtleDirectives,
            ...contextDecls,
            ...islandModes,
            // En position d'INSTRUCTION, seule la garde stricte vaut : après
            // `=`, `return`, `yield`, `await`. Pas `^` — `annc:int = 6` est
            // une annotation Python, pas un pname.
            ...terms(I.STRICT),
            ...groups,
            ...py.contains,
        ],
    };
}

/** La grammaire livrée : des portées que tous les thèmes colorent. */
module.exports = (hljs) => build(hljs, SCOPE);

/** Une variante dont les portées sont imposées. Sert au test de conformité :
 *  en donnant à chaque rôle un nom sentinelle `ldpy-…`, on distingue ce que
 *  ldpy colore de ce que Python colore — impossible avec les portées livrées,
 *  où le sigil d'un îlot et le `for` de Python sont tous deux `keyword`. */
module.exports.withScopes = (over) => (hljs) => build(hljs, { ...SCOPE, ...over });

/** Le tableau des rôles → portées sentinelles, pour `withScopes`. */
module.exports.sentinelScopes = () => Object.fromEntries(
    Object.keys(SCOPE).map((role) => [role, `ldpy-${role.replace(/\./g, '-')}`]));

module.exports.SCOPE = SCOPE;
