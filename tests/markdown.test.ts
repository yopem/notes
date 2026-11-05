import { describe, expect, test } from "bun:test"

import {
  analyzeMarkdown,
  applyMarkdownEdit,
  classifyLink,
  toggleMarkdownTask,
} from "@/utils/markdown"

// Source positions are a data-safety boundary for native preview edits.
// Define Unicode, CRLF, escaped/code syntax, duplicate headings, malformed
// metadata, alias expansion, stale edits, and unsafe protocols before code.
describe("positioned Markdown document", () => {
  test("parses GFM, math and bounded YAML metadata with source positions", () => {
    const source =
      "---\ntags: [work, native]\npriority: 2\n---\n\n# Hello **native**\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n$x^2$\n\n- [ ] Ready\n"
    const document = analyzeMarkdown(source)
    expect(document.frontmatter).toEqual({
      tags: ["work", "native"],
      priority: 2,
    })
    expect(document.headings[0]).toMatchObject({
      title: "Hello native",
      id: "hello-native",
      depth: 1,
    })
    expect(
      source.slice(document.headings[0]?.start, document.headings[0]?.end),
    ).toBe("# Hello **native**")
    expect(document.tree.children.some((node) => node.type === "table")).toBe(
      true,
    )
    expect(document.tasks).toHaveLength(1)
    expect(document.tasks[0]?.label).toBe("Ready")
  })

  test("assigns unique Unicode heading anchors", () => {
    const document = analyzeMarkdown(
      "# Héllo 🌿\n# Héllo\n# Héllo-1\n# Héllo\n",
    )
    expect(document.headings.map((heading) => heading.id)).toEqual([
      "héllo",
      "héllo-1",
      "héllo-1-1",
      "héllo-2",
    ])
  })

  test("finds links, aliases, embeds and anchors but not fenced or inline code", () => {
    const source =
      "[[Project#Plan|My plan]] ![[photo.png]] [Web](https://example.com)\n\n`[[Not a link]]`\n\n```md\n[[Not a note]]\n- [ ] Not a task\n```\n"
    const document = analyzeMarkdown(source)
    expect(document.links.map((link) => link.target)).toEqual([
      "Project#Plan",
      "photo.png",
      "https://example.com",
    ])
    expect(document.links[0]).toMatchObject({
      label: "My plan",
      kind: "wiki",
      embed: false,
    })
    expect(document.links[1]).toMatchObject({ kind: "wiki", embed: true })
    expect(document.tasks).toEqual([])

    for (const link of document.links)
      expect(source.slice(link.start, link.end)).not.toBe("")
  })

  test("does not create nested wiki links inside Markdown link labels", () => {
    const document = analyzeMarkdown(
      "[**[[Literal]]**](https://example.com) [[Real]]",
    )
    expect(document.links.map((link) => link.target)).toEqual([
      "https://example.com",
      "Real",
    ])
  })

  test("ignores escaped wiki markers and preserves real link offsets", () => {
    const source = "\\[[Literal]] and [[Real note]]"
    const document = analyzeMarkdown(source)
    expect(document.links.map((link) => link.target)).toEqual(["Real note"])
    const link = document.links[0]
    expect(link && source.slice(link.start, link.end)).toBe("[[Real note]]")
  })

  test("toggles exact task marker with nested tasks, CRLF and Unicode intact", () => {
    const source =
      "# 日記 🌿\r\n\r\n- [ ] Parent\r\n  - [x] Child\r\n\r\n`- [ ] literal`\r\n"
    const document = analyzeMarkdown(source)
    expect(document.tasks).toHaveLength(2)
    const task = document.tasks[0]

    if (!task) throw new Error("Missing task fixture")
    expect(toggleMarkdownTask(source, task)).toBe(
      source.replace("[ ] Parent", "[x] Parent"),
    )
    expect(document.tasks[1]?.checked).toBe(true)
    expect(() => toggleMarkdownTask("changed " + source, task)).toThrow(
      /changed/i,
    )
  })

  test("rejects stale, out-of-range and split-surrogate edits", () => {
    const source = "🌿 note"
    expect(
      applyMarkdownEdit(source, {
        source,
        start: 3,
        end: 7,
        replacement: "text",
      }),
    ).toBe("🌿 text")
    expect(() =>
      applyMarkdownEdit(source, {
        source: "other",
        start: 0,
        end: 0,
        replacement: "x",
      }),
    ).toThrow(/changed/i)
    expect(() =>
      applyMarkdownEdit(source, { source, start: 1, end: 2, replacement: "x" }),
    ).toThrow(/Unicode/i)
    expect(() =>
      applyMarkdownEdit(source, {
        source,
        start: 0,
        end: 90,
        replacement: "x",
      }),
    ).toThrow(Error)
  })

  test("malformed or non-record YAML reports an error without changing source", () => {
    expect(() => analyzeMarkdown("---\nx: [broken\n---\nbody")).toThrow(Error)
    expect(() => analyzeMarkdown("---\n- array\n---\nbody")).toThrow(Error)
    expect(() => analyzeMarkdown("---\nx: 1\nx: 2\n---\nbody")).toThrow(Error)
    expect(() => analyzeMarkdown("---\nx: &cycle [*cycle]\n---\nbody")).toThrow(
      Error,
    )
  })
})

describe("native link trust boundary", () => {
  test("supports safe links, internal paths, fragments and explicit custom schemes", () => {
    expect(classifyLink("https://example.com").kind).toBe("external")
    expect(classifyLink("mailto:person@example.com").kind).toBe("external")
    expect(classifyLink("../notes/Idea.md#Plan").kind).toBe("internal")
    expect(classifyLink("#Plan").kind).toBe("internal")
    expect(classifyLink("obsidian://open", ["obsidian"]).kind).toBe("external")
  })
  test("blocks executable and file schemes even if included in custom list", () => {
    for (const target of [
      "javascript:alert(1)",
      "data:text/html,bad",
      "file:///etc/passwd",
      "shell:run",
      "about:blank",
      "\\\\server\\share",
      "\u0000https://example.com",
    ])
      expect(classifyLink(target, ["javascript", "file", "shell"]).kind).toBe(
        "blocked",
      )
    expect(classifyLink("unknown:open").kind).toBe("blocked")
  })
})
