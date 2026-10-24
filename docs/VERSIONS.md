# Version history

**History** in the top bar lists versions of the open project, newest first, and restores any of them.
Undo covers the current session step by step; versions are snapshots that survive reloads, so the
designer can go back to how the video looked before a change Claude made yesterday.

## When a version is saved

- when a project is opened ("Opened …"), including a new scene Claude created;
- after every change Claude makes, from the Ask Claude tab, a frame comment, the quality check's
  **Ask Claude to fix**, or the chat ("Claude: <its summary>");
- by hand, with **Save a version now** in the dialog.

Restoring saves the current state first, then loads the version as one ordinary edit, so Undo takes
it back.

## Storage

`src/store/versions.ts` keeps versions in this browser's IndexedDB (`motion-studio-versions`), at most
60 per project; older ones are dropped. A version holds the project's text files and entry; assets
(images, fonts, audio) are left out because they rarely change and would fill the storage, so a
restored version uses the project's current assets. Without IndexedDB (private windows of some
browsers) versions live in memory for the session.

Versions stay in the browser that made them. To keep or move a project, use **Save** (a `.zip`).
