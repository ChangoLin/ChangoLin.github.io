# 知识花园

这是 [changolin.github.io](https://changolin.github.io/) 的源代码，使用 [Quartz 5](https://quartz.jzhao.xyz/) 将 Obsidian Markdown 发布为可搜索、可链接的 Wiki。

## 公开边界

网站只收录源知识库中 frontmatter 明确包含以下字段的 Markdown：

```yaml
publish: true
```

未标记文档、非 Markdown 附件和本地私有链接不会发布；指向未公开内容的链接会转成“（未公开）”纯文本。

## 本地更新

```bash
npm ci
npm run sync:knowledge
npm run test:publisher
npm run check
npx quartz build
```

默认读取 `~/.hermes/workspace/knowledge`，也可指定来源：

```bash
npm run sync:knowledge -- /path/to/knowledge
# 或
KNOWLEDGE_SOURCE=/path/to/knowledge npm run sync:knowledge
```

## 名字打架部署顺序

Pages 工作流会在 Quartz 构建后，将私有游戏仓库提供的已编译
`apps/name-fight/` 整体放入站点的 `/name-fight/`。为避免发布不完整或占位应用，工作流要求
`apps/name-fight/index.html` 已存在，否则会立即失败；本仓库不生成或保存虚构的游戏 bundle。

因此，应先由私有游戏仓库更新真实的 `apps/name-fight/` 构建产物，再触发本仓库的
`master` Pages 部署。推送到 `master` 后，GitHub Actions 会构建并部署组合站点。
