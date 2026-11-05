import { DateTime, Effect, Schema } from "effect"
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

import { sourceDateFormat } from "@/features/tasks/periodic"
import {
  readTaskFrontmatter,
  relativeServicePathSchema,
  resolveServicePath,
} from "@/features/tasks/service"
import { TemplateError, templateIO } from "@/features/templates/errors"
import { atomicWrite } from "@/platform/files"

const templateInputSchema = Schema.Struct({
  name: Schema.Trim.check(Schema.isBetweenLength(1, 256)),
  description: Schema.String.check(Schema.isMaxLength(4096)).pipe(
    Schema.withDecodingDefault(Effect.succeed("")),
  ),
  category: Schema.Literals(["Engineering", "Personal", "Custom"]).pipe(
    Schema.withDecodingDefault(Effect.succeed("Custom")),
  ),
  body: Schema.String.check(Schema.isMaxLength(2 * 1024 * 1024)),
  titleTemplate: Schema.optional(Schema.String.check(Schema.isMaxLength(1024))),
  targetDirectory: Schema.optional(relativeServicePathSchema),
  builtinId: Schema.optional(
    Schema.String.check(Schema.isPattern(/^builtin:[a-z]+$/)),
  ),
})

export type TemplateInput = typeof templateInputSchema.Encoded

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
  Schema.decodeUnknownSync(Schema.String)(input)

  const now = Schema.decodeUnknownSync(Schema.Date)(
    context.now ?? DateTime.toDateUtc(DateTime.nowUnsafe()),
  )

  const variables = Schema.decodeUnknownSync(
    Schema.Record(Schema.String, Schema.String),
  )(context.variables ?? {})

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
  const range = Schema.decodeUnknownSync(
    Schema.Struct({
      from: Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: body.length }),
      ),
      to: Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: body.length }),
      ),
    }).check(
      Schema.makeFilter(function ordered(value) {
        return value.from <= value.to
      }),
    ),
    { onExcessProperty: "error" },
  )(selection)

  const rendered = renderTemplate(template.body, context)

  return {
    body: body.slice(0, range.from) + rendered.body + body.slice(range.to),
    cursorOffset: range.from + (rendered.cursorOffset ?? rendered.body.length),
  }
}

export const createFromTemplate = Effect.fn("createFromTemplate")(function* (
  template: NoteTemplate,
  context: TemplateContext,
) {
  const now = context.now ?? (yield* DateTime.nowAsDate)
  const renderContext = { ...context, now }

  const renderedTitle = yield* templateIO("render", () =>
    renderTemplate(template.titleTemplate ?? "{{title}}", renderContext),
  )

  const title = renderedTitle.body.trim()
  yield* Schema.decodeUnknownEffect(relativeServicePathSchema)(title)

  if (title.includes("/") || title.startsWith("."))
    return yield* new TemplateError({
      operation: "render",
      message: "Unsafe template title",
    })

  if (template.targetDirectory)
    yield* Schema.decodeUnknownEffect(relativeServicePathSchema)(
      template.targetDirectory,
    )
  const path = `${template.targetDirectory ? `${template.targetDirectory}/` : ""}${title}.md`
  yield* Schema.decodeUnknownEffect(relativeServicePathSchema)(path)

  const rendered = yield* templateIO("render", () =>
    renderTemplate(template.body, { ...renderContext, title }),
  )

  return { path, title, ...rendered }
})

const preferencesSchema = Schema.Struct({
  version: Schema.Literal(1),
  hidden: Schema.Array(
    Schema.String.check(Schema.isPattern(/^builtin:[a-z]+$/)),
  ).check(Schema.isMaxLength(100)),
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

const libraryOptionsSchema = Schema.Struct({
  templateFolder: Schema.optional(
    relativeServicePathSchema.check(
      Schema.makeFilter(function visible(path) {
        return (
          path.length <= 512 &&
          path.split("/").every(function segment(part) {
            return !part.startsWith(".")
          })
        )
      }),
    ),
  ),
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

  const input = Schema.decodeUnknownSync(templateInputSchema)({
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

function composeTemplate(input: typeof templateInputSchema.Type) {
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
  private readonly options: typeof libraryOptionsSchema.Type
  constructor(
    private readonly root: string,
    options: typeof libraryOptionsSchema.Encoded = {},
  ) {
    this.options = Schema.decodeUnknownSync(libraryOptionsSchema, {
      onExcessProperty: "error",
    })(options)
    resolveServicePath(root, preferences)
  }
  isTemplatePath(path: string) {
    Schema.decodeUnknownSync(relativeServicePathSchema)(path)
    const folder = this.options.templateFolder

    return (
      path.startsWith(`${sidecar}/`) ||
      Boolean(folder && path.startsWith(`${folder}/`))
    )
  }
  private state() {
    const path = resolveServicePath(this.root, preferences)

    return existsSync(path)
      ? Schema.decodeUnknownSync(Schema.fromJsonString(preferencesSchema), {
          onExcessProperty: "error",
        })(readFileSync(path, "utf8"))
      : { version: 1 as const, hidden: [] }
  }
  private files(
    directory: string,
    recursive: boolean,
  ): { path: string; raw: string }[] {
    const absolute = resolveServicePath(this.root, directory)

    if (!existsSync(absolute)) return []

    if (!lstatSync(absolute).isDirectory())
      throw new TemplateError({
        operation: "read",
        message: "Template directory is not a directory",
      })
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
          throw new TemplateError({
            operation: "read",
            message: "Template file is too large",
          })
        result.push({ path: relative, raw: readFileSync(path, "utf8") })
      }
    }

    return result
  }
  list = Effect.fn("TemplateLibrary.list")(function* (
    this: TemplateLibrary,
    options: { includeHidden?: boolean } = {},
  ) {
    const state = yield* templateIO("read", () => this.state())
    const hidden = new Set(state.hidden)

    const custom = yield* templateIO("read", () =>
      this.files(sidecar, false).map(function template(file) {
        return parseTemplate(file.raw, file.path)
      }),
    )

    const folder = this.options.templateFolder

    const folderTemplates = folder
      ? yield* templateIO("read", () =>
          this.files(folder, true).map(function template(file) {
            return parseTemplate(file.raw, file.path, folder)
          }),
        )
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
  })
  find = Effect.fn("TemplateLibrary.find")(function* (
    this: TemplateLibrary,
    id: string,
  ) {
    const templates = yield* this.list()

    return templates.find(function same(template) {
      return template.id === id || template.builtinId === id
    })
  })
  private locked<A, E, R>(operation: Effect.Effect<A, E, R>) {
    const root = this.root

    // Keep lock cleanup failures in the typed error channel.
    return Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const lock = yield* templateIO("lock", () => {
          const path = resolveServicePath(
            root,
            ".still-notes/templates.lock",
            true,
          )

          return { path, fd: openSync(path, "wx", 0o600) }
        })

        const result = yield* Effect.exit(restore(operation))
        yield* templateIO("lock", () => {
          try {
            closeSync(lock.fd)
          } finally {
            unlinkSync(lock.path)
          }
        })

        return yield* result
      }),
    )
  }
  save = Effect.fn("TemplateLibrary.save")(function* (
    this: TemplateLibrary,
    input: TemplateInput,
    previous?: { sourcePath: string; expectedRaw: string },
  ) {
    const value = yield* Schema.decodeUnknownEffect(templateInputSchema)(input)

    if (
      value.builtinId &&
      !builtinTemplates().some(function same(template) {
        return template.id === value.builtinId
      })
    )
      return yield* new TemplateError({
        operation: "write",
        message: "Unknown built-in template",
      })
    const raw = composeTemplate(value)

    const root = this.root
    const templates = this.list({ includeHidden: true })

    return yield* this.locked(
      Effect.gen(function* () {
        let relative: string

        if (previous) {
          relative = previous.sourcePath

          if (
            !relative.startsWith(`${sidecar}/`) ||
            relative.slice(sidecar.length + 1).includes("/") ||
            !relative.endsWith(".md")
          )
            return yield* new TemplateError({
              operation: "write",
              message: "Only sidecar templates can be edited here",
            })

          const current = yield* templateIO("read", () =>
            readFileSync(resolveServicePath(root, relative), "utf8"),
          )

          if (current !== previous.expectedRaw)
            return yield* new TemplateError({
              operation: "write",
              message: "Template source changed",
            })
        } else {
          if (
            value.builtinId &&
            (yield* templates).some(function same(template) {
              return template.builtinId === value.builtinId
            })
          )
            return yield* new TemplateError({
              operation: "write",
              message: "Template override exists; edit its current source",
            })

          const slug =
            value.name
              .toLowerCase()
              .replace(/[^\p{L}\d]+/gu, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 80) || "template"

          let counter = 1
          relative = `${sidecar}/${slug}.md`

          while (
            yield* templateIO("read", () =>
              existsSync(resolveServicePath(root, relative, true)),
            )
          ) {
            counter += 1
            relative = `${sidecar}/${slug}-${counter}.md`
          }
        }

        return yield* templateIO("write", () => {
          const path = resolveServicePath(root, relative, true)
          atomicWrite(path, raw, dirname(path))

          return parseTemplate(raw, relative)
        })
      }),
    )
  })
  remove(sourcePath: string, expectedRaw: string) {
    return this.locked(
      templateIO("write", () => {
        if (
          !sourcePath.startsWith(`${sidecar}/`) ||
          sourcePath.slice(sidecar.length + 1).includes("/") ||
          !sourcePath.endsWith(".md")
        )
          throw new TemplateError({
            operation: "write",
            message: "Only sidecar templates can be removed here",
          })
        const path = resolveServicePath(this.root, sourcePath)

        if (readFileSync(path, "utf8") !== expectedRaw)
          throw new TemplateError({
            operation: "write",
            message: "Template source changed",
          })
        unlinkSync(path)
      }),
    )
  }
  setHidden = Effect.fn("TemplateLibrary.setHidden")(function* (
    this: TemplateLibrary,
    id: string,
    hidden: boolean,
  ) {
    if (
      !builtinTemplates().some(function same(template) {
        return template.id === id
      })
    )
      return yield* new TemplateError({
        operation: "write",
        message: "Unknown built-in template",
      })
    yield* this.locked(
      templateIO("write", () => {
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
      }),
    )
  })
  resetBuiltin = Effect.fn("TemplateLibrary.resetBuiltin")(function* (
    this: TemplateLibrary,
    id: string,
  ) {
    if (
      !builtinTemplates().some(function same(template) {
        return template.id === id
      })
    )
      return yield* new TemplateError({
        operation: "write",
        message: "Unknown built-in template",
      })
    yield* this.locked(
      templateIO("write", () => {
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
      }),
    )
  })
}
