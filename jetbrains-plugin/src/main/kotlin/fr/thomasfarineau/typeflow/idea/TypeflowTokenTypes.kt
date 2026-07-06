package fr.thomasfarineau.typeflow.idea

import com.intellij.psi.tree.IElementType

class TypeflowTokenType(debugName: String) : IElementType(debugName, TypeflowLanguage)

/**
 * Mirrors the token model of `src/parser/lexer.ts` (ident/number/string/punct/comment),
 * with `ident` further classified by value and position the same way the docs
 * playground (`docs/.vitepress/theme/highlight.ts`) does: property names (`{ name: ` /
 * `, name?: `), function calls (`name(`), keywords, literals, primitive types, and
 * plain identifiers each get their own token/color. `punct` is split into
 * PUNCTUATION (structural: `{}[](),:`) vs OPERATOR (the rest).
 * Best-effort for highlighting — not a source of truth for the grammar.
 */
object TypeflowTokenTypes {
    val IDENTIFIER = TypeflowTokenType("IDENTIFIER")
    val KEYWORD = TypeflowTokenType("KEYWORD")
    val PROPERTY = TypeflowTokenType("PROPERTY")
    val FUNCTION = TypeflowTokenType("FUNCTION")
    val TYPE = TypeflowTokenType("TYPE")
    val LITERAL = TypeflowTokenType("LITERAL")
    val NUMBER = TypeflowTokenType("NUMBER")
    val STRING = TypeflowTokenType("STRING")
    val COMMENT = TypeflowTokenType("COMMENT")
    val OPERATOR = TypeflowTokenType("OPERATOR")
    val PUNCTUATION = TypeflowTokenType("PUNCTUATION")
    val BAD_CHARACTER = TypeflowTokenType("BAD_CHARACTER")

    // Mirrors highlight.ts's KEYWORDS/LITERALS/TYPES sets exactly, so the IDE
    // and the docs playground agree on which bare identifiers get which color.
    val KEYWORDS: Set<String> = setOf("input", "use", "fn", "map", "from", "let")
    val LITERALS: Set<String> = setOf("true", "false", "null")
    val TYPES: Set<String> = setOf("string", "number", "boolean", "unknown")

    val MULTI_PUNCT: Set<String> =
        setOf("?.", "??", "->", "==", "!=", "<=", ">=", "&&", "||")

    const val STRUCTURAL_PUNCT = "{}[](),:"
    const val OPERATOR_CHARS = ".?|!+-*/%<>=^"
}
