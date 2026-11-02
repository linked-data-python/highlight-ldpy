# Grammaire amont (vendored)

`MagicPython.tmLanguage.json` est la copie EXACTE de la grammaire Python
embarquée par VS Code (extension intégrée `vscode.python`), qui est elle-même
générée depuis <https://github.com/MagicStack/MagicPython>.

- Copiée depuis : `/usr/share/code/resources/app/extensions/python/syntaxes/`
- VS Code 1.133.0 · extension intégrée `python` 10.0.0 · le 2026-08-27

Elle sert de **base** au générateur `syntaxes/generate.js` (qui produit
`syntaxes/ldpy.tmLanguage.json` en y injectant les îlots ldpy) et de
**référence** au test de parité `test/parity.js` : un fichier Python pur doit
recevoir exactement les mêmes scopes en `.ldpy` qu'en `.py`.

Pour rafraîchir : recopier le fichier depuis une installation VS Code récente,
mettre à jour les versions ci-dessus, puis `npm run generate && npm test`.

# Grammaires SPARQL et Turtle (vendored)

`sparql.tmLanguage.json` et `turtle.tmLanguage.json` sont les copies EXACTES
des grammaires de l'extension `stardog-union.stardog-rdf-grammars` 0.2.1
(Visual Studio Marketplace, licence Apache-2.0, texte dans
`LICENSE-stardog-rdf-grammars.txt`), copiées le 2026-11-02.

Elles colorent l'intérieur de `s{ … }` (fiche vscode/102) : `src/textmate.js`
les reprend dans le dépôt de la grammaire ldpy, clés préfixées
`ldpy-sparql-vendor-` et `ldpy-turtle-vendor-`, `source.turtle` résolu sur
place, et la règle d'interpolation `{expr}` placée en tête, avant elles.
