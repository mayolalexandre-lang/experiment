import json
import math
import os
import random
from datetime import datetime, timezone
from io import StringIO
import csv
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, Response

import db
from tariff_logic import annual_cost, cheaper_plan
from consumption_logic import estimate_consumption

BASE_DIR = Path(__file__).parent
ADMIN_TOKEN = os.environ.get("ADMIN_TOKEN", "changeme")

with open(BASE_DIR / "data" / "experiment_content.json", encoding="utf-8") as f:
    CONTENT = json.load(f)

# Numeric/scoring data (prices, thresholds, % scales, comparisons) is identical across
# languages -- only labels differ. Internal logic always reads from the French block.
CORE = CONTENT["fr"]

app = Flask(__name__, static_folder="static")
db.init_db()

STAGES = [
    "language", "consent", "eligibility", "consumption_survey", "consumption_estimate",
    "tariff_hypo_intro", "tariff_hypo_elec", "tariff_hypo_water",
    "behavior_current", "behavior_adopt", "recap",
    "tariff_real_elec", "tariff_real_water",
    "preferences", "demographics",
    "crt", "crt_check", "lottery", "done",
]


def now():
    return datetime.now(timezone.utc).isoformat()


def get_participant(code):
    conn = db.get_conn()
    row = conn.execute("SELECT * FROM participants WHERE code = ?", (code,)).fetchone()
    conn.close()
    return db.row_to_dict(row)


def require_admin(req):
    token = req.args.get("token") or req.headers.get("X-Admin-Token")
    return token == ADMIN_TOKEN


# ---------------------------------------------------------------- static app

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/admin")
def admin_page():
    return send_from_directory(app.static_folder, "admin.html")


@app.route("/api/config")
def api_config():
    return jsonify(CONTENT)


# ---------------------------------------------------------------- flow helpers

def _advance(code, expected_stage, next_stage, updates: dict):
    p = get_participant(code)
    if not p:
        return None, ("participant introuvable", 404)
    if p["stage"] != expected_stage:
        return None, (f"étape inattendue: en base = {p['stage']}, attendu = {expected_stage}", 409)

    set_clauses = "".join(f", {k} = ?" for k in updates)
    values = list(updates.values())
    conn = db.get_conn()
    conn.execute(
        f"UPDATE participants SET stage = ?, updated_at = ?{set_clauses} WHERE code = ?",
        [next_stage, now()] + values + [code],
    )
    conn.commit()
    conn.close()
    return get_participant(code), None


@app.route("/api/start", methods=["POST"])
def api_start():
    payload = request.get_json(force=True) or {}
    code = (payload.get("code") or "").strip()
    session_label = (payload.get("session_label") or "").strip()
    if not code:
        return jsonify({"error": "code manquant"}), 400

    existing = get_participant(code)
    if existing:
        return jsonify({"participant": existing})

    conn = db.get_conn()
    conn.execute(
        "INSERT INTO participants (code, session_label, stage) VALUES (?, ?, 'language')",
        (code, session_label),
    )
    conn.commit()
    conn.close()
    return jsonify({"participant": get_participant(code)})


@app.route("/api/state")
def api_state():
    code = request.args.get("code", "").strip()
    p = get_participant(code)
    if not p:
        return jsonify({"error": "participant introuvable"}), 404
    return jsonify({"participant": p})


@app.route("/api/language", methods=["POST"])
def api_language():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    lang = payload.get("lang", "").strip()
    if lang not in ("fr", "en"):
        return jsonify({"error": "langue invalide"}), 400
    participant, err = _advance(code, "language", "consent", {"lang": lang})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/consent", methods=["POST"])
def api_consent():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    participant, err = _advance(code, "consent", "eligibility", {"consent_at": now()})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/eligibility", methods=["POST"])
def api_eligibility():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    data = payload.get("data") or {}
    participant, err = _advance(code, "eligibility", "consumption_survey",
                                 {"eligibility_json": json.dumps(data, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/consumption_survey", methods=["POST"])
def api_consumption_survey():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    answers = payload.get("answers") or {}
    estimate = estimate_consumption(answers)
    participant, err = _advance(
        code, "consumption_survey", "consumption_estimate",
        {
            "consumption_survey_json": json.dumps(answers, ensure_ascii=False),
            "consumption_estimate_json": json.dumps(estimate, ensure_ascii=False),
        },
    )
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/consumption_estimate_ack", methods=["POST"])
def api_consumption_estimate_ack():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    participant, err = _advance(code, "consumption_estimate", "tariff_hypo_intro", {})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/tariff_hypo_intro_ack", methods=["POST"])
def api_tariff_hypo_intro_ack():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    participant, err = _advance(code, "tariff_hypo_intro", "tariff_hypo_elec", {})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


# ---------------------------------------------------------------- tariff choices (hypothetical + real)

def _annual_volume_from_estimate(p, domain, reduced=False):
    est = p["consumption_estimate_json"]
    avg = est["kwh_annuel_avg"] if domain == "electricite" else est["m3_annuel_avg"]
    if not reduced:
        return avg
    pct = (p["est_pct_elec"] if domain == "electricite" else p["est_pct_eau"]) or 0
    return avg * (1 - pct / 100)


def _score_tariff_choices(option, annual_volume, choices):
    results = []
    n_correct = 0
    for (plan_a, plan_b), choice in zip(CORE["tariffs"]["comparisons"], choices):
        correct = cheaper_plan(option, plan_a, plan_b, annual_volume)
        is_correct = correct is not None and choice == correct
        if is_correct:
            n_correct += 1
        results.append({
            "plan_a": plan_a, "plan_b": plan_b, "choice": choice, "correct_choice": correct,
            "cost_a": round(annual_cost(option, plan_a, annual_volume), 2),
            "cost_b": round(annual_cost(option, plan_b, annual_volume), 2),
            "is_correct": is_correct,
        })
    return results, n_correct


def _validate_choices(choices):
    n_comp = len(CORE["tariffs"]["comparisons"])
    return len(choices) == n_comp and all(c in ("A", "B") for c in choices)


@app.route("/api/tariff_hypo_elec", methods=["POST"])
def api_tariff_hypo_elec():
    payload = request.get_json(force=True) or {}
    code, choices = payload.get("code", "").strip(), payload.get("choices") or []
    if not _validate_choices(choices):
        return jsonify({"error": "choix invalides"}), 400
    p = get_participant(code)
    if not p or p["stage"] != "tariff_hypo_elec":
        return jsonify({"error": "étape inattendue"}), 409
    volume = _annual_volume_from_estimate(p, "electricite")
    results, _ = _score_tariff_choices(CORE["tariffs"]["electricite"], volume, choices)
    participant, err = _advance(code, "tariff_hypo_elec", "tariff_hypo_water",
                                 {"tariff_hypo_elec_json": json.dumps({"results": results}, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/tariff_hypo_water", methods=["POST"])
def api_tariff_hypo_water():
    payload = request.get_json(force=True) or {}
    code, choices = payload.get("code", "").strip(), payload.get("choices") or []
    if not _validate_choices(choices):
        return jsonify({"error": "choix invalides"}), 400
    p = get_participant(code)
    if not p or p["stage"] != "tariff_hypo_water":
        return jsonify({"error": "étape inattendue"}), 409
    volume = _annual_volume_from_estimate(p, "eau")
    results, _ = _score_tariff_choices(CORE["tariffs"]["eau"], volume, choices)
    participant, err = _advance(code, "tariff_hypo_water", "behavior_current",
                                 {"tariff_hypo_water_json": json.dumps({"results": results}, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/behavior_current", methods=["POST"])
def api_behavior_current():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    answers = payload.get("answers") or {}

    bc = CORE["behavior_current"]
    pct_eau = 0
    for item in bc["items"]:
        level = answers.get(item["key"])
        if level in bc["scale"]:
            fraction = bc["scale_fraction"][bc["scale"].index(level)]
            pct_eau += item["max_pct"] * fraction

    participant, err = _advance(
        code, "behavior_current", "behavior_adopt",
        {
            "behavior_current_json": json.dumps(answers, ensure_ascii=False),
            "est_pct_eau": pct_eau,
        },
    )
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/behavior_adopt", methods=["POST"])
def api_behavior_adopt():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    choices = payload.get("choices") or {}  # {item_key: level_index}

    items = CORE["behavior_adopt"]["items"]
    pct_elec = 0
    for item in items:
        idx = choices.get(item["key"])
        if idx is None:
            continue
        pct_elec += item["scale"][int(idx)]["max_pct"]

    participant, err = _advance(
        code, "behavior_adopt", "recap",
        {
            "behavior_adopt_json": json.dumps({"choices": choices}, ensure_ascii=False),
            "est_pct_elec": pct_elec,
        },
    )
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/recap_ack", methods=["POST"])
def api_recap_ack():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    participant, err = _advance(code, "recap", "tariff_real_elec", {})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/tariff_real_elec", methods=["POST"])
def api_tariff_real_elec():
    payload = request.get_json(force=True) or {}
    code, choices = payload.get("code", "").strip(), payload.get("choices") or []
    if not _validate_choices(choices):
        return jsonify({"error": "choix invalides"}), 400
    p = get_participant(code)
    if not p or p["stage"] != "tariff_real_elec":
        return jsonify({"error": "étape inattendue"}), 409
    volume = _annual_volume_from_estimate(p, "electricite", reduced=True)
    results, _ = _score_tariff_choices(CORE["tariffs"]["electricite"], volume, choices)
    participant, err = _advance(code, "tariff_real_elec", "tariff_real_water",
                                 {"tariff_real_elec_json": json.dumps({"results": results, "annual_volume": round(volume, 1)}, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/tariff_real_water", methods=["POST"])
def api_tariff_real_water():
    payload = request.get_json(force=True) or {}
    code, choices = payload.get("code", "").strip(), payload.get("choices") or []
    if not _validate_choices(choices):
        return jsonify({"error": "choix invalides"}), 400
    p = get_participant(code)
    if not p or p["stage"] != "tariff_real_water":
        return jsonify({"error": "étape inattendue"}), 409
    volume = _annual_volume_from_estimate(p, "eau", reduced=True)
    results, n_correct_water = _score_tariff_choices(CORE["tariffs"]["eau"], volume, choices)
    n_correct_elec = sum(1 for r in p["tariff_real_elec_json"]["results"] if r["is_correct"])
    total_correct = n_correct_elec + n_correct_water

    participant, err = _advance(
        code, "tariff_real_water", "preferences",
        {
            "tariff_real_water_json": json.dumps({"results": results, "annual_volume": round(volume, 1)}, ensure_ascii=False),
            "n_correct_tariff": total_correct,
            "bonus_eur": total_correct * CORE["recap_phase3"]["bonus_correct_eur"],
        },
    )
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/preferences", methods=["POST"])
def api_preferences():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    data = payload.get("data") or {}
    participant, err = _advance(code, "preferences", "demographics",
                                 {"preferences_json": json.dumps(data, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/demographics", methods=["POST"])
def api_demographics():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    data = payload.get("data") or {}
    participant, err = _advance(code, "demographics", "crt",
                                 {"demographics_json": json.dumps(data, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/crt", methods=["POST"])
def api_crt():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    answers = payload.get("answers") or {}
    participant, err = _advance(code, "crt", "crt_check",
                                 {"crt_json": json.dumps(answers, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/crt_check", methods=["POST"])
def api_crt_check():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    seen = payload.get("seen") or {}
    participant, err = _advance(code, "crt_check", "lottery",
                                 {"crt_check_json": json.dumps(seen, ensure_ascii=False)})
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


@app.route("/api/lottery", methods=["POST"])
def api_lottery():
    payload = request.get_json(force=True) or {}
    code = payload.get("code", "").strip()
    choice_index = payload.get("choice_index")
    options = CORE["lottery_task"]["options"]
    if not isinstance(choice_index, int) or not (0 <= choice_index < len(options)):
        return jsonify({"error": "choix de loterie invalide"}), 400

    p = get_participant(code)
    if not p or p["stage"] != "lottery":
        return jsonify({"error": "étape inattendue"}), 409

    chosen = options[choice_index]
    win_high = random.random() < 0.5
    lottery_gain = chosen["high"] if win_high else chosen["low"]

    base_gain = CORE["final_gain"]["base_gain_eur"]
    bonus = p["bonus_eur"] or 0
    total = base_gain + bonus + lottery_gain
    rounded = math.ceil(total * 2) / 2  # round up to nearest 0.50 EUR

    participant, err = _advance(
        code, "lottery", "done",
        {
            "lottery_json": json.dumps({"choice_index": choice_index, "option": chosen}, ensure_ascii=False),
            "lottery_draw_json": json.dumps({"win_high": win_high, "gain_eur": lottery_gain}, ensure_ascii=False),
            "lottery_gain_eur": lottery_gain,
            "base_gain_eur": base_gain,
            "total_gain_eur": round(total, 2),
            "rounded_gain_eur": round(rounded, 2),
            "completed_at": now(),
        },
    )
    if err:
        return jsonify({"error": err[0]}), err[1]
    return jsonify({"participant": participant})


# ---------------------------------------------------------------- admin export

@app.route("/api/admin/export.csv")
def admin_export():
    if not require_admin(request):
        return Response("unauthorized", status=401)
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM participants ORDER BY id").fetchall()
    conn.close()
    buf = StringIO()
    if rows:
        writer = csv.DictWriter(buf, fieldnames=rows[0].keys())
        writer.writeheader()
        for r in rows:
            writer.writerow(dict(r))
    return Response(buf.getvalue(), mimetype="text/csv",
                     headers={"Content-Disposition": "attachment; filename=experiment_export.csv"})


@app.route("/api/admin/participants")
def admin_participants():
    if not require_admin(request):
        return Response("unauthorized", status=401)
    conn = db.get_conn()
    rows = conn.execute("SELECT * FROM participants ORDER BY id DESC").fetchall()
    conn.close()
    return jsonify({"participants": [db.row_to_dict(r) for r in rows]})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=os.environ.get("FLASK_DEBUG") == "1")
