import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "data" / "experiment.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    session_label TEXT,
    stage TEXT NOT NULL DEFAULT 'language',
    lang TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    consent_at TEXT,
    eligibility_json TEXT,
    consumption_survey_json TEXT,
    consumption_estimate_json TEXT,
    tariff_hypo_elec_json TEXT,
    tariff_hypo_water_json TEXT,
    behavior_current_json TEXT,
    behavior_adopt_json TEXT,
    est_pct_elec REAL,
    est_pct_eau REAL,
    tariff_real_elec_json TEXT,
    tariff_real_water_json TEXT,
    n_correct_tariff INTEGER,
    preferences_json TEXT,
    demographics_json TEXT,
    crt_json TEXT,
    crt_check_json TEXT,
    lottery_json TEXT,
    lottery_draw_json TEXT,
    bonus_eur REAL,
    lottery_gain_eur REAL,
    base_gain_eur REAL,
    total_gain_eur REAL,
    rounded_gain_eur REAL,
    completed_at TEXT
);
"""


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


JSON_FIELDS = (
    "eligibility_json", "consumption_survey_json", "consumption_estimate_json",
    "tariff_hypo_elec_json", "tariff_hypo_water_json",
    "behavior_current_json", "behavior_adopt_json",
    "tariff_real_elec_json", "tariff_real_water_json",
    "preferences_json", "demographics_json", "crt_json", "crt_check_json",
    "lottery_json", "lottery_draw_json",
)


def row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    for key in JSON_FIELDS:
        if d.get(key):
            try:
                d[key] = json.loads(d[key])
            except (TypeError, ValueError):
                pass
    return d
