import 'dotenv/config';
import { completeChat, loadAiConfig, AiError } from './model.js';

// This explicit command makes one real request and can incur model-provider charges.
const config = loadAiConfig();
if (!config) {
  console.error('模型尚未配置：请在 apps/api/.env 中设置 AI_BASE_URL、AI_MODEL 和 AI_API_KEY。');
  process.exitCode = 1;
} else {
  try {
    const answer = await completeChat(config, [{ role: 'user', content: '请只回复 OK。' }]);
    console.log(`模型连接成功：${config.model}；返回：${answer.slice(0, 120)}`);
  } catch (error) {
    console.error(`模型连接失败：${error instanceof AiError ? error.code : 'unknown_error'}`);
    process.exitCode = 1;
  }
}
