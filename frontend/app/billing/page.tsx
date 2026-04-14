'use client';
import { useEffect, useState } from 'react';
import { getBillingStatus, createCheckout } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

// ── Plans ─────────────────────────────────────────────────────────────────────
const PLANS = [
  {
    id:        'free',
    name:      'Gratuit',
    price:     '0 €',
    period:    '',
    badge:     null,
    desc:      'Pour découvrir le service',
    highlight: false,
    features: [
      { text: '3 vidéos offertes à l\'inscription',        ok: true  },
      { text: 'Filigrane SpottedYou automatique',           ok: true  },
      { text: '1 langue par traduction',                    ok: true  },
      { text: 'File d\'attente non prioritaire',            ok: true  },
      { text: '21 langues disponibles',                     ok: false },
      { text: 'Filigrane optionnel',                        ok: false },
      { text: 'Watermark personnalisé',                     ok: false },
    ],
    cta: null,
  },
  {
    id:        'monthly',
    name:      'Pro',
    price:     '15 €',
    period:    '/mois',
    badge:     'Populaire',
    desc:      'Pour les créateurs réguliers',
    highlight: true,
    features: [
      { text: 'Vidéos illimitées',                          ok: true  },
      { text: 'Jusqu\'à 21 langues simultanément',          ok: true  },
      { text: 'File d\'attente prioritaire',                ok: true  },
      { text: 'Filigrane optionnel (on/off)',               ok: true  },
      { text: 'Watermark personnalisé à votre nom +5€/mois', ok: true  },
      { text: 'Téléchargement sans limite',                 ok: true  },
    ],
    cta: 'S\'abonner',
    extra: {
      id:    'watermark_custom',
      label: '+ Watermark personnalisé',
      price: '5 €/mois',
      desc:  'Remplacez le filigrane SpottedYou par votre propre nom / marque',
    },
  },
  {
    id:        'editors',
    name:      'Éditeurs',
    price:     '50 €',
    period:    '/mois',
    badge:     'Créateurs Pro',
    desc:      'Pour les pros de la diffusion',
    highlight: false,
    features: [
      { text: 'Tout le plan Pro inclus',                    ok: true  },
      { text: 'Watermark personnalisé inclus',              ok: true  },
      { text: 'Zéro file d\'attente — traitement immédiat', ok: true  },
      { text: 'Téléchargement du fichier source',           ok: true  },
      { text: 'Protection optimisée avant mise en ligne',   ok: true  },
      { text: '21 langues en une seule soumission',         ok: true  },
    ],
    cta: 'Commencer',
    extra: null,
  },
];

// ── Page billing ──────────────────────────────────────────────────────────────
export default function BillingPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [billing,         setBilling]             = useState<any>(null);
  const [checkoutLoading, setCheckoutLoading]     = useState<string | null>(null);
  const [extraChecked,    setExtraChecked]        = useState(false);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    getBillingStatus().then((s) => setBilling(s)).catch(() => {});
  }, [isAuthenticated, authLoading]);

  async function handleCheckout(planId: string) {
    if (!isAuthenticated) { window.location.href = '/login'; return; }
    setCheckoutLoading(planId);
    try {
      const res = await createCheckout(planId);
      window.location.href = res.checkout_url;
    } catch (e: any) {
      alert(e?.detail || 'Erreur lors de la création du paiement.');
      setCheckoutLoading(null);
    }
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-12">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            Choisissez votre{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">plan</span>
          </h1>
          <p className="text-sm text-gray-400">Simple, transparent. Sans frais cachés.</p>

          {isAuthenticated && billing && (
            <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-gray-900 border border-gray-800 text-xs">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
              Plan actuel : <span className="font-semibold text-white capitalize">{billing.plan}</span>
              <span className="text-gray-600">·</span>
              <span className="text-gray-400">{billing.credits_remaining} crédit(s) restant(s)</span>
            </div>
          )}
        </div>

        {/* Cards plans */}
        <div className="grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto mb-10">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl flex flex-col transition-all ${
                plan.highlight
                  ? 'bg-blue-500/5 border-2 border-blue-500/40 hover:border-blue-500/60 shadow-xl shadow-blue-500/10 pt-5'
                  : 'bg-gray-900/60 border border-gray-800 hover:border-gray-700 pt-5'
              }`}
            >
              {/* Badge */}
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full ${
                    plan.highlight ? 'bg-blue-600 text-white' : 'bg-violet-600 text-white'
                  }`}>
                    {plan.badge}
                  </span>
                </div>
              )}

              <div className="px-5 pb-5 flex flex-col flex-1">
                {/* Nom + desc */}
                <div className="mb-3">
                  <h2 className="text-sm font-bold text-white mb-0.5">{plan.name}</h2>
                  <p className="text-[11px] text-gray-500">{plan.desc}</p>
                </div>

                {/* Prix */}
                <div className="mb-5">
                  <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                  {plan.period && <span className="text-sm text-gray-500">{plan.period}</span>}
                </div>

                {/* Features */}
                <ul className="space-y-2 flex-1 mb-5">
                  {plan.features.map((f) => (
                    <li key={f.text} className={`flex items-start gap-2 text-xs ${f.ok ? 'text-gray-300' : 'text-gray-600 line-through'}`}>
                      <span className={`shrink-0 mt-0.5 font-bold ${f.ok ? 'text-emerald-400' : 'text-gray-700'}`}>
                        {f.ok ? '✓' : '✗'}
                      </span>
                      {f.text}
                    </li>
                  ))}
                </ul>

                {/* Option extra (watermark perso pour Pro) */}
                {plan.extra && (
                  <label className={`
                    flex items-start gap-3 p-3 rounded-xl border cursor-pointer mb-4 transition-all
                    ${extraChecked && plan.id === 'monthly'
                      ? 'border-violet-500/40 bg-violet-500/5'
                      : 'border-gray-700 hover:border-gray-600'}
                  `}>
                    <input
                      type="checkbox"
                      checked={extraChecked && plan.id === 'monthly'}
                      onChange={() => setExtraChecked((v) => !v)}
                      className="mt-0.5 accent-violet-500"
                    />
                    <div>
                      <p className="text-[11px] font-semibold text-white">{plan.extra.label}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5">{plan.extra.desc}</p>
                      <p className="text-[11px] text-violet-400 font-bold mt-1">{plan.extra.price}</p>
                    </div>
                  </label>
                )}

                {/* CTA */}
                {plan.cta ? (
                  <button
                    onClick={() => handleCheckout(plan.id === 'monthly' && extraChecked ? 'monthly_plus_watermark' : plan.id)}
                    disabled={checkoutLoading === plan.id}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 ${
                      plan.highlight
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                        : 'bg-gray-800 hover:bg-gray-700 text-white border border-gray-700'
                    }`}
                  >
                    {checkoutLoading === plan.id ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        Redirection…
                      </>
                    ) : plan.cta}
                  </button>
                ) : (
                  <div className="w-full text-center py-2.5 text-xs text-gray-600 border border-gray-800 rounded-xl">
                    Plan par défaut
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Section Éditeurs — explication */}
        <div className="max-w-4xl mx-auto mb-10 bg-gradient-to-r from-violet-900/20 to-gray-900/40 border border-violet-500/20 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <span className="text-3xl">🎬</span>
            <div>
              <h3 className="text-sm font-bold text-white mb-2">Pourquoi le plan Éditeurs ?</h3>
              <p className="text-xs text-gray-400 leading-relaxed max-w-2xl">
                Si vous êtes créateur de contenu professionnel, la séquence optimale est :{' '}
                <strong className="text-white">télécharger d'abord le fichier source traduit</strong>,
                le vérifier, l'éditer si besoin, puis le publier — plutôt que de publier directement sur les réseaux.
                Le plan Éditeurs vous donne accès au fichier brut avant mise en ligne, pour une{' '}
                <strong className="text-white">protection maximale de votre contenu</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* CTA non connecté */}
        {!isAuthenticated && (
          <div className="max-w-4xl mx-auto mb-10 bg-gradient-to-br from-blue-900/20 to-violet-900/20 border border-blue-500/20 rounded-2xl p-6 text-center">
            <p className="text-sm font-bold text-white mb-2">Commencez gratuitement</p>
            <p className="text-xs text-gray-400 mb-4">
              3 vidéos offertes. Aucune carte bancaire requise.
            </p>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors"
            >
              Créer un compte gratuit →
            </Link>
          </div>
        )}

        {/* FAQ rapide */}
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 gap-4 mb-10">
          {[
            { q: 'Puis-je annuler à tout moment ?', a: 'Oui. L\'abonnement Pro peut être annulé à tout moment depuis votre espace Stripe. Vous conservez l\'accès jusqu\'à la fin de la période.' },
            { q: 'Est-ce que mes vidéos sont supprimées si je résilie ?', a: 'Non. Vos vidéos restent accessibles dans votre bibliothèque. Seule la création de nouvelles traductions sera limitée au quota gratuit.' },
            { q: 'Comment fonctionne le watermark personnalisé ?', a: 'Avec l\'option Pro +5€ ou le plan Éditeurs, votre nom / marque remplace le filigrane SpottedYou sur toutes vos vidéos traduites.' },
            { q: 'Qu\'est-ce que le téléchargement source (Éditeurs) ?', a: 'Vous recevez le fichier vidéo traduit directement, sans passer par la bibliothèque web. Idéal pour édition ou publication manuelle.' },
          ].map((item) => (
            <div key={item.q} className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
              <p className="text-xs font-semibold text-white mb-1.5">{item.q}</p>
              <p className="text-[11px] text-gray-500 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>

        <p className="text-center text-[11px] text-gray-600 mb-6">
          🔒 Paiement sécurisé par Stripe · Annulation à tout moment · Sans frais cachés
        </p>

        <p className="text-center">
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
