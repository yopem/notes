import { format, getISOWeekYear } from "date-fns"
import * as locales from "date-fns/locale"
import { DateTime, Effect, Schema } from "effect"

import { PeriodicError } from "@/features/tasks/errors"
import {
  forwardTask,
  parseTasks,
  relativeServicePathSchema,
  type Task,
  taskDateSchema,
  type TaskNote,
} from "@/features/tasks/service"

const patternSchema = Schema.Struct({
  kind: Schema.Literals(["daily", "weekly", "monthly"]),
  directory: Schema.String.check(Schema.isMaxLength(1024)),
  titlePattern: Schema.String.check(Schema.isBetweenLength(1, 256)),
  locale: Schema.String.pipe(
    Schema.withDecodingDefault(Effect.succeed("en-US")),
  ),
  templateId: Schema.optional(Schema.String),
})

export type PeriodicPattern = typeof patternSchema.Encoded

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

// DateTime uses Intl options, not the stored token and locale contract.
export function sourceDateFormat(
  date: Date,
  pattern: string,
  locale = "en-US",
  weekYear = false,
) {
  Schema.decodeUnknownSync(Schema.Date)(date)
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
  return Schema.decodeUnknownSync(taskDateSchema)(
    DateTime.formatIsoDate(
      DateTime.makeZonedUnsafe(date, { timeZone: DateTime.zoneMakeLocal() }),
    ),
  )
}

function anchor(date: Date, kind: PeriodicPattern["kind"]) {
  const local = DateTime.makeZonedUnsafe(date, {
    timeZone: DateTime.zoneMakeLocal(),
  })

  switch (kind) {
    case "weekly":
      return DateTime.toDateUtc(
        DateTime.startOf(local, "week", { weekStartsOn: 1 }),
      )
    case "monthly":
      return DateTime.toDateUtc(DateTime.startOf(local, "month"))
    case "daily":
      return DateTime.toDateUtc(local)
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

function validatePattern(pattern: typeof patternSchema.Type) {
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
  pattern: typeof patternSchema.Type,
): PeriodicLocation {
  const day = anchor(date, pattern.kind)
  const weekYear = pattern.kind === "weekly"
  const directoryPattern = directoryFormat(pattern.directory)

  const directory =
    directoryPattern === null
      ? pattern.directory
      : sourceDateFormat(day, directoryPattern, pattern.locale, weekYear)

  if (directory.includes("{{")) throw new Error("Unknown directory variable")

  if (directory) Schema.decodeUnknownSync(relativeServicePathSchema)(directory)

  const title = sourceDateFormat(
    day,
    titleFormat(pattern.titlePattern),
    pattern.locale,
    weekYear,
  )

  Schema.decodeUnknownSync(relativeServicePathSchema)(title)

  if (title.includes("/") || title.startsWith("."))
    throw new Error("Unsafe periodic title")
  const path = `${directory ? `${directory}/` : ""}${title}.md`
  Schema.decodeUnknownSync(relativeServicePathSchema)(path)

  return {
    kind: pattern.kind,
    date: localIso(day),
    title,
    directory,
    path,
    templateId: pattern.templateId,
  }
}

export const periodicLocation = Effect.fn("periodicLocation")(function* (
  date: Date,
  input: PeriodicPattern,
) {
  yield* Schema.decodeUnknownEffect(Schema.Date)(date)

  const pattern = yield* Schema.decodeUnknownEffect(patternSchema, {
    onExcessProperty: "error",
  })(input)

  return yield* Effect.try({
    try: () => locationForPattern(date, validatePattern(pattern)),
    catch: (cause) => new PeriodicError({ operation: "location", cause }),
  })
})

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

export const classifyPeriodic = Effect.fn("classifyPeriodic")(function* (
  path: string,
  current: readonly PeriodicPattern[],
  legacy: readonly PeriodicPattern[] = [],
) {
  if (!Schema.is(relativeServicePathSchema)(path) || !path.endsWith(".md"))
    return null

  for (const [index, input] of [...current, ...legacy].entries()) {
    const decoded = yield* Schema.decodeUnknownEffect(patternSchema, {
      onExcessProperty: "error",
    })(input)

    const pattern = yield* Effect.try({
      try: () => validatePattern(decoded),
      catch: (cause) => new PeriodicError({ operation: "classify", cause }),
    })

    const directory =
      directoryFormat(pattern.directory) ?? quotedLiteral(pattern.directory)

    const combined = `${directory}${pattern.directory ? "/" : ""}${titleFormat(pattern.titlePattern)}'.md'`
    const years = matchPatternYears(combined, path)

    if (!years.length) continue
    const matches = new Map<string, PeriodicLocation>()

    for (const year of years) {
      if (year < 1 || year > 9999) continue

      const start = DateTime.makeZonedUnsafe(
        { year, month: 1, day: 1, hour: 12 },
        { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
      )

      if (pattern.kind === "weekly") {
        const jan4 = DateTime.setParts(start, { day: 4 })

        const end = DateTime.startOf(
          DateTime.setParts(jan4, { year: year + 1 }),
          "week",
          { weekStartsOn: 1 },
        )

        let day = DateTime.startOf(jan4, "week", { weekStartsOn: 1 })

        for (
          let week = 0;
          week < 53 && DateTime.isLessThan(day, end);
          week += 1, day = DateTime.add(day, { weeks: 1 })
        ) {
          const location = yield* Effect.try({
            try: () => locationForPattern(DateTime.toDateUtc(day), pattern),
            catch: (cause) =>
              new PeriodicError({ operation: "classify", cause }),
          })

          if (location.path === path) matches.set(location.date, location)
        }
      } else if (pattern.kind === "monthly") {
        for (let month = 0; month < 12; month += 1) {
          const day = DateTime.setParts(start, { month: month + 1, day: 1 })

          const location = yield* Effect.try({
            try: () => locationForPattern(DateTime.toDateUtc(day), pattern),
            catch: (cause) =>
              new PeriodicError({ operation: "classify", cause }),
          })

          if (location.path === path) matches.set(location.date, location)
        }
      } else {
        for (
          let day = start;
          DateTime.getPart(day, "year") === year;
          day = DateTime.add(day, { days: 1 })
        ) {
          const location = yield* Effect.try({
            try: () => locationForPattern(DateTime.toDateUtc(day), pattern),
            catch: (cause) =>
              new PeriodicError({ operation: "classify", cause }),
          })

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
})

export const inferDailyDue = Effect.fn("inferDailyDue")(function* (
  tasks: readonly Task[],
  patterns: readonly PeriodicPattern[],
  legacy: readonly PeriodicPattern[] = [],
) {
  const dates = new Map<string, string | undefined>()

  const inferred: Task[] = []

  for (const task of tasks) {
    if (task.due || task.state === "forwarded") {
      inferred.push(task)
      continue
    }

    if (!dates.has(task.sourcePath)) {
      const periodic = yield* classifyPeriodic(
        task.sourcePath,
        patterns,
        legacy,
      )

      dates.set(
        task.sourcePath,
        periodic?.kind === "daily" ? periodic.date : undefined,
      )
    }

    const due = dates.get(task.sourcePath)

    inferred.push(due ? { ...task, due, dueInferred: true } : task)
  }

  return inferred
})

export const rolloverDailyTasks = Effect.fn("rolloverDailyTasks")(function* (
  notes: readonly TaskNote[],
  target: TaskNote,
  today: string,
  patterns: readonly PeriodicPattern[],
  legacy: readonly PeriodicPattern[] = [],
) {
  yield* Schema.decodeUnknownEffect(taskDateSchema)(today)
  const targetPeriod = yield* classifyPeriodic(target.path, patterns, legacy)

  if (targetPeriod?.kind !== "daily" || targetPeriod.date !== today)
    return yield* new PeriodicError({
      operation: "rollover",
      cause: "Rollover target must be today's daily note",
    })

  if (
    new Set(
      notes.map(function path(note) {
        return note.path
      }),
    ).size !== notes.length
  )
    return yield* new PeriodicError({
      operation: "rollover",
      cause: "Duplicate rollover source",
    })
  let destination = target
  const changed: TaskNote[] = []

  for (const original of [...notes].sort(function compare(left, right) {
    return left.path.localeCompare(right.path)
  })) {
    if (original.path === target.path || original.trashed || original.archived)
      continue
    const period = yield* classifyPeriodic(original.path, patterns, legacy)

    if (period?.kind !== "daily" || period.date >= today) continue
    let source = original

    const sourceTasks = yield* Effect.try({
      try: () => parseTasks(source),
      catch: (cause) => new PeriodicError({ operation: "rollover", cause }),
    })

    const eligible = sourceTasks.filter(function include(task) {
      return (
        task.kind === "checkbox" &&
        !task.parentId &&
        ["open", "in-progress", "waiting"].includes(task.state) &&
        (!task.due || task.due <= today)
      )
    })

    for (const candidate of eligible) {
      const task = yield* Effect.try({
        try: () =>
          parseTasks(source).find(function same(value) {
            return value.id === candidate.id
          }),
        catch: (cause) => new PeriodicError({ operation: "rollover", cause }),
      })

      if (!task)
        return yield* new PeriodicError({
          operation: "rollover",
          cause: "Rollover source changed",
        })

      const forwarded = yield* Effect.try({
        try: () => forwardTask(source, task, destination),
        catch: (cause) => new PeriodicError({ operation: "rollover", cause }),
      })

      source = forwarded.source
      destination = forwarded.target
    }

    if (source.body !== original.body) changed.push(source)
  }

  return destination.body === target.body ? [] : [...changed, destination]
})
