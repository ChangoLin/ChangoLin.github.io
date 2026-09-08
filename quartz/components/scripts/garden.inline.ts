// Small accessibility adapter around the installed Quartz plugin DOM.
// Plugin code continues to own search, navigation and theme state.
const mobile = window.matchMedia("(max-width: 800px)")

function setupGarden() {
  const explorer = document.querySelector<HTMLElement>(".explorer")
  const toggle = explorer?.querySelector<HTMLButtonElement>(".mobile-explorer")
  const content = explorer?.querySelector<HTMLElement>(".explorer-content")
  const main = document.querySelector<HTMLElement>("main.center")
  const footer = document.querySelector<HTMLElement>("#quartz-body > footer")
  const syncMenu = () => {
    const open = !!explorer && mobile.matches && !explorer.classList.contains("collapsed")
    toggle?.setAttribute("aria-expanded", String(open))
    toggle?.setAttribute("aria-label", open ? "关闭导航" : "打开导航")
    const expanded = !!explorer && !explorer.classList.contains("collapsed")
    content?.setAttribute("aria-expanded", String(expanded))
    explorer?.querySelector(".desktop-explorer")?.setAttribute("aria-expanded", String(expanded))
    if (main) main.inert = open
    if (footer) footer.inert = open
    document.documentElement.classList.toggle("mobile-no-scroll", open)
  }
  const closeMenu = () => {
    explorer?.classList.add("collapsed")
    syncMenu()
  }
  const observer = new MutationObserver(syncMenu)
  if (explorer) observer.observe(explorer, { attributes: true, attributeFilter: ["class"] })
  const resize = () => {
    closeMenu()
    // Desktop navigation remains expanded when crossing the breakpoint.
    if (!mobile.matches) explorer?.classList.remove("collapsed")
  }
  mobile.addEventListener("change", resize)
  syncMenu()

  // The installed explorer currently ignores folderDefaultState when building its tree.
  // Respect the configured default only for folders without an explicit saved preference.
  const folderNames: Record<string, string> = {
    "knowledge/index": "公开笔记",
    "knowledge/notes/index": "主题分类",
    "knowledge/notes/tech/index": "人工智能与工程",
    "knowledge/notes/common/index": "生活与方法",
  }
  let savedFolders: { path: string; collapsed: boolean }[] = []
  try {
    const saved = JSON.parse(localStorage.getItem("fileTree") ?? "[]")
    if (Array.isArray(saved)) savedFolders = saved
  } catch {
    /* Use the configured default for invalid saved state. */
  }
  const enhanceFolders = () => {
    explorer?.querySelectorAll<HTMLElement>(".folder-container").forEach((folder) => {
      const icon = folder.querySelector<SVGElement>(".folder-icon")
      const title = folder.querySelector<HTMLElement>(".folder-title")
      const children = folder.nextElementSibling
      const name = folderNames[folder.dataset.folderpath ?? ""]
      if (name && title && title.textContent !== name) title.textContent = name
      if (!folder.dataset.gardenReady) {
        folder.dataset.gardenReady = "true"
        if (
          explorer.dataset.collapsed === "open" &&
          !savedFolders.some((s) => s.path === folder.dataset.folderpath)
        ) {
          children?.classList.add("open")
        }
      }
      icon?.setAttribute("role", "button")
      icon?.setAttribute("tabindex", "0")
      icon?.setAttribute("aria-label", `展开或折叠${title?.textContent ?? "分类"}`)
      icon?.setAttribute("aria-expanded", String(children?.classList.contains("open")))
    })
  }
  const treeObserver = new MutationObserver(enhanceFolders)
  if (content)
    treeObserver.observe(content, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    })
  enhanceFolders()
  const folderKeydown = (event: KeyboardEvent) => {
    const target = event.target
    if (
      target instanceof SVGElement &&
      target.classList.contains("folder-icon") &&
      ["Enter", " "].includes(event.key)
    ) {
      event.preventDefault()
      target.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    }
  }
  explorer?.addEventListener("keydown", folderKeydown)

  const search = document.querySelector<HTMLElement>(".search-container")
  const space = search?.querySelector(".search-space")
  const closeSearch = document.createElement("button")
  closeSearch.className = "search-close"
  closeSearch.type = "button"
  closeSearch.textContent = "关闭搜索"
  closeSearch.addEventListener("click", () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    document.querySelector<HTMLButtonElement>(".search-button")?.focus()
  })
  space?.prepend(closeSearch)

  const keydown = (event: KeyboardEvent) => {
    if (!mobile.matches || !explorer || explorer.classList.contains("collapsed")) return
    if (event.key === "Escape") {
      closeMenu()
      toggle?.focus()
    }
    if (event.key === "Tab" && !search?.classList.contains("active")) {
      const header = explorer.closest(".sidebar.left")!
      const targets = [
        ...header.querySelectorAll<HTMLElement>("button, a[href], [tabindex='0']"),
      ].filter((el) => el.checkVisibility())
      const first = targets[0]
      const last = targets.at(-1)
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
  }
  document.addEventListener("keydown", keydown)
  window.addCleanup(() => {
    observer.disconnect()
    treeObserver.disconnect()
    explorer?.removeEventListener("keydown", folderKeydown)
    mobile.removeEventListener("change", resize)
    document.removeEventListener("keydown", keydown)
    closeSearch.remove()
    if (main) main.inert = false
    if (footer) footer.inert = false
    document.documentElement.classList.remove("mobile-no-scroll")
  })
}

document.addEventListener("nav", setupGarden)
