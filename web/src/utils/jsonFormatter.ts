/**
 * jsonFormatter.ts
 * 
 * JSON 格式化与高亮工具函数
 * 
 * 功能说明：
 * - 提供 JSON 数据的格式化（缩进）功能
 * - 提供简单的 JSON 语法高亮（生成 HTML 字符串）
 * - 提供 JSON 数据的压缩功能
 * 
 * 核心函数：
 * 1. formatJSON: 格式化 JSON 字符串（带缩进）
 * 2. highlightJSON: 简单语法高亮（返回 HTML 字符串）
 * 3. compactJSON: 压缩 JSON（去除空白）
 * 4. truncateJSON: 截断 JSON（用于预览）
 */

/**
 * 格式化 JSON 字符串
 * 
 * 将 JSON 对象转换为带缩进的可读字符串
 * 
 * 参数：
 * - obj: 要格式化的对象或 JSON 字符串
 * - indent: 缩进空格数（默认 2）
 * 
 * 返回：
 * - 格式化后的 JSON 字符串
 * 
 * 示例：
 * 输入: { "a": 1, "b": "test" }
 * 输出: "{\n  \"a\": 1,\n  \"b\": \"test\"\n}"
 */
export function formatJSON(obj: any, indent: number = 2): string {
  try {
    if (typeof obj === 'string') {
      // 如果是字符串，先解析再格式化
      obj = JSON.parse(obj)
    }
    return JSON.stringify(obj, null, indent)
  } catch (e) {
    console.error('JSON 格式化失败:', e)
    return String(obj)
  }
}

/**
 * 压缩 JSON 字符串
 * 
 * 去除所有空白字符，将 JSON 压缩为一行
 * 
 * 参数：
 * - obj: 要压缩的对象
 * 
 * 返回：
 * - 压缩后的 JSON 字符串
 */
export function compactJSON(obj: any): string {
  try {
    if (typeof obj === 'string') {
      obj = JSON.parse(obj)
    }
    return JSON.stringify(obj)
  } catch (e) {
    return String(obj)
  }
}

/**
 * 截断 JSON 字符串
 * 
 * 用于预览场景，显示前 N 个字符
 * 
 * 参数：
 * - obj: 要截断的对象
 * - maxLength: 最大字符数（默认 200）
 * 
 * 返回：
 * - 截断后的字符串（如果超过长度，末尾加 "..."）
 */
export function truncateJSON(obj: any, maxLength: number = 200): string {
  const str = formatJSON(obj, 0)
  if (str.length <= maxLength) {
    return str
  }
  return str.substring(0, maxLength) + '...'
}

/**
 * 简单 JSON 语法高亮
 * 
 * 生成 HTML 字符串，使用 span 标签包裹不同语法元素
 * 
 * 颜色定义：
 * - 键名（字符串）：#9cdcfe（浅蓝色）
 * - 字符串值：#ce9178（橙色）
 * - 数字值：#b5cea8（浅绿色）
 * - 布尔值/null：#569cd6（蓝色）
 * - 标点符号：#d4d4d4（白色）
 * 
 * 参数：
 * - json: JSON 字符串或对象
 * 
 * 返回：
 * - HTML 字符串（包含 span 标签）
 * 
 * 注意：
 * - 返回的 HTML 字符串需要配合 dangerouslySetInnerHTML 使用
 * - 或者使用 react-json-view 等组件替代
 */
export function highlightJSON(json: any): string {
  const str = typeof json === 'string' ? json : formatJSON(json)
  
  // 使用正则表达式进行简单的高亮
  // 注意：这是一个简化版本，不处理所有边界情况
  let highlighted = str
    // 转义 HTML 特殊字符
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 键名高亮（冒号前的字符串）
    .replace(
      /"([^"]+)"\s*:/g,
      '<span style="color:#9cdcfe">"$1"</span><span style="color:#d4d4d4">:</span>',
    )
    // 字符串值高亮
    .replace(
      /:\s*"([^"]*)"/g,
      ': <span style="color:#ce9178">"$1"</span>',
    )
    // 数字值高亮
    .replace(
      /:\s*(-?\d+\.?\d*)/g,
      ': <span style="color:#b5cea8">$1</span>',
    )
    // 布尔值和 null 高亮
    .replace(
      /:\s*(true|false|null)/g,
      ': <span style="color:#569cd6">$1</span>',
    )
    // 花括号和方括号
    .replace(
      /([{}\[\]])/g,
      '<span style="color:#d4d4d4">$1</span>',
    )
    // 逗号
    .replace(
      /,/g,
      '<span style="color:#d4d4d4">,</span>',
    )

  return `<pre style="margin:0;font-family:Consolas,Monaco,'Courier New',monospace;font-size:12px;line-height:1.5;color:#d4d4d4;background:transparent;white-space:pre-wrap;word-break:break-all;">${highlighted}</pre>`
}

/**
 * 提取 JSON 对象中的关键字段
 * 
 * 用于预览场景，提取最重要的字段
 * 
 * 参数：
 * - obj: JSON 对象
 * - keys: 要提取的键名数组
 * 
 * 返回：
 * - 只包含指定键的新对象
 * 
 * 示例：
 * 输入: { a: 1, b: 2, c: 3 }, ['a', 'c']
 * 输出: { a: 1, c: 3 }
 */
export function pickKeys(obj: Record<string, any>, keys: string[]): Record<string, any> {
  const result: Record<string, any> = {}
  for (const key of keys) {
    if (key in obj) {
      result[key] = obj[key]
    }
  }
  return result
}

/**
 * 计算 JSON 字符串大小
 * 
 * 参数：
 * - obj: JSON 对象
 * 
 * 返回：
 * - 对象序列化后的字节数
 */
export function getJSONSize(obj: any): number {
  const str = JSON.stringify(obj)
  // 使用 Blob 计算字节数（支持中文）
  return new Blob([str]).size
}

/**
 * 格式化字节大小为可读字符串
 * 
 * 参数：
 * - bytes: 字节数
 * 
 * 返回：
 * - 可读字符串（如 "1.5 KB"）
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}
