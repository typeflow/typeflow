package fr.thomasfarineau.typeflow.idea

import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.ExternalAnnotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiFile

/**
 * Runs `typeflow check --json <file>` (via [TypeflowCli]) and turns the result
 * into inline annotations, using the diagnostic's byte-offset span directly as
 * a `TextRange` — no line/col conversion needed, the CLI already emits
 * character offsets.
 *
 * This is the "watch" piece: no persistent process, IntelliJ's own
 * highlighting daemon re-runs `doAnnotate` on edits/saves on a background
 * thread, which is the platform-idiomatic equivalent of a live watcher.
 *
 * Requires the `typeflow` CLI resolvable from the project root (e.g.
 * `npm i @thomasfarineau/typeflow` locally with `npx`/`bunx` on PATH, or a
 * global install) — not bundled with this plugin.
 */
class TypeflowExternalAnnotator : ExternalAnnotator<PsiFile, List<TypeflowDiagnostic>>() {
    override fun collectInformation(file: PsiFile): PsiFile = file

    override fun doAnnotate(file: PsiFile): List<TypeflowDiagnostic> =
        TypeflowCli.check(file)?.diagnostics ?: emptyList()

    override fun apply(file: PsiFile, annotationResult: List<TypeflowDiagnostic>, holder: AnnotationHolder) {
        val docLength = file.textLength
        for (diagnostic in annotationResult) {
            val start = diagnostic.span.start.coerceIn(0, docLength)
            val end = diagnostic.span.end.coerceIn(start, docLength)
            val severity = if (diagnostic.severity == "error") HighlightSeverity.ERROR else HighlightSeverity.WARNING
            val message =
                if (diagnostic.hint != null) "${diagnostic.message} (${diagnostic.hint})" else diagnostic.message
            holder
                .newAnnotation(severity, "${diagnostic.code}: $message")
                .range(TextRange(start, end))
                .create()
        }
    }
}
