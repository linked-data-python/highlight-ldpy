'use strict';
/**
 * Tokenisation d'un texte par un `StreamParser` de CodeMirror 6, ligne par
 * ligne, comme le fait l'éditeur — et projection sur les caractères, pour
 * comparer un backend à un autre.
 */
const { StringStream } = require('@codemirror/language');

/** [ [texte, jeton|null], … ] pour tout le document. */
function tokens(parser, src, indentUnit = 4) {
    const state = parser.startState(indentUnit);
    const out = [];
    const lines = src.split('\n');
    lines.forEach((line, n) => {
        if (line === '') {
            if (parser.blankLine) { parser.blankLine(state, indentUnit); }
            if (n < lines.length - 1) { out.push(['\n', null]); }
            return;
        }
        const stream = new StringStream(line, indentUnit, indentUnit);
        let guard = 0;
        while (!stream.eol()) {
            stream.start = stream.pos;
            const type = parser.token(stream, state);
            if (stream.pos === stream.start) { stream.next(); }
            out.push([stream.current(), type || null]);
            if (++guard > line.length + 64) {
                throw new Error(`boucle sur la ligne ${n + 1}`);
            }
        }
        if (n < lines.length - 1) { out.push(['\n', null]); }
    });
    return out;
}

/** Le jeton de chaque caractère du document (null pour « aucun »). */
function charTokens(parser, src, indentUnit = 4) {
    const per = [];
    for (const [text, type] of tokens(parser, src, indentUnit)) {
        for (let i = 0; i < text.length; i++) { per.push(type || null); }
    }
    while (per.length < src.length) { per.push(null); }
    return per.slice(0, src.length);
}

module.exports = { tokens, charTokens };
