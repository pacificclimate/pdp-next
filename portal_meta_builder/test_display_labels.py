import json
import unittest
from pathlib import Path

from portal_meta_builder.portals import PORTAL_CONFIGS, derive_menu_fields


DISPLAY_LABELS_PATH = Path(__file__).resolve().parent.parent / "config" / "display-labels.json"


class DisplayLabelsTests(unittest.TestCase):
    def load_labels(self):
        with DISPLAY_LABELS_PATH.open(encoding="utf-8") as labels_file:
            return json.load(labels_file)

    def test_registry_has_menu_headings_for_each_portal(self):
        labels = self.load_labels()
        self.assertIsInstance(labels.get("common"), dict)
        self.assertIsInstance(labels.get("viewer"), dict)
        self.assertIsInstance(labels.get("portals"), dict)
        self.assertIsInstance(labels["viewer"].get("portalTitles"), dict)
        self.assertIsInstance(labels["viewer"].get("paletteLabels"), dict)
        self.assertIsInstance(labels["viewer"].get("defaultVariableLabels"), dict)
        for portal_id, config in PORTAL_CONFIGS.items():
            portal_labels = labels["portals"].get(portal_id)
            self.assertIsInstance(portal_labels, dict, portal_id)
            headings = portal_labels.get("headings")
            self.assertIsInstance(headings, dict, portal_id)
            for field in config["menuSchema"]["order"]:
                self.assertIsInstance(headings.get(field), str, f"{portal_id}.{field}")

    def test_prism_label_override_uses_stable_variable_code(self):
        fields = derive_menu_fields(
            "prism",
            {"derived": {"variableCode": "pr", "frequency": "mon", "timeCount": 12}},
        )
        self.assertEqual(fields["variable"], "pr")
        self.assertEqual(fields["frequency"], "monthly")
