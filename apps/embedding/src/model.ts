import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

type Manifest = { id: string; dimensions: number; windowCharacters: number; files: { path: string; size: number; sha256: string }[] };
const root = fileURLToPath(new URL('../', import.meta.url));
export const manifest: Manifest = JSON.parse(await readFile(join(root, 'model-manifest.json'), 'utf8'));
export type ModelState = 'loading' | 'ready' | 'failed';
export interface EmbeddingEngine {
  state: ModelState;
  embed(input: string[]): Promise<number[][]>;
}

export function splitWindows(text: string, size = manifest.windowCharacters): string[] {
  const characters = Array.from(text);
  const windows: string[] = [];
  for (let start = 0; start < characters.length; start += size) windows.push(characters.slice(start, start + size).join(''));
  return windows;
}

/** Preserve every text window instead of silently truncating at the model token limit. */
export async function encodeWindows(input: string[], encode: (text: string) => Promise<number[]>): Promise<number[][]> {
  const vectors: number[][] = [];
  for (const text of input) {
    const sum = Array<number>(manifest.dimensions).fill(0);
    for (const window of splitWindows(text)) {
      const vector = await encode(window);
      if (vector.length !== manifest.dimensions || vector.some(value => !Number.isFinite(value))) throw new Error('invalid_model_output');
      const weight = Array.from(window).length;
      for (let index = 0; index < sum.length; index++) sum[index] += vector[index] * weight;
    }
    const norm = Math.hypot(...sum);
    if (!Number.isFinite(norm) || norm === 0) throw new Error('invalid_model_output');
    vectors.push(sum.map(value => value / norm));
  }
  return vectors;
}

export async function createLocalEngine(threads: number): Promise<EmbeddingEngine> {
  const modelDirectory = join(root, '.models', manifest.id);
  for (const file of manifest.files) {
    const bytes = await readFile(join(modelDirectory, file.path));
    if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('model_files_invalid');
  }
  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = join(root, '.models') + sep;
  const extractor = await pipeline('feature-extraction', manifest.id, {
    device: 'cpu', dtype: 'q8', local_files_only: true,
    session_options: { intraOpNumThreads: threads, interOpNumThreads: 1 },
  });
  const encode = async (text: string) => {
    const tensor = await extractor(text, { pooling: 'cls', normalize: true });
    const result = tensor.tolist() as number[][];
    return result[0];
  };
  // Readiness requires a genuine inference, not merely loading the package.
  await encodeWindows(['软件工程实训'], encode);
  return { state: 'ready', embed: input => encodeWindows(input, encode) };
}
