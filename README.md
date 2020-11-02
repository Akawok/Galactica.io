# Galactica.io

==== EXPLICATION ====

Création d'un jeu multijoueur en pixiJS

- Serveur d'authentification & d'administration sur Apache2.
- Lobby, tchat & Jeu sur serveur NodeJS.
- Grâce à la verification de connection, le token maison s'active et la connection sur le serveur Node s'établie.
- Utilisation de Mysql pour les comptes joueurs et pour le token maison & MongoDB pour les stats joueurs.
- Utilisation de Google Charts pour consulter les statistiques joueur.

- Ce projet est réalisée en Html, Css, JavaScript (POO, Jquery, PixiJS), NodeJS, Php(POO, PDO), Mysql & requêtes Ajax.

Aucune modification ou factorisation n'a été effectué depuis la fin de l'evaluation.

Je souhaite pouvoir comparer l'évolution de mon code à travers le temps.

==== INSTALLATION ====

- Vous aurez besoin d'un systeme LAMP (Apache / Mysql / PhP) pour pouvoir faire fonctionner l'application
    - Apache 2.4
    - PhP 7.2
    - MySql 5.7

- Vous aurez également besoin d'un serveur NodeJS.
    - Node 12.19

- Les redirections se font en localhost sur le port 3000 pour Node, et sur le port 80 pour Apache2. Veuillez vérifier chaques scripts et configurer les redirections selon votre configuration.

- Veuillez vérifier la configuration de MongoDB également.

- Dans le dossier Administrateur partie Apache, vous avez le script pour créer la base de données SQL.

- Pensez à modifier les fichiers de log SQL présent dans le serveur apache et node.

- Les modules nodes sont fournis avec le projet ( Liste dans le package.json)

Amusez vous bien & bonne balade !

NB => DANS LE DOSSIER SCREENSHOT VOUS POUVEZ JETTER UN OEIL AU RENDU DU JEU & DE L'APPLICATION !