/**
 * MessageInput.tsx
 * 
 * 消息输入组件
 * 
 * 功能说明：
 * - 提供文本输入框供用户输入消息
 * - 支持回车发送（Shift+Enter 换行）
 * - 发送按钮，支持加载状态
 * - 输入框自适应高度
 * 
 * 交互设计：
 * - 输入框获得焦点时边框高亮
 * - 发送时禁用输入，显示加载状态
 * - 发送完成后清空输入框并恢复状态
 */

import { useState, useRef, useCallback } from 'react'
import { Button, Input } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import type { MessageInputProps } from './types'

const { TextArea } = Input

/**
 * 消息输入组件
 * 
 * 属性：
 * - onSendMessage: 发送消息回调函数
 * - disabled: 是否禁用（正在发送时）
 */
export default function MessageInput({ onSendMessage, disabled }: MessageInputProps) {
  // 输入文本状态
  const [text, setText] = useState('')
  // 输入框引用（用于获取焦点）
  const inputRef = useRef<any>(null)

  /**
   * 发送消息
   * 
   * 流程：
   * 1. 检查文本是否为空
   * 2. 调用父组件传入的 onSendMessage
   * 3. 清空输入框
   * 4. 恢复焦点
   */
  const handleSend = useCallback(() => {
    const trimmedText = text.trim()
    if (!trimmedText || disabled) return

    onSendMessage(trimmedText)
    setText('')
    
    // 恢复焦点
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }, [text, disabled, onSendMessage])

  /**
   * 键盘事件处理
   * 
   * 快捷键：
   * - Enter: 发送消息
   * - Shift+Enter: 换行
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  return (
    <div className="message-input">
      <div className="input-wrapper">
        <TextArea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，按 Enter 发送，Shift+Enter 换行..."
          disabled={disabled}
          autoSize={{ minRows: 1, maxRows: 4 }}
          className="input-textarea"
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          disabled={disabled || !text.trim()}
          loading={disabled}
          className="send-button"
        >
          发送
        </Button>
      </div>
    </div>
  )
}
