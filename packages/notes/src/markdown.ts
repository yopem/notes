import type { Nodes, Root } from "mdast"

import { toString } from "mdast-util-to-string"
import remarkFrontmatter from "remark-frontmatter"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import { unified } from "unified"
import { visit } from "unist-util-visit"
import { visitParents } from "unist-util-visit-parents"
import { parseDocument } from "yaml"
import { z } from "zod"

export interface MarkdownHeading {
  id: string
  title: string
  depth: number
  start: number
  end: number
  line: number
}

export interface MarkdownReference {
  kind: "wiki" | "markdown" | "image"
  target: string
  label: string
  embed: boolean
  start: number
  end: number
}

export interface MarkdownTask {
  checked: boolean
  label: string
  start: number
  end: number
  line: number
  source: string
}

export interface MarkdownEdit {
  source: string
  start: number
  end: number
  replacement: string
}

export interface MarkdownDocument {
  source: string
  tree: Root
  headings: MarkdownHeading[]
  links: MarkdownReference[]
  tasks: MarkdownTask[]
  frontmatter: z.infer<typeof metadataSchema>
}

const maxPreviewBytes = 2 * 1024 * 1024
const utf8 = new TextEncoder()

const previewTextSchema = z
  .string()
  .refine(
    (source) =>
      source.length <= maxPreviewBytes &&
      utf8.encode(source).byteLength <= maxPreviewBytes,
    { error: "Markdown exceeds the 2 MB preview limit" },
  )

const metadataSchema = z.record(z.string(), z.json())

const editSchema = z.strictObject({
  source: previewTextSchema,
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  replacement: previewTextSchema,
})

const targetSchema = z
  .string()
  .max(8192)
  .refine((value) => !/\p{Cc}/u.test(value))

const parser = unified()
  .use(remarkParse)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkGfm)
  .use(remarkMath)

const blockedSchemes = new Set([
  "javascript",
  "vbscript",
  "data",
  "file",
  "blob",
  "about",
  "chrome",
  "resource",
  "shell",
  "cmd",
  "powershell",
])

function range(node: Nodes) {
  const start = node.position?.start.offset
  const end = node.position?.end.offset

  if (start === undefined || end === undefined)
    throw new Error("Markdown source position is missing")

  return { start, end }
}

function frontmatter(tree: Root) {
  const node = tree.children[0]

  if (node?.type !== "yaml") return {}

  const document = parseDocument(node.value, {
    schema: "core",
    uniqueKeys: true,
  })

  if (document.errors.length)
    throw new Error("Invalid Markdown frontmatter", {
      cause: document.errors[0],
    })
  const raw: unknown = document.toJS({ maxAliasCount: 100 })
  const metadataText = previewTextSchema.safeParse(
    JSON.stringify(raw === null ? {} : raw),
  )

  if (!metadataText.success)
    throw new Error("Frontmatter expansion exceeds the limit")

  return metadataSchema.parse(JSON.parse(metadataText.data))
}

export function analyzeMarkdown(input: string): MarkdownDocument {
  const source = previewTextSchema.parse(input)
  const tree = parser.parse(source)
  const headings: MarkdownHeading[] = []
  const links: MarkdownReference[] = []
  const tasks: MarkdownTask[] = []
  const usedIds = new Set<string>()
  const definitions = new Map<string, string>()

  visit(tree, "definition", (node) => {
    definitions.set(node.identifier.toLowerCase(), node.url)
  })
  visitParents(tree, (node, parents) => {
    if (node.type === "heading") {
      const title = toString(node, { includeHtml: false })

      const base =
        title
          .normalize("NFKC")
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}\s_-]/gu, "")
          .trim()
          .replace(/\s+/g, "-") || "section"

      let id = base
      let suffix = 1

      while (usedIds.has(id)) {
        id = `${base}-${suffix}`
        suffix += 1
      }

      usedIds.add(id)
      headings.push({
        id,
        title,
        depth: node.depth,
        ...range(node),
        line: node.position?.start.line ?? 1,
      })
    } else if (node.type === "link" || node.type === "image") {
      links.push({
        kind: node.type === "image" ? "image" : "markdown",
        target: node.url,
        label: node.type === "image" ? (node.alt ?? "") : toString(node),
        embed: node.type === "image",
        ...range(node),
      })
    } else if (
      node.type === "linkReference" ||
      node.type === "imageReference"
    ) {
      const target = definitions.get(node.identifier.toLowerCase())

      if (target)
        links.push({
          kind: node.type === "imageReference" ? "image" : "markdown",
          target,
          label:
            node.type === "imageReference" ? (node.alt ?? "") : toString(node),
          embed: node.type === "imageReference",
          ...range(node),
        })
    } else if (
      node.type === "listItem" &&
      (node.checked === true || node.checked === false)
    ) {
      const span = range(node)
      const line = source.slice(span.start, span.end).split(/\r?\n/, 1)[0] ?? ""
      const marker = /\[[ xX]\]/.exec(line)

      if (marker) {
        const start = span.start + marker.index + 1
        tasks.push({
          checked: node.checked,
          label: node.children[0] ? toString(node.children[0]) : "",
          start,
          end: start + 1,
          line: node.position?.start.line ?? 1,
          source,
        })
      }
    } else if (
      node.type === "text" &&
      !parents.some(
        (parent) => parent.type === "link" || parent.type === "linkReference",
      )
    ) {
      const span = range(node)
      const raw = source.slice(span.start, span.end)

      for (const match of raw.matchAll(/(!?)\[\[([^\]\r\n]+)\]\]/g)) {
        const payload = match[2]

        if (!payload) continue
        let start = span.start + (match.index ?? 0)
        let slashCount = 0

        for (let index = start - 1; source[index] === "\\"; index -= 1)
          slashCount += 1
        let embed = match[1] === "!"

        if (slashCount % 2) {
          if (!embed) continue
          embed = false
          start += 1
        }

        const divider = payload.indexOf("|")

        const target = (
          divider < 0 ? payload : payload.slice(0, divider)
        ).trim()

        if (!target) continue
        links.push({
          kind: "wiki",
          target,
          label: divider < 0 ? target : payload.slice(divider + 1),
          embed,
          start,
          end: span.start + (match.index ?? 0) + match[0].length,
        })
      }
    }
  })
  links.sort((a, b) => a.start - b.start)
  tasks.sort((a, b) => a.start - b.start)

  return {
    source,
    tree,
    headings,
    links,
    tasks,
    frontmatter: frontmatter(tree),
  }
}

function assertUnicodeBoundary(source: string, position: number) {
  const before = source.charCodeAt(position - 1)
  const after = source.charCodeAt(position)

  if (
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  )
    throw new Error("Edit splits a Unicode character")
}

export function applyMarkdownEdit(source: string, input: MarkdownEdit) {
  const edit = editSchema.parse(input)

  if (source !== edit.source)
    throw new Error("Document changed before this edit. Try again.")

  if (edit.start > edit.end || edit.end > source.length)
    throw new Error("Invalid Markdown edit range")
  assertUnicodeBoundary(source, edit.start)
  assertUnicodeBoundary(source, edit.end)

  return source.slice(0, edit.start) + edit.replacement + source.slice(edit.end)
}

export function toggleMarkdownTask(source: string, task: MarkdownTask) {
  if (source !== task.source)
    throw new Error("Document changed before this task edit. Try again.")
  const marker = source.slice(task.start, task.end)

  if (
    (task.checked && !/[xX]/.test(marker)) ||
    (!task.checked && marker !== " ")
  )
    throw new Error("Task marker changed before this edit")

  return applyMarkdownEdit(source, {
    source: task.source,
    start: task.start,
    end: task.end,
    replacement: task.checked ? " " : "x",
  })
}

export function classifyLink(
  input: string,
  allowedSchemes: readonly string[] = [],
):
  | { kind: "external"; url: string }
  | { kind: "internal"; target: string }
  | { kind: "blocked"; reason: string } {
  const parsed = targetSchema.safeParse(input)

  if (!parsed.success || input.startsWith("\\\\"))
    return { kind: "blocked", reason: "Unsafe link target" }
  const target = parsed.data.trim()
  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(target)?.[1]?.toLowerCase()

  if (!scheme && !target.startsWith("//")) return { kind: "internal", target }

  if (
    scheme &&
    (blockedSchemes.has(scheme) ||
      (!["http", "https", "mailto"].includes(scheme) &&
        !allowedSchemes.includes(scheme)))
  )
    return { kind: "blocked", reason: "Link scheme is not allowed" }

  try {
    const url = new URL(target.startsWith("//") ? `https:${target}` : target)

    return { kind: "external", url: url.href }
  } catch {
    return { kind: "blocked", reason: "Invalid external link" }
  }
}
