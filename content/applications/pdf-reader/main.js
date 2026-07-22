import * as mupdf from "../../../vendor/mupdf/mupdf.js"

const stage = document.getElementById("stage")
const pagesRoot = document.getElementById("pages")
const emptyState = document.getElementById("emptyState")
const fileInput = document.getElementById("fileInput")
const urlForm = document.getElementById("urlForm")
const urlInput = document.getElementById("urlInput")
const pageInput = document.getElementById("pageInput")
const pageTotal = document.getElementById("pageTotal")
const zoomInput = document.getElementById("zoomInput")
const findForm = document.getElementById("findForm")
const findInput = document.getElementById("findInput")
const statusNode = document.getElementById("status")
const documentInfoNode = document.getElementById("documentInfo")
const aboutDialog = document.getElementById("aboutDialog")

let documentHandle = null

function destroyDocument() {
  if (documentHandle) documentHandle.destroy()
  documentHandle = null
}

function pageSize(page) {
  const bounds = page.getBounds()
  return {
    x: bounds[0],
    y: bounds[1],
    width: bounds[2] - bounds[0],
    height: bounds[3] - bounds[1]
  }
}

function documentInfo() {
  const count = documentHandle.countPages()
  let page
  try {
    page = documentHandle.loadPage(count > 1 ? 1 : 0)
    return {
      pageCount: count,
      title: documentHandle.getMetaData(mupdf.Document.META_INFO_TITLE) || "",
      format: documentHandle.getMetaData(mupdf.Document.META_FORMAT) || "PDF",
      defaultSize: pageSize(page)
    }
  } finally {
    if (page) page.destroy()
  }
}

const mupdfMethods = {
  openDocument(buffer, magic = "application/pdf") {
    destroyDocument()
    documentHandle = mupdf.Document.openDocument(buffer, magic)
    if (documentHandle.needsPassword()) return { needsPassword: true }
    return { needsPassword: false, info: documentInfo() }
  },

  authenticate(password) {
    if (!documentHandle || !documentHandle.needsPassword()) return { ok: true, info: documentInfo() }
    const ok = documentHandle.authenticatePassword(password)
    return { ok, info: ok ? documentInfo() : null }
  },

  closeDocument() {
    destroyDocument()
    return true
  },

  renderPage(pageNumber, scale) {
    let page, pixmap, device
    try {
      page = documentHandle.loadPage(pageNumber)
      const size = pageSize(page)
      const matrix = mupdf.Matrix.scale(scale, scale)
      const bbox = mupdf.Rect.transform(page.getBounds(), matrix)
      pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, bbox, true)
      pixmap.clear(255)
      device = new mupdf.DrawDevice(matrix, pixmap)
      page.run(device, mupdf.Matrix.identity)
      device.close()
      device = null
      return {
        width: pixmap.getWidth(),
        height: pixmap.getHeight(),
        pixels: pixmap.getPixels().slice(),
        size
      }
    } finally {
      if (device) device.close()
      if (pixmap) pixmap.destroy()
      if (page) page.destroy()
    }
  },

  searchPage(pageNumber, needle) {
    let page
    try {
      page = documentHandle.loadPage(pageNumber)
      const bounds = page.getBounds()
      const rectangles = []
      for (const hit of page.search(needle)) {
        for (const quad of hit) {
          const xs = [quad[0], quad[2], quad[4], quad[6]]
          const ys = [quad[1], quad[3], quad[5], quad[7]]
          const x0 = Math.min(...xs)
          const y0 = Math.min(...ys)
          rectangles.push({
            x: x0 - bounds[0],
            y: y0 - bounds[1],
            width: Math.max(...xs) - x0,
            height: Math.max(...ys) - y0
          })
        }
      }
      return rectangles
    } finally {
      if (page) page.destroy()
    }
  }
}

function callMuPDF(method, args = []) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        if (!mupdfMethods[method]) throw new Error("Unknown MuPDF method: " + method)
        resolve(mupdfMethods[method](...args))
      } catch (error) {
        reject(error)
      }
    }, 0)
  })
}

let documentOpen = false
let documentName = ""
let pageCount = 0
let currentPage = 0
let zoom = 100
let renderEpoch = 0
let searchEpoch = 0
let lastSearchPage = null
let lastSearchQuery = ""
let fetchController = null
let scrollFrame = 0
let dragDepth = 0
let retainedFile = null
let retainedFileURL = ""
let retainedFileName = ""
const pageViews = []

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const page = entry.target._pageView
    page.visible = entry.isIntersecting
    if (entry.isIntersecting) renderPage(page)
  }
  updateCurrentPage()
}, { root: stage, rootMargin: "80% 0px 160% 0px", threshold: 0.01 })

function setStatus(message, error = false) {
  statusNode.textContent = message
  statusNode.style.color = error ? "#a04a3a" : ""
}

function setDocumentControls(enabled) {
  pageInput.disabled = !enabled
  findInput.disabled = !enabled
  findForm.querySelectorAll("button").forEach(button => { button.disabled = !enabled })
  document.querySelectorAll("[data-requires-document]").forEach(control => { control.disabled = !enabled })
}

function closeMenus(except = null) {
  document.querySelectorAll(".rm.open").forEach(menu => {
    if (menu !== except) menu.classList.remove("open")
  })
}

document.querySelectorAll(".rm > button").forEach(button => {
  button.addEventListener("click", event => {
    event.stopPropagation()
    const menu = button.parentElement
    const willOpen = !menu.classList.contains("open")
    closeMenus()
    if (willOpen) menu.classList.add("open")
  })
})
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".rm")) closeMenus()
})
window.addEventListener("blur", () => closeMenus())

function cssScale() {
  return (zoom / 100) * (96 / 72)
}

function clampZoom(value) {
  return Math.max(25, Math.min(400, Math.round(value)))
}

function updatePageBox(page) {
  const scale = cssScale()
  page.el.style.width = Math.max(1, Math.round(page.size.width * scale)) + "px"
  page.el.style.height = Math.max(1, Math.round(page.size.height * scale)) + "px"
  updateSearchHits(page)
}

function updateSearchHits(page) {
  page.hitsRoot.replaceChildren()
  if (!page.hits.length) return
  const scale = cssScale()
  const fragment = document.createDocumentFragment()
  for (const hit of page.hits) {
    const marker = document.createElement("span")
    marker.className = "search-hit"
    marker.style.left = hit.x * scale + "px"
    marker.style.top = hit.y * scale + "px"
    marker.style.width = hit.width * scale + "px"
    marker.style.height = hit.height * scale + "px"
    fragment.appendChild(marker)
  }
  page.hitsRoot.appendChild(fragment)
}

function clearPageViews() {
  renderEpoch++
  searchEpoch++
  for (const page of pageViews) observer.unobserve(page.el)
  pageViews.length = 0
  pagesRoot.replaceChildren()
}

function buildPageViews(info) {
  clearPageViews()
  pageCount = info.pageCount
  const fragment = document.createDocumentFragment()
  for (let index = 0; index < pageCount; index++) {
    const el = document.createElement("section")
    el.className = "pdf-page"
    el.dataset.pageLabel = "Page " + (index + 1)
    el.id = "pdf-page-" + (index + 1)
    el.setAttribute("aria-label", "Page " + (index + 1))

    const canvas = document.createElement("canvas")
    const hitsRoot = document.createElement("div")
    hitsRoot.className = "search-hits"
    el.append(canvas, hitsRoot)

    const page = {
      index,
      el,
      canvas,
      hitsRoot,
      size: { ...info.defaultSize },
      hits: [],
      visible: false,
      renderKey: ""
    }
    el._pageView = page
    pageViews.push(page)
    updatePageBox(page)
    fragment.appendChild(el)
  }
  pagesRoot.appendChild(fragment)
  pagesRoot.classList.add("open")
  emptyState.classList.add("hidden")
  for (const page of pageViews) observer.observe(page.el)
  if (pageViews[0]) renderPage(pageViews[0])
}

async function renderPage(page) {
  if (!documentOpen) return
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  const key = renderEpoch + ":" + zoom + ":" + pixelRatio
  if (page.renderKey === key) return
  page.renderKey = key
  try {
    const result = await callMuPDF("renderPage", [page.index, cssScale() * pixelRatio])
    if (!documentOpen || page.renderKey !== key || !pageViews.includes(page)) return
    page.size = result.size
    updatePageBox(page)
    page.canvas.width = result.width
    page.canvas.height = result.height
    const pixels = result.pixels instanceof Uint8ClampedArray
      ? result.pixels
      : new Uint8ClampedArray(result.pixels.buffer, result.pixels.byteOffset, result.pixels.byteLength)
    page.canvas.getContext("2d").putImageData(new ImageData(pixels, result.width, result.height), 0, 0)
    page.el.classList.add("rendered")
  } catch (error) {
    page.renderKey = ""
    setStatus("Could not render page " + (page.index + 1) + ": " + error.message, true)
  }
}

function setZoom(value) {
  const next = clampZoom(value)
  if (next === zoom) {
    zoomInput.value = next
    return
  }
  const anchor = pageViews[currentPage]
  const oldTop = anchor ? anchor.el.offsetTop : 0
  const oldScroll = stage.scrollTop
  zoom = next
  zoomInput.value = zoom
  renderEpoch++
  for (const page of pageViews) {
    page.renderKey = ""
    updatePageBox(page)
  }
  if (anchor && oldTop) {
    const ratio = anchor.el.offsetTop / oldTop
    stage.scrollTop = oldScroll * ratio
  }
  for (const page of pageViews) if (page.visible) renderPage(page)
  setStatus("Zoom " + zoom + "%")
}

function fitWidth() {
  if (!documentOpen || !pageViews[currentPage]) return
  const pageWidthAt100 = pageViews[currentPage].size.width * (96 / 72)
  const available = Math.max(100, stage.clientWidth - 84)
  setZoom((available / pageWidthAt100) * 100)
}

function goToPage(index) {
  if (!documentOpen || !pageCount) return
  currentPage = Math.max(0, Math.min(pageCount - 1, index))
  pageInput.value = currentPage + 1
  pageViews[currentPage].el.scrollIntoView({ block: "start", behavior: "smooth" })
  renderPage(pageViews[currentPage])
}

function updateCurrentPage() {
  if (!documentOpen || !pageViews.length) return
  const stageRect = stage.getBoundingClientRect()
  const marker = stageRect.top + Math.min(stageRect.height * 0.35, 220)
  let nearest = currentPage
  let distance = Infinity
  for (const page of pageViews) {
    if (!page.visible) continue
    const rect = page.el.getBoundingClientRect()
    const candidate = rect.top <= marker && rect.bottom >= marker ? 0 : Math.min(Math.abs(rect.top - marker), Math.abs(rect.bottom - marker))
    if (candidate < distance) {
      distance = candidate
      nearest = page.index
    }
  }
  if (nearest !== currentPage) {
    currentPage = nearest
    pageInput.value = currentPage + 1
  }
}

stage.addEventListener("scroll", () => {
  if (scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    updateCurrentPage()
  })
})

function humanSize(bytes) {
  if (!bytes) return ""
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return (unit ? value.toFixed(value >= 10 ? 0 : 1) : value) + " " + units[unit]
}

async function unlockDocument(result) {
  if (!result.needsPassword) return result.info
  for (let attempt = 0; attempt < 3; attempt++) {
    const password = prompt("This PDF is password protected. Enter its password:")
    if (password === null) throw new Error("Password entry cancelled")
    const auth = await callMuPDF("authenticate", [password])
    if (auth.ok) return auth.info
    setStatus("Incorrect password", true)
  }
  throw new Error("The PDF could not be unlocked")
}

function releaseRetainedFile() {
  if (retainedFileURL) URL.revokeObjectURL(retainedFileURL)
  retainedFile = null
  retainedFileURL = ""
  retainedFileName = ""
}

function retainFile(blob, label) {
  releaseRetainedFile()
  retainedFile = blob
  const cleanName = label.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "document.pdf"
  retainedFileName = /\.pdf$/i.test(cleanName) ? cleanName : cleanName + ".pdf"
}

function retainedURL() {
  if (!retainedFile) return ""
  if (!retainedFileURL) retainedFileURL = URL.createObjectURL(retainedFile)
  return retainedFileURL
}

function openExternalWindow() {
  const url = retainedURL()
  if (url) window.open(url, "_blank", "noopener")
}

function downloadDocument() {
  const url = retainedURL()
  if (!url) return
  const link = document.createElement("a")
  link.href = url
  link.download = retainedFileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setStatus("Downloading " + retainedFileName)
}

async function openBuffer(buffer, label, byteLength, originalBlob = null) {
  fetchController?.abort()
  setStatus("Opening " + label + "…")
  documentOpen = false
  clearPageViews()
  retainFile(originalBlob || new Blob([buffer], { type: "application/pdf" }), label)
  try {
    const result = await callMuPDF("openDocument", [buffer, "application/pdf"])
    const info = await unlockDocument(result)
    documentOpen = true
    documentName = info.title || label
    currentPage = 0
    lastSearchPage = null
    lastSearchQuery = ""
    buildPageViews(info)
    pageInput.min = 1
    pageInput.max = info.pageCount
    pageInput.value = 1
    pageTotal.textContent = "/ " + info.pageCount
    documentInfoNode.textContent = info.pageCount + (info.pageCount === 1 ? " page" : " pages") +
      (byteLength ? " · " + humanSize(byteLength) : "")
    setDocumentControls(true)
    document.title = documentName + " — PDF Reader — ClackOS"
    setStatus("Opened " + label)
  } catch (error) {
    await callMuPDF("closeDocument").catch(() => {})
    resetDocumentUI()
    setStatus("Could not open PDF: " + error.message, true)
  }
}

function resetDocumentUI() {
  documentOpen = false
  documentName = ""
  pageCount = 0
  currentPage = 0
  releaseRetainedFile()
  clearPageViews()
  pagesRoot.classList.remove("open")
  emptyState.classList.remove("hidden")
  pageInput.value = 1
  pageTotal.textContent = "/ 0"
  documentInfoNode.textContent = "No document"
  setDocumentControls(false)
  document.title = "PDF Reader — ClackOS"
}

async function closeDocument() {
  fetchController?.abort()
  await callMuPDF("closeDocument").catch(() => {})
  resetDocumentUI()
  setStatus("Document closed")
}

function siteRootURL() {
  return new URL("../../../", location.href)
}

function resolveSource(value) {
  const source = value.trim()
  if (!source) throw new Error("Enter a PDF URL or site-relative path")
  let url
  if (/^https?:\/\//i.test(source)) {
    url = new URL(source)
  } else {
    url = new URL(source.replace(/^\/+/, ""), siteRootURL())
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported")
  return url
}

async function openURL(value, updateHistory = true) {
  let url
  try {
    url = resolveSource(value)
  } catch (error) {
    setStatus(error.message, true)
    return
  }
  fetchController?.abort()
  fetchController = new AbortController()
  urlInput.value = value
  setStatus("Loading " + url.href + "…")
  try {
    const response = await fetch(url, { signal: fetchController.signal, headers: { Accept: "application/pdf" } })
    if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText)
    const buffer = await response.arrayBuffer()
    if (!buffer.byteLength) throw new Error("The server returned an empty file")
    if (updateHistory) {
      const appURL = new URL(location.href)
      appURL.searchParams.set("file", value)
      history.replaceState(null, "", appURL)
    }
    const name = decodeURIComponent(url.pathname.split("/").pop() || "remote.pdf")
    await openBuffer(buffer, name, buffer.byteLength, new Blob([buffer], { type: "application/pdf" }))
  } catch (error) {
    if (error.name === "AbortError") return
    const isRemote = url.origin !== location.origin
    const hint = error instanceof TypeError && isRemote
      ? " The remote server may be blocking browser access (CORS)."
      : ""
    setStatus("Could not load PDF: " + error.message + hint, true)
  }
}

async function openFile(file) {
  if (!file) return
  const looksLikePDF = file.type === "application/pdf" || /\.pdf$/i.test(file.name)
  if (!looksLikePDF) {
    setStatus("Please choose a PDF file", true)
    return
  }
  const appURL = new URL(location.href)
  appURL.search = ""
  history.replaceState(null, "", appURL)
  await openBuffer(await file.arrayBuffer(), file.name, file.size, file)
}

function openWebsiteBrowser() {
  window.ClackOSFileManager.open({
    title: "Open PDF from website",
    accept: item => item.kind === "pdf",
    onSelect: item => openURL(item.drive === "github" ? item.path : item.url)
  })
}

function clearSearchHits() {
  for (const page of pageViews) {
    page.hits = []
    updateSearchHits(page)
  }
}

async function findInDocument(direction) {
  if (!documentOpen) return
  const query = findInput.value.trim()
  if (!query) {
    clearSearchHits()
    lastSearchPage = null
    lastSearchQuery = ""
    setStatus("Enter text to find")
    return
  }
  const token = ++searchEpoch
  const isNewQuery = query !== lastSearchQuery
  clearSearchHits()
  const start = isNewQuery || lastSearchPage === null ? currentPage : lastSearchPage + direction
  lastSearchQuery = query
  setStatus("Searching for “" + query + "”…")
  for (let offset = 0; offset < pageCount; offset++) {
    const index = (start + direction * offset + pageCount * 2) % pageCount
    const hits = await callMuPDF("searchPage", [index, query])
    if (token !== searchEpoch) return
    if (hits.length) {
      const page = pageViews[index]
      page.hits = hits
      updateSearchHits(page)
      lastSearchPage = index
      goToPage(index)
      setStatus(hits.length + (hits.length === 1 ? " match" : " matches") + " on page " + (index + 1))
      return
    }
  }
  lastSearchPage = null
  setStatus("No matches for “" + query + "”")
}

const actions = {
  "open-file": () => fileInput.click(),
  "open-website": openWebsiteBrowser,
  "focus-url": () => urlInput.focus(),
  "open-external": openExternalWindow,
  "download": downloadDocument,
  "close-document": closeDocument,
  "previous-page": () => goToPage(currentPage - 1),
  "next-page": () => goToPage(currentPage + 1),
  "zoom-in": () => setZoom(zoom + 10),
  "zoom-out": () => setZoom(zoom - 10),
  "actual-size": () => setZoom(100),
  "fit-width": fitWidth,
  "find-previous": () => findInDocument(-1),
  "about": () => aboutDialog.showModal()
}

document.addEventListener("click", event => {
  const control = event.target.closest("[data-action]")
  if (!control || control.disabled) return
  const action = actions[control.dataset.action]
  if (action) action()
  closeMenus()
})

fileInput.addEventListener("change", () => {
  openFile(fileInput.files[0])
  fileInput.value = ""
})

urlForm.addEventListener("submit", event => {
  event.preventDefault()
  openURL(urlInput.value)
})

findForm.addEventListener("submit", event => {
  event.preventDefault()
  findInDocument(1)
})

pageInput.addEventListener("change", () => goToPage(Number(pageInput.value) - 1))
zoomInput.addEventListener("change", () => setZoom(Number(zoomInput.value)))

window.addEventListener("keydown", event => {
  if (!(event.ctrlKey || event.metaKey)) return
  if (event.key.toLowerCase() === "o") {
    event.preventDefault()
    fileInput.click()
  } else if (event.key.toLowerCase() === "f") {
    event.preventDefault()
    findInput.focus()
    findInput.select()
  } else if (event.key === "+" || event.key === "=") {
    event.preventDefault()
    setZoom(zoom + 10)
  } else if (event.key === "-") {
    event.preventDefault()
    setZoom(zoom - 10)
  } else if (event.key === "0") {
    event.preventDefault()
    setZoom(100)
  }
})

window.addEventListener("dragenter", event => {
  if (!event.dataTransfer?.types.includes("Files")) return
  event.preventDefault()
  dragDepth++
  document.body.classList.add("dragging")
})
window.addEventListener("dragover", event => {
  if (!event.dataTransfer?.types.includes("Files")) return
  event.preventDefault()
  event.dataTransfer.dropEffect = "copy"
})
window.addEventListener("dragleave", event => {
  if (!event.dataTransfer?.types.includes("Files")) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) document.body.classList.remove("dragging")
})
window.addEventListener("drop", event => {
  event.preventDefault()
  dragDepth = 0
  document.body.classList.remove("dragging")
  openFile(event.dataTransfer?.files[0])
})

window.addEventListener("beforeunload", () => {
  fetchController?.abort()
  releaseRetainedFile()
  destroyDocument()
})

setDocumentControls(false)
const startupParams = new URLSearchParams(location.search)
const startupSource = startupParams.get("file") || startupParams.get("src")
if (startupSource) {
  urlInput.value = startupSource
  openURL(startupSource, false)
}
