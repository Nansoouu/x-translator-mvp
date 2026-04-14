'use client';
import { useEffect, useState } from 'react';
import { getBillingStatus, createCheckout } from '@/lib/api';

export default function BillingPage() {
  const [status, setStatus] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getBillingStatus().then(s => { setStatus(s); setLoading(false); });
  }, []);

  async function handleCheckout(plan: string) {
    try {
      const res = await createCheckout(plan);
      window.location.href = res.checkout_url;
    } catch (e: any) {
      alert(e?.detail || 'Erreur');
    }
  }

  if (loading) return <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center"><p>Chargement…</p></main>;

  return (
    <main className="min-h-screen bg-zinc-950 text-white py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-2">💳 Abonnement</h1>
        {status && <p className="text-zinc-400 mb-8">Plan actuel : <span className="text-white font-semibold">{status.plan}</span> — {status.credits_remaining} crédit(s)</p>}
        <div className="grid gap-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-xl font-bold mb-1">Gratuit</h2>
            <p className="text-zinc-400 text-sm mb-4">3 vidéos à l'inscription</p>
            <p className="text-2xl font-bold">0 €</p>
          </div>
          <div className="bg-zinc-900 border border-blue-700 rounded-xl p-6">
            <h2 className="text-xl font-bold mb-1">Mensuel</h2>
            <p className="text-zinc-400 text-sm mb-4">Vidéos illimitées</p>
            <p className="text-2xl font-bold mb-4">10 €<span className="text-zinc-400 text-base">/mois</span></p>
            <button onClick={() => handleCheckout('monthly')} className="w-full bg-blue-600 hover:bg-blue-700 font-semibold py-2 rounded-lg">S'abonner</button>
          </div>
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-6">
            <h2 className="text-xl font-bold mb-1">Pack 10 vidéos</h2>
            <p className="text-zinc-400 text-sm mb-4">Sans engagement</p>
            <p className="text-2xl font-bold mb-4">5 €</p>
            <button onClick={() => handleCheckout('credits_10')} className="w-full bg-violet-600 hover:bg-violet-700 font-semibold py-2 rounded-lg">Acheter</button>
          </div>
        </div>
        <p className="text-center mt-8"><a href="/" className="text-zinc-500 text-sm hover:text-white">← Retour</a></p>
      </div>
    </main>
  );
}
