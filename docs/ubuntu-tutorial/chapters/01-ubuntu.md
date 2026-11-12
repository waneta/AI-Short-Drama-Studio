# 第 01 章：在 Ubuntu 启动剧流

## 本章目标

打开 `http://127.0.0.1:5173`，确认 Web 界面和剪辑核心可用。云端阶段不要求启动 ComfyUI。

## 1. 认识仓库位置

本机 `references/AI-Short-Drama-Studio` 是符号链接，真实 Git 仓库是：

```bash
cd /home/datamesh/github_waneta/AI-Short-Drama-Studio
git branch --show-current
```

本次修改分支为 `fix/ubuntu-web-comfyui`。代码和本书均放在这个独立仓库中。其它电脑使用自己的克隆目录，不要照搬上述绝对路径。

## 2. 首次安装

```bash
node --version
npm --version
# 本机已使用 Node 22；首次安装时跳过 Web 版不需要的 Electron 二进制。
ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
npm run setup:web
npm run web
```

本机本次已经完成依赖安装和核心准备，日常使用只需要 `npm run web`。如果提示端口占用，先打开现有页面；不要随意杀掉其它程序。

`setup:web` 从锁定版本的 `@ffmpeg/core@0.12.10` 复制 JS/WASM 到 `src/assets/ffmpeg/`。不会额外访问 CDN。本次上游下载脚本的 npmmirror 链接返回 404，因此推荐这个入口。

## 3. 打开网页

访问 **http://127.0.0.1:5173**。保持终端运行，按 Ctrl+C 停止。

- 这是 Ubuntu 浏览器版，本书没有制作 Linux 桌面安装包。
- Web 模式已跳过 Electron，不会为了显示网页启动桌面进程。
- 没有 LLM Key 也可以创建项目、配置本地 ComfyUI、剪辑本地素材。
- 固定使用同一个地址。`localhost:5173`、`127.0.0.1:5173`、`127.0.0.1:4173` 是不同的浏览器存储来源。

### 旧环境中的后台服务（可选）

此前环境曾把工作台托管为 `juliu-studio-web.service`。该服务不保证仍然存在；本次重做教程使用普通 Vite 进程启动 5173，未设置开机自启。页面已经可访问时，不要重复启动。

```bash
systemctl --user status juliu-studio-web.service
systemctl --user stop juliu-studio-web.service
# 同一次开机内，停止后可再次启动：
systemctl --user start juliu-studio-web.service
```

旧服务日志位于仓库 `.cache/ubuntu-web.log`。普通 Vite 进程日志在启动终端；退出或重启电脑后，用前面的 `npm run web` 启动即可。

## 4. 检查本机模型连接（本地阶段再做）

ComfyUI 在同一台机器的 `127.0.0.1:8188` 运行时：

```bash
curl --noproxy '*' -fsS http://127.0.0.1:5173/comfy-local/system_stats
```

预期返回系统与显卡的 JSON。浏览器通过剧流的固定目标代理访问 ComfyUI，无需开启 ComfyUI 的全来源 CORS，也无需把服务暴露到局域网。

如果你的 ComfyUI 改到了 8189：

```bash
COMFYUI_URL=http://127.0.0.1:8189 npm run web
```

同时在工作台填这个地址。变量只接受无路径、无账号信息的 HTTP(S) 地址，不要填 `/prompt`。

## 5. 检查剪辑核心与构建

进入“设置 → 系统”，找到 FFmpeg 的“现在加载”。预期提示就绪。

维护者检查命令：

```bash
npm run test:web
npm run build:web
npm run preview:web
```

构建预览地址是 `http://127.0.0.1:4173`，同样有代理与隔离响应头，但不会共享 5173 的浏览器项目。它是本机预览服务，不是生产部署方案。

## 验收与练习

- 打开首页而不是 Electron 报错窗口。
- 云端阶段可跳过 ComfyUI；进入本地阶段后再要求状态查询成功。
- 能解释为什么工作台 5173 和模型服务 8188 是两个端口。

下一章：[第一个项目](02-project.md)。
