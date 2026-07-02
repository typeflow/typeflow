import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  title: "Typeflow",
  description: "Typed JSON transformations, checked at compile time.",
  base: "/typeflow/",
  head: [["link", { rel: "icon", type: "image/svg+xml", href: "/typeflow/logo.svg" }]],
  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Playground", link: "/playground" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/guide/getting-started" },
          { text: "The language", link: "/guide/language" },
          { text: "CLI", link: "/guide/cli" },
        ],
      },
      {
        text: "Playground",
        items: [{ text: "Try it live", link: "/playground" }],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/thomasfarineau/typeflow" }],
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Thomas Farineau",
    },
  },
  vite: {
    resolve: {
      // docs/ is not a workspace member; point the playground at package sources.
      alias: {
        "@thomasfarineau/typeflow-core": pkg("core"),
        "@thomasfarineau/typeflow-parser": pkg("parser"),
        "@thomasfarineau/typeflow-compiler": pkg("compiler"),
        "@thomasfarineau/typeflow-runtime": pkg("runtime"),
      },
    },
    ssr: {
      // Workspace packages ship TypeScript source; bundle them during SSR build.
      noExternal: [/@thomasfarineau\/typeflow/],
    },
  },
});
