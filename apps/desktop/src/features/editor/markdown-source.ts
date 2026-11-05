import type { MarkdownDocument } from "@still-notes/notes/markdown"
import type { Nodes, PhrasingContent } from "mdast"

import { gfmToMarkdown } from "mdast-util-gfm"
import { mathToMarkdown } from "mdast-util-math"
import { toMarkdown } from "mdast-util-to-markdown"
import { decodeString } from "micromark-util-decode-string"
import { visit } from "unist-util-visit"

export const wikiLinkPrefix = "still-notes://wiki/"

function plainText(source: string) {
  return decodeString(source.replace(/\r\n?/g, "\n"))
}

export function nativeMarkdownSource(
  document: MarkdownDocument,
  node: Nodes,
  footnotes: ReadonlyMap<string, number>,
) {
  const copy = structuredClone(node)
  visit(copy, (child, index, parent) => {
    if (index === undefined || !parent) return

    switch (parent.type) {
      case "paragraph":
      case "heading":
      case "emphasis":
      case "strong":
      case "delete":
      case "tableCell":
        break
      case "blockquote":
      case "footnoteDefinition":
      case "link":
      case "linkReference":
      case "list":
      case "listItem":
      case "root":
      case "table":
      case "tableRow":
        return
    }

    if (child.type === "image" || child.type === "imageReference") {
      parent.children.splice(index, 1, { type: "text", value: "" })

      return index + 1
    }

    if (child.type === "footnoteReference") {
      const number = footnotes.get(child.identifier)

      if (number)
        parent.children.splice(index, 1, {
          type: "link",
          url: `#footnote-${encodeURIComponent(child.identifier)}`,
          children: [{ type: "text", value: String(number) }],
        })

      return index + 1
    }

    if (child.type !== "text") return
    const start = child.position?.start.offset
    const end = child.position?.end.offset

    if (start === undefined || end === undefined) return

    const links = document.links.filter(
      (link) => link.kind === "wiki" && link.start >= start && link.end <= end,
    )

    if (!links.length) return
    const parts: PhrasingContent[] = []
    let cursor = start

    for (const link of links) {
      if (link.start > cursor)
        parts.push({
          type: "text",
          value: plainText(document.source.slice(cursor, link.start)),
        })

      if (!link.embed)
        parts.push({
          type: "link",
          url: wikiLinkPrefix + encodeURIComponent(link.target),
          children: [{ type: "text", value: plainText(link.label) }],
        })
      cursor = link.end
    }

    if (cursor < end)
      parts.push({
        type: "text",
        value: plainText(document.source.slice(cursor, end)),
      })
    parent.children.splice(index, 1, ...parts)

    return index + parts.length
  })

  const printable: Nodes =
    copy.type === "tableCell"
      ? { type: "paragraph", children: copy.children }
      : copy

  return toMarkdown(printable, {
    extensions: [gfmToMarkdown(), mathToMarkdown()],
  }).trimEnd()
}
