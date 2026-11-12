# 剧流 Studio：从云端到本地的 AI 漫剧实操

先做出一个有主角、有场景、有事件的短故事，再增加人物和场景，最后迁移到本地 ComfyUI。主线采用 **DeepSeek + 阿里云百炼**，面向 Ubuntu 浏览器版。

推荐打开[离线网页版](index.html)。软件基线为本仓库 0.1.16 的 `fix/ubuntu-web-comfyui` 分支，2026-10-21 修订。教程中的云端配置依赖本次新增的原生适配，不能只把模型名填进未修改的上游版本。

## 先完成这一条路线

安装与打开工作台 → 导入《忘带钥匙》 → 配置 DeepSeek / 百炼 → 生成角色与场景素材 → 生成第一镜单幅图片 → 生成 5 秒动态视频 → 补齐三镜 → 字幕与剪辑 → 导出 15 秒 MP4。

**当前验收边界：** 新故事包是制作输入，不含已经生成好的云端影片。协议测试使用模拟响应；真实云端出片、用户 Key 权限和浏览器跨域仍需现场验证。已有本地生图和短片导出记录见[验证记录](VALIDATION.md)。

## 由易到难的四个故事

| 故事 | 目标 | 学会什么 | 项目 |
| --- | --- | --- | --- |
| 忘带钥匙 | 1 人、1 景、3 镜、15 秒 | 最小剧情与生成闭环 | [导入 JSON](examples/01-key/project.json) |
| 雨中的伞 | 2 人、1 景、5 镜、25 秒 | 角色区分、对白与反应 | [导入 JSON](examples/02-umbrella/project.json) |
| 迟到的约定 | 2 人、2 景、8 镜、40 秒 | 场景切换、礼物交接、节奏 | [导入 JSON](examples/03-appointment/project.json) |
| 门后的来客 | 2 人、2 景、12 镜、60 秒 | 悬念、伏笔、揭晓与收束 | [导入 JSON](examples/04-visitor/project.json) |

这些都是目标成片时长。模型输出长度、剪辑入点和转场会影响最终时长；先用硬切，逐镜检查。

## 章节

| 章节 | 操作成果 |
| --- | --- |
| [00 工作流程](chapters/00-workflow.md) | 明确动态成片验收标准 |
| [01 Ubuntu 启动](chapters/01-ubuntu.md) | 打开工作台并加载 FFmpeg |
| [02 导入项目](chapters/02-project.md) | 导入带人物和场景的故事 |
| [03 DeepSeek + 百炼](chapters/03-cloud.md) | 配置接口，逐项测试 |
| [04 人物、场景与分镜](chapters/04-story-assets.md) | 建立角色一致性和首帧素材 |
| [05 忘带钥匙](chapters/05-key.md) | 三镜头最小闭环 |
| [06 雨中的伞](chapters/06-umbrella.md) | 双人同框与配音 |
| [07 迟到的约定](chapters/07-appointment.md) | 多场景与道具连续性 |
| [08 门后的来客](chapters/08-visitor.md) | 一分钟剧情制作 |
| [09 剪辑与导出](chapters/06-edit-export.md) | 动态素材、字幕、音轨合成 |
| [10 迁移到本地](chapters/10-local-migration.md) | 同一故事对照云端与本地 |
| [11 本地 Z-Image](chapters/03-z-image.md) | 本地生图工作流 |
| [12 本地 H3](chapters/05-h3-video.md) | 本地文生视频与图生视频边界 |
| [13 排障与备份](chapters/07-troubleshooting.md) | 分阶段定位错误、保留证据 |

## 示例与记录

每个故事目录都有 `story.md`、`cards.md`、`storyboard.csv`、`prompts.md`、`captions.srt` 和 `project.json`。项目没有媒体、账号或密钥；导入后需要实际生成。

- [云端运行记录模板](examples/cloud-run-record.md)：按“未测试 / 通过 / 失败”填写，不用“已配置”代替“已出片”。
- [本地迁移对照表](examples/local-comparison.csv)：保持剧本与分镜不变，只切换模型链路。
- [官方接口来源](SOURCES.md)：模型名和地域以官方文档、账户可用列表为准。
- [旧玩具车练习](examples/window-trip-project.json)、[本地生图样例](examples/generated.png)、[3 秒静态导出样例](examples/export-smoke.mp4)：继续保留作环境诊断，不代表新漫剧已生成。

网页是离线教材，点击模型生成需要回到剧流工作台。完整云端视频请在你自己的设置页填好 Key 后逐镜测试。
