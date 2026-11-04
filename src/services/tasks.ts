import { createHash } from "node:crypto"
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
} from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { z } from "zod"

import { atomicWrite } from "@/utils/files"

export const relativeServicePathSchema = z
  .string()
  .min(1)
  .max(2048)
  .refine(function safe(value) {
    return (
      !isAbsolute(value) &&
      !/[\\:\p{Cc}<>"|?*]/u.test(value) &&
      value.split("/").every(function segment(part) {
        return (
          part.length > 0 &&
          part !== "." &&
          part !== ".." &&
          part.trim() === part &&
          !part.endsWith(".") &&
          Buffer.byteLength(part) <= 210 &&
          !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
        )
      })
    )
  }, "Unsafe relative path")

export function resolveServicePath(
  root: string,
  relative: string,
  createParents = false,
) {
  relativeServicePathSchema.parse(relative)
  const base = resolve(root)

  if (realpathSync(base) !== base || !lstatSync(base).isDirectory())
    throw new Error("Unsafe service root")
  const parts = relative.split("/")
  let current = base

  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index] ?? "")
    const last = index === parts.length - 1

    try {
      const stat = lstatSync(current)

      if (stat.isSymbolicLink() || (!last && !stat.isDirectory()))
        throw new Error("Unsafe service path")
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error

      if (!last && createParents) mkdirSync(current, { mode: 0o700 })
    }
  }

  return current
}

export const taskDateSchema = z.iso.date()

const noteSchema = z.object({
  path: relativeServicePathSchema,
  title: z.string(),
  body: z.string().max(8 * 1024 * 1024),
  archived: z.boolean().optional(),
  trashed: z.boolean().optional(),
})

export type TaskNote = z.infer<typeof noteSchema>

export type TaskState =
  | "open"
  | "done"
  | "forwarded"
  | "cancelled"
  | "in-progress"
  | "waiting"

export type TaskPriority = "high" | "med" | "low"

export interface Task {
  id: string
  kind: "checkbox" | "note"
  sourcePath: string
  noteTitle: string
  sourceHash: string
  line: number
  index: number
  start: number
  end: number
  subtreeEnd: number
  checkboxOffset?: number
  rawText: string
  content: string
  state: TaskState
  status?: string
  due?: string
  scheduled?: string
  completed?: string
  priority?: TaskPriority
  tags: string[]
  fields: Record<string, string>
  parentId?: string
  dueInferred?: boolean
  archived?: boolean
  trashed?: boolean
}

function digest(body: string) {
  return createHash("sha256").update(body).digest("hex")
}

function unquote(value: string) {
  const clean = value.trim()

  if (clean.startsWith('"') && clean.endsWith('"')) {
    try {
      return z.string().parse(JSON.parse(clean))
    } catch {
      return clean.slice(1, -1)
    }
  }

  if (clean.startsWith("'") && clean.endsWith("'"))
    return clean.slice(1, -1).replace(/''/g, "'")

  return clean.replace(/[ \t]+#.*$/, "").trim()
}

export function readTaskFrontmatter(body: string) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(body)
  const fields: Record<string, string | string[]> = {}

  if (!match) return { fields, end: 0 }
  let listKey: string | undefined

  for (const line of (match[1] ?? "").split(/\r?\n/)) {
    const pair = /^([a-z][\w-]*):[ \t]*(.*)$/i.exec(line)

    if (pair) {
      const key = (pair[1] ?? "").toLowerCase()
      const value = pair[2] ?? ""
      listKey = value.trim() ? undefined : key

      if (value.trim().startsWith("[") && value.trim().endsWith("]"))
        fields[key] = value
          .trim()
          .slice(1, -1)
          .split(",")
          .map(unquote)
          .filter(Boolean)
      else fields[key] = unquote(value)
    } else if (listKey) {
      const item = /^[ \t]+-[ \t]+(.+)$/.exec(line)

      if (item) {
        const prior = fields[listKey]
        fields[listKey] = [
          ...(Array.isArray(prior) ? prior : []),
          unquote(item[1] ?? ""),
        ]
      }
    }
  }

  return { fields, end: match[0].length }
}

function scalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function dateValue(value: string | undefined) {
  return taskDateSchema.safeParse(value).success ? value : undefined
}

function priorityValue(value: string | undefined): TaskPriority | undefined {
  const normalized = value?.toLowerCase()

  if (normalized && ["high", "h"].includes(normalized)) return "high"

  if (normalized && ["medium", "med", "normal", "m"].includes(normalized))
    return "med"

  if (normalized && ["low", "l"].includes(normalized)) return "low"

  return undefined
}

function stateOf(status: string | undefined): TaskState {
  if (status && ["done", "complete", "completed", "x"].includes(status))
    return "done"

  if (status && ["cancelled", "canceled"].includes(status)) return "cancelled"

  if (
    status &&
    [
      "in-progress",
      "in progress",
      "inprogress",
      "doing",
      "started",
      "wip",
    ].includes(status)
  )
    return "in-progress"

  if (status === "forwarded") return "forwarded"

  return status === "waiting" ? "waiting" : "open"
}

function columns(text: string) {
  let width = 0

  for (const character of text)
    width += character === "\t" ? 4 - (width % 4) : 1

  return width
}

function maskInline(text: string) {
  return text.replace(/(`+)[\s\S]*?\1(?!`)/g, function mask(value) {
    return " ".repeat(value.length)
  })
}

interface Token {
  key: string
  value: string
  start: number
  end: number
}

function tokens(text: string): Token[] {
  const output: Token[] = []

  const masked = maskInline(text).replace(
    /<!--.*?(?:-->|$)/g,
    function mask(value) {
      return " ".repeat(value.length)
    },
  )

  const expression =
    /(^|[ \t])(?:(due|scheduled|completed(?:date)?):[ \t]*(\S+)|!([a-z]+)\b|@waiting\b|@([a-z][\w-]*):([\p{L}\d][\p{L}\d/_-]*))/giu

  for (const match of masked.matchAll(expression)) {
    const key =
      match[2]?.toLowerCase().replace("completeddate", "completed") ??
      (match[4] ? "priority" : (match[5]?.toLowerCase() ?? "waiting"))

    output.push({
      key,
      value: match[3] ?? match[4] ?? match[6] ?? "true",
      start: match.index + (match[1]?.length ?? 0),
      end: match.index + match[0].length,
    })
  }

  return output
}

export function parseTasks(
  note: TaskNote,
  options: { includeExcluded?: boolean } = {},
): Task[] {
  noteSchema.parse(note)
  const frontmatter = readTaskFrontmatter(note.body)
  const defaults = frontmatter.fields
  const mode = scalar(defaults.tasks)?.toLowerCase()

  if ((mode === "false" || mode === "off") && !options.includeExcluded)
    return []
  const sourceHash = digest(note.body)

  const base = {
    sourcePath: note.path,
    noteTitle: note.title,
    sourceHash,
    archived: note.archived,
    trashed: note.trashed,
  }

  const result: Task[] = []
  const rawTags = defaults.tags

  const tags = (
    Array.isArray(rawTags) ? rawTags : (rawTags ?? "").split(/[,\s]+/)
  )
    .map(function tag(value) {
      return value.replace(/^#/, "").toLowerCase()
    })
    .filter(Boolean)

  const noteStatus = scalar(defaults.status)?.toLowerCase()
  const due = dateValue(scalar(defaults.due))
  const priority = priorityValue(scalar(defaults.priority))

  const noteFields = Object.fromEntries(
    Object.entries(defaults)
      .filter(function field(entry) {
        return !Array.isArray(entry[1])
      })
      .map(function entry([key, value]) {
        return [key, scalar(value) ?? ""]
      }),
  )

  if (noteStatus) noteFields.status = noteStatus

  if (tags.includes("task"))
    result.push({
      ...base,
      id: `${note.path}#task`,
      kind: "note",
      line: 0,
      index: -1,
      start: 0,
      end: frontmatter.end,
      subtreeEnd: note.body.length,
      rawText: note.body.slice(0, frontmatter.end),
      content: scalar(defaults.title) ?? note.title,
      state: stateOf(noteStatus),
      status: noteStatus,
      due,
      scheduled: dateValue(scalar(defaults.scheduled)),
      completed: dateValue(
        scalar(defaults.completeddate) ?? scalar(defaults.completed),
      ),
      priority,
      tags: tags.filter(function tag(value) {
        return value !== "task"
      }),
      fields: noteFields,
    })

  if (mode === "note" && !options.includeExcluded) return result
  const fileTask = result[0]

  const stack: {
    indent: number
    contentColumn: number
    quote: number
    task?: Task
  }[] = []

  let offset = 0
  let lineNumber = 0
  let fence: { marker: string; length: number; quote: number } | undefined
  let comment = false
  let index = 0
  let blank = true
  let indentedCode = false

  for (const raw of note.body.matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!raw[0]) continue
    const line = raw[0].replace(/\r?\n$|\r$/, "")
    const start = offset
    offset += raw[0].length
    const currentLine = lineNumber++

    if (start < frontmatter.end) continue

    if (fence) {
      const quoted = /^(?:[ \t]*>[ \t]?)+/.exec(line)?.[0] ?? ""

      const closing = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(
        line.slice(quoted.length),
      )

      if (
        closing &&
        (quoted.match(/>/g) ?? []).length === fence.quote &&
        closing[1]?.[0] === fence.marker &&
        (closing[1]?.length ?? 0) >= fence.length
      )
        fence = undefined
      continue
    }

    let visible = ""

    for (let position = 0; position < line.length;) {
      if (!comment && line.startsWith("<!--", position)) comment = true

      if (comment) {
        if (line.startsWith("-->", position)) {
          visible += "   "
          position += 3
          comment = false
        } else {
          visible += " "
          position += 1
        }
      } else {
        visible += line[position]
        position += 1
      }
    }

    const quotes = /^(?:[ \t]*>[ \t]?)+/.exec(visible)?.[0] ?? ""
    const quote = (quotes.match(/>/g) ?? []).length
    const rest = visible.slice(quotes.length)
    const fenceMatch = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(rest)

    const indent = columns(/^[ \t]*/.exec(rest)?.[0] ?? "")

    if (!rest.trim()) {
      blank = true

      continue
    }

    const item = /^([ \t]*)([-+*]|\d{1,9}[.)])([ \t]+)(.*)$/.exec(rest)

    const paragraphContinues =
      !blank &&
      !indentedCode &&
      !item &&
      !fenceMatch &&
      !/^\s*(?:#{1,6}(?:\s|$)|>|<|[-*_]{3,}|=+$)/.test(rest)

    while (
      !paragraphContinues &&
      stack.length &&
      (stack.at(-1)?.quote !== quote ||
        indent < (stack.at(-1)?.contentColumn ?? 0))
    ) {
      const removed = stack.pop()

      if (removed?.task) removed.task.subtreeEnd = start
    }

    const owner = stack.at(-1)

    if (
      indent >= (owner?.contentColumn ?? 0) + 4 &&
      (blank || indentedCode || !owner)
    ) {
      indentedCode = true
      continue
    }

    indentedCode = false

    if (fenceMatch) {
      fence = {
        marker: fenceMatch[1]?.[0] ?? "`",
        length: fenceMatch[1]?.length ?? 3,
        quote,
      }
      blank = true
      continue
    }

    if (!item) {
      blank = false
      continue
    }

    const tail = item[4] ?? ""
    const checkbox = /^\[([ xX>\-/])\](?:[ \t]+|$)/.exec(tail)
    let task: Task | undefined

    if (checkbox) {
      const tailStart =
        quotes.length +
        (item[1]?.length ?? 0) +
        (item[2]?.length ?? 0) +
        (item[3]?.length ?? 0)

      const taskTokens = tokens(line.slice(tailStart + 3))
      const fields: Record<string, string> = {}

      for (const token of taskTokens)
        if (!Object.hasOwn(fields, token.key))
          fields[token.key] = token.value.toLowerCase()

      const allFields = Object.fromEntries(
        Object.entries(fields).filter(function field([key]) {
          return ![
            "due",
            "scheduled",
            "completed",
            "priority",
            "waiting",
          ].includes(key)
        }),
      )

      if (noteStatus && !allFields.status) allFields.status = noteStatus
      const status = allFields.status
      const marker = checkbox[1]

      const state: TaskState =
        marker === "x" || marker === "X"
          ? "done"
          : marker === ">"
            ? "forwarded"
            : marker === "-"
              ? "cancelled"
              : marker === "/"
                ? "in-progress"
                : fields.waiting
                  ? "waiting"
                  : "open"

      let content = line.slice(tailStart + 3)

      for (const token of [...taskTokens].reverse())
        content = content.slice(0, token.start) + content.slice(token.end)
      content = content
        .replace(/<!--.*?(?:-->|$)/g, "")
        .replace(/[ \t]+/g, " ")
        .trim()
      const cleanTail = maskInline(tail)

      const inlineTags = [
        ...cleanTail.matchAll(/(?:^|\s)#([\p{L}\d][\p{L}\d/_-]*)/gu),
      ].map(function tag(match) {
        return (match[1] ?? "").toLowerCase()
      })

      task = {
        ...base,
        id: `${note.path}#${index}`,
        kind: "checkbox",
        index: index++,
        line: currentLine,
        start,
        end: start + line.length,
        subtreeEnd: note.body.length,
        checkboxOffset: start + tailStart + 1,
        rawText: line,
        content,
        state,
        status,
        due: dateValue(fields.due) ?? due,
        scheduled: dateValue(fields.scheduled),
        completed: dateValue(fields.completed),
        priority: priorityValue(fields.priority) ?? priority,
        tags: [...new Set(inlineTags)],
        fields: allFields,
        parentId: owner?.task?.id ?? (!owner ? fileTask?.id : undefined),
      }
      result.push(task)
    }

    const markerWidth = columns(`${item[1]}${item[2]}${item[3]}`)
    stack.push({ indent, contentColumn: markerWidth, quote, task })
    blank = false
  }

  return result
}

export function taskProgress(tasks: readonly Task[], parentId: string) {
  const children = tasks.filter(function child(task) {
    return task.parentId === parentId
  })

  const done = children.filter(function complete(task) {
    return task.state === "done"
  }).length

  return {
    total: children.length,
    done,
    fraction: children.length ? done / children.length : 0,
  }
}

export interface TaskFilter {
  query?: string
  states?: TaskState[]
  status?: string[]
  tags?: string[]
  fields?: Record<string, string>
  folders?: string[]
  excludeFolders?: string[]
  showArchived?: boolean
  hideEmpty?: boolean
  rootsOnly?: boolean
  dueFrom?: string
  dueTo?: string
  sort?: "note" | "manual" | "due" | "priority"
  manualOrder?: string[]
}

function inFolder(path: string, folder: string) {
  return path === folder || path.startsWith(`${folder}/`)
}

export function selectTasks(tasks: readonly Task[], filter: TaskFilter = {}) {
  for (const folder of [
    ...(filter.folders ?? []),
    ...(filter.excludeFolders ?? []),
  ])
    relativeServicePathSchema.parse(folder)

  if (filter.dueFrom) taskDateSchema.parse(filter.dueFrom)

  if (filter.dueTo) taskDateSchema.parse(filter.dueTo)
  const ranks = { high: 0, med: 1, low: 2 }

  const order = new Map(
    (filter.manualOrder ?? []).map(function entry(id, index) {
      return [id, index]
    }),
  )

  const states = filter.states ? new Set(filter.states) : undefined
  const statuses = filter.status ? new Set(filter.status) : undefined

  return tasks
    .filter(function include(task) {
      return (
        !task.trashed &&
        (filter.showArchived === true || !task.archived) &&
        (!filter.hideEmpty || task.content.trim().length > 0) &&
        (!filter.rootsOnly || !task.parentId) &&
        (!filter.query?.length ||
          `${task.content} ${task.noteTitle}`
            .toLowerCase()
            .includes(filter.query.toLowerCase())) &&
        (!states || states.has(task.state)) &&
        (!statuses || statuses.has(task.status ?? "")) &&
        (!filter.tags ||
          filter.tags.every(function tag(value) {
            return task.tags.includes(value.toLowerCase())
          })) &&
        (!filter.fields ||
          Object.entries(filter.fields).every(function field([key, value]) {
            return task.fields[key] === value
          })) &&
        (!filter.folders ||
          filter.folders.some(function folder(value) {
            return inFolder(task.sourcePath, value)
          })) &&
        !filter.excludeFolders?.some(function folder(value) {
          return inFolder(task.sourcePath, value)
        }) &&
        (!filter.dueFrom || Boolean(task.due && task.due >= filter.dueFrom)) &&
        (!filter.dueTo || Boolean(task.due && task.due <= filter.dueTo))
      )
    })
    .sort(function compare(left, right) {
      const due = (left.due ?? "9999-99-99").localeCompare(
        right.due ?? "9999-99-99",
      )

      const priority =
        (left.priority ? ranks[left.priority] : 3) -
        (right.priority ? ranks[right.priority] : 3)

      if (filter.sort === "manual") {
        const rank =
          (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)

        if (rank) return rank
      }

      if (filter.sort === "due" && due) return due

      if (filter.sort === "priority" && (priority || due))
        return priority || due

      return (
        left.sourcePath.localeCompare(right.sourcePath) ||
        left.index - right.index
      )
    })
}

export function bucketTasks(tasks: readonly Task[], field = "due") {
  const groups = new Map<string, Task[]>()

  for (const task of tasks) {
    if (
      field === "due" &&
      (task.state === "done" ||
        task.state === "cancelled" ||
        (task.state === "forwarded" && !task.due))
    )
      continue

    const key =
      field === "due"
        ? (task.due ?? "unscheduled")
        : field === "state"
          ? task.state
          : (task.fields[field] ?? "")

    groups.set(key, [...(groups.get(key) ?? []), task])
  }

  return groups
}

const fieldKeySchema = z.string().regex(/^[a-z][\w-]*$/i)

const fieldValueSchema = z.string().regex(/^[\p{L}\d][\p{L}\d/_-]*$/u)

const patchSchema = z.strictObject({
  state: z
    .enum(["open", "done", "forwarded", "cancelled", "in-progress", "waiting"])
    .optional(),
  status: fieldValueSchema.nullable().optional(),
  due: taskDateSchema.nullable().optional(),
  scheduled: taskDateSchema.nullable().optional(),
  completed: taskDateSchema.nullable().optional(),
  priority: z.enum(["high", "med", "low"]).nullable().optional(),
  fields: z.record(fieldKeySchema, fieldValueSchema.nullable()).optional(),
})

export type TaskPatch = z.infer<typeof patchSchema>

function checkedSource(note: TaskNote, task: Task) {
  noteSchema.parse(note)

  if (note.path !== task.sourcePath || digest(note.body) !== task.sourceHash)
    throw new Error("Task source changed; rescan before editing")

  const actual = parseTasks(note, { includeExcluded: true }).find(
    function same(value) {
      return value.id === task.id
    },
  )

  if (!actual || actual.rawText !== task.rawText || actual.start !== task.start)
    throw new Error("Task source changed; rescan before editing")
}

function replaceRange(text: string, start: number, end: number, value: string) {
  return text.slice(0, start) + value + text.slice(end)
}

function inlineEdit(line: string, key: string, value: string | null) {
  const found = tokens(line).filter(function same(token) {
    return token.key === key
  })

  const token =
    value === null
      ? ""
      : key === "priority"
        ? `!${value}`
        : key === "waiting"
          ? "@waiting"
          : ["due", "scheduled", "completed"].includes(key)
            ? `${key}:${value}`
            : `@${key}:${value}`

  if (!found.length) {
    if (!token) return line
    const trailing = /[ \t]*$/.exec(line)?.[0] ?? ""

    return line.slice(0, line.length - trailing.length) + ` ${token}` + trailing
  }

  let result = line

  for (let index = found.length - 1; index >= 0; index -= 1) {
    const item = found[index]

    if (!item) continue
    let next = index === 0 ? token : ""

    if (
      index === 0 &&
      value !== null &&
      ["due", "scheduled", "completed"].includes(key)
    )
      next = line
        .slice(item.start, item.end)
        .replace(/(:[ \t]*)\S+$/, `$1${value}`)
    result = replaceRange(result, item.start, item.end, next)
  }

  return result
}

function frontmatterEdit(body: string, key: string, value: string | null) {
  const frontmatter = readTaskFrontmatter(body)

  if (!frontmatter.end) throw new Error("Task frontmatter missing")
  const eol = body.includes("\r\n") ? "\r\n" : "\n"
  const expression = new RegExp(`^(${key}:[ \\t]*)(.*)$`, "im")
  const header = body.slice(0, frontmatter.end)
  const match = expression.exec(header)

  if (match) {
    const old = (match[2] ?? "").replace(/\r$/, "")
    const suffix = /[ \t]+#.*$/.exec(old)?.[0] ?? ""
    const raw = old.slice(0, old.length - suffix.length).trim()

    const quote =
      raw.startsWith("'") && raw.endsWith("'")
        ? "'"
        : raw.startsWith('"') && raw.endsWith('"')
          ? '"'
          : ""

    const line =
      value === null ? "" : `${match[1]}${quote}${value}${quote}${suffix}`

    const end = match.index + match[0].replace(/\r$/, "").length

    return replaceRange(
      body,
      match.index,
      value === null ? end + eol.length : end,
      line,
    )
  }

  if (value === null) return body
  const close = header.lastIndexOf(`${eol}---`)

  return replaceRange(body, close, close, `${eol}${key}: ${value}`)
}

export function editTask(note: TaskNote, task: Task, patch: TaskPatch) {
  checkedSource(note, task)
  patchSchema.parse(patch)

  const values = new Map<string, string | null>(
    Object.entries(patch.fields ?? {}),
  )

  for (const key of [
    "due",
    "scheduled",
    "completed",
    "priority",
    "status",
  ] as const)
    if (patch[key] !== undefined) values.set(key, patch[key])
  let body = note.body

  if (task.kind === "note") {
    if (patch.state) values.set("status", patch.state)

    for (const [key, value] of values)
      body = frontmatterEdit(
        body,
        key === "completed" ? "completedDate" : key,
        value,
      )

    return body
  }

  let line = task.rawText

  if (patch.state && task.checkboxOffset !== undefined) {
    const marker = {
      open: " ",
      done: "x",
      forwarded: ">",
      cancelled: "-",
      "in-progress": "/",
      waiting: " ",
    }[patch.state]

    line = replaceRange(
      line,
      task.checkboxOffset - task.start,
      task.checkboxOffset - task.start + 1,
      marker,
    )
    values.set("waiting", patch.state === "waiting" ? "true" : null)
  }

  for (const [key, value] of values) line = inlineEdit(line, key, value)

  return replaceRange(body, task.start, task.end, line)
}

export type RepeatRule =
  | {
      kind: "interval"
      every: number
      unit: "d" | "w" | "m" | "y"
      afterDone: boolean
    }
  | { kind: "weekdays"; days: number[] }

export function parseRepeatRule(raw: string): RepeatRule | null {
  let value = raw.trim().toLowerCase()

  if (value === "weekdays") return { kind: "weekdays", days: [1, 2, 3, 4, 5] }
  const afterDone = value.startsWith("after-")

  if (afterDone) value = value.slice(6)

  const named = new Map([
    ["daily", "1d"],
    ["weekly", "1w"],
    ["monthly", "1m"],
    ["yearly", "1y"],
    ["annually", "1y"],
  ])

  value = named.get(value) ?? value
  const interval = /^(\d{1,3})([dwmy])$/.exec(value)

  if (interval && Number(interval[1]) > 0) {
    const unit = z.enum(["d", "w", "m", "y"]).parse(interval[2])

    return { kind: "interval", every: Number(interval[1]), unit, afterDone }
  }

  if (afterDone) return null

  const days = value.split("/").map(function day(part) {
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(part)
  })

  return days.length &&
    days.every(function valid(day) {
      return day >= 0
    })
    ? {
        kind: "weekdays",
        days: [...new Set(days)].sort(function compare(left, right) {
          return left - right
        }),
      }
    : null
}

function utcDate(iso: string) {
  taskDateSchema.parse(iso)

  return new Date(`${iso}T00:00:00Z`)
}

function isoDate(date: Date) {
  return taskDateSchema.parse(date.toISOString().slice(0, 10))
}

function shiftDate(iso: string, amount: number, unit: "d" | "w" | "m" | "y") {
  const date = utcDate(iso)

  if (unit === "d" || unit === "w")
    date.setUTCDate(date.getUTCDate() + amount * (unit === "w" ? 7 : 1))
  else {
    const day = date.getUTCDate()
    date.setUTCDate(1)
    date.setUTCMonth(date.getUTCMonth() + amount * (unit === "y" ? 12 : 1))
    const end = new Date(date.getTime())
    end.setUTCMonth(end.getUTCMonth() + 1, 0)
    date.setUTCDate(Math.min(day, end.getUTCDate()))
  }

  return isoDate(date)
}

export function nextRepeatDate(rule: RepeatRule, base: string, today: string) {
  taskDateSchema.parse(base)
  taskDateSchema.parse(today)

  if (rule.kind === "weekdays") {
    if (
      !rule.days.length ||
      rule.days.some(function invalid(day) {
        return !Number.isInteger(day) || day < 0 || day > 6
      })
    )
      throw new Error("Invalid repeat weekdays")
    let date = base > today ? base : today
    const weekdays = new Set(rule.days)

    for (let step = 0; step < 7; step += 1) {
      date = shiftDate(date, 1, "d")

      if (weekdays.has(utcDate(date).getUTCDay())) return date
    }
  } else {
    if (!Number.isInteger(rule.every) || rule.every < 1 || rule.every > 999)
      throw new Error("Invalid repeat interval")

    if (rule.afterDone) return shiftDate(today, rule.every, rule.unit)
    const baseDate = utcDate(base)
    const todayDate = utcDate(today)

    const distance =
      rule.unit === "d" || rule.unit === "w"
        ? Math.floor(
            (todayDate.getTime() - baseDate.getTime()) /
              86400000 /
              (rule.unit === "w" ? 7 : 1),
          )
        : (todayDate.getUTCFullYear() - baseDate.getUTCFullYear()) *
            (rule.unit === "y" ? 1 : 12) +
          (rule.unit === "y"
            ? 0
            : todayDate.getUTCMonth() - baseDate.getUTCMonth())

    let count = Math.max(1, Math.floor(distance / rule.every))
    let next = shiftDate(base, count * rule.every, rule.unit)

    if (next <= today) {
      count += 1
      next = shiftDate(base, count * rule.every, rule.unit)
    }

    return next
  }

  throw new Error("Invalid recurrence")
}

function blockWithEdits(note: TaskNote, task: Task, reset: boolean) {
  const descendants = parseTasks(note, { includeExcluded: true }).filter(
    function child(value) {
      return (
        value.kind === "checkbox" &&
        value.start > task.start &&
        value.start < task.subtreeEnd
      )
    },
  )

  let block = note.body.slice(task.start, task.subtreeEnd)

  for (const child of descendants.reverse()) {
    if (
      !reset &&
      child.state !== "open" &&
      child.state !== "in-progress" &&
      child.state !== "waiting"
    )
      continue
    const patch: TaskPatch = { state: reset ? "open" : "cancelled" }

    if (reset) patch.completed = null
    const edited = editTask(note, child, patch)

    const newLine = edited.slice(
      child.start,
      edited.length - (note.body.length - child.end),
    )

    block = replaceRange(
      block,
      child.start - task.start,
      child.end - task.start,
      newLine,
    )
  }

  return block
}

export function completeTask(
  note: TaskNote,
  task: Task,
  today: string,
  options: { fallbackDue?: string; skip?: boolean } = {},
) {
  checkedSource(note, task)
  taskDateSchema.parse(today)

  if (
    task.state === "done" ||
    task.state === "cancelled" ||
    task.state === "forwarded"
  )
    return note.body
  const repeat = parseRepeatRule(task.fields.repeat ?? "")

  if (repeat && task.kind === "note")
    throw new Error("Use completeNoteTask for recurring note tasks")

  if (!repeat)
    return editTask(note, task, {
      state: options.skip ? "cancelled" : "done",
      completed: today,
    })

  const due = nextRepeatDate(
    repeat,
    task.due ?? options.fallbackDue ?? today,
    today,
  )

  const nextBody = editTask(note, task, {
    state: "open",
    due,
    completed: null,
    status: null,
  })

  const nextLine = nextBody.slice(
    task.start,
    nextBody.length - (note.body.length - task.end),
  )

  const recordBody = editTask(note, task, {
    state: options.skip ? "cancelled" : "done",
    completed: today,
    status: null,
    fields: { repeat: null, remind: null },
  })

  const recordLine = recordBody.slice(
    task.start,
    recordBody.length - (note.body.length - task.end),
  )

  const originalLength = task.end - task.start
  const eol = note.body.includes("\r\n") ? "\r\n" : "\n"
  const next = nextLine + blockWithEdits(note, task, true).slice(originalLength)

  const record =
    recordLine + blockWithEdits(note, task, false).slice(originalLength)

  return replaceRange(
    note.body,
    task.start,
    task.subtreeEnd,
    next + (next.endsWith("\n") ? "" : eol) + record,
  )
}

export interface NoteCompletion {
  record: TaskNote
  next?: TaskNote
}

export function completeNoteTask(
  note: TaskNote,
  task: Task,
  today: string,
): NoteCompletion {
  checkedSource(note, task)
  taskDateSchema.parse(today)

  if (task.kind !== "note") throw new Error("A whole-note task is required")

  if (["done", "cancelled", "forwarded"].includes(task.state))
    return { record: note }
  const rule = parseRepeatRule(task.fields.repeat ?? "")

  if (!rule)
    return {
      record: {
        ...note,
        body: editTask(note, task, { state: "done", completed: today }),
      },
    }
  const due = nextRepeatDate(rule, task.due ?? today, today)
  const nextBody = editTask(note, task, { state: "open", due, completed: null })

  const recordBody = editTask(note, task, {
    state: "done",
    completed: today,
    fields: { repeat: null, remind: null },
  })

  const record = { ...note, body: recordBody }

  const next = {
    ...note,
    path: note.path.replace(/\.md$/i, ` ${due}.md`),
    body: nextBody,
  }

  relativeServicePathSchema.parse(next.path)

  for (const child of parseTasks(record)
    .filter(function checkbox(value) {
      return value.kind === "checkbox"
    })
    .reverse()) {
    if (["open", "waiting", "in-progress"].includes(child.state)) {
      const current = parseTasks(record).find(function same(value) {
        return value.id === child.id
      })

      if (current)
        record.body = editTask(record, current, { state: "cancelled" })
    }
  }

  for (const child of parseTasks(next)
    .filter(function checkbox(value) {
      return value.kind === "checkbox"
    })
    .reverse()) {
    const current = parseTasks(next).find(function same(value) {
      return value.id === child.id
    })

    if (current)
      next.body = editTask(next, current, { state: "open", completed: null })
  }

  return { record, next }
}

function forwardBlock(block: string) {
  const quotePrefix = /^(?:[ \t]*>[ \t]?)+/.exec(block)?.[0] ?? ""
  const depth = (quotePrefix.match(/>/g) ?? []).length

  const indent = columns(
    /^[ \t]*/.exec(block.slice(quotePrefix.length))?.[0] ?? "",
  )

  return block
    .split(/\r?\n/)
    .map(function unnest(line) {
      let rest = line

      for (let quote = 0; quote < depth; quote += 1)
        rest = rest.replace(/^[ \t]*>[ \t]?/, "")
      let removed = 0
      let position = 0

      while (
        removed < indent &&
        (rest[position] === " " || rest[position] === "\t")
      ) {
        removed += rest[position] === "\t" ? 4 - (removed % 4) : 1
        position += 1
      }

      return " ".repeat(Math.max(0, removed - indent)) + rest.slice(position)
    })
    .join("\n")
}

export function forwardTask(source: TaskNote, task: Task, target: TaskNote) {
  checkedSource(source, task)
  noteSchema.parse(target)

  if (
    source.path === target.path ||
    task.kind !== "checkbox" ||
    ["done", "cancelled", "forwarded"].includes(task.state) ||
    source.trashed ||
    target.trashed ||
    /[[\]#]/.test(source.path + target.path)
  )
    throw new Error("Cannot forward this task")
  const eol = target.body.includes("\r\n") ? "\r\n" : "\n"
  const origin = editTask(source, task, { state: "forwarded" })

  const originLine =
    origin.slice(task.start, origin.length - (source.body.length - task.end)) +
    ` → [[${target.path.replace(/\.md$/i, "")}]]`

  const next = editTask(source, task, {
    state: "open",
    due: null,
    completed: null,
  })

  const copyLine =
    next.slice(task.start, next.length - (source.body.length - task.end)) +
    ` ← [[${source.path.replace(/\.md$/i, "")}]]`

  let record =
    originLine +
    blockWithEdits(source, task, false).slice(task.end - task.start)

  const copy = forwardBlock(
    copyLine + source.body.slice(task.end, task.subtreeEnd),
  )

  if (!record.endsWith("\n") && source.body.slice(task.subtreeEnd))
    record += source.body.includes("\r\n") ? "\r\n" : "\n"

  const insertion =
    target.body + (target.body && !target.body.endsWith("\n") ? eol : "")

  const destination = {
    ...target,
    body:
      insertion +
      copy.replace(/\r?\n/g, eol) +
      (copy.endsWith("\n") ? "" : eol),
  }

  if (
    !parseTasks(destination).some(function inserted(value) {
      return value.start === insertion.length && value.kind === "checkbox"
    })
  )
    throw new Error("Destination does not accept tasks")

  return {
    source: {
      ...source,
      body: replaceRange(source.body, task.start, task.subtreeEnd, record),
    },
    target: destination,
  }
}

const reminderSchema = z.strictObject({
  key: z.string().min(1).max(2048),
  taskId: z.string(),
  path: relativeServicePathSchema,
  line: z.number().int().nonnegative(),
  title: z.string(),
  fireAt: z.number().finite(),
})

export type TaskReminder = z.infer<typeof reminderSchema>

function clock(raw: string) {
  let match = /^(\d{1,2})(\d{2})?(am|pm)$/.exec(raw)

  if (match) {
    const hour = Number(match[1])
    const minute = Number(match[2] ?? 0)

    return hour >= 1 && hour <= 12 && minute < 60
      ? { hour: (hour % 12) + (match[3] === "pm" ? 12 : 0), minute }
      : null
  }

  match = /^(?:(\d{2})(\d{2})|(\d{1,2})h(\d{2})?)$/.exec(raw)

  if (!match) return null
  const hour = Number(match[1] ?? match[3])
  const minute = Number(match[2] ?? match[4] ?? 0)

  return hour < 24 && minute < 60 ? { hour, minute } : null
}

export function computeReminders(
  tasks: readonly Task[],
  options: {
    now: Date
    defaultTime?: string
    horizonDays?: number
    lookbackHours?: number
  },
): TaskReminder[] {
  const now = z.date().parse(options.now).getTime()
  const defaultTime = options.defaultTime ?? "09:00"
  const fallback = /^(\d{2}):(\d{2})$/.exec(defaultTime)
  const fallbackClock = clock(defaultTime.replace(":", ""))

  if (!fallback || !fallbackClock) throw new Error("Invalid reminder time")

  const horizon = z
    .number()
    .min(0)
    .max(366)
    .parse(options.horizonDays ?? 7)

  const lookback = z
    .number()
    .min(0)
    .max(168)
    .parse(options.lookbackHours ?? 24)

  const output: TaskReminder[] = []

  for (const task of tasks) {
    if (
      ["done", "cancelled", "forwarded"].includes(task.state) ||
      task.trashed ||
      !task.due
    )
      continue
    const raw = task.fields.remind?.toLowerCase()

    if (!raw) continue
    const days = /^(\d{1,2})d(?:-(.+))?$/.exec(raw)
    const time = days && !days[2] ? fallbackClock : clock(days?.[2] ?? raw)

    if (!time || !taskDateSchema.safeParse(task.due).success) continue
    const parts = task.due.split("-").map(Number)
    const date = new Date(0)
    date.setFullYear(
      parts[0] ?? 0,
      (parts[1] ?? 1) - 1,
      (parts[2] ?? 1) - Number(days?.[1] ?? 0),
    )
    date.setHours(time.hour, time.minute, 0, 0)
    const fireAt = date.getTime()

    if (fireAt < now - lookback * 3600000 || fireAt > now + horizon * 86400000)
      continue
    output.push({
      key: digest(JSON.stringify([task.id, task.content, fireAt])),
      taskId: task.id,
      path: task.sourcePath,
      line: task.line,
      title: task.content || task.noteTitle,
      fireAt,
    })
  }

  return output
    .sort(function compare(left, right) {
      return left.fireAt - right.fireAt || left.key.localeCompare(right.key)
    })
    .slice(0, 500)
}

const ledgerSchema = z.strictObject({
  version: z.literal(1),
  watchedUntil: z.number().finite(),
  fired: z.record(z.string(), z.number().finite()),
  items: z.array(reminderSchema).max(500),
})

export class ReminderLedger {
  constructor(
    private readonly root: string,
    private readonly startedAt = Date.now(),
  ) {
    z.number().finite().parse(startedAt)
    resolveServicePath(root, "reminders.json")
  }
  claim(items: readonly TaskReminder[], now = Date.now()) {
    z.number().finite().parse(now)
    const schedule = z.array(reminderSchema).max(500).parse(items)
    const path = resolveServicePath(this.root, "reminders.json")
    const lock = resolveServicePath(this.root, "reminders.lock")
    const fd = openSync(lock, "wx", 0o600)

    try {
      const state = existsSync(path)
        ? ledgerSchema.parse(JSON.parse(readFileSync(path, "utf8")))
        : {
            version: 1 as const,
            watchedUntil: this.startedAt,
            fired: {},
            items: [],
          }

      const fired = { ...state.fired }
      const from = Math.max(state.watchedUntil, now - 86400000)

      const due = schedule.filter(function ready(item) {
        return (
          item.fireAt > from &&
          item.fireAt <= now &&
          !Object.hasOwn(fired, item.key)
        )
      })

      const unique = [
        ...new Map(
          due.map(function entry(item) {
            return [item.key, item]
          }),
        ).values(),
      ]

      for (const item of unique) fired[item.key] = now

      const next = ledgerSchema.parse({
        version: 1,
        watchedUntil: Math.max(state.watchedUntil, now),
        fired,
        items: schedule,
      })

      atomicWrite(
        resolveServicePath(this.root, "reminders.json"),
        JSON.stringify(next),
        dirname(path),
      )

      return unique
    } finally {
      closeSync(fd)
      unlinkSync(lock)
    }
  }
  pending() {
    const path = resolveServicePath(this.root, "reminders.json")

    return existsSync(path)
      ? ledgerSchema.parse(JSON.parse(readFileSync(path, "utf8"))).items
      : []
  }
}
