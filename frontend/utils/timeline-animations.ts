import { motion } from 'framer-motion';

/**
 * Animation pour l'entrée d'un segment dans la timeline
 */
export const segmentEnterAnimation = {
  initial: { opacity: 0, scale: 0.8, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.8, y: -10 },
  transition: { type: "spring", stiffness: 200, damping: 20 }
};

/**
 * Animation pour la sortie d'un segment (suppression)
 */
export const segmentExitAnimation = {
  initial: { opacity: 1, scale: 1 },
  animate: { opacity: 0, scale: 0.8 },
  exit: { opacity: 0, scale: 0.5 },
  transition: { duration: 0.2 }
};

/**
 * Animation pour le split d'un segment
 * Effet de "crack" qui divise le segment
 */
export const splitAnimation = {
  initial: { scaleX: 1 },
  animate: { 
    scaleX: [1, 1.05, 0.95, 1],
    opacity: [1, 0.8, 1]
  },
  transition: { 
    duration: 0.3,
    times: [0, 0.5, 1]
  }
};

/**
 * Animation pour la fusion de segments
 * Effet de "magnet" qui attire les segments
 */
export const mergeAnimation = {
  initial: { scale: 1 },
  animate: { 
    scale: [1, 1.1, 0.9, 1],
    opacity: [1, 0.7, 1]
  },
  transition: { 
    duration: 0.4,
    times: [0, 0.3, 0.7, 1]
  }
};

/**
 * Animation pour le drag & drop d'un segment
 */
export const dragAnimation = {
  whileDrag: { scale: 1.05, zIndex: 100 },
  dragTransition: { bounceStiffness: 200, bounceDamping: 10 }
};

/**
 * Animation pour le resize d'un segment
 */
export const resizeAnimation = {
  whileResize: { scale: 1.02, opacity: 0.9 },
  transition: { duration: 0.1 }
};

/**
 * Animation pour le playhead (curseur de temps)
 */
export const playheadAnimation = {
  initial: { x: 0 },
  animate: { x: 0 }, // Sera mis à jour dynamiquement
  transition: { type: "spring", stiffness: 300, damping: 30 }
};

/**
 * Animation pour le hover sur un segment
 */
export const segmentHoverAnimation = {
  whileHover: { scale: 1.02, boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)" },
  whileTap: { scale: 0.98 }
};

/**
 * Animation pour la sélection d'un segment
 */
export const selectionAnimation = {
  initial: { scale: 1 },
  animate: { scale: [1, 1.05, 1] },
  transition: { duration: 0.2 }
};

/**
 * Animation pour le zoom de la timeline
 */
export const zoomAnimation = {
  initial: { scale: 1 },
  animate: { scale: 1 }, // Sera mis à jour dynamiquement
  transition: { duration: 0.3 }
};

/**
 * Animation pour l'indicateur de split (ligne verticale)
 */
export const splitIndicatorAnimation = {
  initial: { scaleY: 0, opacity: 0 },
  animate: { 
    scaleY: [0, 1.2, 1],
    opacity: [0, 1, 0.8]
  },
  exit: { scaleY: 0, opacity: 0 },
  transition: { duration: 0.3 }
};

/**
 * Animation pour l'indicateur de fusion (zone de drop)
 */
export const mergeZoneAnimation = {
  initial: { opacity: 0, scale: 0.9 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.9 },
  transition: { duration: 0.2 }
};

/**
 * Animation pour les notifications/toasts
 */
export const notificationAnimation = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -20 },
  transition: { duration: 0.3 }
};

/**
 * Animation pour le chargement (skeleton)
 */
export const loadingAnimation = {
  initial: { opacity: 0.5 },
  animate: { 
    opacity: [0.5, 0.8, 0.5],
    transition: { 
      repeat: Infinity, 
      duration: 1.5,
      ease: "easeInOut"
    }
  }
};

/**
 * Crée une animation de "pulse" pour attirer l'attention
 * @param color Couleur du pulse (hex ou rgb)
 * @param intensity Intensité du pulse (0-1)
 */
export const createPulseAnimation = (color: string = "#3b82f6", intensity: number = 0.3) => ({
  animate: {
    boxShadow: [
      `0 0 0 0 rgba(${hexToRgb(color)}, ${intensity})`,
      `0 0 0 10px rgba(${hexToRgb(color)}, 0)`,
      `0 0 0 0 rgba(${hexToRgb(color)}, 0)`
    ]
  },
  transition: {
    duration: 1.5,
    repeat: Infinity,
    ease: "easeOut"
  }
});

/**
 * Crée une animation de "shake" pour indiquer une erreur
 */
export const createShakeAnimation = {
  animate: {
    x: [0, -5, 5, -5, 5, 0],
    transition: {
      duration: 0.5,
      times: [0, 0.2, 0.4, 0.6, 0.8, 1]
    }
  }
};

/**
 * Animation pour le changement de mode (liste ↔ timeline)
 */
export const modeSwitchAnimation = {
  initial: { opacity: 0, x: -20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 20 },
  transition: { duration: 0.3 }
};

/**
 * Animation pour le slider de temps
 */
export const sliderAnimation = {
  whileHover: { scale: 1.05 },
  whileTap: { scale: 0.95 }
};

/**
 * Animation pour les boutons d'action
 */
export const buttonAnimation = {
  whileHover: { scale: 1.05, boxShadow: "0 4px 12px rgba(0, 0, 0, 0.2)" },
  whileTap: { scale: 0.95 }
};

/**
 * Animation pour les tooltips
 */
export const tooltipAnimation = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 5 },
  transition: { duration: 0.2 }
};

/**
 * Animation pour les transitions de page/état
 */
export const pageTransitionAnimation = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.3 }
};

/**
 * Helper: Convertit une couleur hex en rgb
 */
function hexToRgb(hex: string): string {
  // Supprimer le # si présent
  hex = hex.replace('#', '');
  
  // Convertir en valeurs RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  
  return `${r}, ${g}, ${b}`;
}

/**
 * Composant Motion wrapper avec animations préconfigurées
 */
export const AnimatedSegment = motion.div;

/**
 * Composant Motion button avec animations préconfigurées
 */
export const AnimatedButton = motion.button;

/**
 * Composant Motion div avec animations préconfigurées
 */
export const AnimatedDiv = motion.div;

/**
 * Composant Motion span avec animations préconfigurées
 */
export const AnimatedSpan = motion.span;