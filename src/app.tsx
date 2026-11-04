import { useRef, useState, useSyncExternalStore } from "react";
import { useGpuixRequired, useWindowSize, type KeyEvent, type PublicInstance } from "@gpuix/react";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import type { NotesStore } from "./store";
import { palettes, inputStyle } from "./theme";
import { registerFonts } from "./fonts";
import { Sidebar, type View } from "./sidebar";
import { NoteList } from "./note-list";
import { Editor, type EditorMode } from "./editor";
import { AppDialog, type DialogState } from "./dialog";
import { Button, Label } from "./ui";
import { Icon } from "./icons";

type Draft = { title?: string; body?: string };

export function App({ store, dataDirectory }: { store: NotesStore; dataDirectory: string }) {
  const workspace = useSyncExternalStore((listener) => store.subscribe(listener), () => store.getSnapshot());
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<EditorMode>("edit");
  const [focusMode, setFocusMode] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [mobileEditor, setMobileEditor] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const searchRef = useRef<PublicInstance>(null);
  const renderer = useGpuixRequired();
  const { width } = useWindowSize();
  const narrow = width < 780;
  const showSidebar = !focusMode && (width >= 1120 || navigationOpen);
  const color = palettes[workspace.theme];
  const search = query.trim().toLocaleLowerCase();
  const notes = workspace.notes.filter((note) => {
    if (view === "trash" ? !note.trashedAt : note.trashedAt) return false;
    if (view === "pinned" && !note.pinned) return false;
    if (typeof view === "object" && note.notebookId !== view.notebookId) return false;
    return !search || `${note.title}\n${note.body}`.toLocaleLowerCase().includes(search);
  }).sort((a, b) => Number(b.pinned) - Number(a.pinned) || (oldestFirst ? a.updatedAt.localeCompare(b.updatedAt) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
  const selected = notes.find((note) => note.id === workspace.selectedNoteId) ?? notes[0];
  const note = selected ? { ...selected, ...drafts[selected.id] } : undefined;
  const notebook = workspace.notebooks.find((item) => item.id === note?.notebookId);
  const title = typeof view === "object" ? workspace.notebooks.find((item) => item.id === view.notebookId)?.name ?? "Notebook" : view === "pinned" ? "Pinned notes" : view === "trash" ? "Trash" : "All notes";

  function run(action: () => void) {
    try { action(); setError(""); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }

  function newNote() {
    run(() => {
      const created = store.createNote(typeof view === "object" ? view.notebookId : undefined);
      store.selectNote(created.id);
      if (view === "trash" || view === "pinned") setView("all");
      setQuery("");
      setMode("edit");
      setMobileEditor(true);
      setNavigationOpen(false);
    });
  }

  function changeNote(patch: Draft) {
    if (!note || note.trashedAt) return;
    const id = note.id;
    const pending = { ...drafts[id], ...patch };
    setDrafts((current) => ({ ...current, [id]: pending }));
    run(() => {
      store.updateNote(id, pending);
      setDrafts((current) => { const next = { ...current }; delete next[id]; return next; });
    });
  }

  function retry() {
    run(() => {
      for (const [id, draft] of Object.entries(drafts)) store.updateNote(id, draft);
      setDrafts({});
    });
  }

  function openSearch() {
    setFocusMode(false);
    setMobileEditor(false);
    if (searchRef.current) renderer.focusElement?.(searchRef.current.id);
  }

  function onKeyDown(event: KeyEvent) {
    if (dialog || !(event.modifiers?.cmd || event.modifiers?.ctrl)) return;
    const key = event.key?.toLowerCase();
    if (key === "n") { event.preventDefault(); newNote(); }
    else if ((key === "p" && !event.modifiers?.shift) || key === "k") { event.preventDefault(); openSearch(); }
    else if (key === "p" && event.modifiers?.shift) { event.preventDefault(); setMode(mode === "preview" ? "edit" : "preview"); }
    else if (key === "f" && event.modifiers?.shift) { event.preventDefault(); setFocusMode(!focusMode); }
    else if (key === "o") { event.preventDefault(); setDialog({ kind: "import" }); }
    else if (key === "4" || key === "5" || key === "6") { event.preventDefault(); setMode(key === "4" ? "edit" : key === "5" ? "split" : "preview"); }
    else if (key === "s") { event.preventDefault(); retry(); }
  }

  function importFiles(paths: string[]) {
    run(() => {
      const imported = store.importMarkdown(paths, typeof view === "object" ? view.notebookId : undefined);
      if (imported[0]) store.selectNote(imported[0].id);
      setView("all"); setQuery(""); setMode("edit");
      setNotice(`Imported ${imported.length} ${imported.length === 1 ? "note" : "notes"}. Original files unchanged.`);
    });
  }

  function confirmDialog(value: string) {
    if (!dialog) return;
    if (dialog.kind === "notebook") {
      const created = store.createNotebook(value);
      setView({ notebookId: created.id }); setQuery("");
    } else if (dialog.kind === "rename") store.renameNotebook(dialog.id, value);
    else if (dialog.kind === "move") store.updateNote(dialog.id, { notebookId: value });
    else if (dialog.kind === "import") {
      const imported = store.importMarkdown([value], typeof view === "object" ? view.notebookId : undefined);
      if (imported[0]) store.selectNote(imported[0].id);
      setView("all"); setQuery(""); setMode("edit");
      setNotice("Markdown imported. Original file unchanged.");
    } else if (dialog.kind === "export") {
      if (drafts[dialog.id]) store.updateNote(dialog.id, drafts[dialog.id]);
      const destination = store.exportMarkdown(dialog.id, value || homedir());
      setNotice(`Exported to ${destination}`);
    } else if (dialog.kind === "delete") store.deleteNote(dialog.id);
    setDialog(null);
  }

  function openLink(value: string) {
    run(() => {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:" && url.protocol !== "mailto:") throw new Error("Only http, https and mailto links can open outside Still Notes.");
      const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
      const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url.href] : [url.href];
      const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
      child.on("error", (cause) => setError(`Could not open link: ${cause.message}`));
      child.on("exit", (code) => { if (code) setError(`Link opener exited with code ${code}.`); });
      child.unref();
    });
  }

  return (
    <div ref={(instance) => { if (instance) registerFonts(renderer); }} testId="app" onKeyDown={onKeyDown} onFileDrop={(event) => importFiles(event.paths ?? [])} style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", backgroundColor: color.sidebar, color: color.foreground, fontFamily: "Inter" }}>
      <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0 }}>
        {showSidebar && <Sidebar color={color} notebooks={workspace.notebooks} notes={workspace.notes} view={view} onView={(next) => { setView(next); setQuery(""); setNavigationOpen(false); setMobileEditor(false); }} onNewNotebook={() => setDialog({ kind: "notebook" })} onRename={(item) => setDialog({ kind: "rename", id: item.id, name: item.name })} onImport={() => setDialog({ kind: "import" })} />}
        <div style={{ display: "flex", flexDirection: "column", flexGrow: 1, minWidth: 0, paddingRight: 8, paddingBottom: 8, paddingLeft: showSidebar ? 0 : 8 }}>
          <div style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 62, flexShrink: 0, gap: 12, paddingLeft: 8, paddingRight: 4 }}>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8 }}>
              {!showSidebar && <Button color={color} icon="menu" label="Show notebooks" onClick={() => { setFocusMode(false); setNavigationOpen(true); }} />}
              {!showSidebar && !narrow && <Label color={color} weight={600}>Still Notes</Label>}
            </div>
            <div style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 8, width: narrow ? "60%" : 340, paddingLeft: 12, paddingRight: 12, backgroundColor: color.background, borderRadius: 12, borderWidth: 1, borderColor: color.border, height: 36 }}>
              <Icon name="search" color={color.mutedForeground} size={15} />
              <input ref={searchRef} testId="search" aria-label="Search notes in current view" value={query} placeholder="Search your notes…" onChange={(event) => { setQuery(event.value ?? ""); setMobileEditor(false); setFocusMode(false); }} style={{ ...inputStyle(color), height: 32, padding: 0, borderWidth: 0, flexGrow: 1, minWidth: 0 }} />
              {!narrow && <Label color={color} size={11} muted>{process.platform === "darwin" ? "⌘ P" : "Ctrl P"}</Label>}
            </div>
            <div style={{ display: "flex", flexDirection: "row", gap: 4 }}>
              {!showSidebar && <Button color={color} icon="upload" label="Import Markdown" testId="import" onClick={() => setDialog({ kind: "import" })} />}
              <Button color={color} icon={workspace.theme === "light" ? "moon" : "sun"} label={workspace.theme === "light" ? "Use dark theme" : "Use light theme"} testId="theme-toggle" onClick={() => run(() => store.setTheme(workspace.theme === "light" ? "dark" : "light"))} />
              <Button color={color} icon="help" label="Help and keyboard shortcuts" testId="help" onClick={() => setDialog({ kind: "help" })} />
            </div>
          </div>
          {error && <div role="alert" style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: 12, gap: 12, backgroundColor: color.background, borderWidth: 1, borderColor: color.destructive, borderRadius: 12, marginBottom: 8 }}>
            <text style={{ color: color.destructive, fontFamily: "Inter", fontSize: 12, flexGrow: 1 }}>{`${error}${Object.keys(drafts).length ? " Your edits remain in this window. Retry before closing." : ""}`}</text>
            {Object.keys(drafts).length > 0 && <Button color={color} onClick={retry}>Retry save</Button>}
            {Object.keys(drafts).length === 0 && <Button color={color} icon="close" label="Dismiss error" onClick={() => setError("")} />}
          </div>}
          {notice && <div style={{ display: "flex", flexDirection: "row", alignItems: "center", padding: 12, gap: 12, backgroundColor: color.background, borderRadius: 12, marginBottom: 8 }}><text testId="notice" role="status" style={{ color: color.foreground, fontFamily: "Inter", fontSize: 12, flexGrow: 1 }}>{notice}</text><Button color={color} icon="close" label="Dismiss notice" onClick={() => setNotice("")} /></div>}
          <div style={{ display: "flex", flexDirection: "row", flexGrow: 1, minHeight: 0, backgroundColor: color.background, borderRadius: 16, borderWidth: 1, borderColor: color.border, overflow: "hidden" }}>
            {!focusMode && (!narrow || !mobileEditor) && <NoteList color={color} notes={notes} selectedId={note?.id} title={title} query={query} onSelect={(id) => run(() => { store.selectNote(id); setMobileEditor(true); })} onNew={newNote} trash={view === "trash"} oldestFirst={oldestFirst} onSort={() => setOldestFirst(!oldestFirst)} />}
            {note && (!narrow || mobileEditor || focusMode) ? <Editor color={color} note={note} notebookName={notebook?.name ?? "Notebook"} mode={mode} onMode={setMode} onChange={changeNote} onPin={() => run(() => store.togglePin(note.id))} onTrash={() => run(() => { store.trashNote(note.id); setMobileEditor(false); })} onRestore={() => run(() => { store.restoreNote(note.id); setView("all"); })} onDelete={() => setDialog({ kind: "delete", id: note.id, title: note.title })} onExport={() => setDialog({ kind: "export", id: note.id })} onMove={() => setDialog({ kind: "move", id: note.id })} onLink={openLink} focusMode={focusMode} onFocusMode={() => { setFocusMode(!focusMode); setNavigationOpen(false); }} dirty={Boolean(drafts[note.id])} narrow={narrow} onBack={() => setMobileEditor(false)} /> : !narrow && <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, flexGrow: 1, padding: 40 }}><Icon name="book" color={color.mutedForeground} size={36} /><Label color={color} size={20} weight={500}>{query ? "Nothing found. Something next?" : view === "trash" ? "Nothing to let go of." : "A quiet place to begin."}</Label><Label color={color} muted>{query ? "Search another thought, or start a new one." : "Select a note, or put your first thought on a page."}</Label>{view !== "trash" && <Button color={color} icon="plus" variant="primary" onClick={newNote}>Write a note</Button>}</div>}
          </div>
        </div>
      </div>
      {dialog && <AppDialog key={JSON.stringify(dialog)} state={dialog} color={color} onClose={() => setDialog(null)} onConfirm={confirmDialog} notebooks={workspace.notebooks} dataDirectory={dataDirectory} />}
    </div>
  );
}
