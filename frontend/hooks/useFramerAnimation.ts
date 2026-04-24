import { useRef, useEffect, useState } from 'react';
import { animate, motionValue, useMotionValue, useTransform, useAnimation } from 'framer-motion';

export interface TapeEffectOptions {
  speed?: number;
  delay?: number;
  easing?: string;
}

export const useFramerAnimation = () => {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    return () => setIsMounted(false);
  }, []);

  const animateIn = isMounted;
  const animateOut = !isMounted;

  return { animateIn, animateOut };
};

export const useTapeEffect = (
  text: string,
  options: TapeEffectOptions = {}
) => {
  const { speed = 50, delay = 0, easing = 'easeInOut' } = options;
  const [displayText, setDisplayText] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (!text) {
      setDisplayText('');
      return;
    }

    setIsAnimating(true);
    const characters = text.split('');
    let index = 0;

    const interval = setInterval(() => {
      if (index < characters.length) {
        setDisplayText((prev) => prev + characters[index]);
        setCurrentIndex(index);
        index++;
      } else {
        clearInterval(interval);
        setIsAnimating(false);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return {
    displayText,
    isAnimating,
    currentIndex,
    progress: text ? currentIndex / text.length : 0,
  };
};

export const useStepTransition = (currentStep: string) => {
  const previousStep = useRef<string | null>(null);
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    if (previousStep.current && previousStep.current !== currentStep) {
      const steps = ['download', 'transcribe', 'translate', 'render', 'done'];
      const prevIndex = steps.indexOf(previousStep.current);
      const currIndex = steps.indexOf(currentStep);
      
      setDirection(currIndex > prevIndex ? 'forward' : 'backward');
      setIsTransitioning(true);
      
      const timeout = setTimeout(() => setIsTransitioning(false), 500);
      return () => clearTimeout(timeout);
    }
    
    previousStep.current = currentStep;
  }, [currentStep]);

  return {
    direction,
    isTransitioning,
    variants: {
      enter: {
        x: direction === 'forward' ? 100 : -100,
        opacity: 0,
      },
      enterFrom: direction === 'forward' ? { x: 100, opacity: 0 } : { x: -100, opacity: 0 },
      center: {
        x: 0,
        opacity: 1,
      },
      exit: {
        x: direction === 'forward' ? -100 : 100,
        opacity: 0,
      },
    },
  };
};

export const useFadeInOut = (duration = 0.3) => {
  const controls = useAnimation();

  const fadeIn = async () => {
    await controls.start({
      opacity: 1,
      scale: 1,
      transition: { duration },
    });
  };

  const fadeOut = async () => {
    await controls.start({
      opacity: 0,
      scale: 0.9,
      transition: { duration },
    });
  };

  return {
    controls,
    fadeIn,
    fadeOut,
    variants: {
      hidden: { opacity: 0, scale: 0.9 },
      visible: { opacity: 1, scale: 1 },
    },
  };
};

export const useProgressBarAnimation = (progress: number) => {
  const motionProgress = useMotionValue(0);

  useEffect(() => {
    const animation = animate(motionProgress, progress / 100, {
      duration: 0.5,
      ease: 'easeInOut',
    });

    return animation.stop;
  }, [progress, motionProgress]);

  const width = useTransform(motionProgress, (value) => `${value * 100}%`);

  return { width, motionProgress };
};