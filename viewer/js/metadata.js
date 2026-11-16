function stringValue(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  return String(raw);
}

function markdownValue(raw) {
  return stringValue(raw)?.replace(/[\\`*_{}[\]<>]/g, '\\$&') || null;
}

function metadataLines(title, fields) {
  const lines = fields
    .map(([label, fieldValue]) => {
      const formatted = markdownValue(fieldValue);
      return formatted ? `- **${label}:** ${formatted}` : null;
    })
    .filter(Boolean);
  return lines.length ? [`## ${title}`, ...lines, ''] : [];
}

function summarySections(dataset) {
  const metadata = dataset?.metadata || {};
  const primary = metadata.primary || {};
  const time = metadata.time || {};
  const global = metadata.global || {};
  return [
    ['Dataset', [
      ['File', dataset?.name],
      ['Selection', dataset?.selectionLabel],
      ['THREDDS path', dataset?.urlPath],
    ]],
    ['Variable', [
      ['Name', primary.name],
      ['Long name', primary.long_name],
      ['Standard name', primary.standard_name],
      ['Units', primary.units],
      ['Cell methods', primary.cell_methods],
    ]],
    ['Time coverage', [
      ['Start', time.start],
      ['End', time.end],
      ['Time steps', time.count],
      ['Calendar', time.calendar],
      ['Units', time.units],
    ]],
    ['Global attributes', Object.entries(global)
      .filter(([key]) => key.toLowerCase() !== 'history')
      .sort(([first], [second]) => first.localeCompare(second))],
  ];
}

export function renderMetadataSummary(container, dataset) {
  container.replaceChildren();
  summarySections(dataset).forEach(([heading, fields]) => {
    const populatedFields = fields.filter(([, fieldValue]) => stringValue(fieldValue));
    if (!populatedFields.length) return;

    const section = document.createElement('section');
    section.className = 'metadata-section';
    const title = document.createElement('h3');
    title.textContent = heading;
    const details = document.createElement('dl');
    populatedFields.forEach(([label, fieldValue]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = stringValue(fieldValue);
      term.className = 'metadata-label';
      description.className = 'metadata-value';
      details.append(term, description);
    });
    section.append(title, details);
    container.append(section);
  });
}

export function formatMetadataMarkdown(dataset) {
  const metadata = dataset?.metadata || {};
  const primary = metadata.primary || {};
  const time = metadata.time || {};
  const global = metadata.global || {};
  const title = markdownValue(dataset?.name || dataset?.urlPath || 'Selected dataset');
  const lines = [`# Metadata: ${title}`, ''];

  lines.push(...metadataLines('Dataset', [
    ['Selection', dataset?.selectionLabel],
    ['THREDDS path', dataset?.urlPath],
  ]));
  lines.push(...metadataLines('Variable', [
    ['Name', primary.name],
    ['Long name', primary.long_name],
    ['Standard name', primary.standard_name],
    ['Units', primary.units],
    ['Cell methods', primary.cell_methods],
  ]));
  lines.push(...metadataLines('Time coverage', [
    ['Start', time.start],
    ['End', time.end],
    ['Time steps', time.count],
    ['Calendar', time.calendar],
    ['Units', time.units],
  ]));

  const globalFields = Object.entries(global)
    .filter(([key]) => key.toLowerCase() !== 'history')
    .sort(([first], [second]) => first.localeCompare(second));
  lines.push(...metadataLines('Global attributes', globalFields));
  return lines.join('\n').trimEnd() + '\n';
}

export function metadataFilename(dataset, extension) {
  const base = String(dataset?.name || 'dataset-metadata')
    .replace(/\.nc$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-');
  return `${base || 'dataset-metadata'}-metadata.${extension}`;
}

function downloadUrl(content, type) {
  return URL.createObjectURL(new window.Blob([content], { type }));
}

export function createMetadataDialogController({
  dialog,
  summary,
  markdownDownload,
  jsonDownload,
  ncmlDownload,
}) {
  let objectUrls = [];

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  function clearObjectUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
  }

  function show(dataset) {
    const markdown = formatMetadataMarkdown(dataset);
    clearObjectUrls();
    renderMetadataSummary(summary, dataset);

    const markdownUrl = downloadUrl(markdown, 'text/markdown;charset=utf-8');
    const jsonUrl = downloadUrl(JSON.stringify(dataset.metadata || {}, null, 2) + '\n', 'application/json;charset=utf-8');
    objectUrls = [markdownUrl, jsonUrl];
    markdownDownload.href = markdownUrl;
    markdownDownload.download = metadataFilename(dataset, 'md');
    jsonDownload.href = jsonUrl;
    jsonDownload.download = metadataFilename(dataset, 'json');
    ncmlDownload.href = dataset.ncmlUrl || '#';
    ncmlDownload.download = metadataFilename(dataset, 'ncml');
    ncmlDownload.hidden = !dataset.ncmlUrl;

    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  return { show, clearObjectUrls };
}
