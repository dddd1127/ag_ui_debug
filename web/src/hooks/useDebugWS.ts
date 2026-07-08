/**
 * useDebugWS.ts
 * 
 * WebSocket 调试通信 Hook
 * 
 * 功能说明：
 * - 管理 WebSocket 连接（自动连接、断线重连）
 * - 接收后端推送的调试信息并分类存储
 * - 支持三种调试数据类型：
 *   1. client_request: 客户端原始请求 JSON（左栏展示）
 *   2. agui_transform: AG-UI 协议转换过程（中栏展示）
 *   3. agent_event: Agent 内部事件（右栏展示）
 * 
 * 返回接口：
 * - clientRequests: 原始请求列表
 * - aguiTransforms: 协议转换记录列表
 * - agentInfos: Agent 内部事件列表
 * - connected: 连接状态
 * - connect: 手动连接函数
 * - disconnect: 手动断开函数
 */

import { useState, useEffect, useRef, useCallback } from 'react'

/** 调试数据项基础接口 */
interface DebugItem {
  /** 唯一标识 */
  id: string
  /** 时间戳（毫秒） */
  timestamp: number
  /** 数据类型 */
  type: string
  /** 关联的运行 ID */
  runId?: string
  /** 关联的会话 ID */
  threadId?: string
  /** 实际数据内容 */
  data: any
}

/** 原始请求数据项 */
interface ClientRequestItem extends DebugItem {
  type: 'client_request'
  data: {
    /** 原始请求 JSON */
    request: Record<string, any>
  }
}

/** 协议转换数据项 */
interface AguiTransformItem extends DebugItem {
  type: 'agui_transform'
  data: {
    /** 转换方向：request（请求转换）或 response（响应转换） */
    direction: 'request' | 'response'
    /** 输入数据 */
    input: Record<string, any>
    /** 输出数据 */
    output: Record<string, any> | Record<string, any>[]
    /** 转换说明（可选） */
    description?: string
  }
}

/** Agent 内部事件数据项 */
interface AgentEventItem extends DebugItem {
  type: 'agent_event'
  data: {
    /** 事件类型名称 */
    eventType: string
    /** 事件数据 */
    event: Record<string, any>
    /** 运行状态 */
    status?: string
  }
}

/** 所有调试数据类型的联合类型 */
type DebugData = ClientRequestItem | AguiTransformItem | AgentEventItem

/** Hook 返回接口 */
interface UseDebugWSReturn {
  /** 原始请求数据列表 */
  clientRequests: ClientRequestItem[]
  /** 协议转换记录列表 */
  aguiTransforms: AguiTransformItem[]
  /** Agent 内部事件列表 */
  agentInfos: AgentEventItem[]
  /** 连接状态 */
  connected: boolean
  /** 手动连接 */
  connect: () => void
  /** 手动断开 */
  disconnect: () => void
  /** 清空所有数据 */
  clear: () => void
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * WebSocket 调试通信 Hook
 * 
 * 使用方式：
 * const { clientRequests, aguiTransforms, agentInfos, connected } = useDebugWS()
 * 
 * 说明：
 * - 组件挂载时自动尝试连接 WebSocket
 * - 断线后自动重连（指数退避策略）
 * - 最多存储 100 条记录，防止内存溢出
 */
export function useDebugWS(): UseDebugWSReturn {
  // WebSocket 连接对象
  const wsRef = useRef<WebSocket | null>(null)
  // 重连尝试计数
  const reconnectCountRef = useRef(0)
  // 重连定时器
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 上一个运行的 runId，用于检测新运行
  const prevRunIdRef = useRef<string>("")
  
  // 连接状态
  const [connected, setConnected] = useState(false)
  // 原始请求数据
  const [clientRequests, setClientRequests] = useState<ClientRequestItem[]>([])
  // 协议转换数据
  const [aguiTransforms, setAguiTransforms] = useState<AguiTransformItem[]>([])
  // Agent 内部事件数据
  const [agentInfos, setAgentInfos] = useState<AgentEventItem[]>([])

  /**
   * 建立 WebSocket 连接
   * 
   * 流程：
   * 1. 创建 WebSocket 对象，连接 /debug/ws
   * 2. 监听 open 事件（连接成功）
   * 3. 监听 message 事件（接收数据）
   * 4. 监听 close/error 事件（断线处理）
   * 
   * 说明：
   * - 如果已有连接，先断开旧连接
   * - 连接成功后重置重连计数
   */
  const connect = useCallback(() => {
    // 如果已有连接，先断开
    if (wsRef.current) {
      wsRef.current.close()
    }

    // 清除重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    try {
      // 创建 WebSocket 连接（通过 Vite 代理转发到后端）
      const ws = new WebSocket('/debug/ws')
      wsRef.current = ws

      // 连接成功
      ws.onopen = () => {
        console.log('WebSocket 调试连接已建立')
        setConnected(true)
        reconnectCountRef.current = 0
      }

      // 接收消息
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          
          // 提取 runId（支持多种字段命名）
          const runId = payload.data?.runId || payload.data?.run_id || payload.data?.request?.runId || payload.data?.input?.runId || ""
          // 提取 threadId（支持多种字段命名）
          const threadId = payload.data?.threadId || payload.data?.thread_id || payload.data?.request?.threadId || payload.data?.input?.threadId || ""

          // 构造调试数据项
          const debugItem: DebugData = {
            id: generateId(),
            timestamp: payload.timestamp || Date.now(),
            type: payload.type,
            runId: runId,
            threadId: threadId,
            data: payload.data,
          }

          // 根据类型分发到不同的状态
          // 去重逻辑：根据 runId + type + 事件类型标识来避免重复
          // 关键：使用 event.id（唯一 UUID）作为唯一标识，而不是 block_id/reply_id
          // 因为 block_id 在 TextBlockDeltaEvent/ThinkingBlockDeltaEvent 等流式事件中是不变的
          const getEventKey = (item: DebugData) => {
            const base = `${item.runId}-${item.type}`
            if (item.type === 'agent_event') {
              // 使用 event.id 唯一标识，避免同 block_id 的 delta 事件被误去重
              return `${base}-${item.data?.eventType}-${item.data?.event?.id || item.data?.event?.block_id || item.data?.event?.tool_call_id || ''}`
            } else if (item.type === 'agui_transform') {
              // 使用 input.id（唯一 UUID）标识，避免同 block_id 的 delta 转换被误去重
              const inputId = item.data?.input?.id || item.data?.input?.block_id || item.data?.input?.tool_call_id || item.data?.input?.reply_id || item.timestamp || ''
              return `${base}-${item.data?.direction}-${item.data?.description || ''}-${inputId}`
            }
            return base
          }

          // 当检测到新运行开始时，清空旧数据
          const isNewRun = prevRunIdRef.current && runId && prevRunIdRef.current !== runId
          if (isNewRun) {
            setClientRequests([])
            setAguiTransforms([])
            setAgentInfos([])
          }
          prevRunIdRef.current = runId || prevRunIdRef.current

          switch (payload.type) {
            case 'client_request':
              setClientRequests(prev => {
                const eventKey = getEventKey(debugItem)
                // 检查是否已存在相同的事件
                const exists = prev.some(item => getEventKey(item) === eventKey)
                if (exists) {
                  return prev
                }
                const newList = [...prev, debugItem as ClientRequestItem]
                // 最多保留 500 条
                return newList.length > 500 ? newList.slice(-500) : newList
              })
              break

            case 'agui_transform':
              setAguiTransforms(prev => {
                const eventKey = getEventKey(debugItem)
                const exists = prev.some(item => getEventKey(item) === eventKey)
                if (exists) {
                  return prev
                }
                const newList = [...prev, debugItem as AguiTransformItem]
                return newList.length > 500 ? newList.slice(-500) : newList
              })
              break

            case 'agent_event':
              setAgentInfos(prev => {
                const eventKey = getEventKey(debugItem)
                const exists = prev.some(item => getEventKey(item) === eventKey)
                if (exists) {
                  return prev
                }
                const newList = [...prev, debugItem as AgentEventItem]
                return newList.length > 500 ? newList.slice(-500) : newList
              })
              break

            default:
              console.warn('未知的调试数据类型:', payload.type)
          }
        } catch (e) {
          console.error('WebSocket 消息解析失败:', e, event.data)
        }
      }

      // 连接关闭
      ws.onclose = () => {
        console.log('WebSocket 调试连接已关闭')
        setConnected(false)
        wsRef.current = null

        // 自动重连（指数退避）
        const maxReconnectDelay = 30000 // 最大 30 秒
        const baseDelay = 1000 // 基础 1 秒
        const delay = Math.min(
          baseDelay * Math.pow(2, reconnectCountRef.current),
          maxReconnectDelay
        )
        
        reconnectCountRef.current++
        
        console.log(`将在 ${delay}ms 后尝试重连...`)
        reconnectTimerRef.current = setTimeout(() => {
          connect()
        }, delay)
      }

      // 连接错误
      ws.onerror = (error) => {
        console.error('WebSocket 调试连接错误:', error)
      }
    } catch (e) {
      console.error('WebSocket 连接失败:', e)
      setConnected(false)
    }
  }, [])

  /**
   * 断开 WebSocket 连接
   * 
   * 说明：
   * - 关闭 WebSocket 连接
   * - 清除重连定时器（防止自动重连）
   */
  const disconnect = useCallback(() => {
    // 清除重连定时器
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }

    // 关闭连接
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    setConnected(false)
  }, [])

  /**
   * 清空所有调试数据
   */
  const clear = useCallback(() => {
    setClientRequests([])
    setAguiTransforms([])
    setAgentInfos([])
  }, [])

  /**
   * 组件挂载时自动连接
   * 组件卸载时断开连接
   */
  useEffect(() => {
    connect()
    
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    clientRequests,
    aguiTransforms,
    agentInfos,
    connected,
    connect,
    disconnect,
    clear,
  }
}

// 导出类型
export type {
  DebugItem,
  ClientRequestItem,
  AguiTransformItem,
  AgentEventItem,
  DebugData,
}
