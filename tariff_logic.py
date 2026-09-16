def annual_cost(option, plan, annual_volume):
    """plan is one of 'sans_abonnement', 'avec_abonnement', 'progressif'; option is the
    tariffs.electricite/eau dict from experiment_content.json."""
    p = option[plan]
    if plan == "progressif":
        seuil = p["seuil"]
        if annual_volume <= seuil:
            return annual_volume * p["prix_tranche1"]
        return seuil * p["prix_tranche1"] + (annual_volume - seuil) * p["prix_tranche2"]
    return p["part_fixe"] + p["prix"] * annual_volume


def cheaper_plan(option, plan_a, plan_b, annual_volume):
    cost_a = annual_cost(option, plan_a, annual_volume)
    cost_b = annual_cost(option, plan_b, annual_volume)
    if cost_a < cost_b:
        return "A"
    if cost_b < cost_a:
        return "B"
    return None  # tie: no objectively correct answer
