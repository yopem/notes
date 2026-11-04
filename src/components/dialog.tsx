import { useRef, useState } from "react";
import * as Dialog from "@gpuix/react/dialog";
import { useGpuixRequired, type PublicInstance } from "@gpuix/react";
import { Button, Label } from "@/components/ui/controls";
import { inputStyle, type Palette } from "@/theme";

export type DialogState =
  | { kind: "notebook" }
  | { kind: "rename"; id: string; name: string }
  | { kind: "move"; id: string }
  | { kind: "import" }
  | { kind: "export"; id: string }
  | { kind: "delete"; id: string; title: string }
  | { kind: "help" };

export function AppDialog({
  state,
  color,
  onClose,
  onConfirm,
  notebooks,
  dataDirectory,
}: {
  state: DialogState;
  color: Palette;
  onClose: () => void;
  onConfirm: (value: string) => void;
  notebooks: { id: string; name: string }[];
  dataDirectory: string;
}) {
  const [value, setValue] = useState(
    state.kind === "rename" ? state.name : state.kind === "export" ? dataDirectory : "",
  );
  const [error, setError] = useState("");
  const inputRef = useRef<PublicInstance>(null);
  const renderer = useGpuixRequired();
  const title =
    state.kind === "notebook"
      ? "New notebook"
      : state.kind === "rename"
        ? "Rename notebook"
        : state.kind === "move"
          ? "Move to notebook"
          : state.kind === "import"
            ? "Import Markdown"
            : state.kind === "export"
              ? "Export Markdown"
              : state.kind === "delete"
                ? "Delete note permanently?"
                : "Make room for your thoughts";

  function confirm() {
    try {
      onConfirm(value);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function browse() {
    try {
      const paths = await renderer.promptForPaths?.({
        files: state.kind === "import",
        directories: state.kind === "export",
        multiple: false,
        prompt: state.kind === "import" ? "Import" : "Export here",
      });
      if (paths?.[0]) setValue(paths[0]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop style={{ backgroundColor: "#00000066" }} />
        <Dialog.Popup
          initialFocus={
            state.kind === "help" || state.kind === "delete" || state.kind === "move"
              ? true
              : inputRef
          }
          aria-label={title}
          style={{
            display: "flex",
            flexDirection: "column",
            width: 480,
            maxWidth: "94%",
            maxHeight: "90%",
            overflow: "scroll",
            gap: 20,
            padding: 28,
            borderRadius: 16,
            backgroundColor: color.background,
            borderWidth: 1,
            borderColor: color.border,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Dialog.Title>
              <Label color={color} size={20} weight={600}>
                {title}
              </Label>
            </Dialog.Title>
            <Button
              color={color}
              icon="close"
              label="Close dialog"
              testId="dialog-close"
              onClick={onClose}
            />
          </div>
          {state.kind === "help" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <Dialog.Description>
                <Label color={color} muted>
                  Native Markdown notebooks. Your words stay on this device.
                </Label>
              </Dialog.Description>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {[
                  ["New note", "N"],
                  ["Search notes", "P / K"],
                  ["Edit / preview", "Shift + P"],
                  ["Focus mode", "Shift + F"],
                  ["Import Markdown", "O"],
                ].map(([label, keys]) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      flexDirection: "row",
                      justifyContent: "space-between",
                    }}
                  >
                    <Label color={color}>{label}</Label>
                    <Label color={color} muted>
                      {process.platform === "darwin" ? "⌘" : "Ctrl"} + {keys}
                    </Label>
                  </div>
                ))}
              </div>
              <Label color={color} size={12} muted>
                Markdown supports headings, lists, tasks, tables, links and code. Drag .md files
                into the window to import them.
              </Label>
              <Label color={color} size={12} muted>{`Data location: ${dataDirectory}`}</Label>
              <Label color={color} size={12} muted>
                Still Notes · GPUix + Bun · Yopem UI design values. Independent implementation
                inspired by ZenNotes.
              </Label>
            </div>
          ) : state.kind === "move" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notebooks.map((notebook) => (
                <Button
                  key={notebook.id}
                  color={color}
                  icon="book"
                  variant="outline"
                  onClick={() => onConfirm(notebook.id)}
                >
                  {notebook.name}
                </Button>
              ))}
            </div>
          ) : state.kind === "delete" ? (
            <Dialog.Description>
              <Label
                color={color}
              >{`“${state.title || "Untitled"}” will be removed from this workspace. This cannot be undone. Export a copy first if you need it.`}</Label>
            </Dialog.Description>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Label color={color} size={13} weight={500}>
                {state.kind === "import"
                  ? "Markdown file path"
                  : state.kind === "export"
                    ? "Destination folder"
                    : "Notebook name"}
              </Label>
              <input
                ref={inputRef}
                testId="dialog-input"
                aria-label={
                  state.kind === "import"
                    ? "Markdown file path"
                    : state.kind === "export"
                      ? "Destination folder"
                      : "Notebook name"
                }
                value={value}
                onChange={(event) => setValue(event.value ?? "")}
                onSubmit={confirm}
                style={inputStyle(color)}
              />
              {(state.kind === "import" || state.kind === "export") && (
                <Button color={color} icon="folder" variant="outline" onClick={browse}>
                  Browse…
                </Button>
              )}
              <Dialog.Description>
                <Label color={color} size={12} muted>
                  {state.kind === "import"
                    ? "Copies a UTF-8 .md or .markdown file. Original file stays unchanged. Maximum size: 2 MB."
                    : state.kind === "export"
                      ? "Writes a Markdown copy. Existing files are never replaced."
                      : "Keep related thoughts together. Names can contain spaces."}
                </Label>
              </Dialog.Description>
            </div>
          )}
          {error && (
            <text
              role="alert"
              style={{ color: color.destructive, fontSize: 13, fontFamily: "Inter" }}
            >
              {error}
            </text>
          )}
          {state.kind !== "help" && state.kind !== "move" && (
            <div style={{ display: "flex", flexDirection: "row", justifyContent: "end", gap: 8 }}>
              <Button color={color} onClick={onClose}>
                Cancel
              </Button>
              <Button
                color={color}
                testId="dialog-confirm"
                variant={state.kind === "delete" ? "danger" : "primary"}
                onClick={confirm}
              >
                {state.kind === "delete"
                  ? "Delete permanently"
                  : state.kind === "import"
                    ? "Import note"
                    : state.kind === "export"
                      ? "Export note"
                      : "Save notebook"}
              </Button>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
