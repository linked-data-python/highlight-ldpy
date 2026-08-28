#!/usr/bin/env node
/** Écrit les artefacts générés : la grammaire TextMate, là où on la demande.
 *  usage : node src/cli-generate.js [chemin/ldpy.tmLanguage.json] */
'use strict';
const fs = require('fs');
const path = require('path');
const { grammarText } = require('./textmate');

const out = process.argv[2] ||
    path.join(__dirname, '..', '..', 'vscode-ldpy', 'syntaxes', 'ldpy.tmLanguage.json');
fs.writeFileSync(out, grammarText());
console.log(`écrit : ${out}`);
