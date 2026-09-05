#!/usr/bin/env node

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import YAML from "yaml"

const DEFAULT_SOURCE = path.join(homedir(), ".hermes", "workspace", "knowledge")
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, "..")
const markdownExtension = /\.(?:md|markdown)$/i

export function resolveSourcePath(
  args = process.argv.slice(2),
  env = process.env,
  fallback = DEFAULT_SOURCE,
) {
  return path.resolve(args[0] || env.KNOWLEDGE_SOURCE || fallback)
}

function slash(value) {
  return value.split(path.sep).join("/")
}

function normalizeNotePath(value) {
  let decoded = value.trim().replace(/^<|>$/g, "")
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    // An invalid percent escape simply cannot match a published note.
  }
  return path.posix
    .normalize(decoded.replaceAll("\\", "/"))
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(markdownExtension, "")
}

function readFrontmatter(markdown) {
  const match = markdown.match(/^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/)
  if (!match) return undefined
  try {
    const data = YAML.parse(match[1], { maxAliasCount: 20 })
    return data && typeof data === "object" && !Array.isArray(data) ? data : undefined
  } catch {
    return undefined
  }
}

async function findMarkdownFiles(root) {
  const files = []
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"))
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() && markdownExtension.test(entry.name)) files.push(absolute)
    }
  }
  await visit(root)
  return files
}

function buildPublishedIndex(notes, sourceName) {
  const exact = new Set()
  const byBasename = new Map()
  for (const note of notes) {
    const id = normalizeNotePath(note.relativePath)
    exact.add(id)
    exact.add(`${sourceName}/${id}`)
    const basename = path.posix.basename(id)
    const matches = byBasename.get(basename) ?? []
    matches.push(id)
    byBasename.set(basename, matches)
  }
  return { exact, byBasename, sourceName }
}

function publishedTarget(rawTarget, currentRelativePath, index) {
  const withoutFragment = rawTarget.split("#", 1)[0].split("?", 1)[0]
  if (withoutFragment === "") return true
  if (/^[a-z][a-z\d+.-]*:/i.test(withoutFragment) || withoutFragment.startsWith("//")) return false

  let target = normalizeNotePath(withoutFragment)
  if (target.startsWith(`${index.sourceName}/`)) target = target.slice(index.sourceName.length + 1)
  if (index.exact.has(target)) return true

  const currentDirectory = path.posix.dirname(slash(currentRelativePath))
  const relativeTarget = normalizeNotePath(path.posix.join(currentDirectory, target))
  if (index.exact.has(relativeTarget)) return true

  if (!target.includes("/"))
    return (index.byBasename.get(path.posix.basename(target))?.length ?? 0) === 1
  return false
}

function privateWikilinkLabel(target, alias) {
  if (alias?.trim()) return alias.trim()
  const withoutHeading = target.split("#", 1)[0]
  const basename = path.posix.basename(normalizeNotePath(withoutHeading))
  return basename || "内部链接"
}

function linkDestination(linkBody) {
  const body = linkBody.trim()
  if (body.startsWith("<")) {
    const closing = body.indexOf(">")
    if (closing !== -1) return body.slice(1, closing)
  }
  return body.replace(/\s+(?:"[^"]*"|'[^']*'|\([^)]*\))\s*$/, "").trim()
}

function sanitizeInlineLinks(markdown, currentRelativePath, publishedIndex) {
  const opening = /(!?)\[([^\]\n]*)\]\(/g
  let output = ""
  let copiedThrough = 0
  let match

  while ((match = opening.exec(markdown)) !== null) {
    let cursor = opening.lastIndex
    let depth = 1
    for (; cursor < markdown.length && depth > 0; cursor += 1) {
      if (markdown[cursor] === "\\") {
        cursor += 1
      } else if (markdown[cursor] === "\n") {
        break
      } else if (markdown[cursor] === "(") {
        depth += 1
      } else if (markdown[cursor] === ")") {
        depth -= 1
      }
    }
    if (depth !== 0) continue

    const end = cursor
    const destination = linkDestination(markdown.slice(opening.lastIndex, end - 1))
    const original = markdown.slice(match.index, end)
    let replacement = original
    if (
      !/^https?:\/\//i.test(destination) &&
      !destination.startsWith("//") &&
      !destination.startsWith("#")
    ) {
      const localPath = destination.split("#", 1)[0].split("?", 1)[0]
      const linksToPublishedMarkdown =
        match[1] === "" &&
        markdownExtension.test(localPath) &&
        publishedTarget(destination, currentRelativePath, publishedIndex)
      if (!linksToPublishedMarkdown) {
        const display =
          match[2].trim() || path.posix.basename(normalizeNotePath(localPath)) || "本地文件"
        replacement = `${display}（未公开）`
      }
    }

    output += markdown.slice(copiedThrough, match.index) + replacement
    copiedThrough = end
    opening.lastIndex = end
  }
  return output + markdown.slice(copiedThrough)
}

function htmlTagAt(markdown, start) {
  let cursor = start + 1
  let quote
  for (; cursor < markdown.length; cursor += 1) {
    const character = markdown[cursor]
    if (quote) {
      if (character === quote) quote = undefined
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === ">") {
      return markdown.slice(start, cursor + 1)
    }
  }
  return undefined
}

function parseHtmlTag(tag) {
  let cursor = 1
  let closing = false
  if (tag[cursor] === "/") {
    closing = true
    cursor += 1
  }
  while (/\s/.test(tag[cursor] ?? "")) cursor += 1
  const nameStart = cursor
  while (/[a-z\d:-]/i.test(tag[cursor] ?? "")) cursor += 1
  const name = tag.slice(nameStart, cursor).toLowerCase()
  if (!name) return undefined
  // A self-closing slash directly after the name (e.g. `<br/>`) belongs to the
  // tag, not to the attribute loop below.
  if (tag[cursor] === "/") cursor += 1

  const attributes = new Map()
  while (cursor < tag.length - 1) {
    while (/\s/.test(tag[cursor] ?? "")) cursor += 1
    if (tag[cursor] === "/" || tag[cursor] === ">") break
    const attributeStart = cursor
    while (/[^\s=>/]/.test(tag[cursor] ?? "")) cursor += 1
    const attribute = tag.slice(attributeStart, cursor).toLowerCase()
    while (/\s/.test(tag[cursor] ?? "")) cursor += 1
    let value = ""
    if (tag[cursor] === "=") {
      cursor += 1
      while (/\s/.test(tag[cursor] ?? "")) cursor += 1
      const quote = tag[cursor]
      if (quote === '"' || quote === "'") {
        cursor += 1
        const valueStart = cursor
        while (cursor < tag.length && tag[cursor] !== quote) cursor += 1
        value = tag.slice(valueStart, cursor)
        if (tag[cursor] === quote) cursor += 1
      } else {
        const valueStart = cursor
        while (/[^\s>]/.test(tag[cursor] ?? "")) cursor += 1
        value = tag.slice(valueStart, cursor)
      }
    }
    if (attribute) attributes.set(attribute, value)
  }
  return { name, closing, attributes, selfClosing: /\/\s*>$/.test(tag) }
}

function sanitizeRawHtml(markdown, currentRelativePath, publishedIndex) {
  let output = ""
  let cursor = 0
  let privateAnchorDepth = 0
  while (cursor < markdown.length) {
    if (markdown[cursor] !== "<") {
      output += markdown[cursor]
      cursor += 1
      continue
    }
    const tag = htmlTagAt(markdown, cursor)
    const parsed = tag && parseHtmlTag(tag)
    if (!parsed) {
      output += markdown[cursor]
      cursor += 1
      continue
    }
    cursor += tag.length
    if (parsed.name === "a" && parsed.closing) {
      if (privateAnchorDepth > 0) {
        privateAnchorDepth -= 1
        output += "（未公开）"
      } else {
        output += tag
      }
      continue
    }

    const unsafeAttributes = new Set()
    for (const attribute of ["href", "src", "srcset"]) {
      const target = parsed.attributes.get(attribute)
      if (!target) continue
      const localPath = target.split("#", 1)[0].split("?", 1)[0]
      const isPublishedMarkdown =
        attribute === "href" &&
        parsed.name === "a" &&
        markdownExtension.test(localPath) &&
        publishedTarget(target, currentRelativePath, publishedIndex)
      const isExternal =
        attribute === "srcset"
          ? target.split(",").every((candidate) => /^https?:\/\//i.test(candidate.trim()))
          : /^https?:\/\//i.test(target)
      if (!isExternal && !isPublishedMarkdown) unsafeAttributes.add(attribute)
    }

    if (parsed.name === "a" && unsafeAttributes.has("href")) {
      if (parsed.selfClosing) output += "（未公开）"
      else privateAnchorDepth += 1
      continue
    }
    if (parsed.name === "img" && unsafeAttributes.has("src")) {
      output += `${parsed.attributes.get("alt")?.trim() || "本地文件"}（未公开）`
      continue
    }
    if (unsafeAttributes.size === 0) {
      output += tag
      continue
    }
    const attributes = [...parsed.attributes]
      .filter(([attribute]) => !unsafeAttributes.has(attribute))
      .map(([attribute, value]) => (value ? ` ${attribute}="${value}"` : ` ${attribute}`))
      .join("")
    output += `<${parsed.name}${attributes}${parsed.selfClosing ? "/>" : ">"}`
  }
  return output
}

function normalizeReferenceLabel(label) {
  return label.trim().replace(/\s+/g, " ").toLowerCase()
}

function sanitizeReferenceLinks(markdown, currentRelativePath, publishedIndex) {
  const privateLabels = new Set()
  const withoutPrivateDefinitions = markdown.replace(
    /^[ \t]{0,3}\[([^\]\n]+)\]:[ \t]*(<[^>\n]+>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/gm,
    (original, label, rawDestination) => {
      const destination = linkDestination(rawDestination)
      const localPath = destination.split("#", 1)[0].split("?", 1)[0]
      const isPublishedMarkdown =
        markdownExtension.test(localPath) &&
        publishedTarget(destination, currentRelativePath, publishedIndex)
      if (/^https?:\/\//i.test(destination) || isPublishedMarkdown) return original
      privateLabels.add(normalizeReferenceLabel(label))
      return ""
    },
  )
  if (privateLabels.size === 0) return withoutPrivateDefinitions
  return withoutPrivateDefinitions.replace(
    /!?\[([^\]\n]*)\]\[([^\]\n]*)\]/g,
    (original, text, label) => {
      const reference = normalizeReferenceLabel(label || text)
      if (!privateLabels.has(reference)) return original
      return `${text.trim() || "本地文件"}（未公开）`
    },
  )
}

function sanitizeAutolinks(markdown, currentRelativePath, publishedIndex) {
  return markdown.replace(/<([^<>\s]+)>/g, (original, destination) => {
    if (/^\/[a-z][\w:-]*$/i.test(destination) || /^https?:\/\//i.test(destination)) return original
    // A self-closing raw HTML tag such as `<br/>` or `<hr/>` is not an autolink;
    // its trailing slash must not be mistaken for a path separator.
    if (destination.endsWith("/") && /^[a-z][\w-]*$/i.test(destination.slice(0, -1))) {
      return original
    }
    const localPath = destination.split("#", 1)[0].split("?", 1)[0]
    if (!markdownExtension.test(localPath) && !/[/.]/.test(localPath)) return original
    if (
      markdownExtension.test(localPath) &&
      publishedTarget(destination, currentRelativePath, publishedIndex)
    ) {
      return original
    }
    return `${path.posix.basename(normalizeNotePath(localPath)) || "本地文件"}（未公开）`
  })
}

function sanitizeMarkdown(markdown, currentRelativePath, publishedIndex) {
  const wikilinksSanitized = sanitizeAutolinks(
    sanitizeReferenceLinks(
      sanitizeRawHtml(markdown, currentRelativePath, publishedIndex),
      currentRelativePath,
      publishedIndex,
    ),
    currentRelativePath,
    publishedIndex,
  ).replace(/!?\[\[([^\]\n]+)\]\]/g, (original, inner) => {
    const separator = inner.indexOf("|")
    const target = separator === -1 ? inner : inner.slice(0, separator)
    const alias = separator === -1 ? undefined : inner.slice(separator + 1)
    if (publishedTarget(target, currentRelativePath, publishedIndex)) return original
    return `${privateWikilinkLabel(target, alias)}（未公开）`
  })

  return sanitizeInlineLinks(wikilinksSanitized, currentRelativePath, publishedIndex).replace(
    /^[ \t]+$/gm,
    "",
  )
}

function landingPage(notes) {
  const areas = [...new Set(notes.map((note) => slash(note.relativePath).split("/")[0]))].sort(
    (a, b) => a.localeCompare(b, "zh-CN"),
  )
  const areaNames = { notes: "知识笔记" }
  const links =
    areas.length > 0
      ? areas.map((area) => `- [[knowledge/${area}|${areaNames[area] ?? area}]]`).join("\n")
      : "目前没有公开内容。"
  return [
    "---",
    'title: "林宇澄的知识库"',
    'description: "个人知识笔记与学习记录"',
    "---",
    "",
    "这里汇集经过整理并公开的个人知识笔记。可以从左侧目录浏览，或使用搜索快速查找内容。",
    "",
    "## 公开领域",
    "",
    links,
    "",
  ].join("\n")
}

export async function syncKnowledge({
  sourceDir,
  contentDir = path.join(repositoryRoot, "content"),
}) {
  const source = path.resolve(sourceDir)
  const destination = path.resolve(contentDir)
  const sourceInfo = await stat(source)
  if (!sourceInfo.isDirectory()) throw new Error(`Knowledge source is not a directory: ${source}`)

  const candidates = await findMarkdownFiles(source)
  const published = []
  for (const filename of candidates) {
    const markdown = await readFile(filename, "utf8")
    if (readFrontmatter(markdown)?.publish === true) {
      published.push({ filename, markdown, relativePath: slash(path.relative(source, filename)) })
    }
  }

  const generatedRoot = path.join(destination, "knowledge")
  await rm(generatedRoot, { recursive: true, force: true })
  await rm(path.join(destination, "index.md"), { force: true })
  await mkdir(generatedRoot, { recursive: true })

  const index = buildPublishedIndex(published, path.basename(source))
  for (const note of published) {
    const output = path.join(generatedRoot, note.relativePath)
    await mkdir(path.dirname(output), { recursive: true })
    await writeFile(output, sanitizeMarkdown(note.markdown, note.relativePath, index), "utf8")
  }
  await writeFile(path.join(destination, "index.md"), landingPage(published), "utf8")

  return { publishedCount: published.length }
}

const invokedAsScript =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedAsScript) {
  const sourceDir = resolveSourcePath()
  try {
    const result = await syncKnowledge({ sourceDir })
    console.log(`Published ${result.publishedCount} Markdown notes.`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
