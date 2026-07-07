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
}

function mediaFileName(nodeId: string, type: 'image' | 'video'): string {
  const ext = type === 'video' ? 'mp4' : 'png'
  return `${nodeId}_${Date.now()}.${ext}`
}

/** Check if File System Access API is available */
export function hasDirectorySupport(): boolean {
  return 'showDirectoryPicker' in window
}

/** Save workflow to a user-picked directory via File System Access API */
export async function saveWorkflowToDirectory(
  nodes: AppNode[],
  edges: Edge[],
  nodeOutputs: Record<string, { url: string; type: 'image' | 'video' }>,
  outputUrl: string | null,
  resultType: 'image' | 'video' | null,
): Promise<void> {
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })

  const mediaMap: Record<string, WorkflowMedia> = {}

  for (const [nodeId, entry] of Object.entries(nodeOutputs)) {
    if (!entry.url) continue
    const fileName = mediaFileName(nodeId, entry.type)
    const subDir = entry.type === 'video' ? 'videos' : 'images'

    try {
      const response = await fetch(entry.url)
      if (!response.ok) continue
      const blob = await response.blob()

      const dir = await dirHandle.getDirectoryHandle(subDir, { create: true })
      const fileHandle = await dir.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()

      mediaMap[nodeId] = { path: `${subDir}/${fileName}`, type: entry.type }
    } catch {
      // skip media that can't be fetched
    }
  }

  const workflow: WorkflowFile = {
    version: 2,
    nodes: nodes.map(({ id, type, position, data, width, height, hidden }) => ({
      id, type, position, data, width, height, hidden,
    })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, style }) => ({
      id, source, target, sourceHandle, targetHandle, style,
    })),
    outputUrl,
    resultType,
    media: mediaMap,
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
}> {
  const dirHandle = await window.showDirectoryPicker({ mode: 'read' })

  const jsonHandle = await dirHandle.getFileHandle('workflow.json')
  const file = await jsonHandle.getFile()
  const text = await file.text()
  const workflow: WorkflowFile = JSON.parse(text)

  if (!workflow.nodes || !workflow.edges) {
    throw new Error('Invalid workflow file')
  }

  const mediaBlobs: Record<string, { blob: Blob; type: 'image' | 'video' }> = {}

  for (const [nodeId, media] of Object.entries(workflow.media)) {
    try {
      const mediaFileHandle = await dirHandle.getFileHandle(media.path)
      const mediaFile = await mediaFileHandle.getFile()
      mediaBlobs[nodeId] = { blob: mediaFile, type: media.type }
    } catch {
      // skip media that can't be read
    }
  }

  return { workflow, mediaBlobs }
}

/** Fallback: save as JSON download (current behavior) */
export function downloadWorkflowJson(
  nodes: AppNode[],
  edges: Edge[],
  nodeOutputs: Record<string, { url: string; type: 'image' | 'video' }>,
  outputUrl: string | null,
  resultType: 'image' | 'video' | null,
): void {
  const mediaMap: Record<string, WorkflowMedia> = {}

  for (const [nodeId, entry] of Object.entries(nodeOutputs)) {
    mediaMap[nodeId] = {
      path: entry.url,
      type: entry.type,
    }
  }

  const workflow: WorkflowFile = {
    version: 2,
    nodes: nodes.map(({ id, type, position, data, width, height, hidden }) => ({
      id, type, position, data, width, height, hidden,
    })),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle, style }) => ({
      id, source, target, sourceHandle, targetHandle, style,
    })),
    outputUrl,
    resultType,
    media: mediaMap,
  }

  const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `workflow-${Date.now()}.aimation`
  a.click()
  URL.revokeObjectURL(url)
}
