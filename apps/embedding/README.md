# 本地中文向量服务

此服务为工序智伴的 RAG 提供独立的 `/v1/embeddings` 接口。使用 Windows/Linux/macOS 上的 CPU 推理，不需要 Docker、GPU 或额外的模型 API 密钥。服务只能监听 `127.0.0.1`，请勿将端口代理到公网。

## 模型和可复现性

- 原模型：[BAAI/bge-small-zh-v1.5](https://huggingface.co/BAAI/bge-small-zh-v1.5)，中文句向量，512 维；原项目为 [FlagEmbedding](https://github.com/FlagOpen/FlagEmbedding)。
- ONNX 转换版本：[Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5)，固定提交 `75c43b069aac4d136ba6bc1122f995fedcfd2781`。
- 本地运行库固定为 Transformers.js 3.8.1，使用 q8 量化、CLS 池化和 L2 归一化。量化权重约 24 MB。
- 输入超过 400 个 Unicode 字符时逐段编码，再按片段长度加权并归一化，避免把后面的文本静默截断。该处理方式计入服务的模型 ID；若调整权重、池化或分段策略，必须更换 ID 并重新建立知识库索引。
- `model-manifest.json` 固定模型文件大小和 SHA-256；下载及每次启动均检查，模型运行时禁止网络下载。模型文件保存在被 Git 忽略的 `.models/`。

## 下载和运行

在仓库根目录运行：

```sh
pnpm install
pnpm --filter @gongxu/embedding model:download
pnpm --filter @gongxu/embedding build
pnpm --filter @gongxu/embedding start
```

默认从 Hugging Face 官方源下载。如果官方源无法连接，可以明确选择镜像：

```sh
pnpm --filter @gongxu/embedding model:download --mirror
```

镜像使用 `https://hf-mirror.com`，下载来源保存在本地模型目录的 `download-source.json`。清单中的哈希用于校验固定文件的一致性；镜像来源的元数据不能视为独立的官方签名或认证。

可复制本目录 `.env.example` 为 `.env` 修改本地端口和 CPU 线程数。默认端口为 3010，推理线程数为 2。

在主 API 的**本地** `apps/api/.env` 中配置以下非敏感项，保持已有聊天模型密钥不变：

```dotenv
EMBEDDING_BASE_URL=http://127.0.0.1:3010/v1
EMBEDDING_API_KEY=
EMBEDDING_MODEL=bge-small-zh-v1.5-q8-75c43b0-cls-w400-v1
```

修改主 API 配置后重启 API。DeepSeek 只负责聊天和生成，不能填写为向量服务地址。

## 实际验证

```sh
pnpm --filter @gongxu/embedding check
```

该命令调用真实本地接口，检查返回数量、512 维向量以及一组中文相关/无关资料的相似度排序。不会调用收费聊天接口，也不输出原始向量。单组排序检查是烟雾测试，不代表完整检索质量评估。

- `GET /health`：进程响应及模型加载状态。
- `GET /ready`：模型完成加载和真实预热后才返回 200；失败或加载中返回 503。
- `POST /v1/embeddings`：兼容 OpenAI 风格的 `model`、`input`、`data[].index/embedding` 结构；仅支持固定模型、文本输入与 float 编码。不虚构 token 用量。
- 每批最多 32 个文本，单条最多 12,000 字符，总计最多 32,000 字符。CPU 同时只处理一个请求，忙时返回 429；API 会如实显示服务错误。

服务测试使用独立测试替身验证加载、输入限制、并发和失败处理；真实推理通过上面的 `check` 命令单独验证。PostgreSQL 存储、pgvector 搜索和知识来源引用仍需在主数据库可用后联调。
