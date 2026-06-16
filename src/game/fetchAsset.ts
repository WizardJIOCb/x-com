import { loadProgress, type AssetKind } from './LoadProgress';

function mergeChunks(chunks: Uint8Array[], total: number): ArrayBuffer {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

export async function fetchArrayBuffer(
  url: string,
  label: string,
  kind: AssetKind
): Promise<ArrayBuffer> {
  loadProgress.startFile(url, label, kind);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);

  const total = Number(res.headers.get('content-length')) || 0;
  const body = res.body;

  if (!body) {
    const buf = await res.arrayBuffer();
    loadProgress.reportFileBytes(url, buf.byteLength, buf.byteLength);
    loadProgress.completeFile(url, buf.byteLength);
    return buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    loadProgress.reportFileBytes(url, loaded, total || loaded);
  }

  loadProgress.completeFile(url, loaded);
  return mergeChunks(chunks, loaded);
}

export async function fetchBlob(url: string, label: string, kind: AssetKind): Promise<Blob> {
  const buffer = await fetchArrayBuffer(url, label, kind);
  return new Blob([buffer]);
}