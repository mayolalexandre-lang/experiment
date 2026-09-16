# Expérience en ligne — Tarification eau et électricité

Réplique web de l'expérience de laboratoire (Sorbonne / École d'économie de Paris, logiciel LEEP de
Maxim Frolov). La quasi-totalité du texte et des paramètres ci-dessous vient de **chaînes de caractères
en clair trouvées directement dans `program.exe`** (le moteur LEEP construit ses écrans à partir d'un
petit DSL — `qu:`/`typelist:`/`linelist:`/`plist:` — stocké tel quel dans le binaire) et du dossier
`slides/` (gabarits `slideXd_temp.htm` avec les valeurs déjà substituées). Séquence des blocs, confirmée
dans l'exe : `Intro, QuestSelectEchant, EauElect, ConsoInfo, Choix, ChangeComportDeja,
ChangeComportSuite, EcoInfo, QuestPrefEauElect, QuestSocioEco, CRT_visual, CRT_check, Lots50_50,
FinalGain` — c'est l'ordre reproduit ici.

Stack : Python + Flask, base SQLite (`data/experiment.db`), frontend JavaScript natif. Bilingue
FR/EN (choix de langue au tout premier écran) — voir `data/experiment_content.json`, structuré en
`{"language_picker", "fr": {...}, "en": {...}}`. Les valeurs numériques (prix, seuils, barèmes de %,
gains de loterie) sont identiques dans les deux langues ; seuls les textes diffèrent. La version
anglaise est une traduction de travail, pas une rétro-traduction validée académiquement.

## Déroulé (19 écrans)

0. **Langue** — français ou anglais, au tout premier écran
1. **Consentement** — texte exact (bloc Intro)
2. **Éligibilité** — locataire/propriétaire, maison/appartement (texte exact)
3. **Questionnaire logement** — 25 questions sur les équipements (texte exact, bloc ConsoInfo), avec
   photo pour la double chasse d'eau (`doublechasse.png`, retrouvée dans `slides/`)
4. **Estimation de consommation** — calculée à partir des réponses (texte exact, chiffres en gras,
   formule approximative — voir plus bas)
5. **Choix hypothétiques — page d'intro** (nouvel écran dédié, séparé du premier choix) — titre et texte exacts
6. **Choix hypothétiques électricité** (3 décisions, une par écran, options A/B côte à côte en deux
   colonnes) — bannière "Ce choix ne va pas influencer votre gain" ; instructions, exemple de tarif
   progressif et rappel de consommation disponibles en accordéon ; icônes réelles (calendrier $ barré
   = pas d'abonnement, prise $ pour l'électricité, `dollar_goute.gif` pour l'eau) ; libellés "1ère
   tranche"/"2ème tranche" pour le tarif progressif
7. **Choix hypothétiques eau** (3 décisions, même présentation)
8. **Je change de comportement — habitudes actuelles** (3 items avec icônes réelles, échelle à 4
   niveaux, texte exact)
9. **Je change de comportement — engagements futurs** (3 items avec icônes réelles, % de réduction par
   niveau — association item/barème reconstituée par recoupement, voir note dans `experiment_content.json`)
10. **Phase 3** — récapitulatif personnalisé, phrase d'instruction ("Partant de cette situation...")
    puis deux bulles côte à côte (verte = tarif avantageux +1€, rouge = tarif désavantageux +0€)
11. **Choix réels électricité** (3 décisions) — bannière orange "Attention...", **rappel visible en
    permanence du % d'économie potentielle** pour ce poste (pas caché dans un accordéon), plus les
    mêmes accordéons d'aide qu'en hypothétique
12. **Choix réels eau** (3 décisions)
13. **Votre avis** — 14 questions d'échelle 1-5 (texte exact, bloc QuestPrefEauElect)
14. **Démographie** — 9 questions (texte exact, bloc QuestSocioEco)
15. **3 énigmes CRT** (Frederick 2005 ; l'exe affiche 1,10€/1,00€ pour la question de la balle, alors
    que les slides utilisaient 11€/10€ à l'oral — les deux sont réels, l'exe l'emporte ici car c'est ce
    que voit l'écran)
16. **Vérification CRT** — avez-vous déjà vu ces questions ?
17. **Choix de loterie** — 6 loteries à gains réels 50/50, chacune illustrée par un petit "camembert"
    (reprend le principe de roue de probabilité du moteur original), payée par tirage au sort
18. **Écran de gain final** — gain de base + prime + gain de loterie, arrondi aux 50 centimes
    supérieurs (texte et règle d'arrondi exacts)

## Ce qui reste une approximation (documenté et isolé, pas mélangé au contenu réel)

- **La formule convertissant les 25 réponses du questionnaire logement en litres/kWh** (`consumption_logic.py`) : les variables intermédiaires (`litres_q1-6`, `kwh_q1-9`) existent bien dans l'exe, mais l'arithmétique elle-même est du code compilé, pas du texte — impossible à extraire par recherche de chaînes. Les coefficients utilisés sont des ordres de grandeur standards, clairement isolés dans ce fichier.
- **L'association exacte item ↔ barème de %** dans l'écran 9 (ChangeComportSuite) : reconstituée par l'ordre des chaînes dans le binaire, pas par un fragment univoque.
- **La phrase "Partant de cette situation, nous allons vous proposer des couples de tarifs..."** (écran 10) : fournie directement par l'enseignant, absente de l'exe — ajout assumé, pas une découverte.
- Tout le reste (textes, montants, barèmes tarifaires, gains de loterie, énigmes CRT, questionnaire démographique, mécanisme de prime, règle d'arrondi, icônes) est repris mot pour mot / image pour image / valeur pour valeur depuis `program.exe` et `slides/`.

## 1. Lancer en local (pour tester)

```bash
cd webapp
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Ouvrez http://localhost:5000. Administration : http://localhost:5000/admin (jeton par défaut
`changeme`, à changer via `ADMIN_TOKEN`).

## 2. Déployer sur le VPS

### Option A — Docker

```bash
curl -fsSL https://get.docker.com | sh
cd /opt && git clone <votre-dépôt-ou-copiez-le-dossier-webapp> experiment
cd experiment
echo "ADMIN_TOKEN=choisissez-un-jeton-solide" > .env
docker compose up -d --build
```

Reverse proxy HTTPS avec Caddy :

```
experience.votre-domaine.fr {
    reverse_proxy 127.0.0.1:5000
}
```

### Option B — Sans Docker (Python + systemd + Nginx)

```bash
sudo apt update && sudo apt install -y python3-venv nginx
sudo mkdir -p /opt/experiment && sudo chown $USER /opt/experiment
# copiez le dossier webapp/ dans /opt/experiment
cd /opt/experiment
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

`/etc/systemd/system/experiment.service` :

```ini
[Unit]
Description=Experience tarification eau/electricite
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/experiment
Environment=ADMIN_TOKEN=choisissez-un-jeton-solide
ExecStart=/opt/experiment/.venv/bin/gunicorn --bind 127.0.0.1:5000 --workers 2 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now experiment
```

Puis bloc Nginx + certbot comme d'habitude.

## 3. Faire jouer les étudiants

Code participant unique (ex. `ETU-01`) + l'URL. En cas de déconnexion, le même code reprend
exactement à l'étape où l'étudiant s'était arrêté (état sauvegardé côté serveur à chaque écran).

## 4. Récupérer les données

`/admin` (protégé par `ADMIN_TOKEN`) : liste des participants + export CSV complet (toutes les
réponses, tous les écrans, gains détaillés).
