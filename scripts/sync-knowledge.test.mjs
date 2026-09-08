import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { resolveSourcePath, syncKnowledge } from "./sync-knowledge.mjs"

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "knowledge-publisher-"))
  t.after(async () => {
    const { rm } = await import("node:fs/promises")
    await rm(root, { recursive: true, force: true })
  })
  const sourceDir = path.join(root, "knowledge")
  const contentDir = path.join(root, "content")
  await mkdir(sourceDir, { recursive: true })
  await mkdir(contentDir, { recursive: true })
  return { root, sourceDir, contentDir }
}

async function put(root, relativePath, contents) {
  const filename = path.join(root, relativePath)
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, contents)
}

async function filesBelow(root) {
  const found = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else found.push(path.relative(root, absolute).split(path.sep).join("/"))
    }
  }
  await walk(root)
  return found.sort()
}

test("publishes only Markdown with exact boolean publish: true and removes stale generated output", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(
    sourceDir,
    "notes/common/public.md",
    "---\npublish: true\ntitle: 公开\n---\n公开内容\n    \n保留两个空格换行  \n",
  )
  await put(sourceDir, "notes/private.md", "---\npublish: false\n---\n私密内容\n")
  await put(sourceDir, "notes/string.md", '---\npublish: "true"\n---\n不能发布\n')
  await put(sourceDir, "notes/no-frontmatter.md", "不能发布\n")
  await put(sourceDir, "notes/upper.MD", "---\npublish: true\n---\n也可发布\n")
  await put(sourceDir, "notes/common/manual.pdf", "not really a pdf")
  await put(sourceDir, "notes/common/image.png", "not really an image")
  await put(contentDir, "knowledge/stale.md", "stale secret")
  await put(contentDir, "keep.md", "outside generated subtree")

  const result = await syncKnowledge({ sourceDir, contentDir })

  assert.equal(result.publishedCount, 2)
  assert.deepEqual(await filesBelow(contentDir), [
    "index.md",
    "keep.md",
    "knowledge/notes/common/public.md",
    "knowledge/notes/upper.MD",
  ])
  await assert.rejects(readFile(path.join(contentDir, "knowledge/stale.md"), "utf8"))
  const publicOutput = await readFile(
    path.join(contentDir, "knowledge/notes/common/public.md"),
    "utf8",
  )
  assert.doesNotMatch(publicOutput, /^[ \t]+$/m)
  assert.match(publicOutput, /保留两个空格换行  \n/)
})

test("keeps links to published notes, including full vault paths, aliases, and headings", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(
    sourceDir,
    "notes/common/start.md",
    [
      "---",
      "publish: true",
      'source: "[[knowledge/notes/tech/target#出处|来源]]"',
      "---",
      "[[knowledge/notes/tech/target]]",
      "[[knowledge/notes/tech/target#细节|阅读细节]]",
      "[[../tech/target|相对链接]]",
      "[普通链接](../tech/target.md#细节)",
    ].join("\n"),
  )
  await put(sourceDir, "notes/tech/target.md", "---\npublish: true\n---\n# 细节\n")

  await syncKnowledge({ sourceDir, contentDir })
  const output = await readFile(path.join(contentDir, "knowledge/notes/common/start.md"), "utf8")

  assert.match(output, /source: "\[\[knowledge\/notes\/tech\/target#出处\|来源\]\]"/)
  assert.match(output, /\[\[knowledge\/notes\/tech\/target\]\]/)
  assert.match(output, /\[\[knowledge\/notes\/tech\/target#细节\|阅读细节\]\]/)
  assert.match(output, /\[\[\.\.\/tech\/target\|相对链接\]\]/)
  assert.match(output, /\[普通链接\]\(\.\.\/tech\/target\.md#细节\)/)
})

test("sanitizes private wikilinks, local Markdown links, and attachments while preserving web links", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(
    sourceDir,
    "notes/common/start.md",
    [
      "---",
      "publish: true",
      'source: "[[knowledge/finance/secret|内部来源]]"',
      'document: "[内部 PDF](../../finance/report.pdf)"',
      "---",
      "[[knowledge/finance/secret|财务秘密]]",
      "[[knowledge/diary/2026-01-01]]",
      "[私密笔记](../private.md)",
      "![架构图](./architecture.png)",
      "[本地 PDF](./report.pdf)",
      "[带空格的 PDF](../../raw/private report.pdf)",
      "[外部网站](https://example.com/a.pdf)",
      "![远程图片](http://example.com/image.png)",
    ].join("\n"),
  )
  await put(sourceDir, "finance/secret.md", "---\npublish: false\n---\n秘密\n")

  await syncKnowledge({ sourceDir, contentDir })
  const output = await readFile(path.join(contentDir, "knowledge/notes/common/start.md"), "utf8")

  assert.match(output, /source: "内部来源（未公开）"/)
  assert.match(output, /document: "内部 PDF（未公开）"/)
  assert.match(output, /财务秘密（未公开）/)
  assert.match(output, /2026-01-01（未公开）/)
  assert.match(output, /私密笔记（未公开）/)
  assert.match(output, /架构图（未公开）/)
  assert.match(output, /本地 PDF（未公开）/)
  assert.match(output, /带空格的 PDF（未公开）/)
  assert.match(output, /\[外部网站\]\(https:\/\/example\.com\/a\.pdf\)/)
  assert.match(output, /!\[远程图片\]\(http:\/\/example\.com\/image\.png\)/)
  assert.doesNotMatch(
    output,
    /knowledge\/finance|\.\.\/private|architecture\.png|\.\/report\.pdf|private report/,
  )
})

test("sanitizes local raw HTML href and src attributes while preserving HTTP(S) targets", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(
    sourceDir,
    "notes/start.md",
    [
      "---",
      "publish: true",
      "---",
      '<a href="../private.md">私密笔记</a>',
      '<img src="secret.png" alt="机密图片">',
      '<a href="https://example.com/public">公开链接</a>',
      '<img src="https://example.com/image.png" alt="远程图片">',
    ].join("\n"),
  )

  await syncKnowledge({ sourceDir, contentDir })
  const output = await readFile(path.join(contentDir, "knowledge/notes/start.md"), "utf8")

  assert.match(output, /私密笔记（未公开）/)
  assert.match(output, /机密图片（未公开）/)
  assert.match(output, /<a href="https:\/\/example\.com\/public">公开链接<\/a>/)
  assert.match(output, /<img src="https:\/\/example\.com\/image\.png" alt="远程图片">/)
  assert.doesNotMatch(output, /\.\.\/private\.md|secret\.png/)
})

test("sanitizes local raw HTML URL attributes on every element without breaking safe markup", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(
    sourceDir,
    "notes/start.md",
    [
      "---",
      "publish: true",
      "---",
      '<iframe src="../private.pdf"></iframe>',
      '<script src="../private.js"></script>',
      '<link href="../private.md">',
      '<video src="../private.png"></video>',
      '<source src="../private.pdf" srcset="../private-2x.png 2x">',
      "<br/>",
      '<a href="./target.md">公开笔记</a>',
      '<iframe src="https://example.com/public"></iframe>',
      '<link href="https://example.com/site.css">',
      '<source src="https://example.com/public.pdf" srcset="https://example.com/public.png 2x">',
    ].join("\n"),
  )
  await put(sourceDir, "notes/target.md", "---\npublish: true\n---\n公开内容\n")

  await syncKnowledge({ sourceDir, contentDir })
  const output = await readFile(path.join(contentDir, "knowledge/notes/start.md"), "utf8")

  assert.match(output, /<br\/>/)
  assert.match(output, /<a href="\.\/target\.md">公开笔记<\/a>/)
  assert.match(output, /<iframe src="https:\/\/example\.com\/public"><\/iframe>/)
  assert.match(output, /<link href="https:\/\/example\.com\/site\.css">/)
  assert.match(
    output,
    /<source src="https:\/\/example\.com\/public\.pdf" srcset="https:\/\/example\.com\/public\.png 2x">/,
  )
  assert.doesNotMatch(output, /\.\.\/private\.(?:pdf|js|md|png)|private-2x\.png/)
})

test("sanitizes local reference-style links and definitions while preserving published and HTTP(S) references", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(
    sourceDir,
    "notes/start.md",
    [
      "---",
      "publish: true",
      "---",
      "[私密参考][leak]",
      "[公开参考][published]",
      "[网站][web]",
      "",
      "[leak]: ../private.md",
      "[published]: ./target.md",
      "[web]: https://example.com/public",
    ].join("\n"),
  )
  await put(sourceDir, "notes/target.md", "---\npublish: true\n---\n公开内容\n")

  await syncKnowledge({ sourceDir, contentDir })
  const output = await readFile(path.join(contentDir, "knowledge/notes/start.md"), "utf8")

  assert.match(output, /私密参考（未公开）/)
  assert.match(output, /\[公开参考\]\[published\]/)
  assert.match(output, /\[published\]: \.\/target\.md/)
  assert.match(output, /\[网站\]\[web\]/)
  assert.match(output, /\[web\]: https:\/\/example\.com\/public/)
  assert.doesNotMatch(output, /\[leak\]|\.\.\/private\.md/)
})

test("sanitizes local autolinks while preserving published and HTTP(S) autolinks", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(
    sourceDir,
    "notes/start.md",
    [
      "---",
      "publish: true",
      "---",
      "<../private.md>",
      "<./target.md>",
      "<https://example.com/public>",
    ].join("\n"),
  )
  await put(sourceDir, "notes/target.md", "---\npublish: true\n---\n公开内容\n")

  await syncKnowledge({ sourceDir, contentDir })
  const output = await readFile(path.join(contentDir, "knowledge/notes/start.md"), "utf8")

  assert.match(output, /private（未公开）/)
  assert.match(output, /<\.\/target\.md>/)
  assert.match(output, /<https:\/\/example\.com\/public>/)
  assert.doesNotMatch(output, /\.\.\/private\.md/)
})

test("supports CLI and environment source-path overrides with CLI taking precedence", () => {
  const fallback = "/default/knowledge"
  assert.equal(
    resolveSourcePath([], { KNOWLEDGE_SOURCE: "/env/vault" }, fallback),
    path.resolve("/env/vault"),
  )
  assert.equal(
    resolveSourcePath(["/cli/vault"], { KNOWLEDGE_SOURCE: "/env/vault" }, fallback),
    path.resolve("/cli/vault"),
  )
  assert.equal(resolveSourcePath([], {}, fallback), path.resolve(fallback))
})

test("landing page lists only selected public notes with working category and article targets", async (t) => {
  const { sourceDir, contentDir } = await fixture(t)
  await put(sourceDir, "notes/tech/公开 文章.md", "---\npublish: true\n---\n公开内容")
  await put(sourceDir, "notes/common/方法.md", "---\npublish: true\n---\n公开内容")
  await put(sourceDir, "notes/tech/hidden.md", "---\npublish: false\n---\n秘密")
  await syncKnowledge({ sourceDir, contentDir })
  const home = await readFile(path.join(contentDir, "index.md"), "utf8")
  assert.match(home, /共 2 篇公开笔记/)
  assert.match(home, /人工智能与工程 · 1 篇/)
  assert.match(home, /生活与方法 · 1 篇/)
  assert.doesNotMatch(home, /hidden|秘密/)
  for (const [, href] of home.matchAll(/\]\(([^)]+)\)/g)) {
    const target = path.join(contentDir, decodeURIComponent(href))
    if (href.endsWith("/")) assert.ok((await readdir(target)).length)
    else assert.ok(await readFile(target, "utf8"))
  }
})

test("empty landing page has no dead category links", async () => {
  const { landingPage } = await import("./sync-knowledge.mjs")
  const home = landingPage([])
  assert.match(home, /目前没有公开内容/)
  assert.doesNotMatch(home, /\]\(/)
})
