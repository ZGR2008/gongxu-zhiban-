# V10 源码评审包

完整真实历史请使用[公开仓库](https://github.com/ZGR2008/gongxu-zhiban-)。本地导出 ZIP 不包含 `.git`，不能代替历史评审。

## 当前源码包

在仓库根目录运行，Python 环境需安装 `pypdf`：

```sh
python scripts/export-review.py --version v10 --profile current
python scripts/export-review.test.py
```

结果写入仓库父目录新建的 `.review-export/v10-时间戳/`。每次新建独立目录，不覆盖旧包，不读取真实 `.env`，不上传。

当前范围保留应用源码、25 个迁移、依赖与锁文件、配置模板、许可证、课程源码、录制工具、测试、合成夹具、当前说明及必要历史证据。也保留[部署说明](DEPLOYMENT.md)及经核对的 `scripts/production-proxy.patch`；其他未经审核的补丁在读取前排除。`docs/archive/`、旧生成附件、依赖目录、运行数据、模型权重和凭据文件不进入当前源码包。应用内部的星环降级页面仍保留，不因目录名为 archive 而排除。

导出器会对副本做模式脱敏及元数据处理，重新生成包内 `SOURCE-PACKAGE-MANIFEST.json`。因此 ZIP 不是仓库逐字节镜像；应结合清单核对变更规则。PowerShell 文件原有 UTF-8 BOM 应保留，回归测试覆盖此项。

## 历史工具的适用范围

`--profile edition` 保留旧版白名单逻辑，主要用于历史导出回归。`verify-candidate-v8.py`、`verify-candidate-v9.py`、`verify-candidate-v10.py` 校验的是当时固定候选、旧附件文本及源文件哈希，不能作为当前整理版验收入口；复现历史包应检出相应历史提交。当前 ZIP 以本轮实际导出、清单哈希与回归结果为准。

历史 PPT/PDF 生成工具仍保留，输入位于仓库归档或旧截图目录；当前源码 ZIP 不包含旧 PPT 等二进制归档，因此不承诺在 ZIP 内重建旧演示稿。录制工具与课程源码的必要输入继续保留。

模式扫描不能证明不存在任何未知敏感信息；需要新增资料时仍应逐项确认。历史内容不会因当前目录整理而从 Git 中消失。
