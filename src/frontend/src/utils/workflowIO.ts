import type { Edge } from '@xyflow/react'
import type { AppNode } from '../types/nodes'

declare global {
  interface FileSystemDirectoryHandle {
    values(): AsyncIterableIterator<FileSystemDirectoryHandle | FileSystemFileHandle>
  }
  interface Window {
    showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
  }
}

export interface WorkflowMedia {
  path: string
  type: 'image' | 'video'
}

export interface WorkflowFile {
  version: number
  nodes: AppNode[]
  edges: Edge[]
  outputUrl: string | null
  resultType: 'image' | 'video' | null
  media: Record<string, WorkflowMedia>
  autoPreviews: Record<string, WorkflowMedia>
}

type MediaMap = Record<string, { url: string; type: 'image' | 'video' }>

function mediaFileName(nodeId: string, type: 'image' | 'video'): string {
  const ext = type === 'video' ? 'mp4' : 'png'
  return `${nodeId}_${Date.now()}.${ext}`
}

/** Traverse a nested path like "images/foo.png" from a directory handle */
async function getFileByPath(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle> {
  const parts = path.split('/')
  let current: FileSystemDirectoryHandle = dirHandle
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i])
  }
  return current.getFileHandle(parts[parts.length - 1])
}

/** Check if File System Access API is available */
export function hasDirectorySupport(): boolean {
  return 'showDirectoryPicker' in window
}

/** Save a media map to a subfolder structure, returns the media paths map */
async function saveMediaMap(
  dirHandle: FileSystemDirectoryHandle,
  media: MediaMap,
  basePath: string,
): Promise<Record<string, WorkflowMedia>> {
  const result: Record<string, WorkflowMedia> = {}

  for (const [nodeId, entry] of Object.entries(media)) {
    if (!entry.url) continue
    const fileName = mediaFileName(nodeId, entry.type)
    const subDir = entry.type === 'video' ? 'videos' : 'images'
    const fullSubDir = `${basePath}/${subDir}`

    try {
      const response = await fetch(entry.url)
      if (!response.ok) continue
      const blob = await response.blob()

      const parts = fullSubDir.split('/')
      let current = dirHandle
      for (const part of parts) {
        current = await current.getDirectoryHandle(part, { create: true })
      }
      const fileHandle = await current.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()

      result[nodeId] = { path: `${fullSubDir}/${fileName}`, type: entry.type }
    } catch {
      // skip media that can't be fetched
    }
  }

  return result
}

/** Load a media map from a subfolder structure */
async function loadMediaMap(
  dirHandle: FileSystemDirectoryHandle,
  mediaPaths: Record<string, WorkflowMedia>,
): Promise<Record<string, { blob: Blob; type: 'image' | 'video' }>> {
  const result: Record<string, { blob: Blob; type: 'image' | 'video' }> = {}

  for (const [nodeId, media] of Object.entries(mediaPaths)) {
    try {
      const mediaFileHandle = await getFileByPath(dirHandle, media.path)
      const mediaFile = await mediaFileHandle.getFile()
      result[nodeId] = { blob: mediaFile, type: media.type }
    } catch {
      // skip media that can't be read
    }
  }

  return result
}

/** Save workflow to a user-picked directory via File System Access API */
export async function saveWorkflowToDirectory(
  nodes: AppNode[],
  edges: Edge[],
  nodeOutputs: MediaMap,
  autoPreviews: MediaMap,
  outputUrl: string | null,
  resultType: 'image' | 'video' | null,
): Promise<void> {
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })

  const mediaMap = await saveMediaMap(dirHandle, nodeOutputs, '')
  const previewMap = await saveMediaMap(dirHandle, autoPreviews, 'previews')

  const workflow: WorkflowFile = {
    version: 3,
    nodes: nodes.map(({ id, type, position, data, width, height, hidden }) => ({
      id, type, position, data, width, height, hidden,
    })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, style }) => ({
      id, source, target, sourceHandle, targetHandle, style,
    })),
    outputUrl,
    resultType,
    media: mediaMap,
    autoPreviews: previewMap,
  }

  const jsonHandle = await dirHandle.getFileHandle('workflow.json', { create: true })
  const writable = await jsonHandle.createWritable()
  await writable.write(JSON.stringify(workflow, null, 2))
  await writable.close()
}

/** Load workflow from a user-picked directory via File System Access API */
export async function loadWorkflowFromDirectory(): Promise<{
  workflow: WorkflowFile
  mediaBlobs: Record<string, { blob: Blob; type: 'image' | 'video' }>
  previewBlobs: Record<string, { blob: Blob; type: 'image' | 'video' }>
}> {
  const dirHandle = await window.showDirectoryPicker({ mode: 'read' })

  const jsonHandle = await dirHandle.getFileHandle('workflow.json')
  const file = await jsonHandle.getFile()
  const text = await file.text()
  const workflow: WorkflowFile = JSON.parse(text)

  if (!workflow.nodes || !workflow.edges) {
    throw new Error('Invalid workflow file')
  }

  const mediaBlobs = await loadMediaMap(dirHandle, workflow.media ?? {})
  const previewBlobs = await loadMediaMap(dirHandle, workflow.autoPreviews ?? {})

  return { workflow, mediaBlobs, previewBlobs }
}

/** Fallback: save as JSON download (current behavior) */
export function downloadWorkflowJson(
  nodes: AppNode[],
  edges: Edge[],
  nodeOutputs: MediaMap,
  autoPreviews: MediaMap,
  outputUrl: string | null,
  resultType: 'image' | 'video' | null,
): void {
  const mediaMap: Record<string, WorkflowMedia> = {}
  for (const [nodeId, entry] of Object.entries(nodeOutputs)) {
    mediaMap[nodeId] = { path: entry.url, type: entry.type }
  }

  const previewMap: Record<string, WorkflowMedia> = {}
  for (const [nodeId, entry] of Object.entries(autoPreviews)) {
    previewMap[nodeId] = { path: entry.url, type: entry.type }
  }

  const workflow: WorkflowFile = {
    version: 3,
    nodes: nodes.map(({ id, type, position, data, width, height, hidden }) => ({
      id, type, position, data, width, height, hidden,
    })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, style }) => ({
      id, source, target, sourceHandle, targetHandle, style,
    })),
    outputUrl,
    resultType,
    media: mediaMap,
    autoPreviews: previewMap,
  }

  const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `workflow-${Date.now()}.aimation`
  a.click()
  URL.revokeObjectURL(url)
}
