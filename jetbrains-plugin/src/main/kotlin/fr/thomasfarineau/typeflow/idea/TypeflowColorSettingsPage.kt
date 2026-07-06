package fr.thomasfarineau.typeflow.idea

import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.options.colors.AttributesDescriptor
import com.intellij.openapi.options.colors.ColorDescriptor
import com.intellij.openapi.options.colors.ColorSettingsPage
import javax.swing.Icon

class TypeflowColorSettingsPage : ColorSettingsPage {
    override fun getIcon(): Icon = TypeflowIcons.FILE

    override fun getHighlighter(): SyntaxHighlighter = TypeflowSyntaxHighlighter()

    override fun getDemoText(): String =
        """
        # Normalize the upstream API user into the app's view model.
        input user: ApiUser from "./user-types"

        map {
          id: user.id,
          fullName: trim(user.firstName + " " + user.lastName),
          isAdmin: user.role == "admin",
          flagged: false,
          email: user.contact?.email ?? "unknown",
          activeTags: user.labels[active].name,
        }
        """.trimIndent()

    override fun getAdditionalHighlightingTagToDescriptorMap(): MutableMap<String, TextAttributesKey>? = null

    override fun getAttributeDescriptors(): Array<AttributesDescriptor> =
        arrayOf(
            AttributesDescriptor("Keyword", TypeflowSyntaxHighlighter.KEYWORD),
            AttributesDescriptor("Property", TypeflowSyntaxHighlighter.PROPERTY),
            AttributesDescriptor("Function call", TypeflowSyntaxHighlighter.FUNCTION),
            AttributesDescriptor("Primitive type", TypeflowSyntaxHighlighter.TYPE),
            AttributesDescriptor("Literal (true/false/null)", TypeflowSyntaxHighlighter.LITERAL),
            AttributesDescriptor("Identifier", TypeflowSyntaxHighlighter.IDENTIFIER),
            AttributesDescriptor("Number", TypeflowSyntaxHighlighter.NUMBER),
            AttributesDescriptor("String", TypeflowSyntaxHighlighter.STRING),
            AttributesDescriptor("Comment", TypeflowSyntaxHighlighter.COMMENT),
            AttributesDescriptor("Operator", TypeflowSyntaxHighlighter.OPERATOR),
            AttributesDescriptor("Punctuation", TypeflowSyntaxHighlighter.PUNCTUATION),
        )

    override fun getColorDescriptors(): Array<ColorDescriptor> = ColorDescriptor.EMPTY_ARRAY

    override fun getDisplayName(): String = "Typeflow"
}
