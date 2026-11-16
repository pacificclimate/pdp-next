import Map from 'ol/Map.js';
import Feature from 'ol/Feature.js';
import Overlay from 'ol/Overlay.js';
import Pointer from 'ol/interaction/Pointer.js';
import Point from 'ol/geom/Point.js';
import Style from 'ol/style/Style.js';
import Circle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import View from 'ol/View.js';
import Draw, { createBox } from 'ol/interaction/Draw.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import Projection from 'ol/proj/Projection.js';
import {
  addCoordinateTransforms,
  addProjection,
  get,
  getPointResolution,
  getTransform,
  transform,
  transformExtent,
} from 'ol/proj.js';
import { register as registerProj4 } from 'ol/proj/proj4.js';
import VectorSource from 'ol/source/Vector.js';
import OSM from 'ol/source/OSM.js';
import TileWMS from 'ol/source/TileWMS.js';
import Polygon from 'ol/geom/Polygon.js';

// Preserve the small legacy OpenLayers namespace used by the existing controllers
// while sourcing it from Vite-bundled ES modules.
export const ol = {
  Map,
  Feature,
  Overlay,
  style: { Style, Circle, Fill, Stroke },
  View,
  geom: { Polygon, Point },
  interaction: { Pointer, Draw: Object.assign(Draw, { createBox }) },
  layer: { Tile: TileLayer, Vector: VectorLayer },
  proj: {
    Projection,
    addCoordinateTransforms,
    addProjection,
    get,
    getPointResolution,
    getTransform,
    proj4: { register: registerProj4 },
    transform,
    transformExtent,
  },
  source: { OSM, TileWMS, Vector: VectorSource },
};
