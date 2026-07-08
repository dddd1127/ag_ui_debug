/**
 * AguiTransformView.tsx
 * 
 * AG-UI 协议转换过程展示组件（调试面板中栏）
 * 
 * 功能说明：
 * - 展示 AG-UI 请求 → Agent 内部请求的转换过程
 * - 展示 Agent 内部事件 → AG-UI 响应事件的转换过程
 * - 时间线式展示，每个转换步骤清晰标注
 * - 关键字段映射高亮（如 threadId → session_id）
 * 
 * 数据格式：
 * 每个数据项包含：
 * - id: 唯一标识
 * - timestamp: 时间戳
 * - data: {
 *     direction: "request" | "response"
 *     input: 原始数据
 *     output: 转换后数据
 *     description?: 转换说明
 *   }
 */

import { useState } from 'react'
import { Collapse, Tag } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import { formatJSON } from '../../utils/jsonFormatter'
import type { AguiTransformItem } from '../../hooks/useDebugWS'

const { Panel } = Collapse

/**
 * 格式化时间戳
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = date.getHours().toString().padStart(2, '0')
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const seconds = date.getSeconds().toString().padStart(2, '0')
  const ms = date.getMilliseconds().toString().padStart(3, '0')
  return `${hours}:${minutes}:${seconds}.${ms}`
}

/**
 * 获取方向标签
 * 
 * 参数：
 * - direction: 转换方向
 * 
 * 返回：
 * - 标签配置（颜色、文字）
 */
function getDirectionTag(direction: string) {
  if (direction === 'request') {
    return { color: 'blue', text: '请求转换' }
  } else {
    return { color: 'green', text: '响应转换' }
  }
}

/**
 * 生成转换摘要（用于 header 展示，无需展开即可看到关键信息）
 */
function getTransformSummary(direction: string, input: any, output: any): string {
  if (direction === 'request') {
    const msgCount = input.messages?.length || 0
    const toolCount = input.tools?.length || 0
    return `${msgCount} 条消息${toolCount > 0 ? `, ${toolCount} 个工具` : ''}`
  }

  const firstEvent = Array.isArray(output) && output.length > 0 ? output[0] : output
  if (!firstEvent) {
    return '❌ 无 AG-UI 对应事件'
  }

  const eventType = firstEvent.type || ''

  if (eventType === 'TEXT_MESSAGE_CONTENT') {
    const delta = firstEvent.delta || ''
    const displayDelta = delta.length > 30 ? delta.substring(0, 30) + '...' : delta
    return `messageId: ${firstEvent.messageId || '-'}, delta: "${displayDelta}"`
  }

  if (eventType === 'THINKING_TEXT_MESSAGE_CONTENT') {
    const delta = firstEvent.delta || ''
    const displayDelta = delta.length > 30 ? delta.substring(0, 30) + '...' : delta
    return `delta: "${displayDelta}"`
  }

  if (eventType === 'TOOL_CALL_START') {
    return `toolCallId: ${firstEvent.toolCallId || '-'}, toolCallName: ${firstEvent.toolCallName || '-'}`
  }

  if (eventType === 'TOOL_CALL_ARGS') {
    const delta = firstEvent.delta || ''
    const displayDelta = delta.length > 30 ? delta.substring(0, 30) + '...' : delta
    return `toolCallId: ${firstEvent.toolCallId || '-'}, delta: "${displayDelta}"`
  }

  if (eventType === 'TOOL_CALL_RESULT') {
    return `toolCallId: ${firstEvent.toolCallId || '-'}, content: ${firstEvent.content || '...'}`
  }

  if (eventType === 'RUN_STARTED') {
    return `runId: ${firstEvent.runId || '-'}, threadId: ${firstEvent.threadId || '-'}`
  }

  if (eventType === 'RUN_FINISHED') {
    return '✅ 运行完成'
  }

  return ''
}

/**
 * 生成转换说明
 * 
 * 根据输入输出数据，生成字段映射说明
 * 
 * 参数：
 * - direction: 转换方向（"request" 或 "response"）
 * - input: 输入数据
 * - output: 输出数据
 * 
 * 返回：
 * - 字段映射说明数组
 */
function generateFieldMapping(direction: string, input: any, output: any): Array<{from: string, to: string, value: any}> {
  // 优先使用后端提供的 field_mappings
  // 请求转换：field_mappings 在 output 中
  // 响应转换：field_mappings 在 input 中（后端已附加）
  const fieldMappings = direction === 'request' 
    ? (output?.field_mappings || input?.field_mappings)
    : (input?.field_mappings || output?.field_mappings)
  
  if (fieldMappings && Array.isArray(fieldMappings)) {
    return fieldMappings.map((m: any) => ({
      from: `${m.from}: "${m.value}"`,
      to: `${m.to}: "${m.value}"`,
      value: m.value,
    }))
  }
  
  const mappings = []
  
  if (direction === 'request') {
    // === 请求转换：AG-UI 请求 → Agent 请求 ===
    // threadId → thread_id
    if (input.threadId !== undefined && output.thread_id !== undefined) {
      mappings.push({
        from: `threadId: "${input.threadId}"`,
        to: `thread_id: "${output.thread_id}"`,
        value: input.threadId,
      })
    }
    
    // runId → run_id
    if (input.runId !== undefined && output.run_id !== undefined) {
      mappings.push({
        from: `runId: "${input.runId}"`,
        to: `run_id: "${output.run_id}"`,
        value: input.runId,
      })
    }
    
    // messages → messages
    if (input.messages && output.messages) {
      mappings.push({
        from: `messages[${input.messages.length}]`,
        to: `messages[${output.messages.length}]`,
        value: `${input.messages.length} 条消息`,
      })
    }
    
    // tools → tools
    if (input.tools && output.tools) {
      mappings.push({
        from: `tools[${input.tools.length}]`,
        to: `tools[${output.tools.length}]`,
        value: `${input.tools.length} 个工具`,
      })
    }
  } else {
    // === 响应转换：Agent 事件 → AG-UI 事件 ===
    // output 是 AG-UI 事件列表，取第一个事件
    // AG-UI 事件使用 camelCase 字段名（by_alias=True 序列化后）
    const firstEvent = Array.isArray(output) && output.length > 0 ? output[0] : output
    
    // 显示事件类型转换
    if (input.type && firstEvent?.type) {
      mappings.push({
        from: `type: "${input.type}"`,
        to: `type: "${firstEvent.type}"`,
        value: `${input.type} → ${firstEvent.type}`,
      })
    }
    
    // reply_id → threadId / messageId / runId
    if (input.reply_id && firstEvent) {
      const targetField = firstEvent.threadId ? 'threadId' : 
                         firstEvent.messageId ? 'messageId' : 
                         firstEvent.runId ? 'runId' : null
      if (targetField) {
        mappings.push({
          from: `reply_id: "${input.reply_id}"`,
          to: `${targetField}: "${firstEvent[targetField]}"`,
          value: input.reply_id,
        })
      }
    }
    
    // block_id → messageId
    if (input.block_id && firstEvent?.messageId) {
      mappings.push({
        from: `block_id: "${input.block_id}"`,
        to: `messageId: "${firstEvent.messageId}"`,
        value: input.block_id,
      })
    }
    
    // tool_call_id → toolCallId
    if (input.tool_call_id && firstEvent?.toolCallId) {
      mappings.push({
        from: `tool_call_id: "${input.tool_call_id}"`,
        to: `toolCallId: "${firstEvent.toolCallId}"`,
        value: input.tool_call_id,
      })
    }
    
    // delta → delta
    if (input.delta && firstEvent?.delta) {
      const displayDelta = input.delta.length > 20 ? input.delta.substring(0, 20) + '...' : input.delta
      mappings.push({
        from: `delta: "${displayDelta}"`,
        to: `delta: "${displayDelta}"`,
        value: input.delta,
      })
    }
    
    // tool_call_name → toolCallName
    if (input.tool_call_name && firstEvent?.toolCallName) {
      mappings.push({
        from: `tool_call_name: "${input.tool_call_name}"`,
        to: `toolCallName: "${firstEvent.toolCallName}"`,
        value: input.tool_call_name,
      })
    }
  }
  
  return mappings
}

/**
 * AG-UI 协议转换展示组件
 * 
 * 属性：
 * - data: 协议转换数据列表
 */
export default function AguiTransformView({ data }: { data: AguiTransformItem[] }) {
  // 默认不展开所有面板
  const [activeKeys, setActiveKeys] = useState<string[]>([])

  return (
    <div className="agui-transform-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 标题栏 */}
      <div className="panel-header">
        <h3 className="panel-title">🔄 协议转换</h3>
        <span className="panel-count">{data.length} 条记录</span>
      </div>

      {/* 数据列表 */}
      <div className="panel-content">
        {data.length === 0 ? (
          <div className="empty-panel">
            <div className="empty-icon">🔄</div>
            <div className="empty-text">等待协议转换...</div>
          </div>
        ) : (
          <Collapse
            activeKey={activeKeys}
            onChange={setActiveKeys}
            ghost
          >
            {data.map((item) => {
              const { direction, input, output, description } = item.data || {}
              const tag = getDirectionTag(direction)
              const mappings = generateFieldMapping(direction, input, output)
              const summary = getTransformSummary(direction, input, output)
              
              // 提取响应类型（对于响应转换）
              const responseType = direction === 'response' && Array.isArray(output) && output.length > 0
                ? output[0]?.type || 'Unknown'
                : null
              
              // 是否无 AG-UI 对应事件
              const isNoMapping = direction === 'response' && (!output || (Array.isArray(output) && output.length === 0))
              
              return (
                <Panel
                  key={item.id}
                  header={
                    <div className="transform-header">
                      <span className="transform-time">{formatTime(item.timestamp)}</span>
                      <Tag color={tag.color}>
                        {tag.text}
                      </Tag>
                      {responseType && (
                        <Tag color="purple" style={{ marginLeft: 8, fontSize: 10 }}>
                          📤 {responseType}
                        </Tag>
                      )}
                      {isNoMapping && (
                        <Tag color="default" style={{ marginLeft: 8, fontSize: 10 }}>
                          ⏭️ 跳过空消息
                        </Tag>
                      )}
                      {item.runId && (
                        <Tag className="transform-run-id" style={{ marginLeft: 8 }}>
                          运行: {item.runId}
                        </Tag>
                      )}
                      {item.threadId && (
                        <Tag className="transform-thread-id" style={{ marginLeft: 4 }}>
                          会话: {item.threadId}
                        </Tag>
                      )}
                      {summary && (
                        <span className="transform-summary" style={{ marginLeft: 8, color: '#666', fontSize: 11, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {summary}
                        </span>
                      )}
                      {description && (
                        <span className="transform-desc">{description}</span>
                      )}
                    </div>
                  }
                >
                  <div className="transform-detail">
                    {/* 字段映射说明 */}
                    {mappings.length > 0 && (
                      <div className="field-mapping">
                        <div className="mapping-title">字段映射：</div>
                        {mappings.map((m, i) => (
                          <div key={i} className="mapping-item">
                            <span className="mapping-from">{m.from}</span>
                            <ArrowRightOutlined className="mapping-arrow" />
                            <span className="mapping-to">{m.to}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    
                    {/* 输入数据 */}
                    <div className="transform-section">
                      <div className="section-title input">输入</div>
                      <pre className="json-code">
                        {formatJSON(input, 2)}
                      </pre>
                    </div>
                    
                    {/* 输出数据 */}
                    <div className="transform-section">
                      <div className="section-title output">输出</div>
                      <pre className="json-code">
                        {formatJSON(output, 2)}
                      </pre>
                    </div>
                  </div>
                </Panel>
              )
            })}
          </Collapse>
        )}
      </div>
    </div>
  )
}
