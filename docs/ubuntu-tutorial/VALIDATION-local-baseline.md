# 验证记录与边界

验证日期：2026-10-21。基线提交 `2982dba89086d834c3cf4654e80701ebd2faea12`，修改分支 `fix/ubuntu-web-comfyui`。

## 本机条件

Ubuntu 22.04；RTX 4090 D 24 GB；约 32 GB 内存；Node.js 22.23.1；npm 10.9.8；安装后磁盘约 73 GiB 可用。使用已有 ComfyUI 0.30.0 和 Z-Image 模型，未重复下载权重。

## 已完成

| 检查 | 结果 |
| --- | --- |
| 原版 Web 问题复现 | `npm run web` 仍构建 Electron 并尝试下载桌面二进制 |
| 本分支 Web 启动 | 仅启动本机 Vite，不实例化 Electron 插件 |
| 类型与构建 | `npm run build:web` 通过 TypeScript、源码检查、打包检查 |
| 代理回归 | `npm run test:web` 通过：固定目标、POST 请求、JSON、查询参数、二进制、隔离响应头 |
| 浏览器首页 | 全新隔离测试上下文，无 LLM Key 能打开首页 |
| 项目保存 | 创建项目、刷新恢复通过 |
| 教材 JSON | 经设置页文件选择器导入，三镜头正确显示 |
| ComfyUI 配置 | 通过页面添加接入、连接测试、导入 API 模板、保存手动映射 |
| 真实生图 | 在配图页点击生成，得到 1024×1024 PNG；约 32.0 秒；刷新后图片保留 |
| FFmpeg 导出 | 调用实际浏览器导出模块生成约 3 秒 MP4，H.264/AAC、640×360、24 fps |
| 构建预览 | 4173 页面、FFmpeg 本地核心加载、浏览器隔离和 ComfyUI 代理通过 |
| 教材检查 | 47 个 Markdown 本地链接、HTML 链接与唯一目录 ID、示例 JSON 全部通过；1440/390/320 px 无水平溢出，离线阅读通过 |
| 示例节点 | Z-Image 10 个节点、H3 14 个节点及模型选项与本机 object_info 对照通过 |

完整的机器可读结果见 [validation.json](validation-local-baseline.json)。示例 [generated.png](examples/generated.png) 来自上述界面生成；[export-smoke.mp4](examples/export-smoke.mp4) 是该图片经浏览器 FFmpeg 合成的视频，不是 H3 动态视频。

运行了独立无头 Chrome 自动化测试，使用隔离浏览器上下文；不会把测试项目或密钥写进你的日常浏览器。首次自己打开工作台时，仍需按教材导入项目与配置。

## 未验证

- 未制作或验收 Ubuntu 原生桌面安装包；Windows Electron 路线未做完整回归。
- 未调用收费云端 LLM、视觉理解、TTS 或云端视频接口。
- 本次没有重跑 H3 推理、图生视频、首尾帧、Ref2VA、长片续接、口型或 Turbo。
- 未把三镜头全部生成成动态影片。教材的 15 秒作品是学习任务，附带视频是 3 秒环境验证样例。
- 导出模块验证通过，不等于所有字幕样式、长视频和复杂时间线都已经验收。

## 维护教材

```bash
python docs/ubuntu-tutorial/tools/build_book.py
```

生成器需要 Python Markdown。修改章节后重建 index.html，并检查本地链接与手机宽度。章节顺序由文件名前缀控制。
