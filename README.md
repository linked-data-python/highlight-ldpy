# linked-data-python-highlight

La coloration syntaxique de [Linked-Data Python](https://gitlab.emse.fr/) (`.ldpy`) :
**une description des îlots, cinq moteurs**.

```
src/islands.js   ← LA lexique des îlots (règles de DESIGN_CHOICES/ldpy/002)
     │
     ├── src/textmate.js     → VS Code (grammaire engendrée, vendorée par vscode-ldpy)
     ├── src/highlightjs.js  → highlight.js
     ├── src/prism.js        → Prism
     └── src/codemirror.js   → CodeMirror 6 (éditeurs web, playgrounds)
```

Le cinquième moteur, **Pygments** (mkdocs, minted/LaTeX), vit dans le paquet
Python `ldpy` : il n'a pas besoin de ce dépôt, parce qu'il n'a besoin d'aucune
grammaire — il *transpile* la source et lit la `LanguageMap`. C'est la doctrine
du projet, et la seule raison pour laquelle ce dépôt existe est que rien, en
JavaScript, ne peut appeler le transpileur Python.

## Le principe

**Ne rien redécrire.** Chaque backend part de la grammaire officielle de son
moteur et n'ajoute qu'une couche d'îlots :

| moteur | Python | Turtle / SPARQL dans les îlots |
|---|---|---|
| Pygments | `PythonLexer` | `TurtleLexer`, `SparqlLexer` |
| Prism | `Prism.languages.python` | `Prism.languages.sparql` |
| highlight.js | `getLanguage('python').rawDefinition()` | **écrit ici** — highlight.js ne livre ni Turtle ni SPARQL |
| TextMate | MagicPython (vendoré) | **écrit ici** |
| CodeMirror 6 | `@codemirror/legacy-modes/mode/python` | **écrit ici** — pas de mode Turtle ni SPARQL non plus |

Ce qui reste à écrire — les déclencheurs d'îlot, les gardes de contexte, les
gabarits d'IRI — l'est **une fois**, dans `src/islands.js`, en regex du
sous-ensemble commun à V8, Oniguruma et Prism. Ce qui n'est *pas* partagé est
la forme des règles : pile `begin`/`end` de TextMate, arbre de modes de
highlight.js, table ordonnée de Prism, **machine à états** de CodeMirror.
Quatre moteurs, quatre modèles ; les traduire l'un dans l'autre coûterait plus
que ce que l'unification rapporte. La garantie est reportée sur les tests.

CodeMirror est le seul à ne pas être déclaratif, et il y gagne : là où les
autres écrivent des gardes en lookbehind pour distinguer `d[i:j]` d'une liste
ou `{a:b}` d'un ensemble, l'analyseur de flux **sait** dans quelle sorte de
crochet il se trouve. Même chose pour les accolades d'un `s{ … }`, qui sont
des groupes SPARQL, contre celles d'un `g{ … }`, qui sont des interpolations
Python : une pile de contextes tranche là où les autres devinent.

## Ce que les tests garantissent

`npm test` :

1. **Parité Python pur.** Un fichier `.py` reçoit *exactement* les mêmes jetons
   en `ldpy` qu'en `python`, dans chaque moteur. C'est l'invariant de fond :
   ldpy n'étend Python que là où Python est illégal. Les pièges sont dans
   `test/fixtures/pure_pitfalls.py` — slices `d[i:j]`, paires de dictionnaire,
   annotations, suites collées `if x == y:pass`, f-strings.
2. **Golden** par moteur sur `test/fixtures/islands.ldpy`.
3. **Conformité au transpileur.** Sur une fixture qui *transpile*, la
   `LanguageMap` dit où sont les îlots : aucun moteur ne doit en colorer
   ailleurs, ni en manquer un. Le transpileur est l'arbitre — le même qui,
   côté Pygments, *est* le surligneur. Sauté si aucun Python avec `ldpy` n'est
   trouvé (`LDPY_PYTHON=… npm test` pour le désigner).
4. **Portabilité des regex** : chacune compile sous V8 *et* sous Oniguruma.

## Usage

### highlight.js

```js
const hljs = require('highlight.js');
hljs.registerLanguage('ldpy', require('linked-data-python-highlight/highlightjs'));
hljs.highlight(code, { language: 'ldpy' });
```

`python` doit être enregistré (il l'est dans le build complet) : la grammaire
ldpy est bâtie dessus.

### Prism

```js
const Prism = require('prismjs');
require('prismjs/components/prism-python');
require('prismjs/components/prism-turtle');
require('prismjs/components/prism-sparql');
require('linked-data-python-highlight/prism')(Prism);
Prism.highlight(code, Prism.languages.ldpy, 'ldpy');
```

### CodeMirror 6

```js
import { StreamLanguage } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { build, tokenTable } from 'linked-data-python-highlight/codemirror';

const ldpy = StreamLanguage.define({ ...build(), tokenTable: tokenTable(tags) });
```

`@codemirror/legacy-modes` fournit le mode Python délégué ; `build({ python })`
permet d'en passer un autre. Pourquoi un `StreamParser` et non un analyseur
Lezer : un `parseMixed` donnerait un arbre plus fin, mais exigerait d'écrire
une grammaire Lezer des îlots — une cinquième description du lexique, ce que
la doctrine interdit.

### TextMate / VS Code

La grammaire est **engendrée**, puis vendorée dans `vscode-ldpy` :

```sh
npm run generate            # écrit ../vscode-ldpy/syntaxes/ldpy.tmLanguage.json
npm run generate -- out.json
```

L'extension VS Code se construit et s'installe sans ce dépôt ; seuls
`npm run generate` et `npm test` de `vscode-ldpy` en ont besoin.

## Ce qui reste

- **Rouge** (Jekyll / GitHub Pages) : non fait. `tree-sitter` reste hors de
  portée raisonnable tant que la demande n'existe pas.
- Les corps d'îlot de **TextMate**, **highlight.js** et **CodeMirror** sont
  encore décrits ici plutôt que délégués : aucun de ces trois moteurs ne livre
  de grammaire Turtle ou SPARQL. Pour TextMate, vendorer une grammaire
  éprouvée reste ouvert ; le test de conformité est, en attendant, la garantie
  qui compte.
- Dans un `s{ … }`, une interpolation `{expr}` reste colorée en SPARQL : le
  transpileur tranche par un oracle (transpiler puis compiler), qu'aucun
  moteur JavaScript ne peut appeler. Conservateur, et sans effet sur la
  conformité — le texte reste dans l'îlot.
- Une divergence connue est tolérée et *nommée* dans `test/run.js` :
  `_:label` en position de terme est coloré par les quatre moteurs, mais le
  transpileur ne le reconnaît pas — c'est lui qu'il faut corriger.
