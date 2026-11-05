import { afterEach, describe, expect, test } from "bun:test"
import { Effect, Fiber, Schema } from "effect"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  MCP_TOOL_SCHEMAS,
  McpClients,
  McpInstructions,
  runMcpStdio,
} from "@/features/assistant/mcp"

const roots: string[] = []

function directory() {
  const root = mkdtempSync(join(tmpdir(), "still-mcp-"))
  roots.push(root)

  return root
}

function clients(root: string) {
  return new McpClients(
    { home: root, config: join(root, "config"), platform: "linux" },
    { command: process.execPath, args: ["/opt/still-notes/mcp.ts"] },
  )
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

// Contracts defined before implementation. All paths and child files are temporary.
describe("MCP client config integration", () => {
  for (const id of [
    "claude-code",
    "claude-desktop",
    "codex",
    "opencode",
  ] as const) {
    test(`${id}: detects, installs, restarts, and removes only owned settings`, () => {
      const root = directory()
      const manager = clients(root)
      const path = Effect.runSync(manager.status(id)).configPath
      mkdirSync(resolve(path, ".."), { recursive: true })

      const original =
        id === "codex"
          ? '# keep comment\nmodel = "custom"\n[mcp_servers.other]\ncommand = "other"\n'
          : JSON.stringify({
              custom: { untouched: true },
              [id === "opencode" ? "mcp" : "mcpServers"]: {
                other: { command: "other" },
              },
            })

      writeFileSync(path, original)
      expect(Effect.runSync(manager.status(id)).installed).toBe(false)
      expect(Effect.runSync(manager.install(id)).upToDate).toBe(true)
      expect(Effect.runSync(clients(root).install(id)).upToDate).toBe(true)
      const installed = readFileSync(path, "utf8")
      expect(installed).toContain("other")
      expect(installed).toContain(
        id === "codex" ? "# keep comment" : "untouched",
      )
      expect(Effect.runSync(clients(root).uninstall(id)).installed).toBe(false)
      expect(readFileSync(path, "utf8")).toBe(original)
      expect(Effect.runSync(manager.uninstall(id)).installed).toBe(false)
    })
    test(`${id}: malformed and outside-modified configs remain byte-identical`, () => {
      const manager = clients(directory())
      const path = Effect.runSync(manager.status(id)).configPath
      mkdirSync(resolve(path, ".."), { recursive: true })

      for (const raw of [
        "{broken",
        "[]",
        id === "codex"
          ? 'model = "x"\nmodel = "y"'
          : '{"mcpServers":[],"mcp":[]}',
      ]) {
        writeFileSync(path, raw)
        expect(() => Effect.runSync(manager.install(id))).toThrow()
        expect(readFileSync(path, "utf8")).toBe(raw)
      }

      rmSync(path)
      Effect.runSync(manager.install(id))
      const external = `${readFileSync(path, "utf8")} `
      writeFileSync(path, external)

      // Unrelated valid edits survive removal; owned-entry edits must not be removed.
      if (id !== "codex") {
        const changed = external.replace(
          "/opt/still-notes/mcp.ts",
          "/outside.ts",
        )

        writeFileSync(path, changed)
        expect(() => Effect.runSync(manager.uninstall(id))).toThrow(
          /changed|owned|conflict/i,
        )
        expect(readFileSync(path, "utf8")).toBe(changed)
      }
    })
  }

  test("refuses existing unowned entries, broken markers, symlinks, and invalid runtime", () => {
    const root = directory()
    const manager = clients(root)
    const path = Effect.runSync(manager.status("claude-code")).configPath
    const raw = '{"mcpServers":{"still-notes":{"command":"mine"}}}'
    writeFileSync(path, raw)
    expect(() => Effect.runSync(manager.install("claude-code"))).toThrow(
      /owned|exists/i,
    )
    expect(readFileSync(path, "utf8")).toBe(raw)
    rmSync(path)
    const other = join(root, "other")
    writeFileSync(other, "{}")
    symlinkSync(other, path)
    expect(() => Effect.runSync(manager.install("claude-code"))).toThrow(
      /symbolic|symlink/i,
    )
    expect(readFileSync(other, "utf8")).toBe("{}")
    expect(
      () =>
        new McpClients(
          { home: root, config: root, platform: "linux" },
          { command: "", args: [] },
        ),
    ).toThrow()
  })
  test("preserves unrelated JSON edits and TOML comments on uninstall", () => {
    const manager = clients(directory())
    Effect.runSync(manager.install("claude-code"))
    const path = Effect.runSync(manager.status("claude-code")).configPath
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"mcpServers":',
        '"outside": 42, "mcpServers":',
      ),
    )
    Effect.runSync(manager.uninstall("claude-code"))
    expect(readFileSync(path, "utf8")).toContain('"outside": 42')
    Effect.runSync(manager.install("codex"))
    const toml = Effect.runSync(manager.status("codex")).configPath
    writeFileSync(
      toml,
      `${readFileSync(toml, "utf8")}\n# outside comment\n[other]\nvalue = 42\n`,
    )
    Effect.runSync(manager.uninstall("codex"))
    expect(readFileSync(toml, "utf8")).toContain(
      "# outside comment\n[other]\nvalue = 42",
    )
  })
  test("keeps existing empty containers and refuses edited TOML block comments", () => {
    const manager = clients(directory())
    const json = Effect.runSync(manager.status("claude-code")).configPath
    const original = '{ "mcpServers": {  }, "other": [1, {"keep": "x"}] }'
    writeFileSync(json, original)
    Effect.runSync(manager.install("claude-code"))
    Effect.runSync(manager.uninstall("claude-code"))
    expect(readFileSync(json, "utf8")).toBe(original)
    Effect.runSync(manager.install("codex"))
    const toml = Effect.runSync(manager.status("codex")).configPath

    const changed = readFileSync(toml, "utf8").replace(
      "args =",
      "# outside comment\nargs =",
    )

    writeFileSync(toml, changed)
    expect(() => Effect.runSync(manager.uninstall("codex"))).toThrow(/changed/i)
    expect(readFileSync(toml, "utf8")).toBe(changed)
  })
  test("preserves valid non-JSON TOML values outside the owned entry", () => {
    const manager = clients(directory())
    const path = Effect.runSync(manager.status("codex")).configPath
    mkdirSync(resolve(path, ".."), { recursive: true })

    const original =
      '# retain exact values\nratio = inf\nunknown = nan\nwhen = 2025-01-01T00:00:00Z\n[mcp_servers.other]\ncommand = "other"\ncustom = -inf\n'

    writeFileSync(path, original)
    expect(Effect.runSync(manager.install("codex")).owned).toBe(true)
    Effect.runSync(manager.uninstall("codex"))
    expect(readFileSync(path, "utf8")).toBe(original)
  })
  test("instructions are atomic, independent defaults, and restart-safe", () => {
    const root = directory()
    const store = new McpInstructions(root)
    const defaults = Effect.runSync(store.read())
    expect(defaults.custom).toBeNull()
    Effect.runSync(store.write("Preserve my words."))
    expect(Effect.runSync(new McpInstructions(root).read()).effective).toBe(
      "Preserve my words.\n",
    )
    Effect.runSync(store.write(null))
    expect(Effect.runSync(store.read())).toEqual(defaults)
  })
})

const replySchema = Schema.Struct({
  id: Schema.Union([Schema.String, Schema.Finite, Schema.Null]),
  result: Schema.optional(Schema.Unknown),
  error: Schema.optional(
    Schema.Struct({ code: Schema.Finite, message: Schema.String }),
  ),
})

const listedToolsSchema = Schema.Struct({
  tools: Schema.Array(Schema.Struct({ name: Schema.String })),
})

function streamInput() {
  const ready =
    Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>()

  let cancelled = false

  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      ready.resolve(controller)
    },
    cancel() {
      cancelled = true
    },
  })

  return { input, ready: ready.promise, isCancelled: () => cancelled }
}

function sendMessages(
  controller: ReadableStreamDefaultController<Uint8Array>,
  messages: object[],
) {
  controller.enqueue(
    new TextEncoder().encode(
      messages
        .map((message) => JSON.stringify({ jsonrpc: "2.0", ...message }))
        .join("\n") + "\n",
    ),
  )
}

const initializeMessages = [
  {
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    },
  },
  { method: "notifications/initialized" },
]

function readNote(id: number) {
  return {
    id,
    method: "tools/call",
    params: { name: "read_note", arguments: { path: "note.md" } },
  }
}

describe("MCP real stdio child", () => {
  test("NDJSON handshake, tools, actual files, invalid RPC, errors, traversal, cancellation", async () => {
    const root = directory()
    const note = join(root, "note.md")
    writeFileSync(note, "before")
    const entry = join(root, "server.ts")
    const service = resolve(import.meta.dir, "../src/features/assistant/mcp.ts")
    const effect = import.meta.resolve("effect")
    writeFileSync(
      entry,
      `import { runMcpStdio } from ${JSON.stringify(service)};\nimport { Effect } from ${JSON.stringify(effect)};\nimport { readFileSync, writeFileSync } from 'node:fs';\nawait Effect.runPromise(runMcpStdio({ input: Bun.stdin.stream(), output: async line => { await Bun.write(Bun.stdout, line) }, adapter: { async execute(name, args, context) { if (name === 'read_note') { await Bun.sleep(20); context.signal.throwIfAborted(); return { body: readFileSync(${JSON.stringify(note)}, 'utf8') } } if (name === 'write_note') { writeFileSync(${JSON.stringify(note)}, args.body); return { ok: true } } throw new Error('Adapter unavailable'); } } }));`,
    )

    const child = Bun.spawn([process.execPath, entry], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    })

    const messages = [
      "{bad",
      JSON.stringify([]),
      JSON.stringify({ jsonrpc: "2.0", id: 0, method: "tools/list" }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "test-client", version: "1" },
        },
      }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "write_note",
          arguments: { path: "note.md", body: "after" },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "read_note", arguments: { path: "note.md" } },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { requestId: 4 },
      }),
      ...[
        {
          id: 5,
          method: "tools/call",
          params: {
            name: "write_note",
            arguments: { path: "../outside", body: "no" },
          },
        },
        {
          id: 6,
          method: "tools/call",
          params: { name: "missing", arguments: {} },
        },
        { id: 7, method: "missing" },
        {
          id: 8,
          method: "tools/call",
          params: { name: "empty_trash", arguments: { confirm: false } },
        },
        {
          id: 9,
          method: "tools/call",
          params: {
            name: "read_note",
            arguments: { path: "note.md", extra: true },
          },
        },
        {
          id: 10,
          method: "tools/call",
          params: { name: "list_assets", arguments: {} },
        },
      ].map((value) => JSON.stringify({ jsonrpc: "2.0", ...value })),
    ]

    await child.stdin.write(`${messages.join("\n")}\n`)
    await child.stdin.end()
    const stdout = await new Response(child.stdout).text()
    const stderr = await new Response(child.stderr).text()
    expect(await child.exited).toBe(0)
    expect(stderr).toBe("")

    const replies = stdout
      .trim()
      .split("\n")
      .map((line) => Schema.decodeUnknownSync(replySchema)(JSON.parse(line)))

    expect(
      replies
        .filter((reply) => reply.id === null)
        .map((reply) => reply.error?.code),
    ).toEqual([-32700, -32600])
    expect(replies.find((reply) => reply.id === 0)?.error?.code).toBe(-32002)
    expect(replies.find((reply) => reply.id === 1)?.result).toMatchObject({
      protocolVersion: "2024-11-05",
      serverInfo: { name: "still-notes" },
    })

    const listed = Schema.decodeUnknownSync(listedToolsSchema)(
      replies.find((reply) => reply.id === 2)?.result,
    )

    expect(listed.tools.map((tool) => tool.name)).toContain("read_note")
    expect(listed.tools.map((tool) => tool.name)).toContain("list_comments")
    expect(replies.find((reply) => reply.id === 3)?.result).toMatchObject({
      isError: false,
    })
    expect(replies.find((reply) => reply.id === 4)?.error?.code).toBe(-32800)

    for (const id of [5, 6, 8, 9, 10])
      expect(replies.find((reply) => reply.id === id)?.result).toMatchObject({
        isError: true,
      })
    expect(replies.find((reply) => reply.id === 7)?.error?.code).toBe(-32601)
    expect(readFileSync(note, "utf8")).toBe("after")
  })
  test("read-only stream hides writes and rejects duplicate active ids", async () => {
    const input = [
      {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "unknown",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
      { method: "notifications/initialized" },
      { id: 2, method: "tools/list" },
      {
        id: 3,
        method: "tools/call",
        params: {
          name: "write_note",
          arguments: { path: "a.md", body: "bad" },
        },
      },
      {
        id: 4,
        method: "tools/call",
        params: { name: "read_note", arguments: { path: "a.md" } },
      },
      {
        id: 4,
        method: "tools/call",
        params: { name: "read_note", arguments: { path: "a.md" } },
      },
      { id: 5, method: "tools/call", params: {} },
    ]
      .map((message) => JSON.stringify({ jsonrpc: "2.0", ...message }))
      .join("\n")

    const output: string[] = []
    let writes = 0
    await Effect.runPromise(
      runMcpStdio({
        input: new Blob([input + "\n"]).stream(),
        output(line) {
          output.push(line)

          return Promise.resolve()
        },
        access: "read",
        adapter: {
          async execute(name) {
            if (name === "write_note") writes += 1
            await Bun.sleep(5)

            return { body: "actual" }
          },
        },
      }),
    )

    const replies = output.map((line) =>
      Schema.decodeUnknownSync(replySchema)(JSON.parse(line)),
    )

    const listed = Schema.decodeUnknownSync(listedToolsSchema)(
      replies.find((reply) => reply.id === 2)?.result,
    )

    expect(listed.tools.map((tool) => tool.name)).not.toContain("write_note")
    expect(replies.find((reply) => reply.id === 3)?.result).toMatchObject({
      isError: true,
    })
    expect(
      replies.some((reply) => reply.id === 4 && reply.error?.code === -32600),
    ).toBe(true)
    expect(replies.find((reply) => reply.id === 5)?.error?.code).toBe(-32602)
    expect(writes).toBe(0)
  })
  test("invalid UTF-8 and oversized frames return RPC errors without adapter calls", async () => {
    for (const [bytes, code] of [
      [new Uint8Array([255, 10]), -32700],
      [new Uint8Array(4 * 1024 * 1024 + 1).fill(120), -32600],
    ] as const) {
      const output: string[] = []
      let calls = 0
      await Effect.runPromise(
        runMcpStdio({
          input: new Blob([bytes]).stream(),
          output(line) {
            output.push(line)

            return Promise.resolve()
          },
          adapter: {
            execute() {
              calls += 1

              return Promise.resolve(null)
            },
          },
        }),
      )
      expect(
        output.map(
          (line) =>
            Schema.decodeUnknownSync(replySchema)(JSON.parse(line)).error?.code,
        ),
      ).toEqual([code])
      expect(calls).toBe(0)
    }
  })
  test("cancels an adapter after it starts and emits one cancellation response", async () => {
    const stream = streamInput()
    const started = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const output: string[] = []

    const fiber = Effect.runFork(
      runMcpStdio({
        input: stream.input,
        output(line) {
          output.push(line)

          return Promise.resolve()
        },
        adapter: {
          execute(_name, _args, context) {
            started.resolve()

            return new Promise((_resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  aborted.resolve()
                  reject(new Error("aborted"))
                },
                { once: true },
              )
            })
          },
        },
      }),
    )

    const controller = await stream.ready
    sendMessages(controller, [...initializeMessages, readNote(2)])
    await started.promise
    sendMessages(controller, [
      { method: "notifications/cancelled", params: { requestId: 2 } },
    ])
    await aborted.promise
    controller.close()
    await Effect.runPromise(Fiber.join(fiber))

    const replies = output.map((line) =>
      Schema.decodeUnknownSync(replySchema)(JSON.parse(line)),
    )

    expect(replies.filter((reply) => reply.id === 2)).toHaveLength(1)
    expect(replies.find((reply) => reply.id === 2)?.error?.code).toBe(-32800)
    expect(stream.input.locked).toBe(false)
  })

  test("retains a cancelled write and its ID until the adapter settles", async () => {
    const stream = streamInput()
    const started = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const release = Promise.withResolvers<string>()
    const ping = Promise.withResolvers<void>()
    const cancelled = Promise.withResolvers<void>()
    const retried = Promise.withResolvers<void>()
    const queuedCancelled = Promise.withResolvers<void>()
    const output: string[] = []
    let calls = 0
    let active = 0
    let maxActive = 0
    const write = {
      id: 7,
      method: "tools/call",
      params: { name: "write_note", arguments: { path: "note.md", body: "safe" } },
    }

    const fiber = Effect.runFork(
      runMcpStdio({
        input: stream.input,
        output(line) {
          output.push(line)
          const reply = Schema.decodeUnknownSync(replySchema)(JSON.parse(line))
          if (reply.id === 9) ping.resolve()
          if (reply.id === 8) retried.resolve()
          if (reply.id === 10 && reply.error?.code === -32800)
            queuedCancelled.resolve()
          if (reply.id === 7 && reply.error?.code === -32600)
            cancelled.resolve()

          return Promise.resolve()
        },
        adapter: {
          async execute(_name, _args, context) {
            calls += 1
            active += 1
            maxActive = Math.max(maxActive, active)
            if (calls === 1) {
              context.signal.addEventListener("abort", () => aborted.resolve(), {
                once: true,
              })
              started.resolve()
              await release.promise
            }
            active -= 1

            return "saved"
          },
        },
      }),
    )

    const controller = await stream.ready
    try {
      sendMessages(controller, [...initializeMessages, write])
      await started.promise
      sendMessages(controller, [
        { method: "notifications/cancelled", params: { requestId: 7 } },
        write,
        { ...write, id: 8 },
        { ...write, id: 10 },
        { method: "notifications/cancelled", params: { requestId: 10 } },
        { id: 9, method: "ping" },
      ])
      await aborted.promise
      await ping.promise
      await queuedCancelled.promise
      expect(calls).toBe(1)
      expect(output.map((line) => JSON.parse(line)).filter((reply) => reply.id === 7)).toHaveLength(0)
      release.resolve("done")
      await cancelled.promise
      await retried.promise
      const firstReplies = output
        .map((line) => Schema.decodeUnknownSync(replySchema)(JSON.parse(line)))
        .filter((reply) => reply.id === 7)
      expect(firstReplies.map((reply) => reply.error?.code)).toEqual([
        -32800,
        -32600,
      ])
      sendMessages(controller, [write])
      controller.close()
      await Effect.runPromise(Fiber.join(fiber))
      expect(calls).toBe(3)
      expect(maxActive).toBe(1)
      const replies = output
        .map((line) => Schema.decodeUnknownSync(replySchema)(JSON.parse(line)))
        .filter((reply) => reply.id === 7)
      expect(replies).toHaveLength(3)
      expect(replies[2]?.result).toMatchObject({ isError: false })
    } finally {
      release.resolve("done")
      await Effect.runPromise(Fiber.interrupt(fiber))
    }
  })

  test("rejects excess calls while output is blocked and processes cancellation", async () => {
    const stream = streamInput()
    const allStarted = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()
    const outputBlocked = Promise.withResolvers<void>()
    const releaseOutput = Promise.withResolvers<void>()
    const releaseWork = Promise.withResolvers<string>()
    const output: string[] = []
    let calls = 0

    const fiber = Effect.runFork(
      runMcpStdio({
        input: stream.input,
        async output(line) {
          output.push(line)
          const reply = Schema.decodeUnknownSync(replySchema)(JSON.parse(line))
          if (reply.id === 30) {
            outputBlocked.resolve()
            await releaseOutput.promise
          }
        },
        adapter: {
          async execute(_name, _args, context) {
            calls += 1
            if (calls === 16) allStarted.resolve()
            context.signal.addEventListener("abort", () => aborted.resolve(), {
              once: true,
            })
            return releaseWork.promise
          },
        },
      }),
    )

    const controller = await stream.ready
    try {
      sendMessages(controller, [
        ...initializeMessages,
        ...Array.from({ length: 16 }, (_, index) => readNote(index + 2)),
      ])
      await allStarted.promise
      sendMessages(controller, [readNote(30)])
      await outputBlocked.promise
      sendMessages(controller, [
        readNote(31),
        { method: "notifications/cancelled", params: { requestId: 2 } },
      ])
      await aborted.promise
      expect(calls).toBe(16)
      releaseWork.resolve("done")
      releaseOutput.resolve()
      controller.close()
      await Effect.runPromise(Fiber.join(fiber))
      const replies = output.map((line) =>
        Schema.decodeUnknownSync(replySchema)(JSON.parse(line)),
      )
      expect(replies.find((reply) => reply.id === 30)?.error).toEqual({
        code: -32000,
        message: "Server busy",
      })
      expect(replies.find((reply) => reply.id === 31)?.error).toEqual({
        code: -32000,
        message: "Server busy",
      })
      expect(replies.find((reply) => reply.id === 2)?.error?.code).toBe(-32800)
      expect(calls).toBe(16)
    } finally {
      releaseWork.resolve("done")
      releaseOutput.resolve()
      await Effect.runPromise(Fiber.interrupt(fiber))
    }
  })

  test("fails the session when blocked output exhausts the response backlog", async () => {
    const stream = streamInput()
    const blocked = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const output: string[] = []
    const fiber = Effect.runFork(
      runMcpStdio({
        input: stream.input,
        async output(line) {
          output.push(line)
          const reply = Schema.decodeUnknownSync(replySchema)(JSON.parse(line))
          if (reply.id === 2) {
            blocked.resolve()
            await release.promise
          }
        },
        adapter: { execute: () => Promise.resolve("unused") },
      }),
    )

    const controller = await stream.ready
    try {
      sendMessages(controller, [...initializeMessages, { id: 2, method: "ping" }])
      await blocked.promise
      sendMessages(controller, Array.from({ length: 40 }, (_, index) => ({
        id: index + 3,
        method: "ping",
      })))
      const exit = await Effect.runPromise(Fiber.await(fiber))
      expect(exit._tag).toBe("Failure")
      expect(stream.isCancelled()).toBe(true)
      expect(stream.input.locked).toBe(false)
      expect(output.map((line) => Schema.decodeUnknownSync(replySchema)(JSON.parse(line)).id)).toEqual([1, 2])
    } finally {
      release.resolve()
      await Effect.runPromise(Fiber.interrupt(fiber))
    }
  })

  test("interrupting the outer fiber aborts work and releases the input reader", async () => {
    const stream = streamInput()
    const started = Promise.withResolvers<void>()
    const aborted = Promise.withResolvers<void>()

    const fiber = Effect.runFork(
      runMcpStdio({
        input: stream.input,
        output() {
          return Promise.resolve()
        },
        adapter: {
          execute(_name, _args, context) {
            started.resolve()

            return new Promise((_resolve, reject) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  aborted.resolve()
                  reject(new Error("aborted"))
                },
                { once: true },
              )
            })
          },
        },
      }),
    )

    const controller = await stream.ready
    sendMessages(controller, [...initializeMessages, readNote(2)])
    await started.promise
    await Effect.runPromise(Fiber.interrupt(fiber))
    await aborted.promise
    expect(stream.isCancelled()).toBe(true)
    expect(stream.input.locked).toBe(false)
  })

  test("serializes concurrent ready responses while output is backpressured", async () => {
    const stream = streamInput()
    const started = Promise.withResolvers<void>()
    const finishFirst = Promise.withResolvers<string>()
    const finishSecond = Promise.withResolvers<string>()
    const secondOutputStarted = Promise.withResolvers<void>()
    const releaseOutput = Promise.withResolvers<void>()
    const output: string[] = []
    let calls = 0
    let activeOutputs = 0
    let maxActiveOutputs = 0

    const fiber = Effect.runFork(
      runMcpStdio({
        input: stream.input,
        async output(line) {
          activeOutputs += 1
          maxActiveOutputs = Math.max(maxActiveOutputs, activeOutputs)
          output.push(line)

          if (
            Schema.decodeUnknownSync(replySchema)(JSON.parse(line)).id === 3
          ) {
            secondOutputStarted.resolve()
            await releaseOutput.promise
          }

          activeOutputs -= 1
        },
        adapter: {
          execute() {
            calls += 1

            if (calls === 2) started.resolve()

            return calls === 1 ? finishFirst.promise : finishSecond.promise
          },
        },
      }),
    )

    const controller = await stream.ready
    sendMessages(controller, [...initializeMessages, readNote(2), readNote(3)])
    await started.promise
    finishSecond.resolve("second")
    await secondOutputStarted.promise
    finishFirst.resolve("first")
    controller.close()
    await Bun.sleep(20)
    expect(
      output.map(
        (line) => Schema.decodeUnknownSync(replySchema)(JSON.parse(line)).id,
      ),
    ).toEqual([1, 3])
    releaseOutput.resolve()
    await Effect.runPromise(Fiber.join(fiber))
    expect(
      output.map(
        (line) => Schema.decodeUnknownSync(replySchema)(JSON.parse(line)).id,
      ),
    ).toEqual([1, 3, 2])
    expect(
      output.every(
        (line) => line.endsWith("\n") && line.trim().split("\n").length === 1,
      ),
    ).toBe(true)
    expect(maxActiveOutputs).toBe(1)
  })

  test("every source tool has a strict schema and rejects unsafe paths", () => {
    expect(Object.keys(MCP_TOOL_SCHEMAS)).toHaveLength(34)

    for (const path of [
      "../note.md",
      "/note.md",
      "a/../../b",
      "a\\b",
      ".still-notes/state.json",
      "a\u0000b",
    ])
      expect(Schema.is(MCP_TOOL_SCHEMAS.read_note)({ path })).toBe(false)
    expect(
      Schema.is(MCP_TOOL_SCHEMAS.insert_at_line)({
        path: "a.md",
        lineNumber: -1,
        text: "x",
      }),
    ).toBe(false)
  })
})
