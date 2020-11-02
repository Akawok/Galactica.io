<?php
//Logs d'authentification bdd
$dbhost = 'YOUR HOST';
$dbname= 'authentification';
$dbuser = 'USERNAME';
$dbpass = 'PASSWORD';
$conn = new PDO("mysql:host=$dbhost;dbname=$dbname", $dbuser, $dbpass);