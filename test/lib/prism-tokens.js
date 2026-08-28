'use strict';
/** Aplatit l'arbre de jetons Prism en une liste de FEUILLES {text, type}.
 *
 * Prism imbrique : un jeton peut en contenir d'autres. La couleur visible est
 * celle de la feuille — un jeton enveloppant sans règle de thème n'en donne
 * aucune. La parité Python pur se compare donc feuille à feuille : ldpy peut
 * envelopper une région (c'est ainsi qu'il neutralise les pname dans une
 * slice) sans changer une seule couleur. */
function leaves(tokens, out = [], inherited = null) {
    for (const t of tokens) {
        if (typeof t === 'string') {
            // Un fragment nu DANS un jeton porte la couleur de ce jeton : le
            // `sosa` de `<span class="token prefix">sosa<span…>:</span></span>`
            // est coloré par `prefix`, pas laissé au texte courant.
            if (t) out.push({ text: t, type: inherited });
        } else {
            // Un jeton `ldpy-…` SANS alias n'existe que pour la structure
            // (envelopper une slice, un dict, un îlot) : aucun thème ne le
            // colore, il ne transmet donc pas de couleur à ce qu'il contient.
            const own = t.alias ? [].concat(t.alias).join(' ')
                : (/^ldpy-/.test(t.type) ? null : t.type);
            const type = own === null ? inherited : own;
            if (Array.isArray(t.content)) leaves(t.content, out, type);
            else if (typeof t.content === 'string') out.push({ text: t.content, type });
            else leaves([t.content], out, type);
        }
    }
    return out;
}

/** Type de jeton (ou null) pour chaque caractère de la source. */
function charTypes(Prism, grammar, src) {
    const map = [];
    for (const leaf of leaves(Prism.tokenize(src, grammar))) {
        for (const ch of leaf.text) map.push(leaf.type);
    }
    return map;
}

module.exports = { leaves, charTypes };

/** Pour chaque caractère : appartient-il à une région ldpy ?
 *
 * La question est de NIDIFICATION, pas de nom de jeton : à l'intérieur d'un
 * `g{ … }`, Prism délègue à Turtle, qui produit ses propres noms. Un ancêtre
 * `ldpy-…` suffit donc — sauf `ldpy-subscript` et `ldpy-dict`, qui ne sont
 * là que pour SOUSTRAIRE une région à ldpy et la rendre à Python. */
const SHIELDS = new Set(['ldpy-subscript', 'ldpy-dict']);

function ldpyChars(tokens, out = [], inside = false) {
    for (const t of tokens) {
        if (typeof t === 'string') {
            for (let i = 0; i < t.length; i++) out.push(inside);
        } else {
            const own = /^ldpy-/.test(t.type) && !SHIELDS.has(t.type);
            const shielded = SHIELDS.has(t.type);
            const next = shielded ? false : (inside || own);
            if (Array.isArray(t.content)) ldpyChars(t.content, out, next);
            else if (typeof t.content === 'string') {
                for (let i = 0; i < t.content.length; i++) out.push(next);
            } else ldpyChars([t.content], out, next);
        }
    }
    return out;
}

module.exports.ldpyChars = ldpyChars;
