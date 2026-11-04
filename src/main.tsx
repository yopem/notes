import { render } from "@gpuix/react";
import { App } from "@/components/app";
import { NotesStore, defaultDataDirectory } from "@/store";
import { palettes } from "@/theme";
import { readEnvironment } from "@/env";

declare global {
  var stillNotesStore: NotesStore | undefined;
}

export function RecoveryScreen({ error, directory }: { error: string; directory: string }) {
  const color = palettes.light;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        width: "100%",
        height: "100%",
        padding: 48,
        backgroundColor: color.background,
      }}
    >
      <text
        role="heading"
        aria-level={1}
        style={{ color: color.foreground, fontSize: 28, fontWeight: 600 }}
      >
        Your notes were not changed.
      </text>
      <text role="alert" style={{ color: color.destructive, fontSize: 16 }}>
        {error}
      </text>
      <text style={{ color: color.foreground, fontSize: 14 }}>{`Data folder: ${directory}`}</text>
      <text style={{ color: color.mutedForeground, fontSize: 14 }}>
        If another Still Notes window is open, close it first. For a damaged workspace, copy the
        whole data folder before you restore workspace.json from its backup. Do not remove your only
        copy.
      </text>
    </div>
  );
}

const directory = defaultDataDirectory();

const environment = readEnvironment();

const options = {
  title: "Still Notes",
  appName: "Still Notes",
  width: environment.width,
  height: environment.height,
  focus: !environment.background,
  windowBackground: "opaque" as const,
};

try {
  if (!globalThis.stillNotesStore) {
    globalThis.stillNotesStore = new NotesStore(directory);
    process.once("exit", () => globalThis.stillNotesStore?.close());
    process.once("SIGTERM", () => process.exit(0));
    process.once("SIGINT", () => process.exit(0));
  }

  render(<App store={globalThis.stillNotesStore} dataDirectory={directory} />, options);
} catch (cause) {
  const error = cause instanceof Error ? cause.message : String(cause);
  console.error(error);
  render(<RecoveryScreen error={error} directory={directory} />, options);
}
