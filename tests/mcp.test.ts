import { afterEach, describe, expect, test } from "bun:test"
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

import { z } from "zod"

import {
  MCP_TOOL_SCHEMAS,
  McpClients,
  McpInstructions,
  runMcpStdio,
} from "@/services/mcp"

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
      const path = manager.status(id).configPath
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
      expect(manager.status(id).installed).toBe(false)
      expect(manager.install(id).upToDate).toBe(true)
      expect(clients(root).install(id).upToDate).toBe(true)
      const installed = readFileSync(path, "utf8")
      expect(installed).toContain("other")
      expect(installed).toContain(
        id === "codex" ? "# keep comment" : "untouched",
      )
      expect(clients(root).uninstall(id).installed).toBe(false)
      expect(readFileSync(path, "utf8")).toBe(original)
      expect(manager.uninstall(id).installed).toBe(false)
    })
    test(`${id}: malformed and outside-modified configs remain byte-identical`, () => {
      const manager = clients(directory())
      const path = manager.status(id).configPath
      mkdirSync(resolve(path, ".."), { recursive: true })

      for (const raw of [
        "{broken",
        "[]",
        id === "codex"
          ? 'model = "x"\nmodel = "y"'
          : '{"mcpServers":[],"mcp":[]}',
      ]) {
        writeFileSync(path, raw)
        expect(() => manager.install(id)).toThrow()
        expect(readFileSync(path, "utf8")).toBe(raw)
      }

      rmSync(path)
      manager.install(id)
      const external = `${readFileSync(path, "utf8")} `
      writeFileSync(path, external)

      // Unrelated valid edits survive removal; owned-entry edits must not be removed.
      if (id !== "codex") {
        const changed = external.replace(
          "/opt/still-notes/mcp.ts",
          "/outside.ts",
        )

        writeFileSync(path, changed)
        expect(() => manager.uninstall(id)).toThrow(/changed|owned|conflict/i)
        expect(readFileSync(path, "utf8")).toBe(changed)
      }
    })
  }

  test("refuses existing unowned entries, broken markers, symlinks, and invalid runtime", () => {
    const root = directory()
    const manager = clients(root)
    const path = manager.status("claude-code").configPath
    const raw = '{"mcpServers":{"still-notes":{"command":"mine"}}}'
    writeFileSync(path, raw)
    expect(() => manager.install("claude-code")).toThrow(/owned|exists/i)
    expect(readFileSync(path, "utf8")).toBe(raw)
    rmSync(path)
    const other = join(root, "other")
    writeFileSync(other, "{}")
    symlinkSync(other, path)
    expect(() => manager.install("claude-code")).toThrow(/symbolic|symlink/i)
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
    manager.install("claude-code")
    const path = manager.status("claude-code").configPath
    writeFileSync(
      path,
      readFileSync(path, "utf8").replace(
        '"mcpServers":',
        '"outside": 42, "mcpServers":',
      ),
    )
    manager.uninstall("claude-code")
    expect(readFileSync(path, "utf8")).toContain('"outside": 42')
    manager.install("codex")
    const toml = manager.status("codex").configPath
    writeFileSync(
      toml,
      `${readFileSync(toml, "utf8")}\n# outside comment\n[other]\nvalue = 42\n`,
    )
    manager.uninstall("codex")
    expect(readFileSync(toml, "utf8")).toContain(
      "# outside comment\n[other]\nvalue = 42",
    )
  })
  test("keeps existing empty containers and refuses edited TOML block comments", () => {
    const manager = clients(directory())
    const json = manager.status("claude-code").configPath
    const original = '{ "mcpServers": {  }, "other": [1, {"keep": "x"}] }'
    writeFileSync(json, original)
    manager.install("claude-code")
    manager.uninstall("claude-code")
    expect(readFileSync(json, "utf8")).toBe(original)
    manager.install("codex")
    const toml = manager.status("codex").configPath

    const changed = readFileSync(toml, "utf8").replace(
      "args =",
      "# outside comment\nargs =",
    )

    writeFileSync(toml, changed)
    expect(() => manager.uninstall("codex")).toThrow(/changed/i)
    expect(readFileSync(toml, "utf8")).toBe(changed)
  })
  test("preserves valid non-JSON TOML values outside the owned entry", () => {
    const manager = clients(directory())
    const path = manager.status("codex").configPath
    mkdirSync(resolve(path, ".."), { recursive: true })

    const original =
      '# retain exact values\nratio = inf\nunknown = nan\nwhen = 2025-01-01T00:00:00Z\n[mcp_servers.other]\ncommand = "other"\ncustom = -inf\n'

    writeFileSync(path, original)
    expect(manager.install("codex").owned).toBe(true)
    manager.uninstall("codex")
    expect(readFileSync(path, "utf8")).toBe(original)
  })
  test("instructions are atomic, independent defaults, and restart-safe", () => {
    const root = directory()
    const store = new McpInstructions(root)
    const defaults = store.read()
    expect(defaults.custom).toBeNull()
    store.write("Preserve my words.")
    expect(new McpInstructions(root).read().effective).toBe(
      "Preserve my words.\n",
    )
    store.write(null)
    expect(store.read()).toEqual(defaults)
  })
})

const replySchema = z.object({
  id: z.union([z.string(), z.number(), z.null()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
})

describe("MCP real stdio child", () => {
  test("NDJSON handshake, tools, actual files, invalid RPC, errors, traversal, cancellation", async () => {
    const root = directory()
    const note = join(root, "note.md")
    writeFileSync(note, "before")
    const entry = join(root, "server.ts")
    const service = resolve("src/services/mcp.ts")
    writeFileSync(
      entry,
      `import { runMcpStdio } from ${JSON.stringify(service)};\nimport { readFileSync, writeFileSync } from 'node:fs';\nawait runMcpStdio({ input: Bun.stdin.stream(), output: async line => { await Bun.write(Bun.stdout, line) }, adapter: { async execute(name, args, context) { if (name === 'read_note') { await Bun.sleep(20); context.signal.throwIfAborted(); return { body: readFileSync(${JSON.stringify(note)}, 'utf8') } } if (name === 'write_note') { writeFileSync(${JSON.stringify(note)}, args.body); return { ok: true } } throw new Error('Adapter unavailable'); } } });`,
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
      .map((line) => replySchema.parse(JSON.parse(line)))

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

    const listed = z
      .object({ tools: z.array(z.object({ name: z.string() })) })
      .parse(replies.find((reply) => reply.id === 2)?.result)

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
    await runMcpStdio({
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
    })
    const replies = output.map((line) => replySchema.parse(JSON.parse(line)))

    const listed = z
      .object({ tools: z.array(z.object({ name: z.string() })) })
      .parse(replies.find((reply) => reply.id === 2)?.result)

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
      await runMcpStdio({
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
      })
      expect(
        output.map((line) => replySchema.parse(JSON.parse(line)).error?.code),
      ).toEqual([code])
      expect(calls).toBe(0)
    }
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
      expect(MCP_TOOL_SCHEMAS.read_note.safeParse({ path }).success).toBe(false)
    expect(
      MCP_TOOL_SCHEMAS.insert_at_line.safeParse({
        path: "a.md",
        lineNumber: -1,
        text: "x",
      }).success,
    ).toBe(false)
  })
})
