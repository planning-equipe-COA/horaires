# Planning COA (ex « Mes Horaires »)

Nom affiché : « Planning COA » (titre, écran d'accueil, manifest). Le préfixe interne `mh_` et le
PRODID `.ics` « Mes Horaires » restent inchangés (réglages et agendas existants).

Appli web statique (installable sur l'écran d'accueil) : un agent dépose le tableau de service
Excel de l'équipe ; le planning est gardé sur le téléphone et affiché dans le **calendrier de
l'appli** (écran principal). L'export `.ics` vers l'agenda du téléphone reste en option.
L'utilisateur échange en français. En ligne : https://planning-equipe-coa.github.io/horaires/
(GitHub Pages, branche `main`, racine) — un `git push` sur `main` met en ligne en ~1 min.

## Fichiers
- `core.js` — logique pure, module UMD : lecture de la grille (`parseMatrix`, `sheetToMatrix`),
  codes par défaut (`DEFAULT_CODES`), événements (`buildEvents`), export (`buildICS`).
- `app.js` — interface (IIFE), réglages dans localStorage (`mh_codes`, `mh_codes_v`, `mh_name`,
  `mh_plan`, `mh_tab`). **`mh_name` = l'utilisateur (« Je suis »)** : choisi seulement à l'accueil ou dans
  Réglages → « 👤 Je suis » (`#meName`). Regarder le planning d'un collègue (`#calAgent`) ne le change JAMAIS
  (avant nov. 2026 il suivait le dernier planning consulté : numéro ou envois risquaient de partir au nom
  d'un collègue). Aucun nom n'est choisi tout seul à l'import.
- `index.html`, `style.css` — UI mobile d'abord, mode sombre. Thème au choix (Réglages → « Affichage » : Auto / Clair /
  Sombre, `mh_theme` → `html[data-theme]`, appliqué par un petit script dans le `<head>` avant le CSS ; Auto = suit
  le téléphone). Les couleurs sombres sont écrites deux fois dans style.css (media query + `[data-theme="dark"]`).
  Carte « Sauvegarde des notes » (ex « Mes notes », renommée : on croyait y écrire les notes ; elles s'écrivent dans
  le détail d'un jour).
  **Pas d'emoji dans l'interface** (choix de l'utilisateur, nov. 2026 : « plus pro ») : icônes au trait en
  `<symbol id="i-…">` en tête de `index.html` (phone, msg, cal, users, user, key, signal, bell, euro, clock, note,
  flag, star, mail, swap, trash, send, lock, alert, clip, share, download, upload, palette, sparkle, edit), utilisées
  par `<svg class="ic"><use href="#i-…"/></svg>` (dans app.js : `ICON('nom')`). Jamais d'icône dans un texte
  posé en `textContent`. Restent volontairement des emoji : les pastilles de couleur des titres de l'agenda
  du téléphone (🟤 Matin…, voir Couleurs) et les menus de couleur (un `<option>` ne peut pas contenir d'icône).
- `manifest.json`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` — ajout à l'écran d'accueil.
- `sw.js` — **ouverture depuis la copie du téléphone** (instantané, même sans réseau). À chaque ouverture
  (et au retour sur l'appli, message `check` envoyé par la page, 60 s mini) il retélécharge tous les `FILES`
  en arrière-plan ; si un seul a changé, toute la copie est remplacée d'un coup et la page affiche le bandeau
  « ✨ Nouvelle version de l'appli · Afficher » (`#updateBar`, recharge). Donc une mise en ligne apparaît à
  l'ouverture suivante (ou en touchant « Afficher »). Tout nouveau fichier de l'appli (ou changement du `?v=`
  des icônes) doit être ajouté à `FILES` ; changer `CACHE` purge l'ancienne copie. Testé en vrai (Chrome +
  serveur local) : copie servie, bandeau après publication, nouvelle version à l'ouverture suivante, hors ligne OK.
- `xlsx.full.min.js` — SheetJS 0.20.3 embarqué (pas de CDN), **chargé seulement au moment d'importer**
  (`ensureXLSX`, préchargé à l'ouverture de la carte d'import) : plus de 1 Mo à analyser à chaque ouverture.
- `team.js` — planning d'équipe partagé (module UMD `TeamSync`) : chiffrement WebCrypto
  (PBKDF2-SHA256 600 000 itérations → AES-GCM) avec le code d'équipe, lecture/écriture GitHub.
- `core.test.js`, `team.test.js` — tests : `node --test core.test.js team.test.js` (avant chaque push).
  Pour l'interface : capturer l'appli à 390 px de large (iframe dans une page d'essai, Chrome sans affichage).
- `exemple-planning.xls` — planning fictif pour essayer.

## Règles
- **Confidentialité** : le fichier Excel est lu dans le navigateur et n'est jamais envoyé (texte sous
  l'import `#importHint` adapté selon que l'agent a rejoint l'équipe ou non).
  Ne jamais ajouter d'analytics ni de vrai planning dans ce dépôt (il est public).
  Seule exception, voulue par l'utilisateur : le **planning d'équipe** (noms + codes par jour, rien
  d'autre), chiffré sur le téléphone, publié dans le dépôt public séparé `planning-equipe-COA/donnees`
  (`planning.enc`). Le code d'équipe n'est jamais stocké en ligne (il est donné de vive voix).
- Planning d'équipe : la clé GitHub (fine-grained, **seulement** le dépôt `donnees`, Contents en
  lecture/écriture) est chiffrée avec le code d'équipe dans `donnees/cle.enc` → tout agent qui a le
  code peut publier, la clé ne peut pas toucher à l'appli. Lecture publique via raw.githubusercontent
  (cache ~5 min) ; écriture via l'API contents avec `sha` (conflit → on relit, on refusionne, une fois).
  **Après chaque import** d'un agent de l'équipe, l'appli compare d'elle-même au planning publié et
  affiche un aperçu (« N cases changent » + « Voir les cases qui changent » : `listChanges` / `renderPublishList`,
  par agent, moi d'abord, date · avant → après, ouvert si ≤ 12 cases ou un seul agent, 300 lignes max) : rien ne part sans « Envoyer à l'équipe » (garde-fou
  demandé par l'utilisateur). Envoi = `mergePlan(planning publié, tableau importé)`. Pas de
  proposition si aucune case ne change ; rappel si le mois a été deviné ; « Annuler l'envoi »
  pendant 2 min (republie le planning d'avant). « Versions précédentes » (carte équipe) : historique
  des commits de `planning.enc` (API publique), aperçu des cases différentes du planning d'équipe
  actuel, puis « Restaurer » (republie cette version entière). Messages de commit **sans nom**
  (« Planning publié / restauré ») : l'auteur reste dans le fichier chiffré.
  Synchro à l'ouverture et au retour sur l'appli (60 s min.) si `mh_team_code` ; jamais pendant un
  import. **Jamais appliquer une publication plus ancienne que `plan.teamAt`** : raw.githubusercontent rend
  l'ancienne version ~5 min après un envoi (bug signalé : modifications envoyées « disparues » à la réouverture). `plan.teamAt` = date de la publication reçue (seule info en clair de l'enveloppe), `teamBy`.
  Si le code ne déchiffre plus (code changé) : il est oublié et l'agent doit saisir le nouveau.
  Lien « Renouveler la clé de publication » masqué (`#teamRenewRow`) sauf si GitHub refuse la clé (`errText` 'cle').
- Ligne d'état de l'onglet Équipe : « Planning d'équipe publié par X le <date de publication> · vérifié … » (formulation
  voulue par l'utilisateur).
- **Alertes d'équipe** (nov. 2026, en haut de l'onglet Planning, `#teamWarn`, `renderTeamAlerts`) :
  - clé de publication qui expire dans 14 jours ou moins (ou expirée). GitHub n'expose PAS au navigateur
    l'en-tête `github-authentication-token-expiration` (absent d'Access-Control-Expose-Headers) : la date est
    donc saisie à la main (configuration / renouvellement : `#teamTokenExp` ; clé déjà en place : « Indiquer /
    Modifier la date » dans la carte équipe → `T.setKeyExpiry`) et gardée chiffrée dans `cle.enc` (`exp`).
    Copie locale `mh_key` { exp, checkedAt }, relue au plus une fois par jour pendant la synchro.
  - planning d'équipe pas vérifié depuis plus de 3 jours (`mh_sync_ok` = dernière lecture réussie chez GitHub,
    même sans nouveauté) ; toucher l'alerte relance la vérification. L'onglet Équipe affiche « vérifié il y a … ».
- Fichiers réels : classeurs **.xlsm** à deux feuilles « MOIS AAAA THEORIQUE » et « MOIS AAAA PLANIFIE »
  (`bestSheet` prend PLANIFIE = planning réel) ; titre « MAI 2027 » en A1, « Tableau de service du
  03/05/2027 au 06/06/2027 », et une ligne « mise à jour » avec une date d'édition : `findContext`
  donne la priorité au mois écrit en lettres et ignore les dates des lignes « mise à jour ».
- **Date « mise à jour » du tableau : RETIRÉE de l'interface** (nov. 2026, choix de l'utilisateur). La case rouge à côté
  de « mise a jour » est une formule =AUJOURDHUI() : ouverte en lecture seule au bureau elle montre le jour du dernier
  enregistrement par le planificateur, mais les fichiers que reçoit l'appli sont toujours des « Copie de… » réenregistrées,
  donc elles portent le jour de la copie (et `wb.Props.ModifiedDate` aussi). Impossible de retrouver la vraie date.
  `findUpdated` reste dans core.js (dates tapées seulement, testé) mais l'appli ne l'affiche plus.
  **Remplacée par une saisie facultative** (demandée, non bloquante) : après chaque import, champ `#updDate` « Date de mise
  à jour du tableau » (encadré bleu bien visible juste sous la zone d'import, au-dessus de « Planning enregistré » ; pas
  « case rouge » : c'est la date qui est en rouge) → `plan.updated` / `plan.changesUpdated` (AAAAMMJJ), publiée avec le planning
  d'équipe (`updated`, `typedUpdated()` au moment de l'envoi ; vide = null) et reçue par les collègues. Affichée : carte
  « Dernier planning modifié le … » (sinon « Le dernier planning a changé ») et en tête du panneau des modifications.
  Si aucune case ne change mais que la date tapée est nouvelle, l'aperçu propose « Envoyer la date à l'équipe » (signalé :
  sinon rien n'était proposé) ; changer la date relance la comparaison (`schedulePublish`).
- Mois : `monthFromText` lit aussi les abréviations suivies d'une année (« DEC 2026 », « NOV 2026 ») ;
  `findContext` remonte jusqu'au titre de la feuille pour le 2e bloc d'agents (sinon rangé au mauvais mois).
  Classeurs à 3 feuilles (« THEORIQUE », « PLANIFIE New TS ROA », « QUATRE Mi Temps ») : `bestSheet`
  garde la plus complète (« QUATRE Mi Temps », confirmé par l'utilisateur). Noms avec suffixes de contrat
  **gardés tels quels** (ils portent le contrat, `contractOf`) : « 1/2 T » = mi-temps, 3 jours travaillés
  par semaine au plus (permutation écartée au-delà) ; « 32 » = 32 h par semaine (au-delà : classée après,
  « au-delà des 32 h du contrat ») ; « 80% » ignoré.
- Format réel : deux blocs d'agents, en-têtes « lu ma … di » puis numéros de jour (05 … 31, 01),
  mois dans un titre « OCTOBRE 2026 » ou le nom de la feuille, colonnes code/remarque à droite.
  Les homonymes dans deux blocs aux mêmes dates deviennent « NOM (2) ».
- Codes : M Matin 6h-14h, S Soir 14h-22h, N Nuit 22h-6h (finit le lendemain), J Journée 7h30-16h30,
  JS Journée de solidarité (libellé « JS », toujours sans horaires), FORM Formation (pastille
  « Form » violette, jour travaillé ; absent du vrai planning, présent dans l'exemple),
  R Repos, Tn Tombée de nuit, RF, RC, RCN, ATT Repos, RECUP Récupération, ABJ Absence justifiée (Autres,
  CODES_VERSION 9), TTV / DEL / F encore inconnus (l'utilisateur se renseigne),
  RECU « Recup » (pastille « Recup » via `abbr`, blanc ; « RECU » se lisait « reçu »), CA/C Congé, EM Enfant malade,
  X affiché « X » tel quel (choix de l'utilisateur : ne pas afficher de motif), rangé dans « Autres ».
- **Tous les codes** vont dans l'agenda, en **journée entière sans horaires** (tout le monde
  connaît les horaires). L'option « Ajouter les horaires » a été retirée à la demande de
  l'utilisateur : l'interface n'expose plus ni horaires ni réglage début/fin. Les horaires restent
  dans `DEFAULT_CODES` (core.js, option `withHours` de `buildEvents`) mais l'appli ne s'en sert pas.
- Couleurs (`color` de chaque code, `COLORS` dans core.js) : marron Matin, jaune Soir, bleu Nuit,
  blanc pour tous les repos, vert pour les congés (CA, C). Apple et Google ignorent la couleur d'un
  événement importé : elle est donc rendue par une pastille emoji en tête du titre (« 🟤 Matin »),
  plus la propriété COLOR. Réglable par code dans « Codes et couleurs ».
  Pastilles sans couleur (J, JS, EM, X, ABJ…) : gris `--chip` éclairci en mode sombre (#4a5a6f) pour rester lisibles.
- Si un changement des valeurs par défaut doit toucher les réglages déjà enregistrés sur les
  téléphones, incrémenter `CODES_VERSION` dans app.js et ajouter la migration dans `loadCodes`.
- Case « Seulement à partir d'aujourd'hui » (cochée par défaut, `mh_from_today`) : n'exporte pas les jours passés.
- Calendrier : `mh_plan` = { agents: { NOM: { AAAAMMJJ: CODE } }, at, file, changes, changesSeen }.
  Toute l'équipe est gardée (pour « Aussi Matin : … » au toucher d'un jour), 400 jours max.
  `mergePlan` : un nouveau tableau remplace toute sa période, le reste est conservé.
  Recalculé depuis `state.planBefore` à chaque réglage du fichier (feuille, mois, codes).
  Import de **plusieurs fichiers d'un coup** (`readFiles`, `<input multiple>`, glisser-déposer) :
  meilleure feuille de chaque fichier, triés par date, combinés par `combineResults` (même nom =
  même agent, le plus récent l'emporte sur un jour commun). Pas de choix de feuille ni de mois en
  multi : avertissement `#multiWarn` si un mois a été deviné (importer ce fichier seul pour régler).
  Compte rendu par fichier (`renderImportReport`, `#importReport`) : période lue, nb d'agents, mois
  deviné, nom de l'utilisateur trouvé / écrit autrement / absent, fichiers non reconnus.
  Tous les codes s'affichent dans le calendrier, même décochés (la case ne vaut que pour l'export).
  À l'ouverture : mois en cours s'il a des jours, sinon le prochain mois rempli.
  Sans planning sur le téléphone, le calendrier s'affiche quand même, vide (`EMPTY_PLAN` via
  `planView()`) : grille, liste, notes et résumé à zéro ; menu des agents masqué.
  Résumé du mois sous le calendrier (`monthSummary`, `dayKind`) : jours travaillés = codes à
  horaires (M, S, N, J) + JS + FORM ; repos = pastille blanche (R, Tn, RF, RC, RCN, RECUP, RECU, ATT) ;
  congés = pastille verte (CA, C) ; autres = le reste (EM, X, codes inconnus).
  Résumé « Ce mois / Année » (`mh_sum`) + ligne « Travaillés en majoration » : dimanches, fériés
  (`frenchHolidays`, Pâques calculée) et nuits travaillés, comptés le jour où le service commence.
  En haut : « Aujourd'hui / Demain » pour `mh_name` (toucher = aller au jour). Rappel à partir du 20
  si le mois suivant manque. Détail d'un jour (grille ou liste dépliée) : férié, équipe du jour
  groupée par code (`teamOfDay`), « 🔁 Permutations possibles » si l'agent travaille ce jour (pas pour les
  jours passés) : `swapOptions` → une liste classée de la meilleure à la moins intéressante (`score`) :
  même jour (collègue sur un autre horaire) ou deux jours (collègue en repos prend mon service, je prends
  le sien un jour où il travaille et où je suis en repos, ±31 j, jamais avant aujourd'hui, 3 dates max par
  collègue). Règles de l'utilisateur : **9 h de repos minimum** (en dessous : écarté) mais « si on peut
  éviter » → repos < 11 h classé après, avec « ⚠️ repos de … seulement » ; 6 jours travaillés d'affilée
  au plus (« Série ATTENTION (6) » sur le vrai tableau : 6 classé après), 3 nuits d'affilée au plus,
  semaine (lun.→dim.) > 48 h classée après (JS/FORM sans horaires = 8 h–17 h). Ensuite : même jour,
  jour rendu proche, même horaire. Règles vérifiées sur 6 vrais mois (oct. 2026 → mai 2027) : repos
  mini 9 h 30 (S→J), 6 jours max, 3 nuits max, après N toujours N ou TN, semaine max 52 h (10 > 48 h).
  Carte « 📏 Règles du planning » retirée à la demande de l'utilisateur (vue par tous) ; `planStats`
  reste dans core.js (testé) pour une analyse ponctuelle.
  6 affichées + « Voir les N autres » ; pour les deux agents ; puis collègues en repos sans jour à rendre, et
  note perso (`mh_notes` = { AAAAMMJJ: texte }, jamais envoyée, même avec le planning d'équipe).
  **Onglets en bas** (nov. 2026) : « Planning » (Aujourd'hui/Demain, calendrier Mois ou Liste `mh_view`,
  détail du jour, résumé), « Équipe » (`renderTeamTable` : agents en lignes, jours en colonnes, noms figés,
  ordre personnalisable, sinon « moi » en premier puis alphabétique ; détail du jour avec toute l'équipe) et
  « Réglages » (Je suis, import, export agenda, partage, code d'équipe, mes notes, codes et couleurs).
  Visibilité 100 % CSS : `body[data-tab]` + attribut `data-tab` des cartes (`data-tab="planning equipe"` pour le
  calendrier) + classes `only-planning` / `only-equipe` dans la carte calendrier. `setTab()`, `goTo('import'|'export')`
  (rappel de fin de mois, accueil, calendrier vide, bandeau des changements). `mh_tab` mémorise Planning ou
  Équipe (jamais Réglages). Pastille `#settingsDot` sur Réglages tant qu'un « Envoyer à l'équipe » attend.
  Barre masquée pendant une saisie (`body:has(…:focus)`). Glisser à gauche/droite change de mois (Mois, Liste).
  Haut du calendrier : titre, « Aujourd'hui » (seulement si on regarde un autre mois/jour), ‹ › ; puis une ligne
  [planning affiché (« · moi »)] [⇄ Comparer…]. « Comparer » (Planning ; non mémorisé) : 2e pastille sous la
  mienne, cadre vert pointillé = l'un travaille pendant que l'autre est en repos (échange possible).
  Vue Équipe : « Surligner : » + pastilles des codes du mois (`state.cal.hl`) → les autres cases s'estompent et
  une ligne « Total » compte ce code par jour.
  Détail du jour compact (onglet Planning, grille ou liste) : « Avec toi : … » (même service), « 👥 Toute l'équipe
  ce jour-là (N) » replié, permutations repliées, « 📝 Ajouter une note » (le champ n'apparaît qu'au toucher ou
  s'il y a déjà une note). Onglet Équipe : toute l'équipe dépliée, pas de note.
  Le détail du jour (vue Mois, vue Équipe, cartes Aujourd'hui/Demain) s'ouvre dans un **panneau depuis le bas**
  (`#daySheet`, `openDay` / `closeDay`, `state.dayOpen`) : fond, ✕, Échap ou glisser vers le bas pour fermer ;
  fermé au changement de mois ou d'onglet. La vue Liste garde son détail déplié dans la liste.
  Vue Équipe, lignes : seulement les agents qui ont un code dans le mois (sauf moi). Un même nom écrit autrement
  d'un tableau à l'autre (« BLANCKAERT » / « BLANCKAERT 1/2 T (2) » ; le tableau d'octobre finit le 1er novembre)
  est fusionné en une ligne s'ils n'ont aucun jour en commun dans le mois (vrais homonymes, ex. ANDRIEU 32 /
  ANDRIEU 1/2 T, gardés séparés car ils se chevauchent). Fusion d'affichage seulement : le planning garde les deux noms.
  Vue Équipe : **une seule barre de défilement vertical (la page)**. Le corps du tableau (`.tt-wrap`) ne défile
  qu'horizontalement ; l'en-tête des dates est un tableau à part (`.tt-head`, `position: sticky` en haut de l'écran),
  colonnes identiques (`<colgroup>` 8,6 em + 2,3 em par jour, `table-layout: fixed`), défilement horizontal
  synchronisé dans les deux sens. (Avant : cadre à défilement vertical propre → deux « ascenseurs », signalé.)
  Option « Cases colorées » (Réglages → carte « Affichage du calendrier », séparée de « Codes et couleurs » à la demande de l'utilisateur, `mh_cal_style` = 'tint', classe `body.tint-cells`) :
  case du jour teintée par service, repos sans couleur ; « Pastilles » reste l'affichage par défaut (choix de l'utilisateur :
  plus parlant en mode clair, proposé au choix de chacun).
  Permutations : bouton « ✉️ Proposer » (seulement sur mon propre planning) → message déjà rédigé
  (`swapMessage`) : SMS au numéro partagé (`sms:NUM?&body=`, iPhone et Android), sinon feuille de partage,
  sinon copie.
  Heures théoriques (`codeMinutes`, `monthHours`) : durée des horaires du code (sans pause, nuit à
  cheval), `hours` pour JS et Formation (7 h) ; total du mois + semaines ISO, total de l'année.
  Commentaires de cases Excel (`cell.c` → `matrix.notes` → `entry.note`) gardés dans
  `plan.remarks` { NOM: { AAAAMMJJ: texte } } (fusionnés comme les codes, publiés avec le planning
  d'équipe), signalés partout : message après import (« 💬 N commentaires lus »), 💬 sur la case
  (Mois, Équipe), texte sous la ligne (Liste) et dans « Aujourd'hui / Demain », détail du jour.
  Accueil au premier lancement (`mh_welcome`, `mh_name_ok`) : récupérer le planning (champ code
  d'équipe + « 📋 Coller » + « Rejoindre », ou import), puis choisir son nom ; jamais montré à qui
  avait déjà planning + nom.
  iPhone : l'icône d'écran d'accueil a un stockage séparé de Safari (code, planning, notes perdus à
  l'ajout — impossible à contourner). Dans Safari (`isIOS && !isStandalone`), la carte équipe propose
  « 📋 Copier le code pour l'écran d'accueil » ; l'accueil de l'icône le recolle en un geste.
- **Modifications du dernier planning** (nov. 2026, demandé : « pas d'endroit qui dise clairement les modifications ») :
  lien `#teamChangesBtn` sous le haut du calendrier (onglets Planning et Équipe) → panneau `#changesSheet`
  (`openChanges`, `changeGroupsHTML` partagé avec l'aperçu d'envoi) : toute l'équipe, moi d'abord, date · ancien → nouveau,
  jours passés en gris, « Planning importé / reçu de l'équipe le … comparé au précédent ». Reste visible après « J'ai vu »,
  jusqu'au planning suivant qui change quelque chose (`applyAgents` garde `changes` si le nouveau ne change rien,
  ex. recevoir la version qu'on vient d'envoyer ; `changesAt`, `changesFrom`). Le bandeau 🔔 a « Voir toutes les modifications »
  (bouton plein). Le lien est une **carte bien visible** (« Le dernier planning a changé · N cases modifiées » + bouton « Voir › »,
  fond orange tant que pas vu) : en simple lien on ne voyait pas où toucher (signalé). Masquée sur Planning quand le bandeau est là (`.dup`).
- Jours modifiés : à chaque import, `diffSnapshot` compare chaque agent à son planning précédent ;
  bandeau « 🔔 » + point orange sur les cases jusqu'à « J'ai vu » (`changesSeen`), repris dans
  l'export. L'ancien suivi par export (`mh_snap`) n'est plus écrit ; il sert une fois de point de
  départ à `mh_plan`.
- Export : case « Rappel la veille à 20 h » (`mh_alarm`, cochée par défaut) → VALARM sur les jours
  travaillés. Apple le garde à l'import ; Google Agenda ignore les alarmes importées.
  Pas de notifications web (iPhone : impossible sans serveur).
- Onglet Réglages, dans l'ordre : « 👤 Je suis », import, export, « 📲 Partager l'application », « 🔑 Code d'équipe »
  (ordre voulu), « 📝 Mes notes », « 🎨 Codes et couleurs ». Cartes dépliantes `<details class="fold">` avec une
  flèche à droite (`summary::after`, marqueur natif masqué). Import ouvert tant qu'il n'y a aucun planning et dès
  qu'un fichier est lu (aperçu + « Envoyer à l'équipe » y sont) ; replié à l'ouverture sinon ; après l'import,
  « 📅 Voir le planning » (et retour automatique sur Planning si l'accueil attend « Qui es-tu ? »). Titre de
  l'import : « Importer un nouveau planning » (verbe voulu : « Nouveau planning » seul faisait croire qu'un
  planning attendait là).
- **Export agenda** (`renderPreview`, appelé par `renderCalendar`) : toujours disponible dès qu'un planning est
  sur le téléphone (importé OU reçu de l'équipe), pour `mh_name` (sinon le planning affiché). Avant nov. 2026 il
  n'existait qu'après un import dans la même session et pouvait prendre le premier agent de la liste.
- **Mes notes** : sauvegarde dans un fichier JSON (`{ app: 'planning-coa', type: 'notes', v: 1, notes }`, feuille
  de partage sur téléphone, sinon téléchargement) et restauration (fusion : les jours sans note sont remplis, une
  note différente déjà présente est gardée). `navigator.storage.persist()` demandé à la 1re note (pas au
  lancement : Firefox afficherait une question).
- **Ordre des noms (vue Équipe)** : bouton « ↕︎ Réorganiser les noms » → liste avec poignée ☰ à gauche
  (glisser-déposer au doigt, Pointer Events, défilement auto près des bords), « Terminé »
  (enregistre), « Par défaut » (toi en premier puis alphabétique), « Annuler ». `teamOrder`,
  `renderReorder`, `saveOrder`. **Ne jamais écrire de vrais noms dans ce code public** : l'ordre vit
  dans `mh_roles.order` (noms complets) et part chiffré avec le planning d'équipe (`roles`, le plus
  récent l'emporte ; commit « Ordre mis à jour »). Nouveaux agents ajoutés à la fin (alphabétique).
  **Noms affichés** : sans surnom, la mention de contrat quitte le nom et devient un badge (`C.splitName` :
  « NOEL 1/2 T (1) » → NOEL ½, « TESSIER 32 80% » → TESSIER 32h ; `nameTable`, `shown`, `nameHTML`, `tagsHTML`,
  `nameText` pour les menus) ; si deux agents ont alors le même nom (ex. « ANDRIEU 32 » / « ANDRIEU 1/2 T (1) »),
  leurs noms complets sont gardés. Le contrat des règles (`contractOf`) lit toujours le nom complet.
  Surnom : ✏️ dans « Réorganiser les noms » (`aliasDraft`, champ prérempli avec le surnom ou le nom complet) →
  `mh_roles.alias` { nom du tableau: nom affiché }, envoyé chiffré avec `roles` ; les clés du planning restent les
  noms du tableau (« NOM (2) ») ; vide, nom d'origine ou nom court automatique = retiré. Demandé pour distinguer
  deux homonymes. `loadRoles` est mis en mémoire (`rolesCache`, mis à jour par `saveRoles`).
  Menus de noms toujours alphabétiques (sur le nom affiché). Retirés à la demande de l'utilisateur : carte « Rôles des
  agents » (ROA/COA) puis « toucher un nom = fin de liste » (`mh_roles.np` encore lu par défaut).
- **Numéros de téléphone (volontaires)** : carte équipe → « 📞 Mon numéro » (pour `mh_name`), Partager /
  Retirer. Stockés dans le planning d'équipe chiffré (`contacts` { NOM: { tel, at } }, commit
  « Coordonnées mises à jour »), copie locale `mh_contacts` (vidée en quittant l'équipe). **Toute
  publication doit reporter `contacts` du planning actuel** (envoi, annuler, restaurer, ordre), sinon
  les numéros sont perdus. Affichés en liens tel:/sms: dans « Équipe du jour » et « Pour un échange »
  (`nameWithPhone`). Limites dites à l'utilisateur : visibles par tous ceux qui ont le code, restent
  dans l'historique chiffré. Rotation automatique du code écartée (sans intérêt) : changer le code
  quand quelqu'un quitte l'équipe.
- **Numéros utiles (opérationnels uniquement)** : icône 📞 en haut à droite (`#utilesBtn`, visible une fois
  l'équipe rejointe) → panneau depuis le bas (`#utilesSheet`) : service + numéro, Appeler / SMS.
  Cadenas visible **seulement sur le téléphone du responsable** (`mh_admin` = '1' après une saisie
  réussie du code) ; ailleurs, appui long de 2 s sur l'icône 📞 (ou sur le titre du panneau) l'ouvre avec
  le cadenas (pas de sélection de texte iPhone : `-webkit-touch-callout: none`).
  **Seul le responsable modifie** : « 🔒 Modifier (responsable) » demande le code responsable (≥ 3 mots,
  différent du code d'équipe), défini la 1re fois ; seule son empreinte PBKDF2 est gardée
  (`TeamSync.hashSecret/checkSecret`, champ `admin`). Verrou applicatif (pas cryptographique), dit à
  l'utilisateur. **Plusieurs numéros par service** (demandé) : `{ label, tels:[{tel, note}], tel }` (`tel` = 1er numéro, lu par
  les anciennes versions ; `telsOf` relit l'ancien format), « + Autre numéro », précision facultative ; liste toujours **triée par
  ordre alphabétique** des services (`byLabel`, affichage et enregistrement). Liste dans le planning chiffré (`utiles` { list, at }, commit « Numéros
  utiles mis à jour »), copie locale `mh_utiles`. **Toute publication doit reporter `utiles` et
  `admin`** via `keepShared(current)`. Pas de numéros de collègues dans ce panneau (choix de l'utilisateur).
- **Imprimer / PDF** (nov. 2026) : bouton imprimante en haut à droite, à côté de 📞 (`#calPrint`, onglets Planning et
  Équipe, dès qu'un planning est sur le téléphone ; pas dans l'en-tête du calendrier : le mois y était tronqué à 360 px) → panneau `#printSheet` : Quoi = « Mon planning » (**seulement `mh_name`**, demandé par l'utilisateur ;
  désactivé sans « Je suis »), « Le planning de l'équipe » ou « Les deux » (défaut selon l'onglet) ; Période = mois
  affiché ou « Du … au … » (3 mois max). `doPrint` fabrique les pages dans `#printArea` (enfant direct de `body`) puis
  `window.print()` ; `body.printing` + `@media print` n'impriment que cette zone ; `afterprint` la vide. Une page par
  mois : mon planning en A4 portrait (grille lun→dim, code + libellé, férié, commentaires, résumé, légende), l'équipe
  en A4 paysage (`@page team`, lignes = `teamRowsFor`, partagé avec la vue Équipe). Mois sans aucun code : pas de page.
  PDF = fenêtre d'impression du téléphone (Android « Enregistrer au format PDF », iPhone Partager → Fichiers).
  Couleurs forcées (`print-color-adjust: exact`), thème clair imposé dans `#printArea`.
- Écarté par l'utilisateur : « Partager → Planning COA » sur Android.
- UID `.ics` stable par jour et par agent : réimporter met à jour au lieu de dupliquer.
