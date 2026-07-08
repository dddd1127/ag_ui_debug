/**
 * MessageList.tsx
 * 
 * 聊天消息列表组件
 * 
 * 功能说明：
 * - 展示所有聊天消息（用户消息 + 助手消息）
 * - 用户消息右对齐，助手消息左对齐
 * - 支持消息状态显示（发送中、流式接收、完成、错误）
 * - 支持工具调用信息的展示（折叠卡片形式）
 * - 自动滚动到最新消息
 * 
 * 样式设计：
 * - 用户消息：蓝色背景，右侧对齐
 * - 助手消息：深色背景，左侧对齐
 * - 工具调用：橙色边框卡片
 * - 错误状态：红色边框
 */

import { useRef, useEffect } from 'react'
import { Spin, Collapse } from 'antd'
import type { MessageListProps, ToolCallInfo } from './types'

const { Panel } = Collapse

/**
 * 格式化工具调用参数
 * 将 JSON 字符串解析为对象，格式化显示
 * 
 * 参数：
 * - args: JSON 字符串
 * 
 * 返回：
 * - 格式化后的 JSON 字符串，或原始字符串
 */
function formatToolArgs(args: string): string {
  try {
    const obj = JSON.parse(args)
    return JSON.stringify(obj, null, 2)
  } catch {
    return args
  }
}

/**
 * 渲染工具调用列表
 * 
 * 参数：
 * - toolCalls: 工具调用信息数组
 * 
 * 返回：
 * - 工具调用卡片列表
 */
function ToolCallList({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  if (!toolCalls || toolCalls.length === 0) return null

  return (
    <div className="tool-call-list">
      {toolCalls.map((tool) => (
        <div
          key={tool.id}
          className={`tool-call-card ${tool.status}`}
        >
          <div className="tool-call-header">
            <span className="tool-call-icon">🔧</span>
            <span className="tool-call-name">{tool.name}</span>
            <span className={`tool-call-status ${tool.status}`}>
              {tool.status === 'calling' && '调用中...'}
              {tool.status === 'completed' && '已完成'}
              {tool.status === 'error' && '失败'}
            </span>
          </div>
          
          {/* 工具参数（折叠展示） */}
          {tool.arguments && (
            <Collapse ghost>
              <Panel header="调用参数" key="1">
                <pre className="tool-call-args">
                  {formatToolArgs(tool.arguments)}
                </pre>
              </Panel>
            </Collapse>
          )}
          
          {/* 工具结果 */}
          {tool.result && (
            <div className="tool-call-result">
              <div className="result-label">返回结果：</div>
              <pre className="result-content">{tool.result}</pre>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * 消息列表组件
 * 
 * 属性：
 * - messages: 聊天消息列表
 */
export default function MessageList({ messages }: MessageListProps) {
  // 用于自动滚动到底部
  const listRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  /**
   * 当消息列表变化时，自动滚动到底部
   * 使用 useEffect 监听 messages 变化
   */
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

  return (
    <div ref={listRef} className="message-list">
      {/* 空状态提示 */}
      {messages.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">💬</div>
          <div className="empty-text">开始发送消息，调试 AG-UI 协议</div>
        </div>
      )}

      {/* 消息列表 */}
      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`message-item ${msg.role} ${msg.status}`}
        >
          {/* 消息头部（角色标识） */}
          <div className="message-header">
            <span className="message-role">
              {msg.role === 'user' ? '👤 用户' : '🤖 助手'}
            </span>
            {msg.status === 'sending' && (
              <Spin size="small" className="status-icon" />
            )}
            {msg.status === 'streaming' && (
              <span className="status-text streaming">接收中...</span>
            )}
            {msg.status === 'error' && (
              <span className="status-text error">发送失败</span>
            )}
          </div>

          {/* 消息内容 */}
          <div className="message-content">
            {/* 文本内容 */}
            <div className="message-text">
              {msg.content || (msg.status === 'streaming' ? (
                <span className="streaming-cursor">▌</span>
              ) : null)}
            </div>

            {/* 工具调用信息（仅助手消息） */}
            {msg.role === 'assistant' && msg.toolCalls && (
              <ToolCallList toolCalls={msg.toolCalls} />
            )}
          </div>
        </div>
      ))}

      {/* 底部锚点，用于自动滚动 */}
      <div ref={bottomRef} />
    </div>
  )
}
