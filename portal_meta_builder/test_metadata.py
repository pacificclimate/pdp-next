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
