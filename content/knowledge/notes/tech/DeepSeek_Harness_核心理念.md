---
publish: true
updated: 2026-08-18
status: reviewed
tags:
  - deepseek
  - harness
  - agent
---

# DeepSeek Harness：核心理念与特点

## 一切皆插件

DeepSeek Harness（DSH）的核心理念是：**一切皆插件**。

可以把 Agent 比作一艘船。大部分 Agent 是针对不同场景设计的不同船只，例如集装箱货轮、油轮、军舰。它们出厂时基本已是成品，通常只能对少数模块进行修补或替换。

DSH 则更像“忒修斯之船”：船上的每一个模块都可以替换，而且替换发生在航行过程中，同时还要保证船不会沉——也就是在 Agent 持续运行的情况下完成组件替换，并维持系统可用性。

## 插件与 Skills 的区别

DSH 的插件不受 Agent 框架本身的能力边界限制，因此可以实现比 Skills 更强的确定性。

例如，插件可以确定性地记录每一步的 session log，而不是依赖模型是否正确理解并执行某项 Skill 指令。

## 极致的可观测性

DSH 的另一个特点是极致的可观测性。系统原生暴露运行过程与状态，不再需要通过 Hook 机制额外截获和拼接观测数据。
