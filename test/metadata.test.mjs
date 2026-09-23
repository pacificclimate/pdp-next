import assert from 'node:assert/strict';
import { test } from 'vitest';

import { formatMetadataMarkdown, metadataFilename } from '../viewer/js/metadata.js';

const dataset = {
  name: 'tas_daily.nc',
  selectionLabel: 'Historical › Daily',
  urlPath: 'data/example/tas_daily.nc',
  metadata: {
    primary: {
      name: 'tas',
      long_name: 'Near-Surface Air Temperature',
      standard_name: 'air_temperature',
      units: 'K',
    },
    time: {
      start: '1950-01-01 00:00:00',
      end: '2100-12-31 00:00:00',
      count: 55152,
      calendar: 'gregorian',
      units: 'days since 1950-01-01',
    },
    global: {
      Conventions: 'CF-1.8',
      history: 'Created on an internal system',
      title: 'Example climate data',
    },
  },
};

test('formats selected dataset metadata as a readable Markdown summary', () => {
  const summary = formatMetadataMarkdown(dataset);

  assert.match(summary, /^# Metadata: tas\\_daily\.nc/m);
  assert.match(summary, /## Variable/);
  assert.match(summary, /- \*\*Long name:\*\* Near-Surface Air Temperature/);
  assert.match(summary, /## Time coverage/);
  assert.match(summary, /- \*\*Time steps:\*\* 55152/);
  assert.match(summary, /## Global attributes/);
  assert.match(summary, /- \*\*Conventions:\*\* CF-1\.8/);
  assert.doesNotMatch(summary, /Created on an internal system/);
});

test('uses a safe, descriptive metadata download filename', () => {
  assert.equal(metadataFilename(dataset, 'json'), 'tas_daily-metadata.json');
  assert.equal(metadataFilename({ name: 'temperature / daily.nc' }, 'md'), 'temperature-daily-metadata.md');
});
