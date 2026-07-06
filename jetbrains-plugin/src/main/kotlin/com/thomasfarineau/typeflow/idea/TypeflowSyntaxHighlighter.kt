package com.thomasfarineau.typeflow.idea

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
        val KEYWORD: TextAttributesKey = createTextAttributesKey("TYPEFLOW_KEYWORD", Default.KEYWORD)
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
        private val IDENTIFIER_KEYS = arrayOf(IDENTIFIER)
        private val NUMBER_KEYS = arrayOf(NUMBER)
        private val STRING_KEYS = arrayOf(STRING)
        private val COMMENT_KEYS = arrayOf(COMMENT)
        private val OPERATOR_KEYS = arrayOf(OPERATOR)
        private val PUNCTUATION_KEYS = arrayOf(PUNCTUATION)
        private val BAD_CHARACTER_KEYS = arrayOf(BAD_CHARACTER)
    }
}
