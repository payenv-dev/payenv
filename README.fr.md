# Payenv

> **Un seul environnement de paiement. Plusieurs agrégateurs. Zéro réécriture.**

🇬🇧 [Read in English](README.md) — *la version anglaise fait référence.*

**Statut :** 🌱 Conception — aucune version utilisable pour l'instant. Démarré le **26/09/2026**.
**Licence :** [Apache 2.0](LICENSE) — gratuit pour un usage personnel et commercial, pour toujours.

---

## Le problème

Pour intégrer le paiement, un développeur choisit en général **un** agrégateur
(FedaPay, Kkiapay, CinetPay, Flutterwave, Paystack, Stripe…). Puis la réalité arrive :

- L'agrégateur est **en panne**, et il n'y a pas de plan B.
- Il **ne prend pas en charge un réseau** utilisé par le client (un opérateur mobile
  money, un pays, une devise), alors qu'un autre agrégateur le fait.
- Un autre est **moins cher** ou a un **meilleur taux de succès** sur ce trajet précis.
- On veut **changer de fournisseur**, et on découvre que tout le code parle l'API de
  l'ancien.

Résultat : chaque équipe réécrit la même colle — adaptateurs, fallback, choix
dynamique du fournisseur, normalisation des webhooks, polling de statut, mapping des
erreurs. C'est difficile à bien faire, et une erreur subtile peut **débiter un client
deux fois**.

## L'idée

Payenv est une **bibliothèque open source d'orchestration de paiement** : une API
unique et stable devant plusieurs agrégateurs.

```ts
// Illustratif — l'API n'est pas figée.
const payenv = createPayenv({
  connectors: [fedapay({ secretKey }), kkiapay({ ... }), cinetpay({ ... })],
  routing: fallback({ order: ['fedapay', 'kkiapay', 'cinetpay'] }),
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' },
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22990000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'commande_1234',
});
// → Payenv choisit un connecteur qui gère MTN / BJ / XOF, l'essaie, et bascule
//   sur le suivant uniquement s'il a échoué *avant* tout mouvement d'argent.
```

## Principes

1. **Bibliothèque d'abord.** Payenv tourne *dans votre application*. Aucun service
   hébergé obligatoire, aucun intermédiaire.
2. **Nous ne touchons ni à votre argent ni à vos clés.** Les fonds circulent
   directement entre votre client, l'agrégateur et vous.
3. **La justesse avant l'astuce.** Jamais de double débit. Les états ambigus sont
   résolus, jamais devinés.
4. **Aucun enfermement** — ni chez un fournisseur, ni chez Payenv.
5. **Aucune télémétrie.**
6. **Gratuit pour toujours.** Apache 2.0, gouvernance communautaire.

## Documentation

La documentation détaillée est en anglais, pour toucher un maximum de développeurs :
[Vision](docs/VISION.md) · [Architecture](docs/ARCHITECTURE.md) ·
[Connecteurs](docs/CONNECTORS.md) · [Feuille de route](docs/ROADMAP.md) ·
[Décisions](docs/adr/) · [Contribuer](CONTRIBUTING.md) · [Sécurité](SECURITY.md)

Les contributions en français sont les bienvenues : issues, discussions et traductions.

## Licence

Copyright 2026 The Payenv Authors.
Sous [licence Apache, version 2.0](LICENSE).
