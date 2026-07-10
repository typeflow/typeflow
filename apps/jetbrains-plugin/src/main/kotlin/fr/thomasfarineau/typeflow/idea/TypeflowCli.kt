package fr.thomasfarineau.typeflow.idea

import com.google.gson.Gson
import com.google.gson.JsonObject
import com.intellij.openapi.diagnostic.Logger
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

/**
 * One file's `typeflow check --json` result. `inputType` is the structural
 * type model from `src/core/types.ts` (`{ kind: 'object' | 'array' | ... }`),
 * serialized as-is since it's already a plain JSON-able tree — kept as a raw
 * [JsonObject] rather than a sealed class since Gson has no built-in support
 * for polymorphic `kind`-tagged unions.
 */
data class TypeflowFileReport(
    val file: String,
    val diagnostics: List<TypeflowDiagnostic>,
    val inputName: String? = null,
    val inputType: JsonObject? = null,
)

/**
 * Shells out to `typeflow check --json <file>` (see `src/cli/commands/analyze.ts`),
 * shared by the external annotator (diagnostics) and the completion contributor
 * (input type shape). No persistent process: IntelliJ re-invokes callers on
 * edits/saves, and each call is a fresh, independent `typeflow` run.
 */
object TypeflowCli {
    private val log = Logger.getInstance(TypeflowCli::class.java)
    private val gson = Gson()

    fun check(file: PsiFile): TypeflowFileReport? {
        val virtualFile = file.virtualFile ?: return null
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

            val reports = gson.fromJson(output, Array<TypeflowFileReport>::class.java) ?: return null
            reports.firstOrNull()
        } catch (e: Exception) {
            log.info("typeflow check failed — is the CLI on PATH? ($e)")
            null
        }
    }
}
