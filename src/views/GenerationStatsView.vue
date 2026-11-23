<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Project } from '@/types'
import { buildStatisticsRows, comparisonConditions, filterStatisticsRows, formatElapsed, rankModels, statisticsCsv, type StatisticsAsset, type StatisticsRow } from '@/services/statistics/generationStats'
import { loadStatisticsHistory, statisticsPreviewBlob } from '@/services/statistics/storage'

const router = useRouter(), route = useRoute()
const kind = ref<'image' | 'video'>(route.query.kind === 'video' ? 'video' : 'image')
const projectId = ref(String(route.query.project || '')), modelKey = ref(''), mode = ref(''), from = ref(''), to = ref('')
const strict = ref(false), minimumSamples = ref(3), selectedCondition = ref('')
const tab = ref<'models' | 'single' | 'records'>('models'), order = ref<'fastest' | 'slowest'>('fastest')
const sortBy = ref<'mean' | 'median'>('mean')
const assets = ref<StatisticsAsset[]>([]), projects = ref<Project[]>([]), warnings = ref<string[]>([])
const loading = ref(false), error = ref(''), selectedId = ref(''), page = ref(1), pageSize = 30
const previewUrl = ref(''), previewError = ref(''), previewLoading = ref(false), notice = ref('')
let previewToken = 0, loadToken = 0, initialLinkApplied = false
const detailPanel = ref<HTMLElement>()
let priorFocus: HTMLElement | null = null
const rows = computed(() => buildStatisticsRows(assets.value, projects.value, strict.value))
const projectOptions = computed(() => {
  const all = new Map(projects.value.map(p => [p.id,p.name]))
  for (const r of rows.value) for (const id of r.projectIds) if (!all.has(id)) all.set(id, `已删除/未知项目 ${id}`)
  return [...all].map(([id,name])=>({id,name}))
})
const modelOptions = computed(() => [...new Map(rows.value.filter(r=>r.kind===kind.value).map(r=>[r.modelKey,{key:r.modelKey,label:`${r.model} · ${r.profile}`}])).values()])
const modeOptions = computed(() => [...new Map(rows.value.filter(r=>r.kind===kind.value).map(r=>[r.mode,r.modeLabel]))].map(([value,label])=>({value,label})))
const invalidDate = computed(() => Boolean(from.value && to.value && from.value > to.value))
const filtered = computed(() => invalidDate.value ? [] : filterStatisticsRows(rows.value,{kind:kind.value,projectId:projectId.value,modelKey:modelKey.value,mode:mode.value,from:from.value,to:to.value}))
const conditions = computed(() => comparisonConditions(filtered.value))
const conditionRows = computed(() => filtered.value.filter(r=>r.eligible && r.conditionKey===selectedCondition.value))
const groups = computed(() => rankModels(conditionRows.value).sort((a,b)=>Number(b.count>=minimumSamples.value)-Number(a.count>=minimumSamples.value)||a[sortBy.value]-b[sortBy.value]||a.model.localeCompare(b.model)))
const maxMean = computed(() => Math.max(1,...groups.value.map(g=>g.mean)))
const tableRows = computed(() => tab.value==='records' ? filtered.value : [...conditionRows.value].sort((a,b)=>(a.elapsedMs!-b.elapsedMs!)*(order.value==='fastest'?1:-1)||b.createdAt-a.createdAt))
const pageCount = computed(() => Math.max(1,Math.ceil(tableRows.value.length/pageSize)))
const pagedRows = computed(() => tableRows.value.slice((page.value-1)*pageSize,page.value*pageSize))
const excluded = computed(() => filtered.value.filter(r=>!r.eligible))
const exclusionCounts = computed(() => [...excluded.value.reduce((map,r)=>{for(const reason of r.reasons)map.set(reason,(map.get(reason)||0)+1);return map},new Map<string,number>())])
const totalMean = computed(() => conditionRows.value.length ? conditionRows.value.reduce((sum,r)=>sum+r.elapsedMs!,0)/conditionRows.value.length : undefined)
const selected = computed(() => rows.value.find(r=>r.id===selectedId.value))
const selectedParameters = computed(() => {
  const row=selected.value,r=row?.record,a=row?.asset
  if(!row||!a)return []
  return [
    ['记录 ID',row.id],['请求 ID',r?.runId],['任务 ID',r?.promptId],['模型',row.model],['模型接入',row.profile],['供应商',r?.provider],['项目',row.projectLabel],
    ['生成时间',date(row.createdAt)],['总等待时间',formatElapsed(row.elapsedMs)],['生成模式',row.modeLabel],
    ['实际输出','width' in a?`${a.width}×${a.height}`:undefined],['请求宽高',r?.requestedWidth&&r?.requestedHeight?`${r.requestedWidth}×${r.requestedHeight}`:undefined],
    ['生成画布',r?.generationWidth&&r?.generationHeight?`${r.generationWidth}×${r.generationHeight}`:undefined],['分辨率档位',r?.resolution],['画幅',r?.aspectRatio],['画质',r?.quality],['风格',r?.style],
    ['请求时长',r?.duration==null?undefined:`${r.duration}秒`],['实际时长',a.kind==='video'&&Number.isFinite(a.duration)?`${a.duration.toFixed(2)}秒`:undefined],
    ['输出音轨',a.kind==='video'?(a.hasAudio?'有':'无'):undefined],['请求音频',a.kind==='video'?(r?.audioEnabled==null?'未记录':r.audioEnabled?'开启':'关闭'):undefined],
    ['参考图片数',r?.referenceCount],['参考音频',r?.referenceAudios?.map(item=>item.filename||item.assetId).join('、')||r?.referenceAudio?.filename||r?.referenceAudio?.assetId],
    ['单次输出数',r?.outputCount??'未记录'],['种子',r?.seed],['采样步数',r?.steps],['CFG',r?.cfg],['采样器',r?.sampler],['调度器',r?.scheduler],['去噪',r?.denoise],['生成帧率',r?.fps],
    ['运行模式',r?.simulated==null?'历史未记录':r.simulated?'模拟':'真实'],['文件名',a.filename],['文件大小',`${(a.size/1024/1024).toFixed(2)} MB`]
  ].filter(([,v])=>v!==undefined&&v!=='')
})
watch(conditions, list=>{if(!list.some(c=>c.key===selectedCondition.value))selectedCondition.value=list[0]?.key||''})
watch(rows,list=>{if(selectedId.value&&!list.some(r=>r.id===selectedId.value))selectedId.value=''})
watch(kind,()=>{modelKey.value='';mode.value='';selectedCondition.value='';page.value=1})
watch([filtered,selectedCondition,tab,order],()=>{page.value=1})
watch(selectedId,async(id,previous)=>{previewToken++;clearPreview();previewError.value='';previewLoading.value=false;if(id){if(!previous)priorFocus=document.activeElement as HTMLElement;await nextTick();detailPanel.value?.querySelector<HTMLButtonElement>('button')?.focus()}else priorFocus?.focus()})
onBeforeUnmount(()=>{loadToken++;previewToken++;clearPreview()})
onMounted(load)
function date(value:number){return Number.isFinite(value)&&value>0&&Number.isFinite(new Date(value).getTime())?new Date(value).toLocaleString('zh-CN'):'未记录'}
function clearPreview(){if(previewUrl.value)URL.revokeObjectURL(previewUrl.value);previewUrl.value=''}
async function load(){
  const token=++loadToken;loading.value=true;error.value='';notice.value=''
  try{
    const history=await loadStatisticsHistory()
    if(token!==loadToken)return
    assets.value=history.assets;projects.value=history.projects;warnings.value=history.warnings
    const requested=initialLinkApplied?undefined:rows.value.find(r=>r.id===route.query.asset)
    initialLinkApplied=true
    if(requested){kind.value=requested.kind;await nextTick();selectedId.value=requested.id;selectedCondition.value=requested.conditionKey;if(!requested.eligible)tab.value='records'}
  }catch(e){if(token===loadToken)error.value=e instanceof Error?e.message:'读取历史生成记录失败'}
  finally{if(token===loadToken)loading.value=false}
}
function back(){void router.push(route.query.returnTo==='studio'?'/studio':'/')}
function inspect(row:StatisticsRow){selectedId.value=row.id}
async function compareSelected(){const row=selected.value;if(!row||!row.eligible)return;kind.value=row.kind;modelKey.value='';mode.value='';await nextTick();selectedCondition.value=row.conditionKey;tab.value='models';selectedId.value=''}
function detailKeys(event:KeyboardEvent){
  if(event.key==='Escape'){event.preventDefault();selectedId.value='';return}
  if(event.key!=='Tab')return
  const items=detailPanel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],video[controls],summary,[tabindex="0"]')
  if(!items?.length)return
  const first=items[0],last=items[items.length-1]
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}
async function preview(){
  const row=selected.value;if(!row)return
  const token=++previewToken;previewLoading.value=true;previewError.value=''
  try{
    const blob=await statisticsPreviewBlob(row.asset,projects.value,row.projectIds)
    if(token!==previewToken)return
    if(!blob)throw new Error('原文件已删除或当前不可访问')
    clearPreview();previewUrl.value=URL.createObjectURL(blob)
  }catch(e){if(token===previewToken)previewError.value=e instanceof Error?e.message:'预览失败'}
  finally{if(token===previewToken)previewLoading.value=false}
}
function exportCsv(){
  const records=tableRows.value
  const csv=statisticsCsv(records,groups.value,tab.value==='models'?'ranking':'records',minimumSamples.value)
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
  const link=document.createElement('a');link.href=url;link.download=`剧流-${kind.value==='image'?'图片':'视频'}-${tab.value==='models'?'平均耗时排行':tab.value==='single'?'单次耗时排行':'生成记录'}.csv`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)
  notice.value='已导出当前筛选结果（包含所有分页）；未包含提示词和素材内容。'
}
</script>

<template>
  <main class="stats-page">
    <header class="stats-header">
      <div class="title-line"><button type="button" class="back" @click="back">← {{ route.query.returnTo==='studio'?'返回画布':'返回项目' }}</button><div><p class="eyebrow">GENERATION INSIGHTS</p><h1>生成统计</h1></div><span class="version">历史记录 · v1</span></div>
      <div class="header-actions"><button type="button" :disabled="loading" @click="load">{{ loading?'读取中…':'刷新记录' }}</button><button type="button" class="primary" :disabled="loading || (tab==='models' ? !groups.length : !tableRows.length) || invalidDate" @click="exportCsv">导出当前视图 CSV ↗</button></div>
    </header>
    <p class="scope-note">比较从提交到结果取回的总等待时间，包含上传、排队、生成和下载。图片与视频分榜，只在选定的同组条件内排名。</p>
    <p v-if="error" role="alert" class="error">{{ error }} <button type="button" @click="load">重试</button></p>
    <p v-for="warning in warnings" :key="warning" class="warning" role="status">{{ warning }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <section class="filters" aria-label="历史记录筛选">
      <div class="kind-tabs" role="group" aria-label="生成类型"><button type="button" :class="{on:kind==='image'}" :aria-pressed="kind==='image'" @click="kind='image'">图片生成</button><button type="button" :class="{on:kind==='video'}" :aria-pressed="kind==='video'" @click="kind='video'">视频生成</button></div>
      <label>项目范围<select v-model="projectId" aria-label="项目范围"><option value="">全部项目与共享库</option><option v-for="p in projectOptions" :key="p.id" :value="p.id">{{ p.name }}</option></select></label>
      <label>开始日期<input v-model="from" aria-label="开始日期" type="date" /></label><label>结束日期<input v-model="to" aria-label="结束日期" type="date" /></label>
      <label>模型 / 接入<select v-model="modelKey" aria-label="模型接入"><option value="">全部模型与接入</option><option v-for="m in modelOptions" :key="m.key" :value="m.key">{{ m.label }}</option></select></label>
      <label>生成模式<select v-model="mode" aria-label="生成模式"><option value="">全部模式</option><option v-for="m in modeOptions" :key="m.value" :value="m.value">{{ m.label }}</option></select></label>
    </section>
    <p v-if="invalidDate" role="alert" class="error">开始日期不能晚于结束日期。</p>
    <section class="summary-grid" aria-label="筛选统计概览">
      <article><span>历史记录</span><strong>{{ filtered.length }}</strong><small>当前类型与筛选范围</small></article>
      <article><span>有效请求</span><strong>{{ filtered.length-excluded.length }}</strong><small>{{ conditions.length }} 组比较条件</small></article>
      <article><span>当前条件平均等待</span><strong>{{ formatElapsed(totalMean) }}</strong><small>{{ conditionRows.length }} 次请求 · {{ groups.length }} 个模型 / 接入</small></article>
      <article :class="{muted:!excluded.length}"><span>未参与排行</span><strong>{{ excluded.length }}</strong><small>缺记录、续查、模拟或重复等</small></article>
    </section>
    <details v-if="excluded.length" class="coverage"><summary>查看未参与排行的原因 · {{ excluded.length }} 条记录</summary><div><span v-for="[reason,count] in exclusionCounts" :key="reason">{{ reason }} <b>{{ count }}</b></span></div><p>同一记录可能有多个原因。在“全部记录”中可逐条查看。</p></details>
    <section class="comparison" aria-label="比较条件">
      <label>比较条件<select v-model="selectedCondition" aria-label="比较条件" :disabled="!conditions.length"><option v-if="!conditions.length" value="">暂无符合条件的有效记录</option><option v-for="c in conditions" :key="c.key" :value="c.key">{{ c.label }} — {{ c.count }} 次 · {{ c.models.size }} 个模型/接入</option></select></label>
      <label class="check"><input v-model="strict" type="checkbox" aria-label="按采样参数进一步分组" />按步数、CFG、采样器等进一步分组</label>
      <p>按实际输出宽高分组；不同权重版本、接入分别统计。未记录字段单独标识，不代表参数相同；历史接入名称不保证机器配置或负载相同。</p>
    </section>
    <section class="results" aria-label="生成耗时结果">
      <div class="results-head">
        <div class="result-tabs" role="tablist" aria-label="统计视图"><button v-for="item in ([['models','模型平均排行'],['single','单次耗时排行'],['records','全部记录']] as const)" :key="item[0]" type="button" role="tab" :aria-selected="tab===item[0]" :class="{on:tab===item[0]}" @click="tab=item[0]">{{ item[1] }}</button></div>
        <div v-if="tab==='models'" class="table-tools"><label>排名指标<select v-model="sortBy" aria-label="排名指标"><option value="mean">平均耗时</option><option value="median">中位数</option></select></label><label>最低样本<select v-model.number="minimumSamples" aria-label="最低样本数"><option :value="3">3次</option><option :value="5">5次</option><option :value="1">1次（试览）</option></select></label></div>
        <label v-else-if="tab==='single'" class="sort-control">排序<select v-model="order" aria-label="单次耗时排序"><option value="fastest">最快优先</option><option value="slowest">最慢优先</option></select></label>
        <span v-else class="record-count">{{ tableRows.length }} 条 · 包含未参与排名的记录</span>
      </div>
      <div v-if="loading" class="empty" role="status">正在读取历史记录…</div>
      <template v-else-if="tab==='models'">
        <div v-if="!groups.length" class="empty"><strong>暂无可比较的生成数据</strong><p>调整筛选范围，或在“全部记录”查看已有记录及缺失原因。新生成的结果会自动记录耗时。</p></div>
        <div v-else class="table-scroll"><table class="model-table"><thead><tr><th>排名</th><th>模型 / 接入</th><th>样本</th><th>平均耗时</th><th>中位数</th><th>最快 / 最慢</th><th>P90</th><th>记录</th></tr></thead><tbody><tr v-for="(g,i) in groups" :key="g.key"><td><span class="rank" :class="{top:i===0&&g.count>=minimumSamples}">{{ g.count>=minimumSamples?i+1:'—' }}</span></td><td><strong>{{ g.model }}</strong><small>{{ g.profile }}</small><small v-if="g.rows[0]?.record?.checkpoints?.length" class="weights">{{ g.rows[0].record!.checkpoints!.join('、') }}</small></td><td>{{ g.count }}<small v-if="g.count<minimumSamples" class="warning-text">样本不足</small></td><td><strong>{{ formatElapsed(g.mean) }}</strong><div class="mean-bar"><i :style="{width:`${Math.max(2,g.mean/maxMean*100)}%`}" /></div></td><td>{{ formatElapsed(g.median) }}</td><td>{{ formatElapsed(g.min) }} / {{ formatElapsed(g.max) }}</td><td>{{ g.p90==null?'不足10条':formatElapsed(g.p90) }}</td><td><button type="button" @click="inspect(g.rows[0])">查看明细</button></td></tr></tbody></table></div>
        <p class="table-note">不足最低样本数的模型不参与排名；长耗时样本保留。均值与中位数同时观察，避免偶发排队影响判断。不同提示词、参考图内容和机器负载可能影响结果。</p>
      </template>
      <template v-else>
        <div v-if="!tableRows.length" class="empty"><strong>暂无记录</strong><p>可以扩大项目、日期或模型范围；未记录的历史数据无法从当前节点设置补回。</p></div>
        <div v-else class="table-scroll"><table><thead><tr><th>{{ tab==='single'?'排名':'生成时间' }}</th><th>结果 / 模型</th><th>项目</th><th>生成条件</th><th>总等待时间</th><th>状态</th><th>详情</th></tr></thead><tbody><tr v-for="(r,i) in pagedRows" :key="r.id"><td>{{ tab==='single'?(page-1)*pageSize+i+1:date(r.createdAt) }}</td><td><strong>{{ r.model }}</strong><small>{{ r.profile }}</small><small>{{ r.asset.filename }}</small></td><td>{{ r.projectLabel }}</td><td class="condition-cell">{{ r.conditionLabel }}<small v-if="r.incomplete.length" class="warning-text">部分条件未记录 / 未公开</small></td><td class="time-cell">{{ formatElapsed(r.elapsedMs) }}</td><td><span class="status-chip" :class="{excluded:!r.eligible}">{{ r.eligible?'有效':'未参与排行' }}</span><small v-if="r.reasons.length">{{ r.reasons.join('；') }}</small></td><td><button type="button" @click="inspect(r)">详情</button></td></tr></tbody></table></div>
        <footer v-if="tableRows.length" class="pagination"><span>共 {{ tableRows.length }} 条，每页 {{ pageSize }} 条</span><button type="button" :disabled="page<=1" @click="page--">上一页</button><span>{{ page }} / {{ pageCount }}</span><button type="button" :disabled="page>=pageCount" @click="page++">下一页</button></footer>
      </template>
    </section>
    <p class="footnote">只统计当前仍可访问的成功结果；v1 不包含已删除素材、失败/取消的请求及未留存的历史。统计不会提交生成或加载模型。</p>
    <div v-if="selected" class="detail-mask" @click.self="selectedId=''" @keydown="detailKeys">
      <section ref="detailPanel" class="detail-panel" role="dialog" aria-modal="true" aria-label="详细生成记录" tabindex="-1">
        <header><div><span class="eyebrow">GENERATION RECORD</span><h2>详细生成记录</h2></div><button type="button" aria-label="关闭详细记录" @click="selectedId=''">×</button></header>
        <div class="detail-scroll">
          <h3>{{ selected.model }}</h3><p class="detail-subtitle">{{ selected.asset.filename }}</p>
          <p v-if="selected.reasons.length" class="warning">未参与排行：{{ selected.reasons.join('；') }}</p>
          <p v-if="selected.incomplete.length" class="detail-note">{{ selected.incomplete.join('；') }}。未记录字段不代表与其他请求相同。</p>
          <div class="detail-actions"><button type="button" :disabled="previewLoading" @click="preview">{{ previewLoading?'读取原结果…':'查看原结果' }}</button><button v-if="selected.eligible" type="button" @click="compareSelected">比较同条件记录</button></div>
          <p v-if="previewError" class="error" role="alert">{{ previewError }}</p>
          <img v-if="previewUrl&&selected.kind==='image'" class="result-preview" :src="previewUrl" alt="生成图片原结果" />
          <video v-if="previewUrl&&selected.kind==='video'" class="result-preview" :src="previewUrl" controls playsinline preload="metadata" @error="previewError='视频无法解码或文件不完整，请下载原文件检查'" />
          <dl class="detail-parameters"><template v-for="[label,value] in selectedParameters" :key="String(label)"><dt>{{ label }}</dt><dd>{{ value }}</dd></template></dl>
          <template v-if="selected.record"><h4>提交提示词</h4><pre>{{ selected.record.prompt || '未记录' }}</pre><template v-if="selected.record.userPrompt&&selected.record.userPrompt!==selected.record.prompt"><h4>用户提示词</h4><pre>{{ selected.record.userPrompt }}</pre></template><template v-if="selected.record.checkpoints?.length"><h4>模型权重 / 编码器</h4><pre>{{ selected.record.checkpoints.join('\n') }}</pre></template><details v-if="selected.record.samplers?.length"><summary>各采样阶段</summary><pre>{{ JSON.stringify(selected.record.samplers,null,2) }}</pre></details></template>
          <template v-if="selected.eligible"><h4>同条件 · 同模型 / 接入的历史</h4><div class="sibling-records"><button v-for="sibling in filtered.filter(r=>r.eligible&&r.conditionKey===selected!.conditionKey&&r.modelKey===selected!.modelKey).slice(0,50)" :key="sibling.id" type="button" :class="{active:sibling.id===selected.id}" @click="inspect(sibling)"><span>{{ date(sibling.createdAt) }}</span><b>{{ formatElapsed(sibling.elapsedMs) }}</b></button></div><p class="detail-note">最多显示最近50条；全部样本可在单次耗时排行中筛选查看。</p></template>
          <h4>本条比较条件</h4><p class="detail-note">{{ selected.conditionLabel }}</p>
          <p class="detail-note">这是生成时保存的参数快照，不受当前节点设置影响。耗时包含上传、排队、生成和下载，不代表纯 GPU 推理耗时。</p>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.stats-page{height:100%;overflow-y:auto;box-sizing:border-box;padding:24px clamp(16px,3vw,48px) 30px;background:var(--color-bg-1,#101115);color:var(--color-text-1,#f0f1f4);font-size:13px;color-scheme:dark}
.stats-header,.title-line,.header-actions,.results-head,.table-tools,.detail-panel header,.pagination{display:flex;align-items:center;gap:12px}.stats-header,.results-head,.detail-panel header{justify-content:space-between}.stats-header{margin-bottom:12px;flex-wrap:wrap}.title-line{gap:18px}.eyebrow{font-size:10px;letter-spacing:1.7px;color:#82cbbf;margin:0 0 5px}h1{font-size:25px;line-height:1.2;margin:0;font-weight:650;letter-spacing:.5px}.version{font-size:11px;color:var(--color-text-3);padding:4px 9px;border:1px solid var(--color-border);border-radius:20px}.scope-note,.footnote,.table-note{font-size:12px;line-height:1.7;color:var(--color-text-3,#9297a4)}.scope-note{margin-bottom:20px}
button,select,input{font:inherit}button{border:1px solid var(--color-border,#333640);border-radius:8px;padding:7px 11px;color:inherit;background:var(--color-bg-2,#1b1d24);cursor:pointer}button:hover:not(:disabled){border-color:#77cbbb80;background:var(--color-bg-3,#252834)}button:disabled{opacity:.4;cursor:default}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #6bd6c7;outline-offset:2px}.primary{background:#98e2d2;color:#102a26;border-color:#98e2d2}.back{background:transparent;color:var(--color-text-2);padding-inline:0;border:0}.filters{display:grid;grid-template-columns:auto minmax(135px,1fr) 135px 135px minmax(180px,1.4fr) minmax(110px,.7fr);gap:12px;padding:16px;background:var(--color-bg-2,#191b21);border:1px solid var(--color-border,#30343d);border-radius:12px;align-items:end}
label{display:flex;flex-direction:column;gap:7px;color:var(--color-text-3,#9297a4);font-size:11px}select,input[type=date]{box-sizing:border-box;min-width:0;width:100%;height:34px;border:1px solid var(--color-border,#333640);background:var(--color-bg-1,#111318);border-radius:7px;color:var(--color-text-1,#e9edf3);padding:5px 9px;font-size:12px}.kind-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--color-border);border-radius:9px}.kind-tabs button{border:0;background:transparent;white-space:nowrap;font-size:12px;padding:7px 10px}.kind-tabs .on{background:#76cdbc20;color:#abeddf}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:16px 0}.summary-grid article{padding:16px 18px;border:1px solid var(--color-border,#30343d);border-radius:11px;background:linear-gradient(135deg,#86bdb207,transparent)}.summary-grid span{display:block;font-size:12px;color:var(--color-text-3)}.summary-grid strong{display:block;font-size:27px;line-height:1.3;margin:10px 0;font-variant-numeric:tabular-nums;font-weight:600}.summary-grid small{font-size:11px;color:var(--color-text-3)}.coverage{margin:0 0 16px;padding:10px 14px;border:1px solid #cfb47635;border-radius:8px;color:#d0bf98;font-size:12px}.coverage summary{cursor:pointer}.coverage div{display:flex;gap:10px;flex-wrap:wrap;padding-top:12px}.coverage span{background:#cfb4760c;padding:5px 8px;border-radius:4px}.coverage b{margin-left:6px}.coverage p{margin-bottom:0;color:var(--color-text-3)}.comparison{padding:14px 16px;border:1px solid var(--color-border);border-radius:11px;background:var(--color-bg-2,#191b21);display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px 20px;align-items:center}.comparison select{width:100%;text-overflow:ellipsis}.check{display:flex;flex-direction:row;align-items:center;white-space:nowrap;padding-top:18px}.check input{accent-color:#83d8c8}.comparison p{grid-column:1/-1;margin:0;font-size:11px;line-height:1.6;color:var(--color-text-3)}.results{border:1px solid var(--color-border);border-radius:12px;margin-top:18px;overflow:hidden}.results-head{padding:10px 14px;border-bottom:1px solid var(--color-border);gap:10px;flex-wrap:wrap}.result-tabs{display:flex;gap:4px}.result-tabs button{border-color:transparent;background:transparent;color:var(--color-text-3);font-size:12px}.result-tabs button.on{background:#8fd4c714;color:#ace3d8;border-color:#8fd4c72b}.table-tools label,.sort-control{flex-direction:row;align-items:center;white-space:nowrap}.table-tools select,.sort-control select{width:auto;height:30px}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:12px;min-width:800px}th{text-align:left;font-weight:500;color:var(--color-text-3);font-size:11px;background:var(--color-bg-2,#191b21);white-space:nowrap}th,td{padding:13px 14px;border-bottom:1px solid var(--color-border,#2a2d36);vertical-align:middle}tbody tr:last-child td{border-bottom:0}tbody tr:hover{background:#9cbdc205}td strong{font-size:12px;font-weight:550}td small{display:block;color:var(--color-text-3);margin-top:5px;line-height:1.5;font-size:10px;overflow-wrap:anywhere}td button{white-space:nowrap;font-size:11px;padding:5px 9px}.rank{font-size:13px;color:var(--color-text-3);font-variant-numeric:tabular-nums}.rank.top{color:#a9ebce}.mean-bar{height:4px;background:#78bdb218;border-radius:4px;min-width:110px;margin-top:9px}.mean-bar i{display:block;height:100%;border-radius:4px;background:linear-gradient(90deg,#557e8c,#8bdeca)}.weights{max-width:250px}.table-note{padding:10px 16px;margin:0;border-top:1px solid var(--color-border);font-size:11px}.condition-cell{min-width:210px;max-width:330px;line-height:1.6;color:var(--color-text-2)}.time-cell{white-space:nowrap;font-variant-numeric:tabular-nums}.warning-text{color:#ccba8f!important}.status-chip{display:inline-block;font-size:10px;padding:3px 7px;border-radius:12px;background:#75c8a51a;color:#9ddcbd;white-space:nowrap}.status-chip.excluded{background:#d9b47712;color:#d3bf99}.pagination{padding:12px 16px;color:var(--color-text-3);font-size:11px;border-top:1px solid var(--color-border);justify-content:flex-end}.pagination>span:first-child{margin-right:auto}.pagination button{font-size:11px}.record-count{font-size:11px;color:var(--color-text-3)}.empty{padding:55px 24px;text-align:center;color:var(--color-text-3);line-height:1.8}.empty strong{color:var(--color-text-2);font-weight:500}.empty p{max-width:550px;margin:10px auto;font-size:12px}.error,.warning,.notice{border-radius:7px;padding:10px 12px;font-size:12px;line-height:1.6}.error{color:#f1acb2;background:#b45d6814}.warning{color:#d5c49a;background:#b49b5810}.notice{color:#a3dfcd;background:#73bfb713}.footnote{font-size:11px}.detail-mask{position:fixed;inset:0;background:#05070b77;z-index:300;display:flex;justify-content:flex-end}.detail-panel{width:min(620px,100vw);height:100%;background:var(--color-bg-1,#111318);border-left:1px solid var(--color-border);box-shadow:-15px 0 55px #0005;display:flex;flex-direction:column;outline:none}.detail-panel header{padding:20px 24px;border-bottom:1px solid var(--color-border)}h2{font-size:18px;margin:5px 0 0}.detail-panel header button{font-size:20px;padding:3px 10px}.detail-scroll{overflow-y:auto;padding:20px 24px;flex:1;min-height:0}.detail-scroll h3{margin:0 0 7px;font-size:18px}.detail-subtitle{color:var(--color-text-3);font-size:11px;overflow-wrap:anywhere;margin:0 0 15px}.detail-actions{display:flex;gap:8px;margin:16px 0}.detail-actions button{font-size:12px}.result-preview{display:block;max-width:100%;max-height:360px;margin:15px auto;border-radius:8px;background:#000;object-fit:contain}.detail-parameters{display:grid;grid-template-columns:96px minmax(0,1fr);gap:10px 16px;padding:18px 0;border-block:1px solid var(--color-border);font-size:12px;line-height:1.6}.detail-parameters dt{color:var(--color-text-3)}.detail-parameters dd{margin:0;overflow-wrap:anywhere;user-select:text}.detail-scroll h4{font-size:12px;font-weight:500;margin:22px 0 10px;color:var(--color-text-2)}pre{font:inherit;font-size:12px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--color-bg-2,#191b21);padding:12px;border-radius:8px;user-select:text}.detail-note{color:var(--color-text-3);font-size:12px;line-height:1.7;overflow-wrap:anywhere}
.sibling-records{display:grid;gap:5px}.sibling-records button{display:flex;justify-content:space-between;text-align:left;font-size:11px}.sibling-records button.active{border-color:#77cbbb80}.sibling-records b{font-weight:500}
@media(max-width:1150px){.filters{grid-template-columns:repeat(3,minmax(0,1fr))}.kind-tabs{width:max-content}.comparison{grid-template-columns:1fr}.check{padding-top:0}}@media(max-width:650px){.stats-page{padding:16px 12px}.stats-header{gap:16px}.title-line{gap:12px}.version{display:none}.header-actions{width:100%}.header-actions button{flex:1}.filters{grid-template-columns:repeat(2,minmax(0,1fr));padding:12px}.kind-tabs{grid-column:1/-1}.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.summary-grid article{padding:12px}.summary-grid strong{font-size:23px}.results-head{padding:10px}.result-tabs{width:100%}.result-tabs button{flex:1}.table-tools{width:100%;justify-content:space-between}.comparison{padding:12px}}
</style>
