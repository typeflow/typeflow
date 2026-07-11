package fr.thomasfarineau.typeflow.idea

import com.intellij.extapi.psi.ASTWrapperPsiElement
import com.intellij.lang.ASTNode
import com.intellij.lang.ParserDefinition
import com.intellij.lang.PsiBuilder
import com.intellij.lang.PsiParser
import com.intellij.lexer.Lexer
import com.intellij.openapi.project.Project
import com.intellij.psi.FileViewProvider
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.TokenType
import com.intellij.psi.tree.IElementType
import com.intellij.psi.tree.IFileElementType
import com.intellij.psi.tree.TokenSet

/**
 * Minimal parser: flattens the whole file into a single-node PSI tree (no
 * real grammar — see [TypeflowLexer]'s doc comment). Its only job is to make
 * `.typeflow` files report PSI language = Typeflow instead of falling back to
 * plain text.
 *
 * That fallback is the actual bug this fixes: syntax highlighting resolves
 * straight from [TypeflowFileType]'s declared language, so it worked without
 * this. But [TypeflowCompletionContributor] and [TypeflowExternalAnnotator]
 * are both registered per-language (`language="Typeflow"` in plugin.xml) and
 * IntelliJ dispatches those by the file's *PSI* language — which, absent any
 * `lang.parserDefinition`, is plain text for every `.typeflow` file. Both
 * extensions were registered correctly and never fired.
 */
class TypeflowParserDefinition : ParserDefinition {
    override fun createLexer(project: Project?): Lexer = TypeflowLexer()

    override fun createParser(project: Project?): PsiParser =
        object : PsiParser {
            override fun parse(root: IElementType, builder: PsiBuilder): ASTNode {
                val marker = builder.mark()
                while (!builder.eof()) builder.advanceLexer()
                marker.done(root)
                return builder.treeBuilt
            }
        }

    override fun getFileNodeType(): IFileElementType = FILE

    override fun getWhitespaceTokens(): TokenSet = TokenSet.create(TokenType.WHITE_SPACE)

    override fun getCommentTokens(): TokenSet = TokenSet.create(TypeflowTokenTypes.COMMENT)

    override fun getStringLiteralElements(): TokenSet = TokenSet.create(TypeflowTokenTypes.STRING)

    override fun createElement(node: ASTNode): PsiElement = ASTWrapperPsiElement(node)

    override fun createFile(viewProvider: FileViewProvider): PsiFile = TypeflowFile(viewProvider)

    companion object {
        val FILE = IFileElementType(TypeflowLanguage)
    }
}
