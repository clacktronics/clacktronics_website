(function () {
  'use strict';

  const ownScript = document.currentScript;
  const SITE_ROOT = new URL('../../', ownScript ? ownScript.src : location.href);
  const cache = { config: null, github: null, media: null };
  const mediaKinds = {
    image: /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i,
    video: /\.(?:mp4|webm|mov|m4v|ogv|avi|mkv)$/i,
    audio: /\.(?:mp3|wav|ogg|m4a|flac|aac)$/i,
    markdown: /\.(?:md|markdown)$/i,
    pdf: /\.pdf$/i
  };

  const icon = item => item.type === 'folder' ? '▰' : item.kind === 'image' ? '▧' :
    item.kind === 'video' ? '▶' : item.kind === 'audio' ? '♪' : item.kind === 'pdf' ? '▤' : '◇';
  const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
  const kindFor = path => Object.entries(mediaKinds).find(([, pattern]) => pattern.test(path))?.[0] || 'file';
  const formatSize = bytes => !Number.isFinite(bytes) ? '—' : bytes < 1024 ? `${bytes} B` :
    bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const itemSource = item => item.drive === 'github' ? item.path : item.url;
  const extensionFor = item => (item.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();

  function associationFor(item) {
    if (!item || item.type !== 'file') return null;
    const source = itemSource(item); const encoded = encodeURIComponent(source); const ext = extensionFor(item);
    if (item.kind === 'image') return { label: 'ClackPaint', id: `app:applications/paint.html?src=${encoded}` };
    if (item.kind === 'markdown') return { label: 'Markdown Editor', id: `app:applications/markdown.html?repo=${encoded}` };
    if (item.kind === 'pdf') return { label: 'PDF Reader', id: `app:applications/pdf-reader/index.html?file=${encoded}` };
    if (item.kind === 'video') return { label: 'Video Lab', id: `app:applications/video/index.html?src=${encoded}` };
    if (/^(?:txt|log|csv|json|css|js|mjs|xml|ya?ml|ini|conf)$/.test(ext))
      return { label: 'Text Editor', id: `app:applications/text.html?repo=${encoded}` };
    if (ext === 'scad' && item.drive === 'github')
      return { label: 'OpenSCAD', id: `app:applications/openscad.html?src=${encoded}` };
    if (ext === 'pd' && item.drive === 'github')
      return { label: 'Pure Data', id: `app:applications/puredata.html?src=${encoded}` };
    if (/^html?$/.test(ext))
      return { label: 'Web Browser', id: `app:applications/browser.html?url=${encodeURIComponent(item.url)}` };
    return null;
  }

  async function openItem(item) {
    const association = associationFor(item);
    if (!association) {
      const ext = extensionFor(item); const type = ext ? `.${ext}` : 'this type of';
      if (!window.confirm(`No ClackOS application is associated with ${type} file.\n\n${item.name} will open in a new browser tab. Continue?`)) return false;
      window.open(item.url, '_blank', 'noopener');
      return true;
    }
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'clackos-open-app', id: association.id }, location.origin);
    } else {
      const appUrl = new URL(`content/${association.id.slice(4)}`, SITE_ROOT);
      window.open(appUrl.href, '_blank', 'noopener');
    }
    return true;
  }

  function mediaUrl(value) {
    try {
      const url = new URL(value);
      const isClackHost = host => /(^|\.)clacktronics\.co\.uk$/i.test(host);
      if (isClackHost(location.hostname) && isClackHost(url.hostname))
        return new URL(`${url.pathname}${url.search}${url.hash}`, location.origin).href;
    } catch (_) {}
    return value;
  }

  async function config() {
    if (cache.config) return cache.config;
    const response = await fetch(new URL('content/site.json', SITE_ROOT), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not read site configuration (${response.status})`);
    return (cache.config = await response.json());
  }

  async function githubFiles() {
    if (cache.github) return cache.github;
    const site = await config();
    if (!site.repo) throw new Error('No GitHub repository is configured');
    const branch = site.branch || 'main';
    const key = `clack-fm-tree:${site.repo}:${branch}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key));
      if (saved && Date.now() - saved.savedAt < 10 * 60 * 1000) return (cache.github = saved.files);
    } catch (_) {}
    const api = `https://api.github.com/repos/${site.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
    const response = await fetch(api, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    const data = await response.json();
    if (data.truncated) throw new Error('GitHub returned a truncated repository tree');
    const files = (data.tree || []).filter(entry => entry.type === 'blob').map(entry => ({
      drive: 'github', type: 'file', path: entry.path, name: entry.path.split('/').pop(),
      kind: kindFor(entry.path), size: entry.size,
      url: new URL(encodePath(entry.path), SITE_ROOT).href,
      downloadUrl: `https://raw.githubusercontent.com/${site.repo}/${encodeURIComponent(branch)}/${encodePath(entry.path)}`
    })).sort((a, b) => a.path.localeCompare(b.path));
    cache.github = files;
    try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), files })); } catch (_) {}
    return files;
  }

  async function mediaFiles() {
    if (cache.media) return cache.media;
    const site = await config();
    const indexPath = site.media?.index || 'content/media-index.json';
    const response = await fetch(new URL(indexPath, SITE_ROOT), { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not read the website media index (${response.status})`);
    const data = await response.json();
    return (cache.media = (data.files || []).map(entry => {
      const url = mediaUrl(entry.url);
      return ({
      drive: 'media', type: 'file', name: entry.name || entry.url.split('/').pop(),
      path: `${entry.kind || kindFor(entry.url)}s/${entry.name || entry.url.split('/').pop()}`,
      kind: entry.kind || kindFor(entry.url), size: entry.size,
      url, downloadUrl: url, source: entry.source
    });
    }).sort((a, b) => a.path.localeCompare(b.path)));
  }

  class Explorer {
    constructor(host, options, modal) {
      this.host = host;
      this.options = options || {};
      this.modal = modal;
      this.drive = this.options.initialDrive || 'github';
      this.path = '';
      this.files = [];
      this.selected = null;
      this.build();
      this.loadDrive(this.drive);
    }

    build() {
      this.host.className = `clack-fm ${this.modal ? 'clack-fm-modal' : 'clack-fm-standalone'}`;
      this.host.innerHTML = `<section class="clack-fm-window" role="dialog" aria-modal="${this.modal}" aria-label="${this.options.title || 'File Manager'}">
        <header class="clack-fm-titlebar"><span aria-hidden="true">▰</span><span class="clack-fm-title"></span><button class="clack-fm-close" type="button" aria-label="Close">×</button></header>
        <div class="clack-fm-toolbar"><button class="clack-fm-tool clack-fm-up" type="button" title="Up one folder">↑</button><div class="clack-fm-path"></div><input class="clack-fm-search" type="text" placeholder="Search this drive…" aria-label="Search files"></div>
        <div class="clack-fm-body"><nav class="clack-fm-drives" aria-label="Drives"></nav><main class="clack-fm-list-wrap"><div class="clack-fm-head"><span>Name</span><span>Type</span><span>Size</span></div><div class="clack-fm-list"></div></main><aside class="clack-fm-preview"><div class="clack-fm-preview-box"><span class="clack-fm-preview-icon">▰</span></div><h3>Select a file</h3><p class="clack-fm-meta">Choose a drive and browse folders.</p></aside></div>
        <footer class="clack-fm-footer"><span class="clack-fm-status">Ready</span><button type="button" class="btn ghost clack-fm-cancel">${this.modal ? 'Cancel' : 'Refresh'}</button><button type="button" class="btn primary clack-fm-action" disabled>Open</button></footer>
      </section>`;
      const $ = selector => this.host.querySelector(selector);
      this.els = { title: $('.clack-fm-title'), close: $('.clack-fm-close'), up: $('.clack-fm-up'), path: $('.clack-fm-path'), search: $('.clack-fm-search'), drives: $('.clack-fm-drives'), list: $('.clack-fm-list'), preview: $('.clack-fm-preview'), status: $('.clack-fm-status'), cancel: $('.clack-fm-cancel'), action: $('.clack-fm-action') };
      this.els.title.textContent = this.options.title || 'File Manager';
      if (!this.modal) this.els.close.hidden = true;
      for (const drive of [{ id: 'github', name: 'GitHub', detail: 'Repository files', glyph: '◫' }, { id: 'media', name: 'Website Media', detail: 'Images, video & audio', glyph: '●' }]) {
        const button = document.createElement('button');
        button.className = 'clack-fm-drive'; button.type = 'button'; button.dataset.drive = drive.id;
        button.innerHTML = `<span aria-hidden="true">${drive.glyph}</span><span>${drive.name}<small>${drive.detail}</small></span>`;
        button.addEventListener('click', () => this.loadDrive(drive.id));
        this.els.drives.appendChild(button);
      }
      this.els.up.addEventListener('click', () => this.navigate(this.path.split('/').slice(0, -1).join('/')));
      this.els.search.addEventListener('input', () => { this.selected = null; this.render(); });
      this.els.action.addEventListener('click', () => this.choose());
      this.els.cancel.addEventListener('click', () => this.modal ? this.close() : this.refresh());
      this.els.close.addEventListener('click', () => this.close());
      if (this.modal) this.host.addEventListener('pointerdown', event => { if (event.target === this.host) this.close(); });
      this.host.addEventListener('keydown', event => { if (event.key === 'Escape' && this.modal) this.close(); });
    }

    async loadDrive(drive) {
      this.drive = drive; this.path = ''; this.selected = null;
      this.els.search.value = ''; this.els.list.innerHTML = '<div class="clack-fm-empty">Reading drive…</div>';
      this.els.status.textContent = drive === 'github' ? 'Loading the GitHub repository…' : 'Loading the website media catalogue…';
      this.host.querySelectorAll('.clack-fm-drive').forEach(button => button.classList.toggle('active', button.dataset.drive === drive));
      try {
        this.files = drive === 'github' ? await githubFiles() : await mediaFiles();
        this.render();
      } catch (error) {
        this.files = []; this.els.list.innerHTML = `<div class="clack-fm-empty"></div>`;
        this.els.list.firstChild.textContent = error.message;
        this.els.status.textContent = 'Drive unavailable';
      }
    }

    navigate(path) { this.path = path; this.selected = null; this.els.search.value = ''; this.render(); }

    entries() {
      const search = this.els.search.value.trim().toLowerCase();
      if (search) return this.files.filter(file => file.path.toLowerCase().includes(search));
      const prefix = this.path ? `${this.path}/` : '';
      const folders = new Map(); const files = [];
      for (const file of this.files) {
        if (!file.path.startsWith(prefix)) continue;
        const rest = file.path.slice(prefix.length); const slash = rest.indexOf('/');
        if (slash >= 0) {
          const name = rest.slice(0, slash);
          if (!folders.has(name)) folders.set(name, { drive: this.drive, type: 'folder', name, path: prefix + name, kind: 'folder' });
        } else files.push(file);
      }
      return [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)).concat(files.sort((a, b) => a.name.localeCompare(b.name)));
    }

    compatible(item) { return item.type === 'folder' || !this.options.accept || this.options.accept(item); }

    render() {
      const entries = this.entries(); this.els.list.replaceChildren();
      this.els.path.textContent = `${this.drive === 'github' ? 'GitHub' : 'Website Media'}:/${this.path}`;
      this.els.up.disabled = !this.path || !!this.els.search.value;
      for (const item of entries) {
        const row = document.createElement('button'); row.type = 'button';
        row.className = `clack-fm-row${this.compatible(item) ? '' : ' incompatible'}`;
        row.innerHTML = `<span class="clack-fm-name"><span aria-hidden="true">${icon(item)}</span><span></span></span><span class="clack-fm-kind"></span><span class="clack-fm-size"></span>`;
        row.querySelector('.clack-fm-name span:last-child').textContent = item.name;
        row.querySelector('.clack-fm-kind').textContent = item.type === 'folder' ? 'Folder' : item.kind;
        row.querySelector('.clack-fm-size').textContent = item.type === 'folder' ? '—' : formatSize(item.size);
        row.addEventListener('click', () => this.select(item, row));
        row.addEventListener('dblclick', () => item.type === 'folder' ? this.navigate(item.path) : this.compatible(item) && this.choose(item));
        this.els.list.appendChild(row);
      }
      if (!entries.length) this.els.list.innerHTML = `<div class="clack-fm-empty">${this.els.search.value ? 'No files match this search.' : 'This folder is empty.'}</div>`;
      this.els.status.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'} · ${this.files.length} files on drive`;
      this.updateSelection();
    }

    select(item, row) {
      if (item.type === 'folder') { this.navigate(item.path); return; }
      this.selected = item;
      this.host.querySelectorAll('.clack-fm-row').forEach(entry => entry.classList.remove('selected'));
      row.classList.add('selected'); this.updateSelection();
    }

    updateSelection() {
      const item = this.selected; const box = this.els.preview.querySelector('.clack-fm-preview-box');
      const name = this.els.preview.querySelector('h3'); const meta = this.els.preview.querySelector('.clack-fm-meta');
      this.els.action.disabled = !item || !this.compatible(item);
      const association = associationFor(item);
      this.els.action.textContent = item && this.options.actionFor ? this.options.actionFor(item) :
        (item && !this.options.onSelect ? association ? `Open in ${association.label}` : 'Open in new tab' : (this.options.actionLabel || 'Open'));
      if (!item) { box.innerHTML = '<span class="clack-fm-preview-icon">▰</span>'; name.textContent = 'Select a file'; meta.textContent = 'Choose a file to see its details.'; return; }
      name.textContent = item.name;
      meta.textContent = `${item.drive === 'github' ? 'GitHub repository' : 'Live website'} · ${item.path}${Number.isFinite(item.size) ? ` · ${formatSize(item.size)}` : ''}`;
      if (item.kind === 'image') box.innerHTML = `<img alt="">`, box.firstChild.src = item.url;
      else if (item.kind === 'video') box.innerHTML = `<video muted controls preload="metadata"></video>`, box.firstChild.src = item.url;
      else if (item.kind === 'audio') box.innerHTML = `<audio controls preload="metadata"></audio>`, box.firstChild.src = item.url;
      else { box.innerHTML = `<span class="clack-fm-preview-icon">${icon(item)}</span>`; }
    }

    async choose(item = this.selected) {
      if (!item || !this.compatible(item)) return;
      this.els.action.disabled = true; this.els.status.textContent = `${this.els.action.textContent} ${item.name}…`;
      try {
        const opened = this.options.onSelect ? (await this.options.onSelect(item), true) : await openItem(item);
        if (!opened) { this.els.status.textContent = 'Open cancelled'; this.els.action.disabled = false; return; }
        if (this.modal && this.options.closeOnSelect !== false) this.close();
        else {
          const association = associationFor(item);
          this.els.status.textContent = association ? `Opened ${item.name} in ${association.label}` : `Opened ${item.name} in a new tab`;
          this.els.action.disabled = false;
        }
      } catch (error) {
        this.els.status.textContent = error.message || String(error); this.els.action.disabled = false;
      }
    }

    async refresh() {
      if (this.drive === 'github') cache.github = null; else cache.media = null;
      await this.loadDrive(this.drive);
    }

    close() { this.host.remove(); if (this.options.onCancel) this.options.onCancel(); }
  }

  window.ClackOSFileManager = {
    open(options = {}) {
      const host = document.createElement('div'); host.className = 'clack-fm-modal';
      document.body.appendChild(host); const explorer = new Explorer(host, options, true);
      setTimeout(() => explorer.els.search.focus(), 0); return explorer;
    },
    mount(host, options = {}) { return new Explorer(host, options, false); },
    kindFor,
    associationFor,
    openItem
  };
})();
