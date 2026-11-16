import tempfile
import unittest
from pathlib import Path

from netCDF4 import Dataset

from portal_meta_builder.metadata import read_netcdf_metadata


class TimeMetadataTests(unittest.TestCase):
    def test_time_units_and_calendar_are_emitted(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.nc"
            with Dataset(path, "w") as dataset:
                dataset.createDimension("time", 1)
                time = dataset.createVariable("time", "f8", ("time",))
                time.units = "days since 1950-01-01"
                time.calendar = "360_day"
                time[:] = [0.5]

            metadata = read_netcdf_metadata(path)

        self.assertEqual(metadata["time"]["units"], "days since 1950-01-01")
        self.assertEqual(metadata["time"]["calendar"], "360_day")
        self.assertEqual(metadata["time"]["name"], "time")

    def test_differently_named_coordinate_is_detected_from_cf_units(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.nc"
            with Dataset(path, "w") as dataset:
                dataset.createDimension("record", 2)
                coordinate = dataset.createVariable("observation_date", "f8", ("record",))
                coordinate.units = "days since 1950-01-01 00:00:00"
                coordinate[:] = [0, 365]

            metadata = read_netcdf_metadata(path)

        self.assertEqual(metadata["time"]["name"], "observation_date")
        self.assertEqual(metadata["time"]["count"], 2)
        self.assertEqual(metadata["time"]["startYear"], 1950)
        self.assertEqual(metadata["time"]["endYear"], 1951)

    def test_time_coordinate_does_not_require_axis_attribute(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.nc"
            with Dataset(path, "w") as dataset:
                dataset.createDimension("steps", 1)
                coordinate = dataset.createVariable("steps_since_start", "f8", ("steps",))
                coordinate.units = "hours since 2001-02-03 04:00:00"
                coordinate[:] = [0]

            metadata = read_netcdf_metadata(path)

        self.assertEqual(metadata["time"]["name"], "steps_since_start")
        self.assertEqual(metadata["time"]["startYear"], 2001)

    def test_static_dataset_has_empty_time_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "fixture.nc"
            with Dataset(path, "w") as dataset:
                dataset.createDimension("sample", 1)
                non_temporal = dataset.createVariable("time", "f8", ("sample",))
                non_temporal.units = "1"
                non_temporal[:] = [0]

            metadata = read_netcdf_metadata(path)

        self.assertEqual(metadata["time"], {})
        self.assertEqual(metadata["derived"]["timeCount"], 0)
