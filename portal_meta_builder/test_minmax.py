import tempfile
import unittest
from pathlib import Path

from portal_meta_builder.minmax import (
    load_minmax_csv, rendering_defaults, variable_class,
)
from portal_meta_builder.portals import PORTAL_CONFIGS


class RenderingDefaultsTests(unittest.TestCase):
    def test_variable_classes_include_snow_and_wind_speed(self):
        for name in ('pr', 'ppt', 'prec', 'precip', 'precipitation', 'prsn'):
            self.assertEqual(variable_class(name), 'precip')
        self.assertEqual(variable_class('RAINF'), 'rain')
        self.assertEqual(variable_class('SWE'), 'snow')
        self.assertEqual(variable_class('wind'), 'wind_speed')
        wind = rendering_defaults({'variable': 'wind', 'min': 0.00320975, 'max': 31.5894}, 'gridded_daily', {'primary': {'units': 'm s-1'}}, 'PNWNAmet_wind.nc')
        self.assertEqual(wind['scaleType'], 'log')
        self.assertNotIn('suggestedMin', wind)
        zero_wind = rendering_defaults({'variable': 'wind', 'min': 0, 'max': 30}, 'gridded_daily', {'primary': {'units': 'm/s'}}, 'wind.nc')
        self.assertEqual(zero_wind['suggestedMin'], 0.01)

    def test_csv_path_is_supplied_by_caller_and_legacy_field_is_absent(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'ranges.csv'
            path.write_text('vicgl,/data/PREC.nc,PREC,0,20,db\n')
            record = load_minmax_csv(path)['/data/PREC.nc'][0]
        self.assertNotIn('logScale', record)
        self.assertEqual(rendering_defaults(record, 'vicgl', {'primary': {'units': 'mm'}}, 'PREC.nc')['suggestedMin'], 0.01)

    def test_positive_dataset_min_and_unit_aware_zero_fallback(self):
        record = {'variable': 'pr', 'min': 0.0001, 'max': 40}
        self.assertEqual(rendering_defaults(record, 'bccaqv2_u6', {'primary': {'units': 'mm'}}, 'pr.nc')['suggestedMin'], 0.01)
        record['min'] = 0.04
        self.assertNotIn('suggestedMin', rendering_defaults(record, 'bccaqv2_u6', {'primary': {'units': 'mm'}}, 'pr.nc'))
        record['min'] = 0
        self.assertEqual(rendering_defaults(record, 'bccaqv2_u6', {'primary': {'units': 'mm'}}, 'pr.nc')['suggestedMin'], 0.01)
        self.assertEqual(rendering_defaults(record, 'bccaqv2_u6', {'primary': {'units': 'mm/day'}}, 'pr.nc')['suggestedMin'], 0.01)
        self.assertEqual(rendering_defaults(record, 'bccaqv2_u5', {'primary': {'units': 'kg m-2 d-1'}}, 'pr.nc')['suggestedMin'], 0.01)
        self.assertEqual(rendering_defaults(record, 'bccaqv2_u6', {'primary': {'units': 'kg m-2 s-1'}}, 'pr.nc')['suggestedMin'], 1e-7)
        self.assertEqual(rendering_defaults(record, 'bccaqv2_u6', {'primary': {'units': 'mm s-1'}}, 'pr.nc')['suggestedMin'], 1e-7)

    def test_portal_wide_defaults_and_class_override(self):
        PORTAL_CONFIGS['example'] = {
            'renderingOverrides': {
                '*': {'scaleType': 'linear', 'suggestedMax': 500},
                'precip': {'scaleType': 'log', 'suggestedMin': 0.05},
            },
        }
        try:
            metadata = {'primary': {'units': 'mm'}}
            precip = rendering_defaults({'variable': 'pr', 'min': 0, 'max': 100}, 'example', metadata, 'pr.nc')
            wind = rendering_defaults({'variable': 'wind', 'min': 0, 'max': 20}, 'example', metadata, 'wind.nc')
            self.assertEqual((precip['scaleType'], precip['suggestedMin'], precip['suggestedMax']), ('log', 0.05, 500))
            self.assertEqual(wind['scaleType'], 'linear')
            self.assertNotIn('suggestedMin', wind)
            self.assertEqual(wind['suggestedMax'], 500)
            PORTAL_CONFIGS['example']['renderingOverrides']['*']['scaleType'] = 'log'
            temperature = rendering_defaults({'variable': 'tas', 'min': -5, 'max': 8}, 'example', metadata, 'tas.nc')
            self.assertEqual(temperature['suggestedMin'], 0.01)
        finally:
            del PORTAL_CONFIGS['example']

    def test_portal_precision_and_log_floor_apply_only_to_defaults(self):
        PORTAL_CONFIGS['example'] = {
            'renderingOverrides': {
                '*': {'rangeDecimalPlaces': 2},
                'precip': {'scaleType': 'log', 'logMinFloor': 0.05},
            },
        }
        try:
            metadata = {'primary': {'units': 'mm'}}
            precip = rendering_defaults({'variable': 'pr', 'min': 0, 'max': 12.345}, 'example', metadata, 'pr.nc')
            temp = rendering_defaults({'variable': 'tas', 'min': -3.141, 'max': 5.551}, 'example', metadata, 'tas.nc')
            self.assertEqual((precip['suggestedMin'], precip['suggestedMax']), (0.05, 12.35))
            self.assertEqual((temp['suggestedMin'], temp['suggestedMax']), (-3.15, 5.56))
            self.assertEqual(precip['rangeDecimalPlaces'], 2)
            PORTAL_CONFIGS['example']['renderingOverrides']['precip']['logMinFloor'] = 0.001
            smaller_floor = rendering_defaults({'variable': 'pr', 'min': 0, 'max': 12}, 'example', metadata, 'pr.nc')
            self.assertEqual(smaller_floor['suggestedMin'], 0.01)
            del PORTAL_CONFIGS['example']['renderingOverrides']['*']['rangeDecimalPlaces']
            unrounded_floor = rendering_defaults({'variable': 'pr', 'min': 0, 'max': 12}, 'example', metadata, 'pr.nc')
            self.assertEqual(unrounded_floor['suggestedMin'], 0.001)
        finally:
            del PORTAL_CONFIGS['example']

    def test_prism_only_annual_and_monthly_overrides(self):
        record = {'variable': 'pr', 'min': 0.2, 'max': 50}
        metadata = {'primary': {'units': 'mm'}}
        self.assertEqual(rendering_defaults(record, 'prism', metadata, 'pr_aClimMean.nc')['suggestedMin'], 200)
        self.assertEqual(rendering_defaults(record, 'prism', metadata, 'pr_mClimMean.nc')['suggestedMin'], 1)
        single = {'primary': {'units': 'mm'}, 'time': {'count': 1}}
        self.assertEqual(rendering_defaults(record, 'prism', single, 'pr_other.nc')['suggestedMin'], 200)
        self.assertNotIn('suggestedMin', rendering_defaults(record, 'vicgl', metadata, 'PREC.nc'))
        self.assertNotIn('suggestedMin', rendering_defaults(record, 'bccaqv2_u6', metadata, 'pr_day.nc'))
