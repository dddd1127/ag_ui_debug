/**
 * types.ts
 * 
 * ChatPanel 组件类型定义文件
 * 
 * 定义聊天界面中使用的所有数据类型：
 * - ChatMessage: 单条聊天消息
 * - ToolCallInfo: 工具调用信息
 * - ChatPanelProps: ChatPanel 组件属性
 */

/**
 * 聊天消息状态
 * - sending: 正在发送
 * - streaming: 正在流式接收
 * - completed: 已完成
 * - error: 出错
 */
export type MessageStatus = 'sending' | 'streaming' | 'completed' | 'error'

/**
 * 聊天消息角色
 * - user: 用户消息（右侧显示）
 * - assistant: 助手消息（左侧显示）
 */
export type MessageRole = 'user' | 'assistant'

/**
 * 工具调用状态
 * - calling: 正在调用
 * - completed: 已完成
 * - error: 出错
 */
export type ToolCallStatus = 'calling' | 'completed' | 'error'

/**
 * 工具调用信息
 * 记录 Agent 调用工具时的详细信息
 */
export interface ToolCallInfo {
  /** 工具调用唯一标识 */
  id: string
  /** 工具名称（如 "get_weather"） */
  name: string
  /** 工具调用参数（JSON 字符串） */
  arguments: string
  /** 工具调用状态 */
  status: ToolCallStatus
  /** 工具调用结果（可选） */
  result?: string
}

/**
 * 聊天消息
 * 表示聊天界面中的一条消息
 */
export interface ChatMessage {
  /** 消息唯一标识 */
  id: string
  /** 消息角色 */
  role: MessageRole
  /** 消息文本内容 */
  content: string
  /** 消息状态 */
  status: MessageStatus
  /** 工具调用列表（仅助手消息可能包含） */
  toolCalls?: ToolCallInfo[]
}

/**
 * ChatPanel 组件属性
 */
export interface ChatPanelProps {
  /** 消息列表 */
  messages: ChatMessage[]
  /** 发送消息回调函数 */
  onSendMessage: (text: string) => void
  /** 是否正在流式接收 */
  isStreaming: boolean
}

/**
 * MessageList 组件属性
 */
export interface MessageListProps {
  /** 消息列表 */
  messages: ChatMessage[]
}

/**
 * MessageInput 组件属性
 */
export interface MessageInputProps {
  /** 发送消息回调函数 */
  onSendMessage: (text: string) => void
  /** 是否禁用（正在发送时） */
  disabled: boolean
}
