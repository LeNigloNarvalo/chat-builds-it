// Centre d'aide : FAQ cherchable, guides pas à pas, visite guidée du premier lancement, raccourcis clavier et palette de commandes (Ctrl+K).
// L'état de la visite et la dernière recherche sont propres à chaque appareil (clé « app.help ») ; les demandes au support vivent sur le serveur.
(function (root) {
  const KEY = 'app.help';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const FAQ = [
    ['Compte', 'Comment créer un compte ?', 'Sur l’écran d’accueil, choisissez un pseudo et un mot de passe puis « S’inscrire ». Aucune information personnelle n’est demandée ; le mot de passe est stocké haché avec un sel, jamais en clair.'],
    ['Compte', 'J’ai oublié mon mot de passe', 'Cliquez sur « Mot de passe oublié » à la connexion : si votre compte a un e-mail vérifié, un lien à usage unique valable 30 minutes vous est envoyé. Sinon, ouvrez une demande au support.'],
    ['Compte', 'Comment sécuriser mon compte ?', 'Dans Plus › Sécurité, activez la double authentification (appli TOTP) ou ajoutez une clé d’accès (empreinte, Face ID). Gardez vos codes de secours.'],
    ['Compte', 'Comment supprimer mon compte ?', 'Plus › Confidentialité › Supprimer mon compte. Un délai de grâce permet d’annuler la suppression.'],
    ['Posts', 'Comment publier un post ?', 'Depuis « Mon fil », saisissez votre texte et cliquez sur Publier. Utilisez #hashtag pour les sujets et @pseudo pour mentionner quelqu’un.'],
    ['Posts', 'Puis-je modifier ou supprimer un post ?', 'Oui : les boutons « Modifier » et « Supprimer » apparaissent sur vos posts. Les modifications gardent un historique consultable.'],
    ['Posts', 'Comment épingler un post ou masquer un contenu sensible ?', 'Sur votre propre post, utilisez « Épingler » pour le fixer en haut du profil, ou « Avertissement » pour le masquer derrière un avertissement.'],
    ['Posts', 'Comment programmer un brouillon ?', 'Enregistrez un brouillon puis planifiez sa date de publication depuis la page Brouillons.'],
    ['Messages', 'Comment envoyer un message privé ?', 'Ouvrez le profil d’une personne puis « Message », ou la page Messages. Vous pouvez joindre un message vocal ou une vidéo.'],
    ['Messages', 'Comment créer une conversation de groupe ?', 'Dans Messages, « Nouveau groupe privé » : nommez-le et ajoutez des membres. Les administrateurs du groupe peuvent ajouter, retirer ou rendre muet.'],
    ['Communauté', 'Comment bloquer ou masquer quelqu’un ?', 'Sur son profil, « Bloquer » coupe toute interaction, « Masquer » retire ses posts de votre fil sans l’en informer.'],
    ['Communauté', 'Comment signaler un contenu ?', 'Le bouton « Signaler » d’un post envoie le contenu aux modérateurs. Si votre propre contenu est masqué, vous pouvez faire appel (Modération et appels).'],
    ['Communauté', 'À quoi servent les badges ?', 'Le badge ✅ indique un profil vérifié par la modération, d’autres badges signalent l’ancienneté ou le rôle de modérateur.'],
    ['Affichage', 'Comment passer en mode sombre ou clair ?', 'Le bouton 🌓 de l’en-tête (ou Ctrl+K › « Thème ») bascule auto → sombre → clair. Ce réglage est propre à chaque appareil : il ne change rien chez les autres.'],
    ['Affichage', 'Comment agrandir le texte ?', 'Plus › Réglages › taille du texte (A− / A / A+), de 85 % à 150 %, mémorisée sur cet appareil.'],
    ['Affichage', 'Comment changer de langue ?', 'Plus › Réglages › Langue : français, anglais ou espagnol, ou automatique selon le navigateur.'],
    ['Aide', 'Comment relancer la visite guidée ?', 'Dans le centre d’aide, bouton « Relancer la visite guidée », ou Ctrl+K › « Visite guidée ».'],
    ['Aide', 'Comment suivre ma demande au support ?', 'Dans Aide › Support, chaque demande a un statut (ouverte, répondue, clôturée) et un fil d’échanges. Une réponse de l’équipe passe la demande en « répondue ».'],
  ];
  const GUIDES = [
    ['publier', '✍️ Publier un post', ['Allez sur « Mon fil ».', 'Écrivez votre texte (ajoutez #hashtags et @mentions).', 'Joignez au besoin une image, une vidéo ou un sondage.', 'Cliquez sur Publier : le post apparaît tout de suite en haut du fil.']],
    ['suivre', '👥 Suivre des gens et lire son fil', ['Ouvrez « Explorer » pour voir les posts publics.', 'Cliquez sur un pseudo pour ouvrir son profil.', 'Cliquez sur « Suivre » : ses posts arrivent dans « Mon fil ».', 'Les listes (Plus › Listes) permettent de regrouper des comptes.']],
    ['messages', '✉️ Écrire en privé', ['Ouvrez « Messages ».', 'Choisissez une personne ou créez un groupe privé.', 'Écrivez, ou maintenez le micro pour un message vocal.', 'Les pastilles « nouveau » signalent les messages non lus.']],
    ['securite', '🔐 Sécuriser son compte', ['Ouvrez Plus › Sécurité.', 'Activez la double authentification et scannez le QR code.', 'Notez vos codes de secours en lieu sûr.', 'Ajoutez éventuellement une clé d’accès pour vous connecter sans mot de passe.']],
    ['theme', '🎨 Personnaliser l’affichage', ['Basculez sombre / clair avec 🌓 dans l’en-tête : réglage propre à l’appareil.', 'Plus › Thème : créez un dégradé multicolore.', 'Plus › Réglages : taille du texte et langue.']],
    ['support', '🛟 Contacter le support', ['Ouvrez Aide › Support.', 'Choisissez une catégorie, un sujet et décrivez votre demande.', 'Suivez son statut et répondez dans le fil de la demande.', 'Clôturez-la une fois le problème résolu.']],
  ];
  const SHORTCUTS = [
    ['Ctrl + K', 'Ouvrir la palette de commandes (⌘ + K sur Mac)'], ['?', 'Ouvrir le centre d’aide (hors champ de saisie)'], ['Échap', 'Fermer la palette, la visite ou le menu « Plus »'],
    ['↑ / ↓', 'Naviguer dans les résultats de la palette ou le menu'], ['Entrée', 'Valider la commande sélectionnée'], ['Tab / Maj + Tab', 'Passer d’un élément à l’autre'],
    ['← / →', 'Image précédente / suivante dans la visionneuse'], ['Entrée / Espace', 'Activer un élément cliquable (profil, hashtag…)'],
  ];
  const TOUR = [
    ['👋 Bienvenue sur Agora', 'Une courte visite (6 étapes) pour tout repérer. Vous pouvez la quitter à tout moment avec Échap.', null],
    ['🧭 La navigation', 'La barre du haut donne accès au fil, à l’exploration, aux messages et à « ⋯ Plus » pour le reste.', '#nav'],
    ['🌓 Sombre ou clair', 'Ce bouton bascule le thème de CET appareil : automatique, sombre ou clair.', '[data-themebtn]'],
    ['⌨️ Palette de commandes', 'Appuyez sur Ctrl+K (ou ⌘+K) pour aller n’importe où ou lancer une action en tapant quelques lettres.', null],
    ['❓ Centre d’aide', 'FAQ cherchable, guides pas à pas, raccourcis et support avec suivi : tout est dans « Aide ».', '[data-helpbtn]'],
    ['🎉 C’est parti !', 'Vous pouvez relancer cette visite depuis le centre d’aide. Bon cornichonnage !', null],
  ];
  const load = st => { try { const j = JSON.parse(st.getItem(KEY)) || {}; return { tour: j.tour === 'done' || j.tour === 'skipped' ? j.tour : '', q: typeof j.q === 'string' ? j.q.slice(0, 80) : '' }; } catch (e) { return { tour: '', q: '' }; } };
  const save = (st, patch) => { const v = Object.assign(load(st), patch); st.setItem(KEY, JSON.stringify(v)); return v; };
  // recherche : tous les mots doivent apparaître (sans casse ni accents) dans la question, la réponse ou la rubrique
  const words = q => norm(q).split(/[^a-z0-9]+/).filter(Boolean);
  const search = q => { const w = words(q); if (!w.length) return FAQ.map((f, i) => i); return FAQ.map((f, i) => [i, norm(f.join(' '))]).filter(([i, h]) => w.every(x => h.includes(x))).map(([i]) => i); };
  // commandes de la palette (les actions « run » sont branchées par app.js)
  const COMMANDS = [
    ['go:feed', '🏠 Aller à mon fil', 'accueil fil'], ['go:explore', '🧭 Explorer', 'explorer decouvrir'], ['go:dm', '✉️ Messages', 'messages prive dm'], ['go:notifs', '🔔 Notifications', 'notifications cloche'],
    ['go:profile', '👤 Mon profil', 'profil'], ['go:fts', '⚡ Recherche rapide', 'recherche chercher'], ['go:settings', '⚙️ Réglages', 'reglages parametres langue taille'], ['go:security', '🔐 Sécurité', 'securite mot de passe 2fa'],
    ['go:theme', '🎨 Studio de thème', 'theme degrade couleurs'], ['go:help', '❓ Centre d’aide', 'aide faq help'], ['go:help:support', '🛟 Contacter le support', 'support contact ticket demande'],
    ['go:help:shortcuts', '⌨️ Raccourcis clavier', 'raccourcis clavier touches'], ['theme', '🌓 Basculer sombre / clair', 'theme sombre clair mode dark light'], ['tour', '🧑‍🏫 Visite guidée', 'visite tutoriel guide onboarding'],
  ];
  const filter = q => { const w = words(q); return COMMANDS.filter(c => { const h = norm(c[1] + ' ' + c[2]); return w.every(x => h.includes(x)); }); };
  // thème de l'appareil : auto → sombre → clair → auto
  const nextTheme = cur => ({ auto: 'dark', dark: 'light', light: 'auto' })[cur] || 'auto';
  const ex = { KEY, FAQ, GUIDES, SHORTCUTS, TOUR, COMMANDS, load, save, search, filter, nextTheme, norm };
  if (typeof module !== 'undefined') module.exports = ex; else root.Help = ex;
})(this);
