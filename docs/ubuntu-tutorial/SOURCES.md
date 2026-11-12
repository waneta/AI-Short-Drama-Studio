# 接口与代码来源

核对日期：2026-10-21。官方页面会更新，模型权限、可用地域和价格以实际控制台为准。本文没有调用私人 Key。

| 来源 | 核对内容 |
| --- | --- |
| [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/) | 文本协议与模型名 |
| [DeepSeek 首次调用](https://api-docs.deepseek.com/) | API 基地址 |
| [千问图像生成](https://help.aliyun.com/zh/model-studio/qwen-image-api) | 原生请求与返回、地域 |
| [千问图像编辑](https://help.aliyun.com/zh/model-studio/qwen-image-edit-api) | 参考图输入与数量 |
| [万相首帧视频](https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference/) | img_url、异步任务、输出视频 |
| [Qwen-TTS](https://help.aliyun.com/zh/model-studio/qwen-tts-api) | 非实时语音、Cherry 音色示例 |

实现核查文件：`src/services/ai/providers.ts`、`dashscopeMedia.ts`、`image.ts`、`video.ts`、`tts.ts`、`adapters.ts`；项目格式见 `src/types/project.ts`，导入行为见 `src/views/SettingsView.vue`。

“协议模拟测试通过”是本地代码证据，不能推导出某个账号当前拥有模型权限、浏览器一定允许跨域或真实模型必然生成符合剧情的画面。
