'use client';
import { useEffect, useState } from 'react';
import { getBillingStatus, createCheckout } from '@/lib/api';
import Link from 'next/link';

const PLANS = [
  {
    id:       'free',
    name:     'Gratuit',
    price:    '0 €',
    period:   '',
    desc:     'Pour découvrir le service',
    features: ['3 vidéos à l\'inscription', 'Watermark spottedyou.org', 'Toutes les langues'],
    cta:      null,
    highlight: false,
  },
  {
    id:       'monthly',
    name:     'Pro',
    price:    '10 €',
    period:   '/mois',
    desc:     'Pour un usage régulier',
    features: ['Vidéos illimitées', 'Téléchargement sans limite', 'Toutes les langues', 'Priorité de traitement'],
    cta:      'S\'abonner',
    highlight: true,
  },
  {
    id:       'credits_10',
    name:     'Pack 10 vidéos',
    price:    '5 €',
    period:   '',
    desc:     'Sans engagement',
    features: ['10 crédits vidéo', 'N\'expire pas', 'Toutes les langues', 'Téléchargements inclus'],
    cta:      'Acheter',
    highlight: false,
  },
];

export default function BillingPage() {
  const [billing, setBilling] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);

  useEffect(() => {
    getBillingStatus().then(s => { setBilling(s); setLoading(false); });
  }, []);

  async function handleCheckout(planId: string) {
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
    <main className="min-h-screen pt-24 pb-16 px-4">
      {/* Glow */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{ background: 'radial-gradient(ellipse 50% 30% at 50% 0%, rgba(139,92,246,0.07), transparent)' }}
      />

      <div className="relative max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold mb-3">
            Choisissez votre <span className="gradient-text">plan</span>
          </h1>
          <p className="text-zinc-400">Simple, transparent. Sans frais cachés.</p>

          {/* Current plan badge */}
          {!loading && billing && (
            <div className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-4 py-2 rounded-full mt-4 text-sm">
              <span className="w-2 h-2 bg-emerald-400 rounded-full" />
              Plan actuel :
              <span className="font-semibold text-white capitalize">{billing.plan}</span>
              <span className="text-zinc-500">·</span>
              <span className="text-zinc-400">{billing.credits_remaining} crédit(s)</span>
            </div>
          )}
        </div>

        {/* Pricing cards */}
        <div className="grid sm:grid-cols-3 gap-4">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`relative rounded-2xl p-6 flex flex-col transition-all duration-200 ${
                plan.highlight
                  ? 'bg-gradient-to-b from-blue-950/80 to-zinc-900/80 border-2 border-blue-600/60 shadow-2xl shadow-blue-900/20'
                  : 'bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-blue-600 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    ✨ Populaire
                  </span>
                </div>
              )}

              <div className="mb-5">
                <h2 className="text-lg font-bold mb-1">{plan.name}</h2>
                <p className="text-zinc-500 text-sm">{plan.desc}</p>
              </div>

              <div className="mb-5">
                <span className="text-4xl font-extrabold">{plan.price}</span>
                {plan.period && <span className="text-zinc-400 text-sm">{plan.period}</span>}
              </div>

              <ul className="space-y-2.5 flex-1 mb-6">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-sm text-zinc-300">
                    <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              {plan.cta ? (
                <button
                  onClick={() => handleCheckout(plan.id)}
                  disabled={checkoutLoading === plan.id}
                  className={`w-full font-semibold py-3 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed ${
                    plan.highlight
                      ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/30'
                      : 'bg-violet-700 hover:bg-violet-600 text-white'
                  }`}
                >
                  {checkoutLoading === plan.id
                    ? <span className="flex items-center justify-center gap-2">
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                        </svg>
                        Redirection…
                      </span>
                    : plan.cta
                  }
                </button>
              ) : (
                <div className="w-full text-center py-3 text-zinc-500 text-sm border border-zinc-800 rounded-xl">
                  Plan actuel par défaut
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Guarantee */}
        <div className="mt-10 text-center text-zinc-600 text-sm flex items-center justify-center gap-2">
          <span>🔒</span>
          Paiement sécurisé par Stripe · Annulation à tout moment
        </div>

        <p className="text-center mt-8">
          <Link href="/" className="text-zinc-600 hover:text-zinc-400 text-sm transition">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
