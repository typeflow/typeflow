package fr.thomasfarineau.typeflow.idea

import com.intellij.lexer.Lexer
import com.intellij.openapi.editor.DefaultLanguageHighlighterColors as Default
import com.intellij.openapi.editor.HighlighterColors
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.colors.TextAttributesKey.createTextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighterBase
import com.intellij.psi.tree.IElementType

class TypeflowSyntaxHighlighter : SyntaxHighlighterBase() {
    override fun getHighlightingLexer(): Lexer = TypeflowLexer()

    override fun getTokenHighlights(tokenType: IElementType?): Array<TextAttributesKey> =
        when (tokenType) {
            TypeflowTokenTypes.KEYWORD -> KEYWORD_KEYS
            TypeflowTokenTypes.PROPERTY -> PROPERTY_KEYS
            TypeflowTokenTypes.FUNCTION -> FUNCTION_KEYS
            TypeflowTokenTypes.TYPE -> TYPE_KEYS
            TypeflowTokenTypes.LITERAL -> LITERAL_KEYS
            TypeflowTokenTypes.IDENTIFIER -> IDENTIFIER_KEYS
            TypeflowTokenTypes.NUMBER -> NUMBER_KEYS
            TypeflowTokenTypes.STRING -> STRING_KEYS
            TypeflowTokenTypes.COMMENT -> COMMENT_KEYS
            TypeflowTokenTypes.OPERATOR -> OPERATOR_KEYS
            TypeflowTokenTypes.PUNCTUATION -> PUNCTUATION_KEYS
            TypeflowTokenTypes.BAD_CHARACTER -> BAD_CHARACTER_KEYS
            else -> EMPTY_KEYS
        }

    companion object {
        // Fallbacks chosen to mirror docs/.vitepress/theme/tokens.css's distinctions
        // (property/function/type/literal each read differently from a plain
        // identifier or keyword) while still adapting to the user's IDE color scheme.
        val KEYWORD: TextAttributesKey = createTextAttributesKey("TYPEFLOW_KEYWORD", Default.KEYWORD)
        val PROPERTY: TextAttributesKey = createTextAttributesKey("TYPEFLOW_PROPERTY", Default.INSTANCE_FIELD)
        val FUNCTION: TextAttributesKey = createTextAttributesKey("TYPEFLOW_FUNCTION", Default.FUNCTION_CALL)
        val TYPE: TextAttributesKey = createTextAttributesKey("TYPEFLOW_TYPE", Default.CLASS_REFERENCE)
        val LITERAL: TextAttributesKey = createTextAttributesKey("TYPEFLOW_LITERAL", Default.KEYWORD)
        val IDENTIFIER: TextAttributesKey = createTextAttributesKey("TYPEFLOW_IDENTIFIER", Default.IDENTIFIER)
        val NUMBER: TextAttributesKey = createTextAttributesKey("TYPEFLOW_NUMBER", Default.NUMBER)
        val STRING: TextAttributesKey = createTextAttributesKey("TYPEFLOW_STRING", Default.STRING)
        val COMMENT: TextAttributesKey = createTextAttributesKey("TYPEFLOW_COMMENT", Default.LINE_COMMENT)
        val OPERATOR: TextAttributesKey = createTextAttributesKey("TYPEFLOW_OPERATOR", Default.OPERATION_SIGN)
        val PUNCTUATION: TextAttributesKey = createTextAttributesKey("TYPEFLOW_PUNCTUATION", Default.DOT)
        val BAD_CHARACTER: TextAttributesKey =
            createTextAttributesKey("TYPEFLOW_BAD_CHARACTER", HighlighterColors.BAD_CHARACTER)

        private val EMPTY_KEYS = emptyArray<TextAttributesKey>()
        private val KEYWORD_KEYS = arrayOf(KEYWORD)
        private val PROPERTY_KEYS = arrayOf(PROPERTY)
        private val FUNCTION_KEYS = arrayOf(FUNCTION)
        private val TYPE_KEYS = arrayOf(TYPE)
        private val LITERAL_KEYS = arrayOf(LITERAL)
        private val IDENTIFIER_KEYS = arrayOf(IDENTIFIER)
        private val NUMBER_KEYS = arrayOf(NUMBER)
        private val STRING_KEYS = arrayOf(STRING)
        private val COMMENT_KEYS = arrayOf(COMMENT)
        private val OPERATOR_KEYS = arrayOf(OPERATOR)
        private val PUNCTUATION_KEYS = arrayOf(PUNCTUATION)
        private val BAD_CHARACTER_KEYS = arrayOf(BAD_CHARACTER)
    }
}
