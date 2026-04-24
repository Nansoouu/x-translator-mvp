"use client";

import { motion, AnimatePresence } from "framer-motion";

interface UpsellModalProps {
  isOpen: boolean;
  onClose: () => void;
  isAuthenticated: boolean;
  videoDurationMinutes: number;
}

export default function UpsellModal({
  isOpen,
  onClose,
  isAuthenticated,
  videoDurationMinutes,
}: UpsellModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="bg-gray-900 border border-gray-700 rounded-2xl p-8 max-w-md w-full shadow-2xl"
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* En-tête */}
            <div className="text-center mb-6">
              <h2 className="text-xl font-extrabold text-white mb-2">
                {isAuthenticated ? "🔓 Débloque plus de temps" : "🚀 Passe à la vitesse supérieure"}
              </h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                Ta vidéo fait{" "}
                <strong className="text-white">{videoDurationMinutes.toFixed(1)} min</strong>.
              </p>
              <p className="text-sm text-gray-400">
                {!isAuthenticated
                  ? "Le mode gratuit est limité à 2 minutes."
                  : "Le compte gratuit est limité à 5 minutes."}
              </p>
            </div>

            {/* Carte inscription */}
            {!isAuthenticated && (
              <a
                href="/login"
                className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 text-white font-bold text-sm mb-4 transition-all shadow-lg shadow-blue-600/20"
              >
                <span>📝</span>
                Crée un compte gratuit → 5 min max
              </a>
            )}

            {isAuthenticated && (
              <a
                href="/billing"
                className="flex items-center justify-center gap-3 w-full py-3.5 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold text-sm mb-4 transition-all shadow-lg shadow-cyan-600/20"
              >
                <span>💎</span>
                Voir les plans
              </a>
            )}

            {/* Carte BYOK */}
            <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-5 mb-6">
              <div className="flex items-start gap-3">
                <span className="text-xl">🔑</span>
                <div>
                  <p className="text-sm font-bold text-cyan-400 mb-1">
                    Apporte ta clé Groq
                  </p>
                  <p className="text-xs text-gray-400 leading-relaxed mb-3">
                    Avec ta propre clé API Groq (totalement gratuite), tu débloques{" "}
                    <strong className="text-white">1h30 de traduction par jour</strong>.
                    Aucun paiement requis.
                  </p>
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-cyan-500 hover:text-cyan-400 underline transition-colors"
                  >
                    Obtenir une clé Groq ↗
                  </a>
                </div>
              </div>
            </div>

            {/* Boutons */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-xl border border-gray-600 text-gray-400 hover:text-white hover:border-gray-500 transition-all text-sm"
              >
                Plus tard
              </button>
              <a
                href={isAuthenticated ? "/billing" : "/login"}
                className="flex-1 text-center py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-sm transition-all shadow-lg shadow-cyan-600/20"
              >
                {isAuthenticated ? "💳 Voir les plans" : "📝 S'inscrire"}
              </a>
            </div>

            <p className="text-[10px] text-gray-600 text-center mt-4">
              Ta clé est chiffrée et jamais partagée. 1h30/jour par clé.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}