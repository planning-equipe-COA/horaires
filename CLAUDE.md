# Mes Horaires

Page web statique : un agent dépose le tableau de service Excel de l'équipe, choisit son nom,
et télécharge un fichier `.ics` à importer dans son agenda (Apple, Google, Samsung).
L'utilisateur échange en français. En ligne : https://planning-equipe-coa.github.io/horaires/
(GitHub Pages, branche `main`, racine) — un `git push` sur `main` met en ligne en ~1 min.

## Fichiers
- `core.js` — logique pure, module UMD : lecture de la grille (`parseMatrix`, `sheetToMatrix`),
  codes par défaut (`DEFAULT_CODES`), événements (`buildEvents`), export (`buildICS`).
- `app.js` — interface (IIFE), réglages dans localStorage (`mh_codes`, `mh_codes_v`, `mh_name`, `mh_hours`).
- `index.html`, `style.css` — UI mobile d'abord, mode sombre.
- `xlsx.full.min.js` — SheetJS 0.20.3 embarqué (pas de CDN).
- `core.test.js` — tests : `node --test core.test.js` (à lancer avant chaque push).
- `exemple-planning.xls` — planning fictif pour essayer.

## Règles
- **Confidentialité** : le fichier Excel est lu dans le navigateur, rien n'est envoyé nulle part.
  Ne jamais ajouter d'envoi réseau, d'analytics ni de vrai planning dans le dépôt (il est public).
- Format réel : deux blocs d'agents, en-têtes « lu ma … di » puis numéros de jour (05 … 31, 01),
  mois dans un titre « OCTOBRE 2026 » ou le nom de la feuille, colonnes code/remarque à droite.
  Les homonymes dans deux blocs aux mêmes dates deviennent « NOM (2) ».
- Codes : M Matin 6h-14h, S Soir 14h-22h, N Nuit 22h-6h (finit le lendemain), J Journée 7h30-16h30,
  R Repos, Tn Tombée de nuit, RF, RC, RCN, ATT Repos, RECUP Récupération, CA/C Congé, EM Enfant malade,
  X « Absence » (sens exact à préciser par l'utilisateur).
- Par défaut **tous les codes** vont dans l'agenda, en **journée entière sans horaires**
  (tout le monde connaît les horaires) ; la case « Ajouter les horaires » crée des créneaux.
- Si un changement des valeurs par défaut doit toucher les réglages déjà enregistrés sur les
  téléphones, incrémenter `CODES_VERSION` dans app.js et ajouter la migration dans `loadCodes`.
- UID `.ics` stable par jour et par agent : réimporter met à jour au lieu de dupliquer.
