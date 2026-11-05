import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from "node:fs"
import { basename, dirname } from "node:path"
import { z } from "zod"

import { sourceDateFormat } from "@/features/tasks/periodic"
import {
  readTaskFrontmatter,
  relativeServicePathSchema,
  resolveServicePath,
} from "@/features/tasks/service"
import { atomicWrite } from "@/platform/files"

const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(256),
  description: z.string().max(4096).default(""),
  category: z.enum(["Engineering", "Personal", "Custom"]).default("Custom"),
  body: z.string().max(2 * 1024 * 1024),
  titleTemplate: z.string().max(1024).optional(),
  targetDirectory: relativeServicePathSchema.optional(),
  builtinId: z
    .string()
    .regex(/^builtin:[a-z]+$/)
    .optional(),
})

export type TemplateInput = z.input<typeof templateInputSchema>

export interface NoteTemplate {
  id: string
  name: string
  description: string
  category: "Engineering" | "Personal" | "Custom"
  body: string
  titleTemplate?: string
  targetDirectory?: string
  builtinId?: string
  source: "builtin" | "custom" | "folder"
  sourcePath?: string
  raw?: string
}

export interface TemplateContext {
  title: string
  now?: Date
  locale?: string
  variables?: Record<string, string>
}

export interface RenderedTemplate {
  body: string
  cursorOffset: number | null
}

export function builtinTemplates(): NoteTemplate[] {
  const specs: {
    key: string
    name: string
    category: NoteTemplate["category"]
    headings: string[]
    titleTemplate?: string
  }[] = [
    {
      key: "adr",
      name: "Decision record",
      category: "Engineering",
      headings: ["Problem", "Options", "Decision", "Effects"],
    },
    {
      key: "rfc",
      name: "Design proposal",
      category: "Engineering",
      headings: ["Goal", "Design", "Alternatives", "Delivery plan"],
    },
    {
      key: "bug",
      name: "Bug report",
      category: "Engineering",
      headings: ["Environment", "Steps", "Expected result", "Actual result"],
    },
    {
      key: "postmortem",
      name: "Incident review",
      category: "Engineering",
      headings: ["Impact", "Events", "Cause", "Follow-up tasks"],
    },
    {
      key: "meeting",
      name: "Meeting notes",
      category: "Engineering",
      headings: ["Agenda", "Discussion", "Decisions", "Actions"],
      titleTemplate: "Meeting {{date}}",
    },
    {
      key: "oneonone",
      name: "One-to-one",
      category: "Engineering",
      headings: ["Progress", "Problems", "Support", "Next steps"],
      titleTemplate: "One-to-one {{date}}",
    },
    {
      key: "daily",
      name: "Daily note",
      category: "Personal",
      headings: ["Focus", "Schedule", "Notes", "Tasks"],
      titleTemplate: "{{date}}",
    },
    {
      key: "weekly",
      name: "Weekly review",
      category: "Personal",
      headings: ["Progress", "Lessons", "Next week", "Tasks"],
      titleTemplate: "{{date:RRRR}}-W{{week}}",
    },
    {
      key: "monthly",
      name: "Monthly review",
      category: "Personal",
      headings: ["Progress", "Review", "Next month", "Tasks"],
      titleTemplate: "{{date:yyyy-MM}}",
    },
    {
      key: "reading",
      name: "Reading notes",
      category: "Personal",
      headings: ["Source", "Ideas", "Quotes", "Conclusions"],
    },
    {
      key: "journal",
      name: "Journal",
      category: "Personal",
      headings: ["Entry"],
      titleTemplate: "{{date}}",
    },
    {
      key: "kickoff",
      name: "Project start",
      category: "Personal",
      headings: ["Goal", "Scope", "Milestones", "People", "Risks"],
    },
    {
      key: "todo",
      name: "Task list",
      category: "Personal",
      headings: ["Tasks"],
    },
  ]

  return specs.map(function template(spec) {
    return {
      id: `builtin:${spec.key}`,
      name: spec.name,
      description: spec.name,
      category: spec.category,
      titleTemplate: spec.titleTemplate,
      source: "builtin",
      body: `# {{title}}\n\nDate: {{date}}\n\n${spec.headings
        .map(function section(heading, index) {
          return `## ${heading}\n\n${index === 0 ? "{{cursor}}\n\n" : ""}${heading === "Tasks" || heading === "Actions" ? "- [ ] \n\n" : ""}`
        })
        .join("")}`,
    }
  })
}

export function renderTemplate(
  input: string,
  context: TemplateContext,
): RenderedTemplate {
  z.string().parse(input)
  const now = z.date().parse(context.now ?? new Date())

  const variables = z
    .record(z.string(), z.string())
    .parse(context.variables ?? {})

  let cursorOffset: number | null = null
  let body = ""
  let previous = 0

  for (const match of input.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    body += input.slice(previous, match.index)
    const token = (match[1] ?? "").trim()
    let value = match[0]

    if (token === "cursor") {
      cursorOffset ??= body.length
      value = ""
    } else if (token === "title") value = context.title
    else if (token === "date")
      value = sourceDateFormat(now, "yyyy-MM-dd", context.locale)
    else if (token === "time")
      value = sourceDateFormat(now, "HH:mm", context.locale)
    else if (token === "week")
      value = sourceDateFormat(now, "II", context.locale)
    else if (token.startsWith("date:"))
      value = sourceDateFormat(now, token.slice(5), context.locale)
    else if (!token.startsWith("modified_") && Object.hasOwn(variables, token))
      value = variables[token] ?? match[0]
    body += value
    previous = match.index + match[0].length
  }

  body += input.slice(previous)

  return { body, cursorOffset }
}

export function insertTemplate(
  body: string,
  selection: { from: number; to: number },
  template: NoteTemplate,
  context: TemplateContext,
) {
  const range = z
    .strictObject({
      from: z.number().int().min(0).max(body.length),
      to: z.number().int().min(0).max(body.length),
    })
    .refine(function ordered(value) {
      return value.from <= value.to
    })
    .parse(selection)

  const rendered = renderTemplate(template.body, context)

  return {
    body: body.slice(0, range.from) + rendered.body + body.slice(range.to),
    cursorOffset: range.from + (rendered.cursorOffset ?? rendered.body.length),
  }
}

export function createFromTemplate(
  template: NoteTemplate,
  context: TemplateContext,
) {
  const title = renderTemplate(
    template.titleTemplate ?? "{{title}}",
    context,
  ).body.trim()

  relativeServicePathSchema.parse(title)

  if (title.includes("/") || title.startsWith("."))
    throw new Error("Unsafe template title")

  if (template.targetDirectory)
    relativeServicePathSchema.parse(template.targetDirectory)
  const path = `${template.targetDirectory ? `${template.targetDirectory}/` : ""}${title}.md`
  relativeServicePathSchema.parse(path)

  return {
    path,
    title,
    ...renderTemplate(template.body, { ...context, title }),
  }
}

const preferencesSchema = z.strictObject({
  version: z.literal(1),
  hidden: z.array(z.string().regex(/^builtin:[a-z]+$/)).max(100),
})

const headerKeys = new Set([
  "name",
  "description",
  "category",
  "titletemplate",
  "targetdirectory",
  "targetfolder",
  "targetsubpath",
  "builtinid",
])

const sidecar = ".still-notes/templates"

const preferences = ".still-notes/templates.json"

const libraryOptionsSchema = z.strictObject({
  templateFolder: relativeServicePathSchema
    .refine(function visible(path) {
      return (
        path.length <= 512 &&
        path.split("/").every(function segment(part) {
          return !part.startsWith(".")
        })
      )
    })
    .optional(),
})

function parseTemplate(
  raw: string,
  sourcePath: string,
  folder?: string,
): NoteTemplate {
  const parsed = readTaskFrontmatter(raw)
  const keys = Object.keys(parsed.fields)

  const isHeader =
    !folder ||
    (keys.length > 0 &&
      keys.every(function known(key) {
        return headerKeys.has(key)
      }))

  const fields = isHeader ? parsed.fields : {}

  function value(key: string) {
    const item = fields[key]

    const text = Array.isArray(item) ? item[0] : item

    return text?.length ? text : undefined
  }

  const stem = basename(sourcePath).replace(/\.md$/i, "")
  const category = value("category")

  const rawDirectory =
    value("targetdirectory") ??
    [value("targetfolder"), value("targetsubpath")].filter(Boolean).join("/")

  const input = templateInputSchema.parse({
    name: value("name") ?? stem,
    description: value("description") ?? "",
    category:
      category === "Engineering" || category === "Personal"
        ? category
        : "Custom",
    body: isHeader ? raw.slice(parsed.end) : raw,
    titleTemplate: value("titletemplate"),
    targetDirectory: rawDirectory.length ? rawDirectory : undefined,
    builtinId: folder ? undefined : value("builtinid"),
  })

  return {
    ...input,
    id: folder
      ? `folder:${sourcePath.slice(folder.length + 1).replace(/\.md$/i, "")}`
      : `custom:${stem}`,
    source: folder ? "folder" : "custom",
    sourcePath,
    raw,
  }
}

function composeTemplate(input: z.output<typeof templateInputSchema>) {
  const fields = Object.entries({
    name: input.name,
    description: input.description,
    category: input.category,
    titleTemplate: input.titleTemplate,
    targetDirectory: input.targetDirectory,
    builtinId: input.builtinId,
  }).filter(function present(entry) {
    return entry[1] !== undefined
  })

  return `---\n${fields
    .map(function line([key, value]) {
      return `${key}: ${JSON.stringify(value)}`
    })
    .join("\n")}\n---\n${input.body}`
}

export class TemplateLibrary {
  private readonly options: z.output<typeof libraryOptionsSchema>
  constructor(
    private readonly root: string,
    options: z.input<typeof libraryOptionsSchema> = {},
  ) {
    this.options = libraryOptionsSchema.parse(options)
    resolveServicePath(root, preferences)
  }
  isTemplatePath(path: string) {
    relativeServicePathSchema.parse(path)
    const folder = this.options.templateFolder

    return (
      path.startsWith(`${sidecar}/`) ||
      Boolean(folder && path.startsWith(`${folder}/`))
    )
  }
  private state() {
    const path = resolveServicePath(this.root, preferences)

    return existsSync(path)
      ? preferencesSchema.parse(JSON.parse(readFileSync(path, "utf8")))
      : { version: 1 as const, hidden: [] }
  }
  private files(
    directory: string,
    recursive: boolean,
  ): { path: string; raw: string }[] {
    const absolute = resolveServicePath(this.root, directory)

    if (!existsSync(absolute)) return []

    if (!lstatSync(absolute).isDirectory())
      throw new Error("Template directory is not a directory")
    const result: { path: string; raw: string }[] = []

    for (const name of readdirSync(absolute).sort()) {
      if (name.startsWith(".")) continue
      const relative = `${directory}/${name}`
      const path = resolveServicePath(this.root, relative)
      const stat = lstatSync(path)

      if (stat.isDirectory() && recursive)
        result.push(...this.files(relative, true))
      else if (stat.isFile() && /\.md$/i.test(name)) {
        if (stat.size > 2 * 1024 * 1024)
          throw new Error("Template file is too large")
        result.push({ path: relative, raw: readFileSync(path, "utf8") })
      }
    }

    return result
  }
  list(options: { includeHidden?: boolean } = {}) {
    const state = this.state()
    const hidden = new Set(state.hidden)

    const custom = this.files(sidecar, false).map(function template(file) {
      return parseTemplate(file.raw, file.path)
    })

    const folder = this.options.templateFolder

    const folderTemplates = folder
      ? this.files(folder, true).map(function template(file) {
          return parseTemplate(file.raw, file.path, folder)
        })
      : []

    const overrides = new Set(
      custom
        .map(function overridden(template) {
          return template.builtinId
        })
        .filter(Boolean),
    )

    const builtins = builtinTemplates().filter(function visible(template) {
      return !overrides.has(template.id)
    })

    const ranks = { Engineering: 0, Personal: 1, Custom: 2 }
    const sourceRanks = { builtin: 0, custom: 1, folder: 2 }

    return [...builtins, ...custom, ...folderTemplates]
      .filter(function visible(template) {
        return (
          options.includeHidden === true ||
          !hidden.has(template.builtinId ?? template.id)
        )
      })
      .sort(function compare(left, right) {
        return (
          ranks[left.category] - ranks[right.category] ||
          sourceRanks[left.source] - sourceRanks[right.source] ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id)
        )
      })
  }
  find(id: string) {
    return this.list().find(function same(template) {
      return template.id === id || template.builtinId === id
    })
  }
  private locked<T>(operation: () => T): T {
    const path = resolveServicePath(
      this.root,
      ".still-notes/templates.lock",
      true,
    )

    const fd = openSync(path, "wx", 0o600)

    try {
      return operation()
    } finally {
      closeSync(fd)
      unlinkSync(path)
    }
  }
  save(
    input: TemplateInput,
    previous?: { sourcePath: string; expectedRaw: string },
  ) {
    const value = templateInputSchema.parse(input)

    if (
      value.builtinId &&
      !builtinTemplates().some(function same(template) {
        return template.id === value.builtinId
      })
    )
      throw new Error("Unknown built-in template")
    const raw = composeTemplate(value)

    return this.locked(() => {
      let relative: string

      if (previous) {
        relative = previous.sourcePath

        if (
          !relative.startsWith(`${sidecar}/`) ||
          relative.slice(sidecar.length + 1).includes("/") ||
          !relative.endsWith(".md")
        )
          throw new Error("Only sidecar templates can be edited here")
        const path = resolveServicePath(this.root, relative)

        if (readFileSync(path, "utf8") !== previous.expectedRaw)
          throw new Error("Template source changed")
      } else {
        if (
          value.builtinId &&
          this.list({ includeHidden: true }).some(function same(template) {
            return template.builtinId === value.builtinId
          })
        )
          throw new Error("Template override exists; edit its current source")

        const slug =
          value.name
            .toLowerCase()
            .replace(/[^\p{L}\d]+/gu, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 80) || "template"

        let counter = 1
        relative = `${sidecar}/${slug}.md`

        while (existsSync(resolveServicePath(this.root, relative, true))) {
          counter += 1
          relative = `${sidecar}/${slug}-${counter}.md`
        }
      }

      const path = resolveServicePath(this.root, relative, true)
      atomicWrite(path, raw, dirname(path))

      return parseTemplate(raw, relative)
    })
  }
  remove(sourcePath: string, expectedRaw: string) {
    return this.locked(() => {
      if (
        !sourcePath.startsWith(`${sidecar}/`) ||
        sourcePath.slice(sidecar.length + 1).includes("/") ||
        !sourcePath.endsWith(".md")
      )
        throw new Error("Only sidecar templates can be removed here")
      const path = resolveServicePath(this.root, sourcePath)

      if (readFileSync(path, "utf8") !== expectedRaw)
        throw new Error("Template source changed")
      unlinkSync(path)
    })
  }
  setHidden(id: string, hidden: boolean) {
    if (
      !builtinTemplates().some(function same(template) {
        return template.id === id
      })
    )
      throw new Error("Unknown built-in template")
    this.locked(() => {
      const state = this.state()
      const ids = new Set(state.hidden)

      if (hidden) ids.add(id)
      else ids.delete(id)
      const path = resolveServicePath(this.root, preferences, true)
      atomicWrite(
        path,
        JSON.stringify({ version: 1, hidden: [...ids] }),
        dirname(path),
      )
    })
  }
  resetBuiltin(id: string) {
    if (
      !builtinTemplates().some(function same(template) {
        return template.id === id
      })
    )
      throw new Error("Unknown built-in template")
    this.locked(() => {
      for (const file of this.files(sidecar, false))
        if (parseTemplate(file.raw, file.path).builtinId === id)
          unlinkSync(resolveServicePath(this.root, file.path))
      const state = this.state()
      const path = resolveServicePath(this.root, preferences, true)
      atomicWrite(
        path,
        JSON.stringify({
          version: 1,
          hidden: state.hidden.filter(function other(value) {
            return value !== id
          }),
        }),
        dirname(path),
      )
    })
  }
}
