'use strict';
/**
 * Grammaire Prism de Linked-Data Python.
 *
 * Prism est le seul des trois moteurs JavaScript à livrer Python, Turtle ET
 * SPARQL. C'est donc celui où la doctrine du lexer Pygments (fiche 021) —
 * « ne rien redécrire, déléguer » — s'applique littéralement :
 *
 *  - hors des îlots, la grammaire EST `Prism.languages.python`, clonée ;
 *  - dans un `g{ }` / `m{ }` / `+{ }` / `-{ }`, c'est `Prism.languages.sparql`
 *    (un corps de graphe est du Turtle à variables, donc le bloc de triplets
 *    de SPARQL — le même raisonnement qu'en Pygments) ;
 *  - dans un `s{ }` / `e{ }`, c'est `Prism.languages.sparql` tel quel.
 *
 * Ne restent écrites ici que les régions que ldpy ajoute : les déclencheurs
 * d'îlot, les interpolations, les gabarits d'IRI — toutes tirées de
 * src/islands.js, comme la grammaire TextMate et celle de highlight.js.
 *
 * usage :
 *     const Prism = require('prismjs');
 *     require('prismjs/components/prism-python');
 *     require('prismjs/components/prism-turtle');
 *     require('prismjs/components/prism-sparql');
 *     require('linked-data-python-highlight/prism')(Prism);
 *     Prism.highlight(code, Prism.languages.ldpy, 'ldpy');
 */

const I = require('./islands');

/** Rôles → noms de jetons Prism. Ceux de `prism-turtle` sont repris tels
 *  quels (`url`, `function` + `prefix`/`local-name`, `tag`) : à l'intérieur
 *  d'un îlot c'est Turtle qui colore, et ce qui est écrit ici doit produire
 *  les MÊMES jetons, sinon un pname change de couleur selon qu'il est dans un
 *  îlot ou en position de terme Python. */
const BASE_TOKEN = {
    'sigil': 'keyword',
    'island.punct': 'punctuation',
    'interp.punct': 'punctuation',
    'directive': 'keyword',
    'modifier': 'keyword',
    'iriref': 'url',
    'pname.prefix': 'prefix',
    'pname.sep': 'punctuation',
    'pname.local': 'local-name',
    'bnode.punct': 'punctuation',
    'bnode.name': 'local-name',
    'var': 'variable',
    'langtag.punct': 'punctuation',
    'langtag': 'tag',
    'datatype.punct': 'punctuation',
    'keyword.a': 'keyword',
    'keyword.sparql': 'keyword',
    'number': 'number',
    'boolean': 'boolean',
    'string': 'string',
    'comment': 'comment',
    'triple.sep': 'punctuation',
    'bnode.bracket': 'punctuation',
};

/** `\{ … \}` équilibré jusqu'à `depth` niveaux. Prism n'a pas de pile de
 *  contextes : la profondeur se paie en littéral. Trois niveaux couvrent une
 *  sous-requête dans un `WHERE` dans un `s{ }`, ce qui est déjà rare. */
function balanced(depth) {
    let inner = String.raw`[^{}]*`;
    for (let i = 0; i < depth; i++) {
        inner = String.raw`(?:[^{}]|\{${inner}\})*`;
    }
    return String.raw`\{${inner}\}`;
}

const BALANCED = balanced(3);

/**
 * @param Prism l'objet Prism, composants python/turtle/sparql déjà chargés
 * @param opts.tokens  surcharge du tableau des rôles → jetons (test de
 *                     conformité : des noms sentinelles `ldpy-…` distinguent
 *                     ce que ldpy colore de ce que Python colore)
 * @param opts.name    nom de la langue à enregistrer (défaut `ldpy`)
 */
module.exports = function registerLdpy(Prism, opts = {}) {
    const TOKEN = { ...BASE_TOKEN, ...(opts.tokens || {}) };
    const NAME = opts.name || 'ldpy';
    for (const need of ['python', 'turtle', 'sparql']) {
        if (!Prism.languages[need]) {
            throw new Error(
                `Prism : charger le composant « ${need} » avant ldpy — la grammaire ` +
                'ldpy délègue Python, Turtle et SPARQL aux grammaires officielles.');
        }
    }
    const python = Prism.languages.python;
    const sparql = Prism.languages.sparql;

    // ------------------------------------------------- régions ldpy pures
    //
    // Toutes les clés propres à ldpy sont préfixées `ldpy-` et portent leur
    // couleur par `alias`. Ce n'est pas de la coquetterie : Prism écrase
    // silencieusement une clé homonyme, et le `rest:` d'un `inside` recopie
    // les clés de la grammaire déléguée par-dessus les nôtres. Un `keyword`
    // « sigil » se ferait remplacer par le `keyword` de SPARQL, sans erreur.

    /** `{ expr }` : on repasse en Python. */
    const interpolation = {
        pattern: new RegExp(BALANCED),
        greedy: true,
        inside: {
            'ldpy-brace': { pattern: /^\{|\}$/, alias: TOKEN['interp.punct'] },
            rest: python,
        },
    };

    /** `f<…>` / `e<…>` : gabarit d'IRI, interpolations comprises. */
    const iriTemplateInside = {
        'ldpy-sigil': { pattern: /^[fe]/, alias: TOKEN.sigil },
        'ldpy-angle': { pattern: /^<|>$/, alias: TOKEN['island.punct'] },
        'ldpy-interpolation': interpolation,
        'ldpy-iri-body': { pattern: /[\s\S]+/, alias: TOKEN.iriref },
    };
    const iriTemplate = {
        pattern: new RegExp(String.raw`\b[fe]<(?:${I.A.iriTemplateChar})*>`),
        greedy: true,
        inside: iriTemplateInside,
    };

    /** `_:b`, `_:{expr}` — sans quoi `prism-turtle` lit `_` comme un préfixe. */
    const bnodeInside = {
        'ldpy-bnode-punct': { pattern: /^_:/, alias: TOKEN['bnode.punct'] },
        'ldpy-bnode-name': { pattern: /[\s\S]+/, alias: TOKEN['bnode.name'] },
    };
    const bnode = {
        pattern: new RegExp(`_:(?:${I.A.bnodeLabel})`),
        inside: bnodeInside,
    };

    /** Un pname en position de terme Python. Structure IDENTIQUE à celle de
     *  `prism-turtle` (`function` > `prefix` / `local-name`), pour qu'un pname
     *  ait la même couleur dedans et dehors. */
    const pnameInside = {
        'local-name': { pattern: /([^:]*:)[\s\S]+/, lookbehind: true },
        'prefix': { pattern: /[\s\S]+/, inside: { 'punctuation': /:/ } },
    };

    /** `"…"@fr` et `"…"^^xsd:int` : collés à la chaîne (R2). `greedy`, sans
     *  quoi le lookbehind ne verrait pas le guillemet — Prism n'applique un
     *  motif non greedy qu'aux fragments restants. */
    const langtag = {
        pattern: new RegExp(I.AFTER_QUOTE + `@(?:${I.A.langtag})`),
        greedy: true,
        inside: { 'ldpy-at': { pattern: /^@/, alias: TOKEN['langtag.punct'] } },
        alias: TOKEN.langtag,
    };
    const datatype = {
        pattern: new RegExp(I.AFTER_QUOTE + String.raw`\^\^(?:` +
            `(?:${I.A.prefix})?:(?:${I.A.localLoose})?|${I.IRIREF})?`),
        greedy: true,
        inside: {
            'ldpy-caret': { pattern: /^\^\^/, alias: TOKEN['datatype.punct'] },
            'ldpy-dt-iri': { pattern: new RegExp(I.IRIREF), alias: TOKEN.iriref },
            'function': { pattern: /[\s\S]+/, inside: pnameInside },
        },
    };

    // ------------------------------------------------- corps des îlots
    //
    // L'ordre compte : Prism applique les jetons dans l'ordre des clés, sur
    // toute la chaîne. Commentaires et chaînes de Turtle passent D'ABORD,
    // sinon une accolade dans une chaîne serait lue comme une interpolation.

    function islandBody() {
        return {
            'comment': sparql.comment,
            'multiline-string': sparql['multiline-string'],
            'string': sparql.string,
            'ldpy-iri-template': iriTemplate,
            'ldpy-langtag': langtag,
            'ldpy-datatype': datatype,
            'ldpy-interpolation': interpolation,
            'ldpy-bnode': bnode,
            // …et tout le reste est SPARQL, tel que Prism le décrit : un corps
            // de graphe est du Turtle à variables, donc le bloc de triplets de
            // SPARQL (même raisonnement qu'en Pygments, fiche 021).
            'url': sparql.url,
            'function': sparql.function,
            'number': sparql.number,
            'keyword': sparql.keyword,
            'punctuation': sparql.punctuation,
            'boolean': sparql.boolean,
            'tag': sparql.tag,
            'variable': sparql.variable,
        };
    }

    const graphBody = islandBody();
    const sparqlBody = islandBody();

    /** `e{ … }` / `f{ … }` / `?{ … }` en position de terme, DANS un graphe. */
    const nestedIsland = {
        pattern: new RegExp(String.raw`\b[ef]` + BALANCED + '|' +
            String.raw`\?` + BALANCED),
        greedy: true,
        inside: {
            'ldpy-sigil': { pattern: /^[ef?]/, alias: TOKEN.sigil },
            'ldpy-brace': { pattern: /^\{|\}$/, alias: TOKEN['island.punct'] },
            rest: sparqlBody,
        },
    };
    // inséré APRÈS les chaînes, AVANT les interpolations : `e{ ?v * 2 }` est
    // un îlot, pas une interpolation suivie d'un nom.
    graphBody['ldpy-nested-island'] = nestedIsland;
    for (const k of ['ldpy-interpolation', 'ldpy-bnode', 'url', 'function',
        'number', 'keyword', 'punctuation', 'boolean', 'tag', 'variable']) {
        const v = graphBody[k];
        delete graphBody[k];
        graphBody[k] = v;
    }

    // ------------------------------------------------------ îlots de tête

    /** Un îlot `LETTRE{ … }`, dont le corps est `body` (ou Python). */
    function braceIsland(letter, body) {
        const sigil = letter === '?' ? String.raw`\?` : String.raw`\b${letter}`;
        return {
            pattern: new RegExp(sigil + BALANCED),
            greedy: true,
            inside: {
                'ldpy-sigil': {
                    pattern: new RegExp(letter === '?' ? String.raw`^\?` : `^${letter}`),
                    alias: TOKEN.sigil,
                },
                'ldpy-brace': { pattern: /^\{|\}$/, alias: TOKEN['island.punct'] },
                rest: body,
            },
        };
    }

    const BODIES = { graph: graphBody, sparql: sparqlBody, python };
    const braces = {};
    for (const b of I.BRACE_ISLANDS) {
        braces[`ldpy-island-${b.letter === '?' ? 'query' : b.letter}`] =
            braceIsland(b.letter, BODIES[b.content]);
    }

    // ------------------------------------------------------ assemblage

    Prism.languages[NAME] = Prism.languages.extend('python', {});

    // Les contextes où `NAME:NAME` est du Python VALIDE (slice, paire de
    // dictionnaire) sont consommés AVANT que la règle de pname ne les voie —
    // c'est la contrepartie Prism de la chaîne `#expression-nop` de TextMate
    // et des modes de groupement de highlight.js. Le jeton enveloppant n'a
    // pas de style : le contenu est coloré par Python, à l'identique.
    //
    // `greedy: true` n'est pas un détail : Prism n'applique un motif NON
    // greedy qu'aux fragments non encore tokenisés, où un lookbehind ne voit
    // rien de ce qui précède. Toute règle gardée par un lookbehind — donc
    // toutes celles de la fiche 002 — doit être greedy pour que sa garde
    // signifie ce qu'elle dit.
    const guards = {
        'ldpy-subscript': {
            pattern: new RegExp(I.SUBSCRIPT_OPEN + String.raw`[^\[\]]*\]`),
            greedy: true,
            inside: python,
        },
        // Un `{ … }` de dictionnaire NE protège que ce qui suit une virgule :
        // `{a:b}` seul est déjà hors d'atteinte (la garde ARGS ne compte pas
        // `{` parmi ses ouvrants). Exiger la virgule laisse donc intactes les
        // spécifications de format des f-strings — `f"{x:>10}"` n'en a pas.
        'ldpy-dict': {
            pattern: new RegExp(String.raw`(^|[^\w)\]}"'])\{[^{}]*,[^{}]*\}`),
            lookbehind: true,
            greedy: true,
            inside: python,
        },
    };

    const TERM_GUARD = `((?:${I.STRICT}|${I.ARGS_FLAT})\\s*)`;

    const islands = {
        'ldpy-directive': {
            pattern: /^[ \t]*@(?:prefix|base)\b.*$/m,
            greedy: true,
            inside: {
                'ldpy-keyword': {
                    pattern: /^[ \t]*@(?:prefix|base)/,
                    alias: TOKEN.directive,
                },
                'ldpy-iri-template': iriTemplate,
                'ldpy-iriref': { pattern: new RegExp(I.IRIREF), alias: TOKEN.iriref },
                'function': {
                    pattern: new RegExp(`(?:${I.A.prefixDotted})?:`),
                    inside: { 'punctuation': /:/ },
                },
                'punctuation': /\./,
            },
        },
        'ldpy-context-decl': {
            pattern: new RegExp(
                String.raw`^[ \t]*(?:(?:${I.MODIFIER_WORDS})\s+)?@(?:` +
                I.CONTEXT_DECLS.join('|') + ')' + I.CONTEXT_GUARD + '.*$', 'm'),
            greedy: true,
            inside: {
                'ldpy-modifier': {
                    pattern: new RegExp(String.raw`^[ \t]*(?:${I.MODIFIER_WORDS})\b`),
                    alias: TOKEN.modifier,
                },
                'ldpy-keyword': {
                    pattern: new RegExp('@(?:' + I.CONTEXT_DECLS.join('|') + ')'),
                    alias: TOKEN.directive,
                },
                'ldpy-iri-template': iriTemplate,
                'ldpy-iriref': { pattern: new RegExp(I.IRIREF), alias: TOKEN.iriref },
                rest: python,
            },
        },
        'ldpy-add-remove': {
            pattern: new RegExp(String.raw`^[ \t]*[+-]` + BALANCED, 'm'),
            greedy: true,
            inside: {
                'ldpy-sigil': { pattern: /^[ \t]*[+-]/, alias: TOKEN.sigil },
                'ldpy-brace': { pattern: /^\{|\}$/, alias: TOKEN['island.punct'] },
                rest: graphBody,
            },
        },
        // @prefix ex: <…> as EX . (fiche 027)
        'ldpy-prefix-as': {
            pattern: new RegExp(I.PREFIX_AS),
            inside: {
                'ldpy-as': { pattern: /\bas\b/, alias: TOKEN.modifier },
                'variable': new RegExp(`${I.A.prefix}$`),
            },
        },
        'ldpy-for-bindings': {
            pattern: new RegExp(String.raw`(\bfor\s+)@bindings\b(?:\s+as\s+` +
                `(?:${I.A.prefix}))?`),
            lookbehind: true,
            inside: {
                'ldpy-keyword': { pattern: /@bindings/, alias: TOKEN.directive },
                'ldpy-as': { pattern: /\bas\b/, alias: TOKEN.modifier },
                'variable': new RegExp(`${I.A.prefix}$`),
            },
        },
        'ldpy-import-prefix': {
            pattern: new RegExp(I.IMPORT_CONTEXT + `(?:${I.A.prefixDotted})?:` +
                String.raw`(?=\s*[,)\n#]|\s+as\b|\s*$)`),
            greedy: true,
            inside: { 'punctuation': /:/ },
            alias: 'prefix',
        },
        ...braces,
        'ldpy-iri-template-op': {
            pattern: new RegExp(`(${I.OPERAND}\\s*)` +
                String.raw`[fe]<(?:${I.A.iriTemplateChar})*>`),
            lookbehind: true,
            greedy: true,
            inside: iriTemplateInside,
        },
        'ldpy-iriref': {
            pattern: new RegExp(`(${I.OPERAND}\\s*)` + I.IRIREF),
            lookbehind: true,
            greedy: true,
            alias: TOKEN.iriref,
        },
        'ldpy-variable': { pattern: new RegExp(I.VARIABLE), alias: TOKEN.var },
        'ldpy-langtag': langtag,
        'ldpy-datatype': datatype,
        ...guards,
        // pname / bnode : là seulement où `NAME:NAME` est invalide en Python.
        // `lookbehind: true` retire la garde et le blanc du jeton lui-même.
        'ldpy-bnode': {
            pattern: new RegExp(TERM_GUARD + `_:(?:${I.A.bnodeLabel})`),
            lookbehind: true,
            greedy: true,
            inside: bnodeInside,
        },
        'ldpy-pname': {
            pattern: new RegExp(TERM_GUARD + I.NOT_IN_DEF_PARAMS +
                `(?:${I.A.prefix}):(?:${I.A.localStrict})`),
            lookbehind: true,
            greedy: true,
            alias: 'function',
            inside: pnameInside,
        },
    };

    Prism.languages.insertBefore(NAME, 'function', islands);
    if (NAME === 'ldpy') Prism.languages['linked-data-python'] = Prism.languages.ldpy;
    return Prism.languages[NAME];
};

module.exports.TOKEN = BASE_TOKEN;

/** Le tableau des rôles → jetons sentinelles, pour `opts.tokens`. */
module.exports.sentinelTokens = () => Object.fromEntries(
    Object.keys(BASE_TOKEN).map((role) => [role, `ldpy-${role.replace(/\./g, '-')}`]));
