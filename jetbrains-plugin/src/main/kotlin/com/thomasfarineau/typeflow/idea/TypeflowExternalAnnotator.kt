package com.thomasfarineau.typeflow.idea

import com.google.gson.Gson
import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.ExternalAnnotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.diagnostic.Logger
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiFile
import java.io.File
import java.util.concurrent.TimeUnit

data class TypeflowSpan(val start: Int, val end: Int)

data class TypeflowDiagnostic(
    val code: String,
    val message: String,
    val span: TypeflowSpan,
    val severity: String,
    val hint: String? = null,
)

data class TypeflowFileReport(val file: String, val diagnostics: List<TypeflowDiagnostic>)

/**
 * Runs `typeflow check --json <file>` (see `src/cli/commands/analyze.ts`'s
 * `--json` flag) and turns the result into inline annotations, using the
 * diagnostic's byte-offset span directly as a `TextRange` — no line/col
 * conversion needed, the CLI already emits character offsets.
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
    private val log = Logger.getInstance(TypeflowExternalAnnotator::class.java)
    private val gson = Gson()

    override fun collectInformation(file: PsiFile): PsiFile = file

    override fun doAnnotate(file: PsiFile): List<TypeflowDiagnostic> {
        val virtualFile = file.virtualFile ?: return emptyList()
        val path = virtualFile.path
        val workingDir = file.project.basePath?.let(::File) ?: File(path).parentFile

        return try {
            val process =
                ProcessBuilder("typeflow", "check", path, "--json")
                    .directory(workingDir)
                    .redirectErrorStream(false)
                    .start()
            val output = process.inputStream.bufferedReader().use { it.readText() }
            process.waitFor(10, TimeUnit.SECONDS)

            val reports = gson.fromJson(output, Array<TypeflowFileReport>::class.java) ?: return emptyList()
            reports.firstOrNull()?.diagnostics ?: emptyList()
        } catch (e: Exception) {
            log.info("typeflow check failed — is the CLI on PATH? ($e)")
            emptyList()
        }
    }

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
