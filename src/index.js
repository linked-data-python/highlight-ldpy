'use strict';
/**
 * linked-data-python-highlight — la coloration de Linked-Data Python,
 * une spécification et quatre moteurs.
 *
 * Voir DESIGN_CHOICES/ldpy/021 dans l'espace de travail de recherche.
 */
module.exports = {
    /** LA description des îlots : les regex de la fiche ldpy/002, une fois. */
    islands: require('./islands'),
    /** Grammaire TextMate (VS Code) : `build()` / `grammarText()`. */
    textmate: require('./textmate'),
    /** Langage highlight.js : `hljs.registerLanguage('ldpy', …)`. */
    highlightjs: require('./highlightjs'),
    /** Grammaire Prism : `registerLdpy(Prism)`. */
    prism: require('./prism'),
};
