'use strict';
/** Tokenisation TextMate hors VS Code, sur la grammaire ENGENDRÉE ici. */
const fs = require('fs');
const path = require('path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');
const { build } = require('../../src/textmate');

const MAGIC = path.join(__dirname, '..', '..', 'vendor', 'MagicPython.tmLanguage.json');
let registry = null;

function getRegistry() {
    if (registry) return registry;
    const wasm = fs.readFileSync(
        path.join(require.resolve('vscode-oniguruma'), '..', 'onig.wasm')).buffer;
    const onigLib = oniguruma.loadWASM(wasm).then(() => ({
        createOnigScanner: (s) => new oniguruma.OnigScanner(s),
        createOnigString: (s) => new oniguruma.OnigString(s),
    }));
    const grammars = {
        'source.python': () => JSON.parse(fs.readFileSync(MAGIC, 'utf8')),
        'source.ldpy': () => build(),
    };
    registry = new vsctm.Registry({
        onigLib,
        loadGrammar: async (scope) => (grammars[scope]
            ? vsctm.parseRawGrammar(JSON.stringify(grammars[scope]()), `${scope}.json`)
            : null),
    });
    return registry;
}

/** (caractère → portées jointes), pour toute la source. */
async function charScopes(text, scope = 'source.ldpy') {
    const grammar = await getRegistry().loadGrammar(scope);
    let stack = vsctm.INITIAL;
    const out = [];
    const lines = text.split('\n');
    lines.forEach((line, n) => {
        const r = grammar.tokenizeLine(line, stack);
        stack = r.ruleStack;
        const per = [];
        for (const t of r.tokens) {
            for (let c = t.startIndex; c < t.endIndex; c++) per[c] = t.scopes.slice(1).join(' ');
        }
        for (let c = 0; c < line.length; c++) out.push(per[c] || '');
        if (n < lines.length - 1) out.push('');
    });
    return out;
}

module.exports = { charScopes };
