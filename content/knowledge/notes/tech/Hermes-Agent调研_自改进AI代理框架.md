---
publish: true
kind: note
domain_bucket: tech
source_type: web-article
created: 2026-04-17
updated: 2026-07-08
tags:
  - tech
  - agent
  - hermes-agent
  - self-improving-agent
  - agent-architecture
source:
  - https://hermes-agent.nousresearch.com/docs/
  - https://github.com/nousresearch/hermes-agent
  - https://www.mindstudio.ai/blog/what-is-hermes-agent-openclaw-alternative
---

# Hermes Agent 调研：自改进 AI 代理框架

## 基本信息

- **开发方**：Nous Research（模型训练实验室，开发 Hermes、Nomos、Psyche 等模型）
- **定位**：自改进型 AI 代理框架
- **开源**：MIT License
- **官网**：https://hermes-agent.nousresearch.com
- **GitHub**：https://github.com/nousresearch/hermes-agent

---

## 一句话总结

大多数 Agent 框架是「执行 → 返回」的单次循环。Hermes 在每次执行后多走一步：**评估 → 提取 → 存储**。它不只是在帮你做事，它是在**从帮你做事中学习怎么做得更好**。

---

## 核心机制

### 1. 学习循环（Learning Loop）—— Hermes 的根本创新

Hermes 的闭环由五个阶段组成：

| 阶段 | 做什么 |
|------|--------|
| **Task Execution** | 执行任务：分解 → 选择工具 → 执行 |
| **Outcome Evaluation** | 判断结果：成功/失败？用户接受/纠正？ |
| **Skill Extraction** | 从成功的非平凡任务中提取推理模式，创建技能 |
| **Skill Refinement** | 新证据对比现有技能，更优则修订 |
| **Skill Retrieval** | 新任务到来时搜索技能库，匹配并应用已有经验 |

关键不在于「能做这五步」，而在于**它使得跨 session 的能力积累成为系统默认行为，而不是需要人手动总结的额外工作**。

### 2. 自主技能创建（skill_manage）

Agent 可以在任务过程中自行创建、修补和删除技能，不需要人介入：

| Action | 用途 |
|--------|------|
| `create` | 新建技能 |
| `patch` | 局部修改（只传 old_string → new_string，省 token） |
| `edit` | 全文重写 |
| `delete` | 删除过时技能 |

触发条件不是定时扫描或猜测——只有在**真实完成复杂任务**（5+ tool calls）、**被用户纠正了方法**、或**发现了非平凡工作流**时才触发。这意味着技能库的增长是有质量的，不是自动膨胀的垃圾场。

### 3. 持久化记忆（MEMORY.md + USER.md）

Hermes 用两个文件承载跨 session 记忆，均为 Agent 自主管理：

| 文件 | 内容 | 容量 |
|------|------|------|
| `MEMORY.md` | Agent 对环境、工作流、发现的记录 | ~2200 chars |
| `USER.md` | 用户偏好、沟通风格、期望 | ~1375 chars |

注入机制：session 启动时从磁盘加载，冻结为 system prompt 快照（保留 LLM prefix cache）。Agent 通过 `memory` 工具自行增删改。超过 80% 容量时自动整合，内置安全扫描防 prompt injection。

在此基础上还挂了 **Session Search**：SQLite + FTS5 全文搜索所有历史对话，由 Gemini Flash 摘要化结果，支持自然语言跨 session 回溯（「上周我们讨论茅台了吗？」）。

### 4. 用户建模（Honcho）

Honcho 不是静态 profile，而是持续追踪四类信号：

| 画像维度 | 追踪内容 |
|----------|----------|
| **Task Preferences** | 输出格式、结构、风格偏好 |
| **Decision History** | 过去类似情境下用户的选择 |
| **Common Patterns** | 任务类型、频率、上下文 |
| **Feedback Signals** | 纠正 vs 接受（无编辑接受 = 正向信号） |

最终效果：Agent 逐渐停止问「已经知道答案的问题」，自动匹配偏好，不需要用户反复纠正。

### 5. Progressive Disclosure（渐进式技能加载）

技能列表不再全量注入 system prompt，而是按需加载：

| Level | 调用 | 内容 | token 成本 |
|-------|------|------|------------|
| 0 | `skills_list()` | name + description + category | ~3k |
| 1 | `skill_view(name)` | 完整 SKILL.md | 按需 |
| 2 | `skill_view(name, path)` | 指定 reference 文件 | 按需 |

这意味着即使技能库膨胀到几十个，每次 session 的固定 token 开销也不会线性增长。

---

## 与 OpenClaw 的本质区别

对比表只能罗列功能有无，但真正重要的不是「谁多了什么 feature」，而是**架构设计的目标不同**。

### OpenClaw：单次执行的最优解

OpenClaw 的设计哲学是**让每次任务执行本身做到最好**。它的核心能力是：

- 任务规划与分解
- 工具编排
- 多模态输入处理
- 广泛的集成覆盖

它把「执行」这件事做到了极致——但每次执行是独立的。session 结束后，Agent 不主动从这次交互中学任何东西。即使有 skill-evolver 的被动反思机制，也没有闭环验证（「改进后实测 → 确认保留」），更没有「任务成功 → 自动提取」的触发链路。

**OpenClaw 的本质：一个优秀的执行引擎。**

### Hermes：跨 session 的能力积累

Hermes 的设计哲学是**让 Agent 越用越强**。它不是在执行层比 OpenClaw 更聪明，而是在执行之外多了一层：

```
OpenClaw:  执行 → 返回 → 结束
Hermes:    执行 → 返回 → 评估 → 提取技能 → 存储 → 下次自动复用
```

这层差异意味着：

| 维度 | OpenClaw | Hermes |
|------|----------|--------|
| **任务模型** | 每次独立，无跨 session 学习 | 每次是积累，下次起点更高 |
| **技能来源** | 人编写或 AI 离线生成 | Agent 从自身成功经验中实时提取 |
| **用户理解** | 静态画像文件 | 持续追踪偏好的动态模型 |
| **技能加载** | 全量注入 system prompt | 渐进式，按需检索 |
| **历史回溯** | 无内置 session 搜索 | FTS5 全文搜索 + 摘要化 |

### 核心差异不是功能多少，是「有没有学习层」

Hermes 比 OpenClaw 多了一个**独立于执行层的学习层**。这层负责：

1. 判断什么值得学（非平凡任务 + 成功结果）
2. 提取可复用的模式（创建/修订 skill）
3. 在不干扰执行的前提下渐进加载（progressive disclosure）
4. 持续追踪用户变化（Honcho 反馈信号）

这不是「多了某个 feature」的问题。这是**Agent 有没有自主向上进化的能力**的问题。

---

## 其他机制

### 终端后端

支持 6 种后端——local、Docker、SSH、Daytona（Serverless 持久化）、Singularity（HPC）、Modal（Serverless GPU）。Agent 不绑定本地机器。

### 平台覆盖

15+ 平台：Telegram、Discord、Slack、WhatsApp、Signal、Matrix、Email、SMS、飞书、钉钉等。内置实时语音交互和 cron scheduler。

### MCP 集成

连接任意 MCP server，支持工具过滤和安全扫描。

---

## 适用场景

### Hermes 更适合

- 重复性、结构化的任务（同类问题反复出现）
- 同一用户/团队长期高频使用
- 可衡量改进效果（速度、接受率、纠错次数减少）

### OpenClaw 更适合

- 对工具覆盖广度要求高、需要快速部署
- 强调单次执行质量而非跨 session 学习
- 不希望在本地运行 Agent 进程

---

## 关键引用

- 官方文档：https://hermes-agent.nousresearch.com/docs/
- GitHub：https://github.com/nousresearch/hermes-agent
- Memory System：https://hermes-agent.nousresearch.com/docs/user-guide/features/memory
- Skills System：https://hermes-agent.nousresearch.com/docs/user-guide/features/skills
- MindStudio 对比分析：https://www.mindstudio.ai/blog/what-is-hermes-agent-openclaw-alternative
- agentskills.io 标准：https://agentskills.io/specification

---

_调研日期：2026-04-17_
_更新日期：2026-07-08_
_来源：Web Search + Official Docs + GitHub_
