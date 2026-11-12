# 第 12 章：H3 视频生成选修

## 本章目标

了解如何接入已有 H3 文生视频工作流。先做一个短镜头，不直接挑战长片、口型和多角色一致性。

## 1. 明确本例边界

教材 [h3-t2v-api.json](../examples/h3-t2v-api.json)来自本机已有的 H3 验证工作流：864×480、124 帧、24 fps、20 步，约 5.17 秒，带音频输出。

虽然内部节点叫 `MiniMaxH3ImageToVideo`，本模板没有连接首帧图像，因此实际是**文生视频**。把一张图放在工作台上，不会自动让它变成图生视频。

底层 H3 配方有历史验证记录。本次 Ubuntu 工作台验收重点是 Z-Image 与浏览器剪辑，没有重新执行 H3 推理；下述接入属于选修待练习项。

## 2. 切换本机服务

确认 ComfyUI 队列为空：

```bash
curl --noproxy '*' -fsS http://127.0.0.1:8188/queue
```

只有运行和等待队列均为空时，在本机 ai-video-pipeline 仓库执行：

```bash
systemctl --user stop z-image-turbo.service
bash references/minimax-h3/start.sh
```

不要同时加载两套大模型。这个步骤使用你现有的 H3 启动配置，不是在剧流中安装 H3。

## 3. 添加独立视频接入

1. 进入“设置 → 视频”，在本地 ComfyUI 区域只勾选视频。
2. 地址仍为 `http://127.0.0.1:8188`，Key 留空。
3. 在当前视频接入选择 `comfyui-prompt`，导入 [视频工作流](../examples/h3-t2v-api.json)。
4. 粘贴 [h3-t2v-input-map.json](../examples/h3-t2v-input-map.json)到手动映射并保存。
5. 映射只接 `5.prompt` 和 `7.noise_seed`，其余参数固定在模板中。

**不要把工作台的“时长（秒）”直接映射到 `5.length`。** 这里的 length 是帧数，填 5 不代表 5 秒。尺寸与 fps 也固定，避免工作台选项与模型限制混用。

## 4. 生成一个镜头

在视频生成节点或经典视频页使用该接入。先使用这个简单描述：

```text
A small red toy car rolls slowly across a wooden desk beside a sunlit window.
The camera stays still. Soft daylight, natural shadows, quiet room ambience.
No text, no subtitles, no people.
```

生成后检查：画面是否连续、车轮是否变形、背景是否漂移、音频是否有异常。进入资源库下载 MP4；本分支按输出类型优先取视频；如果报没有视频输出，检查保存视频节点是否连接并完成。

本例不保证与 Z-Image 分镜图里的车完全一致。严格图生视频应另外建立并验证首帧上传、节点映射与模型输入链路。

## 5. 切回生图

再次检查队列为空，再执行：

```bash
systemctl --user stop minimax-h3.service
bash docs/comfyui_tutorial/examples/start_z_image_turbo.sh
```

## 验收与练习

得到一个可播放的短 MP4，记录实际时长和耗时。只改变“静止机位”为“缓慢推进”做第二次对照；不要同时提高分辨率和帧数。

回到[剪辑与导出](06-edit-export.md)，或阅读[排障](07-troubleshooting.md)。
