import 'dotenv/config';
import { manifest } from './model.js';

const port = Number(process.env.LOCAL_EMBEDDING_PORT ?? 3010);
const input = ['如何为登录接口设计边界测试？', '登录接口测试应覆盖空密码、长度边界、错误密码和重复提交。', '春天的公园里花朵盛开，游客在湖边拍照。'];
try {
  const response = await fetch(`http://127.0.0.1:${port}/v1/embeddings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: manifest.id, input }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error('embedding_request_failed');
  const result = await response.json() as { data: { index: number; embedding: number[] }[] };
  const vectors = result.data.sort((a, b) => a.index - b.index).map(item => item.embedding);
  if (vectors.length !== input.length || vectors.some(vector => vector.length !== manifest.dimensions || vector.some(n => !Number.isFinite(n)))) throw new Error('embedding_response_invalid');
  const cosine = (a: number[], b: number[]) => a.reduce((sum, value, i) => sum + value * b[i], 0) / (Math.hypot(...a) * Math.hypot(...b));
  const relevant = cosine(vectors[0], vectors[1]), unrelated = cosine(vectors[0], vectors[2]);
  console.log(JSON.stringify({ realInference: true, vectors: vectors.length, dimensions: manifest.dimensions, relevantSimilarity: Number(relevant.toFixed(4)), unrelatedSimilarity: Number(unrelated.toFixed(4)), correctRanking: relevant > unrelated }));
  if (relevant <= unrelated) process.exitCode = 1;
} catch { console.error(JSON.stringify({ realInference: false, error: 'local_embedding_check_failed' })); process.exitCode = 1; }
