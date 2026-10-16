# Payenv

> **Un seul environnement de paiement. Plusieurs agrégateurs. Zéro réécriture.**

[![npm @payenv/core](https://img.shields.io/npm/v/@payenv/core?label=%40payenv%2Fcore)](https://www.npmjs.com/package/@payenv/core)
[![CI](https://github.com/payenv-dev/payenv/actions/workflows/ci.yml/badge.svg)](https://github.com/payenv-dev/payenv/actions/workflows/ci.yml)
[![Licence : Apache 2.0](https://img.shields.io/badge/licence-Apache%202.0-blue.svg)](LICENSE)

🇬🇧 [Read in English](README.md) (la version anglaise fait référence)

Payenv est une **bibliothèque TypeScript open source** qui place une API de paiement
unique et stable devant plusieurs agrégateurs (FedaPay, Kkiapay, CinetPay…). Elle envoie
chaque paiement vers un fournisseur qui le prend en charge, et **ne bascule vers un autre
fournisseur que s'il est prouvé qu'aucun argent n'a bougé** : jamais de double débit.

**Statut :** 🌱 Pré-version `0.x`. Elle fonctionne et est publiée sur npm, mais l'API peut
encore changer entre deux versions mineures. Démarrée le 26/09/2026.

---

## Pourquoi

Pour intégrer le paiement, on choisit en général **un** agrégateur. Puis :

- Il est **en panne**, et il n'y a pas de plan B.
- Il **ne gère pas un réseau** utilisé par le client (un opérateur, un pays, une devise),
  alors qu'un autre agrégateur le fait.
- On veut **changer de fournisseur**, et tout le code parle l'API de l'ancien.

Chaque équipe réécrit la même colle : adaptateurs, fallback, suivi des statuts, webhooks,
traduction des erreurs. C'est difficile à bien faire, et une erreur subtile peut **débiter
un client deux fois**. Payenv le fait une fois, en open source, avec des tests.

## Exemple

```ts
import { createPayenv, priority } from '@payenv/core';
import { fedapay } from '@payenv/connector-fedapay';
import { cinetpay } from '@payenv/connector-cinetpay';

const payenv = createPayenv({
  connectors: [
    fedapay({ secretKey: process.env.FEDAPAY_SECRET_KEY! }),
    cinetpay({
      credentials: {
        BJ: {
          apiKey: process.env.CINETPAY_API_KEY_BJ!,
          apiPassword: process.env.CINETPAY_API_PASSWORD_BJ!,
        },
      },
      notifyUrl: (key) => `https://boutique.example/webhooks/cinetpay?key=${key}`,
    }),
  ],
  routing: priority(['fedapay', 'cinetpay']), // FedaPay d'abord, CinetPay en secours
});

const payment = await payenv.collect({
  amount: { value: 5000, currency: 'XOF' }, // entier, dans l'unité mineure de la devise
  method: { type: 'mobile_money', network: 'mtn', country: 'BJ', phone: '+22997000000' },
  customer: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  idempotencyKey: 'commande_1234', // réessayer avec la même clé ne débite jamais deux fois
});

payment.status; // 'pending' : le client confirme sur son téléphone
await payenv.refresh('commande_1234'); // plus tard : demander le dernier statut au fournisseur
```

Si FedaPay est en panne **avant** l'envoi de la demande de paiement, Payenv essaie
CinetPay. Si FedaPay ne répond pas **après** un envoi possible, Payenv demande d'abord à
FedaPay ce qui s'est passé, et ne passe à CinetPay que si FedaPay confirme que rien n'a été
débité.

## Paquets

| Paquet | Rôle | Pays |
|---|---|---|
| [`@payenv/core`](packages/core) | Modèle unifié, routeur, moteur de fallback sûr, stockage en mémoire | — |
| [`@payenv/connector-fedapay`](packages/connector-fedapay) | Paiement mobile money et payouts (MTN, Moov, Celtiis), webhooks signés | 🇧🇯 Bénin |
| [`@payenv/connector-kkiapay`](packages/connector-kkiapay) | Paiements dans le widget Kkiapay, vérifiés côté serveur (MTN, Moov) | 🇧🇯 Bénin |
| [`@payenv/connector-cinetpay`](packages/connector-cinetpay) | Paiement mobile money, page de paiement hébergée, payouts | 🇧🇯 🇧🇫 🇨🇮 🇲🇱 🇳🇪 🇸🇳 🇹🇬 🇨🇲 🇬🇳 |

```sh
npm install @payenv/core @payenv/connector-fedapay
# et/ou @payenv/connector-kkiapay, @payenv/connector-cinetpay
```

Node.js 20.19+, Deno, Bun ou tout environnement avec `fetch` et Web Crypto. ESM et
`require`. Aucune dépendance à l'exécution.

Le connecteur CinetPay est construit à partir du SDK officiel de CinetPay et testé contre
une fausse API ; il n'a pas encore été vérifié dans la sandbox CinetPay (voir son
[QUIRKS.md](packages/connector-cinetpay/QUIRKS.md)). Le [changelog](CHANGELOG.md) indique ce
que contient chaque version npm.

## Fonctionnalités

**Disponibles aujourd'hui**

| Fonctionnalité | API |
|---|---|
| Encaisser un paiement (push mobile money, page hébergée, widget du fournisseur) | `payenv.collect(request)` |
| Envoyer de l'argent vers un numéro mobile money | `payenv.payout(request)` |
| Demander le dernier statut au fournisseur | `payenv.refresh(idempotencyKey)` |
| Confirmer un paiement fait dans un widget (vérifie la référence et le montant) | `payenv.confirm(idempotencyKey, providerRef)` |
| Lire un paiement enregistré | `payenv.getPayment(idempotencyKey)` |
| Idempotence : la même clé renvoie toujours le même paiement | `idempotencyKey` |
| Routage selon les capacités (opération, méthode, pays, devise, réseau) | automatique |
| Fallback sûr entre fournisseurs ; les appels ambigus sont d'abord vérifiés | automatique |
| Ordre de routage, ou votre propre stratégie | `priority([...])`, `routing: (candidates, request) => …` |
| Statuts et erreurs unifiés, avec le code d'origine du fournisseur | `payment.status`, `payment.error` |
| Événements (tentatives, bascules) pour vos logs et métriques | `onEvent` |
| Stockage remplaçable (votre base de données ; en mémoire par défaut) | `Store` |
| Vérification et lecture des webhooks, par connecteur | ex. `verifyFedaPayWebhook` |
| Numéros saisis par les clients convertis en E.164 | `toE164('61 00 00 00', 'BJ')` |

**Prévues** (voir la [feuille de route](docs/ROADMAP.md)) : remboursements,
`@payenv/store-postgres`, coupe-circuit, webhooks unifiés avec déduplication, stratégies
`weighted` / `cheapest` / `bestSuccessRate`, d'autres connecteurs (PayDunya, Flutterwave,
Paystack, Stripe…), un portage PHP / Laravel.

## Démarrer

- [Guide de démarrage](docs/GETTING_STARTED.md) (en anglais) : un premier paiement en 5 minutes.
- [Démo web](examples/fedapay-demo) : encaisse un paiement sandbox via FedaPay, avec bascule
  vers Kkiapay. Lancez-la avec `pnpm demo`.

## Principes

1. **Bibliothèque d'abord.** Payenv tourne *dans votre application*. Aucun service
   hébergé, aucun intermédiaire.
2. **Nous ne touchons ni à votre argent ni à vos clés.** Les fonds circulent directement
   entre votre client, l'agrégateur et vous. Les identifiants restent chez vous.
3. **La justesse avant l'astuce.** Jamais de double débit. Les états ambigus sont résolus,
   jamais devinés ([ADR 0004](docs/adr/0004-no-fallback-on-ambiguous-state.md)).
4. **Aucun enfermement**, ni chez un fournisseur, ni chez Payenv.
5. **Aucune télémétrie.**
6. **Gratuit pour toujours.** Apache 2.0, gouvernance communautaire.

## Développer

Prérequis : Node.js 20.19+ et [pnpm](https://pnpm.io) 9.

```sh
pnpm install
pnpm check       # lint + typage + tests
pnpm test        # tests seuls (les tests sandbox tournent si .env contient des clés sandbox)
pnpm test:watch  # tests en continu
pnpm format      # formatage avec Biome
pnpm build       # compile chaque paquet dans dist/
pnpm demo        # compile et lance la démo sur http://localhost:3000
pnpm changeset   # décrire votre changement pour la prochaine version
```

Les tests sandbox sont optionnels : copiez `.env.example` en `.env` (ignoré par git) et
renseignez des identifiants **sandbox**.

## Documentation

La documentation détaillée est en anglais, pour toucher un maximum de développeurs :
[Démarrage](docs/GETTING_STARTED.md) · [Connecteurs](docs/CONNECTORS.md) ·
[Architecture](docs/ARCHITECTURE.md) · [Vision](docs/VISION.md) ·
[Feuille de route](docs/ROADMAP.md) · [Décisions](docs/adr/) ·
[Contribuer](CONTRIBUTING.md) · [Sécurité](SECURITY.md) · [Changelog](CHANGELOG.md)

Les contributions en français sont les bienvenues : issues, discussions et traductions.
Vous voulez un fournisseur ? Ouvrez une issue avec l'étiquette `connector-request`.

## Avertissement

Payenv n'est ni un fournisseur de paiement, ni une banque, et n'est affilié à aucun des
agrégateurs qu'il connecte. Les marques appartiennent à leurs propriétaires. Payenv est
fourni « en l'état », sans garantie : voir la [LICENCE](LICENSE).

## Licence

Copyright 2026 The Payenv Authors.
Sous [licence Apache, version 2.0](LICENSE).
