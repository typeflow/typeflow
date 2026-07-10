package fr.thomasfarineau.typeflow.idea

import com.intellij.openapi.fileTypes.LanguageFileType
import javax.swing.Icon

object TypeflowFileType : LanguageFileType(TypeflowLanguage) {
    override fun getName(): String = "Typeflow"

    override fun getDescription(): String = "Typeflow mapping file"

    override fun getDefaultExtension(): String = "typeflow"

    override fun getIcon(): Icon = TypeflowIcons.FILE
}
