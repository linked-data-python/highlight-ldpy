'use strict';
/** Le HTML de highlight.js, relu en (caractère → portée).
 *
 * highlight.js n'expose pas de flux de jetons : son émetteur produit du HTML.
 * Les `<span>` y sont bien imbriqués et les entités connues, donc le relire
 * est exact — et c'est ce que le navigateur voit, ce qui est précisément ce
 * qu'on veut vérifier. La portée retenue est la PLUS INTERNE : c'est elle qui
 * gagne en cascade. */
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };

function charScopes(html) {
    const out = [];
    const stack = [];
    let i = 0;
    while (i < html.length) {
        if (html.startsWith('</span>', i)) { stack.pop(); i += 7; continue; }
        const open = /^<span class="([^"]*)">/.exec(html.slice(i));
        if (open) {
            stack.push(open[1].replace(/\bhljs-/g, '').trim());
            i += open[0].length;
            continue;
        }
        if (html[i] === '&') {
            const m = /^&([a-z]+|#x?\d+);/i.exec(html.slice(i));
            if (m && ENTITIES[m[1]] !== undefined) {
                out.push(stack[stack.length - 1] || null);
                i += m[0].length;
                continue;
            }
        }
        out.push(stack[stack.length - 1] || null);
        i++;
    }
    return out;
}

module.exports = { charScopes };
