/**
 * ChatPanel/index.tsx
 * 
 * 聊天面板组装组件
 * 
 * 功能说明：
 * - 组合 MessageList（消息列表）和 MessageInput（输入框）
 * - 控制整体布局（消息列表在上，输入框在下）
 * - 应用样式文件
 * 
 * 布局结构：
 * ```
 * ┌─────────────────┐
 * │  MessageList   │  ← 消息列表区域（可滚动）
 * │                │
 * ├─────────────────┤
 * │  MessageInput  │  ← 输入框区域（固定高度）
 * └─────────────────┘
 * ```
 */

import MessageList from './MessageList'
import MessageInput from './MessageInput'
import type { ChatPanelProps } from './types'
import './ChatPanel.css'

/**
 * 聊天面板组件
 * 
 * 属性：
 * - messages: 聊天消息列表
 * - onSendMessage: 发送消息回调函数
 * - isStreaming: 是否正在流式接收
 */
export default function ChatPanel({
  messages,
  onSendMessage,
  isStreaming,
}: ChatPanelProps) {
  return (
    <div className="chat-panel">
      {/* 消息列表区域（可滚动） */}
      <div className="chat-messages">
        <MessageList messages={messages} />
      </div>

      {/* 输入框区域（固定底部） */}
      <div className="chat-input">
        <MessageInput
          onSendMessage={onSendMessage}
          disabled={isStreaming}
        />
      </div>
    </div>
  )
}
