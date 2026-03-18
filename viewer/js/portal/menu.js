import { KNOWN_PORTALS, PORTAL_PARAM_KEY } from '../core/config.js';

function setActiveMenuItem(el) {
  document.querySelectorAll('.variable-item').forEach((i) => i.classList.remove('active'));
  el.classList.add('active');
  let parent = el.parentElement;
  while (parent) {
    if (parent.classList?.contains('menu-children') || parent.classList?.contains('variable-list')) {
      parent.classList.add('show');
      const wrap = parent.parentElement;
      const hdr = wrap?.querySelector?.(':scope > .menu-header');
      if (hdr) hdr.classList.add('expanded');
    }
    parent = parent.parentElement;
  }
}

export function createMenuController({
  portal,
  ui,
  services,
  loadDatasetFromUrlPath
}) {
  const { datasetMenu, portalSelect } = ui;
  const { fetchJson, setStatus } = services;
  function createMenuHeaderLi(label) {
    const item = document.createElement('li');
    item.className = 'menu-item';
    const header = document.createElement('div');
    header.className = 'menu-header group-header';
    header.innerHTML = `<span>${label}</span><span class="menu-toggle">▼</span>`;
    item.appendChild(header);
    const children = document.createElement('ul');
    children.className = 'menu-children';
    item.appendChild(children);
    return { item, header, children };
  }

  function wireMenuHeaderToggle(header, children, expanded) {
    children.classList.toggle('show', !!expanded);
    header.classList.toggle('expanded', !!expanded);
    header.style.cursor = 'pointer';
    header.addEventListener('click', () => {
      const next = !children.classList.contains('show');
      children.classList.toggle('show', next);
      header.classList.toggle('expanded', next);
    });
  }

  function getPortalMetaUrl(portalId) {
    return `/pdp-next/portal-meta/${encodeURIComponent(String(portalId || '').toLowerCase())}.json`;
  }

  async function loadPortalMeta(portalId) {
    return fetchJson(getPortalMetaUrl(portalId));
  }

  function buildBasenameIndex(metaPayload) {
    const index = new Map();
    const files = metaPayload?.files && typeof metaPayload.files === 'object' ? metaPayload.files : {};
    Object.values(files).forEach((entry) => {
      const basename = String(entry?.basename || '').trim();
      if (!basename) return;
      if (!index.has(basename)) index.set(basename, entry);
    });
    return index;
  }

  function renderMenuFromPortalMeta(metaPayload) {
    datasetMenu.innerHTML = '';
    const menuTree = metaPayload?.menu;
    if (!menuTree || typeof menuTree !== 'object') throw new Error('portal-meta is missing menu tree');
    const basenameIndex = buildBasenameIndex(metaPayload);
    let defaultSelection = null;
    const topLabels = Object.keys(menuTree).sort((a, b) => a.localeCompare(b));
    if (topLabels.length) {
      const walk = (node, path = []) => {
        if (defaultSelection) return;
        if (Array.isArray(node)) {
          const basename = String(node[0] || '').trim();
          const entry = basenameIndex.get(basename);
          if (entry?.thredds?.urlPath) defaultSelection = { entry, path };
          return;
        }
        if (!node || typeof node !== 'object') return;
        const labels = Object.keys(node).sort((a, b) => a.localeCompare(b));
        for (const label of labels) {
          walk(node[label], [...path, label]);
          if (defaultSelection) return;
        }
      };
      walk(menuTree[topLabels[0]], [topLabels[0]]);
    }

    const openPath = new Set();
    if (defaultSelection?.path?.length) {
      defaultSelection.path.forEach((_, idx) => openPath.add(defaultSelection.path.slice(0, idx + 1).join('||')));
    }

    function renderNode(nodeLabel, nodeValue, containerUl, path = []) {
      const pathNow = [...path, nodeLabel];
      const pathKey = pathNow.join('||');
      const expandByDefault = openPath.has(pathKey);

      if (Array.isArray(nodeValue)) {
        if (!nodeValue.length) return;
        if (nodeValue.length === 1) {
          const basename = String(nodeValue[0] || '').trim();
          const entry = basenameIndex.get(basename);
          if (!entry?.thredds?.urlPath) return;
          const fileLi = document.createElement('li');
          fileLi.className = 'variable-item';
          fileLi.textContent = nodeLabel;
          fileLi.title = entry.thredds.urlPath;
          fileLi.addEventListener('click', () => {
            setActiveMenuItem(fileLi);
            loadDatasetFromUrlPath({
              name: entry.basename || basename,
              urlPath: entry.thredds.urlPath,
              variable: entry?.metadata?.primary?.name || null,
              rendering: entry?.rendering || null,
              timeMetadata: entry?.metadata?.time || null
            });
          });
          containerUl.appendChild(fileLi);
          return;
        }

        const li = document.createElement('li');
        li.className = 'menu-item';
        const header = document.createElement('div');
        header.className = 'menu-header group-header';
        header.innerHTML = `<span>${nodeLabel}</span><span class="menu-toggle">▼</span>`;
        li.appendChild(header);
        const children = document.createElement('ul');
        children.className = 'menu-children';
        li.appendChild(children);
        wireMenuHeaderToggle(header, children, expandByDefault);

        nodeValue.map((b) => String(b || '').trim()).filter(Boolean).sort((a, b) => a.localeCompare(b)).forEach((basename) => {
          const entry = basenameIndex.get(basename);
          if (!entry?.thredds?.urlPath) return;
          const fileLi = document.createElement('li');
          fileLi.className = 'variable-item';
          fileLi.textContent = entry.basename || basename;
          fileLi.title = entry.thredds.urlPath;
          fileLi.addEventListener('click', () => {
            setActiveMenuItem(fileLi);
            loadDatasetFromUrlPath({
              name: entry.basename || basename,
              urlPath: entry.thredds.urlPath,
              variable: entry?.metadata?.primary?.name || null,
              rendering: entry?.rendering || null,
              timeMetadata: entry?.metadata?.time || null
            });
          });
          children.appendChild(fileLi);
        });

        containerUl.appendChild(li);
        return;
      }

      if (!nodeValue || typeof nodeValue !== 'object') return;
      const { item, header, children } = createMenuHeaderLi(nodeLabel);
      containerUl.appendChild(item);
      wireMenuHeaderToggle(header, children, expandByDefault);
      Object.keys(nodeValue).sort((a, b) => a.localeCompare(b)).forEach((childLabel) => renderNode(childLabel, nodeValue[childLabel], children, pathNow));
    }

    topLabels.forEach((label) => renderNode(label, menuTree[label], datasetMenu));
    const firstSelectable = datasetMenu.querySelector('.variable-item');
    if (firstSelectable) {
      setActiveMenuItem(firstSelectable);
      firstSelectable.dispatchEvent(new Event('click'));
    }
  }

  async function renderMenuForGroup() {
    datasetMenu.innerHTML = '';
    setStatus('Loading portal metadata…');
    const metaPayload = await loadPortalMeta(portal.id);
    renderMenuFromPortalMeta(metaPayload);
    setStatus('Ready - Select a dataset');
  }

  function populatePortalSelect() {
    portalSelect.innerHTML = '';
    const ids = Array.from(new Set([...KNOWN_PORTALS.map((p) => p.id), portal.id])).filter(Boolean);
    ids.forEach((id) => {
      const meta = KNOWN_PORTALS.find((p) => p.id === id);
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = meta?.title || id;
      portalSelect.appendChild(opt);
    });
    portalSelect.value = portal.id;
    portalSelect.addEventListener('change', () => {
      const url = new URL(window.location.href);
      url.searchParams.set(PORTAL_PARAM_KEY, portalSelect.value);
      window.location.href = url.toString();
    }, { once: true });
  }

  return {
    renderMenuForGroup,
    populatePortalSelect
  };
}