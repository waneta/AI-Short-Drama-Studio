<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'
import { useSettingsStore } from '@/stores'
import { assistantActiveTasks } from '@/services/assistant/state'
import { codexStatusState, readCodexConnection, saveCodexConnection, readCodexStatus, readCliProvider,
  startCodexDeviceLogin, pollCodexDeviceLogin, cancelCodexDeviceLogin, type CodexConnection, type DeviceLogin } from '@/services/assistant/transport'
import { isDesktop } from '@/services/desktop'

const settings = useSettingsStore()
const connection = ref<CodexConnection>()
const mode = ref<'existing' | 'chatgpt' | 'custom'>('chatgpt'), baseUrl = ref(''), apiKey = ref(''), model = ref(''), proxy = ref('')
const keySource = ref<'stored' | 'env'>('stored'), envKey = ref('OPENAI_API_KEY')
const working = ref(''), loading = ref(true), error = ref(''), notice = ref(''), login = ref<DeviceLogin>()
const showKey = ref(false), pollFailed = ref(false), advanced = ref(false), devicePanel = ref<HTMLElement>()
const modes = [
  { id: 'existing' as const, title: '本机已有配置', hint: '沿用本机 Codex 预设' },
  { id: 'chatgpt' as const, title: 'ChatGPT 账号', hint: '已有登录或设备授权' },
  { id: 'custom' as const, title: '手动接口', hint: '代理地址与 API Key' }
]
const locked = computed(() => assistantActiveTasks.value > 0 || Boolean(working.value) || Boolean(login.value))
const dirty = computed(() => Boolean(connection.value) && (mode.value !== connection.value!.mode || baseUrl.value !== connection.value!.baseUrl ||
  model.value !== connection.value!.model || proxy.value !== connection.value!.proxy || keySource.value !== connection.value!.keySource || envKey.value !== connection.value!.envKey || Boolean(apiKey.value)))
const status = computed(() => !dirty.value && codexStatusState.value?.connection?.mode === mode.value ? codexStatusState.value : undefined)
const statusTitle = computed(() => error.value ? '操作未完成' : dirty.value ? '修改尚未应用' : status.value?.connectionIssue ? '需要补充凭证' : status.value?.authenticated ? (mode.value === 'chatgpt' ? '已识别账号登录' : '配置已加载') : '等待检查')
const primaryLabel = computed(() => working.value || (mode.value === 'chatgpt' && !status.value?.authenticated ? '登录并使用' : dirty.value ? '应用并检查' : '重新检查'))
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false
function fill(value: CodexConnection, followSelection = false) {
  connection.value = value; mode.value = value.mode; baseUrl.value = value.baseUrl; model.value = followSelection ? settings.config.codexModel || value.model : value.model; proxy.value = value.proxy; apiKey.value = ''
  keySource.value = value.keySource; envKey.value = value.envKey
}
function undo() { if (!locked.value && connection.value) { fill(connection.value); error.value = ''; notice.value = '' } }
function chooseMode(value: typeof mode.value) {
  if (locked.value || mode.value === value) return
  mode.value = value; error.value = ''; notice.value = ''
  if (value === 'existing') model.value = ''
}
function allowLeave() {
  return !(settings.config.assistantEngine === 'codex' && dirty.value) || confirm('Codex 连接的修改尚未应用。确定放弃这些修改吗？')
}
onBeforeRouteLeave(allowLeave)
onBeforeRouteUpdate((to, from) => to.params.section === from.params.section || allowLeave())
async function chooseEngine(value: 'api' | 'codex') {
  if (locked.value || loading.value || settings.config.assistantEngine === value) return
  if (value === 'api' && !allowLeave()) return
  if (value === 'api' && connection.value) fill(connection.value)
  working.value = '检查中…'; error.value = ''; notice.value = ''
  settings.update({ assistantEngine: value })
  try { await settings.flush(); if (value === 'codex' && connection.value && !dirty.value) await check() }
  catch (e: any) { error.value = e.message }
  finally { working.value = '' }
}
async function importCli() {
  if (locked.value) return
  working.value = '读取预设中…'; error.value = ''; notice.value = ''
  try {
    const value = await readCliProvider()
    mode.value = 'custom'; baseUrl.value = value.baseUrl; model.value = value.model; envKey.value = value.envKey; keySource.value = value.hasEnvironmentKey ? 'env' : 'stored'
    notice.value = `已带入 ${value.provider} 的地址和模型。${value.hasEnvironmentKey ? '使用主机环境变量凭证。' : '请填写该接口的 API Key，再点击应用。'}`
  } catch (e: any) { error.value = e.message }
  finally { working.value = '' }
}
async function check() {
  const value = await readCodexStatus()
  notice.value = value.connectionIssue || (value.authType === 'chatgpt' ? value.authenticated ? '账号登录已识别，可以回到画布使用。' : '尚未登录，点击“登录并使用”完成授权。' : value.authenticated ? '本地配置检查通过；尚未发送模型请求验证接口。' : '连接尚未就绪，请检查凭证。')
  return value
}
async function persist() {
  if (!dirty.value) return
  fill(await saveCodexConnection({ mode: mode.value, baseUrl: baseUrl.value, apiKey: apiKey.value || undefined, keySource: keySource.value, envKey: envKey.value, model: model.value, proxy: proxy.value }))
  settings.update({ codexModel: model.value }); await settings.flush()
}
async function poll() {
  const active = login.value
  if (!active || disposed) return
  pollFailed.value = false
  try {
    const result = await pollCodexDeviceLogin(active)
    if (disposed || login.value?.id !== active.id) return
    if (result.state === 'pending') { timer = setTimeout(() => void poll(), 2000); return }
    login.value = undefined
    if (result.state === 'completed') { notice.value = '设备授权完成。'; await check() }
    else error.value = result.error || (result.state === 'cancelled' ? '设备登录已取消。' : '设备登录未完成，请重试。')
  } catch (e: any) {
    if (!disposed && login.value?.id === active.id) { error.value = e.message; pollFailed.value = true }
  }
}
async function primary(forceLogin = false) {
  if (locked.value || !connection.value) return
  working.value = '应用并检查中…'; error.value = ''; notice.value = ''
  try {
    await persist()
    const current = await check()
    if (mode.value === 'chatgpt' && (!current.authenticated || forceLogin)) {
      working.value = '获取登录码…'
      const result = await startCodexDeviceLogin()
      if (disposed) { void cancelCodexDeviceLogin(result).catch(() => undefined); return }
      login.value = result; pollFailed.value = false; notice.value = ''; timer = setTimeout(() => void poll(), 1000)
      await nextTick(); devicePanel.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  } catch (e: any) { error.value = e.message }
  finally { working.value = '' }
}
async function cancelLogin() {
  const active = login.value
  if (!active) return
  clearTimeout(timer); working.value = '取消中…'; error.value = ''
  try { await cancelCodexDeviceLogin(active); login.value = undefined; pollFailed.value = false; notice.value = '本次登录已取消，已有登录保留。' }
  catch (e: any) { error.value = e.message }
  finally { working.value = '' }
}
async function copyCode() {
  try { await navigator.clipboard.writeText(login.value!.userCode); notice.value = '验证码已复制。' }
  catch { error.value = '未能自动复制，请选中验证码手动复制。' }
}
async function load() {
  loading.value = true; error.value = ''
  try { fill(await readCodexConnection(), true); if (settings.config.assistantEngine === 'codex') await check() }
  catch (e: any) { error.value = e.message }
  finally { loading.value = false }
}
onMounted(() => { if (isDesktop()) loading.value = false; else void load() })
onBeforeUnmount(() => { disposed = true; clearTimeout(timer); if (login.value) void cancelCodexDeviceLogin(login.value).catch(() => undefined) })
</script>

<template>
  <section class="codex-settings">
    <header><h2>语言模型</h2><p>AI 对话、剧本、分镜与提示词共用此引擎。</p></header>
    <div class="engine-options" role="group" aria-label="文本智能引擎">
      <button v-for="engine in (['codex', 'api'] as const)" :key="engine" type="button" :data-engine="engine" :aria-pressed="settings.config.assistantEngine === engine" :disabled="locked || loading || (engine === 'codex' && isDesktop())" @click="chooseEngine(engine)">
        <strong>{{ engine === 'codex' ? 'Codex 助手' : 'LLM API' }}</strong><span>{{ engine === 'codex' ? '使用本机 Codex，支持账号或接口接入' : '使用语言模型厂商的接口与 API Key' }}</span><b v-if="settings.config.assistantEngine === engine" aria-hidden="true">✓</b>
      </button>
    </div>
    <p v-if="isDesktop()">Codex 桥接用于主机 Web，请打开 127.0.0.1:5173 配置。</p>
    <template v-else-if="settings.config.assistantEngine === 'codex'">
      <p v-if="loading" role="status">正在读取连接…</p>
      <template v-else-if="connection">
        <div class="connection-head"><h3>Codex 接入方式</h3><span class="status" :class="{ warning: dirty || status?.connectionIssue, failed: error }" role="status">{{ statusTitle }}</span></div>
        <div class="mode-options" role="group" aria-label="Codex 接入方式">
          <button v-for="item in modes" :key="item.id" type="button" :data-mode="item.id" :aria-pressed="mode === item.id" :disabled="locked" @click="chooseMode(item.id)"><strong>{{ item.title }}</strong><span>{{ item.hint }}</span></button>
        </div>
        <div v-if="mode === 'existing'" class="mode-content">
          <dl v-if="status?.native" class="native-summary"><dt>接入</dt><dd>{{ status.native.provider }}</dd><dt>模型</dt><dd>{{ status.native.model || 'Codex 默认模型' }}</dd><dt>地址</dt><dd>{{ status.native.baseUrl || 'Codex 内置接入' }}</dd></dl>
          <p v-else>应用后读取本机当前预设，无需重复填写地址。之后切换本机预设，下一次任务自动跟随。</p>
          <div v-if="status?.connectionIssue" class="issue"><p>{{ status.connectionIssue }}</p><button type="button" :disabled="locked" @click="importCli">补充凭证</button></div>
        </div>
        <div v-else-if="mode === 'chatgpt'" class="mode-content account-row"><p>{{ status?.authenticated ? '沿用主机已有登录，可直接回画布使用。' : '点击下方按钮获取验证码，在官方页面完成授权。' }}</p><button v-if="status?.authenticated" type="button" class="text-button" :disabled="locked" @click="primary(true)">重新登录</button></div>
        <div v-else class="mode-content">
          <div class="form-grid">
            <label class="full">接口地址<input v-model="baseUrl" aria-label="Codex Base URL" :disabled="locked" placeholder="http://127.0.0.1:8310/v1" autocomplete="off" /></label>
            <label v-if="keySource === 'stored'">API Key<div class="secret"><input v-model="apiKey" aria-label="Codex API Key" :type="showKey ? 'text' : 'password'" :disabled="locked" :placeholder="connection.hasApiKey ? '已保存，留空保留' : '填写该接口的 Key'" autocomplete="new-password" /><button type="button" :disabled="locked" :aria-pressed="showKey" @click="showKey = !showKey">{{ showKey ? '隐藏' : '显示' }}</button></div></label>
            <label v-else>凭证<p class="env-note">使用主机环境变量 {{ envKey }}</p></label>
            <label>模型<input v-model="model" aria-label="Codex 默认模型" list="codex-settings-models" :disabled="locked" placeholder="接口支持的模型名" /></label>
          </div>
          <div class="inline-note"><p>需支持 Responses API、流式输出和工具调用。</p><button type="button" class="text-button" :disabled="locked" @click="importCli">读取本机预设</button></div>
        </div>
        <details :open="advanced" class="advanced" @toggle="advanced = ($event.target as HTMLDetailsElement).open">
          <summary>高级设置<span>网络代理{{ mode === 'custom' ? '、凭证来源' : '、模型覆盖' }}</span></summary>
          <div class="form-grid">
            <label v-if="mode !== 'custom'">模型覆盖<input v-model="model" aria-label="Codex 默认模型" list="codex-settings-models" :disabled="locked" :placeholder="mode === 'existing' ? '留空跟随本机预设' : '留空使用默认模型'" /></label>
            <label>网络代理（可选）<input v-model="proxy" aria-label="Codex 网络代理" :disabled="locked" placeholder="http://127.0.0.1:7897；留空直连" autocomplete="off" /></label>
            <template v-if="mode === 'custom'"><label>凭证来源<select v-model="keySource" aria-label="Codex 凭证来源" :disabled="locked"><option value="stored">在此填写 API Key</option><option value="env">主机服务环境变量</option></select></label><label v-if="keySource === 'env'">环境变量名<input v-model="envKey" aria-label="Codex 环境变量名" :disabled="locked" placeholder="OPENAI_API_KEY" /></label></template>
          </div>
          <p>网络代理影响联网路径，与模型接口地址不同。连接保存在主机，供本机剧流页面共用。</p>
        </details>
        <datalist id="codex-settings-models"><option v-for="item in codexStatusState?.models || []" :key="item.id" :value="item.model" /></datalist>
        <div v-if="login" ref="devicePanel" class="device-login" role="status"><div><b>完成设备授权</b><span>{{ pollFailed ? '等待中断，可重试检查' : '正在等待授权结果…' }}</span></div><div class="code-row"><code>{{ login.userCode }}</code><button type="button" @click="copyCode">复制验证码</button><a :href="login.verificationUrl" target="_blank" rel="noopener noreferrer">打开授权页面 ↗</a></div><p>在授权页面输入验证码。离开此页会取消本次等待。</p><div class="actions"><button v-if="pollFailed" type="button" @click="error = ''; poll()">重试检查授权</button><button type="button" :disabled="Boolean(working)" @click="cancelLogin">取消本次登录</button></div></div>
        <div class="action-bar"><div class="actions"><button type="button" class="primary" data-action="apply-codex" :disabled="locked" @click="primary()">{{ primaryLabel }}</button><button v-if="dirty" type="button" :disabled="locked" @click="undo">撤销修改</button></div><span>{{ assistantActiveTasks > 0 ? '助手正在执行任务，结束后可修改连接' : dirty ? '应用后，下一次任务使用新配置' : '设置保存在当前主机' }}</span></div>
      </template>
      <div v-else class="load-error"><button type="button" @click="load">重新读取连接</button></div>
      <p v-if="notice && !dirty && !status?.connectionIssue" class="notice" role="status">{{ notice }}</p>
      <p v-if="notice && dirty" class="notice" role="status">{{ notice }}</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </template>
  </section>
</template>
<style scoped>
.codex-settings{display:grid;gap:14px;padding:20px;border:1px solid var(--color-border);border-radius:12px;background:var(--color-bg-1);margin-bottom:16px;min-width:0}header{display:flex;gap:16px;align-items:baseline;flex-wrap:wrap}h2,h3,p{margin:0}h2{font-size:18px}h3{font-size:13px}p{font-size:12px;line-height:1.6;color:var(--color-text-3)}button,input,select{font:inherit;color:var(--color-text-1);background:var(--color-bg-2);border:1px solid var(--color-border);border-radius:7px;padding:9px 11px;font-size:12px}button{cursor:pointer}button:disabled{opacity:.5;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px}input,select{width:100%;box-sizing:border-box;min-width:0}button:hover:enabled{border-color:var(--color-accent)}.engine-options{display:grid;grid-template-columns:1fr 1fr;gap:10px}.engine-options button{position:relative;text-align:left;display:grid;gap:5px;padding:14px 34px 14px 14px}.engine-options strong{font-size:14px}.engine-options span,.mode-options span{font-size:11px;color:var(--color-text-3);line-height:1.5}.engine-options b{position:absolute;right:14px;top:15px;color:var(--color-accent)}button[aria-pressed=true]{border-color:var(--color-accent);background:color-mix(in srgb,var(--color-accent) 10%,var(--color-bg-2))}.connection-head{display:flex;justify-content:space-between;gap:12px;align-items:center}.status{font-size:11px;color:var(--color-accent)}.status.warning{color:var(--color-warning)}.status.failed,.error{color:var(--color-error)}.mode-options{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.mode-options button{display:grid;gap:3px;text-align:left;padding:11px 12px}.mode-content{display:grid;gap:10px}.native-summary{display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:12px;margin:0;padding:12px;background:var(--color-bg-2);border-radius:7px}.native-summary dt{color:var(--color-text-3)}.native-summary dd{margin:0;overflow-wrap:anywhere}.issue{display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--color-warning);border-radius:7px}.issue p{flex:1;color:var(--color-warning);overflow-wrap:anywhere}.issue button{flex-shrink:0}.account-row,.inline-note{display:flex;gap:12px;align-items:center;justify-content:space-between}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.full{grid-column:1/-1}label{display:grid;gap:6px;font-size:12px;min-width:0}.secret{display:flex;gap:6px}.secret input{flex:1}.secret button{flex-shrink:0}.env-note{padding:9px 0;overflow-wrap:anywhere}.text-button{border:0;background:transparent;padding:3px 0;color:var(--color-accent);white-space:nowrap}.advanced{border-top:1px solid var(--color-border);padding-top:12px}.advanced summary{cursor:pointer;font-size:12px;color:var(--color-text-2)}.advanced summary span{margin-left:10px;font-size:11px;color:var(--color-text-4)}.advanced .form-grid{margin:14px 0 8px}.action-bar{border-top:1px solid var(--color-border);padding-top:14px;display:flex;align-items:center;justify-content:space-between;gap:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{background:var(--color-accent);color:#fff;border-color:var(--color-accent);font-weight:600;min-width:112px}.action-bar>span{font-size:11px;color:var(--color-text-4)}.notice{color:var(--color-text-2)}.device-login{padding:14px;border:1px solid var(--color-accent);border-radius:8px;display:grid;gap:10px;font-size:12px}.device-login>div:first-child{display:flex;justify-content:space-between;gap:12px}.device-login span{color:var(--color-text-3)}.code-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.code-row code{font-size:22px;letter-spacing:2px;user-select:all}.code-row a{color:var(--color-accent)}
@media(max-width:760px){.codex-settings{padding:14px}.mode-options{grid-template-columns:1fr}.mode-options button{display:flex;justify-content:space-between;align-items:center;gap:8px}.form-grid{grid-template-columns:1fr}.action-bar{align-items:flex-start;flex-direction:column}.engine-options span{display:none}.issue{align-items:flex-start;flex-direction:column}.inline-note{align-items:flex-start}.advanced summary span{display:none}}
</style>
