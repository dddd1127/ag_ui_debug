/**
 * useAguiSSE.ts
 * 
 * AG-UI SSE 流式通信 Hook
 * 
 * 功能说明：
 * - 管理 AG-UI 协议客户端的 SSE 连接
 * - 负责构造 AG-UI 请求（RunAgentInput）并发送
 * - 实时解析 SSE 流式响应，将事件转换为前端消息状态
 * - 支持完整的 AG-UI 事件类型解析
 * 
 * 核心事件类型：
 * - RUN_STARTED: 运行开始
 * - TEXT_MESSAGE_START: 文本消息开始
 * - TEXT_MESSAGE_CONTENT: 文本消息内容（增量）
 * - TEXT_MESSAGE_END: 文本消息结束
 * - TOOL_CALL_START: 工具调用开始
 * - TOOL_CALL_ARGS: 工具调用参数
 * - TOOL_CALL_END: 工具调用结束
 * - TOOL_CALL_RESULT: 工具调用结果
 * - RUN_FINISHED: 运行结束
 * - RUN_ERROR: 运行错误
 * 
 * 返回接口：
 * - messages: ChatMessage[] 聊天消息列表
 * - sendMessage(text: string): 发送新消息
 * - isStreaming: boolean 是否正在接收流式响应
 */

import { useState, useCallback, useRef } from 'react'

/** 聊天消息类型定义 */
interface ChatMessage {
  /** 消息唯一标识 */
  id: string
  /** 角色：用户或助手 */
  role: 'user' | 'assistant'
  /** 消息内容（文本） */
  content: string
  /** 消息状态 */
  status: 'sending' | 'streaming' | 'completed' | 'error'
  /** 工具调用列表（助手消息可能包含） */
  toolCalls?: ToolCallInfo[]
}

/** 工具调用信息 */
interface ToolCallInfo {
  id: string
  name: string
  arguments: string
  status: 'calling' | 'completed' | 'error'
  result?: string
}

/** AG-UI 事件类型 */
type AGUIEventType = 
  | 'RUN_STARTED'
  | 'TEXT_MESSAGE_START'
  | 'TEXT_MESSAGE_CONTENT'
  | 'TEXT_MESSAGE_END'
  | 'TOOL_CALL_START'
  | 'TOOL_CALL_ARGS'
  | 'TOOL_CALL_END'
  | 'TOOL_CALL_RESULT'
  | 'RUN_FINISHED'
  | 'RUN_ERROR'

/** AG-UI 事件对象 */
interface AGUIEvent {
  type: AGUIEventType
  [key: string]: any
}

/** AG-UI 请求体 */
interface RunAgentInput {
  threadId: string
  runId: string
  messages: Array<{
    id: string
    role: string
    content: string
  }>
  tools: any[]
  context: any[]
  forwardedProps: Record<string, any>
  state?: any
}

/** Hook 返回接口 */
interface UseAguiSSEReturn {
  messages: ChatMessage[]
  sendMessage: (text: string) => void
  isStreaming: boolean
}

/**
 * 生成唯一 ID
 * 使用当前时间戳 + 随机数，确保唯一性
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 构造 AG-UI 请求体
 * 
 * 参数：
 * - text: 用户输入文本
 * - history: 历史消息列表
 * 
 * 返回：
 * - RunAgentInput 对象，符合 AG-UI 协议规范
 * 
 * 说明：
 * - threadId 和 runId 使用时间戳生成
 * - messages 包含历史消息 + 当前用户消息
 * - forwardedProps 可以传递额外用户信息
 */
function buildAguiRequest(text: string, threadId: string, history: ChatMessage[]): RunAgentInput {
  const runId = `run_${Date.now()}`
  
  // 构建消息列表（包含历史消息）
  const messages = history.map(msg => ({
    id: msg.id,
    role: msg.role,
    content: msg.content,
  }))
  
  // 添加当前用户消息
  messages.push({
    id: `msg_${Date.now()}`,
    role: 'user',
    content: text,
  })
  
  return {
    threadId,
    runId,
    state: null,
    messages,
    tools: [],
    context: [],
    forwardedProps: {
      userId: 'debug_user',
      source: 'ag-ui-debug-web',
    },
  }
}

/**
 * 解析 SSE 单行数据
 * 
 * SSE 格式：data: {...json}\n\n
 * 本函数提取 data: 后面的 JSON 内容
 * 
 * 参数：
 * - line: SSE 原始文本行
 * 
 * 返回：
 * - 解析后的 AGUIEvent 对象，或 null（如果解析失败）
 */
function parseSSELine(line: string): AGUIEvent | null {
  // 去掉前缀 "data: "
  if (!line.startsWith('data: ')) return null
  
  const jsonStr = line.substring(6).trim()
  if (!jsonStr) return null
  
  try {
    return JSON.parse(jsonStr)
  } catch (e) {
    console.error('SSE 解析失败:', line, e)
    return null
  }
}

/**
 * AG-UI SSE 通信 Hook
 * 
 * 使用方式：
 * const { messages, sendMessage, isStreaming } = useAguiSSE()
 * 
 * 说明：
 * - 内部维护 messages 状态
 * - sendMessage 触发 SSE 请求
 * - 流式解析过程中自动更新 messages
 */
export function useAguiSSE(): UseAguiSSEReturn {
  // 聊天消息列表状态
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // 是否正在流式接收
  const [isStreaming, setIsStreaming] = useState(false)
  // 持久化的 threadId（首次创建后保持不变）
  const threadIdRef = useRef<string>(`thread_${Date.now()}`)
  // 消息引用（用于获取最新状态，避免闭包问题）
  const messagesRef = useRef<ChatMessage[]>([])

  // 保持 messagesRef 与 messages 同步
  messagesRef.current = messages

  /**
   * 发送消息
   * 
   * 流程：
   * 1. 构造用户消息并加入列表
   * 2. 构造 AG-UI 请求体
   * 3. 发送 POST 请求到 /ag-ui
   * 4. 读取 SSE 流并逐行解析
   * 5. 根据事件类型更新消息状态
   * 
   * 参数：
   * - text: 用户输入文本
   */
  const sendMessage = useCallback((text: string) => {
    // 构造用户消息
    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: text,
      status: 'sending',
    }
    
    // 更新状态：添加用户消息
    setMessages(prev => [...prev, userMsg])
    setIsStreaming(true)
    
    // 构造 AG-UI 请求（使用 messagesRef 获取最新状态）
    const request = buildAguiRequest(text, threadIdRef.current, messagesRef.current)
    
    // 发送 SSE 请求
    fetch('/ag-ui', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    })
    .then(async response => {
      // 请求已送达服务端，将用户消息标记为发送完成
      setMessages(prev => {
        const newMessages = [...prev]
        const userIndex = newMessages.findIndex(m => m.id === userMsg.id)
        if (userIndex !== -1) {
          newMessages[userIndex] = { ...newMessages[userIndex], status: 'completed' }
        }
        return newMessages
      })

      // 创建助手消息占位
      const assistantMsgId = generateId()
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        toolCalls: [],
      }
      
      setMessages(prev => [...prev, assistantMsg])
      
      // 读取 SSE 流
      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      
      let eventCount = 0
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          // 修复 R5: 流结束时处理 buffer 中残余的数据
          const finalChunk = decoder.decode(new Uint8Array(), { stream: false })
          console.log(`[SSE] done=true, decoder.flush()="${finalChunk.replace(/\n/g, '\\n')}"`)
          if (finalChunk) {
            buffer += finalChunk
          }
          console.log(`[SSE] done=true, final buffer="${buffer.replace(/\n/g, '\\n')}"`)
          break
        }
        
        // 解码二进制数据
        const decoded = decoder.decode(value, { stream: true })
        buffer += decoded
        console.log(`[SSE] received chunk, decoded len=${decoded.length}, buffer="${buffer.replace(/\n/g, '\\n').substring(0, 100)}..."`)
        
        // 按行分割处理
        const lines = buffer.split('\n')
        // 保留最后一行（可能不完整）
        buffer = lines.pop() || ''
        console.log(`[SSE] lines=${lines.length}, buffer after pop="${buffer.replace(/\n/g, '\\n')}"`)
        
        // 处理完整行
        for (const line of lines) {
          const trimmedLine = line.trim()
          if (!trimmedLine) continue
          
          const event = parseSSELine(trimmedLine)
          if (!event) continue
          
          eventCount++
          console.log(`[SSE] Event ${eventCount}: ${event.type}${event.delta ? ` delta="${event.delta}"` : ''}`)
          
          // 处理不同类型的 AG-UI 事件
          setMessages(prev => {
            const newMessages = [...prev]
            const assistantIndex = newMessages.findIndex(
              m => m.id === assistantMsgId
            )
            
            if (assistantIndex === -1) return prev
            
            const assistant = { ...newMessages[assistantIndex] }
            
            switch (event.type) {
              case 'TEXT_MESSAGE_CONTENT':
                // 追加文本内容
                assistant.content += event.delta || ''
                break
                
              case 'TEXT_MESSAGE_END':
                // 文本消息结束
                assistant.status = 'completed'
                break
                
              case 'TOOL_CALL_START':
                // 工具调用开始
                // 注意：AG-UI 协议 SSE 使用 camelCase（by_alias=True 序列化）
                assistant.toolCalls = [
                  ...(assistant.toolCalls || []),
                  {
                    id: event.toolCallId || event.tool_call_id || generateId(),
                    name: event.toolCallName || event.tool_call_name || '',
                    arguments: '',
                    status: 'calling',
                  },
                ]
                break
                
              case 'TOOL_CALL_ARGS':
                // 工具调用参数（增量）
                if (assistant.toolCalls && assistant.toolCalls.length > 0) {
                  const lastTool = assistant.toolCalls[assistant.toolCalls.length - 1]
                  lastTool.arguments += event.delta || ''
                }
                break
                
              case 'TOOL_CALL_END':
                // 工具调用结束
                if (assistant.toolCalls && assistant.toolCalls.length > 0) {
                  const lastTool = assistant.toolCalls[assistant.toolCalls.length - 1]
                  lastTool.status = 'completed'
                }
                break
                
              case 'TOOL_CALL_RESULT':
                // 工具调用结果
                // 修复 P9: 按 toolCallId 匹配，而非取最后一个
                {
                  const toolCallId = event.toolCallId || event.tool_call_id
                  const targetTool = assistant.toolCalls?.find(
                    (tc: ToolCallInfo) => tc.id === toolCallId
                  )
                  if (targetTool) {
                    targetTool.result = event.content || ''
                    targetTool.status = 'completed'
                  }
                }
                break
                
              case 'RUN_FINISHED':
                // 运行结束
                console.log(`[SSE] ✅ RUN_FINISHED received! Setting status to completed`)
                assistant.status = 'completed'
                break
                
              case 'RUN_ERROR':
                // 运行错误
                assistant.status = 'error'
                assistant.content += `\n[错误: ${event.message || '未知错误'}]`
                break
            }
            
            newMessages[assistantIndex] = assistant
            return newMessages
          })
        }
      }
      
      console.log(`[SSE] Loop ended, total events=${eventCount}, residual buffer="${buffer.replace(/\n/g, '\\n')}"`)
      
      // 修复 R5: 处理循环结束后 buffer 中残余的数据
      if (buffer.trim()) {
        console.log(`[SSE] Processing residual buffer: "${buffer.trim().replace(/\n/g, '\\n')}"`)
        const event = parseSSELine(buffer.trim())
        if (event) {
          console.log(`[SSE] Residual event: ${event.type}`)
          setMessages(prev => {
            const newMessages = [...prev]
            const assistantIndex = newMessages.findIndex(
              m => m.id === assistantMsgId
            )
            if (assistantIndex !== -1) {
              const assistant = { ...newMessages[assistantIndex] }
              if (event.type === 'RUN_FINISHED') {
                console.log(`[SSE] ✅ RUN_FINISHED received in residual!`)
                assistant.status = 'completed'
              } else if (event.type === 'TEXT_MESSAGE_CONTENT') {
                assistant.content += event.delta || ''
              }
              newMessages[assistantIndex] = assistant
            }
            return newMessages
          })
        }
      }
      
      // 最终确保状态为完成
      setMessages(prev => {
        const newMessages = [...prev]
        const assistantIndex = newMessages.findIndex(
          m => m.id === assistantMsgId
        )
        if (assistantIndex !== -1 && newMessages[assistantIndex].status === 'streaming') {
          newMessages[assistantIndex] = {
            ...newMessages[assistantIndex],
            status: 'completed',
          }
        }
        return newMessages
      })
      
      setIsStreaming(false)
    })
    .catch(error => {
      console.error('发送消息失败:', error)
      setIsStreaming(false)
      
      // 更新用户消息状态为错误
      setMessages(prev => {
        const newMessages = [...prev]
        const userIndex = newMessages.findIndex(m => m.id === userMsg.id)
        if (userIndex !== -1) {
          newMessages[userIndex] = {
            ...newMessages[userIndex],
            status: 'error',
          }
        }
        return newMessages
      })
    })
  }, [])

  return {
    messages,
    sendMessage,
    isStreaming,
  }
}

// 导出类型
export type { ChatMessage, ToolCallInfo, AGUIEvent, AGUIEventType, RunAgentInput }
