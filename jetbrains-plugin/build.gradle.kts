plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.20"
    id("org.jetbrains.intellij.platform") version "2.11.0"
}

group = "com.thomasfarineau.typeflow"
version = "0.1.0"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Unified IntelliJ IDEA artifact (Community + Ultimate merged since
        // 2025.3) — free to build/run against, no license needed.
        intellijIdea("2025.3")
        testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)
    }
}

intellijPlatform {
    pluginConfiguration {
        name = "Typeflow"
        ideaVersion {
            sinceBuild = "253"
        }
    }
}

kotlin {
    jvmToolchain(21)
}
