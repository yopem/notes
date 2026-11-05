import {
  addDays,
  format,
  getISOWeekYear,
  isValid,
  startOfISOWeek,
  startOfMonth,
} from "date-fns"
import * as locales from "date-fns/locale"
import { z } from "zod"

import {
  forwardTask,
  parseTasks,
  relativeServicePathSchema,
  type Task,
  taskDateSchema,
  type TaskNote,
} from "@/features/tasks/service"

const patternSchema = z.strictObject({
  kind: z.enum(["daily", "weekly", "monthly"]),
  directory: z.string().max(1024),
  titlePattern: z.string().min(1).max(256),
  locale: z.string().default("en-US"),
  templateId: z.string().optional(),
})

export type PeriodicPattern = z.input<typeof patternSchema>

export interface PeriodicLocation {
  kind: PeriodicPattern["kind"]
  date: string
  title: string
  directory: string
  path: string
  templateId?: string
}

const localesByCode = new Map(
  Object.values(locales).map(function entry(value) {
    return [value.code.toLowerCase(), value]
  }),
)

function dateLocale(code: string) {
  const locale = localesByCode.get(code.toLowerCase())

  if (!locale) throw new Error(`Unsupported date locale: ${code}`)

  return locale
}

const tokenExpression =
  /\[[^\]]*\]|'(?:''|[^'])*'|YYYY|yyyy|YY|yy|MMMM|MMM|MM|M|dddd|EEEE|ddd|EEE|DD|dd|D|d|ww|w|II|I|RRRR|HH|H|mm|m|ss|s/g

const tokenMapping = new Map([
  ["YYYY", "yyyy"],
  ["YY", "yy"],
  ["DD", "dd"],
  ["D", "d"],
  ["dddd", "EEEE"],
  ["ddd", "EEE"],
  ["ww", "II"],
  ["w", "I"],
])

function literal(token: string) {
  return token.startsWith("[")
    ? token.slice(1, -1)
    : token === "''"
      ? "'"
      : token.slice(1, -1).replace(/''/g, "'")
}

export function sourceDateFormat(
  date: Date,
  pattern: string,
  locale = "en-US",
  weekYear = false,
) {
  if (!isValid(date)) throw new Error("Invalid periodic date")
  const selected = dateLocale(locale)

  return pattern.replace(tokenExpression, function convert(token) {
    if (token.startsWith("[") || token.startsWith("'")) return literal(token)

    if (weekYear && ["yyyy", "YYYY", "yy", "YY"].includes(token)) {
      const year = String(getISOWeekYear(date)).padStart(4, "0")

      return token.length === 2 ? year.slice(-2) : year
    }

    return format(date, tokenMapping.get(token) ?? token, { locale: selected })
  })
}

function localIso(date: Date) {
  return taskDateSchema.parse(sourceDateFormat(date, "yyyy-MM-dd"))
}

function anchor(date: Date, kind: PeriodicPattern["kind"]) {
  switch (kind) {
    case "weekly":
      return startOfISOWeek(date)
    case "monthly":
      return startOfMonth(date)
    case "daily":
      return date
  }
}

function patternTokens(pattern: string) {
  return [...pattern.matchAll(tokenExpression)].map(function token(match) {
    return match[0].startsWith("[") || match[0].startsWith("'") ? "" : match[0]
  })
}

function quotedLiteral(text: string) {
  return text ? `'${text.replace(/'/g, "''")}'` : ""
}

function titleFormat(title: string) {
  return title.replace(/\{\{\s*date:([^}]+?)\s*\}\}/g, "$1")
}

function directoryFormat(directory: string) {
  if (directory.includes("{{")) {
    if (directory.replace(/\{\{\s*date:([^}]+?)\s*\}\}/g, "").includes("{{"))
      throw new Error("Unknown directory variable")
    let result = ""
    let previous = 0

    for (const match of directory.matchAll(/\{\{\s*date:([^}]+?)\s*\}\}/g)) {
      result +=
        quotedLiteral(directory.slice(previous, match.index)) + (match[1] ?? "")
      previous = match.index + match[0].length
    }

    return result + quotedLiteral(directory.slice(previous))
  }

  const sourceTokens = new Set([
    "yyyy",
    "yy",
    "MMMM",
    "MMM",
    "MM",
    "M",
    "dd",
    "d",
    "EEEE",
    "EEE",
    "ww",
    "w",
  ])

  const tokens = patternTokens(directory).filter(function source(token) {
    return sourceTokens.has(token)
  })

  return directory.includes("'") ||
    tokens.length >= 2 ||
    tokens.some(function dateToken(token) {
      return token === "yyyy" || token === "yy" || token === "ww"
    })
    ? directory
    : null
}

function validatePattern(input: PeriodicPattern) {
  const pattern = patternSchema.parse(input)

  const tokens = new Set(
    patternTokens(
      `${titleFormat(pattern.titlePattern)} ${directoryFormat(pattern.directory) ?? ""}`,
    ),
  )

  function has(candidates: string[]) {
    return candidates.some(function candidate(token) {
      return tokens.has(token)
    })
  }

  const hasYear = has(["yyyy", "YYYY", "RRRR", "yy", "YY"])
  const hasMonth = has(["M", "MM", "MMM", "MMMM"])
  const hasDay = has(["d", "dd", "D", "DD"])
  const hasWeek = has(["w", "ww", "I", "II"])
  const hasWeekday = has(["EEE", "EEEE", "ddd", "dddd"])

  if (
    !hasYear ||
    (pattern.kind === "weekly" && !hasWeek) ||
    (pattern.kind === "monthly" && !hasMonth) ||
    (pattern.kind === "daily" &&
      !(hasMonth && hasDay) &&
      !(hasWeek && hasWeekday))
  )
    throw new Error("Periodic pattern cannot identify a unique period")
  dateLocale(pattern.locale)

  return pattern
}

function locationForPattern(
  date: Date,
  pattern: z.output<typeof patternSchema>,
): PeriodicLocation {
  const day = anchor(date, pattern.kind)
  const weekYear = pattern.kind === "weekly"
  const directoryPattern = directoryFormat(pattern.directory)

  const directory =
    directoryPattern === null
      ? pattern.directory
      : sourceDateFormat(day, directoryPattern, pattern.locale, weekYear)

  if (directory.includes("{{")) throw new Error("Unknown directory variable")

  if (directory) relativeServicePathSchema.parse(directory)

  const title = sourceDateFormat(
    day,
    titleFormat(pattern.titlePattern),
    pattern.locale,
    weekYear,
  )

  relativeServicePathSchema.parse(title)

  if (title.includes("/") || title.startsWith("."))
    throw new Error("Unsafe periodic title")
  const path = `${directory ? `${directory}/` : ""}${title}.md`
  relativeServicePathSchema.parse(path)

  return {
    kind: pattern.kind,
    date: localIso(day),
    title,
    directory,
    path,
    templateId: pattern.templateId,
  }
}

export function periodicLocation(date: Date, pattern: PeriodicPattern) {
  if (!isValid(date)) throw new Error("Invalid periodic date")

  return locationForPattern(date, validatePattern(pattern))
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function matchPatternYears(pattern: string, path: string) {
  let source = ""
  let previous = 0
  const years: { group: number; short: boolean }[] = []

  for (const match of pattern.matchAll(tokenExpression)) {
    source += escapeRegex(pattern.slice(previous, match.index))
    const token = match[0]

    if (token.startsWith("[") || token.startsWith("'"))
      source += escapeRegex(literal(token))
    else if (["YYYY", "yyyy", "RRRR", "YY", "yy"].includes(token)) {
      const short = token.length === 2
      years.push({ group: years.length + 1, short })
      source += short ? "(\\d{2})" : "(\\d{4})"
    } else if (["MMMM", "MMM", "dddd", "ddd", "EEEE", "EEE"].includes(token))
      source += "[^/]+?"
    else source += "\\d{1,2}"
    previous = match.index + token.length
  }

  source += escapeRegex(pattern.slice(previous))
  const match = new RegExp(`^${source}$`, "u").exec(path)

  if (!match) return []

  const candidates = years.map(function year(capture) {
    const value = Number(match[capture.group])

    return capture.short ? (value >= 70 ? 1900 : 2000) + value : value
  })

  return [...new Set(candidates)]
}

export function classifyPeriodic(
  path: string,
  current: readonly PeriodicPattern[],
  legacy: readonly PeriodicPattern[] = [],
) {
  if (
    !relativeServicePathSchema.safeParse(path).success ||
    !path.endsWith(".md")
  )
    return null

  for (const [index, input] of [...current, ...legacy].entries()) {
    const pattern = validatePattern(input)

    const directory =
      directoryFormat(pattern.directory) ?? quotedLiteral(pattern.directory)

    const combined = `${directory}${pattern.directory ? "/" : ""}${titleFormat(pattern.titlePattern)}'.md'`
    const years = matchPatternYears(combined, path)

    if (!years.length) continue
    const matches = new Map<string, PeriodicLocation>()

    for (const year of years) {
      if (year < 1 || year > 9999) continue
      const start = new Date(0)
      start.setFullYear(year, 0, 1)
      start.setHours(12, 0, 0, 0)

      if (pattern.kind === "weekly") {
        const jan4 = new Date(start)
        jan4.setDate(4)
        let day = startOfISOWeek(jan4)

        for (
          let week = 0;
          week < 53 && getISOWeekYear(day) === year;
          week += 1, day = addDays(day, 7)
        ) {
          const location = locationForPattern(day, pattern)

          if (location.path === path) matches.set(location.date, location)
        }
      } else if (pattern.kind === "monthly") {
        for (let month = 0; month < 12; month += 1) {
          const day = new Date(start)
          day.setMonth(month, 1)
          const location = locationForPattern(day, pattern)

          if (location.path === path) matches.set(location.date, location)
        }
      } else {
        for (
          let day = start;
          day.getFullYear() === year;
          day = addDays(day, 1)
        ) {
          const location = locationForPattern(day, pattern)

          if (location.path === path) matches.set(location.date, location)
        }
      }
    }

    if (matches.size === 1) {
      const location = matches.values().next().value

      if (location) return { ...location, legacy: index >= current.length }
    }

    if (matches.size > 1) return null
  }

  return null
}

export function inferDailyDue(
  tasks: readonly Task[],
  patterns: readonly PeriodicPattern[],
  legacy: readonly PeriodicPattern[] = [],
) {
  const dates = new Map<string, string | undefined>()

  return tasks.map(function infer(task) {
    if (task.due || task.state === "forwarded") return task

    if (!dates.has(task.sourcePath)) {
      const periodic = classifyPeriodic(task.sourcePath, patterns, legacy)
      dates.set(
        task.sourcePath,
        periodic?.kind === "daily" ? periodic.date : undefined,
      )
    }

    const due = dates.get(task.sourcePath)

    return due ? { ...task, due, dueInferred: true } : task
  })
}

export function rolloverDailyTasks(
  notes: readonly TaskNote[],
  target: TaskNote,
  today: string,
  patterns: readonly PeriodicPattern[],
  legacy: readonly PeriodicPattern[] = [],
): TaskNote[] {
  taskDateSchema.parse(today)
  const targetPeriod = classifyPeriodic(target.path, patterns, legacy)

  if (targetPeriod?.kind !== "daily" || targetPeriod.date !== today)
    throw new Error("Rollover target must be today's daily note")

  if (
    new Set(
      notes.map(function path(note) {
        return note.path
      }),
    ).size !== notes.length
  )
    throw new Error("Duplicate rollover source")
  let destination = target
  const changed: TaskNote[] = []

  for (const original of [...notes].sort(function compare(left, right) {
    return left.path.localeCompare(right.path)
  })) {
    if (original.path === target.path || original.trashed || original.archived)
      continue
    const period = classifyPeriodic(original.path, patterns, legacy)

    if (period?.kind !== "daily" || period.date >= today) continue
    let source = original

    const eligible = parseTasks(source).filter(function include(task) {
      return (
        task.kind === "checkbox" &&
        !task.parentId &&
        ["open", "in-progress", "waiting"].includes(task.state) &&
        (!task.due || task.due <= today)
      )
    })

    for (const candidate of eligible) {
      const task = parseTasks(source).find(function same(value) {
        return value.id === candidate.id
      })

      if (!task) throw new Error("Rollover source changed")
      const forwarded = forwardTask(source, task, destination)
      source = forwarded.source
      destination = forwarded.target
    }

    if (source.body !== original.body) changed.push(source)
  }

  return destination.body === target.body ? [] : [...changed, destination]
}
