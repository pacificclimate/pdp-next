import { createSubsetDrawController } from './subsetting/draw.js';
import { createSubsetIndexController } from './subsetting/indexes.js';
import { createSubsetLogger } from './subsetting/logging.js';
import { createSubsetDownloadController } from './subsetting/download.js';

export function createSubsettingController({
  state,
  portal,
  ui,
  status,
  services,
  time,
  mapDeps
}) {
  const logger = createSubsetLogger();
  const drawController = createSubsetDrawController({
    ...mapDeps,
    setStatus: status.setStatus
  });
  const indexController = createSubsetIndexController({
    state,
    fetchText: services.fetchText,
    dodsBaseForUrlPath: services.dodsBaseForUrlPath
  });
  const downloadController = createSubsetDownloadController({
    state,
    portal,
    ui,
    status,
    services,
    time,
    logger,
    drawController,
    indexController
  });

  return {
    clearSubsetDrawing: drawController.clearSubsetDrawing,
    setSubsetDrawMode: drawController.setSubsetDrawMode,
    downloadSubset: downloadController.downloadSubset,
    cancelPendingSubsetStatus: downloadController.cancelPendingSubsetStatus
  };
}
