package com.thomasfarineau.typeflow.idea

import com.intellij.psi.tree.IElementType

class TypeflowTokenType(debugName: String) : IElementType(debugName, TypeflowLanguage)

/**
 * Mirrors the token model of `src/parser/lexer.ts` (ident/number/string/punct/comment),
 * with `ident` split into KEYWORD vs IDENTIFIER by value, and `punct` split into
 * PUNCTUATION (structural: `{}[](),:`) vs OPERATOR (the rest) for nicer coloring.
 * Best-effort for highlighting — not a source of truth for the grammar.
 */
object TypeflowTokenTypes {
    val IDENTIFIER = TypeflowTokenType("IDENTIFIER")
    val KEYWORD = TypeflowTokenType("KEYWORD")
    val NUMBER = TypeflowTokenType("NUMBER")
    val STRING = TypeflowTokenType("STRING")
    val COMMENT = TypeflowTokenType("COMMENT")
    val OPERATOR = TypeflowTokenType("OPERATOR")
    val PUNCTUATION = TypeflowTokenType("PUNCTUATION")
    val BAD_CHARACTER = TypeflowTokenType("BAD_CHARACTER")

    // Bare identifiers the parser treats as keywords in context (lexer.ts
    // itself doesn't distinguish them — the parser does, by value).
    val KEYWORDS: Set<String> =
        setOf("input", "map", "use", "from", "fn", "let", "true", "false", "null")

    val MULTI_PUNCT: Set<String> =
        setOf("?.", "??", "->", "==", "!=", "<=", ">=", "&&", "||")

    const val STRUCTURAL_PUNCT = "{}[](),:"
    const val OPERATOR_CHARS = ".?|!+-*/%<>=^"
}
