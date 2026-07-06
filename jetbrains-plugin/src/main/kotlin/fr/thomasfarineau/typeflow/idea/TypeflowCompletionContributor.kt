package fr.thomasfarineau.typeflow.idea

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.codeInsight.completion.CompletionContributor
import com.intellij.codeInsight.completion.CompletionParameters
import com.intellij.codeInsight.completion.CompletionProvider
import com.intellij.codeInsight.completion.CompletionResultSet
import com.intellij.codeInsight.completion.CompletionType
import com.intellij.codeInsight.lookup.LookupElementBuilder
import com.intellij.icons.AllIcons
import com.intellij.patterns.PlatformPatterns
import com.intellij.util.ProcessingContext

/**
 * Two completion modes, neither requiring a real PSI grammar (this plugin has
 * none — see [TypeflowLexer]'s doc comment):
 *
 * - Bare word: the declaration keywords (`input`, `use`, `fn`, `map`, `from`,
 *   `let`) and literals (`true`, `false`, `null`).
 * - Member access (`user.`, `user.contact.`, `user.labels[0].`): re-runs
 *   `typeflow check --json` (via [TypeflowCli]) to get the `input`
 *   declaration's resolved type, then walks the member chain typed so far
 *   through that structural type to offer the actual field names — the
 *   "autocomplete on brought-in inputs" this plugin was missing.
 */
class TypeflowCompletionContributor : CompletionContributor() {
    init {
        extend(CompletionType.BASIC, PlatformPatterns.psiElement(), TypeflowCompletionProvider())
    }
}

private sealed interface PathSegment {
    data class Field(val name: String) : PathSegment
    data object Index : PathSegment
}

private class TypeflowCompletionProvider : CompletionProvider<CompletionParameters>() {
    override fun addCompletions(
        parameters: CompletionParameters,
        context: ProcessingContext,
        result: CompletionResultSet,
    ) {
        val text = parameters.editor.document.charsSequence
        val offset = parameters.offset

        var identStart = offset
        while (identStart > 0 && isIdentPart(text[identStart - 1])) identStart--
        val prefix = text.subSequence(identStart, offset).toString()
        val prefixed = result.withPrefixMatcher(prefix)

        val dot = prevSignificant(text, identStart)
        if (dot < 0 || text[dot] != '.') {
            addKeywordCompletions(prefixed)
            return
        }

        val chainEnd = prevSignificant(text, dot)
        if (chainEnd < 0) return
        val (rootName, steps) = parseMemberChain(text, chainEnd) ?: return

        val report = TypeflowCli.check(parameters.originalFile) ?: return
        if (report.inputName != rootName) return
        var current = report.inputType ?: return

        for (step in steps) {
            val stripped = stripNullish(current)
            current =
                when (step) {
                    is PathSegment.Field -> fieldsOf(stripped).firstOrNull { it.first == step.name }?.second ?: return
                    PathSegment.Index -> elementOf(stripped) ?: return
                }
        }

        for ((name, fieldType) in fieldsOf(stripNullish(current))) {
            prefixed.addElement(
                LookupElementBuilder.create(name)
                    .withTypeText(typeToDisplay(fieldType), true)
                    .withIcon(AllIcons.Nodes.Field),
            )
        }
    }
}

private fun addKeywordCompletions(result: CompletionResultSet) {
    for (keyword in TypeflowTokenTypes.KEYWORDS) {
        result.addElement(LookupElementBuilder.create(keyword).bold())
    }
    for (literal in TypeflowTokenTypes.LITERALS) {
        result.addElement(LookupElementBuilder.create(literal))
    }
}

private fun isIdentPart(c: Char) = c.isLetterOrDigit() || c == '_' || c == '$'

private fun isIdentStart(c: Char) = c.isLetter() || c == '_' || c == '$'

private fun prevSignificant(text: CharSequence, before: Int): Int {
    var j = before - 1
    while (j >= 0 && text[j].isWhitespace()) j--
    return j
}

/**
 * Parses a `root(.field | [index])*` chain ending at [chainEnd] (the index of
 * its last significant character), scanning backward. Returns the root
 * identifier and the steps in root-to-leaf order, or null for anything this
 * simple scan can't make sense of (calls, parens, operators — those need a
 * real parser, out of scope for a lexer-only plugin).
 */
private fun parseMemberChain(text: CharSequence, chainEnd: Int): Pair<String, List<PathSegment>>? {
    val steps = mutableListOf<PathSegment>()
    var end = chainEnd
    var rootName: String? = null

    while (rootName == null) {
        if (end < 0) return null
        if (text[end] == ']') {
            var depth = 1
            var k = end - 1
            while (k >= 0 && depth > 0) {
                when (text[k]) {
                    ']' -> depth++
                    '[' -> depth--
                }
                if (depth > 0) k--
            }
            if (depth != 0) return null
            steps.add(PathSegment.Index)
            end = prevSignificant(text, k)
            continue
        }

        if (!isIdentPart(text[end])) return null
        var start = end
        while (start > 0 && isIdentPart(text[start - 1])) start--
        if (!isIdentStart(text[start])) return null
        val name = text.subSequence(start, end + 1).toString()

        val beforeDot = prevSignificant(text, start)
        if (beforeDot >= 0 && text[beforeDot] == '.') {
            steps.add(PathSegment.Field(name))
            end = prevSignificant(text, beforeDot)
        } else {
            rootName = name
        }
    }

    return rootName to steps.asReversed()
}

/** Drops `null`/`undefined` from a union so member access can see through optional fields. */
private fun stripNullish(type: JsonObject): JsonObject {
    if (type.get("kind")?.asString != "union") return type
    val members =
        type.getAsJsonArray("types")
            .map { it.asJsonObject }
            .filter { it.get("kind")?.asString != "null" && it.get("kind")?.asString != "undefined" }
    return when (members.size) {
        0 -> type
        1 -> members[0]
        else -> {
            val merged = JsonObject()
            merged.addProperty("kind", "union")
            val arr = JsonArray()
            members.forEach(arr::add)
            merged.add("types", arr)
            merged
        }
    }
}

private fun fieldsOf(type: JsonObject): List<Pair<String, JsonObject>> =
    when (type.get("kind")?.asString) {
        "object" ->
            type.getAsJsonArray("fields").map { f ->
                val field = f.asJsonObject
                field.get("name").asString to field.getAsJsonObject("type")
            }
        // A field reachable through only some union members still gets suggested.
        "union" -> type.getAsJsonArray("types").flatMap { fieldsOf(it.asJsonObject) }.distinctBy { it.first }
        else -> emptyList()
    }

private fun elementOf(type: JsonObject): JsonObject? =
    when (type.get("kind")?.asString) {
        "array" -> type.getAsJsonObject("element")
        "union" -> type.getAsJsonArray("types").firstNotNullOfOrNull { elementOf(it.asJsonObject) }
        else -> null
    }

private fun typeToDisplay(type: JsonObject): String =
    when (val kind = type.get("kind")?.asString) {
        "object" -> "{ … }"
        "array" -> "${typeToDisplay(type.getAsJsonObject("element"))}[]"
        "union" -> type.getAsJsonArray("types").joinToString(" | ") { typeToDisplay(it.asJsonObject) }
        "literal" -> type.get("value")?.toString() ?: "literal"
        null -> "unknown"
        else -> kind
    }
