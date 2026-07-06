package com.thomasfarineau.typeflow.idea

import com.intellij.lexer.LexerBase
import com.intellij.psi.TokenType
import com.intellij.psi.tree.IElementType

/**
 * Hand-rolled port of `src/parser/lexer.ts`'s tokenizer (whitespace,
 * `#`/`//` comments, identifiers, numbers, single/double-quoted strings with
 * `\n`/`\t`/`\r`/`\\`/`"`/`'` escapes, multi- and single-char punctuation).
 * For syntax highlighting only — not full error recovery, no diagnostics.
 */
class TypeflowLexer : LexerBase() {
    private lateinit var buffer: CharSequence
    private var endOffset = 0
    private var tokenStart = 0
    private var tokenEnd = 0
    private var tokenType: IElementType? = null

    override fun start(
        buffer: CharSequence,
        startOffset: Int,
        endOffset: Int,
        initialState: Int,
    ) {
        this.buffer = buffer
        this.endOffset = endOffset
        this.tokenStart = startOffset
        advanceInternal()
    }

    override fun getState(): Int = 0

    override fun getTokenType(): IElementType? = tokenType

    override fun getTokenStart(): Int = tokenStart

    override fun getTokenEnd(): Int = tokenEnd

    override fun advance() {
        tokenStart = tokenEnd
        advanceInternal()
    }

    override fun getBufferSequence(): CharSequence = buffer

    override fun getBufferEnd(): Int = endOffset

    private fun isIdentStart(c: Char) = c.isLetter() || c == '_' || c == '$'

    private fun isIdentPart(c: Char) = c.isLetterOrDigit() || c == '_' || c == '$'

    private fun isWhitespace(c: Char) = c == ' ' || c == '\t' || c == '\r' || c == '\n'

    private fun advanceInternal() {
        val i = tokenStart
        if (i >= endOffset) {
            tokenType = null
            tokenEnd = i
            return
        }
        val c = buffer[i]

        if (isWhitespace(c)) {
            var j = i
            while (j < endOffset && isWhitespace(buffer[j])) j++
            tokenType = TokenType.WHITE_SPACE
            tokenEnd = j
            return
        }

        if (c == '#' || (c == '/' && i + 1 < endOffset && buffer[i + 1] == '/')) {
            var j = i
            while (j < endOffset && buffer[j] != '\n') j++
            tokenType = TypeflowTokenTypes.COMMENT
            tokenEnd = j
            return
        }

        if (isIdentStart(c)) {
            var j = i
            while (j < endOffset && isIdentPart(buffer[j])) j++
            val text = buffer.subSequence(i, j).toString()
            tokenType =
                if (TypeflowTokenTypes.KEYWORDS.contains(text)) TypeflowTokenTypes.KEYWORD
                else TypeflowTokenTypes.IDENTIFIER
            tokenEnd = j
            return
        }

        if (c.isDigit()) {
            var j = i
            while (j < endOffset && buffer[j].isDigit()) j++
            if (j < endOffset && buffer[j] == '.' && j + 1 < endOffset && buffer[j + 1].isDigit()) {
                j++
                while (j < endOffset && buffer[j].isDigit()) j++
            }
            if (j < endOffset && (buffer[j] == 'e' || buffer[j] == 'E')) {
                var k = j + 1
                if (k < endOffset && (buffer[k] == '+' || buffer[k] == '-')) k++
                if (k < endOffset && buffer[k].isDigit()) {
                    j = k
                    while (j < endOffset && buffer[j].isDigit()) j++
                }
            }
            tokenType = TypeflowTokenTypes.NUMBER
            tokenEnd = j
            return
        }

        if (c == '"' || c == '\'') {
            val quote = c
            var j = i + 1
            while (j < endOffset && buffer[j] != quote && buffer[j] != '\n') {
                j += if (buffer[j] == '\\' && j + 1 < endOffset) 2 else 1
            }
            if (j < endOffset && buffer[j] == quote) j++
            tokenType = TypeflowTokenTypes.STRING
            tokenEnd = j
            return
        }

        if (i + 1 < endOffset) {
            val two = buffer.subSequence(i, i + 2).toString()
            if (TypeflowTokenTypes.MULTI_PUNCT.contains(two)) {
                tokenType = TypeflowTokenTypes.OPERATOR
                tokenEnd = i + 2
                return
            }
        }

        if (TypeflowTokenTypes.STRUCTURAL_PUNCT.contains(c)) {
            tokenType = TypeflowTokenTypes.PUNCTUATION
            tokenEnd = i + 1
            return
        }
        if (TypeflowTokenTypes.OPERATOR_CHARS.contains(c)) {
            tokenType = TypeflowTokenTypes.OPERATOR
            tokenEnd = i + 1
            return
        }

        tokenType = TypeflowTokenTypes.BAD_CHARACTER
        tokenEnd = i + 1
    }
}
