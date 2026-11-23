export type CanvasCommand = 'group' | 'merge' | 'ungroup' | 'connect' | 'copy' | 'paste' | 'duplicate' | 'generate' | 'add' | 'zoom-in' | 'zoom-out' | 'fit' | 'focus' | 'select' | 'hand' | 'arrange' | 'undo' | 'redo' | 'search' | 'delete'
export const shortcutSections: { title: string; rows: { label: string; keys: string; command?: CanvasCommand }[] }[] = [
  { title: '创作', rows: [
    { label: '成组', keys: 'Ctrl / Alt + G', command: 'group' },
    { label: '合并组合 / 分镜组', keys: 'Ctrl + Alt + G', command: 'merge' },
    { label: '解组', keys: 'Ctrl / Alt + Shift + G', command: 'ungroup' },
    { label: '连线', keys: 'Ctrl + L', command: 'connect' },
    { label: '复制节点', keys: 'Ctrl + C', command: 'copy' },
    { label: '粘贴节点', keys: 'Ctrl + V', command: 'paste' },
    { label: '复制节点和连线', keys: 'Ctrl + D', command: 'duplicate' },
    { label: '生成所选节点 / 组合', keys: 'Ctrl + Enter', command: 'generate' },
    { label: '新建节点', keys: 'Tab', command: 'add' },
    { label: '节点复制', keys: 'Alt + 拖动节点' },
    { label: '创建副本（含连线）', keys: 'Ctrl + Alt + 拖动' }
  ] },
  { title: '缩放', rows: [
    { label: '放大', keys: 'Ctrl + +', command: 'zoom-in' },
    { label: '缩小', keys: 'Ctrl + −', command: 'zoom-out' },
    { label: '适应画布', keys: 'Ctrl + 0', command: 'fit' },
    { label: '聚焦所选节点（100%）', keys: 'F', command: 'focus' },
    { label: '触控板', keys: '双指捏合' },
    { label: '鼠标', keys: 'Ctrl + 滚轮' }
  ] },
  { title: '移动画布', rows: [
    { label: '临时抓手', keys: 'Space + 左键拖动' },
    { label: '触控板', keys: '双指平移' },
    { label: '鼠标', keys: '中键拖动' },
    { label: '选择 / 移动节点', keys: 'V', command: 'select' },
    { label: '抓手工具', keys: 'H', command: 'hand' },
    { label: '整理画布', keys: 'Alt + Shift + F', command: 'arrange' }
  ] },
  { title: '其他', rows: [
    { label: '撤销', keys: 'Ctrl + Z', command: 'undo' },
    { label: '重做', keys: 'Ctrl + Shift + Z', command: 'redo' },
    { label: '画布节点搜索', keys: 'Ctrl + F', command: 'search' },
    { label: '删除所选节点或连线', keys: 'Del', command: 'delete' }
  ] }
]
export function canvasCommand(event: KeyboardEvent): CanvasCommand | undefined {
  const mod = event.ctrlKey || event.metaKey, alt = event.altKey, shift = event.shiftKey
  const key = event.code.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase()
  if (key === 'g' && (mod || alt)) return shift ? 'ungroup' : mod && alt ? 'merge' : 'group'
  if (alt && shift && key === 'f') return 'arrange'
  if (mod && !alt) {
    if (key === 'z') return shift ? 'redo' : 'undo'
    if (key === 'l') return 'connect'
    if (key === 'c') return 'copy'
    if (key === 'v') return 'paste'
    if (key === 'd') return 'duplicate'
    if (key === 'f') return 'search'
    if (key === 'enter') return 'generate'
    if (['+', '='].includes(key) || event.code === 'NumpadAdd') return 'zoom-in'
    if (['-', '−'].includes(key) || event.code === 'NumpadSubtract') return 'zoom-out'
    if (key === '0') return 'fit'
  }
  if (!mod && !alt && !shift) {
    if (key === 'f') return 'focus'
    if (key === 'h') return 'hand'
    if (key === 'v') return 'select'
    if (key === 'tab') return 'add'
    if (key === 'delete' || key === 'backspace') return 'delete'
  }
}
