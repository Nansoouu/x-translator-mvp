'use client';
import { useEffect, useState } from 'react';
import { getBillingStatus, createCheckout } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import Link from 'next/link';

const PLANS = [
  {
    id: 'free',
    name: 'Gratuit',
    price: '0 €',
    period: '',
    desc: 'Pour découvrir le service',
    features: ['3 vidéos à l\'inscription', 'Watermark spottedyou.org', '21 langues disponibles'],
    cta: null,
    highlight: false,
  },
  {
    id: 'monthly',
    name: 'Pro',
    price: '10 €',
    period: '/mois',
    desc: 'Pour un usage régulier',
    features: ['Vidéos illimitées', 'Téléchargement sans limite', '21 langues disponibles', 'Priorité de traitement'],
    cta: 'S\'abonner',
    highlight: true,
  },
  {
    id: 'credits_10',
    name: 'Pack 10 vidéos',
    price: '5 €',
    period: '',
    desc: 'Sans engagement',
    features: ['10 crédits vidéo', 'N\'expire pas', '21 langues disponibles', 'Téléchargements inclus'],
    cta: 'Acheter',
    highlight: false,
  },
];

export default function BillingPage() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [billing, setBilling]                     = useState<any>(null);
  const [checkoutLoading, setCheckoutLoading]     = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !isAuthenticated) return;
    getBillingStatus().then(s => setBilling(s)).catch(() => {});
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
    <main className="h-screen overflow-y-auto bg-gray-950 text-white">
      <div className="max-w-5xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="text-center mb-10">
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
              <span className="text-gray-400">{billing.credits_remaining} crédit(s)</span>
            </div>
          )}
        </div>

        {/* Cards */}
        <div className="grid sm:grid-cols-3 gap-4 max-w-3xl mx-auto">
          {PLANS.map(plan => (
            <div
              key={plan.id}
              className={`relative rounded-2xl p-5 flex flex-col transition-all ${
                plan.highlight
                  ? 'bg-blue-500/5 border-2 border-blue-500/40 hover:border-blue-500/60 shadow-lg shadow-blue-500/10'
                  : 'bg-gray-900/60 border border-gray-800 hover:border-gray-700'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-blue-600 text-white">
                    Populaire
                  </span>
                </div>
              )}

              <div className="mb-4">
                <h2 className="text-sm font-bold text-white mb-0.5">{plan.name}</h2>
                <p className="text-[11px] text-gray-500">{plan.desc}</p>
              </div>

              <div className="mb-5">
                <span className="text-3xl font-extrabold text-white">{plan.price}</span>
                {plan.period && <span className="text-sm text-gray-500">{plan.period}</span>}
              </div>

              <ul className="space-y-2 flex-1 mb-5">
                {plan.features.map(f => (
                  <li key={f} className="flex items-start gap-2 text-xs text-gray-300">
                    <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
                    {f}
                  </li>
                ))}
              </ul>

              {plan.cta ? (
                <button
                  onClick={() => handleCheckout(plan.id)}
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
          ))}
        </div>

        <p className="text-center text-[11px] text-gray-600 mt-8">
          🔒 Paiement sécurisé par Stripe · Annulation à tout moment
        </p>

        <p className="text-center mt-6">
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
            ← Retour à l'accueil
          </Link>
        </p>
      </div>
    </main>
  );
}
