/**
 * aguiClient.ts
 * 
 * AG-UI 客户端工具函数
 * 
 * 功能说明：
 * - 提供构造 AG-UI 协议请求的工具函数
 * - 提供 SSE 数据解析工具函数
 * - 所有函数与 React 状态无关，纯工具函数
 * 
 * 核心函数：
 * 1. buildAguiRequest: 构造 RunAgentInput 请求体
 * 2. parseSSEEvent: 解析 SSE 事件数据
 * 3. generateId: 生成唯一标识
 * 4. formatMessageForAgui: 格式化消息为 AG-UI 格式
 */

/**
 * AG-UI 消息类型
 * 对应 ag_ui.core.types 中的 Message 类型
 */
export interface AguiMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'developer' | 'tool'
  content: string
  name?: string
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
  toolCallId?: string
}

/**
 * AG-UI 工具定义
 * 对应 ag_ui.core.types 中的 Tool 类型
 */
export interface AguiTool {
  name: string
  description: string
  parameters?: Record<string, any>
}

/**
 * AG-UI 请求体
 * 对应 ag_ui.core.types 中的 RunAgentInput 类型
 */
export interface AguiRunAgentInput {
  threadId: string
  runId: string
  parentRunId?: string
  messages: AguiMessage[]
  tools: AguiTool[]
  context: Array<{
    description: string
    value: string
  }>
  forwardedProps: Record<string, any>
  state?: any
  resume?: any[]
}

/**
 * 生成唯一 ID
 * 
 * 使用当前时间戳 + 随机数组合，确保唯一性
 * 格式：时间戳-随机字符串
 * 
 * 示例：1718000000000-abc123def
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 构造 AG-UI 请求体
 * 
 * 参数：
 * - text: 用户输入的文本内容
 * - history: 历史消息列表（可选，用于多轮对话）
 * - tools: 工具列表（可选，用于工具调用）
 * - forwardedProps: 额外属性（可选，如用户 ID）
 * 
 * 返回：
 * - AguiRunAgentInput 对象，符合 AG-UI 协议规范
 * 
 * 说明：
 * - threadId 和 runId 使用时间戳生成
 * - messages 包含历史消息 + 当前用户消息
 * - 如果提供 tools，AG-UI 协议会将其传递给 Agent
 */
export function buildAguiRequest(
  text: string,
  history: AguiMessage[] = [],
  tools: AguiTool[] = [],
  forwardedProps: Record<string, any> = {},
): AguiRunAgentInput {
  const threadId = `thread_${Date.now()}`
  const runId = `run_${Date.now()}`

  // 构建消息列表
  const messages: AguiMessage[] = [...history]
  
  // 添加当前用户消息
  messages.push({
    id: `msg_${Date.now()}`,
    role: 'user',
    content: text,
  })

  return {
    threadId,
    runId,
    messages,
    tools,
    context: [],
    forwardedProps: {
      userId: 'debug_user',
      ...forwardedProps,
    },
  }
}

/**
 * 格式化消息为 AG-UI 格式
 * 
 * 参数：
 * - content: 消息内容
 * - role: 消息角色
 * - id: 消息 ID（可选，默认生成）
 * 
 * 返回：
 * - AguiMessage 对象
 */
export function formatMessageForAgui(
  content: string,
  role: AguiMessage['role'] = 'user',
  id?: string,
): AguiMessage {
  return {
    id: id || generateId(),
    role,
    content,
  }
}

/**
 * 解析 SSE 事件数据
 * 
 * SSE 格式规范：
 * - 每行以 "data: " 开头
 * - 后面跟随 JSON 数据
 * - 以两个换行符（\n\n）结束一个事件
 * 
 * 参数：
 * - line: SSE 原始文本行
 * 
 * 返回：
 * - 解析后的 JSON 对象，或 null（解析失败时）
 * 
 * 示例：
 * 输入: "data: {\"type\":\"TEXT_MESSAGE_CONTENT\",\"delta\":\"你好\"}"
 * 输出: { type: "TEXT_MESSAGE_CONTENT", delta: "你好" }
 */
export function parseSSEEvent(line: string): Record<string, any> | null {
  // 去掉前缀 "data: "
  if (!line.startsWith('data: ')) {
    return null
  }

  const jsonStr = line.substring(6).trim()
  if (!jsonStr) {
    return null
  }

  try {
    return JSON.parse(jsonStr)
  } catch (e) {
    console.error('SSE 事件解析失败:', line, e)
    return null
  }
}

/**
 * 验证 AG-UI 请求体
 * 
 * 检查请求体是否符合 AG-UI 协议规范
 * 
 * 参数：
 * - request: AG-UI 请求体
 * 
 * 返回：
 * - 如果有效返回 null，否则返回错误信息字符串
 */
export function validateAguiRequest(request: AguiRunAgentInput): string | null {
  if (!request.threadId) {
    return '缺少 threadId'
  }
  if (!request.runId) {
    return '缺少 runId'
  }
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    return 'messages 必须是至少包含一条消息的非空数组'
  }
  for (const msg of request.messages) {
    if (!msg.id || !msg.role || msg.content === undefined) {
      return '消息对象必须包含 id、role 和 content 字段'
    }
  }
  return null
}

/**
 * 格式化 AG-UI 事件为可读字符串
 * 
 * 参数：
 * - event: AG-UI 事件对象
 * 
 * 返回：
 * - 简短的描述字符串
 */
export function formatAguiEvent(event: Record<string, any>): string {
  const type = event.type || 'UNKNOWN'
  
  switch (type) {
    case 'RUN_STARTED':
      return '▶ 运行开始'
    case 'RUN_FINISHED':
      return '✓ 运行结束'
    case 'RUN_ERROR':
      return `✗ 运行错误: ${event.message || ''}`
    case 'TEXT_MESSAGE_START':
      return '💬 文本消息开始'
    case 'TEXT_MESSAGE_CONTENT':
      return `💬 文本内容: ${event.delta || ''}`
    case 'TEXT_MESSAGE_END':
      return '💬 文本消息结束'
    case 'TOOL_CALL_START':
      return `🔧 工具调用: ${event.tool_call_name || ''}`
    case 'TOOL_CALL_ARGS':
      return `🔧 工具参数: ${event.delta || ''}`
    case 'TOOL_CALL_END':
      return '🔧 工具调用结束'
    case 'TOOL_CALL_RESULT':
      return `🔧 工具结果: ${event.content || ''}`
    default:
      return `${type}: ${JSON.stringify(event).slice(0, 100)}`
  }
}
