"""Estimate annual water/electricity consumption from the household survey answers.

program.exe computes this from the same input variables (litres_q1-6, kwh_q1-9 in its
string table) but the arithmetic itself is compiled code, not text, so it could not be
recovered by string extraction. The coefficients below are our own standard-order-of-
magnitude approximation, clearly separate from the real (verbatim) survey questions and
tariff figures. Adjust freely if you have the real formula.
"""

WATER_COEFFICIENTS = {
    "nU_DoucheSm": 60 * 52,       # litres per shower, per week -> per year
    "nU_BainSm": 150 * 52,        # litres per bath, per week -> per year
    "nU_LVMain": 10 * 52,         # litres per hand dish-wash session
    "nU_LVAnc": 18 * 52,          # litres per old dishwasher cycle
    "nU_LVEco": 12 * 52,          # litres per eco dishwasher cycle
    "nU_LLAnc": 60 * 52,          # litres per old washing machine cycle
    "nU_LLEco": 45 * 52,          # litres per eco washing machine cycle
    "nLaveVoitAn": 150,           # litres per car wash, per year
}


def estimate_water_liters_per_year(answers, n_persons):
    total = 0.0
    for key, coeff in WATER_COEFFICIENTS.items():
        total += float(answers.get(key, 0) or 0) * coeff
    # toilet flushes: per person, per day, per year
    total += float(answers.get("nU_ChEauSt", 0) or 0) * 9 * n_persons * 365
    total += float(answers.get("nU_ChEauDo", 0) or 0) * 6 * n_persons * 365
    # garden watering: roughly 20L per 10m^2 per watering session, 8 months (mars-octobre)
    surf_jard = float(answers.get("surf_jard", 0) or 0)
    n_aros = float(answers.get("nArosMois", 0) or 0)
    total += n_aros * 8 * (surf_jard / 10) * 20
    return total


ELEC_BASE_KWH_PER_YEAR = 500  # fridge, lighting, standby, etc.

ELEC_APPLIANCE_COEFFICIENTS = {
    "LVPresent": 200,
    "LLPresent": 200,
    "SLPresent": 300,
    "AspPresent": 20,
    "CongelIndep": 300,
}


def estimate_elec_kwh_per_year(answers, n_persons):
    total = ELEC_BASE_KWH_PER_YEAR
    for key, coeff in ELEC_APPLIANCE_COEFFICIENTS.items():
        if answers.get(key):
            total += coeff
    if answers.get("chaufElect"):
        surface = float(answers.get("surface", 0) or 0)
        total += surface * 100
    if answers.get("ballon"):
        total += n_persons * 400
    total += float(answers.get("nLCD", 0) or 0) * 100
    total += float(answers.get("nPlasma", 0) or 0) * 200
    total += float(answers.get("nOrdBureau", 0) or 0) * 150
    total += float(answers.get("nOrdPort", 0) or 0) * 50
    return total


def estimate_consumption(answers):
    n_persons = float(answers.get("nPersons", 1) or 1)
    water_l = estimate_water_liters_per_year(answers, n_persons)
    elec_kwh = estimate_elec_kwh_per_year(answers, n_persons)

    water_m3 = water_l / 1000
    return {
        "m3_annuel_avg": round(water_m3, 1),
        "m3_annuel_min": round(water_m3 * 0.85, 1),
        "m3_annuel_max": round(water_m3 * 1.15, 1),
        "kwh_annuel_avg": round(elec_kwh, 1),
        "kwh_annuel_min": round(elec_kwh * 0.85, 1),
        "kwh_annuel_max": round(elec_kwh * 1.15, 1),
        "m3_mensuel_avg": round(water_m3 / 12, 2),
        "m3_mensuel_min": round(water_m3 * 0.85 / 12, 2),
        "m3_mensuel_max": round(water_m3 * 1.15 / 12, 2),
        "kwh_mensuel_avg": round(elec_kwh / 12, 1),
        "kwh_mensuel_min": round(elec_kwh * 0.85 / 12, 1),
        "kwh_mensuel_max": round(elec_kwh * 1.15 / 12, 1),
    }
