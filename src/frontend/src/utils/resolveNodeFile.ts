import { useGraphStore } from '../store/graph'
import type { GroupNodeData } from '../types/nodes'

async function getFileFromNodeData(nodeData: Record<string, unknown>): Promise<File | undefined> {
  if (!nodeData) return undefined
  if (nodeData.file instanceof File) return nodeData.file
  if (typeof nodeData.fileDataUrl === 'string' && nodeData.fileDataUrl) {
    const r = await fetch(nodeData.fileDataUrl)
    const blob = await r.blob()
    return new File([blob], (nodeData.fileName as string) || 'file', { type: blob.type })
  }
  return undefined
}

export async function resolveNodeFile(sourceNodeId: string, visited?: Set<string>): Promise<File | undefined> {
  const store = useGraphStore.getState()
  const sourceNode = store.nodes.find((n) => n.id === sourceNodeId)
  if (!sourceNode) return undefined

  const nd = sourceNode.data as Record<string, unknown>
  const file = await getFileFromNodeData(nd)
  if (file) return file

  const output = store.nodeOutputs[sourceNodeId]
  if (output?.url) {
    const r = await fetch(output.url)
    const blob = await r.blob()
    return new File([blob], 'output', { type: blob.type })
  }

  if (sourceNode.type === 'groupNode') {
    const childIds = ((sourceNode.data as GroupNodeData).childIds || []) as string[]
    for (const cid of childIds) {
      const co = store.nodeOutputs[cid]
      if (co?.url) {
        const r = await fetch(co.url)
        const blob = await r.blob()
        return new File([blob], 'group-output', { type: blob.type })
      }
    }
  }

  if (sourceNode.type === 'preview' || sourceNode.type === 'groupNode') {
    const guard = visited ?? new Set<string>()
    if (guard.has(sourceNodeId)) return undefined
    guard.add(sourceNodeId)
    const incoming = store.edges.find((e) => e.target === sourceNodeId)
    if (incoming) return resolveNodeFile(incoming.source, guard)
  }

  return undefined
}
