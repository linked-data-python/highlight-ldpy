'use strict';
/**
 * LA description des îlots ldpy, une seule fois.
 *
 * Doctrine (ldpy/021) : jamais de deuxième spécification de la
 * lexique. Le surligneur Pygments l'obtient en *étant* le transpileur (il lit
 * la LanguageMap) ; côté JavaScript, aucun backend ne peut appeler le
 * transpileur Python, alors ce module tient le rôle de source unique : les
 * fragments d'expression rationnelle des règles de la fiche 002 y sont écrits
 * UNE fois, et les générateurs (TextMate, highlight.js, Prism) les assemblent
 * chacun dans son propre modèle de règles.
 *
 * Ce qui est partagé : les expressions rationnelles, la liste close des
 * déclencheurs, les gardes de contexte, le vocabulaire des rôles.
 * Ce qui ne l'est pas : la forme des règles (pile begin/end de TextMate, arbre
 * de modes de highlight.js, table ordonnée de Prism) — trois moteurs, trois
 * modèles, et les traduire l'un dans l'autre coûterait plus cher que ce que
 * l'unification rapporte. La garantie est reportée sur le test de conformité
 * (test/conformance.js) : sur la même fixture, les trois backends doivent
 * attribuer le même RÔLE à chaque caractère.
 *
 * Les regex sont écrites dans le sous-ensemble commun à JavaScript (RegExp),
 * Oniguruma (TextMate) et Prism : lookbehind de longueur variable inclus, que
 * V8 et Oniguruma acceptent tous les deux.
 */

// ---------------------------------------------------------------- contextes
//
// R1 — contexte opérande : sûr pour `<…>`/`f<`/`e<` (jamais du Python valide
// à ces positions). NB : `[` échappé (sinon oniguruma lit `[=` comme une
// classe POSIX et la regex ne compile pas — bug historique de la v1 du
// portage, les IRIs n'étaient jamais colorées).
const OPERAND = String.raw`(?:^|(?<=[=+\-*/%,;:!|&^~(\[{<])` +
    String.raw`|(?<=\breturn)|(?<=\byield)|(?<=\belse)|(?<=\bin)|(?<=\bis)` +
    String.raw`|(?<=\bnot)|(?<=\band)|(?<=\bor)|(?<=\bif)|(?<=\bawait))`;

// pname/bnode — STRICT : uniquement après un `=` d'affectation (pas ==, +=,
// <=… ; := accepté), return/yield/await. Ailleurs, NAME:NAME peut être du
// Python valide (slices, annotations, suites collées `if x==y:pass`).
// « le `=` qui précède est bien celui d'une AFFECTATION » : pas `==`, `+=`,
// `<=`… (`:=` passe, il affecte). Écrit une fois, utilisé par les deux gardes.
const NOT_COMPARISON = String.raw`(?<![=!<>+\-*/%&|^~]=)`;

const STRICT = `(?:(?<==)${NOT_COMPARISON}` +
    String.raw`|(?<=\breturn)|(?<=\byield)|(?<=\bawait))`;

// pname/bnode — élément d'un appel f(…), d'une liste ou de parenthèses :
// `NAME:NAME` y est toujours invalide en Python.
const ARGS = String.raw`(?:^|(?<=[(,=\[]))`;

// La MÊME garde pour les moteurs à table plate (Prism), sans l'alternative
// `^`. Prism applique chaque motif aux FRAGMENTS non encore tokenisés : `^`
// y désigne le début d'un fragment, pas d'une ligne, et `x:pass` juste après
// le mot-clé `not` se retrouverait pname. Le `\s*` qui suit la garde couvre
// déjà les arguments passés à la ligne, donc rien n'est perdu.
// Le `=` de la classe doit être, ici aussi, celui d'une affectation : sans
// `NOT_COMPARISON`, la suite collée `if x == y:pass` se colore en pname.
// TextMate n'en a pas besoin — sa garde ARGS n'est injectée que dans les
// motifs `function-arguments`, `list` et `round-braces`, où une suite ne peut
// pas se trouver ; en table plate, la garde est seule.
const ARGS_FLAT = String.raw`(?<=[(,=\[])` + NOT_COMPARISON;

// Une annotation de paramètre (`def f(q:int=0)`) est du Python valide et
// tombe pile dans la garde ARGS. TextMate n'a pas le problème : MagicPython
// réclame ces positions avant que la règle de pname ne les voie. Les moteurs
// plats doivent l'écrire. Quantificateurs bornés, lookbehind de longueur
// variable — V8 et Oniguruma l'acceptent.
const NOT_IN_DEF_PARAMS = String.raw`(?<!\bdef\s\w{1,80}\([^()]{0,300})`;

// ----------------------------------------------------------------- atomes
//
// Les briques élémentaires, écrites UNE fois. Les formes composées ci-dessous
// (groupes de capture numérotés pour TextMate) et les tableaux de
// sous-expressions de highlight.js s'assemblent toutes à partir d'ici.

const BT = '`';

const A = {
    /** préfixe d'un pname : un identifiant Python. */
    prefix: String.raw`[A-Za-z_]\w*`,
    /** idem, mais avec points et tirets — directives et listes d'import. */
    prefixDotted: String.raw`[A-Za-z_][\w.-]*`,
    /** partie locale STRICTE (hors îlot) : identifiant, éventuellement suivi
     *  d'une interpolation, ou interpolation seule. */
    localStrict: String.raw`[A-Za-z_]\w*(?:\{[^}]*\})?|\{[^}]*\}`,
    /** partie locale LÂCHE (dans un îlot) : points et tirets admis. */
    localLoose: String.raw`[A-Za-z0-9_][\w.-]*`,
    /** étiquette de nœud vide : `_:b`, `_:{expr}`. */
    bnodeLabel: String.raw`\w+|\{[^}]*\}`,
    /** corps d'un IRIREF absolu. */
    iriBody: String.raw`[^<>"{}|^` + BT + String.raw`\\\s]*`,
    /** un caractère du corps d'un GABARIT d'IRI (f<…>, e<…>) : les
     *  interpolations y sont admises, les autres accolades non. */
    iriTemplateChar: String.raw`[^<>"|^` + BT + String.raw`\\\s{}]|\{[^}]*\}`,
    /** étiquette de langue BCP 47 (forme simplifiée de Turtle). */
    langtag: String.raw`[A-Za-z]+(?:-[A-Za-z0-9]+)*`,
    /** interpolation, accolades non imbriquées (approximation des moteurs
     *  déclaratifs ; le transpileur, lui, équilibre vraiment). */
    interp: String.raw`\{[^}]*\}`,
};

// ------------------------------------------------------------ formes composées
//
// Groupes de capture numérotés : c'est la forme dont TextMate a besoin.

const IRIREF = String.raw`<` + A.iriBody + String.raw`>`;
const PNAME_PARTS = `(${A.prefix})(:)(${A.localStrict})`;
const BNODE_PARTS = `(_:)(${A.bnodeLabel})`;

// garde de fermeture : l'îlot f<…>/e<…> n'est pris que si un `>` ferme sur
// la même ligne avec le jeu de caractères IRI (interpolations {…} admises) —
// sinon repli comparaison, comme le backtracking R3 du transpileur.
const IRI_CLOSES = `(?=(?:${A.iriTemplateChar})*>)`;

// pname « libre », à l'intérieur d'un îlot : préfixe et partie locale
// facultatifs (`:x`, `ex:`, `:`), tirets et points admis en partie locale.
const PNAME_LOOSE = `(${A.prefix})?(:)(${A.localLoose})?`;
const BNODE_LOOSE = BNODE_PARTS;
const VARIABLE = String.raw`[?$][A-Za-z_]\w*\b`;
const NUMBER = String.raw`[+-]?\d+(\.\d+)?([eE][+-]?\d+)?`;
const BOOLEAN = String.raw`\b(true|false|True|False)\b`;
const RDF_TYPE = String.raw`\ba\b`;

// suffixes de littéral, collés à la chaîne (R2)
const AFTER_QUOTE = String.raw`(?<=["'])`;
const LANGTAG = `${AFTER_QUOTE}(@)(${A.langtag})`;
const DATATYPE = AFTER_QUOTE + String.raw`(\^\^)` +
    `(?:(${A.prefix})(:)(${A.prefix})|(${IRIREF}))?`;

// --------------------------------------------------------------- mots-clés

/** Mots-clés SPARQL 1.1, insensibles à la casse (fiche 015). */
const SPARQL_KEYWORDS = [
    'select', 'construct', 'describe', 'ask', 'where', 'from', 'named',
    'order', 'by', 'group', 'having', 'limit', 'offset', 'distinct',
    'reduced', 'optional', 'union', 'minus', 'graph', 'service', 'silent',
    'filter', 'bind', 'values', 'insert', 'delete', 'data', 'with', 'using',
    'load', 'clear', 'drop', 'create', 'copy', 'move', 'add', 'exists',
    'not', 'in', 'as', 'a',
];

/** Fonctions intégrées de SPARQL 1.1, reconnues seulement devant une
 *  parenthèse ouvrante — `STR` est une fonction, `str` peut être un nom de
 *  variable. Même liste que `prism-sparql`, pour que les quatre backends
 *  colorent le même ensemble. */
const SPARQL_FUNCTIONS = [
    'ABS', 'AVG', 'BNODE', 'BOUND', 'CEIL', 'COALESCE', 'CONCAT', 'CONTAINS',
    'COUNT', 'DATATYPE', 'DAY', 'ENCODE_FOR_URI', 'FLOOR', 'GROUP_CONCAT',
    'HOURS', 'IF', 'IRI', 'isBLANK', 'isIRI', 'isLITERAL', 'isNUMERIC',
    'isURI', 'LANG', 'LANGMATCHES', 'LCASE', 'MAX', 'MD5', 'MIN', 'MINUTES',
    'MONTH', 'NOW', 'RAND', 'REGEX', 'REPLACE', 'ROUND', 'sameTerm', 'SAMPLE',
    'SECONDS', 'SEPARATOR', 'SHA1', 'SHA256', 'SHA384', 'SHA512', 'STR',
    'STRAFTER', 'STRBEFORE', 'STRDT', 'STRENDS', 'STRLANG', 'STRLEN',
    'STRSTARTS', 'STRUUID', 'SUBSTR', 'SUM', 'TIMEZONE', 'TZ', 'UCASE',
    'URI', 'UUID', 'YEAR',
];

/** Ceux dont la présence dans une accolade prouve un GROUPE, pas une
 * interpolation Python (heuristique de repli : l'oracle exact du transpileur
 * — transpiler puis compiler — n'existe pas hors du transpileur). */
const SPARQL_GROUP_MARKERS = [
    'select', 'filter', 'optional', 'union', 'minus', 'graph', 'service',
    'values', 'bind', 'where',
];

// ------------------------------------------------------- liste des îlots
//
// La liste CLOSE des déclencheurs (fiche 002 R2) : une lettre collée à `{`
// ou à `<`. Toute autre lettre reste du Python.

/** Îlots `LETTRE{ … }`. `content` dit avec quoi colorer le corps. */
const BRACE_ISLANDS = [
    { letter: 'g', kind: 'graph', content: 'graph' },
    { letter: 'm', kind: 'match', content: 'graph' },
    { letter: 's', kind: 'sparql', content: 'sparql' },
    { letter: 'e', kind: 'sparql-expr', content: 'sparql' },
    { letter: 'f', kind: 'fnode', content: 'python' },
    { letter: '?', kind: 'fnode', content: 'python' },
];

/** Îlots `LETTRE<…>` : gabarits d'IRI. */
const IRI_ISLANDS = [
    { letter: 'f', kind: 'firi' },
    { letter: 'e', kind: 'eiri' },
];

/** Directives Turtle, gardées par la forme complète pour qu'un décorateur
 * Python nommé `prefix` ou `base` reste un décorateur. */
const TURTLE_DIRECTIVES = [
    // `f?<` : un préfixe DYNAMIQUE (fiche 013) s'écrit `@prefix dyn: f<…> .`
    // — sans le `f?`, la ligne retombe en décorateur Python.
    { keyword: 'prefix', guard: `(?=\\s+(?:${A.prefixDotted})?:\\s*f?<)` },
    { keyword: 'base', guard: String.raw`(?=\s+f?<)` },
];

/** Déclarations de contexte ldpy (fiches 014/017/018). La garde exige un
 * opérande : `@graph` nu, `@graph(...)`, `@graph.attr` restent des
 * décorateurs Python. */
const CONTEXT_DECLS = ['graph', 'bindings'];
const CONTEXT_GUARD = String.raw`(?=\s+[^\s(.\[#])`;
const MODIFIER_WORDS = 'global|nonlocal';
const CONTEXT_MODIFIER = `(?:(${MODIFIER_WORDS})\\s+)?`;

/** `for @bindings [as b] in …` (fiche 017) : `for @` n'est jamais du Python. */
const FOR_BINDINGS =
    String.raw`(?<=\bfor\s)\s*(@bindings)\b(?:\s+(as)\s+([A-Za-z_]\w*))?`;

/** pname dans une liste d'import (fiche 013) : `brick:`, `unit: as u:`. */
const IMPORT_PREFIX =
    `(${A.prefixDotted})?(:)` + String.raw`(?=\s*[,)\n#]|\s+as\b|\s*$)`;

/** Preuve qu'on est DANS la liste d'un `from … import …`.
 *  TextMate n'en a pas besoin : la règle y est injectée dans le motif
 *  `#import` de MagicPython, qui borne déjà le contexte. Les moteurs à table
 *  plate (highlight.js, Prism) n'ont pas de point d'injection : la garde doit
 *  être dans la regex. Quantificateur BORNÉ, pour rester lisible par Oniguruma
 *  comme par V8. */
const IMPORT_CONTEXT = String.raw`(?<=\bimport\s[^#\n]{0,300})`;

/** Un `[` de SOUSCRIPTION (`d[i:j]`, `(a)[i:j]`, `"s"[i:j]`), par opposition
 *  à un `[` de littéral de liste (`[ex:a, ex:b]`) : `NAME:NAME` est du Python
 *  valide dans le premier (slice) et jamais dans le second.
 *
 *  Deux variantes, et c'est voulu : TextMate hérite de `#item-index` de
 *  MagicPython pour le cas `IDENT[…]`, il ne lui reste que les fermantes ;
 *  highlight.js et Prism n'ont pas ce mode et doivent couvrir les deux. */
const SUBSCRIPT_AFTER_CLOSER = String.raw`(?<=[\])}"'])\s*\[`;
const SUBSCRIPT_OPEN = String.raw`(?<=[\w\])}"'])\s*\[`;

/** `+{ … }` / `-{ … }` en tête de ligne logique (fiche 014). */
const ADD_REMOVE = String.raw`^\s*([+-])(\{)`;

// ------------------------------------------------------------------ rôles
//
// Vocabulaire neutre. Chaque backend le projette sur ses propres noms de
// jetons ; le test de conformité compare des RÔLES, pas des noms.

const ROLES = [
    'sigil',            // g m s f e ? + - : la lettre qui ouvre un îlot
    'island.punct',     // { } < > d'un îlot
    'interp.punct',     // { } d'une interpolation
    'directive',        // @prefix @base @graph @bindings
    'modifier',         // global / nonlocal, as
    'iriref',           // <http://…>
    'pname.prefix', 'pname.sep', 'pname.local',
    'bnode.punct', 'bnode.name',
    'var',              // ?x $x
    'langtag.punct', 'langtag', 'datatype.punct',
    'keyword.a',        // `a` = rdf:type
    'keyword.sparql',
    'number', 'boolean', 'string', 'comment',
    'triple.sep',       // ; , .
    'bnode.bracket',    // [ ] ( ) dans un graphe
    'invalid',
    'python',           // délégué au lexer Python de l'hôte
];

/** `select` -> `[sS][eE][lL][eE][cC][tT]` : insensibilité à la casse sans
 *  drapeau, donc utilisable dans un scanner mutualisé (highlight.js fusionne
 *  les regex de tous les modes en une seule et le `i` par mode s'y perd).
 *  Les caractères non alphabétiques passent tels quels. */
function caseInsensitive(word) {
    return word.replace(/[A-Za-z]/g,
        (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
}

/** L'alternance des mots-clés SPARQL, insensible à la casse, sans drapeau. */
const SPARQL_KEYWORDS_CI = SPARQL_KEYWORDS.map(caseInsensitive).join('|');
const SPARQL_FUNCTIONS_CI = SPARQL_FUNCTIONS.map(caseInsensitive).join('|');
const SPARQL_GROUP_MARKERS_CI = SPARQL_GROUP_MARKERS.map(caseInsensitive).join('|');

module.exports = {
    caseInsensitive, SPARQL_KEYWORDS_CI, SPARQL_FUNCTIONS_CI,
    SPARQL_FUNCTIONS, SPARQL_GROUP_MARKERS_CI,
    MODIFIER_WORDS,
    A, BT, AFTER_QUOTE,
    OPERAND, STRICT, ARGS, ARGS_FLAT, NOT_COMPARISON, NOT_IN_DEF_PARAMS,
    IRIREF, PNAME_PARTS, BNODE_PARTS, IRI_CLOSES,
    PNAME_LOOSE, BNODE_LOOSE, VARIABLE, NUMBER, BOOLEAN, RDF_TYPE,
    LANGTAG, DATATYPE,
    SPARQL_KEYWORDS, SPARQL_GROUP_MARKERS,
    BRACE_ISLANDS, IRI_ISLANDS, TURTLE_DIRECTIVES,
    CONTEXT_DECLS, CONTEXT_GUARD, CONTEXT_MODIFIER,
    FOR_BINDINGS, IMPORT_PREFIX, IMPORT_CONTEXT, ADD_REMOVE,
    SUBSCRIPT_AFTER_CLOSER, SUBSCRIPT_OPEN,
    ROLES,
};
