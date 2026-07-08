/**
 * AgentInfoView.tsx
 * 
 * Agent 内部处理步骤展示组件（调试面板右栏）
 * 
 * 功能说明：
 * - 将 Agent 内部事件流组织成清晰的处理步骤
 * - 每个步骤展示：步骤标题、输入、输出、关联事件
 * - 步骤包括：
 *   1. 接收消息（ReplyStartEvent）
 *   2. 思考过程（ThinkingBlock*Event）
 *   3. 生成回复（TextBlock*Event）
 *   4. 工具调用（ToolCall*Event + ToolResult*Event）
 *   5. 完成回复（ReplyEndEvent）
 * 
 * 数据格式：
 * 每个步骤包含：
 * - step: 步骤编号
 * - title: 步骤标题
 * - icon: 步骤图标
 * - input: 输入信息
 * - output: 输出信息
 * - events: 关联的原始事件列表
 * - isActive: 当前步骤是否正在执行
 * - isComplete: 步骤是否已完成
 */

import { useState, useMemo } from 'react'
import { Collapse, Tag, Badge } from 'antd'
import { formatJSON } from '../../utils/jsonFormatter'
import type { AgentEventItem } from '../../hooks/useDebugWS'

const { Panel } = Collapse

/**
 * 处理步骤接口
 */
interface AgentStep {
  /** 步骤编号 */
  step: number
  /** 步骤标题 */
  title: string
  /** 步骤图标 */
  icon: string
  /** 步骤颜色 */
  color: string
  /** 关联的原始事件列表 */
  events: AgentEventItem[]
  /** 输入信息 */
  input?: { label: string; value: string; detail?: any }
  /** 输出信息 */
  output?: { label: string; value: string; detail?: any }
  /** 是否已完成 */
  isComplete: boolean
  /** 开始时间 */
  startTime?: number
  /** 结束时间 */
  endTime?: number
}

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
 * 步骤状态标签
 */
function getStepStatusTag(step: AgentStep) {
  if (step.isComplete) {
    return <Tag color="success" style={{ fontSize: 10, margin: 0 }}>✅ 完成</Tag>
  }
  if (step.events.length > 0) {
    return <Tag color="processing" style={{ fontSize: 10, margin: 0 }}>⏳ 进行中</Tag>
  }
  return <Tag style={{ fontSize: 10, margin: 0 }}>⏹️ 未开始</Tag>
}

/**
 * 步骤时间范围
 */
function getStepTimeRange(step: AgentStep): string {
  if (step.startTime && step.endTime) {
    const duration = step.endTime - step.startTime
    return `${formatTime(step.startTime)} - ${formatTime(step.endTime)} (${duration}ms)`
  }
  if (step.startTime) {
    return `${formatTime(step.startTime)} 开始`
  }
  return ''
}

/**
 * 将 Agent 事件流组织成处理步骤
 */
function organizeEvents(data: AgentEventItem[]): AgentStep[] {
  const steps: AgentStep[] = []

  // === 步骤1：接收消息（ReplyStartEvent 或 ModelCallStartEvent）===
  const startEvent = data.find(item =>
    item.data?.eventType === 'ReplyStartEvent' ||
    item.data?.eventType === 'ModelCallStartEvent'
  )
  if (startEvent) {
    const event = startEvent.data?.event || {}
    const input = event.input || {}
    const msgs = input.messages || []
    const userMsg = msgs.find((m: any) => m.role === 'user' || m.name === 'user')
    const userContent = userMsg?.content?.[0]?.text || userMsg?.content || 'N/A'
    const eventType = startEvent.data?.eventType || ''
    const isModelCall = eventType === 'ModelCallStartEvent'

    steps.push({
      step: 1,
      title: isModelCall ? '调用模型' : '接收消息',
      icon: isModelCall ? '🚀' : '📨',
      color: 'blue',
      events: [startEvent],
      input: {
        label: '用户输入',
        value: `共 ${msgs.length} 条消息，用户消息: "${userContent}"`,
        detail: input,
      },
      output: {
        label: isModelCall ? '模型调用' : 'Agent 收到',
        value: isModelCall
          ? `调用模型: ${event.model_name || '-'} (reply: ${event.reply_id || '-'})`
          : `Agent 收到消息，准备开始回复 (session: ${event.session_id || '-'}, name: ${event.name || 'Friday'})`,
      },
      isComplete: true,
      startTime: startEvent.timestamp,
      endTime: startEvent.timestamp,
    })
  }

  // === 步骤2：思考过程（ThinkingBlock*Event）===
  const thinkingEvents = data.filter(item =>
    item.data?.eventType?.startsWith('ThinkingBlock')
  )
  if (thinkingEvents.length > 0) {
    const thinkingContent = thinkingEvents
      .filter(item => item.data?.eventType === 'ThinkingBlockDeltaEvent')
      .map(item => item.data?.event?.delta || '')
      .join('')

    steps.push({
      step: 2,
      title: '思考过程',
      icon: '🤔',
      color: 'purple',
      events: thinkingEvents,
      output: {
        label: '思考内容',
        value: thinkingContent || '（思考过程）',
        detail: thinkingEvents.map(item => item.data?.event),
      },
      isComplete: thinkingEvents.some(item => item.data?.eventType === 'ThinkingBlockEndEvent'),
      startTime: thinkingEvents[0]?.timestamp,
      endTime: thinkingEvents[thinkingEvents.length - 1]?.timestamp,
    })
  }

  // === 步骤3：生成回复（TextBlock*Event）===
  const textBlockEvents = data.filter(item =>
    item.data?.eventType?.startsWith('TextBlock')
  )
  if (textBlockEvents.length > 0) {
    const generatedContent = textBlockEvents
      .filter(item => item.data?.eventType === 'TextBlockDeltaEvent')
      .map(item => item.data?.event?.delta || '')
      .join('')

    steps.push({
      step: 3,
      title: '生成回复',
      icon: '📝',
      color: 'green',
      events: textBlockEvents,
      input: {
        label: '模型输入',
        value: 'Agent 内部推理状态',
      },
      output: {
        label: '生成的文本',
        value: generatedContent || '（文本生成）',
        detail: textBlockEvents.map(item => item.data?.event),
      },
      isComplete: textBlockEvents.some(item => item.data?.eventType === 'TextBlockEndEvent'),
      startTime: textBlockEvents[0]?.timestamp,
      endTime: textBlockEvents[textBlockEvents.length - 1]?.timestamp,
    })
  }

  // === 步骤4：工具调用（ToolCall*Event + ToolResult*Event）===
  const toolCallEvents = data.filter(item =>
    item.data?.eventType?.startsWith('ToolCall') ||
    item.data?.eventType?.startsWith('ToolResult')
  )
  if (toolCallEvents.length > 0) {
    const startEvent = toolCallEvents.find(item => item.data?.eventType === 'ToolCallStartEvent')
    const deltaEvent = toolCallEvents.find(item => item.data?.eventType === 'ToolCallDeltaEvent')
    const resultEvent = toolCallEvents.find(item => item.data?.eventType === 'ToolResultEndEvent')

    const toolName = startEvent?.data?.event?.tool_call_name || 'Unknown'
    const toolArgs = deltaEvent?.data?.event?.delta || '{}'
    const toolResult = resultEvent?.data?.event?.state || resultEvent?.data?.event?.output || ''

    let resultStr = ''
    if (typeof toolResult === 'string') {
      resultStr = toolResult
    } else if (toolResult) {
      resultStr = JSON.stringify(toolResult)
    }

    steps.push({
      step: 4,
      title: '工具调用',
      icon: '🔧',
      color: 'orange',
      events: toolCallEvents,
      input: {
        label: '工具请求',
        value: `工具: ${toolName}, 参数: ${toolArgs}`,
        detail: startEvent?.data?.event,
      },
      output: {
        label: '工具结果',
        value: resultStr || '（等待结果）',
        detail: resultEvent?.data?.event,
      },
      isComplete: !!resultEvent,
      startTime: toolCallEvents[0]?.timestamp,
      endTime: toolCallEvents[toolCallEvents.length - 1]?.timestamp,
    })
  }

  // === 步骤5：完成回复（ReplyEndEvent 或 ModelCallEndEvent）===
  const endEvent = data.find(item =>
    item.data?.eventType === 'ReplyEndEvent' ||
    item.data?.eventType === 'ModelCallEndEvent'
  )
  if (endEvent) {
    const event = endEvent.data?.event || {}
    const output = event.output_summary
    const eventType = endEvent.data?.eventType || ''
    const isModelCall = eventType === 'ModelCallEndEvent'

    steps.push({
      step: 5,
      title: isModelCall ? '模型调用完成' : '完成回复',
      icon: '✅',
      color: 'success',
      events: [endEvent],
      input: {
        label: '完成状态',
        value: isModelCall
          ? `模型调用完成 (reply: ${event.reply_id || '-'})`
          : `Agent 完成回复 (session: ${event.session_id || '-'}, reply: ${event.reply_id || '-'})`,
      },
      output: {
        label: '输出摘要',
        value: output
          ? isModelCall
            ? `完成回复 (thread: ${output.thread_id || '-'}, run: ${output.run_id || '-'}, status: ${output.status || 'completed'}, tokens: ${output.input_tokens || 0} in / ${output.output_tokens || 0} out)`
            : `完成回复 (thread: ${output.thread_id || '-'}, run: ${output.run_id || '-'}, status: ${output.status || 'completed'})`
          : (isModelCall ? '模型调用完成' : 'Agent 完成回复'),
      },
      isComplete: true,
      startTime: endEvent.timestamp,
      endTime: endEvent.timestamp,
    })
  }

  return steps
}

/**
 * 步骤详情组件
 */
function StepDetail({ step }: { step: AgentStep }) {
  return (
    <div className="step-detail">
      {/* 步骤时间 */}
      <div className="step-time-range">
        {getStepTimeRange(step)}
      </div>

      {/* 输入 */}
      {step.input && (
        <div className="step-input-section">
          <div className="step-section-label input">
            📥 输入：{step.input.label}
          </div>
          <pre className="step-content input">{step.input.value}</pre>
          {step.input.detail && (
            <details className="step-detail-toggle">
              <summary>查看完整输入数据</summary>
              <pre className="json-code">{formatJSON(step.input.detail, 2)}</pre>
            </details>
          )}
        </div>
      )}

      {/* 输出 */}
      {step.output && (
        <div className="step-output-section">
          <div className="step-section-label output">
            📤 输出：{step.output.label}
          </div>
          <pre className="step-content output">{step.output.value}</pre>
          {step.output.detail && (
            <details className="step-detail-toggle">
              <summary>查看完整输出数据</summary>
              <pre className="json-code">{formatJSON(step.output.detail, 2)}</pre>
            </details>
          )}
        </div>
      )}

      {/* 关联事件 */}
      {step.events.length > 0 && (
        <div className="step-events-section">
          <div className="step-section-label">🔍 关联事件 ({step.events.length} 个)</div>
          <div className="step-events-list">
            {step.events.map((item, index) => {
              const eventType = item.data?.eventType || 'Unknown'
              const eventData = item.data?.event || {}
              const isDeltaEvent = eventType.includes('Delta')
              const delta = eventData?.delta || ''
              const hasDelta = isDeltaEvent && delta

              return (
                <details key={item.id} className="step-event-detail">
                  <summary className="step-event-summary">
                    <span className="step-event-index">{index + 1}.</span>
                    <span className="step-event-time">{formatTime(item.timestamp)}</span>
                    <Tag color="default" style={{ fontSize: 10, margin: '0 4px' }}>
                      {eventType}
                    </Tag>
                    {hasDelta && (
                      <span className="step-event-delta-preview">
                        {delta.length > 20 ? delta.substring(0, 20) + '...' : delta}
                      </span>
                    )}
                  </summary>
                  <div className="step-event-detail-content">
                    {hasDelta && (
                      <div className="step-event-delta-content">
                        <span className="delta-label">delta:</span>
                        <pre className="delta-value">{delta}</pre>
                      </div>
                    )}
                    <pre className="json-code">{formatJSON(eventData, 2)}</pre>
                  </div>
                </details>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Agent 内部处理步骤展示组件
 * 
 * 属性：
 * - data: Agent 事件数据列表
 */
/**
 * 获取步骤摘要（用于 header 展示）
 */
function getStepSummary(step: AgentStep): string {
  const value = step.output?.value || ''
  if (!value) return ''

  // 对于思考过程和生成回复，显示内容长度和摘要
  if (step.step === 2 || step.step === 3) {
    const contentLength = value.length
    const displayValue = value.length > 50 ? value.substring(0, 50) + '...' : value
    return `${displayValue} (${contentLength} 字符)`
  }

  return value.length > 80 ? value.substring(0, 80) + '...' : value
}

export default function AgentInfoView({ data }: { data: AgentEventItem[] }) {
  // 默认不展开所有面板
  const [activeKeys, setActiveKeys] = useState<string[]>([])

  // 将事件组织成步骤
  const steps = useMemo(() => organizeEvents(data), [data])

  return (
    <div className="agent-info-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 标题栏 */}
      <div className="panel-header">
        <h3 className="panel-title">🤖 Agent 处理步骤</h3>
        <span className="panel-count">{steps.length} 个步骤</span>
      </div>

      {/* 步骤列表 */}
      <div className="panel-content">
        {steps.length === 0 ? (
          <div className="empty-panel">
            <div className="empty-icon">🤖</div>
            <div className="empty-text">等待 Agent 运行...</div>
          </div>
        ) : (
          <Collapse
            activeKey={activeKeys}
            onChange={setActiveKeys}
            ghost
          >
            {steps.map((step) => (
              <Panel
                key={step.step}
                header={
                  <div className="step-header">
                    <div className="step-title">
                      <span className="step-icon">{step.icon}</span>
                      <span className="step-number">步骤 {step.step}</span>
                      <span className="step-name">{step.title}</span>
                    </div>
                    <div className="step-meta">
                      {step.output?.value && (
                        <span style={{ marginRight: 8, color: '#666', fontSize: 11, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {getStepSummary(step)}
                        </span>
                      )}
                      {getStepStatusTag(step)}
                      {step.events.length > 0 && (
                        <Badge
                          count={step.events.length}
                          style={{ fontSize: 10, marginLeft: 8 }}
                        />
                      )}
                    </div>
                  </div>
                }
              >
                <StepDetail step={step} />
              </Panel>
            ))}
          </Collapse>
        )}
      </div>
    </div>
  )
}
