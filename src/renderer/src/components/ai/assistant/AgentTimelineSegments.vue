<template>
  <!-- 工作流时间轴：工具调用按批次聚合成折叠摘要行，仅最后一条助手气泡 -->
  <div class="ap-timeline">
    <template v-for="seg in segments" :key="seg.key">
      <!-- M3：子代理嵌套段——委派的子代理完整过程（任务 + 内部工具活动 + 结论） -->
      <div v-if="seg.kind === 'subagent'" class="ap-tl-group">
        <div class="ap-tl-dot ap-tl-dot--sub"><el-icon :size="10"><Connection /></el-icon></div>
        <div class="ap-tl-main">
          <button type="button" class="ap-tl-summary" @click.stop="emit('toggleSeg', seg.key)">
            <span class="ap-tl-summary-text">
              {{ t('assistant.timeline.subAgent', { task: seg.task }) }}
              <template v-if="seg.items.length">{{ subAgentSteps(seg.items.length, seg.ok) }}</template>
            </span>
            <el-icon
              :size="11"
              class="ap-tl-caret"
              :class="{ 'is-open': open[seg.key] }"
            ><ArrowRight /></el-icon>
          </button>
          <div v-if="open[seg.key]" class="ap-tl-details">
            <div v-for="it in seg.items" :key="it.id" class="ap-tl-item">
              <el-icon :size="13" class="ap-tl-item-icon">
                <component :is="metaOf(it.tool).icon" />
              </el-icon>
              <span class="ap-tl-item-verb">{{ metaOf(it.tool).verb }}</span>
              <span class="ap-tl-item-target" :title="it.resultSummary ?? it.body">
                <template v-if="pathParts(it.body)">
                  <span class="ap-tl-path-head">{{ pathParts(it.body)!.head }}</span><span class="ap-tl-path-name">{{ pathParts(it.body)!.name }}</span>
                </template>
                <template v-else>{{ it.body || it.resultSummary }}</template>
              </span>
              <el-icon
                v-if="it.ok === true"
                :size="12"
                class="ap-tl-item-status is-ok"
                :title="it.resultSummary"
              ><CircleCheckFilled /></el-icon>
              <el-icon
                v-else-if="it.ok === false"
                :size="12"
                class="ap-tl-item-status is-fail"
                :title="it.resultSummary"
              ><CircleCloseFilled /></el-icon>
            </div>
            <div v-if="seg.resultSummary" class="ap-tl-item-result">{{ seg.resultSummary }}</div>
          </div>
        </div>
      </div>
      <div v-else-if="seg.kind === 'tools'" class="ap-tl-group">
        <div class="ap-tl-dot"><el-icon :size="10"><Tools /></el-icon></div>
        <div class="ap-tl-main">
          <button type="button" class="ap-tl-summary" @click.stop="emit('toggleSeg', seg.key)">
            <span class="ap-tl-summary-text">{{ segmentSummary(seg.items) }}</span>
            <el-icon
              :size="11"
              class="ap-tl-caret"
              :class="{ 'is-open': open[seg.key] }"
            ><ArrowRight /></el-icon>
          </button>
          <div v-if="open[seg.key]" class="ap-tl-details">
            <div v-for="it in seg.items" :key="it.id" class="ap-tl-item">
              <el-icon :size="13" class="ap-tl-item-icon">
                <component :is="metaOf(it.tool).icon" />
              </el-icon>
              <span class="ap-tl-item-verb">{{ metaOf(it.tool).verb }}</span>
              <span class="ap-tl-item-target" :title="it.resultSummary ?? toolTarget(it)">
                <template v-if="pathParts(toolTarget(it))">
                  <span class="ap-tl-path-head">{{ pathParts(toolTarget(it))!.head }}</span><span class="ap-tl-path-name">{{ pathParts(toolTarget(it))!.name }}</span>
                </template>
                <template v-else>{{ toolTarget(it) }}</template>
              </span>
              <!-- T1：执行结果状态（tool-activity 回填）；无结果=进行中 -->
              <el-icon
                v-if="it.ok === true"
                :size="12"
                class="ap-tl-item-status is-ok"
                :title="it.resultSummary"
              ><CircleCheckFilled /></el-icon>
              <el-icon
                v-else-if="it.ok === false"
                :size="12"
                class="ap-tl-item-status is-fail"
                :title="it.resultSummary"
              ><CircleCloseFilled /></el-icon>
            </div>
            <!-- T1：最近一次结果摘要（组内最后一条带结果的调用），让「AI 做了什么」一眼可见 -->
            <div
              v-for="it in seg.items.filter((x) => x.resultSummary).slice(-1)"
              :key="`${it.id}-result`"
              class="ap-tl-item-result"
            >{{ it.resultSummary }}</div>
          </div>
        </div>
      </div>
      <div v-else class="ap-tl-group">
        <div class="ap-tl-dot ap-tl-dot--log"><span></span></div>
        <div class="ap-tl-main">
          <div class="ap-tl-logtext">{{ seg.text }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ArrowRight, CircleCheckFilled, CircleCloseFilled, Connection, Tools } from '@element-plus/icons-vue'
import { metaOf, pathParts, segmentSummary, toolTarget, type TimelineSegment } from './useTimeline'
import { useI18n } from '../../../i18n'

defineProps<{
  segments: TimelineSegment[]
  open: Record<string, boolean>
}>()

const { t } = useI18n()

/** 子代理段标题尾注：「（N 步，已完成/失败/进行中）」 */
function subAgentSteps(n: number, ok: boolean | undefined): string {
  const state =
    ok === true
      ? t('assistant.timeline.subAgentDone')
      : ok === false
        ? t('assistant.timeline.subAgentFail')
        : t('assistant.timeline.subAgentRunning')
  return t('assistant.timeline.subAgentSteps', { n, state })
}

const emit = defineEmits<{
  toggleSeg: [key: string]
}>()
</script>

<style scoped>
/* 工作流时间轴：分组折叠行 + 竖线连接 */
.ap-timeline {
  margin: 6px 0 2px;
  display: flex;
  flex-direction: column;
}
.ap-tl-group {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0 3px 2px;
}
/* 组间竖线：从圆点中心向下延伸，最后一组不再延续 */
.ap-tl-group::before {
  content: '';
  position: absolute;
  left: 8px;
  top: 17px;
  bottom: -3px;
  width: 1px;
  background: var(--ky-border);
}
.ap-tl-group:last-child::before { display: none; }
.ap-tl-dot {
  flex: 0 0 14px;
  width: 14px;
  height: 14px;
  margin-top: 2px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--ky-accent-rgb), 0.14);
  color: var(--ky-accent);
  border: 1px solid rgba(var(--ky-accent-rgb), 0.35);
  z-index: 1;
}
.ap-tl-dot--log {
  background: transparent;
  border: none;
  color: var(--ky-text-sub);
}
/* M3：子代理嵌套段圆点（紫色调，与主工具段区分） */
.ap-tl-dot--sub {
  background: rgba(187, 154, 247, 0.14);
  color: #bb9af7;
  border-color: rgba(187, 154, 247, 0.4);
}
.ap-tl-dot--log span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--ky-text-sub);
  opacity: 0.7;
}
.ap-tl-main {
  flex: 1;
  min-width: 0;
}
.ap-tl-summary {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  width: 100%;
  padding: 1px 6px 1px 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 4px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--ky-text-sub);
  text-align: left;
}
.ap-tl-summary:hover {
  color: var(--ky-text);
  background: rgba(147, 153, 178, 0.1);
}
.ap-tl-summary-text {
  flex: 1;
  min-width: 0;
}
.ap-tl-caret {
  flex: 0 0 auto;
  margin-top: 3px;
  transition: transform 0.18s ease;
  opacity: 0.7;
}
.ap-tl-caret.is-open { transform: rotate(90deg); }
.ap-tl-details {
  margin: 4px 0 4px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: rgba(147, 153, 178, 0.07);
  border: 1px solid var(--ky-border);
  border-radius: 8px;
}
.ap-tl-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  line-height: 1.5;
  min-width: 0;
}
.ap-tl-item-icon {
  flex: 0 0 auto;
  color: #7aa2f7;
}
.ap-tl-item-verb {
  flex: 0 0 auto;
  color: var(--ky-text-sub);
}
.ap-tl-item-target {
  flex: 1;
  min-width: 0;
  color: var(--ky-text);
  font-family: var(--ky-font-mono, monospace);
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-tl-path-head { color: var(--ky-text-sub); opacity: 0.75; }
.ap-tl-path-name { color: #7aa2f7; font-weight: 500; }
.ap-tl-item-status { flex: 0 0 auto; }
.ap-tl-item-status.is-ok { color: #67c23a; }
.ap-tl-item-status.is-fail { color: #f56c6c; }
.ap-tl-item-result {
  margin-top: 2px;
  padding: 4px 8px;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ky-text-sub);
  background: rgba(103, 194, 58, 0.07);
  border-left: 2px solid rgba(103, 194, 58, 0.4);
  border-radius: 0 4px 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ap-tl-logtext {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ky-text-sub);
  opacity: 0.85;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
