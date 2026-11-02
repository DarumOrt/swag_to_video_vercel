/**
 * Where the exported file goes, so long / 4K exports never hold the whole file in memory:
 *   1. File System Access (`showSaveFilePicker`) — written straight to the user's file;
 *   2. OPFS (origin-private file system) — written to disk, then offered as a download;
 *   3. memory — the classic Blob + download (when neither API exists).
 */

import type { VideoContainer } from '@/shared'

export type SaveTargetKind = 'file' | 'opfs' | 'memory'

export interface SaveTarget {
  kind: SaveTargetKind
  /**
   * File to stream into; null for `memory`. Pass it to `exportVideoInWorker({ file })`,
   * or call `createWritable()` and pass the stream to `exportVideo({ writable })`.
   */
  file: FileSystemFileHandle | null
  /** Display name of the output file. */
  name: string
  /**
   * `opfs`: removes the OPFS copy. `file`: after a failed or cancelled export, removes the empty
   * file the picker created (only if it is still 0 bytes, so a user's existing file is never lost).
   * `memory`: no-op.
   */
  cleanup(): Promise<void>
}

interface SaveFilePickerWindow {
  showSaveFilePicker(options: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }): Promise<FileSystemFileHandle>
}

const MIME: Record<VideoContainer, string> = { mp4: 'video/mp4', webm: 'video/webm' }

export function hasFilePicker(): boolean {
  return typeof window !== 'undefined' && 'showSaveFilePicker' in window
}

export function hasOpfs(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

/** `Track name.mp4`, without characters Windows rejects in file names. */
export function exportFileName(baseName: string, container: VideoContainer): string {
  const clean = baseName.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video'
  return `${clean}.${container}`
}

/** `FileSystemHandle.remove()` — Chrome/Edge 110+, not in the TS DOM lib yet. */
async function removeIfEmpty(file: FileSystemFileHandle): Promise<void> {
  try {
    if ((await file.getFile()).size > 0) return
    await (file as FileSystemFileHandle & { remove?: () => Promise<void> }).remove?.()
  } catch {
    // Permission revoked or file already gone — nothing to clean.
  }
}

const OPFS_DIR = 'exports'

async function opfsTarget(name: string): Promise<SaveTarget> {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true })
  // Unique name: an earlier export with the same name may still be downloading.
  const opfsName = `${Date.now()}-${name}`
  const file = await dir.getFileHandle(opfsName, { create: true })
  return {
    kind: 'opfs',
    file,
    name,
    cleanup: async () => {
      await dir.removeEntry(opfsName).catch(() => {})
    },
  }
}

/**
 * Asks where to save the export. **Call it directly from a click handler, before any other
 * `await`** — `showSaveFilePicker` requires a fresh user gesture.
 *
 * Rejects with `AbortError` when the user closes the picker.
 * `prefer: 'opfs'` skips the picker (e.g. for automated runs or a "quick export" button).
 */
export async function pickSaveTarget(
  baseName: string,
  container: VideoContainer,
  options: { prefer?: SaveTargetKind } = {},
): Promise<SaveTarget> {
  const name = exportFileName(baseName, container)
  const prefer = options.prefer ?? 'file'
  if (prefer === 'file' && hasFilePicker()) {
    const file = await (window as unknown as SaveFilePickerWindow).showSaveFilePicker({
      suggestedName: name,
      types: [
        {
          description: container === 'mp4' ? 'MP4 video' : 'WebM video',
          accept: { [MIME[container]]: [`.${container}`] },
        },
      ],
    })
    return { kind: 'file', file, name: file.name, cleanup: () => removeIfEmpty(file) }
  }
  if (prefer !== 'memory' && hasOpfs()) {
    try {
      return await opfsTarget(name)
    } catch {
      // OPFS can be unavailable (e.g. private mode); fall through to memory.
    }
  }
  return { kind: 'memory', file: null, name, cleanup: async () => {} }
}

/** Starts a browser download of `blob` (an in-memory Blob or a disk-backed OPFS File). */
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // The download keeps its own reference; revoke later so slow starts are not cut off.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Finishes a successful export: for `opfs` downloads the written file (disk-backed, not copied
 * into memory) and schedules its removal; for `memory` downloads `blob`; for `file` does nothing.
 */
export async function deliverExport(target: SaveTarget, blob: Blob | null): Promise<void> {
  if (target.kind === 'file') return
  if (target.kind === 'memory') {
    if (blob) downloadBlob(blob, target.name)
    return
  }
  const file = await target.file!.getFile()
  downloadBlob(file, target.name)
  // Chrome reads the OPFS file while downloading; remove it only after that has had time to finish.
  setTimeout(() => void target.cleanup(), 10 * 60_000)
}

/** Deletes OPFS leftovers of earlier sessions (exports that crashed or were never downloaded). */
export async function clearOpfsExports(): Promise<void> {
  if (!hasOpfs()) return
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(OPFS_DIR, { recursive: true }).catch(() => {})
}
