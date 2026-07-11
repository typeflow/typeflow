package fr.thomasfarineau.typeflow.idea

import com.intellij.extapi.psi.PsiFileBase
import com.intellij.openapi.fileTypes.FileType
import com.intellij.psi.FileViewProvider

class TypeflowFile(viewProvider: FileViewProvider) : PsiFileBase(viewProvider, TypeflowLanguage) {
    override fun getFileType(): FileType = TypeflowFileType

    override fun toString(): String = "Typeflow File"
}
